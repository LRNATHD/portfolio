import { checkSubmissionProfanity } from './profanityFilter.js';

(function () {
  'use strict';

  const WORKER_BASE_URL = 'https://realtalk-printer-bridge.super-disk-489b.workers.dev';
  const KV_STATE_ID = 'q_munqdvq7j3od';
  const KV_AUTH = 'noah-realtalk-secret-change-me';
  const STORAGE_ADMIN_KEY = 'idea_admin_hash_v1';
  const ADMIN_SHA256 = '5f1f508821ed53e6cf4d387514c8a904ca53dcbda1a25b14533a96c8b641f113';
  const GLOBAL_MAX = 400;

  const SAMPLE_TITLE = 'Toaster that catapults toast onto your plate';
  const SAMPLE_DESC = "Finds your plate on the table and launches the toast right onto it when it's done.";

  let globalTotalPrints = 0;
  let globalPrintsRemaining = GLOBAL_MAX;
  let savedItems = [];
  let postponeUntil = 0; // 0 = immediate, -1 = hold indefinitely, >0 = epoch ms
  let isSubmitting = false;
  let isFlushing = false;
  let showingSentPreview = false;

  const form = document.getElementById('ideaForm');
  const projectTitle = document.getElementById('projectTitle');
  const projectDescription = document.getElementById('projectDescription');
  const projectAuthor = document.getElementById('projectAuthor');
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
  const previewTitle = document.getElementById('previewTitle');
  const previewDescription = document.getElementById('previewDescription');
  const previewAuthor = document.getElementById('previewAuthor');
  const previewTimestamp = document.getElementById('previewTimestamp');
  const previewNumber = document.getElementById('previewNumber');

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

  function init() {
    setupEventListeners();
    initAdminAccess();
    updateLiveTimestamp();
    syncUIQuotaState();
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
      previewHeaderLabel.textContent = 'Preview';
      previewHeaderLabel.classList.remove('sent');
    }
    if (thermalPreviewCard) {
      thermalPreviewCard.classList.remove('sent');
    }
    const nextNum = getNextPrintNumber();
    if (previewNumber) {
      previewNumber.textContent = `#${nextNum} / ${GLOBAL_MAX}`;
    }
    const tVal = projectTitle.value.trim();
    const dVal = projectDescription.value.trim();
    const aVal = projectAuthor.value.trim();
    previewTitle.textContent = tVal.length > 0 ? tVal : SAMPLE_TITLE;
    previewDescription.textContent = dVal.length > 0 ? dVal : SAMPLE_DESC;
    previewAuthor.textContent = aVal.length > 0 ? aVal : 'Anonymous';
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
      const val = projectTitle.value.trim();
      titleCharCount.textContent = `${projectTitle.value.length}/80`;
      previewTitle.textContent = val.length > 0 ? val : SAMPLE_TITLE;
    });

    projectDescription.addEventListener('input', () => {
      clearSentPreviewHighlight();
      clearErrorFeedback();
      const val = projectDescription.value.trim();
      descCharCount.textContent = `${projectDescription.value.length}/500`;
      previewDescription.textContent = val.length > 0 ? val : SAMPLE_DESC;
    });

    projectAuthor.addEventListener('input', () => {
      clearSentPreviewHighlight();
      clearErrorFeedback();
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
      badge.textContent = item.error ? `[${item.status}: ${item.error}]` : `[${item.status || 'printed'}]`;

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
    globalPrintsRemaining = Math.max(0, GLOBAL_MAX - globalTotalPrints);
    const nextNum = getNextPrintNumber();

    if (globalQuotaText) {
      globalQuotaText.textContent = `${globalTotalPrints}/${GLOBAL_MAX} printed`;
    }
    if (previewNumber && !showingSentPreview) {
      previewNumber.textContent = `#${nextNum} / ${GLOBAL_MAX}`;
    }

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

    isSubmitting = true;
    btnSubmitIdea.disabled = true;
    btnSubmitIdea.textContent = 'Sending to printer...';
    setStatus('');
    showFeedback('sending', 'Sending your idea...', 'Saving your message to Noah\'s printer queue...');

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

      const itemRecord = {
        uid,
        num: printNum,
        title: titleVal,
        description: descVal,
        author: authorVal,
        time: timeStr,
        status: postponed ? 'postponed' : 'queued'
      };

      // Save immediately to archive first so the idea is NEVER lost even if network/printer hiccups
      savedItems = mergeSavedItems(savedItems, [itemRecord]);
      globalTotalPrints = Math.max(globalTotalPrints, itemRecord.num, savedItems.length);
      globalPrintsRemaining = Math.max(0, GLOBAL_MAX - globalTotalPrints);
      await persistRemoteState();

      // Keep the user's submitted card visible in the Preview box with a "Sent" highlight
      showingSentPreview = true;
      previewTitle.textContent = itemRecord.title;
      previewDescription.textContent = itemRecord.description;
      previewAuthor.textContent = itemRecord.author;
      previewTimestamp.textContent = itemRecord.time;
      previewNumber.textContent = `#${itemRecord.num} / ${GLOBAL_MAX}`;
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
