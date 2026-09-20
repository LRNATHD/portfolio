/**
 * RealTalk // Thermal Canvas Engine
 * Freeform text & dithered image canvas for iPad & desktop thermal printing
 */

(function () {
  'use strict';

  if (window.__REALTALK_INITIALIZED__) return;
  window.__REALTALK_INITIALIZED__ = true;

  // Configuration
  const WORKER_BASE_URL = 'https://realtalk-printer-bridge.super-disk-489b.workers.dev';
  const CANVAS_WIDTH = 400; // CSS display pixels
  const CANVAS_HEIGHT = 600;
  const PRINT_WIDTH = 800; // Physical dots (203 DPI 4x6")
  const PRINT_HEIGHT = 1200;

  // State
  let elements = [];
  let selectedElement = null;
  let nextElementId = 1;
  let isPhotoDither = true; // true = Floyd-Steinberg, false = high-contrast threshold
  let isSubmitting = false;

  // DOM Elements
  const stage = document.getElementById('stage');
  const elementsContainer = document.getElementById('elementsContainer');
  const btnAddText = document.getElementById('btnAddText');
  const imageInput = document.getElementById('imageInput');
  const btnPasteImage = document.getElementById('btnPasteImage');
  const btnDitherMode = document.getElementById('btnDitherMode');
  const ditherModeText = document.getElementById('ditherModeText');
  const btnClear = document.getElementById('btnClear');
  const btnPrint = document.getElementById('btnPrint');

  // Floating Controls
  const elementControls = document.getElementById('elementControls');
  const btnSizeDown = document.getElementById('btnSizeDown');
  const btnSizeUp = document.getElementById('btnSizeUp');
  const btnAlignLeft = document.getElementById('btnAlignLeft');
  const btnAlignCenter = document.getElementById('btnAlignCenter');
  const btnAlignRight = document.getElementById('btnAlignRight');
  const btnDeleteElem = document.getElementById('btnDeleteElem');

  // Modal
  const statusModal = document.getElementById('statusModal');
  const modalTitle = document.getElementById('modalTitle');
  const modalDesc = document.getElementById('modalDesc');
  const modalProgressBar = document.getElementById('modalProgressBar');
  const modalJobId = document.getElementById('modalJobId');
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  const lblDate = document.getElementById('lblDate');

  // Initialize
  function init() {
    // Set current date
    if (lblDate) {
      lblDate.textContent = new Date().toISOString().slice(0, 10);
    }

    setupEventListeners();
    setupClipboardListener();

    // Default starter text so the label isn't blank
    addTextElement("Tap to edit text,\nor paste an image!", 60, 160, 26, 'center');
  }

  // --------------------------------------------------------------------------
  // Event Listeners
  // --------------------------------------------------------------------------
  function setupEventListeners() {
    // Add Text button
    btnAddText.addEventListener('click', (e) => {
      e.stopPropagation();
      addTextElement('New text here...', 80, 220, 24, 'center');
    });

    // Tap on empty space in container adds text
    elementsContainer.addEventListener('pointerdown', (e) => {
      if (e.target === elementsContainer) {
        deselectAll();
      }
    });

    // Double tap/click on empty space adds a text box at tap location
    elementsContainer.addEventListener('dblclick', (e) => {
      if (e.target === elementsContainer) {
        const rect = elementsContainer.getBoundingClientRect();
        const x = Math.max(10, Math.min(e.clientX - rect.left - 60, CANVAS_WIDTH - 150));
        const y = Math.max(10, Math.min(e.clientY - rect.top - 20, CANVAS_HEIGHT - 60));
        addTextElement('Your text', x, y, 22, 'left');
      }
    });

    // Upload Image
    imageInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        processUploadedFile(file);
      }
      imageInput.value = '';
    });

    // Paste button (calls Clipboard API if available)
    btnPasteImage.addEventListener('click', async () => {
      try {
        if (navigator.clipboard && navigator.clipboard.read) {
          const items = await navigator.clipboard.read();
          for (const item of items) {
            const imgType = item.types.find((t) => t.startsWith('image/'));
            if (imgType) {
              const blob = await item.getType(imgType);
              processUploadedFile(blob);
              return;
            }
          }
        }
        alert("Clipboard tip: Press Cmd+V / Ctrl+V to paste an image, or tap 'Add Image' to upload from Photos!");
      } catch (err) {
        alert("To paste an image: Use Cmd+V / Ctrl+V, or tap 'Add Image' to choose from your gallery!");
      }
    });

    // Dither mode toggle
    btnDitherMode.addEventListener('click', () => {
      isPhotoDither = !isPhotoDither;
      if (isPhotoDither) {
        btnDitherMode.classList.add('active');
        ditherModeText.textContent = 'Dither: Photo';
      } else {
        btnDitherMode.classList.remove('active');
        ditherModeText.textContent = 'Dither: Sharp';
      }
    });

    // Clear Canvas
    btnClear.addEventListener('click', () => {
      if (elements.length > 0 && confirm('Clear the label canvas?')) {
        elements.forEach(el => el.domNode.remove());
        elements = [];
        deselectAll();
      }
    });

    // Print Button
    btnPrint.addEventListener('click', handlePrintSubmission);

    // Inspector Controls
    btnSizeDown.addEventListener('click', (e) => {
      e.stopPropagation();
      adjustSelectedSize(-2);
    });
    btnSizeUp.addEventListener('click', (e) => {
      e.stopPropagation();
      adjustSelectedSize(2);
    });
    btnAlignLeft.addEventListener('click', (e) => {
      e.stopPropagation();
      setSelectedAlign('left');
    });
    btnAlignCenter.addEventListener('click', (e) => {
      e.stopPropagation();
      setSelectedAlign('center');
    });
    btnAlignRight.addEventListener('click', (e) => {
      e.stopPropagation();
      setSelectedAlign('right');
    });
    btnDeleteElem.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSelectedElement();
    });

    // Dismiss modal
    modalCloseBtn.addEventListener('click', () => {
      statusModal.classList.add('hidden');
    });
  }

  // --------------------------------------------------------------------------
  // Global Clipboard (Cmd+V / Ctrl+V)
  // --------------------------------------------------------------------------
  function setupClipboardListener() {
    window.addEventListener('paste', (e) => {
      const items = (e.clipboardData || e.originalEvent.clipboardData).items;
      for (const item of items) {
        if (item.type.indexOf('image') === 0) {
          const blob = item.getAsFile();
          processUploadedFile(blob);
          e.preventDefault();
          break;
        }
      }
    });
  }

  function processUploadedFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // Automatically dither image to black & white thermal dots
        const ditheredDataUrl = convertImageToDithered(img, isPhotoDither);
        addImageElement(ditheredDataUrl, img.width, img.height);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  // --------------------------------------------------------------------------
  // Monochrome Dithering Algorithm (Floyd-Steinberg / Threshold)
  // --------------------------------------------------------------------------
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
  function addTextElement(text, x, y, fontSize = 24, align = 'center') {
    const id = 'el_' + nextElementId++;
    const el = document.createElement('div');
    el.className = 'canvas-element';
    el.dataset.id = id;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;

    const content = document.createElement('div');
    content.className = 'canvas-text-content';
    content.contentEditable = 'true';
    content.spellcheck = false;
    content.style.fontSize = `${fontSize}px`;
    content.style.textAlign = align;
    content.innerText = text;

    el.appendChild(content);
    elementsContainer.appendChild(el);

    const record = {
      id,
      type: 'text',
      x,
      y,
      fontSize,
      align,
      domNode: el,
      contentNode: content
    };
    elements.push(record);

    attachDragListeners(el, record);

    content.addEventListener('input', () => {
      // keep track of changes
    });

    selectElement(record);
    content.focus();
    return record;
  }

  // --------------------------------------------------------------------------
  // Image Element Management
  // --------------------------------------------------------------------------
  function addImageElement(dataUrl, origW, origH) {
    const id = 'el_' + nextElementId++;
    const el = document.createElement('div');
    el.className = 'canvas-element';
    el.dataset.id = id;

    // Scale to fit canvas nicely (e.g. max width 220px)
    const maxInitW = 220;
    let w = origW;
    let h = origH;
    if (w > maxInitW) {
      h = Math.round((h * maxInitW) / w);
      w = maxInitW;
    }

    const x = Math.max(10, Math.round((CANVAS_WIDTH - w) / 2));
    const y = Math.max(10, Math.round((CANVAS_HEIGHT - h) / 2));

    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;

    const img = document.createElement('img');
    img.className = 'canvas-img-content';
    img.src = dataUrl;

    const handle = document.createElement('div');
    handle.className = 'resize-handle';

    el.appendChild(img);
    el.appendChild(handle);
    elementsContainer.appendChild(el);

    const record = {
      id,
      type: 'image',
      x,
      y,
      width: w,
      height: h,
      aspectRatio: origW / origH,
      dataUrl,
      domNode: el,
      imgNode: img
    };
    elements.push(record);

    attachDragListeners(el, record);
    attachResizeListener(handle, record);

    selectElement(record);
    return record;
  }

  // --------------------------------------------------------------------------
  // Draggable Behavior (Touch & Mouse with Pointer Events)
  // --------------------------------------------------------------------------
  function attachDragListeners(node, record) {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initLeft = 0;
    let initTop = 0;

    node.addEventListener('pointerdown', (e) => {
      // If clicking resize handle, ignore drag
      if (e.target.classList.contains('resize-handle')) return;

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

      // Soft clamp within stage bounds
      newX = Math.max(-50, Math.min(CANVAS_WIDTH - 20, newX));
      newY = Math.max(-20, Math.min(CANVAS_HEIGHT - 30, newY));

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
      }
    };

    node.addEventListener('pointerup', stopDrag);
    node.addEventListener('pointercancel', stopDrag);
  }

  // Resize handle listener
  function attachResizeListener(handle, record) {
    let isResizing = false;
    let startX = 0;
    let startW = 0;

    handle.addEventListener('pointerdown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startW = record.width;
      handle.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });

    handle.addEventListener('pointermove', (e) => {
      if (!isResizing) return;
      const dx = e.clientX - startX;
      const newW = Math.max(50, Math.min(CANVAS_WIDTH - 20, startW + dx));
      const newH = Math.round(newW / record.aspectRatio);

      record.width = newW;
      record.height = newH;
      record.domNode.style.width = `${newW}px`;
      record.domNode.style.height = `${newH}px`;
    });

    const stopResize = (e) => {
      if (isResizing) {
        isResizing = false;
        try {
          handle.releasePointerCapture(e.pointerId);
        } catch (ignored) {}
      }
    };

    handle.addEventListener('pointerup', stopResize);
    handle.addEventListener('pointercancel', stopResize);
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
    elementControls.classList.remove('hidden');
    // Hide alignment for images
    const isText = record.type === 'text';
    btnAlignLeft.style.display = isText ? 'inline-flex' : 'none';
    btnAlignCenter.style.display = isText ? 'inline-flex' : 'none';
    btnAlignRight.style.display = isText ? 'inline-flex' : 'none';
  }

  function hideInspector() {
    elementControls.classList.add('hidden');
  }

  function adjustSelectedSize(delta) {
    if (!selectedElement) return;
    if (selectedElement.type === 'text') {
      selectedElement.fontSize = Math.max(14, Math.min(64, selectedElement.fontSize + delta));
      selectedElement.contentNode.style.fontSize = `${selectedElement.fontSize}px`;
    } else if (selectedElement.type === 'image') {
      const newW = Math.max(50, Math.min(CANVAS_WIDTH - 20, selectedElement.width + delta * 8));
      const newH = Math.round(newW / selectedElement.aspectRatio);
      selectedElement.width = newW;
      selectedElement.height = newH;
      selectedElement.domNode.style.width = `${newW}px`;
      selectedElement.domNode.style.height = `${newH}px`;
    }
  }

  function setSelectedAlign(align) {
    if (!selectedElement || selectedElement.type !== 'text') return;
    selectedElement.align = align;
    selectedElement.contentNode.style.textAlign = align;
  }

  function deleteSelectedElement() {
    if (!selectedElement) return;
    selectedElement.domNode.remove();
    elements = elements.filter(r => r.id !== selectedElement.id);
    deselectAll();
  }

  // --------------------------------------------------------------------------
  // Composite & Submission to Cloudflare
  // --------------------------------------------------------------------------
  async function handlePrintSubmission() {
    if (isSubmitting) return;
    deselectAll();

    if (elements.length === 0) {
      alert("Please add some text or an image to print!");
      return;
    }

    isSubmitting = true;
    btnPrint.disabled = true;

    // Show Progress Modal
    showModal('Rendering 4x6 Label...', 'Compositing high-contrast thermal raster dots (800x1200)...', 25);

    try {
      // 1. Render full 800x1200 high-res canvas
      const printCanvas = document.createElement('canvas');
      printCanvas.width = PRINT_WIDTH;
      printCanvas.height = PRINT_HEIGHT;
      const ctx = printCanvas.getContext('2d');

      // Fill solid white background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, PRINT_WIDTH, PRINT_HEIGHT);

      // Draw aesthetic outer frame
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 4;
      ctx.strokeRect(30, 30, PRINT_WIDTH - 60, PRINT_HEIGHT - 60);

      // Header text
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 20px monospace';
      ctx.fillText('NOAHSMITH.DEV // REALTALK', 50, 65);
      const dateStr = new Date().toISOString().slice(0, 10);
      ctx.fillText(dateStr, PRINT_WIDTH - 180, 65);

      // Divider solid
      ctx.fillRect(50, 75, PRINT_WIDTH - 100, 2);

      // Scale factor from display to physical printhead
      const scaleX = PRINT_WIDTH / CANVAS_WIDTH;   // 800 / 400 = 2.0
      const scaleY = PRINT_HEIGHT / CANVAS_HEIGHT; // 1200 / 600 = 2.0

      // Draw user elements
      for (const el of elements) {
        if (el.type === 'image') {
          await drawImageElementToCanvas(ctx, el, scaleX, scaleY);
        } else if (el.type === 'text') {
          drawTextElementToCanvas(ctx, el, scaleX, scaleY);
        }
      }

      // Footer divider
      ctx.fillStyle = '#000000';
      ctx.fillRect(50, PRINT_HEIGHT - 80, PRINT_WIDTH - 100, 2);
      ctx.font = '16px monospace';
      ctx.fillText('DEVICE: NULLTONEX Y813BT (203 DPI)', 50, PRINT_HEIGHT - 55);
      ctx.fillText('* LIVE DESK TRANSMISSION *', 50, PRINT_HEIGHT - 35);

      // Final 1-bit threshold pass to guarantee pure monochrome
      enforceStrictMonochrome(ctx, PRINT_WIDTH, PRINT_HEIGHT);

      // Export compressed monochrome PNG
      const pngDataUrl = printCanvas.toDataURL('image/png');

      // 2. Submit to Cloudflare Worker
      updateModal('Sending to Bridge...', 'Transmitting payload through Cloudflare Queue to Android phone...', 50);

      // Create a short text summary for logging
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
      modalJobId.textContent = `Job ID: ${result.id}`;

      // 3. Poll for physical print confirmation
      updateModal('Printing on Noah\'s Desk...', 'Android bridge received job & is transmitting to NULLTONEX...', 75);
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
        const x = el.x * scaleX;
        const y = el.y * scaleY;
        const w = el.width * scaleX;
        const h = el.height * scaleY;
        ctx.drawImage(img, x, y, w, h);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = el.dataUrl;
    });
  }

  function drawTextElementToCanvas(ctx, el, scaleX, scaleY) {
    const text = el.contentNode.innerText;
    const lines = text.split('\n');
    const fontSize = el.fontSize * scaleX; // scale font size
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.fillStyle = '#000000';

    const lineHeight = fontSize * 1.25;
    const startX = el.x * scaleX;
    const startY = (el.y * scaleY) + fontSize; // canvas baseline

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const y = startY + (i * lineHeight);

      if (el.align === 'center') {
        const textW = ctx.measureText(line).width;
        ctx.fillText(line, startX - (textW / 2), y);
      } else if (el.align === 'right') {
        const textW = ctx.measureText(line).width;
        ctx.fillText(line, startX - textW, y);
      } else {
        ctx.fillText(line, startX, y);
      }
    }
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

  // Poll print completion
  async function pollPrintStatus(quoteId) {
    const maxChecks = 30; // 30 * 2s = 60s max
    let checks = 0;

    const interval = setInterval(async () => {
      checks++;
      try {
        const res = await fetch(`${WORKER_BASE_URL}/api/quote/status?id=${quoteId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'printed') {
            clearInterval(interval);
            updateModal('Printed Successfully! 🎉', 'Your label has physically burned onto the 4x6 roll on Noah\'s desk!', 100, true);
            isSubmitting = false;
            btnPrint.disabled = false;
            return;
          }
        }
      } catch (ignored) {}

      if (checks >= maxChecks) {
        clearInterval(interval);
        updateModal('Queued for Print', 'Your label is safe in the queue and will print as soon as the bridge checks in!', 100, true);
        isSubmitting = false;
        btnPrint.disabled = false;
      }
    }, 2000);
  }

  // --------------------------------------------------------------------------
  // Modal Utilities
  // --------------------------------------------------------------------------
  function showModal(title, desc, progress) {
    statusModal.classList.remove('hidden');
    modalCloseBtn.classList.add('hidden');
    updateModal(title, desc, progress, false);
  }

  function updateModal(title, desc, progress, showClose = false) {
    modalTitle.textContent = title;
    modalDesc.textContent = desc;
    modalProgressBar.style.width = `${progress}%`;
    if (showClose) {
      modalCloseBtn.classList.remove('hidden');
    }
  }

  // Launch on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
