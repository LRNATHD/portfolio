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
  const elementsContainer = document.getElementById('elementsContainer');
  const btnAddText = document.getElementById('btnAddText');
  const imageInput = document.getElementById('imageInput');
  const btnPasteImage = document.getElementById('btnPasteImage');
  const btnBgColor = document.getElementById('btnBgColor');
  const bgColorText = document.getElementById('bgColorText');
  const btnClear = document.getElementById('btnClear');
  const btnPrint = document.getElementById('btnPrint');

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
  const btnRemoteReconnect = document.getElementById('btnRemoteReconnect');
  const btnRemoteDisconnect = document.getElementById('btnRemoteDisconnect');
  const btnRemotePrintTest = document.getElementById('btnRemotePrintTest');
  const btnRefreshBridgeStatus = document.getElementById('btnRefreshBridgeStatus');
  const panelLogBox = document.getElementById('panelLogBox');
  const panelLogTime = document.getElementById('panelLogTime');

  // History Sidebar DOM
  const historySidebar = document.getElementById('historySidebar');
  const historyContainer = document.getElementById('historyContainer');
  const historyBadge = document.getElementById('historyBadge');
  const btnToggleHistory = document.getElementById('btnToggleHistory');
  const btnSidebarClose = document.getElementById('btnSidebarClose');
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');
  const btnNewCanvasSidebar = document.getElementById('btnNewCanvasSidebar');

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
    setupKeyboardListener();
    loadHistoryFromStorage();
    restoreActiveDraft();
    initBridgeMonitoring();
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

    // Toggle History Drawer / Sidebar
    if (btnToggleHistory) {
      btnToggleHistory.addEventListener('click', () => {
        toggleHistorySidebar();
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
    if (imageInput) {
      imageInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
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
          alert("To paste an image: Press Cmd+V / Ctrl+V, or tap 'Add Image' to pick from gallery!");
        } catch (err) {
          alert("To paste an image: Press Cmd+V / Ctrl+V, or tap 'Add Image' to choose a photo!");
        }
      });
    }

    // Clear canvas
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        if (elements.length === 0) return;
        if (confirm("Clear this label? (Your previous labels remain safe in History)")) {
          startNewCanvas();
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
    if (btnRefreshBridgeStatus) {
      btnRefreshBridgeStatus.addEventListener('click', () => {
        fetchBridgeStatus();
      });
    }

    // Print Modal Alert buttons
    if (btnModalReconnect) {
      btnModalReconnect.addEventListener('click', async () => {
        btnModalReconnect.disabled = true;
        btnModalReconnect.textContent = 'Connecting...';
        if (modalAlertTitle) modalAlertTitle.textContent = 'Connecting to Printer...';
        if (modalAlertDesc) modalAlertDesc.textContent = 'Signal dispatched to phone. Establishing Bluetooth handshake...';

        await sendBridgeCommand('reconnect_printer');

        let attempts = 0;
        const connectCheckTimer = setInterval(async () => {
          attempts++;
          await fetchBridgeStatus();
          if (currentBridgeStatus.printerConnected) {
            clearInterval(connectCheckTimer);
            btnModalReconnect.disabled = false;
            btnModalReconnect.textContent = 'Reconnect Printer';
            executePrintJob();
          } else if (attempts >= 14) {
            clearInterval(connectCheckTimer);
            btnModalReconnect.disabled = false;
            btnModalReconnect.textContent = 'Retry Reconnect';
            if (modalAlertTitle) modalAlertTitle.textContent = 'Connection Timeout';
            if (modalAlertDesc) modalAlertDesc.textContent = 'Printer did not connect within 20s. Ensure printer power is ON, or Queue Anyway.';
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

  // Global Keyboard Listener (Backspace & Delete keys)
  function setupKeyboardListener() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        const activeEl = document.activeElement;
        const isInput = activeEl && (
          activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.isContentEditable
        );

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
      }
    });
  }

  // Global Clipboard Listener (Cmd+V / Ctrl+V anywhere on window)
  function setupClipboardListener() {
    window.addEventListener('paste', (e) => {
      const items = (e.clipboardData || e.originalEvent.clipboardData).items;
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            processUploadedFile(file);
            return;
          }
        }
      }
    });
  }

  // --------------------------------------------------------------------------
  // Image Processing & Floyd-Steinberg Dithering (1:1 Printhead Micro-Dots)
  // --------------------------------------------------------------------------
  function processUploadedFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const ditheredDataUrl = convertImageToDithered(img, isPhotoDither);
        addImageElement(ditheredDataUrl, img.width, img.height, 0);
        triggerAutoSave();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  /**
   * Converts an image to 1-bit monochrome using Floyd-Steinberg error diffusion.
   * Dithers at 400px max dimension matching display resolution and producing punchy
   * 2x2 dot clusters that heat thermal paper effectively without washing out.
   */
  function convertImageToDithered(img, useDither = true) {
    // Determine max dimension for canvas (max 400px wide/high)
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

    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    const gray = new Float32Array(w * h);
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      // Alpha check: transparent pixels become white paper (255)
      if (a < 64) {
        gray[i / 4] = 255;
      } else {
        gray[i / 4] = 0.299 * r + 0.587 * g + 0.114 * b;
      }
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
    return c.toDataURL('image/png');
  }

  // --------------------------------------------------------------------------
  // Text Element Management
  // --------------------------------------------------------------------------
  function addTextElement(text, x, y, fontSize = 24, align = 'center', rotation = 0, color = null) {
    const id = 'el_' + nextElementId++;
    const el = document.createElement('div');
    el.className = 'canvas-element';
    el.dataset.id = id;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.transform = `rotate(${rotation || 0}deg)`;

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
      type: 'text',
      x,
      y,
      fontSize,
      align,
      rotation: rotation || 0,
      color: textColor,
      domNode: el,
      contentNode: content
    };
    elements.push(record);

    attachDragListeners(el, record);
    attachRotateListener(rotateHandle, record);

    content.addEventListener('input', () => {
      triggerAutoSave();
    });

    selectElement(record);
    content.focus();
    return record;
  }

  // --------------------------------------------------------------------------
  // Image Element Management
  // --------------------------------------------------------------------------
  function addImageElement(dataUrl, origW, origH, rotation = 0, initialW = null, initialH = null, xPos = null, yPos = null) {
    const id = 'el_' + nextElementId++;
    const el = document.createElement('div');
    el.className = 'canvas-element';
    el.dataset.id = id;

    // Display sizing (fit cleanly on 400x600 screen canvas)
    let w = initialW;
    let h = initialH;
    if (!w || !h) {
      const maxInitW = 220;
      w = origW;
      h = origH;
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

    const img = document.createElement('img');
    img.className = 'canvas-img-content';
    img.src = dataUrl;

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
      type: 'image',
      x,
      y,
      width: w,
      height: h,
      aspectRatio: origW / origH,
      rotation: rotation || 0,
      dataUrl,
      domNode: el,
      imgNode: img
    };
    elements.push(record);

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
      }
    }, { passive: true });

    el.addEventListener('touchend', (e) => {
      if (touchStartDist > 0) {
        touchStartDist = 0;
        triggerAutoSave();
      }
    });

    // Desktop wheel/trackpad zoom when image is selected
    el.addEventListener('wheel', (e) => {
      if (selectedElement === record) {
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
        triggerAutoSave();
      }
    }, { passive: false });

    selectElement(record);
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
    });

    const stopResize = (e) => {
      if (isResizing) {
        isResizing = false;
        try {
          handle.releasePointerCapture(e.pointerId);
        } catch (ignored) {}
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
  }

  function deselectAll() {
    elements.forEach(r => r.domNode.classList.remove('selected'));
    selectedElement = null;
    hideInspector();
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
    selectedElement.domNode.remove();
    elements = elements.filter(r => r.id !== selectedElement.id);
    deselectAll();
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
    const record = selectedElement;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth || img.width;
      c.height = img.naturalHeight || img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const imgData = ctx.getImageData(0, 0, c.width, c.height);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = 255 - d[i];
        d[i + 1] = 255 - d[i + 1];
        d[i + 2] = 255 - d[i + 2];
        d[i + 3] = 255;
      }
      ctx.putImageData(imgData, 0, 0);
      const invertedDataUrl = c.toDataURL('image/png');
      record.dataUrl = invertedDataUrl;
      record.imgNode.src = invertedDataUrl;
      triggerAutoSave();
    };
    img.src = record.dataUrl;
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

  function saveActiveDraft() {
    const serializedElements = elements.map(el => ({
      id: el.id,
      type: el.type,
      x: el.x,
      y: el.y,
      rotation: el.rotation || 0,
      fontSize: el.fontSize,
      align: el.align,
      color: el.color,
      text: el.type === 'text' ? el.contentNode.innerText : undefined,
      width: el.width,
      height: el.height,
      aspectRatio: el.aspectRatio,
      dataUrl: el.dataUrl
    }));

    const state = {
      isBlackBg,
      elements: serializedElements,
      updatedAt: Date.now()
    };

    try {
      localStorage.setItem(STORAGE_DRAFT_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('LocalStorage save failed:', err);
    }
  }

  function restoreActiveDraft() {
    try {
      const raw = localStorage.getItem(STORAGE_DRAFT_KEY);
      if (!raw) return;
      const state = JSON.parse(raw);
      if (state && Array.isArray(state.elements) && state.elements.length > 0) {
        restoreCanvasFromState(state);
      }
    } catch (err) {
      console.warn('Failed to restore active draft:', err);
    }
  }

  function restoreCanvasFromState(state) {
    // Clear current DOM elements
    deselectAll();
    elementsContainer.innerHTML = '';
    elements = [];
    nextElementId = 1;

    if (state.isBlackBg !== undefined) {
      setStageBgColor(!!state.isBlackBg);
    }

    for (const item of (state.elements || [])) {
      if (item.type === 'text') {
        addTextElement(item.text || '', item.x, item.y, item.fontSize || 24, item.align || 'center', item.rotation || 0, item.color);
      } else if (item.type === 'image' && item.dataUrl) {
        addImageElement(item.dataUrl, item.width || 200, item.height || 200, item.rotation || 0, item.width, item.height, item.x, item.y);
      }
    }
    deselectAll();
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
        const text = el.contentNode.innerText;
        const lines = text.split('\n');
        const fontSize = el.fontSize * scaleX;
        const lineHeight = fontSize * 1.25;
        const totalHeight = lines.length * lineHeight;

        const domW = el.domNode.offsetWidth || 80;
        const domH = el.domNode.offsetHeight || totalHeight / scaleY;
        const cx = (el.x + domW / 2) * scaleX;
        const cy = (el.y + domH / 2) * scaleY;

        ctx.save();
        ctx.translate(cx, cy);
        if (el.rotation) ctx.rotate(el.rotation * Math.PI / 180);

        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.fillStyle = el.color || (isBlackBg ? '#ffffff' : '#000000');
        const startY = -(totalHeight / 2) + fontSize * 0.85;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const y = startY + (i * lineHeight);
          if (el.align === 'center') {
            const tw = ctx.measureText(line).width;
            ctx.fillText(line, -(tw / 2), y);
          } else if (el.align === 'right') {
            const tw = ctx.measureText(line).width;
            ctx.fillText(line, (domW * scaleX / 2) - tw, y);
          } else {
            ctx.fillText(line, -(domW * scaleX / 2), y);
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
      .map(e => e.contentNode.innerText.trim())
      .filter(t => t.length > 0)
      .join(' | ') || (elements.some(e => e.type === 'image') ? 'Image Composition' : 'Untitled Label');

    const serializedElements = elements.map(el => ({
      id: el.id,
      type: el.type,
      x: el.x,
      y: el.y,
      rotation: el.rotation || 0,
      fontSize: el.fontSize,
      align: el.align,
      color: el.color,
      text: el.type === 'text' ? el.contentNode.innerText : undefined,
      width: el.width,
      height: el.height,
      aspectRatio: el.aspectRatio,
      dataUrl: el.dataUrl
    }));

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
    deselectAll();
    elementsContainer.innerHTML = '';
    elements = [];
    nextElementId = 1;
    activeSnapshotId = null;
    setStageBgColor(false);
    localStorage.removeItem(STORAGE_DRAFT_KEY);
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
    fetchBridgeStatus();
    startBridgePolling(12000);
  }

  function startBridgePolling(ms) {
    if (bridgePollInterval) clearInterval(bridgePollInterval);
    bridgePollInterval = setInterval(fetchBridgeStatus, ms);
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
        bridgeStatusText.textContent = 'Printer: Connected';
        btnBridgeStatus.title = 'NULLTONEX connected via Bluetooth. Click for Control Panel.';
      } else if (currentBridgeStatus.phoneOnline) {
        btnBridgeStatus.classList.add('status-warning');
        bridgeStatusText.textContent = 'Printer: Disconnected';
        btnBridgeStatus.title = 'Phone bridge online, printer disconnected. Click to reconnect.';
      } else {
        btnBridgeStatus.classList.add('status-offline');
        bridgeStatusText.textContent = 'Bridge: Offline';
        btnBridgeStatus.title = 'Phone bridge is offline. Click for diagnostics.';
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
        } else if (currentBridgeStatus.printerState === 'CONNECTING') {
          panelPrinterBadge.className = 'tile-status-badge badge-warning';
          panelPrinterBadge.textContent = 'Connecting';
        } else {
          panelPrinterBadge.className = 'tile-status-badge badge-disconnected';
          panelPrinterBadge.textContent = 'Disconnected';
        }
      }
      if (panelPrinterState) {
        panelPrinterState.textContent = currentBridgeStatus.printerState || '--';
      }
      if (panelPrinterAddress) {
        panelPrinterAddress.textContent = currentBridgeStatus.deviceAddress || '66:32:89:D2:0A:46';
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
    startBridgePolling(3000);
  }

  function closeControlPanel() {
    isControlPanelOpen = false;
    if (controlPanelModal) controlPanelModal.classList.add('hidden');
    startBridgePolling(12000);
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

    if (elements.length === 0) {
      alert("Please add some text or an image to print!");
      return;
    }

    // Auto-save snapshot into history on physical print
    saveSnapshotToHistory('Printed Label');

    // 1. Check bridge status before dispatching to hardware
    if (!bypassBridgeCheck) {
      if (Date.now() - currentBridgeStatus.lastUpdated > 6000) {
        await fetchBridgeStatus();
      }

      // Case A: Phone is completely offline
      if (!currentBridgeStatus.phoneOnline) {
        showModal('Phone Bridge Offline', 'The phone is not connected to the cloud server.', 15, 'Queue');
        showModalAlert(
          'Phone Bridge Offline',
          'The Android phone is not reporting heartbeats. Please ensure the RealTalk app is open and running on the phone.',
          false
        );
        return;
      }

      // Case B: Phone is online, but Bluetooth printer is disconnected
      if (!currentBridgeStatus.printerConnected) {
        showModal('Printer Disconnected', 'Phone is online, but NULLTONEX is disconnected.', 15, 'Bridge');
        showModalAlert(
          'Printer Disconnected',
          'Phone is online, but Bluetooth connection to NULLTONEX is disconnected. Reconnect now to print directly.',
          true
        );
        return;
      }
    }

    executePrintJob();
  }

  async function executePrintJob() {
    hideModalAlert();
    isSubmitting = true;
    btnPrint.disabled = true;

    showModal('Rendering 4x6 Label...', 'Compositing monochrome raster dots (800x1200)...', 25, 'Render');

    try {
      // 1. Render full 800x1200 high-res canvas
      const printCanvas = document.createElement('canvas');
      printCanvas.width = PRINT_WIDTH;
      printCanvas.height = PRINT_HEIGHT;
      const ctx = printCanvas.getContext('2d');

      // Fill background (White or Black)
      ctx.fillStyle = isBlackBg ? '#000000' : '#ffffff';
      ctx.fillRect(0, 0, PRINT_WIDTH, PRINT_HEIGHT);

      const scaleX = PRINT_WIDTH / CANVAS_WIDTH;
      const scaleY = PRINT_HEIGHT / CANVAS_HEIGHT;

      // Draw user elements with matrix rotation
      for (const el of elements) {
        if (el.type === 'image') {
          await drawImageElementToCanvas(ctx, el, scaleX, scaleY);
        } else if (el.type === 'text') {
          drawTextElementToCanvas(ctx, el, scaleX, scaleY);
        }
      }

      // Subtle corner watermark
      ctx.fillStyle = isBlackBg ? '#ffffff' : '#000000';
      ctx.font = '16px monospace';
      const watermark = 'made by noahsmith.dev';
      const wmWidth = ctx.measureText(watermark).width;
      ctx.fillText(watermark, PRINT_WIDTH - wmWidth - 24, PRINT_HEIGHT - 20);

      // Strict 1-bit threshold pass to guarantee pure monochrome dots
      enforceStrictMonochrome(ctx, PRINT_WIDTH, PRINT_HEIGHT);

      const pngDataUrl = printCanvas.toDataURL('image/png');

      // 2. Submit to Cloudflare Worker Queue
      updateModal('Queueing Print...', 'Transmitting payload to Cloudflare Queue...', 50, false, 'Queue');

      const textSummary = elements
        .filter(e => e.type === 'text')
        .map(e => e.contentNode.innerText.trim())
        .filter(t => t.length > 0)
        .join(' | ') || 'Canvas Print';

      const response = await fetch(`${WORKER_BASE_URL}/api/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'canvas',
          imageData: pngDataUrl,
          text: textSummary,
          author: 'Canvas'
        })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${response.status}`);
      }

      const result = await response.json();
      modalJobId.textContent = `Job ID: ${result.id.slice(0, 8)}`;

      // 3. Poll for physical print confirmation
      updateModal('Transmitting to Phone...', 'Phone bridge received job & is transmitting to NULLTONEX...', 75, false, 'Bridge');
      pollPrintStatus(result.id);

    } catch (err) {
      console.error(err);
      updateModal('Transmission Error', err.message || 'Failed to connect to Cloudflare bridge', 100, true);
      isSubmitting = false;
      btnPrint.disabled = false;
    }
  }

  function drawImageElementToCanvas(ctx, el, scaleX, scaleY) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const w = el.width * scaleX;
        const h = el.height * scaleY;
        const cx = (el.x * scaleX) + (w / 2);
        const cy = (el.y * scaleY) + (h / 2);

        ctx.save();
        ctx.translate(cx, cy);
        if (el.rotation) {
          ctx.rotate((el.rotation * Math.PI) / 180);
        }
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
        ctx.restore();
        resolve();
      };
      img.onerror = () => resolve();
      img.src = el.dataUrl;
    });
  }

  function drawTextElementToCanvas(ctx, el, scaleX, scaleY) {
    const text = el.contentNode.innerText;
    const lines = text.split('\n');
    const fontSize = el.fontSize * scaleX;
    const lineHeight = fontSize * 1.25;
    const totalHeight = lines.length * lineHeight;

    ctx.font = `bold ${fontSize}px sans-serif`;
    let maxLineWidth = 0;
    for (const line of lines) {
      const tw = ctx.measureText(line).width;
      if (tw > maxLineWidth) maxLineWidth = tw;
    }

    const domW = (el.domNode.offsetWidth || (maxLineWidth / scaleX) + 12);
    const domH = (el.domNode.offsetHeight || (totalHeight / scaleY) + 8);
    const cx = (el.x + domW / 2) * scaleX;
    const cy = (el.y + domH / 2) * scaleY;

    ctx.save();
    ctx.translate(cx, cy);
    if (el.rotation) {
      ctx.rotate((el.rotation * Math.PI) / 180);
    }

    ctx.fillStyle = el.color || (isBlackBg ? '#ffffff' : '#000000');
    const startY = -(totalHeight / 2) + fontSize * 0.85;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const y = startY + (i * lineHeight);

      if (el.align === 'center') {
        const textW = ctx.measureText(line).width;
        ctx.fillText(line, -(textW / 2), y);
      } else if (el.align === 'right') {
        const textW = ctx.measureText(line).width;
        ctx.fillText(line, (domW * scaleX / 2) - textW - 6, y);
      } else {
        ctx.fillText(line, -(domW * scaleX / 2) + 6, y);
      }
    }
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
    const maxChecks = 35;

    const interval = setInterval(async () => {
      checks++;
      try {
        const res = await fetch(`${WORKER_BASE_URL}/api/quote/status?id=${quoteId}&t=${Date.now()}`);
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'printed') {
            clearInterval(interval);
            updateModal('Print Complete', 'Your label has physically burned onto 4x6 thermal paper on Noah\'s desk.', 100, true, 'Print');
            isSubmitting = false;
            btnPrint.disabled = false;
            return;
          }
        }
      } catch (ignored) {}

      if (checks >= maxChecks) {
        clearInterval(interval);
        updateModal('Queued for Print', 'Your label is in the queue and will print as soon as the bridge checks in.', 100, true, 'Bridge');
        isSubmitting = false;
        btnPrint.disabled = false;
      }
    }, 2000);
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
