/**
 * RealTalk // Thermal Canvas Engine
 * Freeform text & dithered image canvas for iPad & desktop thermal printing
 * Features:
 * - Interactive element rotation (drag handle + precision buttons)
 * - Automatic session persistence (debounced draft auto-save in localStorage)
 * - Past canvases history sidebar (thumbnails, instant reload, delete, + new canvas)
 * - 1:1 Ultra-Detail printhead dithering (up to 1200px native resolution)
 */

(function () {
  'use strict';

  if (window.__REALTALK_INITIALIZED__) return;
  window.__REALTALK_INITIALIZED__ = true;

  // Configuration
  const WORKER_BASE_URL = 'https://realtalk-printer-bridge.super-disk-489b.workers.dev';
  const CANVAS_WIDTH = 400; // CSS display pixels (400x600 2:3 aspect ratio)
  const CANVAS_HEIGHT = 600;
  const PRINT_WIDTH = 800; // Physical dots (203 DPI 4x6" printhead)
  const PRINT_HEIGHT = 1200;
  const STORAGE_DRAFT_KEY = 'realtalk_active_draft_v1';
  const STORAGE_PROJECT_KEY = 'realtalk_multi_sticker_project_v1';
  const STORAGE_HISTORY_KEY = 'realtalk_canvas_history_v1';

  // State
  let elements = [];
  let selectedElement = null;
  let nextElementId = 1;
  let isPhotoDither = true; // true = Floyd-Steinberg, false = high-contrast threshold
  let isBlackBg = false;
  let isSubmitting = false;
  let historyListItems = [];
  let autoSaveTimer = null;
  let activeSnapshotId = null;

  // Multi-Sticker Project State
  let project = {
    activeId: 'stk_1',
    viewMode: 'single', // 'single' or 'roll'
    stickers: [
      {
        id: 'stk_1',
        title: 'Sticker 1',
        isBlackBg: false,
        elements: []
      }
    ]
  };

  // Bridge Status & Telemetry State
  let currentBridgeStatus = {
    phoneOnline: false,
    lastSeenSeconds: null,
    batteryLevel: null,
    isCharging: false,
    printerConnected: false,
    printerState: 'DISCONNECTED',
    deviceAddress: null,
    lastError: null,
    lastUpdated: 0
  };
  let bridgePollInterval = null;
  let isControlPanelOpen = false;

  // DOM Elements
  const stage = document.getElementById('stage');
  const canvasContainer = document.getElementById('canvasContainer');
  const elementsContainer = document.getElementById('elementsContainer');
  const btnAddText = document.getElementById('btnAddText');
  const btnUploadImage = document.getElementById('btnUploadImage');
  const imageInput = document.getElementById('imageInput');
  const btnPasteImage = document.getElementById('btnPasteImage');
  const btnBgColor = document.getElementById('btnBgColor');
  const bgColorText = document.getElementById('bgColorText');
  const btnClear = document.getElementById('btnClear');
  const btnPrint = document.getElementById('btnPrint');
  const btnPrintLabel = document.getElementById('btnPrintLabel');
  const btnPrintAll = document.getElementById('btnPrintAll');
  const lblPrintAllCount = document.getElementById('lblPrintAllCount');
  const btnNewCanvas = document.getElementById('btnNewCanvas');

  // Multi-Sticker Strip DOM
  const stickerStripBar = document.getElementById('stickerStripBar');
  const stickerTabs = document.getElementById('stickerTabs');
  const btnAddSticker = document.getElementById('btnAddSticker');
  const btnDuplicateSticker = document.getElementById('btnDuplicateSticker');
  const btnDeleteSticker = document.getElementById('btnDeleteSticker');
  const btnToggleRollView = document.getElementById('btnToggleRollView');
  const lblRollViewMode = document.getElementById('lblRollViewMode');

  // Header & Bridge Status DOM
  const btnBridgeStatus = document.getElementById('btnBridgeStatus');
  const bridgeStatusText = document.getElementById('bridgeStatusText');
  const btnOpenControlPanel = document.getElementById('btnOpenControlPanel');

  // Control Panel Modal DOM
  const controlPanelModal = document.getElementById('controlPanelModal');
  const btnControlPanelClose = document.getElementById('btnControlPanelClose');
  const panelPhoneBadge = document.getElementById('panelPhoneBadge');
  const panelPhoneLastSeen = document.getElementById('panelPhoneLastSeen');
  const panelPhoneBattery = document.getElementById('panelPhoneBattery');
  const panelPrinterBadge = document.getElementById('panelPrinterBadge');
  const panelPrinterState = document.getElementById('panelPrinterState');
  const panelPrinterAddress = document.getElementById('panelPrinterAddress');
  const inputPrinterAddress = document.getElementById('inputPrinterAddress');
  const btnSavePrinterAddress = document.getElementById('btnSavePrinterAddress');
  const panelPowerState = document.getElementById('panelPowerState');
  const btnRemoteReconnect = document.getElementById('btnRemoteReconnect');
  const btnRemoteDisconnect = document.getElementById('btnRemoteDisconnect');
  const btnRemotePrintTest = document.getElementById('btnRemotePrintTest');
  const btnRemoteFetchQueue = document.getElementById('btnRemoteFetchQueue');
  const btnRefreshBridgeStatus = document.getElementById('btnRefreshBridgeStatus');
  const panelLogBox = document.getElementById('panelLogBox');
  const panelLogTime = document.getElementById('panelLogTime');

  // Printhead Hardware Settings DOM
  const selectPrintSpeed = document.getElementById('selectPrintSpeed');
  const selectPrintDensity = document.getElementById('selectPrintDensity');
  const selectPrintPolarity = document.getElementById('selectPrintPolarity');

  // History & Layers Studio Sidebar DOM
  const historySidebar = document.getElementById('historySidebar');
  const historyContainer = document.getElementById('historyContainer');
  const historyBadge = document.getElementById('historyBadge');
  const btnToggleHistory = document.getElementById('btnToggleHistory');
  const btnToggleLayers = document.getElementById('btnToggleLayers');
  const layersBadge = document.getElementById('layersBadge');
  const tabLayers = document.getElementById('tabLayers');
  const tabHistory = document.getElementById('tabHistory');
  const tabLayersCount = document.getElementById('tabLayersCount');
  const tabHistoryCount = document.getElementById('tabHistoryCount');
  const layersPanelView = document.getElementById('layersPanelView');
  const historyPanelView = document.getElementById('historyPanelView');
  const layersContainer = document.getElementById('layersContainer');
  const btnLayerTop = document.getElementById('btnLayerTop');
  const btnLayerUp = document.getElementById('btnLayerUp');
  const btnLayerDown = document.getElementById('btnLayerDown');
  const btnLayerBottom = document.getElementById('btnLayerBottom');
  const btnLayerDuplicate = document.getElementById('btnLayerDuplicate');
  const btnLayerDelete = document.getElementById('btnLayerDelete');
  const btnLayerAddText = document.getElementById('btnLayerAddText');
  const btnLayerAddImage = document.getElementById('btnLayerAddImage');
  const btnSidebarClose = document.getElementById('btnSidebarClose');
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');
  const btnNewCanvasSidebar = document.getElementById('btnNewCanvasSidebar');

  // Sidebar & Layer State
  let activeSidebarTab = 'layers'; // 'layers' or 'history'
  let draggedLayerId = null;
  let liveReditherRaf = null;

  // Floating Controls
  const elementControls = document.getElementById('elementControls');
  const btnSizeDown = document.getElementById('btnSizeDown');
  const btnSizeUp = document.getElementById('btnSizeUp');
  const btnTextColor = document.getElementById('btnTextColor');
  const textColorLabel = document.getElementById('textColorLabel');
  const btnInvertImage = document.getElementById('btnInvertImage');
  const btnRotateCCW = document.getElementById('btnRotateCCW');
  const btnRotateCW = document.getElementById('btnRotateCW');
  const btnRotate90 = document.getElementById('btnRotate90');
  const rotateDegreeBadge = document.getElementById('rotateDegreeBadge');
  const btnAlignLeft = document.getElementById('btnAlignLeft');
  const btnAlignCenter = document.getElementById('btnAlignCenter');
  const btnAlignRight = document.getElementById('btnAlignRight');
  const btnDeleteElem = document.getElementById('btnDeleteElem');

  // Print Status Modal DOM
  const statusModal = document.getElementById('statusModal');
  const modalSpinner = document.getElementById('modalSpinner');
  const modalTitle = document.getElementById('modalTitle');
  const modalDesc = document.getElementById('modalDesc');
  const modalProgressBar = document.getElementById('modalProgressBar');
  const modalJobId = document.getElementById('modalJobId');
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  const modalAlertBox = document.getElementById('modalAlertBox');
  const modalAlertTitle = document.getElementById('modalAlertTitle');
  const modalAlertDesc = document.getElementById('modalAlertDesc');
  const btnModalReconnect = document.getElementById('btnModalReconnect');
  const btnModalPrintAnyway = document.getElementById('btnModalPrintAnyway');
  const lblDate = document.getElementById('lblDate');

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------
  function init() {
    if (lblDate) {
      lblDate.textContent = new Date().toISOString().slice(0, 10);
    }

    setupEventListeners();
    setupClipboardListener();
    setupDragAndDropListeners();
    setupKeyboardListener();
    loadHistoryFromStorage();
    restoreActiveDraft();
    restoreHardwareSettings();
    initBridgeMonitoring();
  }

  function restoreHardwareSettings() {
    const savedSpeed = localStorage.getItem('realtalk_print_speed');
    if (savedSpeed && selectPrintSpeed) selectPrintSpeed.value = savedSpeed;

    const savedDensity = localStorage.getItem('realtalk_print_density');
    if (savedDensity && selectPrintDensity) selectPrintDensity.value = savedDensity;

    const savedPolarity = localStorage.getItem('realtalk_print_polarity');
    if (savedPolarity && selectPrintPolarity) selectPrintPolarity.value = savedPolarity;

    if (selectPrintSpeed) {
      selectPrintSpeed.addEventListener('change', () => {
        localStorage.setItem('realtalk_print_speed', selectPrintSpeed.value);
      });
    }
    if (selectPrintDensity) {
      selectPrintDensity.addEventListener('change', () => {
        localStorage.setItem('realtalk_print_density', selectPrintDensity.value);
      });
    }
    if (selectPrintPolarity) {
      selectPrintPolarity.addEventListener('change', () => {
        localStorage.setItem('realtalk_print_polarity', selectPrintPolarity.value);
      });
    }
  }

  // --------------------------------------------------------------------------
  // Event Listeners
  // --------------------------------------------------------------------------
  function setupEventListeners() {
    // Add Text button
    if (btnAddText) {
      btnAddText.addEventListener('click', (e) => {
        e.stopPropagation();
        addTextElement('New text here...', 80, 220, 24, 'center', 0);
        triggerAutoSave();
      });
    }

    // New Canvas button in toolbar
    if (btnNewCanvas) {
      btnNewCanvas.addEventListener('click', () => {
        startNewCanvas();
      });
    }

    // New Canvas button in sidebar
    if (btnNewCanvasSidebar) {
      btnNewCanvasSidebar.addEventListener('click', () => {
        startNewCanvas();
      });
    }

    // Multi-Sticker Navigation Listeners
    if (btnAddSticker) {
      btnAddSticker.addEventListener('click', () => {
        addNewSticker();
      });
    }

    if (btnDuplicateSticker) {
      btnDuplicateSticker.addEventListener('click', () => {
        duplicateActiveSticker();
      });
    }

    if (btnDeleteSticker) {
      btnDeleteSticker.addEventListener('click', () => {
        deleteActiveSticker();
      });
    }

    if (btnToggleRollView) {
      btnToggleRollView.addEventListener('click', () => {
        toggleRollView();
      });
    }

    if (btnPrintAll) {
      btnPrintAll.addEventListener('click', () => {
        handleBatchPrintSubmission();
      });
    }

    // Toggle Studio Sidebar & Tab Switching
    if (btnToggleHistory) {
      btnToggleHistory.addEventListener('click', () => {
        toggleSidebar('history');
      });
    }

    if (btnToggleLayers) {
      btnToggleLayers.addEventListener('click', () => {
        toggleSidebar('layers');
      });
    }

    if (tabLayers) {
      tabLayers.addEventListener('click', () => {
        switchSidebarTab('layers');
      });
    }

    if (tabHistory) {
      tabHistory.addEventListener('click', () => {
        switchSidebarTab('history');
      });
    }

    // Inkscape Action Toolbar buttons
    if (btnLayerTop) btnLayerTop.addEventListener('click', () => moveSelectedLayerToTop());
    if (btnLayerUp) btnLayerUp.addEventListener('click', () => moveSelectedLayerUp());
    if (btnLayerDown) btnLayerDown.addEventListener('click', () => moveSelectedLayerDown());
    if (btnLayerBottom) btnLayerBottom.addEventListener('click', () => moveSelectedLayerToBottom());
    if (btnLayerDuplicate) btnLayerDuplicate.addEventListener('click', () => duplicateSelectedLayer());
    if (btnLayerDelete) btnLayerDelete.addEventListener('click', () => deleteSelectedElement());

    if (btnLayerAddText) {
      btnLayerAddText.addEventListener('click', () => {
        addTextElement('Your text...', 50, 100, 24, 'center', 0);
        triggerAutoSave();
      });
    }

    if (btnLayerAddImage) {
      btnLayerAddImage.addEventListener('click', () => {
        if (imageInput) imageInput.click();
      });
    }

    if (btnSidebarClose) {
      btnSidebarClose.addEventListener('click', () => {
        closeHistorySidebar();
      });
    }

    if (sidebarBackdrop) {
      sidebarBackdrop.addEventListener('click', () => {
        closeHistorySidebar();
      });
    }

    // Tap on empty space in container
    if (elementsContainer) {
      elementsContainer.addEventListener('pointerdown', (e) => {
        if (e.target === elementsContainer) {
          deselectAll();
        }
      });

      // Single click on empty canvas adds text; if elements exist, deselects
      elementsContainer.addEventListener('click', (e) => {
        if (e.target === elementsContainer && elements.length === 0) {
          const rect = elementsContainer.getBoundingClientRect();
          const x = Math.max(10, Math.min(e.clientX - rect.left - 60, CANVAS_WIDTH - 150));
          const y = Math.max(10, Math.min(e.clientY - rect.top - 20, CANVAS_HEIGHT - 60));
          addTextElement('Your text...', x, y, 24, 'center', 0);
          triggerAutoSave();
        }
      });

      // Double tap/click on empty space adds a text box at tap location
      elementsContainer.addEventListener('dblclick', (e) => {
        if (e.target === elementsContainer) {
          const rect = elementsContainer.getBoundingClientRect();
          const x = Math.max(10, Math.min(e.clientX - rect.left - 60, CANVAS_WIDTH - 150));
          const y = Math.max(10, Math.min(e.clientY - rect.top - 20, CANVAS_HEIGHT - 60));
          addTextElement('Your text', x, y, 22, 'left', 0);
          triggerAutoSave();
        }
      });
    }

    // Upload Image
    if (btnUploadImage && imageInput) {
      btnUploadImage.addEventListener('click', (e) => {
        e.preventDefault();
        imageInput.click();
      });
    }

    if (imageInput) {
      imageInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
          processUploadedFile(file);
        }
        imageInput.value = '';
      });
    }

    // Paste button (mobile Safari / iPad clipboard API fallback)
    if (btnPasteImage) {
      btnPasteImage.addEventListener('click', async () => {
        try {
          if (navigator.clipboard && navigator.clipboard.read) {
            const items = await navigator.clipboard.read();
            for (const item of items) {
              const imgType = item.types.find(t => t.startsWith('image/'));
              if (imgType) {
                const blob = await item.getType(imgType);
                processUploadedFile(blob);
                return;
              }
            }
          }
          alert("To paste an image: Press Ctrl+V (or Cmd+V on Mac) anywhere on this page!");
        } catch (err) {
          console.warn("Clipboard read error:", err);
          alert("To paste an image: Press Ctrl+V (or Cmd+V on Mac) anywhere on this page!");
        }
      });
    }

    // Clear current sticker
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        if (elements.length === 0) return;
        if (confirm("Clear all elements on this sticker?")) {
          deselectAll();
          elementsContainer.innerHTML = '';
          elements = [];
          saveActiveStickerToState();
          triggerAutoSave();
        }
      });
    }

    // Print to Desk
    if (btnPrint) {
      btnPrint.addEventListener('click', () => {
        handlePrintSubmission();
      });
    }

    // Background color toggle (White vs Black)
    if (btnBgColor) {
      btnBgColor.addEventListener('click', () => {
        toggleStageBgColor();
      });
    }

    // Header & Control Panel listeners
    if (btnBridgeStatus) {
      btnBridgeStatus.addEventListener('click', () => openControlPanel());
    }
    if (btnOpenControlPanel) {
      btnOpenControlPanel.addEventListener('click', () => openControlPanel());
    }
    if (btnControlPanelClose) {
      btnControlPanelClose.addEventListener('click', () => closeControlPanel());
    }
    if (controlPanelModal) {
      controlPanelModal.addEventListener('click', (e) => {
        if (e.target === controlPanelModal) closeControlPanel();
      });
    }

    // Remote actions in Control Panel
    if (btnRemoteReconnect) {
      btnRemoteReconnect.addEventListener('click', () => {
        sendBridgeCommand('reconnect_printer');
      });
    }
    if (btnRemoteDisconnect) {
      btnRemoteDisconnect.addEventListener('click', () => {
        sendBridgeCommand('disconnect_printer');
      });
    }
    if (btnRemotePrintTest) {
      btnRemotePrintTest.addEventListener('click', () => {
        sendBridgeCommand('print_test');
      });
    }
    if (btnRemoteFetchQueue) {
      btnRemoteFetchQueue.addEventListener('click', () => {
        sendBridgeCommand('fetch_queue');
      });
    }
    if (btnRefreshBridgeStatus) {
      btnRefreshBridgeStatus.addEventListener('click', () => {
        fetchBridgeStatus();
      });
    }
    if (btnSavePrinterAddress && inputPrinterAddress) {
      btnSavePrinterAddress.addEventListener('click', () => {
        const newAddr = inputPrinterAddress.value.trim().toUpperCase();
        if (!newAddr) {
          appendPanelLog('Error: Target MAC address cannot be blank', 'error');
          return;
        }
        appendPanelLog(`Updating target MAC address to ${newAddr}...`, 'info');
        sendBridgeCommand('set_printer_address', { address: newAddr });
      });
    }

    // Print Modal Alert buttons
    if (btnModalReconnect) {
      btnModalReconnect.addEventListener('click', async () => {
        btnModalReconnect.disabled = true;
        btnModalReconnect.textContent = 'Linking...';
        if (modalAlertTitle) modalAlertTitle.textContent = 'Linking to Node...';
        if (modalAlertDesc) modalAlertDesc.textContent = 'Signal dispatched to relay. Establishing wireless handshake...';

        await sendBridgeCommand('reconnect_printer');

        let attempts = 0;
        const connectCheckTimer = setInterval(async () => {
          attempts++;
          await fetchBridgeStatus();
          if (currentBridgeStatus.printerConnected) {
            clearInterval(connectCheckTimer);
            btnModalReconnect.disabled = false;
            btnModalReconnect.textContent = 'Reconnect Node';
            executePrintJob();
          } else if (attempts >= 14) {
            clearInterval(connectCheckTimer);
            btnModalReconnect.disabled = false;
            btnModalReconnect.textContent = 'Retry Handshake';
            if (modalAlertTitle) modalAlertTitle.textContent = 'Handshake Timeout';
            if (modalAlertDesc) modalAlertDesc.textContent = 'Desk node did not respond within 20s. Ensure node power is ON, or Queue Transmission.';
          }
        }, 1500);
      });
    }

    if (btnModalPrintAnyway) {
      btnModalPrintAnyway.addEventListener('click', () => {
        executePrintJob();
      });
    }

    // Inspector button bindings
    if (btnSizeDown) btnSizeDown.addEventListener('click', () => adjustSelectedSize(-2));
    if (btnSizeUp) btnSizeUp.addEventListener('click', () => adjustSelectedSize(2));
    if (btnTextColor) btnTextColor.addEventListener('click', () => toggleSelectedTextColor());
    if (btnInvertImage) btnInvertImage.addEventListener('click', () => invertSelectedImage());
    if (btnRotateCCW) btnRotateCCW.addEventListener('click', () => rotateSelectedBy(-15));
    if (btnRotateCW) btnRotateCW.addEventListener('click', () => rotateSelectedBy(15));
    if (btnRotate90) btnRotate90.addEventListener('click', () => rotateSelectedBy(90));
    if (btnAlignLeft) btnAlignLeft.addEventListener('click', () => setSelectedAlign('left'));
    if (btnAlignCenter) btnAlignCenter.addEventListener('click', () => setSelectedAlign('center'));
    if (btnAlignRight) btnAlignRight.addEventListener('click', () => setSelectedAlign('right'));
    if (btnDeleteElem) btnDeleteElem.addEventListener('click', () => deleteSelectedElement());

    if (modalCloseBtn) {
      modalCloseBtn.addEventListener('click', () => {
        statusModal.classList.add('hidden');
      });
    }
  }

  // Global Keyboard Listener (Inkscape shortcuts: Delete, Reorder, Duplicate, Esc)
  function setupKeyboardListener() {
    window.addEventListener('keydown', (e) => {
      const activeEl = document.activeElement;
      const isInput = activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.isContentEditable
      );

      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (isInput) {
          // If editing a text element and it's empty, backspace removes the element cleanly
          if (activeEl.isContentEditable && selectedElement && selectedElement.contentNode === activeEl) {
            const raw = activeEl.innerText.replace(/[\r\n\s]/g, '');
            if (raw.length === 0) {
              e.preventDefault();
              deleteSelectedElement();
            }
          }
          return;
        }

        // Outside text editing: delete selected element
        if (selectedElement) {
          e.preventDefault();
          deleteSelectedElement();
        }
        return;
      }

      // Escape key deselects element
      if (e.key === 'Escape') {
        deselectAll();
        return;
      }

      // Don't intercept shortcuts when user is typing in an input
      if (isInput) return;

      const isCmdOrCtrl = e.ctrlKey || e.metaKey;

      // Duplicate: Ctrl+D
      if (isCmdOrCtrl && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        duplicateSelectedLayer();
        return;
      }

      // Raise Layer: Ctrl+] (or Bring to Front: Shift+Ctrl+])
      if (isCmdOrCtrl && e.key === ']') {
        e.preventDefault();
        if (e.shiftKey) {
          moveSelectedLayerToTop();
        } else {
          moveSelectedLayerUp();
        }
        return;
      }

      // Lower Layer: Ctrl+[ (or Send to Back: Shift+Ctrl+[)
      if (isCmdOrCtrl && e.key === '[') {
        e.preventDefault();
        if (e.shiftKey) {
          moveSelectedLayerToBottom();
        } else {
          moveSelectedLayerDown();
        }
        return;
      }
    });
  }

  // Global Clipboard Listener (Cmd+V / Ctrl+V anywhere on window)
  function setupClipboardListener() {
    window.addEventListener('paste', (e) => {
      const clipboardData = e.clipboardData || (window.event && window.event.clipboardData);
      if (!clipboardData) return;

      // 1. Check items (blobs from screenshots or clipboard image data)
      if (clipboardData.items) {
        for (const item of clipboardData.items) {
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
              e.preventDefault();
              processUploadedFile(file);
              return;
            }
          }
        }
      }

      // 2. Check files directly
      if (clipboardData.files && clipboardData.files.length > 0) {
        for (const file of clipboardData.files) {
          if (file.type.startsWith('image/')) {
            e.preventDefault();
            processUploadedFile(file);
            return;
          }
        }
      }
    });
  }

  // Global Drag and Drop Listener (drag image file onto window or canvas)
  function setupDragAndDropListeners() {
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        for (const file of e.dataTransfer.files) {
          if (file.type.startsWith('image/')) {
            processUploadedFile(file);
            return;
          }
        }
      }
    });
  }

  // --------------------------------------------------------------------------
  // Image Processing & Floyd-Steinberg Dynamic Redithering System
  // --------------------------------------------------------------------------

  function loadImagePromise(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image source'));
      img.src = src;
    });
  }

  function processUploadedFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUri = e.target.result;
      const img = new Image();
      img.onload = () => {
        // High-resolution source preservation:
        // Cap max dimension to 1600px to prevent localStorage exhaustion while
        // comfortably supersampling the physical 800x1200 printhead.
        let rawSrc = dataUri;
        const maxRaw = 1600;
        let origW = img.naturalWidth || img.width;
        let origH = img.naturalHeight || img.height;
        if (origW > maxRaw || origH > maxRaw) {
          const ratio = Math.min(maxRaw / origW, maxRaw / origH);
          const rw = Math.round(origW * ratio);
          const rh = Math.round(origH * ratio);
          const normCanvas = document.createElement('canvas');
          normCanvas.width = rw;
          normCanvas.height = rh;
          const normCtx = normCanvas.getContext('2d');
          normCtx.imageSmoothingEnabled = true;
          normCtx.imageSmoothingQuality = 'high';
          normCtx.drawImage(img, 0, 0, rw, rh);
          rawSrc = normCanvas.toDataURL('image/jpeg', 0.92);
          origW = rw;
          origH = rh;
        }

        addImageElement(null, origW, origH, 0, null, null, null, null, rawSrc, false);
        triggerAutoSave();
      };
      img.src = dataUri;
    };
    reader.readAsDataURL(file);
  }

  /**
   * Generates a 1-bit monochrome canvas using Floyd-Steinberg error diffusion
   * or high-contrast threshold directly at the specified dot dimensions (targetW, targetH).
   */
  function generateDitheredBitmap(sourceImg, targetW, targetH, options = {}) {
    const w = Math.max(1, Math.round(targetW));
    const h = Math.max(1, Math.round(targetH));
    const useDither = options.useDither !== undefined ? options.useDither : isPhotoDither;
    const isInverted = !!options.isInverted;

    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sourceImg, 0, 0, w, h);

    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const gray = new Float32Array(w * h);

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      let lum;
      if (a < 64) {
        // Transparent pixels become white substrate
        lum = 255;
      } else {
        lum = 0.299 * r + 0.587 * g + 0.114 * b;
      }

      if (isInverted) {
        lum = 255 - lum;
      }
      gray[i / 4] = lum;
    }

    if (useDither) {
      // Floyd-Steinberg error diffusion
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          const oldVal = gray[idx];
          const newVal = oldVal < 128 ? 0 : 255;
          gray[idx] = newVal;
          const err = oldVal - newVal;

          if (x + 1 < w) gray[idx + 1] += (err * 7) / 16;
          if (x - 1 >= 0 && y + 1 < h) gray[(y + 1) * w + (x - 1)] += (err * 3) / 16;
          if (y + 1 < h) gray[(y + 1) * w + x] += (err * 5) / 16;
          if (x + 1 < w && y + 1 < h) gray[(y + 1) * w + (x + 1)] += (err * 1) / 16;
        }
      }
    } else {
      // High-contrast sharp threshold
      for (let i = 0; i < gray.length; i++) {
        gray[i] = gray[i] < 128 ? 0 : 255;
      }
    }

    // Write back 1-bit monochrome RGBA
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

  /**
   * Recalculates the dithering of an image element at its CURRENT display dimensions
   * from rawSrc so that scaling up does NOT enlarge dots into chunky square blocks,
   * but recalculates micro-dots to preserve maximum photographic detail.
   */
  function recalculateImageDithering(record) {
    if (!record || record.type !== 'image') return;
    const src = record.rawSrc || record.dataUrl;
    if (!src) return;

    // Retina supersampling: if devicePixelRatio >= 2, render at 2x dot density for high-DPI screens
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const targetW = Math.max(16, Math.round(record.width * dpr));
    const targetH = Math.max(16, Math.round(record.height * dpr));

    const applyDither = (sourceImg) => {
      const ditherCanvas = generateDitheredBitmap(sourceImg, targetW, targetH, {
        useDither: isPhotoDither,
        isInverted: !!record.isInverted
      });
      const dataUrl = ditherCanvas.toDataURL('image/png');
      record.dataUrl = dataUrl;
      if (record.imgNode) {
        record.imgNode.src = dataUrl;
      }
    };

    if (record.rawImg && record.rawImg.complete && record.rawImg.naturalWidth > 0) {
      applyDither(record.rawImg);
    } else {
      const img = new Image();
      img.onload = () => {
        record.rawImg = img;
        applyDither(img);
      };
      img.src = src;
    }
  }

  /**
   * Throttles dynamic redithering during live drag-resize via requestAnimationFrame
   * to guarantee smooth 60fps handles while dynamically updating dither dots.
   */
  function scheduleLiveRedither(record) {
    if (liveReditherRaf) return;
    liveReditherRaf = requestAnimationFrame(() => {
      liveReditherRaf = null;
      recalculateImageDithering(record);
    });
  }

  function convertImageToDithered(img, useDither = true, isInverted = false) {
    const maxDim = 400;
    let w = img.width;
    let h = img.height;
    if (w > maxDim || h > maxDim) {
      if (w > h) {
        h = Math.round((h * maxDim) / w);
        w = maxDim;
      } else {
        w = Math.round((w * maxDim) / h);
        h = maxDim;
      }
    }
    const c = generateDitheredBitmap(img, w, h, { useDither, isInverted });
    return c.toDataURL('image/png');
  }

  // --------------------------------------------------------------------------
  // Text Line Wrapping & Measurement Utilities
  // --------------------------------------------------------------------------

  /**
   * Pure algorithmic word-wrapping for canvas contexts.
   * Breaks text by paragraphs (newlines) and word-wraps each paragraph to maxWidth.
   * Explicit user Enters and blank lines are strictly preserved to ensure visual line breaks space correctly.
   */
  function wrapTextParagraphs(text, measureFn, maxWidth) {
    if (!text) return [];
    const lines = [];
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const paragraphs = normalized.split('\n');

    for (const para of paragraphs) {
      // Empty paragraph (created by pressing Enter): preserve as empty line for vertical spacing
      if (!para || !para.trim()) {
        lines.push('');
        continue;
      }

      // If the paragraph fits in one line, avoid word-splitting
      if (measureFn(para) <= maxWidth + 6) {
        lines.push(para);
        continue;
      }

      const words = para.split(' ');
      let currentLine = '';

      for (let i = 0; i < words.length; i++) {
        const word = words[i];

        if (!currentLine) {
          if (measureFn(word) <= maxWidth) {
            currentLine = word;
          } else {
            // Character-level break for words wider than entire printable width
            let piece = '';
            for (const char of word) {
              if (measureFn(piece + char) <= maxWidth) {
                piece += char;
              } else {
                if (piece) lines.push(piece);
                piece = char;
              }
            }
            currentLine = piece;
          }
        } else {
          const testLine = currentLine + ' ' + word;
          if (measureFn(testLine) <= maxWidth) {
            currentLine = testLine;
          } else {
            lines.push(currentLine);
            if (measureFn(word) <= maxWidth) {
              currentLine = word;
            } else {
              let piece = '';
              for (const char of word) {
                if (measureFn(piece + char) <= maxWidth) {
                  piece += char;
                } else {
                  if (piece) lines.push(piece);
                  piece = char;
                }
              }
              currentLine = piece;
            }
          }
        }
      }
      if (currentLine) lines.push(currentLine);
    }

    return lines;
  }

  /**
   * Resolves wrapped lines for any text element with strict preservation of user Enters and blank lines.
   */
  function getWrappedTextLines(ctx, el, availablePrintW) {
    const rawText = (el.contentNode ? el.contentNode.innerText : el.text) || (el.lines ? el.lines.join('\n') : '') || '';
    if (!rawText) return [];

    const measureFn = (str) => ctx.measureText(str).width;
    const lines = wrapTextParagraphs(rawText, measureFn, availablePrintW);
    return lines.length > 0 ? lines : [''];
  }

  // --------------------------------------------------------------------------
  // Text Element Management
  // --------------------------------------------------------------------------
  function addTextElement(text, x, y, fontSize = 24, align = 'center', rotation = 0, color = null, name = null, locked = false, hidden = false) {
    const id = 'el_' + nextElementId++;
    const el = document.createElement('div');
    el.className = 'canvas-element';
    el.dataset.id = id;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.transform = `rotate(${rotation || 0}deg)`;
    if (hidden) el.style.display = 'none';
    if (locked) el.classList.add('element-locked');

    const textColor = color || (isBlackBg ? '#ffffff' : '#000000');

    const content = document.createElement('div');
    content.className = 'canvas-text-content';
    content.contentEditable = 'true';
    content.spellcheck = false;
    content.style.fontSize = `${fontSize}px`;
    content.style.textAlign = align;
    content.style.color = textColor;
    content.innerText = text;

    // Rotation Handle & Stem
    const stem = document.createElement('div');
    stem.className = 'rotate-stem';
    const rotateHandle = document.createElement('div');
    rotateHandle.className = 'rotate-handle';
    rotateHandle.title = 'Drag to rotate';
    rotateHandle.innerHTML = '&#8635;';

    el.appendChild(content);
    el.appendChild(stem);
    el.appendChild(rotateHandle);
    elementsContainer.appendChild(el);

    const record = {
      id,
      name: name || ('Text: ' + (text ? text.replace(/[\r\n\s]+/g, ' ').trim().slice(0, 16) : 'Text')),
      type: 'text',
      x,
      y,
      fontSize,
      align,
      rotation: rotation || 0,
      color: textColor,
      locked: !!locked,
      hidden: !!hidden,
      domNode: el,
      contentNode: content
    };
    elements.push(record);
    syncDOMZIndex();

    attachDragListeners(el, record);
    attachRotateListener(rotateHandle, record);

    content.addEventListener('input', () => {
      record.text = content.innerText;
      renderLayersPanel();
      triggerAutoSave();
    });

    selectElement(record);
    renderLayersPanel();
    content.focus();
    return record;
  }

  // --------------------------------------------------------------------------
  // Image Element Management
  // --------------------------------------------------------------------------
  function addImageElement(dataUrl, origW, origH, rotation = 0, initialW = null, initialH = null, xPos = null, yPos = null, rawSrc = null, isInverted = false, name = null, locked = false, hidden = false) {
    const id = 'el_' + nextElementId++;
    const el = document.createElement('div');
    el.className = 'canvas-element';
    el.dataset.id = id;

    // Display sizing (fit cleanly on 400x600 screen canvas)
    let w = initialW;
    let h = initialH;
    if (!w || !h) {
      const maxInitW = 220;
      w = origW || 200;
      h = origH || 200;
      if (w > maxInitW) {
        h = Math.round((h * maxInitW) / w);
        w = maxInitW;
      }
    }

    const x = xPos !== null ? xPos : Math.max(10, Math.round((CANVAS_WIDTH - w) / 2));
    const y = yPos !== null ? yPos : Math.max(10, Math.round((CANVAS_HEIGHT - h) / 2));

    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.transform = `rotate(${rotation || 0}deg)`;
    if (hidden) el.style.display = 'none';
    if (locked) el.classList.add('element-locked');

    const img = document.createElement('img');
    img.className = 'canvas-img-content';

    // 4 Corner Resize Handles
    const handleBR = document.createElement('div');
    handleBR.className = 'resize-handle br';
    handleBR.title = 'Drag to resize';

    const handleTL = document.createElement('div');
    handleTL.className = 'resize-handle tl';
    handleTL.title = 'Drag to resize';

    const handleTR = document.createElement('div');
    handleTR.className = 'resize-handle tr';
    handleTR.title = 'Drag to resize';

    const handleBL = document.createElement('div');
    handleBL.className = 'resize-handle bl';
    handleBL.title = 'Drag to resize';

    const stem = document.createElement('div');
    stem.className = 'rotate-stem';
    const rotateHandle = document.createElement('div');
    rotateHandle.className = 'rotate-handle';
    rotateHandle.title = 'Drag to rotate';
    rotateHandle.innerHTML = '&#8635;';

    el.appendChild(img);
    el.appendChild(handleBR);
    el.appendChild(handleTL);
    el.appendChild(handleTR);
    el.appendChild(handleBL);
    el.appendChild(stem);
    el.appendChild(rotateHandle);
    elementsContainer.appendChild(el);

    const record = {
      id,
      name: name || (`Image ${elements.filter(e => e.type === 'image').length + 1}`),
      type: 'image',
      x,
      y,
      width: w,
      height: h,
      origW: origW || w,
      origH: origH || h,
      aspectRatio: (origW && origH) ? (origW / origH) : (w / h),
      rotation: rotation || 0,
      dataUrl: dataUrl || '',
      rawSrc: rawSrc || dataUrl || '',
      isInverted: !!isInverted,
      locked: !!locked,
      hidden: !!hidden,
      domNode: el,
      imgNode: img,
      rawImg: null
    };

    if (record.rawSrc) {
      const rawImage = new Image();
      rawImage.onload = () => {
        record.rawImg = rawImage;
        recalculateImageDithering(record);
        renderLayersPanel();
      };
      rawImage.src = record.rawSrc;
    } else if (dataUrl) {
      img.src = dataUrl;
    }

    elements.push(record);
    syncDOMZIndex();

    attachDragListeners(el, record);
    attachResizeListener(handleBR, record, 'br');
    attachResizeListener(handleTL, record, 'tl');
    attachResizeListener(handleTR, record, 'tr');
    attachResizeListener(handleBL, record, 'bl');
    attachRotateListener(rotateHandle, record);

    // Two-finger pinch to resize on iPad
    let touchStartDist = 0;
    let touchStartW = 0;
    let touchStartH = 0;
    let touchInitX = 0;
    let touchInitY = 0;

    el.addEventListener('touchstart', (e) => {
      if (record.locked) return;
      if (e.touches.length === 2) {
        selectElement(record);
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        touchStartDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        touchStartW = record.width;
        touchStartH = record.height;
        touchInitX = record.x;
        touchInitY = record.y;
      }
    }, { passive: true });

    el.addEventListener('touchmove', (e) => {
      if (record.locked) return;
      if (e.touches.length === 2 && touchStartDist > 0) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const currentDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const scale = currentDist / touchStartDist;
        const newW = Math.max(30, Math.min(2400, Math.round(touchStartW * scale)));
        const newH = Math.round(newW / record.aspectRatio);
        const newX = Math.round(touchInitX - (newW - touchStartW) / 2);
        const newY = Math.round(touchInitY - (newH - touchStartH) / 2);

        record.width = newW;
        record.height = newH;
        record.x = newX;
        record.y = newY;
        el.style.width = `${newW}px`;
        el.style.height = `${newH}px`;
        el.style.left = `${newX}px`;
        el.style.top = `${newY}px`;
        scheduleLiveRedither(record);
      }
    }, { passive: true });

    el.addEventListener('touchend', (e) => {
      if (touchStartDist > 0) {
        touchStartDist = 0;
        recalculateImageDithering(record);
        renderLayersPanel();
        triggerAutoSave();
      }
    });

    // Desktop wheel/trackpad zoom when image is selected
    el.addEventListener('wheel', (e) => {
      if (selectedElement === record && !record.locked) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.08 : 0.92;
        const newW = Math.max(30, Math.min(2400, Math.round(record.width * factor)));
        const newH = Math.round(newW / record.aspectRatio);
        const oldW = record.width;
        const oldH = record.height;
        record.x = Math.round(record.x - (newW - oldW) / 2);
        record.y = Math.round(record.y - (newH - oldH) / 2);
        record.width = newW;
        record.height = newH;
        record.domNode.style.width = `${newW}px`;
        record.domNode.style.height = `${newH}px`;
        record.domNode.style.left = `${record.x}px`;
        record.domNode.style.top = `${record.y}px`;
        recalculateImageDithering(record);
        renderLayersPanel();
        triggerAutoSave();
      }
    }, { passive: false });

    selectElement(record);
    renderLayersPanel();
    return record;
  }

  // --------------------------------------------------------------------------
  // Draggable Behavior (Touch & Mouse)
  // --------------------------------------------------------------------------
  function attachDragListeners(node, record) {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initLeft = 0;
    let initTop = 0;

    node.addEventListener('pointerdown', (e) => {
      if (record.locked) return;
      // If clicking handles, ignore element drag
      if (e.target.classList.contains('resize-handle') || e.target.classList.contains('rotate-handle')) return;

      selectElement(record);
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      initLeft = record.x;
      initTop = record.y;

      node.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });

    node.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      let newX = initLeft + dx;
      let newY = initTop + dy;

      const elemW = record.width || (record.domNode.offsetWidth || 80);
      const elemH = record.height || (record.domNode.offsetHeight || 40);

      // Keep at least 30px of the element inside the canvas boundaries so it can always be grabbed
      const minX = -elemW + 30;
      const maxX = CANVAS_WIDTH - 30;
      const minY = -elemH + 30;
      const maxY = CANVAS_HEIGHT - 30;

      newX = Math.max(minX, Math.min(maxX, newX));
      newY = Math.max(minY, Math.min(maxY, newY));

      record.x = newX;
      record.y = newY;
      node.style.left = `${newX}px`;
      node.style.top = `${newY}px`;
    });

    const stopDrag = (e) => {
      if (isDragging) {
        isDragging = false;
        try {
          node.releasePointerCapture(e.pointerId);
        } catch (ignored) {}
        renderLayersPanel();
        triggerAutoSave();
      }
    };

    node.addEventListener('pointerup', stopDrag);
    node.addEventListener('pointercancel', stopDrag);
  }

  // --------------------------------------------------------------------------
  // Resize Handle Listener (4 Corners & Past Canvas Size)
  // --------------------------------------------------------------------------
  function attachResizeListener(handle, record, corner = 'br') {
    let isResizing = false;
    let startX = 0;
    let startY = 0;
    let startW = 0;
    let startH = 0;
    let initX = 0;
    let initY = 0;
    let centerScreenX = 0;
    let centerScreenY = 0;
    let initialDist = 0;

    handle.addEventListener('pointerdown', (e) => {
      if (record.locked) return;
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startW = record.width;
      startH = record.height;
      initX = record.x;
      initY = record.y;

      const rect = record.domNode.getBoundingClientRect();
      centerScreenX = rect.left + rect.width / 2;
      centerScreenY = rect.top + rect.height / 2;
      initialDist = Math.hypot(startX - centerScreenX, startY - centerScreenY);
      if (initialDist < 10) initialDist = 10;

      handle.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });

    handle.addEventListener('pointermove', (e) => {
      if (!isResizing) return;

      const maxAllowedW = 2400; // Allow sizing well past the 400px canvas
      const minAllowedW = 30;

      let newW = startW;
      let newH = startH;
      let newX = initX;
      let newY = initY;

      // If rotated, scale smoothly from center so it never jumps or skews
      if (record.rotation && record.rotation !== 0) {
        const currentDist = Math.hypot(e.clientX - centerScreenX, e.clientY - centerScreenY);
        const scale = currentDist / initialDist;
        newW = Math.max(minAllowedW, Math.min(maxAllowedW, Math.round(startW * scale)));
        newH = Math.round(newW / record.aspectRatio);
        newX = Math.round(initX - (newW - startW) / 2);
        newY = Math.round(initY - (newH - startH) / 2);
      } else {
        // Standard cardinal corner resizing when unrotated
        if (corner === 'br') {
          const dx = e.clientX - startX;
          newW = Math.max(minAllowedW, Math.min(maxAllowedW, startW + dx));
          newH = Math.round(newW / record.aspectRatio);
          newX = initX;
          newY = initY;
        } else if (corner === 'tl') {
          const dx = startX - e.clientX;
          newW = Math.max(minAllowedW, Math.min(maxAllowedW, startW + dx));
          newH = Math.round(newW / record.aspectRatio);
          newX = initX - (newW - startW);
          newY = initY - (newH - startH);
        } else if (corner === 'tr') {
          const dx = e.clientX - startX;
          newW = Math.max(minAllowedW, Math.min(maxAllowedW, startW + dx));
          newH = Math.round(newW / record.aspectRatio);
          newX = initX;
          newY = initY - (newH - startH);
        } else if (corner === 'bl') {
          const dx = startX - e.clientX;
          newW = Math.max(minAllowedW, Math.min(maxAllowedW, startW + dx));
          newH = Math.round(newW / record.aspectRatio);
          newX = initX - (newW - startW);
          newY = initY;
        }
      }

      record.width = newW;
      record.height = newH;
      record.x = newX;
      record.y = newY;
      record.domNode.style.width = `${newW}px`;
      record.domNode.style.height = `${newH}px`;
      record.domNode.style.left = `${newX}px`;
      record.domNode.style.top = `${newY}px`;
      if (record.type === 'image') {
        scheduleLiveRedither(record);
      }
    });

    const stopResize = (e) => {
      if (isResizing) {
        isResizing = false;
        try {
          handle.releasePointerCapture(e.pointerId);
        } catch (ignored) {}
        if (record.type === 'image') {
          recalculateImageDithering(record);
        }
        renderLayersPanel();
        triggerAutoSave();
      }
    };

    handle.addEventListener('pointerup', stopResize);
    handle.addEventListener('pointercancel', stopResize);
  }

  // --------------------------------------------------------------------------
  // Rotation Handle Listener (Interactive Touch/Mouse Knob)
  // --------------------------------------------------------------------------
  function attachRotateListener(handle, record) {
    let isRotating = false;
    let centerScreenX = 0;
    let centerScreenY = 0;
    let startAngle = 0;
    let initialRotation = 0;

    handle.addEventListener('pointerdown', (e) => {
      if (record.locked) return;
      isRotating = true;
      const rect = record.domNode.getBoundingClientRect();
      centerScreenX = rect.left + rect.width / 2;
      centerScreenY = rect.top + rect.height / 2;
      initialRotation = record.rotation || 0;
      startAngle = Math.atan2(e.clientY - centerScreenY, e.clientX - centerScreenX) * 180 / Math.PI;

      handle.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });

    handle.addEventListener('pointermove', (e) => {
      if (!isRotating) return;
      const currentAngle = Math.atan2(e.clientY - centerScreenY, e.clientX - centerScreenX) * 180 / Math.PI;
      let delta = currentAngle - startAngle;
      let angle = (initialRotation + delta) % 360;
      if (angle < 0) angle += 360;

      // Magnetic snap to cardinal 45° and 90° angles within 5 degrees
      for (let snap = 0; snap < 360; snap += 45) {
        if (Math.abs(angle - snap) < 5 || Math.abs(angle - snap) > 355) {
          angle = snap;
          break;
        }
      }

      record.rotation = Math.round(angle);
      record.domNode.style.transform = `rotate(${record.rotation}deg)`;
      updateInspectorRotateBadge(record.rotation);
    });

    const stopRotate = (e) => {
      if (isRotating) {
        isRotating = false;
        try {
          handle.releasePointerCapture(e.pointerId);
        } catch (ignored) {}
        renderLayersPanel();
        triggerAutoSave();
      }
    };

    handle.addEventListener('pointerup', stopRotate);
    handle.addEventListener('pointercancel', stopRotate);
  }

  // --------------------------------------------------------------------------
  // Selection & Inspector Controls
  // --------------------------------------------------------------------------
  function selectElement(record) {
    deselectAll();
    selectedElement = record;
    record.domNode.classList.add('selected');
    showInspector(record);
    highlightLayerInPanel(record.id);
  }

  function deselectAll() {
    elements.forEach(r => r.domNode.classList.remove('selected'));
    selectedElement = null;
    hideInspector();
    clearLayerHighlightInPanel();
  }

  function showInspector(record) {
    if (!elementControls) return;
    elementControls.classList.remove('hidden');

    const isText = record.type === 'text';
    const isImage = record.type === 'image';
    if (btnAlignLeft) btnAlignLeft.style.display = isText ? 'inline-flex' : 'none';
    if (btnAlignCenter) btnAlignCenter.style.display = isText ? 'inline-flex' : 'none';
    if (btnAlignRight) btnAlignRight.style.display = isText ? 'inline-flex' : 'none';

    if (btnSizeDown) btnSizeDown.textContent = isText ? 'A-' : '−';
    if (btnSizeUp) btnSizeUp.textContent = isText ? 'A+' : '+';

    if (btnTextColor) {
      btnTextColor.style.display = isText ? 'inline-flex' : 'none';
      if (isText) {
        updateTextColorIcon(record.color || (isBlackBg ? '#ffffff' : '#000000'));
      }
    }

    if (btnInvertImage) {
      btnInvertImage.style.display = isImage ? 'inline-flex' : 'none';
    }

    updateInspectorRotateBadge(record.rotation || 0);
  }

  function hideInspector() {
    if (elementControls) elementControls.classList.add('hidden');
  }

  function updateInspectorRotateBadge(deg) {
    if (rotateDegreeBadge) {
      rotateDegreeBadge.textContent = `${Math.round(deg || 0)}°`;
    }
  }

  function adjustSelectedSize(delta) {
    if (!selectedElement) return;
    if (selectedElement.type === 'text') {
      selectedElement.fontSize = Math.max(14, Math.min(120, selectedElement.fontSize + delta));
      selectedElement.contentNode.style.fontSize = `${selectedElement.fontSize}px`;
    } else if (selectedElement.type === 'image') {
      const factor = delta > 0 ? 1.15 : 0.87;
      const newW = Math.max(30, Math.min(2400, Math.round(selectedElement.width * factor)));
      const newH = Math.round(newW / selectedElement.aspectRatio);
      const oldW = selectedElement.width;
      const oldH = selectedElement.height;
      selectedElement.x = Math.round(selectedElement.x - (newW - oldW) / 2);
      selectedElement.y = Math.round(selectedElement.y - (newH - oldH) / 2);
      selectedElement.width = newW;
      selectedElement.height = newH;
      selectedElement.domNode.style.width = `${newW}px`;
      selectedElement.domNode.style.height = `${newH}px`;
      selectedElement.domNode.style.left = `${selectedElement.x}px`;
      selectedElement.domNode.style.top = `${selectedElement.y}px`;
      recalculateImageDithering(selectedElement);
      renderLayersPanel();
    }
    triggerAutoSave();
  }

  function rotateSelectedBy(delta) {
    if (!selectedElement) return;
    let angle = ((selectedElement.rotation || 0) + delta) % 360;
    if (angle < 0) angle += 360;
    selectedElement.rotation = Math.round(angle);
    selectedElement.domNode.style.transform = `rotate(${selectedElement.rotation}deg)`;
    updateInspectorRotateBadge(selectedElement.rotation);
    renderLayersPanel();
    triggerAutoSave();
  }

  function setSelectedAlign(align) {
    if (!selectedElement || selectedElement.type !== 'text') return;
    selectedElement.align = align;
    selectedElement.contentNode.style.textAlign = align;
    triggerAutoSave();
  }

  function deleteSelectedElement() {
    if (!selectedElement) return;
    const delId = selectedElement.id;
    selectedElement.domNode.remove();
    elements = elements.filter(r => r.id !== delId);
    deselectAll();
    syncDOMZIndex();
    renderLayersPanel();
    triggerAutoSave();
  }

  function updateTextColorIcon(color) {
    if (textColorLabel) {
      textColorLabel.textContent = color === '#ffffff' ? 'Text: White' : 'Text: Black';
    }
  }

  function toggleSelectedTextColor() {
    if (!selectedElement || selectedElement.type !== 'text') return;
    const curColor = selectedElement.color || (isBlackBg ? '#ffffff' : '#000000');
    const newColor = curColor === '#ffffff' ? '#000000' : '#ffffff';
    selectedElement.color = newColor;
    selectedElement.contentNode.style.color = newColor;
    updateTextColorIcon(newColor);
    triggerAutoSave();
  }

  function invertSelectedImage() {
    if (!selectedElement || selectedElement.type !== 'image') return;
    selectedElement.isInverted = !selectedElement.isInverted;
    recalculateImageDithering(selectedElement);
    renderLayersPanel();
    triggerAutoSave();
  }

  function setStageBgColor(black) {
    isBlackBg = !!black;
    if (isBlackBg) {
      if (stage) stage.classList.add('black-bg');
      if (btnBgColor) btnBgColor.classList.add('active');
      if (bgColorText) bgColorText.textContent = 'Bg: Black';
    } else {
      if (stage) stage.classList.remove('black-bg');
      if (btnBgColor) btnBgColor.classList.remove('active');
      if (bgColorText) bgColorText.textContent = 'Bg: White';
    }
  }

  function toggleStageBgColor() {
    setStageBgColor(!isBlackBg);
    triggerAutoSave();
  }

  // --------------------------------------------------------------------------
  // Auto-Save Session Persistence (localStorage)
  // --------------------------------------------------------------------------
  function triggerAutoSave() {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      saveActiveDraft();
    }, 250);
  }

  function saveActiveStickerToState() {
    const curSticker = project.stickers.find(s => s.id === project.activeId);
    if (!curSticker) return;
    curSticker.isBlackBg = isBlackBg;
    curSticker.elements = elements.map(el => {
      const isText = el.type === 'text';
      const domW = el.domNode ? el.domNode.offsetWidth : el.width;
      const domH = el.domNode ? el.domNode.offsetHeight : el.height;
      const textVal = isText ? (el.contentNode ? el.contentNode.innerText : el.text) : undefined;
      let textLines = undefined;
      if (isText && textVal) {
        textLines = textVal.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
      }
      return {
        id: el.id,
        name: el.name,
        type: el.type,
        x: el.x,
        y: el.y,
        rotation: el.rotation || 0,
        fontSize: el.fontSize,
        align: el.align,
        color: el.color,
        text: textVal,
        lines: textLines || el.lines,
        width: domW,
        height: domH,
        origW: el.origW || domW,
        origH: el.origH || domH,
        aspectRatio: el.aspectRatio,
        dataUrl: el.dataUrl,
        rawSrc: el.rawSrc,
        isInverted: !!el.isInverted,
        locked: !!el.locked,
        hidden: !!el.hidden,
        zIndex: el.zIndex
      };
    });
  }

  function saveActiveDraft() {
    saveActiveStickerToState();
    try {
      localStorage.setItem(STORAGE_PROJECT_KEY, JSON.stringify(project));
    } catch (err) {
      console.warn('LocalStorage project save failed:', err);
    }
  }

  function restoreActiveDraft() {
    try {
      const rawProject = localStorage.getItem(STORAGE_PROJECT_KEY);
      if (rawProject) {
        const parsed = JSON.parse(rawProject);
        if (parsed && Array.isArray(parsed.stickers) && parsed.stickers.length > 0) {
          project = parsed;
          if (!project.stickers.some(s => s.id === project.activeId)) {
            project.activeId = project.stickers[0].id;
          }
          loadActiveSticker();
          return;
        }
      }

      // Fallback: migrate legacy single-canvas draft
      const rawSingle = localStorage.getItem(STORAGE_DRAFT_KEY);
      if (rawSingle) {
        const singleState = JSON.parse(rawSingle);
        if (singleState && Array.isArray(singleState.elements) && singleState.elements.length > 0) {
          project = {
            activeId: 'stk_1',
            viewMode: 'single',
            stickers: [
              {
                id: 'stk_1',
                title: 'Sticker 1',
                isBlackBg: !!singleState.isBlackBg,
                elements: singleState.elements || []
              }
            ]
          };
          loadActiveSticker();
          saveActiveDraft();
          return;
        }
      }
    } catch (err) {
      console.warn('Failed to restore active draft:', err);
    }

    loadActiveSticker();
  }

  function loadActiveSticker() {
    const curSticker = project.stickers.find(s => s.id === project.activeId) || project.stickers[0];
    if (!curSticker) return;
    project.activeId = curSticker.id;
    restoreCanvasFromState(curSticker);
    updateStickerUI();
  }

  function updateStickerUI() {
    if (stickerTabs) {
      stickerTabs.innerHTML = project.stickers.map((s, idx) => {
        const isActive = s.id === project.activeId;
        return `<button class="sticker-tab ${isActive ? 'active' : ''}" data-id="${s.id}" title="${escapeHtml(s.title || 'Sticker ' + (idx + 1))}" type="button">${idx + 1}</button>`;
      }).join('');

      stickerTabs.querySelectorAll('.sticker-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          selectSticker(tab.dataset.id);
        });
      });
    }

    if (btnDeleteSticker) {
      btnDeleteSticker.disabled = project.stickers.length <= 1;
    }

    const activeIdx = project.stickers.findIndex(s => s.id === project.activeId);
    if (btnPrintLabel) {
      btnPrintLabel.textContent = project.stickers.length > 1
        ? `Print Sticker ${activeIdx + 1}`
        : 'Print to Desk';
    }

    if (btnPrintAll) {
      if (project.stickers.length > 1) {
        btnPrintAll.classList.remove('hidden');
        if (lblPrintAllCount) lblPrintAllCount.textContent = project.stickers.length;
      } else {
        btnPrintAll.classList.add('hidden');
      }
    }

    if (lblRollViewMode) {
      lblRollViewMode.textContent = project.viewMode === 'roll' ? 'Single View' : 'Roll View';
    }

    if (project.viewMode === 'roll') {
      renderRollViewContainer();
    } else {
      renderSingleViewContainer();
    }
  }

  function addNewSticker() {
    saveActiveStickerToState();
    const newIdx = project.stickers.length + 1;
    const newId = 'stk_' + Date.now();
    project.stickers.push({
      id: newId,
      title: `Sticker ${newIdx}`,
      isBlackBg: false,
      elements: []
    });
    project.activeId = newId;
    loadActiveSticker();
    triggerAutoSave();
  }

  function duplicateActiveSticker() {
    saveActiveStickerToState();
    const curSticker = project.stickers.find(s => s.id === project.activeId);
    if (!curSticker) return;
    const newId = 'stk_' + Date.now();
    const curIdx = project.stickers.indexOf(curSticker);
    const clonedElements = JSON.parse(JSON.stringify(curSticker.elements || []));
    clonedElements.forEach((el, i) => { el.id = i + 1; });
    const newSticker = {
      id: newId,
      title: `${curSticker.title || 'Sticker'} (Copy)`,
      isBlackBg: curSticker.isBlackBg,
      elements: clonedElements
    };
    project.stickers.splice(curIdx + 1, 0, newSticker);
    project.activeId = newId;
    loadActiveSticker();
    triggerAutoSave();
  }

  function deleteActiveSticker() {
    if (project.stickers.length <= 1) return;
    const curIdx = project.stickers.findIndex(s => s.id === project.activeId);
    if (curIdx < 0) return;
    project.stickers.splice(curIdx, 1);
    const nextIdx = Math.min(curIdx, project.stickers.length - 1);
    project.activeId = project.stickers[nextIdx].id;
    loadActiveSticker();
    triggerAutoSave();
  }

  function selectSticker(id) {
    if (id === project.activeId) return;
    saveActiveStickerToState();
    project.activeId = id;
    loadActiveSticker();
    triggerAutoSave();
  }

  function toggleRollView() {
    saveActiveStickerToState();
    project.viewMode = project.viewMode === 'roll' ? 'single' : 'roll';
    updateStickerUI();
    triggerAutoSave();
  }

  function renderRollViewContainer() {
    if (!canvasContainer) return;
    canvasContainer.classList.add('roll-mode');
    canvasContainer.innerHTML = '';

    project.stickers.forEach((sticker, idx) => {
      if (idx > 0) {
        const perfGuide = document.createElement('div');
        perfGuide.className = 'perforation-guide';
        perfGuide.innerHTML = `
          <div class="perforation-line"></div>
          <span class="perforation-label">Tear-Off Perforation &bull; Sticker ${idx} / ${idx + 1}</span>
        `;
        canvasContainer.appendChild(perfGuide);
      }

      if (sticker.id === project.activeId) {
        stage.classList.add('active-stage');
        stage.dataset.stickerIdx = idx;
        canvasContainer.appendChild(stage);
      } else {
        const prevStage = document.createElement('div');
        prevStage.className = `thermal-stage ${sticker.isBlackBg ? 'black-bg' : ''}`;
        prevStage.dataset.stickerId = sticker.id;
        prevStage.dataset.stickerIdx = idx;
        prevStage.title = `Click to edit ${sticker.title || 'Sticker ' + (idx + 1)}`;
        prevStage.style.cursor = 'pointer';

        const previewLayer = document.createElement('div');
        previewLayer.className = 'elements-layer';
        previewLayer.style.pointerEvents = 'none';

        for (const item of (sticker.elements || [])) {
          if (item.hidden) continue;
          if (item.type === 'text') {
            const textWrap = document.createElement('div');
            textWrap.className = 'canvas-element';
            textWrap.style.left = `${item.x}px`;
            textWrap.style.top = `${item.y}px`;
            if (item.width) textWrap.style.width = `${item.width}px`;
            textWrap.style.transform = `rotate(${item.rotation || 0}deg)`;

            const textContent = document.createElement('div');
            textContent.className = 'canvas-text-content';
            textContent.style.fontSize = `${item.fontSize || 24}px`;
            textContent.style.color = item.color || (sticker.isBlackBg ? '#ffffff' : '#000000');
            textContent.style.textAlign = item.align || 'center';
            textContent.innerText = item.text || '';

            textWrap.appendChild(textContent);
            previewLayer.appendChild(textWrap);
          } else if (item.type === 'image' && item.dataUrl) {
            const imgNode = document.createElement('img');
            imgNode.className = 'canvas-element image-element';
            imgNode.src = item.dataUrl;
            imgNode.style.left = `${item.x}px`;
            imgNode.style.top = `${item.y}px`;
            imgNode.style.width = `${item.width || 200}px`;
            imgNode.style.height = `${item.height || 200}px`;
            imgNode.style.transform = `rotate(${item.rotation || 0}deg)`;
            previewLayer.appendChild(imgNode);
          }
        }

        prevStage.appendChild(previewLayer);

        const wm = document.createElement('div');
        wm.className = 'stage-watermark unselectable';
        wm.textContent = `Sticker ${idx + 1} of ${project.stickers.length}`;
        prevStage.appendChild(wm);

        prevStage.addEventListener('click', () => {
          selectSticker(sticker.id);
        });

        canvasContainer.appendChild(prevStage);
      }
    });
  }

  function renderSingleViewContainer() {
    if (!canvasContainer) return;
    canvasContainer.classList.remove('roll-mode');
    canvasContainer.innerHTML = '';
    stage.classList.remove('active-stage');
    canvasContainer.appendChild(stage);
  }

  function restoreCanvasFromState(state) {
    deselectAll();
    elementsContainer.innerHTML = '';
    elements = [];
    nextElementId = 1;

    if (state.isBlackBg !== undefined) {
      setStageBgColor(!!state.isBlackBg);
    }

    for (const item of (state.elements || [])) {
      if (item.type === 'text') {
        addTextElement(item.text || '', item.x, item.y, item.fontSize || 24, item.align || 'center', item.rotation || 0, item.color, item.name, item.locked, item.hidden);
      } else if (item.type === 'image' && (item.rawSrc || item.dataUrl)) {
        addImageElement(item.dataUrl, item.origW || item.width || 200, item.origH || item.height || 200, item.rotation || 0, item.width, item.height, item.x, item.y, item.rawSrc, item.isInverted, item.name, item.locked, item.hidden);
      }
    }
    deselectAll();
    syncDOMZIndex();
    renderLayersPanel();
  }

  // --------------------------------------------------------------------------
  // Inkscape Layers & Objects System
  // --------------------------------------------------------------------------

  function getDefaultLayerName(item) {
    if (item.name) return item.name;
    if (item.type === 'text') {
      const txt = item.text || (item.contentNode ? item.contentNode.innerText : '');
      const clean = txt.replace(/[\r\n\s]+/g, ' ').trim();
      return clean.length > 0 ? `Text: "${clean.slice(0, 16)}${clean.length > 16 ? '...' : ''}"` : 'Text Box';
    } else if (item.type === 'image') {
      return `Image (${Math.round(item.width)}×${Math.round(item.height)})`;
    }
    return 'Layer ' + item.id;
  }

  function syncDOMZIndex() {
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      el.zIndex = i + 1;
      if (el.domNode) {
        el.domNode.style.zIndex = i + 1;
        elementsContainer.appendChild(el.domNode);
      }
    }
  }

  function highlightLayerInPanel(id) {
    if (!layersContainer) return;
    layersContainer.querySelectorAll('.layer-item').forEach(row => {
      if (row.dataset.id === id) {
        row.classList.add('active-layer');
        row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        row.classList.remove('active-layer');
      }
    });
    if (btnLayerTop) btnLayerTop.disabled = false;
    if (btnLayerUp) btnLayerUp.disabled = false;
    if (btnLayerDown) btnLayerDown.disabled = false;
    if (btnLayerBottom) btnLayerBottom.disabled = false;
    if (btnLayerDuplicate) btnLayerDuplicate.disabled = false;
    if (btnLayerDelete) btnLayerDelete.disabled = false;
  }

  function clearLayerHighlightInPanel() {
    if (!layersContainer) return;
    layersContainer.querySelectorAll('.layer-item').forEach(row => {
      row.classList.remove('active-layer');
    });
    if (btnLayerTop) btnLayerTop.disabled = true;
    if (btnLayerUp) btnLayerUp.disabled = true;
    if (btnLayerDown) btnLayerDown.disabled = true;
    if (btnLayerBottom) btnLayerBottom.disabled = true;
    if (btnLayerDuplicate) btnLayerDuplicate.disabled = true;
    if (btnLayerDelete) btnLayerDelete.disabled = true;
  }

  function renderLayersPanel() {
    const count = elements.length;
    if (layersBadge) layersBadge.textContent = count;
    if (tabLayersCount) tabLayersCount.textContent = count;

    const hasSelection = !!selectedElement;
    if (btnLayerTop) btnLayerTop.disabled = !hasSelection;
    if (btnLayerUp) btnLayerUp.disabled = !hasSelection;
    if (btnLayerDown) btnLayerDown.disabled = !hasSelection;
    if (btnLayerBottom) btnLayerBottom.disabled = !hasSelection;
    if (btnLayerDuplicate) btnLayerDuplicate.disabled = !hasSelection;
    if (btnLayerDelete) btnLayerDelete.disabled = !hasSelection;

    if (!layersContainer) return;

    if (count === 0) {
      layersContainer.innerHTML = `
        <div class="layers-empty">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
            <polyline points="2 17 12 22 22 17"></polyline>
            <polyline points="2 12 12 17 22 12"></polyline>
          </svg>
          <strong style="display:block; margin: 4px 0; color: var(--text-primary);">No layers yet</strong>
          <span>Add text or images using the toolbar above or below.</span>
        </div>
      `;
      return;
    }

    // Inkscape order: Top of UI list is the TOPMOST element (front, highest z-index)
    let html = '';
    for (let i = count - 1; i >= 0; i--) {
      const item = elements[i];
      const isSelected = selectedElement && selectedElement.id === item.id;
      const isHidden = !!item.hidden;
      const isLocked = !!item.locked;
      const name = getDefaultLayerName(item);

      const eyeIconSvg = isHidden
        ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`
        : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;

      const lockIconSvg = isLocked
        ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`
        : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`;

      let badgeHtml = '';
      if (item.type === 'image') {
        const thumbSrc = item.dataUrl || item.rawSrc;
        badgeHtml = `<div class="layer-badge-icon" title="Image element"><img class="layer-thumb-img" src="${thumbSrc}" alt="img" /></div>`;
      } else {
        badgeHtml = `<div class="layer-badge-icon" title="Text element">T</div>`;
      }

      html += `
        <div class="layer-item ${isSelected ? 'active-layer' : ''} ${isHidden ? 'layer-hidden' : ''} ${isLocked ? 'layer-locked' : ''}" 
             data-id="${item.id}" 
             data-index="${i}"
             draggable="true">
          <span class="layer-drag-handle" title="Drag to reorder layer stack">&#x283F;</span>
          <button class="layer-btn-icon btn-toggle-vis" type="button" title="${isHidden ? 'Show layer' : 'Hide layer'}" data-action="visibility">
            ${eyeIconSvg}
          </button>
          <button class="layer-btn-icon btn-toggle-lock ${isLocked ? 'active-lock' : ''}" type="button" title="${isLocked ? 'Unlock layer' : 'Lock layer'}" data-action="lock">
            ${lockIconSvg}
          </button>
          ${badgeHtml}
          <span class="layer-name" title="Double click to rename">${escapeHtml(name)}</span>
          <button class="layer-quick-del" type="button" title="Delete layer" data-action="delete">&#10005;</button>
        </div>
      `;
    }

    layersContainer.innerHTML = html;

    const rows = layersContainer.querySelectorAll('.layer-item');
    rows.forEach(row => {
      const id = row.dataset.id;
      const record = elements.find(e => e.id === id);
      if (!record) return;

      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-action]') || e.target.classList.contains('layer-name-input')) return;
        selectElement(record);
      });

      const nameSpan = row.querySelector('.layer-name');
      if (nameSpan) {
        nameSpan.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          const currentName = record.name || getDefaultLayerName(record);
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'layer-name-input';
          input.value = currentName;
          nameSpan.replaceWith(input);
          input.focus();
          input.select();

          const save = () => {
            const val = input.value.trim();
            if (val) {
              record.name = val;
            }
            renderLayersPanel();
            triggerAutoSave();
          };

          input.addEventListener('keydown', (ke) => {
            if (ke.key === 'Enter') {
              save();
            } else if (ke.key === 'Escape') {
              renderLayersPanel();
            }
          });
          input.addEventListener('blur', save);
        });
      }

      const visBtn = row.querySelector('.btn-toggle-vis');
      if (visBtn) {
        visBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleLayerVisibility(id);
        });
      }

      const lockBtn = row.querySelector('.btn-toggle-lock');
      if (lockBtn) {
        lockBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleLayerLock(id);
        });
      }

      const delBtn = row.querySelector('.layer-quick-del');
      if (delBtn) {
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteLayer(id);
        });
      }

      row.addEventListener('dragstart', (e) => {
        draggedLayerId = id;
        e.dataTransfer.effectAllowed = 'move';
        row.style.opacity = '0.5';
      });

      row.addEventListener('dragend', () => {
        draggedLayerId = null;
        row.style.opacity = '1';
        rows.forEach(r => {
          r.classList.remove('drag-over-top', 'drag-over-bottom');
        });
      });

      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = row.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          row.classList.add('drag-over-top');
          row.classList.remove('drag-over-bottom');
        } else {
          row.classList.add('drag-over-bottom');
          row.classList.remove('drag-over-top');
        }
      });

      row.addEventListener('dragleave', () => {
        row.classList.remove('drag-over-top', 'drag-over-bottom');
      });

      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drag-over-top', 'drag-over-bottom');
        if (!draggedLayerId || draggedLayerId === id) return;

        const srcIdx = elements.findIndex(el => el.id === draggedLayerId);
        const targetIdx = elements.findIndex(el => el.id === id);
        if (srcIdx < 0 || targetIdx < 0) return;

        const rect = row.getBoundingClientRect();
        const dropAbove = e.clientY < (rect.top + rect.height / 2);

        const item = elements.splice(srcIdx, 1)[0];
        let newIdx = elements.findIndex(el => el.id === id);
        if (dropAbove) {
          newIdx += 1;
        }
        elements.splice(newIdx, 0, item);
        syncDOMZIndex();
        renderLayersPanel();
        triggerAutoSave();
      });
    });
  }

  function toggleLayerVisibility(id) {
    const record = elements.find(e => e.id === id);
    if (!record) return;
    record.hidden = !record.hidden;
    if (record.domNode) {
      record.domNode.style.display = record.hidden ? 'none' : '';
    }
    if (record.hidden && selectedElement && selectedElement.id === id) {
      deselectAll();
    }
    renderLayersPanel();
    triggerAutoSave();
  }

  function toggleLayerLock(id) {
    const record = elements.find(e => e.id === id);
    if (!record) return;
    record.locked = !record.locked;
    if (record.domNode) {
      if (record.locked) {
        record.domNode.classList.add('element-locked');
      } else {
        record.domNode.classList.remove('element-locked');
      }
    }
    renderLayersPanel();
    triggerAutoSave();
  }

  function deleteLayer(id) {
    const record = elements.find(e => e.id === id);
    if (!record) return;
    if (selectedElement && selectedElement.id === id) {
      deselectAll();
    }
    if (record.domNode) record.domNode.remove();
    elements = elements.filter(e => e.id !== id);
    syncDOMZIndex();
    renderLayersPanel();
    triggerAutoSave();
  }

  function moveSelectedLayerUp() {
    if (!selectedElement) return;
    const idx = elements.findIndex(e => e.id === selectedElement.id);
    if (idx < 0 || idx >= elements.length - 1) return;
    const temp = elements[idx];
    elements[idx] = elements[idx + 1];
    elements[idx + 1] = temp;
    syncDOMZIndex();
    renderLayersPanel();
    triggerAutoSave();
  }

  function moveSelectedLayerDown() {
    if (!selectedElement) return;
    const idx = elements.findIndex(e => e.id === selectedElement.id);
    if (idx <= 0) return;
    const temp = elements[idx];
    elements[idx] = elements[idx - 1];
    elements[idx - 1] = temp;
    syncDOMZIndex();
    renderLayersPanel();
    triggerAutoSave();
  }

  function moveSelectedLayerToTop() {
    if (!selectedElement) return;
    const idx = elements.findIndex(e => e.id === selectedElement.id);
    if (idx < 0 || idx === elements.length - 1) return;
    const item = elements.splice(idx, 1)[0];
    elements.push(item);
    syncDOMZIndex();
    renderLayersPanel();
    triggerAutoSave();
  }

  function moveSelectedLayerToBottom() {
    if (!selectedElement) return;
    const idx = elements.findIndex(e => e.id === selectedElement.id);
    if (idx <= 0) return;
    const item = elements.splice(idx, 1)[0];
    elements.unshift(item);
    syncDOMZIndex();
    renderLayersPanel();
    triggerAutoSave();
  }

  function duplicateSelectedLayer() {
    if (!selectedElement) return;
    const el = selectedElement;
    if (el.type === 'text') {
      const offset = 20;
      const newX = Math.min(CANVAS_WIDTH - 80, el.x + offset);
      const newY = Math.min(CANVAS_HEIGHT - 60, el.y + offset);
      const copy = addTextElement(el.contentNode ? el.contentNode.innerText : el.text, newX, newY, el.fontSize, el.align, el.rotation, el.color, `${el.name || 'Text'} (Copy)`);
      selectElement(copy);
    } else if (el.type === 'image') {
      const offset = 20;
      const newX = Math.min(CANVAS_WIDTH - 80, el.x + offset);
      const newY = Math.min(CANVAS_HEIGHT - 60, el.y + offset);
      const copy = addImageElement(el.dataUrl, el.origW || el.width, el.origH || el.height, el.rotation, el.width, el.height, newX, newY, el.rawSrc, el.isInverted, `${el.name || 'Image'} (Copy)`);
      selectElement(copy);
    }
    triggerAutoSave();
  }

  function switchSidebarTab(tabName) {
    activeSidebarTab = tabName;
    if (tabName === 'layers') {
      if (tabLayers) tabLayers.classList.add('active');
      if (tabHistory) tabHistory.classList.remove('active');
      if (layersPanelView) layersPanelView.style.display = 'flex';
      if (historyPanelView) historyPanelView.style.display = 'none';
      renderLayersPanel();
    } else {
      if (tabHistory) tabHistory.classList.add('active');
      if (tabLayers) tabLayers.classList.remove('active');
      if (historyPanelView) historyPanelView.style.display = 'flex';
      if (layersPanelView) layersPanelView.style.display = 'none';
      renderHistorySidebar();
    }
  }

  function openSidebar(tabName) {
    if (tabName) switchSidebarTab(tabName);
    const sidebar = document.getElementById('historySidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (sidebar) sidebar.classList.add('open');
    if (backdrop) backdrop.classList.add('open');
  }

  function toggleSidebar(tabName) {
    const sidebar = document.getElementById('historySidebar');
    if (!sidebar) return;
    const isOpen = sidebar.classList.contains('open');

    if (!isOpen) {
      openSidebar(tabName);
    } else if (activeSidebarTab !== tabName) {
      switchSidebarTab(tabName);
    } else {
      closeHistorySidebar();
    }
  }

  // --------------------------------------------------------------------------
  // Past Canvases History System
  // --------------------------------------------------------------------------
  function loadHistoryFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_HISTORY_KEY);
      if (raw) {
        historyListItems = JSON.parse(raw) || [];
      }
    } catch (err) {
      historyListItems = [];
    }
    renderHistorySidebar();
  }

  function saveHistoryToStorage() {
    try {
      localStorage.setItem(STORAGE_HISTORY_KEY, JSON.stringify(historyListItems));
    } catch (err) {
      console.warn('Failed to save history to localStorage:', err);
    }
    renderHistorySidebar();
  }

  /**
   * Generates a lightweight 100x150 thumbnail snapshot from the current stage.
   */
  async function generateThumbnail() {
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = 100;
    thumbCanvas.height = 150;
    const ctx = thumbCanvas.getContext('2d');

    // Solid background matching stage
    ctx.fillStyle = isBlackBg ? '#000000' : '#ffffff';
    ctx.fillRect(0, 0, 100, 150);

    const scaleX = 100 / CANVAS_WIDTH;
    const scaleY = 150 / CANVAS_HEIGHT;

    for (const el of elements) {
      if (el.hidden) continue;
      if (el.type === 'image') {
        await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            const w = el.width * scaleX;
            const h = el.height * scaleY;
            const cx = (el.x * scaleX) + (w / 2);
            const cy = (el.y * scaleY) + (h / 2);

            ctx.save();
            ctx.translate(cx, cy);
            if (el.rotation) ctx.rotate(el.rotation * Math.PI / 180);
            ctx.drawImage(img, -w / 2, -h / 2, w, h);
            ctx.restore();
            resolve();
          };
          img.onerror = () => resolve();
          img.src = el.dataUrl;
        });
      } else if (el.type === 'text') {
        const fontSize = (el.fontSize || 24) * scaleX;
        ctx.font = `bold ${fontSize}px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;

        const thumbStartX = Math.max(0, el.x * scaleX);
        const availableThumbW = Math.max(25, 100 - thumbStartX - (2 * scaleX));

        const lines = getWrappedTextLines(ctx, el, availableThumbW);
        let maxLineWidth = 0;
        for (const l of lines) {
          if (!l) continue;
          const tw = ctx.measureText(l).width;
          if (tw > maxLineWidth) maxLineWidth = tw;
        }

        const paddingX = 2 * scaleX;
        const paddingY = 2 * scaleY;
        const thumbBoxW = Math.min(maxLineWidth + (paddingX * 2), availableThumbW);
        const lineHeight = fontSize * 1.25;
        const totalHeight = lines.length * lineHeight;
        const thumbBoxH = totalHeight + (paddingY * 2);

        const cx = thumbStartX + (thumbBoxW / 2);
        const cy = (el.y * scaleY) + (thumbBoxH / 2);

        ctx.save();
        ctx.translate(cx, cy);
        if (el.rotation) ctx.rotate(el.rotation * Math.PI / 180);

        ctx.fillStyle = el.color || (isBlackBg ? '#ffffff' : '#000000');
        const startY = -(thumbBoxH / 2) + paddingY + (fontSize * 0.88);

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line) continue;
          const y = startY + (i * lineHeight);
          const tw = ctx.measureText(line).width;

          if (el.align === 'center') {
            ctx.fillText(line, -(tw / 2), y);
          } else if (el.align === 'right') {
            const rightEdge = (thumbBoxW / 2) - paddingX;
            ctx.fillText(line, rightEdge - tw, y);
          } else {
            const leftEdge = -(thumbBoxW / 2) + paddingX;
            ctx.fillText(line, leftEdge, y);
          }
        }
        ctx.restore();
      }
    }

    return thumbCanvas.toDataURL('image/jpeg', 0.85);
  }

  async function saveSnapshotToHistory(reason = 'Saved') {
    if (elements.length === 0) return null;

    const thumb = await generateThumbnail();
    const textSummary = elements
      .filter(e => e.type === 'text')
      .map(e => (e.contentNode ? e.contentNode.innerText.trim() : e.text || ''))
      .filter(t => t.length > 0)
      .join(' | ') || (elements.some(e => e.type === 'image') ? 'Image Composition' : 'Untitled Label');

    const serializedElements = elements.map(el => {
      const isText = el.type === 'text';
      const domW = el.domNode ? el.domNode.offsetWidth : el.width;
      const domH = el.domNode ? el.domNode.offsetHeight : el.height;
      let domLines = undefined;
      if (isText && el.contentNode) {
        try {
          domLines = extractLinesFromDom(el.contentNode);
        } catch (ignored) {}
      }
      return {
        id: el.id,
        name: el.name,
        type: el.type,
        x: el.x,
        y: el.y,
        rotation: el.rotation || 0,
        fontSize: el.fontSize,
        align: el.align,
        color: el.color,
        text: isText ? (el.contentNode ? el.contentNode.innerText : el.text) : undefined,
        lines: domLines || el.lines,
        width: domW,
        height: domH,
        origW: el.origW || domW,
        origH: el.origH || domH,
        aspectRatio: el.aspectRatio,
        dataUrl: el.dataUrl,
        rawSrc: el.rawSrc,
        isInverted: !!el.isInverted,
        locked: !!el.locked,
        hidden: !!el.hidden,
        zIndex: el.zIndex
      };
    });

    const snapshotId = 'snap_' + Date.now();
    const snapshot = {
      id: snapshotId,
      timestamp: Date.now(),
      summary: textSummary,
      elementCount: elements.length,
      isBlackBg,
      thumbnail: thumb,
      elements: serializedElements
    };

    historyListItems.unshift(snapshot);
    if (historyListItems.length > 30) {
      historyListItems = historyListItems.slice(0, 30);
    }

    activeSnapshotId = snapshotId;
    saveHistoryToStorage();
    return snapshotId;
  }

  function loadSnapshot(snapshotId) {
    const snap = historyListItems.find(s => s.id === snapshotId);
    if (!snap) return;

    // Auto-save current work first if not already saved
    if (elements.length > 0 && activeSnapshotId !== snapshotId) {
      saveSnapshotToHistory('Draft Auto-Archive');
    }

    activeSnapshotId = snapshotId;
    restoreCanvasFromState(snap);
    triggerAutoSave();
    renderHistorySidebar();
    closeHistorySidebar();
  }

  function deleteSnapshot(snapshotId, e) {
    if (e) e.stopPropagation();
    historyListItems = historyListItems.filter(s => s.id !== snapshotId);
    if (activeSnapshotId === snapshotId) activeSnapshotId = null;
    saveHistoryToStorage();
  }

  function startNewCanvas() {
    if (elements.length > 0) {
      saveSnapshotToHistory('Saved Before New');
    }
    project = {
      activeId: 'stk_1',
      viewMode: 'single',
      stickers: [
        {
          id: 'stk_1',
          title: 'Sticker 1',
          isBlackBg: false,
          elements: []
        }
      ]
    };
    activeSnapshotId = null;
    loadActiveSticker();
    saveActiveDraft();
    renderHistorySidebar();
    closeHistorySidebar();
  }

  function renderHistorySidebar() {
    const container = document.getElementById('historyContainer');
    const badge = document.getElementById('historyBadge');
    if (badge) {
      badge.textContent = historyListItems.length;
    }
    if (!container) return;

    if (historyListItems.length === 0) {
      container.innerHTML = `
        <div class="history-empty">
          <strong style="display:block; margin: 4px 0; color: var(--text-primary);">No saved labels</strong>
          <span>Labels you print or design will be saved here automatically.</span>
        </div>
      `;
      return;
    }

    container.innerHTML = historyListItems.map(item => {
      const dateStr = new Date(item.timestamp).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      const isActive = item.id === activeSnapshotId;

      return `
        <div class="history-card ${isActive ? 'active' : ''}" data-id="${item.id}">
          <img src="${item.thumbnail}" class="history-card-thumb" alt="Thumbnail" />
          <div class="history-card-body">
            <div class="history-card-date">${dateStr}</div>
            <div class="history-card-snippet" title="${escapeHtml(item.summary)}">${escapeHtml(item.summary)}</div>
            <div class="history-card-footer">
              <span class="history-elem-badge">${item.elementCount} elem${item.elementCount === 1 ? '' : 's'}</span>
              <button class="btn-delete-history" data-delete-id="${item.id}" title="Delete this label">&#10005;</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Attach card click listeners
    const cards = container.querySelectorAll('.history-card');
    cards.forEach(card => {
      card.addEventListener('click', (e) => {
        const delBtn = e.target.closest('.btn-delete-history');
        if (delBtn) {
          const delId = delBtn.dataset.deleteId;
          deleteSnapshot(delId, e);
          return;
        }
        const id = card.dataset.id;
        loadSnapshot(id);
      });
    });
  }

  function toggleHistorySidebar() {
    const sidebar = document.getElementById('historySidebar');
    if (!sidebar) return;
    const isOpen = sidebar.classList.contains('open');
    if (isOpen) {
      closeHistorySidebar();
    } else {
      openHistorySidebar();
    }
  }

  function openHistorySidebar() {
    const sidebar = document.getElementById('historySidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (sidebar) sidebar.classList.add('open');
    if (backdrop) backdrop.classList.add('open');
  }

  function closeHistorySidebar() {
    const sidebar = document.getElementById('historySidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (sidebar) sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

  // --------------------------------------------------------------------------
  // Bridge Telemetry & Hardware Control Panel
  // --------------------------------------------------------------------------
  function initBridgeMonitoring() {
    // Zero automatic background polling on load to preserve Cloudflare Worker free-tier quota.
    // Telemetry is fetched on-demand when the user opens the Console or submits a print job.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopBridgePolling();
      } else if (isControlPanelOpen) {
        fetchBridgeStatus();
        startBridgePolling(8000);
      }
    });
  }

  function startBridgePolling(ms) {
    stopBridgePolling();
    if (isControlPanelOpen && !document.hidden) {
      bridgePollInterval = setInterval(() => {
        if (isControlPanelOpen && !document.hidden) {
          fetchBridgeStatus();
        } else {
          stopBridgePolling();
        }
      }, ms);
    }
  }

  function stopBridgePolling() {
    if (bridgePollInterval) {
      clearInterval(bridgePollInterval);
      bridgePollInterval = null;
    }
  }

  async function fetchBridgeStatus() {
    try {
      const res = await fetch(`${WORKER_BASE_URL}/api/bridge/status?t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        currentBridgeStatus = {
          phoneOnline: !!data.phoneOnline,
          lastSeenSeconds: data.lastSeenSeconds,
          batteryLevel: data.batteryLevel,
          isCharging: !!data.isCharging,
          printerConnected: !!data.printerConnected,
          printerState: data.printerState || (data.printerConnected ? 'CONNECTED' : 'DISCONNECTED'),
          deviceAddress: data.deviceAddress,
          lastError: data.lastError,
          lastUpdated: Date.now()
        };
        updateBridgeUI();
      }
    } catch (err) {
      console.warn('Bridge status poll failed:', err);
    }
  }

  function updateBridgeUI() {
    // 1. Header status pill
    if (btnBridgeStatus && bridgeStatusText) {
      btnBridgeStatus.classList.remove('status-connected', 'status-warning', 'status-offline', 'status-checking');
      if (currentBridgeStatus.printerConnected) {
        btnBridgeStatus.classList.add('status-connected');
        bridgeStatusText.textContent = 'Desk Node: Online';
        btnBridgeStatus.title = 'Desk physical node connected. Click for Console.';
      } else if (currentBridgeStatus.phoneOnline) {
        btnBridgeStatus.classList.add('status-warning');
        bridgeStatusText.textContent = 'Desk Node: Standby';
        btnBridgeStatus.title = 'Mobile uplink online, desk node standing by. Click to reconnect.';
      } else {
        btnBridgeStatus.classList.add('status-offline');
        bridgeStatusText.textContent = 'Uplink: Offline';
        btnBridgeStatus.title = 'Mobile uplink relay is offline. Click for Console.';
      }
    }

    // 2. Control panel diagnostics (if visible)
    if (isControlPanelOpen) {
      if (panelPhoneBadge) {
        panelPhoneBadge.className = `tile-status-badge ${currentBridgeStatus.phoneOnline ? 'badge-online' : 'badge-offline'}`;
        panelPhoneBadge.textContent = currentBridgeStatus.phoneOnline ? 'Online' : 'Offline';
      }
      if (panelPhoneLastSeen) {
        if (currentBridgeStatus.lastSeenSeconds === null || currentBridgeStatus.lastSeenSeconds === undefined) {
          panelPhoneLastSeen.textContent = 'Never';
        } else if (currentBridgeStatus.lastSeenSeconds < 10) {
          panelPhoneLastSeen.textContent = `Just now (${currentBridgeStatus.lastSeenSeconds}s)`;
        } else if (currentBridgeStatus.lastSeenSeconds < 60) {
          panelPhoneLastSeen.textContent = `${currentBridgeStatus.lastSeenSeconds}s ago`;
        } else {
          panelPhoneLastSeen.textContent = `${Math.round(currentBridgeStatus.lastSeenSeconds / 60)}m ago`;
        }
      }
      if (panelPhoneBattery) {
        if (currentBridgeStatus.batteryLevel !== null && currentBridgeStatus.batteryLevel !== undefined) {
          panelPhoneBattery.textContent = `${currentBridgeStatus.batteryLevel}%${currentBridgeStatus.isCharging ? ' (Charging)' : ''}`;
        } else {
          panelPhoneBattery.textContent = '--';
        }
      }

      if (panelPrinterBadge) {
        if (currentBridgeStatus.printerConnected) {
          panelPrinterBadge.className = 'tile-status-badge badge-connected';
          panelPrinterBadge.textContent = 'Connected';
        } else if (currentBridgeStatus.printerState === 'STANDBY') {
          panelPrinterBadge.className = 'tile-status-badge badge-standby';
          panelPrinterBadge.textContent = 'Standby (Auto-Wake)';
        } else if (currentBridgeStatus.printerState === 'CONNECTING') {
          panelPrinterBadge.className = 'tile-status-badge badge-warning';
          panelPrinterBadge.textContent = 'Connecting';
        } else {
          panelPrinterBadge.className = 'tile-status-badge badge-disconnected';
          panelPrinterBadge.textContent = 'Disconnected';
        }
      }
      if (panelPrinterState) {
        if (currentBridgeStatus.printerConnected) {
          panelPrinterState.textContent = 'Active (Printing Link Live)';
        } else if (currentBridgeStatus.printerState === 'STANDBY') {
          panelPrinterState.textContent = 'Standby (Auto-Connect On-Demand)';
        } else {
          panelPrinterState.textContent = currentBridgeStatus.printerState || '--';
        }
      }
      if (panelPowerState) {
        panelPowerState.textContent = 'Auto-Standby (90s idle)';
      }
      const activeMac = currentBridgeStatus.printerAddress || currentBridgeStatus.deviceAddress || '66:32:89:D2:0A:46';
      if (inputPrinterAddress && document.activeElement !== inputPrinterAddress) {
        inputPrinterAddress.value = activeMac;
      }
      if (panelPrinterAddress) {
        panelPrinterAddress.textContent = activeMac;
      }
      if (panelLogTime) {
        panelLogTime.textContent = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      }
    }
  }

  function openControlPanel() {
    isControlPanelOpen = true;
    if (controlPanelModal) controlPanelModal.classList.remove('hidden');
    fetchBridgeStatus();
    startBridgePolling(8000);
  }

  function closeControlPanel() {
    isControlPanelOpen = false;
    if (controlPanelModal) controlPanelModal.classList.add('hidden');
    stopBridgePolling();
  }

  async function sendBridgeCommand(action, params = {}) {
    appendPanelLog(`Dispatching command: ${action}...`, 'info');
    try {
      const res = await fetch(`${WORKER_BASE_URL}/api/bridge/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, params })
      });
      if (res.ok) {
        const data = await res.json();
        appendPanelLog(`Sent '${action}' [ID: ${data.commandId?.slice(0, 8) || 'ok'}]`, 'success');
        setTimeout(fetchBridgeStatus, 1500);
        setTimeout(fetchBridgeStatus, 4000);
      } else {
        const err = await res.json().catch(() => ({}));
        appendPanelLog(`Error sending '${action}': ${err.error || res.statusText}`, 'error');
      }
    } catch (err) {
      appendPanelLog(`Network error: ${err.message}`, 'error');
    }
  }

  function appendPanelLog(text, type = 'info') {
    if (!panelLogBox) return;
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const row = document.createElement('div');
    row.className = `log-entry ${type}`;
    row.textContent = `[${time}] ${text}`;
    panelLogBox.appendChild(row);
    panelLogBox.scrollTop = panelLogBox.scrollHeight;
  }

  // --------------------------------------------------------------------------
  // Pipeline Progress Tracking
  // --------------------------------------------------------------------------
  function updatePipeline(stage) {
    const steps = ['Render', 'Queue', 'Bridge', 'Print'];
    const stepEls = {
      Render: document.getElementById('stepRender'),
      Queue: document.getElementById('stepQueue'),
      Bridge: document.getElementById('stepBridge'),
      Print: document.getElementById('stepPrint')
    };
    const lines = {
      Render: document.getElementById('lineRenderQueue'),
      Queue: document.getElementById('lineQueueBridge'),
      Bridge: document.getElementById('lineBridgePrint')
    };

    const curIndex = steps.indexOf(stage);

    steps.forEach((name, idx) => {
      const el = stepEls[name];
      if (!el) return;
      el.classList.remove('active', 'done');
      if (idx < curIndex) {
        el.classList.add('done');
      } else if (idx === curIndex) {
        el.classList.add('active');
      }
    });

    if (lines.Render) lines.Render.classList.toggle('done', curIndex > 0);
    if (lines.Queue) lines.Queue.classList.toggle('done', curIndex > 1);
    if (lines.Bridge) lines.Bridge.classList.toggle('done', curIndex > 2);
  }

  function showModalAlert(title, desc, showReconnect = true) {
    if (!modalAlertBox) return;
    modalAlertBox.classList.remove('hidden');
    if (modalAlertTitle) modalAlertTitle.textContent = title;
    if (modalAlertDesc) modalAlertDesc.textContent = desc;
    if (btnModalReconnect) btnModalReconnect.style.display = showReconnect ? 'inline-block' : 'none';
    if (modalCloseBtn) modalCloseBtn.classList.remove('hidden');
    if (modalSpinner) modalSpinner.style.display = 'none';
  }

  function hideModalAlert() {
    if (modalAlertBox) modalAlertBox.classList.add('hidden');
    if (modalSpinner) modalSpinner.style.display = 'block';
  }

  // --------------------------------------------------------------------------
  // Composite & Submission to Cloudflare & Thermal Printer
  // --------------------------------------------------------------------------
  async function handlePrintSubmission(bypassBridgeCheck = false) {
    if (isSubmitting) return;
    deselectAll();
    saveActiveStickerToState();

    if (elements.length === 0) {
      alert("Please add some text or an image to print!");
      return;
    }

    // Auto-save snapshot into history on physical print
    saveSnapshotToHistory('Materialized Card');

    // Immediate dispatch without blocking pre-flight checks
    executePrintJob();
  }

  async function executePrintJob() {
    hideModalAlert();
    isSubmitting = true;
    btnPrint.disabled = true;
    if (btnPrintAll) btnPrintAll.disabled = true;

    saveActiveStickerToState();
    const curSticker = project.stickers.find(s => s.id === project.activeId) || project.stickers[0];
    const activeIdx = project.stickers.indexOf(curSticker);
    const labelTitle = project.stickers.length > 1 ? `Card ${activeIdx + 1} of ${project.stickers.length}` : 'Physical Card';

    showModal(`Synthesizing ${labelTitle}...`, 'Compositing monochrome dot matrix (800x1200)...', 25, 'Render');

    try {
      const pngDataUrl = await renderStickerToDataUrl(curSticker);

      updateModal('Queueing Transmission...', 'Dispatched payload to cloud pipeline...', 50, false, 'Queue');

      const textSummary = (curSticker.elements || [])
        .filter(e => e.type === 'text')
        .map(e => e.text || '')
        .filter(t => t.length > 0)
        .join(' | ') || (project.stickers.length > 1 ? `Card ${activeIdx + 1}` : 'Canvas Card');

      const speed = parseFloat(selectPrintSpeed?.value || localStorage.getItem('realtalk_print_speed') || '1.5');
      const density = parseInt(selectPrintDensity?.value || localStorage.getItem('realtalk_print_density') || '12', 10);
      const invert = (selectPrintPolarity?.value || localStorage.getItem('realtalk_print_polarity') || 'standard') === 'inverted';

      const response = await fetch(`${WORKER_BASE_URL}/api/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'canvas',
          imageData: pngDataUrl,
          text: textSummary,
          author: project.stickers.length > 1 ? `Card ${activeIdx + 1}/${project.stickers.length}` : 'Card',
          speed,
          density,
          invert
        })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${response.status}`);
      }

      const result = await response.json();
      modalJobId.textContent = `Job ID: ${result.id.slice(0, 8)}`;

      // Poll for physical print confirmation
      const relayDesc = currentBridgeStatus.printerConnected
        ? 'Mobile uplink received payload & transmitting to desk node...'
        : 'Mobile uplink received payload & auto-waking desk node...';
      updateModal('Relaying to Desk Node...', relayDesc, 75, false, 'Bridge');
      pollPrintStatus(result.id);

    } catch (err) {
      console.error(err);
      updateModal('Transmission Error', err.message || 'Failed to connect to cloud bridge', 100, true);
      isSubmitting = false;
      btnPrint.disabled = false;
      if (btnPrintAll) btnPrintAll.disabled = false;
    }
  }

  async function handleBatchPrintSubmission(bypassBridgeCheck = false) {
    if (isSubmitting) return;
    deselectAll();
    saveActiveStickerToState();

    if (project.stickers.length === 0) return;

    // Immediate dispatch without blocking pre-flight checks
    executeBatchPrintJob();
  }

  async function executeBatchPrintJob() {
    hideModalAlert();
    isSubmitting = true;
    btnPrint.disabled = true;
    if (btnPrintAll) btnPrintAll.disabled = true;

    const total = project.stickers.length;
    showModal('Transmitting Card Sequence...', `Synthesizing ${total} cards for physical manifestation...`, 15, 'Render');

    try {
      const speed = parseFloat(selectPrintSpeed?.value || localStorage.getItem('realtalk_print_speed') || '1.5');
      const density = parseInt(selectPrintDensity?.value || localStorage.getItem('realtalk_print_density') || '12', 10);
      const invert = (selectPrintPolarity?.value || localStorage.getItem('realtalk_print_polarity') || 'standard') === 'inverted';

      const quotesPayload = [];

      for (let i = 0; i < total; i++) {
        const sticker = project.stickers[i];
        const stepPct = Math.round(15 + ((i / total) * 55));
        updateModal(
          `Synthesizing Card ${i + 1} of ${total}`,
          `Compositing monochrome dot matrix (800x1200) for card ${i + 1}...`,
          stepPct,
          false,
          'Render'
        );

        const pngDataUrl = await renderStickerToDataUrl(sticker);

        const textSummary = (sticker.elements || [])
          .filter(e => e.type === 'text')
          .map(e => e.text || '')
          .filter(t => t.length > 0)
          .join(' | ') || `Card ${i + 1} of ${total}`;

        quotesPayload.push({
          type: 'canvas',
          imageData: pngDataUrl,
          text: textSummary,
          author: `Card ${i + 1}/${total}`,
          speed,
          density,
          invert
        });
      }

      updateModal(
        'Queueing Batch Transmission...',
        `Streaming ${total} cards to cloud pipeline in a single batch...`,
        75,
        false,
        'Queue'
      );

      const response = await fetch(`${WORKER_BASE_URL}/api/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quotes: quotesPayload })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${response.status}`);
      }

      const result = await response.json();
      const lastJobId = result.id || (result.ids && result.ids[result.ids.length - 1]);
      modalJobId.textContent = `Batch (${total} cards): ID ${lastJobId ? lastJobId.slice(0, 8) : 'ok'}`;

      updateModal(
        'Materializing Card Sequence...',
        `All ${total} cards queued. Desk node is materializing sequentially...`,
        85,
        false,
        'Bridge'
      );

      if (lastJobId) {
        pollPrintStatus(lastJobId);
      } else {
        updateModal('Manifestation Complete', `All ${total} cards dispatched to desk node!`, 100, true, 'Print');
        isSubmitting = false;
        btnPrint.disabled = false;
        if (btnPrintAll) btnPrintAll.disabled = false;
      }

    } catch (err) {
      console.error(err);
      updateModal('Sequence Transmission Error', err.message || 'Failed to dispatch card sequence', 100, true);
      isSubmitting = false;
      btnPrint.disabled = false;
      if (btnPrintAll) btnPrintAll.disabled = false;
    }
  }

  async function renderStickerToDataUrl(sticker) {
    const printCanvas = document.createElement('canvas');
    printCanvas.width = PRINT_WIDTH;
    printCanvas.height = PRINT_HEIGHT;
    const ctx = printCanvas.getContext('2d');

    // Fill background (White or Black)
    ctx.fillStyle = sticker.isBlackBg ? '#000000' : '#ffffff';
    ctx.fillRect(0, 0, PRINT_WIDTH, PRINT_HEIGHT);

    const scaleX = PRINT_WIDTH / CANVAS_WIDTH;
    const scaleY = PRINT_HEIGHT / CANVAS_HEIGHT;

    // Draw elements in stacking order (bottom to top)
    for (const el of (sticker.elements || [])) {
      if (el.hidden) continue;
      if (el.type === 'image' && (el.rawSrc || el.dataUrl)) {
        await drawImageElementToCanvas(ctx, el, scaleX, scaleY);
      } else if (el.type === 'text') {
        drawSerializedTextToCanvas(ctx, el, scaleX, scaleY, sticker.isBlackBg);
      }
    }

    // Subtle corner watermark
    ctx.fillStyle = sticker.isBlackBg ? '#ffffff' : '#000000';
    ctx.font = '16px monospace';
    const watermark = 'made by noahsmith.dev';
    const wmWidth = ctx.measureText(watermark).width;
    ctx.fillText(watermark, PRINT_WIDTH - wmWidth - 24, PRINT_HEIGHT - 20);

    // Strict 1-bit threshold pass to guarantee pure monochrome dots
    enforceStrictMonochrome(ctx, PRINT_WIDTH, PRINT_HEIGHT);

    return printCanvas.toDataURL('image/png');
  }

  function drawSerializedTextToCanvas(ctx, el, scaleX, scaleY, isStickerBlackBg) {
    const fontSize = (el.fontSize || 24) * scaleX;
    ctx.font = `bold ${fontSize}px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;

    const printStartX = Math.max(0, el.x * scaleX);
    // Allow text to use the full printable width up to the right edge (with 10px margin)
    const availablePaperW = Math.max(120 * scaleX, PRINT_WIDTH - printStartX - (10 * scaleX));

    const lines = getWrappedTextLines(ctx, el, availablePaperW);

    let maxLineWidth = 0;
    for (const l of lines) {
      if (!l) continue;
      const tw = ctx.measureText(l).width;
      if (tw > maxLineWidth) maxLineWidth = tw;
    }

    const paddingX = 6 * scaleX;
    const paddingY = 4 * scaleY;
    const printBoxW = Math.min(maxLineWidth + (paddingX * 2), availablePaperW);
    const lineHeight = fontSize * 1.25;
    const totalHeight = lines.length * lineHeight;
    const printBoxH = totalHeight + (paddingY * 2);

    const cx = printStartX + (printBoxW / 2);
    const cy = (el.y * scaleY) + (printBoxH / 2);

    ctx.save();
    ctx.translate(cx, cy);
    if (el.rotation) {
      ctx.rotate((el.rotation * Math.PI) / 180);
    }

    ctx.fillStyle = el.color || (isStickerBlackBg ? '#ffffff' : '#000000');
    const startY = -(printBoxH / 2) + paddingY + (fontSize * 0.88);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const y = startY + (i * lineHeight);
      const tw = ctx.measureText(line).width;

      if (el.align === 'center') {
        ctx.fillText(line, -(tw / 2), y);
      } else if (el.align === 'right') {
        const rightEdge = (printBoxW / 2) - paddingX;
        ctx.fillText(line, rightEdge - tw, y);
      } else {
        const leftEdge = -(printBoxW / 2) + paddingX;
        ctx.fillText(line, leftEdge, y);
      }
    }
    ctx.restore();
  }

  async function drawImageElementToCanvas(ctx, el, scaleX, scaleY) {
    if (el.hidden) return;

    const printW = Math.max(1, Math.round(el.width * scaleX));
    const printH = Math.max(1, Math.round(el.height * scaleY));
    const cx = (el.x * scaleX) + (printW / 2);
    const cy = (el.y * scaleY) + (printH / 2);

    let imgToDraw = null;
    if (el.rawSrc) {
      try {
        const rawImg = await loadImagePromise(el.rawSrc);
        imgToDraw = generateDitheredBitmap(rawImg, printW, printH, {
          useDither: isPhotoDither,
          isInverted: !!el.isInverted
        });
      } catch (err) {
        console.warn('Failed to redither rawSrc at printhead resolution, using fallback dataUrl:', err);
      }
    }

    if (!imgToDraw && el.dataUrl) {
      try {
        imgToDraw = await loadImagePromise(el.dataUrl);
      } catch (err) {
        return;
      }
    }

    if (!imgToDraw) return;

    ctx.save();
    ctx.translate(cx, cy);
    if (el.rotation) {
      ctx.rotate((el.rotation * Math.PI) / 180);
    }
    ctx.drawImage(imgToDraw, -printW / 2, -printH / 2, printW, printH);
    ctx.restore();
  }

  function enforceStrictMonochrome(ctx, w, h) {
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const v = lum < 140 ? 0 : 255;
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
      d[i + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  function pollPrintStatus(quoteId) {
    let checks = 0;
    const maxChecks = 16;

    const interval = setInterval(async () => {
      checks++;
      try {
        const res = await fetch(`${WORKER_BASE_URL}/api/quote/status?id=${quoteId}&t=${Date.now()}`);
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'printed') {
            clearInterval(interval);
            updateModal('Materialized!', 'Your creation has physically materialized onto paper at Noah\'s desk.', 100, true, 'Print');
            isSubmitting = false;
            btnPrint.disabled = false;
            if (btnPrintAll) btnPrintAll.disabled = false;
            return;
          }
        }
      } catch (ignored) {}

      if (checks >= maxChecks) {
        clearInterval(interval);
        updateModal('Queued for Manifestation', 'Your transmission is in the queue and will materialize as soon as the desk node checks in.', 100, true, 'Bridge');
        isSubmitting = false;
        btnPrint.disabled = false;
        if (btnPrintAll) btnPrintAll.disabled = false;
      }
    }, 1500);
  }

  function showModal(title, desc, progress, stage = 'Render') {
    if (!statusModal) return;
    statusModal.classList.remove('hidden');
    if (modalCloseBtn) modalCloseBtn.classList.add('hidden');
    if (modalSpinner) modalSpinner.style.display = 'block';
    if (modalTitle) modalTitle.textContent = title;
    if (modalDesc) modalDesc.textContent = desc;
    if (modalProgressBar) modalProgressBar.style.width = `${progress}%`;
    const alertBox = document.getElementById('modalAlertBox');
    if (alertBox) alertBox.classList.add('hidden');
    updatePipeline(stage);
  }

  function updateModal(title, desc, progress, showClose = false, stage = null) {
    if (!statusModal) return;
    if (modalTitle) modalTitle.textContent = title;
    if (modalDesc) modalDesc.textContent = desc;
    if (modalProgressBar) modalProgressBar.style.width = `${progress}%`;
    if (stage) updatePipeline(stage);
    if (showClose) {
      if (modalCloseBtn) modalCloseBtn.classList.remove('hidden');
      if (modalSpinner) modalSpinner.style.display = 'none';
    }
  }

  // Boot on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
