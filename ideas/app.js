(function () {
  'use strict';

  const WORKER_BASE_URL = 'https://realtalk-printer-bridge.super-disk-489b.workers.dev';
  const KV_STATE_ID = 'q_munqdvq7j3od';
  const KV_AUTH = 'noah-realtalk-secret-change-me';
  const STORAGE_TOKEN_KEY = 'idea_client_token_v1';
  const STORAGE_LOCAL_COUNT_KEY = 'idea_prints_used_v1';
  const STORAGE_ADMIN_KEY = 'idea_admin_unlocked_v1';
  const GLOBAL_MAX = 400;
  const USER_MAX = 3;

  const SAMPLE_TITLE = 'Toaster that catapults toast onto your plate';
  const SAMPLE_DESC = "Finds your plate on the table and launches the toast right onto it when it's done.";

  let clientToken = getOrCreateClientToken();
  let hwHash = getHardwareFingerprint();
  let userPrintsUsed = parseInt(localStorage.getItem(STORAGE_LOCAL_COUNT_KEY) || '0', 10);
  let userPrintsRemaining = Math.max(0, USER_MAX - userPrintsUsed);
  let globalTotalPrints = 0;
  let globalPrintsRemaining = GLOBAL_MAX;
  let remoteUsersMap = {};
  let savedItems = [];
  let postponeUntil = 0; // 0 = immediate, -1 = hold indefinitely, >0 = epoch ms
  let isSubmitting = false;
  let isFlushing = false;

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

  // Admin DOM
  const btnAdminToggle = document.getElementById('btnAdminToggle');
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
  const btnExportJson = document.getElementById('btnExportJson');

  function init() {
    setupEventListeners();
    initAdminAccess();
    updateLiveTimestamp();
    syncUIQuotaState();
    fetchRemoteQuotaState().then(() => {
      checkAndFlushPostponed();
    });
    setInterval(updateLiveTimestamp, 15000);
    setInterval(() => {
      fetchRemoteQuotaState().then(() => {
        checkAndFlushPostponed();
      });
    }, 25000);
  }

  function initAdminAccess() {
    const host = window.location.hostname;
    const params = new URLSearchParams(window.location.search);
    const isLocal = host === 'localhost' || host === '127.0.0.1' || window.location.protocol === 'file:';
    const hasKey = params.get('key') === 'noah-local-admin' || params.get('admin') === '1';
    const savedAdmin = localStorage.getItem(STORAGE_ADMIN_KEY) === '1';

    if (isLocal || hasKey || savedAdmin) {
      if (hasKey) {
        try { localStorage.setItem(STORAGE_ADMIN_KEY, '1'); } catch (e) {}
      }
      adminSection.classList.remove('hidden');
    }

    if (btnAdminToggle) {
      btnAdminToggle.addEventListener('click', () => {
        if (!adminSection.classList.contains('hidden')) {
          adminSection.classList.add('hidden');
          try { localStorage.removeItem(STORAGE_ADMIN_KEY); } catch (e) {}
          return;
        }
        const pin = prompt('Admin key:');
        if (pin === 'noah' || pin === 'noah-local-admin' || pin === KV_AUTH) {
          try { localStorage.setItem(STORAGE_ADMIN_KEY, '1'); } catch (e) {}
          adminSection.classList.remove('hidden');
          renderAdminUI();
        }
      });
    }
  }

  function getOrCreateClientToken() {
    let token = localStorage.getItem(STORAGE_TOKEN_KEY);
    if (!token) {
      token = 'u_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
      try {
        localStorage.setItem(STORAGE_TOKEN_KEY, token);
      } catch (ignored) {}
    }
    return token;
  }

  function getHardwareFingerprint() {
    try {
      let glRenderer = '';
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (gl) {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        if (dbg) {
          glRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '';
        }
      }
      const raw = [
        navigator.platform || '',
        screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
        navigator.hardwareConcurrency || '',
        navigator.deviceMemory || '',
        Intl.DateTimeFormat().resolvedOptions().timeZone || '',
        glRenderer
      ].join('|');

      let hash = 2166136261;
      for (let i = 0; i < raw.length; i++) {
        hash ^= raw.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return 'hw_' + (hash >>> 0).toString(36);
    } catch (e) {
      return 'hw_default';
    }
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
          if (typeof parsed.total === 'number') {
            globalTotalPrints = Math.max(0, Math.min(GLOBAL_MAX, parsed.total));
            globalPrintsRemaining = Math.max(0, GLOBAL_MAX - globalTotalPrints);
          }
          if (typeof parsed.postponeUntil === 'number') {
            postponeUntil = parsed.postponeUntil;
          }
          if (Array.isArray(parsed.items)) {
            savedItems = parsed.items;
          }
          if (parsed.users && typeof parsed.users === 'object') {
            remoteUsersMap = parsed.users;
            const remoteUsed = Math.max(
              remoteUsersMap[clientToken] || 0,
              remoteUsersMap[hwHash] || 0
            );
            if (remoteUsed > userPrintsUsed) {
              userPrintsUsed = remoteUsed;
              try {
                localStorage.setItem(STORAGE_LOCAL_COUNT_KEY, userPrintsUsed.toString());
              } catch (ignored) {}
            }
          }
        }
      }
    } catch (ignored) {}
    syncUIQuotaState();
    renderAdminUI();
  }

  async function persistRemoteState() {
    const statePayload = JSON.stringify({
      total: globalTotalPrints,
      postponeUntil,
      users: remoteUsersMap,
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

      // Mark as printed in KV first to prevent duplicate flushes
      for (const item of held) {
        item.status = 'printed';
      }
      postponeUntil = 0;
      await persistRemoteState();
      renderAdminUI();

      for (const item of held) {
        await sendItemToPrinter(item);
      }
    } catch (e) {
      console.error('Flush error:', e);
    } finally {
      isFlushing = false;
      renderAdminUI();
    }
  }

  async function sendItemToPrinter(item) {
    const bmp = renderLabelBitmap(item.title, item.description, item.author, item.time, item.num);
    const res = await fetch(`${WORKER_BASE_URL}/api/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'idea',
        text: `${item.title} - ${item.description}`,
        author: item.author,
        imageData: bmp,
        speed: 2.0,
        density: 12
      })
    });
    if (!res.ok) {
      throw new Error(`Printer queue error ${res.status}`);
    }
  }

  function renderAdminUI() {
    if (!adminSection || adminSection.classList.contains('hidden')) return;

    const heldCount = savedItems.filter(it => it.status === 'postponed').length;

    if (postponeUntil === -1) {
      postponeStateLabel.textContent = `Held indefinitely (${heldCount} queued)`;
    } else if (postponeUntil > Date.now()) {
      const dt = new Date(postponeUntil);
      const timeStr = dt.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      postponeStateLabel.textContent = `Postponed until ${timeStr} (${heldCount} queued)`;
    } else {
      postponeStateLabel.textContent = heldCount > 0
        ? `Ready to release (${heldCount} queued)`
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
      badge.className = 'archive-badge' + (item.status === 'postponed' ? ' held' : '');
      badge.textContent = `[${item.status || 'printed'}]`;

      top.appendChild(numSpan);
      top.appendChild(titleSpan);
      top.appendChild(badge);

      const descDiv = document.createElement('div');
      descDiv.className = 'archive-item-desc';
      descDiv.textContent = item.description;

      const metaDiv = document.createElement('div');
      metaDiv.className = 'archive-meta';
      metaDiv.textContent = `${item.author} · ${item.time}`;

      info.appendChild(top);
      info.appendChild(descDiv);
      info.appendChild(metaDiv);

      const btns = document.createElement('div');
      btns.className = 'archive-btns';

      const btnPrev = document.createElement('button');
      btnPrev.type = 'button';
      btnPrev.className = 'admin-btn';
      btnPrev.textContent = 'Preview';
      btnPrev.addEventListener('click', () => {
        previewTitle.textContent = item.title;
        previewDescription.textContent = item.description;
        previewAuthor.textContent = item.author;
        previewTimestamp.textContent = item.time;
        previewNumber.textContent = `#${item.num} / ${GLOBAL_MAX}`;
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });

      const btnPrint = document.createElement('button');
      btnPrint.type = 'button';
      btnPrint.className = 'admin-btn';
      btnPrint.textContent = item.status === 'postponed' ? 'Print now' : 'Reprint';
      btnPrint.addEventListener('click', async () => {
        btnPrint.disabled = true;
        btnPrint.textContent = 'Sending...';
        try {
          await sendItemToPrinter(item);
          if (item.status === 'postponed') {
            item.status = 'printed';
            await persistRemoteState();
          }
          btnPrint.textContent = 'Sent';
          setTimeout(() => renderAdminUI(), 1000);
        } catch (e) {
          btnPrint.textContent = 'Error';
          btnPrint.disabled = false;
        }
      });

      btns.appendChild(btnPrev);
      btns.appendChild(btnPrint);

      row.appendChild(info);
      row.appendChild(btns);
      archiveList.appendChild(row);
    }
  }

  function getNextPrintNumber() {
    return Math.min(GLOBAL_MAX, globalTotalPrints + 1);
  }

  function syncUIQuotaState() {
    userPrintsRemaining = Math.max(0, USER_MAX - userPrintsUsed);
    globalPrintsRemaining = Math.max(0, GLOBAL_MAX - globalTotalPrints);
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

  function renderLabelBitmap(title, description, handle, timeStr, printNum) {
    const W = 800;
    const H = 1200;
    const PAD = 48;
    const CONTENT_W = W - PAD * 2;

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
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

    try {
      await fetchRemoteQuotaState();

      if (userPrintsRemaining <= 0) {
        setStatus('You have used all 3 prints.', true);
        return;
      }
      if (globalPrintsRemaining <= 0) {
        setStatus('400 print limit reached.', true);
        return;
      }

      const printNum = getNextPrintNumber();
      const timeStr = getFormattedTimestamp();
      const postponed = isCurrentlyPostponed();

      const itemRecord = {
        num: printNum,
        title: titleVal,
        description: descVal,
        author: authorVal,
        time: timeStr,
        status: postponed ? 'postponed' : 'printed'
      };

      if (!postponed) {
        await sendItemToPrinter(itemRecord);
      }

      // Save to archive + increment counters in Cloudflare KV
      globalTotalPrints = printNum;
      globalPrintsRemaining = Math.max(0, GLOBAL_MAX - globalTotalPrints);
      userPrintsUsed = Math.min(USER_MAX, userPrintsUsed + 1);
      userPrintsRemaining = Math.max(0, USER_MAX - userPrintsUsed);

      remoteUsersMap[clientToken] = userPrintsUsed;
      remoteUsersMap[hwHash] = userPrintsUsed;
      savedItems.push(itemRecord);

      try {
        localStorage.setItem(STORAGE_LOCAL_COUNT_KEY, userPrintsUsed.toString());
      } catch (ignored) {}

      await persistRemoteState();

      syncUIQuotaState();
      renderAdminUI();

      if (postponed) {
        setStatus(`Saved (#${printNum} / ${GLOBAL_MAX}) — queued for morning print.`);
      } else {
        setStatus(`Sent to printer (#${printNum} / ${GLOBAL_MAX}).`);
      }

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
