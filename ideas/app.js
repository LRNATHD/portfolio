import { checkSubmissionProfanity } from './profanityFilter.js';
import { moderateImage } from './imageModeration.js';

(function () {
  'use strict';

  const WORKER_BASE_URL = 'https://realtalk-printer-bridge.super-disk-489b.workers.dev';
  const KV_STATE_ID = 'q_munqdvq7j3od';
  const KV_AUTH = 'noah-realtalk-secret-change-me';
  const STORAGE_ADMIN_KEY = 'idea_admin_hash_v1';
  const ADMIN_SHA256 = '5f1f508821ed53e6cf4d387514c8a904ca53dcbda1a25b14533a96c8b641f113';
  const GLOBAL_MAX = 400;

  const SAMPLE_TITLE = 'Project title';
  const SAMPLE_DESC = 'Write a short description of your project idea...';

  let globalTotalPrints = 0;
  let globalPrintsRemaining = GLOBAL_MAX;
  let savedItems = [];
  let postponeUntil = 0; // 0 = immediate, -1 = hold indefinitely, >0 = epoch ms
  let isSubmitting = false;
  let isFlushing = false;
  let showingSentPreview = false;

  // Uploaded image state (1 max)
  let attachedImageEl = null;
  let attachedImageThumb = null;
  let attachedImageReviewPromise = null;
  let imageEdit = { brightness: 0, contrast: 1.1, mode: 'dither', invert: false, rotate: 0 };
  const fullResPrintImages = new Map(); // uid -> HTMLImageElement (in-memory for current session)

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

  // Admin DOM
  const adminSection = document.getElementById('adminSection');
  const postponeStateLabel = document.getElementById('postponeStateLabel');
  const postponeInput = document.getElementById('postponeInput');
  const btnSetPostpone = document.getElementById('btnSetPostpone');
  const btnSleep9am = document.getElementById('btnSleep9am');
  const btnSleep8h = document.getElementById('btnSleep8h');
  const btnHoldIndef = document.getElementById('btnHoldIndef');
  const btnResumeNow = document.getElementById('btnResumeNow');
  const archiveCountTitle = document.getElementById('archiveCountTitle');
  const archiveList = document.getElementById('archiveList');
  const btnClearQueue = document.getElementById('btnClearQueue');
  const btnPrintUnprinted = document.getElementById('btnPrintUnprinted');
  const btnExportJson = document.getElementById('btnExportJson');
  const adminMapEl = document.getElementById('adminMap');
  const mapStatsLabel = document.getElementById('mapStatsLabel');
  const mapSelectedMeta = document.getElementById('mapSelectedMeta');
  const btnFitMap = document.getElementById('btnFitMap');

  let cachedRoughLocation = null;
  let geoLookupPromise = null;
  let leafletLib = null;
  let adminMap = null;
  let adminMapLayer = null;
  let mapMarkersByKey = new Map();
  let mapHasAutoFitted = false;
  let lastRenderedGeoSig = '';
  let selectedMapKey = null;

  function init() {
    setupEventListeners();
    initAdminAccess();
    syncUIQuotaState();
    renderLivePreviewCanvas();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => renderLivePreviewCanvas());
    }
    geoLookupPromise = resolveRoughLocation();
    fetchRemoteQuotaState().then(() => {
      checkAndFlushPostponed();
      syncUnconfirmedQuoteStatuses();
    });
    setInterval(updateLiveTimestamp, 15000);
    setInterval(() => {
      if (document.hidden) return;
      const isAdminOpen = adminSection && !adminSection.classList.contains('hidden');
      const hasPendingWork = postponeUntil > 0 || savedItems.some(it => it.status === 'postponed' || it.status === 'queued');
      if (!isAdminOpen && !hasPendingWork) return;
      fetchRemoteQuotaState().then(() => {
        checkAndFlushPostponed();
        syncUnconfirmedQuoteStatuses();
      });
    }, 30000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        fetchRemoteQuotaState().then(() => {
          checkAndFlushPostponed();
          syncUnconfirmedQuoteStatuses();
        });
      }
    });
  }

  async function sha256Hex(str) {
    const buf = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async function initAdminAccess() {
    const host = window.location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1' || window.location.protocol === 'file:';
    const params = new URLSearchParams(window.location.search);
    const adminParam = params.get('admin');

    if (adminParam === 'off' || adminParam === 'logout') {
      try { localStorage.removeItem(STORAGE_ADMIN_KEY); } catch (e) {}
      adminSection.classList.add('hidden');
      try { window.history.replaceState({}, '', window.location.pathname); } catch (e) {}
      return;
    }

    if (adminParam) {
      const paramHash = await sha256Hex(adminParam);
      if (paramHash === ADMIN_SHA256) {
        try { localStorage.setItem(STORAGE_ADMIN_KEY, paramHash); } catch (e) {}
        adminSection.classList.remove('hidden');
        renderAdminUI();
      }
      try { window.history.replaceState({}, '', window.location.pathname); } catch (e) {}
      return;
    }

    const savedHash = localStorage.getItem(STORAGE_ADMIN_KEY);
    if (isLocal || savedHash === ADMIN_SHA256) {
      adminSection.classList.remove('hidden');
      renderAdminUI();
    }
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

    if (btnSetPostpone) {
      btnSetPostpone.addEventListener('click', async () => {
        if (!postponeInput.value) return;
        const ts = new Date(postponeInput.value).getTime();
        if (!isNaN(ts) && ts > Date.now()) {
          await updatePostponeSchedule(ts);
        } else {
          await updatePostponeSchedule(0);
        }
      });
    }

    if (btnSleep9am) {
      btnSleep9am.addEventListener('click', async () => {
        const d = new Date();
        if (d.getHours() >= 9) {
          d.setDate(d.getDate() + 1);
        }
        d.setHours(9, 0, 0, 0);
        await updatePostponeSchedule(d.getTime());
      });
    }

    if (btnSleep8h) {
      btnSleep8h.addEventListener('click', async () => {
        await updatePostponeSchedule(Date.now() + 8 * 3600 * 1000);
      });
    }

    if (btnHoldIndef) {
      btnHoldIndef.addEventListener('click', async () => {
        await updatePostponeSchedule(-1);
      });
    }

    if (btnResumeNow) {
      btnResumeNow.addEventListener('click', async () => {
        await updatePostponeSchedule(0);
        await flushAllPostponedNow();
      });
    }

    if (btnClearQueue) {
      btnClearQueue.addEventListener('click', async () => {
        btnClearQueue.disabled = true;
        btnClearQueue.textContent = 'Clearing...';
        try {
          await fetchRemoteQuotaState();
          const nowTs = Date.now();
          for (const item of savedItems) {
            if (item.status !== 'printed') {
              if (item.quoteId) {
                fetch(`${WORKER_BASE_URL}/api/quote/ack?secret=${encodeURIComponent(KV_AUTH)}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ id: item.quoteId, status: 'printed' })
                }).catch(() => {});
              }
              item.status = 'printed';
              item.statusUpdatedAt = nowTs;
              delete item.error;
            }
          }
          fetch(`${WORKER_BASE_URL}/api/queue/clear?secret=${encodeURIComponent(KV_AUTH)}`, {
            method: 'POST'
          }).catch(() => {});
          await persistRemoteState();
          renderAdminUI();
        } catch (e) {
          console.error(e);
        } finally {
          btnClearQueue.disabled = false;
          btnClearQueue.textContent = 'Clear queue';
        }
      });
    }

    if (btnPrintUnprinted) {
      btnPrintUnprinted.addEventListener('click', async () => {
        btnPrintUnprinted.disabled = true;
        btnPrintUnprinted.textContent = 'Printing...';
        try {
          await fetchRemoteQuotaState();
          await syncUnconfirmedQuoteStatuses();
          const toPrint = savedItems.filter(it => it.status !== 'printed');
          for (const item of toPrint) {
            await sendItemToPrinter(item);
            item.status = 'printed';
          }
          if (toPrint.length > 0) {
            await persistRemoteState();
          }
          renderAdminUI();
        } catch (e) {
          console.error(e);
        } finally {
          btnPrintUnprinted.disabled = false;
          btnPrintUnprinted.textContent = 'Print unprinted';
        }
      });
    }

    if (btnExportJson) {
      btnExportJson.addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(savedItems, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ideas-backup-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
      });
    }

    if (btnFitMap) {
      btnFitMap.addEventListener('click', () => {
        fitAllMapPins();
      });
    }
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

  function getItemKey(item) {
    if (item.uid) return item.uid;
    return `${item.title || ''}|${(item.description || '').slice(0, 40)}|${item.author || ''}|${item.time || ''}`;
  }

  /**
   * Merges local and remote saved items without ever dropping any submission,
   * even if two visitors submit from different Cloudflare edge locations within 60s.
   */
  function mergeSavedItems(existingList, incomingList) {
    const map = new Map();
    const statusPriority = { printed: 4, queued: 3, postponed: 2, failed: 1 };

    for (const item of [...existingList, ...incomingList]) {
      if (!item || !item.title) continue;
      const key = getItemKey(item);
      if (!map.has(key)) {
        map.set(key, { ...item });
      } else {
        const prev = map.get(key);
        const prevTs = prev.statusUpdatedAt || 0;
        const nextTs = item.statusUpdatedAt || 0;
        let chosenStatus;
        let chosenError;
        if (nextTs !== prevTs) {
          const newer = nextTs > prevTs ? item : prev;
          chosenStatus = newer.status;
          chosenError = newer.error;
        } else {
          const prevPrio = statusPriority[prev.status] || 0;
          const nextPrio = statusPriority[item.status] || 0;
          const winner = nextPrio >= prevPrio ? item : prev;
          chosenStatus = winner.status;
          chosenError = winner.error;
        }
        const mergedItem = {
          ...prev,
          ...item,
          quoteId: item.quoteId || prev.quoteId,
          location: item.location || prev.location,
          imageThumb: item.imageThumb || prev.imageThumb,
          imageEdit: item.imageEdit || prev.imageEdit,
          statusUpdatedAt: Math.max(prevTs, nextTs),
          status: chosenStatus
        };
        if (chosenStatus === 'printed' || !chosenError) {
          delete mergedItem.error;
        } else {
          mergedItem.error = chosenError;
        }
        map.set(key, mergedItem);
      }
    }

    const merged = Array.from(map.values());
    merged.sort((a, b) => (a.num || 9999) - (b.num || 9999));

    // Ensure strictly unique sequential numbers 1..N so concurrent submits never collide
    const usedNums = new Set();
    let maxNum = 0;
    for (const it of merged) {
      if (typeof it.num === 'number' && it.num > 0 && !usedNums.has(it.num)) {
        usedNums.add(it.num);
        if (it.num > maxNum) maxNum = it.num;
      } else {
        maxNum++;
        while (usedNums.has(maxNum)) maxNum++;
        it.num = maxNum;
        usedNums.add(maxNum);
      }
    }

    return merged;
  }

  async function fetchRemoteQuotaState() {
    try {
      const res = await fetch(`${WORKER_BASE_URL}/api/quote/status?id=${KV_STATE_ID}&t=${Date.now()}`, {
        cache: 'no-store'
      });
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data.error === 'string' && data.error.startsWith('{')) {
          const parsed = JSON.parse(data.error);
          if (typeof parsed.postponeUntil === 'number') {
            postponeUntil = parsed.postponeUntil;
          }
          if (Array.isArray(parsed.items)) {
            savedItems = mergeSavedItems(savedItems, parsed.items);
          }
          const highestItemNum = savedItems.reduce((acc, it) => Math.max(acc, it.num || 0), 0);
          const remoteTotal = typeof parsed.total === 'number' ? parsed.total : 0;
          globalTotalPrints = Math.max(globalTotalPrints, remoteTotal, highestItemNum, savedItems.length);
          globalTotalPrints = Math.min(GLOBAL_MAX, globalTotalPrints);
          globalPrintsRemaining = Math.max(0, GLOBAL_MAX - globalTotalPrints);
        }
      }
    } catch (ignored) {}
    syncUIQuotaState();
    renderAdminUI();
  }

  async function persistRemoteState() {
    // Re-fetch and merge right before writing to minimize cross-datacenter race window
    try {
      const res = await fetch(`${WORKER_BASE_URL}/api/quote/status?id=${KV_STATE_ID}&t=${Date.now()}`, {
        cache: 'no-store'
      });
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data.error === 'string' && data.error.startsWith('{')) {
          const parsed = JSON.parse(data.error);
          if (Array.isArray(parsed.items)) {
            savedItems = mergeSavedItems(parsed.items, savedItems);
          }
          const highestItemNum = savedItems.reduce((acc, it) => Math.max(acc, it.num || 0), 0);
          globalTotalPrints = Math.max(globalTotalPrints, parsed.total || 0, highestItemNum, savedItems.length);
        }
      }
    } catch (ignored) {}

    const statePayload = JSON.stringify({
      total: globalTotalPrints,
      postponeUntil,
      items: savedItems
    });

    await fetch(`${WORKER_BASE_URL}/api/quote/ack?secret=${encodeURIComponent(KV_AUTH)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: KV_STATE_ID,
        status: 'printed',
        error: statePayload
      })
    });
  }

  async function syncUnconfirmedQuoteStatuses() {
    let changed = false;
    for (const item of savedItems) {
      if (!item.quoteId || item.status === 'printed' || item.status === 'postponed') continue;
      try {
        const res = await fetch(`${WORKER_BASE_URL}/api/quote/status?id=${encodeURIComponent(item.quoteId)}&t=${Date.now()}`, {
          cache: 'no-store'
        });
        if (res.ok) {
          const st = await res.json();
          if (st.status === 'printed' && item.status !== 'printed') {
            item.status = 'printed';
            item.statusUpdatedAt = Date.now();
            delete item.error;
            changed = true;
          } else if (st.status === 'failed' && item.status !== 'failed') {
            item.status = 'failed';
            item.error = st.error || 'Printer disconnected';
            changed = true;
          }
        }
      } catch (ignored) {}
    }
    if (changed) {
      await persistRemoteState();
      renderAdminUI();
    }
  }

  async function updatePostponeSchedule(newPostponeUntil) {
    await fetchRemoteQuotaState();
    postponeUntil = newPostponeUntil;
    await persistRemoteState();
    renderAdminUI();
  }

  function isCurrentlyPostponed() {
    if (postponeUntil === -1) return true;
    if (postponeUntil > 0 && Date.now() < postponeUntil) return true;
    return false;
  }

  async function checkAndFlushPostponed() {
    if (isFlushing) return;
    if (postponeUntil === -1) return;
    if (postponeUntil > 0 && Date.now() < postponeUntil) return;

    const held = savedItems.filter(it => it.status === 'postponed');
    if (held.length === 0) {
      if (postponeUntil > 0 && Date.now() >= postponeUntil) {
        postponeUntil = 0;
        await persistRemoteState();
        renderAdminUI();
      }
      return;
    }

    await flushAllPostponedNow();
  }

  async function flushAllPostponedNow() {
    if (isFlushing) return;
    isFlushing = true;
    try {
      await fetchRemoteQuotaState();
      const held = savedItems.filter(it => it.status === 'postponed');
      if (held.length === 0) {
        postponeUntil = 0;
        await persistRemoteState();
        renderAdminUI();
        return;
      }

      postponeUntil = 0;
      for (const item of held) {
        await sendItemToPrinter(item);
        item.status = 'queued';
      }
      await persistRemoteState();
      renderAdminUI();
    } catch (e) {
      console.error('Flush error:', e);
    } finally {
      isFlushing = false;
      renderAdminUI();
    }
  }

  async function sendItemToPrinter(item) {
    let imgEl = (item.uid && fullResPrintImages.get(item.uid)) || null;
    if (!imgEl && item.imageThumb) {
      try {
        imgEl = await loadImageFromSrc(item.imageThumb);
      } catch (e) {
        imgEl = null;
      }
    }
    const bmp = renderLabelBitmap(item.title, item.description, item.author, item.time, item.num, imgEl, item.imageEdit || {});
    const res = await fetch(`${WORKER_BASE_URL}/api/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'idea',
        text: `${item.title} - ${item.description}`,
        author: item.author,
        imageData: bmp,
        speed: imgEl ? 1.5 : 2.0,
        density: 12
      })
    });
    if (!res.ok) {
      throw new Error(`Printer queue error ${res.status}`);
    }
    const data = await res.json();
    if (data && data.id) {
      item.quoteId = data.id;
      savedItems = mergeSavedItems(savedItems, [item]);
    }
    return data.id;
  }

  /**
   * Polls the quote status for up to ~10s after submission.
   * If the phone bridge reports a transient Bluetooth connection failure,
   * automatically re-queues it once so the print is not lost.
   */
  async function verifyPrintDelivery(item) {
    if (!item.quoteId) return;
    let retried = false;

    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const res = await fetch(`${WORKER_BASE_URL}/api/quote/status?id=${encodeURIComponent(item.quoteId)}&t=${Date.now()}`, {
          cache: 'no-store'
        });
        if (!res.ok) continue;
        const st = await res.json();

        if (st.status === 'printed') {
          item.status = 'printed';
          item.statusUpdatedAt = Date.now();
          delete item.error;
          savedItems = mergeSavedItems(savedItems, [item]);
          await persistRemoteState();
          renderAdminUI();
          showFeedback(
            'success',
            `✓ Idea #${item.num} / ${GLOBAL_MAX} Printed on Noah's Desk!`,
            `Confirmed: your label ("${item.title}") just finished physically printing out.`
          );
          return true;
        }

        if (st.status === 'failed') {
          if (!retried) {
            retried = true;
            await sendItemToPrinter(item);
            await persistRemoteState();
            continue;
          } else {
            item.status = 'failed';
            item.statusUpdatedAt = Date.now();
            item.error = st.error || 'Printer offline';
            savedItems = mergeSavedItems(savedItems, [item]);
            await persistRemoteState();
            renderAdminUI();
            showFeedback(
              'success',
              `✓ Idea #${item.num} / ${GLOBAL_MAX} Received & Saved`,
              `Your idea went through and is safely saved (#${item.num} / ${GLOBAL_MAX}). The printer is currently asleep and will print it when it wakes up.`
            );
            return false;
          }
        }
      } catch (ignored) {}
    }

    // Still pending in queue (printer will pick it up on next poll or when online)
    savedItems = mergeSavedItems(savedItems, [item]);
    await persistRemoteState();
    renderAdminUI();
    showFeedback(
      'success',
      `✓ Idea #${item.num} / ${GLOBAL_MAX} Received & Saved in Queue`,
      `Your message went through and is saved (#${item.num} / ${GLOBAL_MAX}). It is queued and will print as soon as the desk printer connects.`
    );
    return false;
  }

  function renderAdminUI() {
    if (!adminSection || adminSection.classList.contains('hidden')) return;

    const heldCount = savedItems.filter(it => it.status === 'postponed').length;
    const unprintedCount = savedItems.filter(it => it.status !== 'printed').length;

    if (postponeUntil === -1) {
      postponeStateLabel.textContent = `Held indefinitely (${heldCount} postponed)`;
    } else if (postponeUntil > Date.now()) {
      const dt = new Date(postponeUntil);
      const timeStr = dt.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      postponeStateLabel.textContent = `Postponed until ${timeStr} (${heldCount} postponed)`;
    } else {
      postponeStateLabel.textContent = unprintedCount > 0
        ? `Printing immediately (${unprintedCount} unconfirmed/queued)`
        : 'Printing immediately';
    }

    if (archiveCountTitle) {
      archiveCountTitle.textContent = `Saved Prints (${savedItems.length})`;
    }

    if (!archiveList) return;
    archiveList.innerHTML = '';

    const sorted = [...savedItems].sort((a, b) => b.num - a.num);
    for (const item of sorted) {
      const row = document.createElement('div');
      row.className = 'archive-item';

      const info = document.createElement('div');
      info.className = 'archive-info';

      const top = document.createElement('div');
      top.className = 'archive-top';

      const numSpan = document.createElement('span');
      numSpan.className = 'archive-num';
      numSpan.textContent = `#${item.num}/400`;

      const titleSpan = document.createElement('span');
      titleSpan.className = 'archive-item-title';
      titleSpan.textContent = item.title;

      const badge = document.createElement('span');
      const isPendingOrFailed = item.status === 'postponed' || item.status === 'failed' || item.status === 'queued';
      badge.className = 'archive-badge' + (isPendingOrFailed ? ' held' : '');
      const statusText = item.error ? `[${item.status}: ${item.error}]` : `[${item.status || 'printed'}]`;
      badge.textContent = item.imageThumb ? `${statusText} [img]` : statusText;

      top.appendChild(numSpan);
      top.appendChild(titleSpan);
      top.appendChild(badge);

      const descDiv = document.createElement('div');
      descDiv.className = 'archive-item-desc';
      descDiv.textContent = item.description;

      const metaDiv = document.createElement('div');
      metaDiv.className = 'archive-meta';
      const hasGeo = item.location && Number.isFinite(item.location.lat) && Number.isFinite(item.location.lon);
      metaDiv.textContent = hasGeo
        ? `${item.author} · ${item.time} · ${item.location.label || `${item.location.lat}, ${item.location.lon}`}`
        : `${item.author} · ${item.time}`;

      info.appendChild(top);
      info.appendChild(descDiv);
      info.appendChild(metaDiv);

      const btns = document.createElement('div');
      btns.className = 'archive-btns';

      const btnPrev = document.createElement('button');
      btnPrev.type = 'button';
      btnPrev.className = 'admin-btn';
      btnPrev.textContent = 'Preview';
      btnPrev.addEventListener('click', async () => {
        let previewImgEl = (item.uid && fullResPrintImages.get(item.uid)) || null;
        if (!previewImgEl && item.imageThumb) {
          try {
            previewImgEl = await loadImageFromSrc(item.imageThumb);
          } catch (e) {
            previewImgEl = null;
          }
        }
        showingSentPreview = true;
        if (previewHeaderLabel) {
          previewHeaderLabel.textContent = `Preview (#${item.num} / ${GLOBAL_MAX})`;
          previewHeaderLabel.classList.remove('sent');
        }
        if (thermalPreviewCard) thermalPreviewCard.classList.remove('sent');
        if (previewCanvas) {
          renderLabelToCanvas(
            previewCanvas,
            item.title,
            item.description,
            item.author,
            item.time,
            item.num,
            previewImgEl,
            item.imageEdit || {}
          );
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });

      let btnMap = null;
      if (hasGeo) {
        btnMap = document.createElement('button');
        btnMap.type = 'button';
        btnMap.className = 'admin-btn';
        btnMap.textContent = 'Map';
        btnMap.addEventListener('click', () => {
          focusItemOnMap(item);
        });
      }

      if (item.status !== 'printed') {
        const btnDequeue = document.createElement('button');
        btnDequeue.type = 'button';
        btnDequeue.className = 'admin-btn';
        btnDequeue.textContent = 'Dequeue';
        btnDequeue.title = 'Remove from print queue and mark as already printed';
        btnDequeue.addEventListener('click', async () => {
          btnDequeue.disabled = true;
          btnDequeue.textContent = 'Removing...';
          try {
            if (item.quoteId) {
              fetch(`${WORKER_BASE_URL}/api/quote/ack?secret=${encodeURIComponent(KV_AUTH)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: item.quoteId, status: 'printed' })
              }).catch(() => {});
            }
            item.status = 'printed';
            item.statusUpdatedAt = Date.now();
            delete item.error;
            await persistRemoteState();
            renderAdminUI();
          } catch (e) {
            btnDequeue.disabled = false;
            btnDequeue.textContent = 'Dequeue';
          }
        });
        btns.appendChild(btnDequeue);
      }

      const btnPrint = document.createElement('button');
      btnPrint.type = 'button';
      btnPrint.className = 'admin-btn';
      btnPrint.textContent = item.status === 'printed' ? 'Reprint' : 'Print now';
      btnPrint.addEventListener('click', async () => {
        btnPrint.disabled = true;
        btnPrint.textContent = 'Sending...';
        try {
          await sendItemToPrinter(item);
          item.status = 'printed';
          item.statusUpdatedAt = Date.now();
          delete item.error;
          await persistRemoteState();
          btnPrint.textContent = 'Sent';
          setTimeout(() => renderAdminUI(), 1000);
        } catch (e) {
          btnPrint.textContent = 'Error';
          btnPrint.disabled = false;
        }
      });

      btns.appendChild(btnPrev);
      if (btnMap) btns.appendChild(btnMap);
      btns.appendChild(btnPrint);

      row.appendChild(info);
      row.appendChild(btns);
      archiveList.appendChild(row);
    }

    renderAdminMap();
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function ensureAdminMap() {
    if (!adminMapEl) return null;
    if (adminMap) {
      adminMap.invalidateSize();
      return adminMap;
    }

    const [LModule] = await Promise.all([
      import('leaflet'),
      import('leaflet/dist/leaflet.css')
    ]);
    leafletLib = LModule.default || LModule;

    adminMap = leafletLib.map(adminMapEl, {
      center: [25, -20],
      zoom: 2,
      minZoom: 2,
      maxZoom: 12,
      worldCopyJump: true,
      zoomControl: true
    });

    leafletLib.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=cb1_55ua_1_e9e08f4c90f2b40c085a2a17', {
      subdomains: 'abcd',
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap &copy; CARTO'
    }).addTo(adminMap);

    adminMapLayer = leafletLib.layerGroup().addTo(adminMap);
    return adminMap;
  }

  function fitAllMapPins() {
    if (!adminMap || !leafletLib) return;
    const pts = [];
    for (const entry of mapMarkersByKey.values()) {
      pts.push(entry.marker.getLatLng());
    }
    if (pts.length === 0) {
      adminMap.setView([25, -20], 2);
      return;
    }
    if (pts.length === 1) {
      adminMap.setView(pts[0], 8);
      return;
    }
    const bounds = leafletLib.latLngBounds(pts);
    adminMap.fitBounds(bounds, { padding: [36, 36], maxZoom: 10 });
  }

  function updateMarkerHighlight(activeKey) {
    selectedMapKey = activeKey;
    for (const [key, entry] of mapMarkersByKey.entries()) {
      const isSelected = key === activeKey;
      entry.marker.setStyle({
        color: '#000000',
        weight: 1.5,
        fillColor: isSelected ? '#4ade80' : '#e4e4e7',
        fillOpacity: 1,
        radius: isSelected ? 6.5 : 5
      });
      entry.circle.setStyle({
        color: isSelected ? '#4ade80' : '#71717a',
        fillColor: isSelected ? '#22c55e' : '#a1a1aa',
        fillOpacity: isSelected ? 0.14 : 0.06,
        weight: 1
      });
    }
  }

  function focusItemOnMap(item) {
    if (!item || !item.location) return;
    const key = getItemKey(item);
    if (adminMapEl) {
      adminMapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    renderAdminMap().then(() => {
      const entry = mapMarkersByKey.get(key);
      if (entry && adminMap) {
        updateMarkerHighlight(key);
        adminMap.setView(entry.marker.getLatLng(), Math.max(adminMap.getZoom(), 9), { animate: true });
        entry.marker.openPopup();
        if (mapSelectedMeta) {
          const loc = item.location;
          mapSelectedMeta.textContent = `#${item.num} · ${item.author} · ${loc.label} (~${loc.lat.toFixed(2)}, ${loc.lon.toFixed(2)})`;
        }
      }
    });
  }

  async function renderAdminMap() {
    if (!adminSection || adminSection.classList.contains('hidden') || !adminMapEl) return;

    const located = savedItems.filter(
      it => it.location && Number.isFinite(it.location.lat) && Number.isFinite(it.location.lon)
    );

    if (mapStatsLabel) {
      mapStatsLabel.textContent = located.length === 1
        ? '1 located print'
        : `${located.length} located prints`;
    }

    const sig = located.map(it => `${getItemKey(it)}@${it.location.lat},${it.location.lon}`).join('|');
    if (sig === lastRenderedGeoSig && adminMap) return;

    const map = await ensureAdminMap();
    if (!map || !adminMapLayer || !leafletLib) return;

    lastRenderedGeoSig = sig;
    adminMapLayer.clearLayers();
    mapMarkersByKey.clear();

    const coordCounts = new Map();

    for (const item of located) {
      const loc = item.location;
      const baseLat = loc.lat;
      const baseLon = loc.lon;
      const coordBucket = `${baseLat.toFixed(2)},${baseLon.toFixed(2)}`;
      const dupIndex = coordCounts.get(coordBucket) || 0;
      coordCounts.set(coordBucket, dupIndex + 1);

      // Slight visual spiral offset when multiple submissions share the same rough city coordinate
      let pinLat = baseLat;
      let pinLon = baseLon;
      if (dupIndex > 0) {
        const angle = dupIndex * 2.39996;
        const offsetDeg = 0.008 * Math.sqrt(dupIndex);
        pinLat = baseLat + Math.sin(angle) * offsetDeg;
        pinLon = baseLon + Math.cos(angle) * offsetDeg;
      }

      const key = getItemKey(item);
      const isSelected = key === selectedMapKey;

      const circle = leafletLib.circle([baseLat, baseLon], {
        radius: 8000,
        color: isSelected ? '#4ade80' : '#71717a',
        weight: 1,
        dashArray: '3 4',
        fillColor: isSelected ? '#22c55e' : '#a1a1aa',
        fillOpacity: isSelected ? 0.14 : 0.06,
        interactive: false
      }).addTo(adminMapLayer);

      const marker = leafletLib.circleMarker([pinLat, pinLon], {
        radius: isSelected ? 6.5 : 5,
        color: '#000000',
        weight: 1.5,
        fillColor: isSelected ? '#4ade80' : '#e4e4e7',
        fillOpacity: 1
      }).addTo(adminMapLayer);

      const popupHtml =
        `<div class="map-popup-num">#${item.num} / ${GLOBAL_MAX}</div>` +
        `<div class="map-popup-title">${escapeHtml(item.title)}</div>` +
        `<div class="map-popup-meta">${escapeHtml(item.author)} · ${escapeHtml(item.time)}<br/>${escapeHtml(loc.label)} (${baseLat.toFixed(2)}, ${baseLon.toFixed(2)})</div>`;

      marker.bindPopup(popupHtml);
      marker.on('click', () => {
        updateMarkerHighlight(key);
        if (mapSelectedMeta) {
          mapSelectedMeta.textContent = `#${item.num} · ${item.author} · ${loc.label} (~${baseLat.toFixed(2)}, ${baseLon.toFixed(2)})`;
        }
      });

      mapMarkersByKey.set(key, { marker, circle, item });
    }

    if (!mapHasAutoFitted && located.length > 0) {
      mapHasAutoFitted = true;
      fitAllMapPins();
    }
    setTimeout(() => {
      if (adminMap) adminMap.invalidateSize();
    }, 50);
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

      const itemRecord = {
        uid,
        num: printNum,
        title: titleVal,
        description: descVal,
        author: authorVal,
        time: timeStr,
        status: postponed ? 'postponed' : 'queued'
      };
      if (roughLocation) {
        itemRecord.location = roughLocation;
      }
      if (submittedImgThumb) {
        itemRecord.imageThumb = submittedImgThumb;
        itemRecord.imageEdit = submittedImgEdit;
        fullResPrintImages.set(uid, submittedImgEl);
      }

      // Save immediately to archive first so the idea is NEVER lost even if network/printer hiccups
      savedItems = mergeSavedItems(savedItems, [itemRecord]);
      globalTotalPrints = Math.max(globalTotalPrints, itemRecord.num, savedItems.length);
      globalPrintsRemaining = Math.max(0, GLOBAL_MAX - globalTotalPrints);
      await persistRemoteState();

      // Keep the user's submitted 1:1 card visible in the Preview canvas with a "Sent" highlight
      showingSentPreview = true;
      if (previewCanvas) {
        renderLabelToCanvas(
          previewCanvas,
          itemRecord.title,
          itemRecord.description,
          itemRecord.author,
          itemRecord.time,
          itemRecord.num,
          submittedImgEl || null,
          submittedImgEdit
        );
      }
      if (previewHeaderLabel) {
        previewHeaderLabel.textContent = `Preview — Sent (#${itemRecord.num} / ${GLOBAL_MAX})`;
        previewHeaderLabel.classList.add('sent');
      }
      if (thermalPreviewCard) {
        thermalPreviewCard.classList.add('sent');
      }

      if (!postponed) {
        showFeedback(
          'success',
          `✓ Idea #${itemRecord.num} / ${GLOBAL_MAX} Sent & Saved!`,
          `Your message went through! Transmitting label to Noah's desk printer now...`
        );
        await sendItemToPrinter(itemRecord);
        await persistRemoteState();
        // Verify delivery in background & auto-retry if Bluetooth wake-up failed on first attempt
        verifyPrintDelivery(itemRecord);
      } else {
        showFeedback(
          'success',
          `✓ Idea #${itemRecord.num} / ${GLOBAL_MAX} Received & Saved!`,
          `Your message went through and is safely queued (#${itemRecord.num} / ${GLOBAL_MAX}). It will print automatically when the sleep timer ends.`
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
      btnSubmitIdea.textContent = `✓ Sent (#${itemRecord.num} / ${GLOBAL_MAX})`;
      syncUIQuotaState();
      renderAdminUI();

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
