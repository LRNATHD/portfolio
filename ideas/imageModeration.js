/**
 * AI Image Safety Reviewer ("only the most vile stuff")
 *
 * Strategy:
 * 1. Tries edge Vision LLM review (`POST /api/p-ae0069c6cee3/review-image`) via Cloudflare Workers AI when available.
 * 2. Falls back cleanly to an in-browser AI classifier (`nsfwjs/core` + `MobileNetV2Model`, lazy-loaded only
 *    when a user uploads an image) tuned to high thresholds so memes, selfies, drawings, and hardware
 *    photos pass while extreme explicit imagery is blocked.
 */

let cachedModelPromise = null;

function createResizedJpegDataUrl(imgEl, maxDim = 512, quality = 0.78) {
  const srcW = imgEl.naturalWidth || imgEl.width || 1;
  const srcH = imgEl.naturalHeight || imgEl.height || 1;
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(imgEl, 0, 0, w, h);
  return {
    canvas,
    dataUrl: canvas.toDataURL('image/jpeg', quality),
  };
}

async function tryEdgeVisionReview(workerBaseUrl, dataUrl) {
  if (!workerBaseUrl) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${workerBaseUrl}/api/p-ae0069c6cee3/review-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageData: dataUrl }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.reviewed === true && typeof data.allowed === 'boolean') {
      return {
        allowed: data.allowed,
        reason: data.reason || (data.allowed ? '' : 'This image cannot be printed. Please choose a different image.'),
        source: 'edge',
      };
    }
    return null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getLocalNsfwModel() {
  if (!cachedModelPromise) {
    cachedModelPromise = (async () => {
      const [tf, { load }, { MobileNetV2Model }] = await Promise.all([
        import('@tensorflow/tfjs'),
        import('nsfwjs/core'),
        import('nsfwjs/models/mobilenet_v2'),
      ]);
      if (typeof tf.enableProdMode === 'function') {
        tf.enableProdMode();
      }
      return await load('MobileNetV2', { modelDefinitions: [MobileNetV2Model] });
    })();
  }
  return cachedModelPromise;
}

/**
 * Reviews a user-uploaded HTMLImageElement before it can be saved or printed.
 * @param {HTMLImageElement} imgEl
 * @param {string} workerBaseUrl
 * @returns {Promise<{ allowed: boolean, reason?: string, source: string }>}
 */
export async function moderateImage(imgEl, workerBaseUrl) {
  const { canvas, dataUrl } = createResizedJpegDataUrl(imgEl, 512, 0.78);

  const edgeResult = await tryEdgeVisionReview(workerBaseUrl, dataUrl);
  if (edgeResult) {
    return edgeResult;
  }

  // Fallback to lazy-loaded in-browser AI classifier (only blocking extreme explicit content)
  try {
    const model = await getLocalNsfwModel();
    const predictions = await model.classify(canvas);
    const scores = {};
    for (const p of predictions) {
      scores[p.className] = p.probability;
    }

    const porn = scores.Porn || 0;
    const hentai = scores.Hentai || 0;
    const isExtremeExplicit =
      porn >= 0.95 ||
      hentai >= 0.96 ||
      (porn >= 0.78 && porn + hentai >= 0.96);

    if (isExtremeExplicit) {
      return {
        allowed: false,
        reason: 'This image cannot be printed. Please choose a different image.',
        source: 'local',
      };
    }
    return { allowed: true, source: 'local' };
  } catch (err) {
    console.warn('Image verification unavailable:', err);
    return {
      allowed: false,
      reason: 'Could not process this image. Please try another image.',
      source: 'error',
    };
  }
}
