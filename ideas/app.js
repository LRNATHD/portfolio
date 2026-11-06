(function () {
  'use strict';

  const WORKER_BASE_URL = 'https://realtalk-printer-bridge.super-disk-489b.workers.dev';
  const STORAGE_TOKEN_KEY = 'idea_client_token_v1';
  const STORAGE_LOCAL_COUNT_KEY = 'idea_prints_used_v1';
  const GLOBAL_MAX = 400;
  const USER_MAX = 3;

  const SAMPLE_TITLE = 'Toaster that catapults toast onto your plate';
  const SAMPLE_DESC = "Finds your plate on the table and launches the toast right onto it when it's done.";

  let clientToken = getOrCreateClientToken();
  let userPrintsUsed = parseInt(localStorage.getItem(STORAGE_LOCAL_COUNT_KEY) || '0', 10);
  let userPrintsRemaining = Math.max(0, USER_MAX - userPrintsUsed);
  let globalPrintsRemaining = GLOBAL_MAX;
  let globalTotalPrints = 0;
  let isSubmitting = false;

  const form = document.getElementById('ideaForm');
  const projectTitle = document.getElementById('projectTitle');
  const projectDescription = document.getElementById('projectDescription');
  const projectAuthor = document.getElementById('projectAuthor');
  const titleCharCount = document.getElementById('titleCharCount');
  const descCharCount = document.getElementById('descCharCount');
  const authorCharCount = document.getElementById('authorCharCount');
  const btnSubmitIdea = document.getElementById('btnSubmitIdea');
  const statusMsg = document.getElementById('statusMsg');

  const globalQuotaText = document.getElementById('globalQuotaText');
  const userQuotaText = document.getElementById('userQuotaText');

  const previewTitle = document.getElementById('previewTitle');
  const previewDescription = document.getElementById('previewDescription');
  const previewAuthor = document.getElementById('previewAuthor');
  const previewTimestamp = document.getElementById('previewTimestamp');
  const previewNumber = document.getElementById('previewNumber');

  function init() {
    setupEventListeners();
    updateLiveTimestamp();
    syncUIQuotaState();
    fetchRemoteQuotaConfig();
    setInterval(updateLiveTimestamp, 15000);
  }

  function getOrCreateClientToken() {
    let token = localStorage.getItem(STORAGE_TOKEN_KEY);
    if (!token) {
      token = 'cl_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 10);
      try {
        localStorage.setItem(STORAGE_TOKEN_KEY, token);
      } catch (ignored) {}
    }
    return token;
  }

  function setupEventListeners() {
    projectTitle.addEventListener('input', () => {
      const val = projectTitle.value.trim();
      titleCharCount.textContent = `${projectTitle.value.length}/80`;
      previewTitle.textContent = val.length > 0 ? val : SAMPLE_TITLE;
    });

    projectDescription.addEventListener('input', () => {
      const val = projectDescription.value.trim();
      descCharCount.textContent = `${projectDescription.value.length}/500`;
      previewDescription.textContent = val.length > 0 ? val : SAMPLE_DESC;
    });

    projectAuthor.addEventListener('input', () => {
      const val = projectAuthor.value.trim();
      authorCharCount.textContent = `${projectAuthor.value.length}/35`;
      previewAuthor.textContent = val.length > 0 ? val : 'Anonymous';
    });

    form.addEventListener('submit', handleSubmit);
  }

  async function fetchRemoteQuotaConfig() {
    try {
      const res = await fetch(`${WORKER_BASE_URL}/api/ideas/config?clientId=${encodeURIComponent(clientToken)}&t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        if (typeof data.globalRemaining === 'number') {
          globalPrintsRemaining = data.globalRemaining;
          globalTotalPrints = typeof data.globalTotal === 'number'
            ? data.globalTotal
            : (GLOBAL_MAX - data.globalRemaining);
        }
        if (typeof data.userRemaining === 'number') {
          userPrintsRemaining = Math.min(userPrintsRemaining, data.userRemaining);
          userPrintsUsed = USER_MAX - userPrintsRemaining;
          localStorage.setItem(STORAGE_LOCAL_COUNT_KEY, userPrintsUsed.toString());
        }
        syncUIQuotaState();
      }
    } catch (ignored) {
      syncUIQuotaState();
    }
  }

  function getNextPrintNumber() {
    return Math.min(GLOBAL_MAX, globalTotalPrints + 1);
  }

  function syncUIQuotaState() {
    userPrintsRemaining = Math.max(0, USER_MAX - userPrintsUsed);
    const nextNum = getNextPrintNumber();

    if (userQuotaText) {
      userQuotaText.textContent = `${userPrintsRemaining}/${USER_MAX} prints left`;
    }
    if (globalQuotaText) {
      globalQuotaText.textContent = `${globalTotalPrints}/${GLOBAL_MAX} printed`;
    }
    if (previewNumber) {
      previewNumber.textContent = `#${nextNum} / ${GLOBAL_MAX}`;
    }

    if (globalPrintsRemaining <= 0) {
      disableFormInputs('400/400 limit reached');
    } else if (userPrintsRemaining <= 0) {
      disableFormInputs('0/3 prints left');
    } else {
      enableFormInputs();
    }
  }

  function disableFormInputs(label) {
    projectTitle.disabled = true;
    projectDescription.disabled = true;
    projectAuthor.disabled = true;
    btnSubmitIdea.disabled = true;
    btnSubmitIdea.textContent = label;
  }

  function enableFormInputs() {
    projectTitle.disabled = false;
    projectDescription.disabled = false;
    projectAuthor.disabled = false;
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
    if (!previewTimestamp) return;
    previewTimestamp.textContent = getFormattedTimestamp();
  }

  function setStatus(msg, isError = false) {
    if (!statusMsg) return;
    statusMsg.textContent = msg;
    statusMsg.classList.toggle('error', isError);
  }

  /**
   * Word-wraps text on a 2D canvas context, respecting explicit newlines
   * and breaking overly long single tokens if needed.
   */
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
        // If a single word is wider than maxWidth, slice it character by character
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
   * Renders the exact 5-field preview card onto an 800x1200 (203 DPI 4x6")
   * 1-bit monochrome bitmap in < 2ms so the printer outputs the exact preview
   * with zero extra headers, barcodes, or metadata.
   */
  function renderLabelBitmap(title, description, handle, timeStr, printNum) {
    const W = 800;
    const H = 1200;
    const PAD = 48;
    const CONTENT_W = W - PAD * 2;

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Pure white paper background
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
    curY += 20;
    ctx.fillRect(PAD, curY, CONTENT_W, 2);
    curY += 32;

    // 2. Description & details
    ctx.font = '400 33px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const descLines = wrapCanvasText(ctx, description, CONTENT_W);
    const maxDescY = 990;
    for (const line of descLines) {
      if (curY + 48 > maxDescY) break;
      if (line !== '') {
        ctx.fillText(line, PAD, curY);
      }
      curY += 50;
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

    // Strict 1-bit monochrome threshold for crisp thermal dots & fast empty-band skipping
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

    return canvas.toDataURL('image/png');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (isSubmitting) return;

    if (userPrintsRemaining <= 0) {
      setStatus('You have used all 3 prints.', true);
      return;
    }
    if (globalPrintsRemaining <= 0) {
      setStatus('400 print limit reached.', true);
      return;
    }

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

    isSubmitting = true;
    btnSubmitIdea.disabled = true;
    btnSubmitIdea.textContent = 'Printing...';
    setStatus('');

    const printNum = getNextPrintNumber();
    const timeStr = getFormattedTimestamp();
    const labelImageData = renderLabelBitmap(titleVal, descVal, authorVal, timeStr, printNum);

    try {
      let res = await fetch(`${WORKER_BASE_URL}/api/ideas/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: titleVal,
          description: descVal,
          author: authorVal,
          printNumber: printNum,
          imageData: labelImageData,
          clientId: clientToken
        })
      });

      if (res.status === 404) {
        res = await fetch(`${WORKER_BASE_URL}/api/quote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'idea',
            text: `${titleVal} - ${descVal}`,
            author: authorVal,
            imageData: labelImageData,
            speed: 2.0,
            density: 12
          })
        });
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Error ${res.status}`);
      }

      const result = await res.json();

      userPrintsUsed++;
      localStorage.setItem(STORAGE_LOCAL_COUNT_KEY, userPrintsUsed.toString());

      if (typeof result.userRemaining === 'number') {
        userPrintsRemaining = result.userRemaining;
      } else {
        userPrintsRemaining = Math.max(0, USER_MAX - userPrintsUsed);
      }

      if (typeof result.globalTotal === 'number') {
        globalTotalPrints = result.globalTotal;
        globalPrintsRemaining = Math.max(0, GLOBAL_MAX - globalTotalPrints);
      } else {
        globalTotalPrints = Math.min(GLOBAL_MAX, globalTotalPrints + 1);
        globalPrintsRemaining = Math.max(0, GLOBAL_MAX - globalTotalPrints);
      }

      const printedNum = result.printNumber || globalTotalPrints;
      syncUIQuotaState();
      setStatus(`Sent to printer (#${printedNum} / ${GLOBAL_MAX}).`);

      projectTitle.value = '';
      projectDescription.value = '';
      projectAuthor.value = '';
      titleCharCount.textContent = '0/80';
      descCharCount.textContent = '0/500';
      authorCharCount.textContent = '0/35';
      previewTitle.textContent = SAMPLE_TITLE;
      previewDescription.textContent = SAMPLE_DESC;
      previewAuthor.textContent = 'Anonymous';
    } catch (err) {
      setStatus(err.message || 'Failed to send.', true);
    } finally {
      isSubmitting = false;
      syncUIQuotaState();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
