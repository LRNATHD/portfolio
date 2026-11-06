/**
 * Project Idea Dispatch // Frontend Engine
 * Pure text transmission to Noah's desk thermal printhead.
 * 
 * Features:
 * - Real-time physical 4x6" thermal print preview
 * - Visible hard limit of 3 prints per visitor (IP + persistent client token)
 * - Hard system limit of 400 prints globally
 * - Blazing-fast pure text transmission (~0.1s Bluetooth printhead payload)
 * - Zero tracking & privacy preservation
 */

(function () {
  'use strict';

  const WORKER_BASE_URL = 'https://realtalk-printer-bridge.super-disk-489b.workers.dev';
  const STORAGE_TOKEN_KEY = 'idea_client_token_v1';
  const STORAGE_LOCAL_COUNT_KEY = 'idea_prints_used_v1';
  const GLOBAL_MAX = 400;
  const USER_MAX = 3;

  // State
  let clientToken = getOrCreateClientToken();
  let userPrintsUsed = parseInt(localStorage.getItem(STORAGE_LOCAL_COUNT_KEY) || '0', 10);
  let userPrintsRemaining = Math.max(0, USER_MAX - userPrintsUsed);
  let globalPrintsRemaining = GLOBAL_MAX;
  let globalTotalPrints = 0;
  let isSubmitting = false;

  // DOM Elements
  const form = document.getElementById('ideaForm');
  const projectTitle = document.getElementById('projectTitle');
  const projectDescription = document.getElementById('projectDescription');
  const projectAuthor = document.getElementById('projectAuthor');
  const titleCharCount = document.getElementById('titleCharCount');
  const descCharCount = document.getElementById('descCharCount');
  const authorCharCount = document.getElementById('authorCharCount');
  const btnSubmitIdea = document.getElementById('btnSubmitIdea');
  const btnSubmitText = document.getElementById('btnSubmitText');

  const globalQuotaPill = document.getElementById('globalQuotaPill');
  const globalQuotaText = document.getElementById('globalQuotaText');
  const userQuotaPill = document.getElementById('userQuotaPill');
  const userQuotaText = document.getElementById('userQuotaText');

  const limitReachedBanner = document.getElementById('limitReachedBanner');
  const globalLimitBanner = document.getElementById('globalLimitBanner');

  // Preview Card DOM Elements
  const previewTitle = document.getElementById('previewTitle');
  const previewDescription = document.getElementById('previewDescription');
  const previewAuthor = document.getElementById('previewAuthor');
  const previewTimestamp = document.getElementById('previewTimestamp');
  const previewSlot = document.getElementById('previewSlot');

  // Modal DOM Elements
  const statusModal = document.getElementById('statusModal');
  const modalSpinner = document.getElementById('modalSpinner');
  const modalTitle = document.getElementById('modalTitle');
  const modalDesc = document.getElementById('modalDesc');
  const modalProgressBar = document.getElementById('modalProgressBar');
  const modalUserRemaining = document.getElementById('modalUserRemaining');
  const modalGlobalRemaining = document.getElementById('modalGlobalRemaining');
  const modalJobId = document.getElementById('modalJobId');
  const modalCloseBtn = document.getElementById('modalCloseBtn');

  // Fallback sample texts
  const SAMPLE_TITLE = 'Solar-Powered LoRa Mesh Sensor Node';
  const SAMPLE_DESC = 'An outdoor ESP32-S3 or CH572 node with low-power solar charging that broadcasts environmental telemetry across a decentralized mesh network.';

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------
  function init() {
    setupEventListeners();
    updateLiveTimestamp();
    syncUIQuotaState();
    fetchRemoteQuotaConfig();
    setInterval(updateLiveTimestamp, 30000);
  }

  // Generate or read persistent anonymous device token
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

  // --------------------------------------------------------------------------
  // Event Listeners
  // --------------------------------------------------------------------------
  function setupEventListeners() {
    // Real-time Title Input -> Preview
    projectTitle.addEventListener('input', () => {
      const val = projectTitle.value.trim();
      titleCharCount.textContent = `${projectTitle.value.length} / 80`;
      previewTitle.textContent = val.length > 0 ? val : SAMPLE_TITLE;
    });

    // Real-time Description Input -> Preview
    projectDescription.addEventListener('input', () => {
      const val = projectDescription.value.trim();
      descCharCount.textContent = `${projectDescription.value.length} / 500`;
      previewDescription.textContent = val.length > 0 ? val : SAMPLE_DESC;
    });

    // Real-time Author Input -> Preview
    projectAuthor.addEventListener('input', () => {
      const val = projectAuthor.value.trim();
      authorCharCount.textContent = `${projectAuthor.value.length} / 35`;
      previewAuthor.textContent = val.length > 0 ? `- ${val}` : '- Anonymous';
    });

    // Form Submission
    form.addEventListener('submit', handleSubmit);

    // Modal close
    if (modalCloseBtn) {
      modalCloseBtn.addEventListener('click', () => {
        statusModal.classList.add('hidden');
      });
    }

    // Dismiss modal on backdrop click when done
    if (statusModal) {
      statusModal.addEventListener('click', (e) => {
        if (e.target === statusModal && !modalCloseBtn.classList.contains('hidden')) {
          statusModal.classList.add('hidden');
        }
      });
    }
  }

  // --------------------------------------------------------------------------
  // Quota & State Management
  // --------------------------------------------------------------------------
  async function fetchRemoteQuotaConfig() {
    try {
      const res = await fetch(`${WORKER_BASE_URL}/api/ideas/config?clientId=${encodeURIComponent(clientToken)}&t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        if (typeof data.globalRemaining === 'number') {
          globalPrintsRemaining = data.globalRemaining;
          globalTotalPrints = data.globalTotal || (GLOBAL_MAX - data.globalRemaining);
        }
        if (typeof data.userRemaining === 'number') {
          // If server reports fewer remaining prints than client local storage, server wins
          userPrintsRemaining = Math.min(userPrintsRemaining, data.userRemaining);
          userPrintsUsed = USER_MAX - userPrintsRemaining;
          localStorage.setItem(STORAGE_LOCAL_COUNT_KEY, userPrintsUsed.toString());
        }
        syncUIQuotaState();
      }
    } catch (err) {
      console.warn('Quota sync standing by:', err);
      syncUIQuotaState();
    }
  }

  function syncUIQuotaState() {
    // 1. User allocation display
    userPrintsRemaining = Math.max(0, USER_MAX - userPrintsUsed);
    if (userQuotaText) {
      userQuotaText.textContent = `Allocation: ${userPrintsRemaining} of ${USER_MAX}`;
    }
    if (userQuotaPill) {
      if (userPrintsRemaining === 0) {
        userQuotaPill.classList.add('exhausted');
      } else {
        userQuotaPill.classList.remove('exhausted');
      }
    }

    // 2. Global capacity display
    if (globalQuotaText) {
      globalQuotaText.textContent = `Capacity: ${globalPrintsRemaining} / ${GLOBAL_MAX}`;
    }

    // 3. Preview slot text
    if (previewSlot) {
      const currentSlot = Math.min(USER_MAX, userPrintsUsed + 1);
      previewSlot.textContent = `PRINT #${currentSlot} OF ${USER_MAX} ALLOCATED`;
    }

    // 4. Lock state if limits reached
    const isUserExhausted = userPrintsRemaining <= 0;
    const isGlobalExhausted = globalPrintsRemaining <= 0;

    if (isGlobalExhausted) {
      if (globalLimitBanner) globalLimitBanner.classList.remove('hidden');
      disableFormInputs('Global 400-Print Limit Reached');
    } else if (isUserExhausted) {
      if (limitReachedBanner) limitReachedBanner.classList.remove('hidden');
      disableFormInputs('Limit Reached (3 / 3 Used)');
    } else {
      if (limitReachedBanner) limitReachedBanner.classList.add('hidden');
      if (globalLimitBanner) globalLimitBanner.classList.add('hidden');
      enableFormInputs();
    }
  }

  function disableFormInputs(btnLabel) {
    projectTitle.disabled = true;
    projectDescription.disabled = true;
    projectAuthor.disabled = true;
    btnSubmitIdea.disabled = true;
    if (btnSubmitText) btnSubmitText.textContent = btnLabel;
  }

  function enableFormInputs() {
    projectTitle.disabled = false;
    projectDescription.disabled = false;
    projectAuthor.disabled = false;
    btnSubmitIdea.disabled = false;
    if (btnSubmitText) btnSubmitText.textContent = "Print Idea to Noah's Desk";
  }

  function updateLiveTimestamp() {
    if (!previewTimestamp) return;
    const now = new Date();
    const utcStr = now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    previewTimestamp.textContent = utcStr;
  }

  // --------------------------------------------------------------------------
  // Submission & Blazing Fast Text Dispatch
  // --------------------------------------------------------------------------
  async function handleSubmit(e) {
    e.preventDefault();
    if (isSubmitting) return;

    if (userPrintsRemaining <= 0) {
      alert("You have already used your 3 allowed idea prints.");
      return;
    }

    if (globalPrintsRemaining <= 0) {
      alert("The global printhead limit of 400 prints has been reached.");
      return;
    }

    const titleVal = projectTitle.value.trim();
    const descVal = projectDescription.value.trim();
    const authorVal = projectAuthor.value.trim() || 'Anonymous';

    if (titleVal.length < 3) {
      alert('Please enter a project title (minimum 3 characters).');
      projectTitle.focus();
      return;
    }

    if (descVal.length < 10) {
      alert('Please enter project details / description (minimum 10 characters).');
      projectDescription.focus();
      return;
    }

    isSubmitting = true;
    btnSubmitIdea.disabled = true;

    showModal(
      'Dispatching Project Idea...',
      'Packaging pure native text payload for desk printhead...',
      35
    );

    try {
      // Primary Endpoint: /api/ideas/submit
      let res = await fetch(`${WORKER_BASE_URL}/api/ideas/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: titleVal,
          description: descVal,
          author: authorVal,
          clientId: clientToken
        })
      });

      // Backward-compatibility fallback:
      // If worker returns 404 (prior worker version still active before wrangler deploy),
      // transparently route through existing /api/quote with pure native text!
      if (res.status === 404) {
        updateModal('Routing via Native Relay...', 'Routing pure text payload to desk bridge...', 60);
        res = await fetch(`${WORKER_BASE_URL}/api/quote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'idea',
            text: `PROJECT: ${titleVal} | DETAILS: ${descVal}`,
            author: authorVal,
            imageData: null, // Pure native TSPL text = instantaneous Bluetooth SPP print
            speed: 2.0,
            density: 12
          })
        });
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server responded with status ${res.status}`);
      }

      const result = await res.json();
      const jobId = result.id || 'ok';
      modalJobId.textContent = `ID: ${jobId.slice(0, 10)}`;

      // Update local & quota state
      userPrintsUsed++;
      localStorage.setItem(STORAGE_LOCAL_COUNT_KEY, userPrintsUsed.toString());
      if (typeof result.userRemaining === 'number') {
        userPrintsRemaining = result.userRemaining;
      } else {
        userPrintsRemaining = Math.max(0, USER_MAX - userPrintsUsed);
      }

      if (typeof result.globalRemaining === 'number') {
        globalPrintsRemaining = result.globalRemaining;
      } else {
        globalPrintsRemaining = Math.max(0, globalPrintsRemaining - 1);
      }

      syncUIQuotaState();

      // Fast manifestation confirmation
      updateModal(
        'Physically Manifested!',
        'Your project idea was transmitted directly to Noah\'s desk and is printing out on the thermal printer now.',
        100,
        true
      );

      // Reset form fields
      projectTitle.value = '';
      projectDescription.value = '';
      projectAuthor.value = '';
      titleCharCount.textContent = '0 / 80';
      descCharCount.textContent = '0 / 500';
      authorCharCount.textContent = '0 / 35';

    } catch (err) {
      console.error('Submission failed:', err);
      updateModal(
        'Transmission Notice',
        err.message || 'Failed to reach cloud relay. Please verify connection and try again.',
        100,
        true
      );
    } finally {
      isSubmitting = false;
      if (userPrintsRemaining > 0 && globalPrintsRemaining > 0) {
        btnSubmitIdea.disabled = false;
      }
    }
  }

  // --------------------------------------------------------------------------
  // Modal Helpers
  // --------------------------------------------------------------------------
  function showModal(title, desc, progress) {
    if (!statusModal) return;
    statusModal.classList.remove('hidden');
    if (modalSpinner) modalSpinner.style.display = 'block';
    if (modalCloseBtn) modalCloseBtn.classList.add('hidden');
    if (modalTitle) modalTitle.textContent = title;
    if (modalDesc) modalDesc.textContent = desc;
    if (modalProgressBar) modalProgressBar.style.width = `${progress}%`;
    if (modalUserRemaining) modalUserRemaining.textContent = `${userPrintsRemaining} of ${USER_MAX}`;
    if (modalGlobalRemaining) modalGlobalRemaining.textContent = `${globalPrintsRemaining} / ${GLOBAL_MAX}`;
  }

  function updateModal(title, desc, progress, showClose = false) {
    if (!statusModal) return;
    if (modalTitle) modalTitle.textContent = title;
    if (modalDesc) modalDesc.textContent = desc;
    if (modalProgressBar) modalProgressBar.style.width = `${progress}%`;
    if (modalUserRemaining) modalUserRemaining.textContent = `${userPrintsRemaining} of ${USER_MAX}`;
    if (modalGlobalRemaining) modalGlobalRemaining.textContent = `${globalPrintsRemaining} / ${GLOBAL_MAX}`;
    if (showClose) {
      if (modalSpinner) modalSpinner.style.display = 'none';
      if (modalCloseBtn) {
        modalCloseBtn.classList.remove('hidden');
        modalCloseBtn.textContent = userPrintsRemaining > 0 ? 'Submit Another' : 'Dismiss';
      }
    }
  }

  // Boot on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
