import { checkSubmissionProfanity } from './profanityFilter.js';
import { moderateImage } from './imageModeration.js';

(function () {
  'use strict';

  const WORKER_BASE_URL = 'https://realtalk-printer-bridge.super-disk-489b.workers.dev';
  const PUBLIC_API = `${WORKER_BASE_URL}/api/p-ae0069c6cee3`;
  const GLOBAL_MAX = 400;

  const SAMPLE_TITLE = 'Project title';
  const SAMPLE_DESC = 'Write a short description of your project idea...';

  let globalTotalPrints = 0;
  let globalPrintsRemaining = GLOBAL_MAX;
  let postponeUntil = 0; // 0 = immediate, -1 = hold indefinitely, >0 = epoch ms
  let isSubmitting = false;
  let showingSentPreview = false;

  // Uploaded image state (1 max)
  let attachedImageEl = null;
  let attachedImageThumb = null;
  let attachedImageReviewPromise = null;
  let imageEdit = { brightness: 0, contrast: 1.1, mode: 'dither', invert: false, rotate: 0 };

  const form = document.getElementById('ideaForm');
  const projectTitle = document.getElementById('projectTitle');
  const projectDescription = document.getElementById('projectDescription');
  const projectAuthor = document.getElementById('projectAuthor');
  const projectImage = document.getElementById('projectImage');
  const btnChooseImage = document.getElementById('btnChooseImage');
  const btnClearImage = document.getElementById('btnClearImage');
  const imageFileMeta = document.getElementById('imageFileMeta');
  const imageLimitCount = document.getElementById('imageLimitCount');
  const imageEditPanel = document.getElementById('imageEditPanel');
  const imgBrightness = document.getElementById('imgBrightness');
  const imgBrightnessVal = document.getElementById('imgBrightnessVal');
  const imgContrast = document.getElementById('imgContrast');
  const imgContrastVal = document.getElementById('imgContrastVal');
  const btnImgRotate = document.getElementById('btnImgRotate');
  const btnImgMode = document.getElementById('btnImgMode');
  const btnImgInvert = document.getElementById('btnImgInvert');
  const btnImgReset = document.getElementById('btnImgReset');
  const titleCharCount = document.getElementById('titleCharCount');
  const descCharCount = document.getElementById('descCharCount');
  const authorCharCount = document.getElementById('authorCharCount');
  const btnSubmitIdea = document.getElementById('btnSubmitIdea');
  const statusMsg = document.getElementById('statusMsg');
  const feedbackBox = document.getElementById('feedbackBox');
  const feedbackTitle = document.getElementById('feedbackTitle');
  const feedbackDesc = document.getElementById('feedbackDesc');

  const globalQuotaText = document.getElementById('globalQuotaText');

  const previewHeaderLabel = document.getElementById('previewHeaderLabel');
  const thermalPreviewCard = document.getElementById('thermalPreviewCard');
  const previewCanvas = document.getElementById('previewCanvas');

  let cachedRoughLocation = null;
  let geoLookupPromise = null;

  function init() {
    setupEventListeners();
    syncUIQuotaState();
    renderLivePreviewCanvas();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => renderLivePreviewCanvas());
    }
    geoLookupPromise = resolveRoughLocation();
    fetchRemoteQuotaState();
    setInterval(updateLiveTimestamp, 15000);
  }

  function clearSentPreviewHighlight() {
    if (!showingSentPreview) return;
    showingSentPreview = false;
    if (previewHeaderLabel) {
      previewHeaderLabel.textContent = 'Preview (1:1 Print)';
      previewHeaderLabel.classList.remove('sent');
    }
    if (thermalPreviewCard) {
      thermalPreviewCard.classList.remove('sent');
    }
    renderLivePreviewCanvas();
  }

  let previewRafId = null;
  function scheduleLivePreviewRender() {
    if (previewRafId) return;
    previewRafId = requestAnimationFrame(() => {
      previewRafId = null;
      renderLivePreviewCanvas();
    });
  }

  function renderLivePreviewCanvas() {
    if (!previewCanvas || showingSentPreview) return;
    const tVal = projectTitle.value.trim() || SAMPLE_TITLE;
    const dVal = projectDescription.value.trim() || SAMPLE_DESC;
    const aVal = projectAuthor.value.trim() || 'Anonymous';
    const nextNum = getNextPrintNumber();
    renderLabelToCanvas(
      previewCanvas,
      tVal,
      dVal,
      aVal,
      getFormattedTimestamp(),
      nextNum,
      attachedImageEl,
      imageEdit
    );
  }

  function syncImageEditControlsUI() {
    if (imgBrightness) imgBrightness.value = String(imageEdit.brightness);
    if (imgBrightnessVal) imgBrightnessVal.textContent = (imageEdit.brightness > 0 ? `+${imageEdit.brightness}` : String(imageEdit.brightness));
    if (imgContrast) imgContrast.value = imageEdit.contrast.toFixed(2);
    if (imgContrastVal) imgContrastVal.textContent = imageEdit.contrast.toFixed(2);
    if (btnImgMode) {
      btnImgMode.textContent = imageEdit.mode === 'dither' ? 'Photo dither' : 'Sharp B&W';
      btnImgMode.classList.toggle('active', imageEdit.mode === 'dither');
    }
    if (btnImgRotate) {
      btnImgRotate.textContent = imageEdit.rotate ? `Rotate (${imageEdit.rotate}°)` : 'Rotate 90°';
      btnImgRotate.classList.toggle('active', imageEdit.rotate !== 0);
    }
    if (btnImgInvert) {
      btnImgInvert.classList.toggle('active', imageEdit.invert);
    }
  }

  function resetImageEditDefaults() {
    imageEdit = { brightness: 0, contrast: 1.1, mode: 'dither', invert: false, rotate: 0 };
    syncImageEditControlsUI();
  }

  function clearAttachedImage(updatePreview = true) {
    attachedImageEl = null;
    attachedImageThumb = null;
    attachedImageReviewPromise = null;
    resetImageEditDefaults();
    if (projectImage) projectImage.value = '';
    if (imageFileMeta) imageFileMeta.textContent = 'None attached';
    if (imageLimitCount) imageLimitCount.textContent = '0/1';
    if (btnClearImage) btnClearImage.classList.add('hidden');
    if (imageEditPanel) imageEditPanel.classList.add('hidden');
    if (updatePreview) renderLivePreviewCanvas();
  }

  function loadImageFromSrc(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = src;
    });
  }

  /**
   * Renders an image to 1-bit monochrome printhead dots using serpentine Floyd-Steinberg
   * dithering or crisp thresholding, applying user B/W balance, contrast, and inversion.
   */
  function ditherImageToCanvas(sourceImg, targetW, targetH, opts = {}) {
    const w = Math.max(1, Math.round(targetW));
    const h = Math.max(1, Math.round(targetH));
    const brightness = Number.isFinite(opts.brightness) ? opts.brightness : 0;
    const contrast = Number.isFinite(opts.contrast) ? opts.contrast : 1.1;
    const mode = opts.mode || 'dither';
    const invert = !!opts.invert;
    const rotateDeg = (((opts.rotate || 0) % 360) + 360) % 360;

    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (rotateDeg !== 0) {
      const swap = rotateDeg === 90 || rotateDeg === 270;
      const drawW = swap ? h : w;
      const drawH = swap ? w : h;
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate((rotateDeg * Math.PI) / 180);
      ctx.drawImage(sourceImg, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();
    } else {
      ctx.drawImage(sourceImg, 0, 0, w, h);
    }

    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const baseGray = new Float32Array(w * h);

    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      let lum = a < 64
        ? 255
        : 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

      if (invert) lum = 255 - lum;
      lum = (lum - 128) * contrast + 128 + brightness;
      baseGray[i / 4] = lum < 0 ? 0 : lum > 255 ? 255 : lum;
    }

    const gray = new Float32Array(baseGray);

    if (mode === 'dither') {
      // Subtle detail sharpening before dithering for crisper 203 DPI thermal dots
      const sharp = new Float32Array(gray.length);
      const amount = 0.25;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
            sharp[idx] = gray[idx];
          } else {
            const blur = (gray[idx - 1] + gray[idx + 1] + gray[idx - w] + gray[idx + w]) * 0.25;
            const v = gray[idx] + (gray[idx] - blur) * amount;
            sharp[idx] = v < 0 ? 0 : v > 255 ? 255 : v;
          }
        }
      }

      // Serpentine Floyd-Steinberg error diffusion (reduces directional worm artifacts)
      for (let y = 0; y < h; y++) {
        const leftToRight = (y & 1) === 0;
        const startX = leftToRight ? 0 : w - 1;
        const endX = leftToRight ? w : -1;
        const step = leftToRight ? 1 : -1;

        for (let x = startX; x !== endX; x += step) {
          const idx = y * w + x;
          const oldVal = sharp[idx];
          const newVal = oldVal < 128 ? 0 : 255;
          sharp[idx] = newVal;
          const err = oldVal - newVal;

          if (x + step >= 0 && x + step < w) sharp[idx + step] += (err * 7) / 16;
          if (y + 1 < h) {
            const nextRow = (y + 1) * w;
            if (x - step >= 0 && x - step < w) sharp[nextRow + x - step] += (err * 3) / 16;
            sharp[nextRow + x] += (err * 5) / 16;
            if (x + step >= 0 && x + step < w) sharp[nextRow + x + step] += (err * 1) / 16;
          }
        }
      }
      gray.set(sharp);
    } else {
      for (let i = 0; i < gray.length; i++) {
        gray[i] = gray[i] < 128 ? 0 : 255;
      }
    }

    for (let i = 0; i < gray.length; i++) {
      const v = gray[i] < 128 ? 0 : 255;
      const idx = i * 4;
      data[idx] = v;
      data[idx + 1] = v;
      data[idx + 2] = v;
      data[idx + 3] = 255;
    }

    ctx.putImageData(imgData, 0, 0);
    return c;
  }

  async function handleImageSelected(file) {
    clearSentPreviewHighlight();
    clearErrorFeedback();
    if (!file) {
      clearAttachedImage();
      return;
    }
    if (!file.type || !file.type.startsWith('image/')) {
      clearAttachedImage();
      setStatus('Select a valid image file (PNG, JPG, WebP, GIF).', true);
      return;
    }

    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read image file'));
        reader.readAsDataURL(file);
      });

      const img = await loadImageFromSrc(dataUrl);
      const srcW = img.naturalWidth || img.width || 1;
      const srcH = img.naturalHeight || img.height || 1;

      // Save high-detail source scaled to printhead dot width (~736px max) as JPEG for KV archive & sharp reprints
      const storeScale = Math.min(1, 740 / Math.max(srcW, srcH));
      const storeW = Math.max(16, Math.round(srcW * storeScale));
      const storeH = Math.max(16, Math.round(srcH * storeScale));
      const storeCanvas = document.createElement('canvas');
      storeCanvas.width = storeW;
      storeCanvas.height = storeH;
      const storeCtx = storeCanvas.getContext('2d');
      storeCtx.fillStyle = '#FFFFFF';
      storeCtx.fillRect(0, 0, storeW, storeH);
      storeCtx.imageSmoothingEnabled = true;
      storeCtx.imageSmoothingQuality = 'high';
      storeCtx.drawImage(img, 0, 0, storeW, storeH);

      resetImageEditDefaults();
      attachedImageEl = img;
      attachedImageThumb = storeCanvas.toDataURL('image/jpeg', 0.84);
      if (imageFileMeta) {
        const cleanName = file.name.length > 24 ? file.name.slice(0, 21) + '...' : file.name;
        imageFileMeta.textContent = `${cleanName} (${srcW}×${srcH})`;
      }
      if (imageLimitCount) imageLimitCount.textContent = '1/1';
      if (btnClearImage) btnClearImage.classList.remove('hidden');
      if (imageEditPanel) imageEditPanel.classList.remove('hidden');
      renderLivePreviewCanvas();

      // Pre-check image silently in background
      attachedImageReviewPromise = moderateImage(img, WORKER_BASE_URL);
    } catch (err) {
      clearAttachedImage();
      setStatus(err.message || 'Could not load image.', true);
    }
  }

  function showFeedback(state, title, desc) {
    if (!feedbackBox) return;
    feedbackBox.classList.remove('hidden', 'sending', 'success', 'error');
    feedbackBox.classList.add(state);
    if (feedbackTitle) feedbackTitle.textContent = title;
    if (feedbackDesc) feedbackDesc.textContent = desc;
  }

  function clearErrorFeedback() {
    setStatus('');
    if (feedbackBox && feedbackBox.classList.contains('error')) {
      feedbackBox.classList.add('hidden');
      feedbackBox.classList.remove('error');
    }
  }

  function setupEventListeners() {
    projectTitle.addEventListener('input', () => {
      clearSentPreviewHighlight();
      clearErrorFeedback();
      titleCharCount.textContent = `${projectTitle.value.length}/80`;
      scheduleLivePreviewRender();
    });

    projectDescription.addEventListener('input', () => {
      clearSentPreviewHighlight();
      clearErrorFeedback();
      descCharCount.textContent = `${projectDescription.value.length}/500`;
      scheduleLivePreviewRender();
    });

    projectAuthor.addEventListener('input', () => {
      clearSentPreviewHighlight();
      clearErrorFeedback();
      authorCharCount.textContent = `${projectAuthor.value.length}/35`;
      scheduleLivePreviewRender();
    });

    if (btnChooseImage && projectImage) {
      btnChooseImage.addEventListener('click', () => {
        projectImage.click();
      });
      projectImage.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        handleImageSelected(file);
      });
    }

    if (btnClearImage) {
      btnClearImage.addEventListener('click', () => {
        clearSentPreviewHighlight();
        clearErrorFeedback();
        clearAttachedImage();
      });
    }

    if (imgBrightness) {
      imgBrightness.addEventListener('input', () => {
        clearSentPreviewHighlight();
        imageEdit.brightness = parseInt(imgBrightness.value, 10) || 0;
        syncImageEditControlsUI();
        scheduleLivePreviewRender();
      });
    }

    if (imgContrast) {
      imgContrast.addEventListener('input', () => {
        clearSentPreviewHighlight();
        imageEdit.contrast = parseFloat(imgContrast.value) || 1.0;
        syncImageEditControlsUI();
        scheduleLivePreviewRender();
      });
    }

    if (btnImgRotate) {
      btnImgRotate.addEventListener('click', () => {
        clearSentPreviewHighlight();
        imageEdit.rotate = ((imageEdit.rotate || 0) + 90) % 360;
        syncImageEditControlsUI();
        renderLivePreviewCanvas();
      });
    }

    if (btnImgMode) {
      btnImgMode.addEventListener('click', () => {
        clearSentPreviewHighlight();
        imageEdit.mode = imageEdit.mode === 'dither' ? 'threshold' : 'dither';
        syncImageEditControlsUI();
        renderLivePreviewCanvas();
      });
    }

    if (btnImgInvert) {
      btnImgInvert.addEventListener('click', () => {
        clearSentPreviewHighlight();
        imageEdit.invert = !imageEdit.invert;
        syncImageEditControlsUI();
        renderLivePreviewCanvas();
      });
    }

    if (btnImgReset) {
      btnImgReset.addEventListener('click', () => {
        clearSentPreviewHighlight();
        resetImageEditDefaults();
        renderLivePreviewCanvas();
      });
    }

    form.addEventListener('submit', handleSubmit);
  }

  async function fetchJsonWithTimeout(url, timeoutMs = 2500) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  function normalizeGeoPayload(raw) {
    if (!raw) return null;
    const latNum = parseFloat(raw.latitude ?? raw.lat);
    const lonNum = parseFloat(raw.longitude ?? raw.lon);
    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) return null;

    const city = String(raw.city || '').trim();
    const region = String(raw.region || raw.region_name || '').trim();
    const country = String(raw.country_code || raw.country || '').trim();
    const label = [city, region, country].filter(Boolean).join(', ') || `${latNum.toFixed(2)}, ${lonNum.toFixed(2)}`;

    return {
      label,
      city,
      region,
      country,
      lat: Math.round(latNum * 100) / 100,
      lon: Math.round(lonNum * 100) / 100
    };
  }

  /**
   * Resolves rough city-level IP coordinates (~1 km rounded) without prompting for GPS.
   * Never stores or transmits raw IP addresses.
   */
  async function resolveRoughLocation() {
    if (cachedRoughLocation) return cachedRoughLocation;
    const primary = await fetchJsonWithTimeout('https://get.geojs.io/v1/ip/geo.json', 2500);
    let parsed = normalizeGeoPayload(primary);
    if (!parsed) {
      const fallback = await fetchJsonWithTimeout('https://ipwho.is/', 2500);
      parsed = normalizeGeoPayload(fallback);
    }
    if (parsed) cachedRoughLocation = parsed;
    return parsed;
  }

  async function getRoughLocationForSubmit() {
    if (cachedRoughLocation) return cachedRoughLocation;
    if (!geoLookupPromise) geoLookupPromise = resolveRoughLocation();
    return await Promise.race([
      geoLookupPromise,
      new Promise(resolve => setTimeout(() => resolve(cachedRoughLocation), 1200))
    ]);
  }

  async function fetchRemoteQuotaState() {
    try {
      const res = await fetch(`${PUBLIC_API}/state?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (typeof data.postponeUntil === 'number') postponeUntil = data.postponeUntil;
        if (typeof data.total === 'number') {
          globalTotalPrints = Math.min(GLOBAL_MAX, Math.max(0, data.total));
          globalPrintsRemaining = Math.max(0, GLOBAL_MAX - globalTotalPrints);
        }
      }
    } catch (ignored) {}
    syncUIQuotaState();
  }

  function isCurrentlyPostponed() {
    if (postponeUntil === -1) return true;
    if (postponeUntil > 0 && Date.now() < postponeUntil) return true;
    return false;
  }

  async function verifyPrintDelivery(quoteId, num, title) {
    if (!quoteId) return;
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const res = await fetch(`${PUBLIC_API}/status?id=${encodeURIComponent(quoteId)}&t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) continue;
        const st = await res.json();
        if (st.status === 'printed') {
          showFeedback('success', `? Idea #${num} / ${GLOBAL_MAX} Printed on Noah's Desk!`, `Confirmed: your label ("${title}") just finished physically printing out.`);
          return true;
        }
        if (st.status === 'failed') {
          showFeedback('success', `? Idea #${num} / ${GLOBAL_MAX} Received & Saved`, `Your idea went through and is safely saved (#${num} / ${GLOBAL_MAX}). The printer is currently asleep and will print it when it wakes up.`);
          return false;
        }
      } catch (ignored) {}
    }
    showFeedback('success', `? Idea #${num} / ${GLOBAL_MAX} Received & Saved in Queue`, `Your message went through and is saved (#${num} / ${GLOBAL_MAX}). It is queued and will print as soon as the desk printer connects.`);
    return false;
  }

  function getNextPrintNumber() {
    return Math.min(GLOBAL_MAX, globalTotalPrints + 1);
  }

  function syncUIQuotaState() {
    globalPrintsRemaining = Math.max(0, GLOBAL_MAX - globalTotalPrints);

    if (globalQuotaText) {
      globalQuotaText.textContent = `${globalTotalPrints}/${GLOBAL_MAX} printed`;
    }
    renderLivePreviewCanvas();

    if (globalPrintsRemaining <= 0) {
      disableFormInputs('400/400 limit reached');
    } else if (!btnSubmitIdea.classList.contains('success-state')) {
      enableFormInputs();
    }
  }

  function disableFormInputs(label) {
    projectTitle.disabled = true;
    projectDescription.disabled = true;
    projectAuthor.disabled = true;
    if (projectImage) projectImage.disabled = true;
    if (btnChooseImage) btnChooseImage.disabled = true;
    if (btnClearImage) btnClearImage.disabled = true;
    btnSubmitIdea.disabled = true;
    btnSubmitIdea.textContent = label;
  }

  function enableFormInputs() {
    projectTitle.disabled = false;
    projectDescription.disabled = false;
    projectAuthor.disabled = false;
    if (projectImage) projectImage.disabled = false;
    if (btnChooseImage) btnChooseImage.disabled = false;
    if (btnClearImage) btnClearImage.disabled = false;
    btnSubmitIdea.disabled = false;
    btnSubmitIdea.textContent = 'Print';
  }

  function getFormattedTimestamp() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d} ${hh}:${mm}`;
  }

  function updateLiveTimestamp() {
    renderLivePreviewCanvas();
  }

  function setStatus(msg, isError = false) {
    if (!statusMsg) return;
    statusMsg.textContent = msg;
    statusMsg.classList.toggle('error', isError);
  }

  function wrapCanvasText(ctx, text, maxWidth) {
    const lines = [];
    const paragraphs = String(text || '').replace(/\r\n/g, '\n').split('\n');

    for (const para of paragraphs) {
      if (para.trim() === '') {
        lines.push('');
        continue;
      }
      const words = para.split(/\s+/);
      let currentLine = '';

      for (const word of words) {
        if (ctx.measureText(word).width > maxWidth) {
          if (currentLine) {
            lines.push(currentLine);
            currentLine = '';
          }
          let chunk = '';
          for (const ch of word) {
            const testChunk = chunk + ch;
            if (ctx.measureText(testChunk).width > maxWidth && chunk) {
              lines.push(chunk);
              chunk = ch;
            } else {
              chunk = testChunk;
            }
          }
          currentLine = chunk;
          continue;
        }

        const testLine = currentLine ? `${currentLine} ${word}` : word;
        if (ctx.measureText(testLine).width > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) {
        lines.push(currentLine);
      }
    }
    return lines;
  }

  /**
   * Renders the exact 800x1200 (203 DPI 4x6") 1-bit monochrome thermal printhead label onto any canvas.
   * Used identically for both the live 1:1 preview and the actual bitmap sent to the printer.
   */
  function renderLabelToCanvas(canvas, title, description, handle, timeStr, printNum, imageEl = null, editOpts = {}) {
    const W = 800;
    const H = 1200;
    const PAD = imageEl ? 36 : 48;
    const CONTENT_W = W - PAD * 2;

    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    // 1. Title
    ctx.font = '600 43px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const titleLines = wrapCanvasText(ctx, title, CONTENT_W);
    let curY = PAD;
    for (const line of titleLines) {
      ctx.fillText(line, PAD, curY);
      curY += 56;
    }

    // Top divider
    curY += 18;
    ctx.fillRect(PAD, curY, CONTENT_W, 2);
    curY += 28;

    // 2. Description & details
    ctx.font = '400 33px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const descLines = wrapCanvasText(ctx, description, CONTENT_W);
    const maxDescY = imageEl ? 640 : 990;
    for (const line of descLines) {
      if (curY + 48 > maxDescY) break;
      if (line !== '') {
        ctx.fillText(line, PAD, curY);
      }
      curY += 48;
    }

    // Optional native-dot 1:1 dithered image (aspect ratio preserved, zero stretching)
    if (imageEl) {
      const imgTopY = curY + 14;
      const maxImgBottom = 1020;
      const availH = maxImgBottom - imgTopY;
      const rawW = imageEl.naturalWidth || imageEl.width || 1;
      const rawH = imageEl.naturalHeight || imageEl.height || 1;
      const rot = (((editOpts.rotate || 0) % 360) + 360) % 360;
      const swap = rot === 90 || rot === 270;
      const srcW = swap ? rawH : rawW;
      const srcH = swap ? rawW : rawH;
      if (availH >= 80 && srcW > 0 && srcH > 0) {
        const scale = Math.min(CONTENT_W / srcW, availH / srcH);
        const drawW = Math.max(16, Math.round(srcW * scale));
        const drawH = Math.max(16, Math.round(srcH * scale));
        const drawX = PAD + Math.round((CONTENT_W - drawW) / 2);
        const drawY = imgTopY + Math.round((availH - drawH) / 2);
        const ditheredCanvas = ditherImageToCanvas(imageEl, drawW, drawH, editOpts);
        ctx.drawImage(ditheredCanvas, drawX, drawY);
      }
    }

    // Bottom divider
    const footerDividerY = 1042;
    ctx.fillRect(PAD, footerDividerY, CONTENT_W, 2);

    // 3. Handle (bottom-left)
    ctx.font = '500 30px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(handle, PAD, 1072);

    // 4. Time (bottom-left, under handle)
    ctx.font = '400 25px "JetBrains Mono", monospace';
    ctx.fillText(timeStr, PAD, 1114);

    // 5. Print number out of 400 (bottom-right)
    ctx.font = '500 32px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`#${printNum} / ${GLOBAL_MAX}`, W - PAD, 1106);

    const imgData = ctx.getImageData(0, 0, W, H);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const v = lum < 175 ? 0 : 255;
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
      d[i + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  function renderLabelBitmap(title, description, handle, timeStr, printNum, imageEl = null, editOpts = {}) {
    const canvas = document.createElement('canvas');
    renderLabelToCanvas(canvas, title, description, handle, timeStr, printNum, imageEl, editOpts);
    return canvas.toDataURL('image/png');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (isSubmitting) return;

    const titleVal = projectTitle.value.trim();
    const descVal = projectDescription.value.trim();
    const authorVal = projectAuthor.value.trim() || 'Anonymous';

    if (titleVal.length < 2) {
      setStatus('Enter a title.', true);
      projectTitle.focus();
      return;
    }
    if (descVal.length < 3) {
      setStatus('Enter a description.', true);
      projectDescription.focus();
      return;
    }

    const filterResult = checkSubmissionProfanity({
      title: titleVal,
      description: descVal,
      author: authorVal
    });
    if (!filterResult.clean) {
      setStatus(filterResult.message, true);
      showFeedback('error', 'Message Blocked by Content Filter', filterResult.message);
      if (filterResult.field === 'title') projectTitle.focus();
      else if (filterResult.field === 'description') projectDescription.focus();
      else if (filterResult.field === 'author') projectAuthor.focus();
      return;
    }

    const submittedImgEl = attachedImageEl;
    const submittedImgThumb = attachedImageThumb;
    const submittedImgEdit = { ...imageEdit };

    isSubmitting = true;
    btnSubmitIdea.disabled = true;
    btnSubmitIdea.textContent = 'Sending to printer...';
    setStatus('');
    showFeedback('sending', 'Sending your idea...', 'Saving your message to Noah\'s printer queue...');

    if (submittedImgEl) {
      const reviewResult = await (attachedImageReviewPromise || moderateImage(submittedImgEl, WORKER_BASE_URL));
      if (!reviewResult.allowed) {
        isSubmitting = false;
        syncUIQuotaState();
        const msg = reviewResult.reason || 'This image cannot be printed. Please choose a different image.';
        setStatus(msg, true);
        showFeedback('error', 'Image Not Allowed', msg);
        return;
      }
    }

    try {
      await fetchRemoteQuotaState();

      if (globalPrintsRemaining <= 0) {
        showFeedback('error', '400/400 Limit Reached', 'All 400 prints on this roll have been used.');
        return;
      }

      const printNum = getNextPrintNumber();
      const timeStr = getFormattedTimestamp();
      const postponed = isCurrentlyPostponed();
      const uid = 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
      const roughLocation = await getRoughLocationForSubmit();

      const payload = {
        uid,
        title: titleVal,
        description: descVal,
        author: authorVal,
        time: timeStr
      };
      if (roughLocation) {
        payload.location = roughLocation;
      }
      if (submittedImgThumb) {
        payload.imageThumb = submittedImgThumb;
        payload.imageEdit = submittedImgEdit;
      }
      if (!postponed) {
        payload.imageData = renderLabelBitmap(
          titleVal,
          descVal,
          authorVal,
          timeStr,
          printNum,
          submittedImgEl || null,
          submittedImgEdit
        );
        payload.speed = submittedImgEl ? 1.5 : 2.0;
        payload.density = 12;
      }

      const submitRes = await fetch(`${PUBLIC_API}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const submitData = await submitRes.json().catch(() => ({}));
      if (!submitRes.ok) {
        throw new Error(submitData.error || `Submission error ${submitRes.status}`);
      }

      const assignedNum = submitData.num || printNum;
      const actualStatus = submitData.status || (postponed ? 'postponed' : 'queued');
      globalTotalPrints = Math.min(GLOBAL_MAX, Math.max(globalTotalPrints, submitData.total || assignedNum));
      globalPrintsRemaining = Math.max(0, GLOBAL_MAX - globalTotalPrints);

      // Keep the user's submitted 1:1 card visible in the Preview canvas with a "Sent" highlight
      showingSentPreview = true;
      if (previewCanvas) {
        renderLabelToCanvas(
          previewCanvas,
          titleVal,
          descVal,
          authorVal,
          timeStr,
          assignedNum,
          submittedImgEl || null,
          submittedImgEdit
        );
      }
      if (previewHeaderLabel) {
        previewHeaderLabel.textContent = `Preview — Sent (#${assignedNum} / ${GLOBAL_MAX})`;
        previewHeaderLabel.classList.add('sent');
      }
      if (thermalPreviewCard) {
        thermalPreviewCard.classList.add('sent');
      }

      if (actualStatus !== 'postponed') {
        showFeedback(
          'success',
          `✓ Idea #${assignedNum} / ${GLOBAL_MAX} Sent & Saved!`,
          `Your message went through! Transmitting label to Noah's desk printer now...`
        );
        verifyPrintDelivery(submitData.quoteId, assignedNum, titleVal);
      } else {
        showFeedback(
          'success',
          `✓ Idea #${assignedNum} / ${GLOBAL_MAX} Received & Saved!`,
          `Your message went through and is safely queued (#${assignedNum} / ${GLOBAL_MAX}). It will print automatically when the sleep timer ends.`
        );
      }

      projectTitle.value = '';
      projectDescription.value = '';
      projectAuthor.value = '';
      titleCharCount.textContent = '0/80';
      descCharCount.textContent = '0/500';
      authorCharCount.textContent = '0/35';
      clearAttachedImage(false);

      // Show clear confirmation on the button for 2.5s so they know their click registered
      btnSubmitIdea.classList.add('success-state');
      btnSubmitIdea.disabled = true;
      btnSubmitIdea.textContent = `✓ Sent (#${assignedNum} / ${GLOBAL_MAX})`;
      syncUIQuotaState();

      setTimeout(() => {
        btnSubmitIdea.classList.remove('success-state');
        syncUIQuotaState();
      }, 2500);
    } catch (err) {
      showFeedback('error', 'Could not reach printer queue', err.message || 'Please try clicking Print again.');
    } finally {
      isSubmitting = false;
      if (!btnSubmitIdea.classList.contains('success-state')) {
        syncUIQuotaState();
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
