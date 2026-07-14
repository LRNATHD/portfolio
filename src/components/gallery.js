/**
 * Gallery Component — PCB Project Showcase
 *
 * Premium zoom-from-origin gallery. Each card zooms in-place using
 * CSS transforms anchored to the card's exact viewport position.
 * A detail panel physically attaches to the zoomed card via a
 * connector line.
 *
 * Exports:
 *   createGallery(containerEl, projects)
 *   destroyGallery()
 *   openProject(projectId)
 */

import { marked } from 'marked';
import { updateSEO } from '../utils/seo.js';

// ── Marked config ────────────────────────────────────────────
marked.setOptions({
  breaks: true,
  gfm: true,
});

// ── Module state ─────────────────────────────────────────────
let _container = null;
let _projects = [];
let _activeId = null;
let _elements = {};
let _cardEls = new Map();  // projectId → card DOM element
let _rafId = null;
let _baseRoute = '/projects';

// ── Helpers ──────────────────────────────────────────────

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

// Zoom transform and positioning logic removed in favor of full-screen split overlay

// ── Build functions ──────────────────────────────────────────

function buildCard(project) {
  if (project.isHeader) {
    const header = document.createElement('h2');
    header.className = 'gallery__section-header';
    header.setAttribute('data-header-id', project.id);
    header.textContent = project.title;
    return header;
  }

  const card = document.createElement('article');
  card.className = 'gallery__card';
  card.setAttribute('tabindex', '0');
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `View project: ${project.title}`);
  card.dataset.projectId = project.id;

  let badgeHtml = '';
  if (project.status) badgeHtml += `<span class="gallery__badge gallery__badge--status">${esc(project.status)}</span>`;

  const tagsHtml = (project.tags || [])
    .map(t => `<span class="gallery__tag">${esc(t)}</span>`)
    .join('');

  card.innerHTML = `
    <div class="gallery__card-image">
      ${project.thumbnail ? `
      <img
        src="${esc(project.thumbnail)}"
        alt="${esc(project.title)}"
        loading="lazy"
        decoding="async"
      />
      ` : `
      <div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--gallery-text-muted); background: var(--gallery-bg); font-size: 0.85rem;">
        No Image
      </div>
      `}
    </div>
    <div class="gallery__card-body">
      <h3 class="gallery__card-title">${esc(project.title)}</h3>
      <div class="gallery__card-tags">${badgeHtml}${tagsHtml}</div>
      <span class="gallery__card-date">${formatDate(project.date)}</span>
    </div>
  `;

  // Click → zoom
  card.addEventListener('click', () => openProject(project.id));
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openProject(project.id);
    }
  });

  return card;
}

function buildDetailPanel() {
  const detail = document.createElement('aside');
  detail.className = 'gallery__detail';
  detail.setAttribute('role', 'dialog');
  detail.setAttribute('aria-label', 'Project details');

  detail.innerHTML = `
    <button class="gallery__close" aria-label="Close project details" title="Close (Esc)">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="1" y1="1" x2="13" y2="13"/>
        <line x1="13" y1="1" x2="1" y2="13"/>
      </svg>
    </button>
    <div class="gallery__detail-split">
      <div class="gallery__detail-left">
        <div class="gallery__detail-images"></div>
      </div>
      <div class="gallery__detail-right">
        <div class="gallery__detail-header">
          <h2 class="gallery__detail-title"></h2>
          <div class="gallery__detail-meta">
            <span class="gallery__detail-date"></span>
            <div class="gallery__detail-tags"></div>
          </div>
        </div>
        <div class="gallery__detail-body">
          <div class="gallery__detail-description"></div>
        </div>
      </div>
    </div>
  `;

  // Close button
  detail.querySelector('.gallery__close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeProject();
  });

  // Prevent clicks inside detail from closing
  detail.addEventListener('click', (e) => e.stopPropagation());

  return detail;
}

function buildBackdrop() {
  const backdrop = document.createElement('div');
  backdrop.className = 'gallery__backdrop';
  backdrop.addEventListener('click', closeProject);
  return backdrop;
}


function buildLightbox() {
  const lightbox = document.createElement('div');
  lightbox.className = 'gallery__lightbox';
  lightbox.innerHTML = `
    <button class="gallery__lightbox-close" aria-label="Close image">
      <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="1" y1="1" x2="13" y2="13"/>
        <line x1="13" y1="1" x2="1" y2="13"/>
      </svg>
    </button>
    <img src="" alt="" />
  `;

  const closeLightbox = () => {
    lightbox.classList.remove('gallery__lightbox--visible');
    lightbox.querySelector('img').src = '';
  };

  lightbox.addEventListener('click', closeLightbox);
  lightbox.querySelector('.gallery__lightbox-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeLightbox();
  });

  return lightbox;
}

function openLightbox(src, alt) {
  if (!_elements.lightbox) return;
  const img = _elements.lightbox.querySelector('img');
  img.src = src;
  img.alt = alt || '';
  // Force reflow for transition
  void _elements.lightbox.offsetHeight;
  _elements.lightbox.classList.add('gallery__lightbox--visible');
}

// ── Detail population ────────────────────────────────────────

function populateDetail(project) {
  const d = _elements.detail;
  if (!d) return;

  d.querySelector('.gallery__detail-title').textContent = project.title;
  d.querySelector('.gallery__detail-date').textContent = formatDate(project.date);

  // Tags & Badges
  const tagsContainer = d.querySelector('.gallery__detail-tags');
  let badgeHtml = '';
  if (project.status) badgeHtml += `<span class="gallery__badge gallery__badge--status">${esc(project.status)}</span>`;

  const tagsHtml = (project.tags || [])
    .map(t => `<span class="gallery__tag">${esc(t)}</span>`)
    .join('');
    
  tagsContainer.innerHTML = badgeHtml + tagsHtml;

  // Description (markdown → HTML)
  const descContainer = d.querySelector('.gallery__detail-description');
  if (project.description) {
    descContainer.innerHTML = marked.parse(project.description);
  } else {
    descContainer.innerHTML = '<p style="color: var(--gallery-text-muted)">No description available.</p>';
  }

  // KiCanvas Integration (Removed per user request)

  // Images
  const imagesSection = d.querySelector('.gallery__detail-images');
  const images = project.images || [];

  let allImages = [...images];
  if (project.thumbnail && !allImages.includes(project.thumbnail)) {
    allImages.unshift(project.thumbnail);
  }

  if (allImages.length === 0) {
    imagesSection.style.display = 'none';
  } else {
    imagesSection.style.display = 'flex';
    imagesSection.style.flexDirection = 'column';
    imagesSection.style.gap = '2rem';
    
    imagesSection.innerHTML = allImages.map((src, i) => `
      <img src="${esc(src)}" class="gallery__detail-full-img" alt="${esc(project.title)} — image ${i + 1}" loading="lazy" decoding="async" />
    `).join('');
    
    // Add lightbox click event
    imagesSection.querySelectorAll('.gallery__detail-full-img').forEach(img => {
      img.style.cursor = 'zoom-in';
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        openLightbox(img.src, project.title);
      });
    });
  }
}

// ── Open / Close ─────────────────────────────────────────────

export function openProject(projectId) {
  const project = _projects.find(p => p.id === projectId);
  if (!project) return;

  const cardEl = _cardEls.get(projectId);
  if (!cardEl) return;

  if (_activeId) {
    closeProject(true);
  }

  _activeId = projectId;

  // Update SEO
  updateSEO({
    title: project.title,
    description: project.description.substring(0, 150) + '...'
  });

  requestAnimationFrame(() => {
    _elements.root.classList.add('gallery--has-active');
    cardEl.classList.add('gallery__card--active');

    _elements.backdrop.classList.add('gallery__backdrop--visible');

    populateDetail(project);

    setTimeout(() => {
      _elements.detail.classList.add('gallery__detail--visible');

      const closeBtn = _elements.detail.querySelector('.gallery__close');
      if (closeBtn) closeBtn.focus();
    }, 50);

    if (window.location.hash !== `#${_baseRoute}/${projectId}`) {
      history.pushState(null, '', `#${_baseRoute}/${projectId}`);
    }
  });
}

export function closeProject(instant = false) {
  if (!_activeId) return;

  const cardEl = _cardEls.get(_activeId);
  _activeId = null;

  const duration = instant ? 0 : 380;

  _elements.detail.classList.remove('gallery__detail--visible');

  setTimeout(() => {
    _elements.backdrop.classList.remove('gallery__backdrop--visible');

    if (cardEl) {
      cardEl.classList.remove('gallery__card--active');
    }
    _elements.root.classList.remove('gallery--has-active');
  }, instant ? 0 : duration);

  // Reset SEO
  updateSEO({ title: 'Projects' });

  // Update URL hash
  if (window.location.hash.includes(`${_baseRoute}/`)) {
    history.pushState(null, '', `#${_baseRoute}`);
  }
}

// ── Keyboard handler ─────────────────────────────────────────

function onKeyDown(e) {
  if (e.key === 'Escape') {
    // Close lightbox first if open, then detail
    if (_elements.lightbox?.classList.contains('gallery__lightbox--visible')) {
      _elements.lightbox.classList.remove('gallery__lightbox--visible');
      _elements.lightbox.querySelector('img').src = '';
    } else if (_activeId) {
      closeProject();
    }
  }
}


// ── Public API ───────────────────────────────────────────────

/**
 * Build the gallery into the given container.
 *
 * @param {HTMLElement} containerEl — the DOM element to render into
 * @param {Array<Object>} projects — array of project data objects
 * @param {string} baseRoute — base route hash path
 */
export function createGallery(containerEl, projects, baseRoute = '/projects') {
  if (!containerEl) {
    console.error('[gallery] No container element provided');
    return;
  }

  // Clean up if previously initialized
  destroyGallery();

  _container = containerEl;
  _projects = projects || [];
  _baseRoute = baseRoute;

  // Root wrapper
  const root = document.createElement('div');
  root.className = 'gallery';

  // Grid
  const grid = document.createElement('div');
  grid.className = 'gallery__grid';

  if (_projects.length === 0) {
    grid.innerHTML = `
      <div class="gallery__empty">
        <div class="gallery__empty-icon">⬡</div>
        <p class="gallery__empty-text">No projects yet.<br/>Check back soon.</p>
      </div>
    `;
  } else {
    _projects.forEach(project => {
      const card = buildCard(project);
      if (project.hidden) {
        card.style.display = 'none';
      }
      _cardEls.set(project.id, card);
      grid.appendChild(card);
    });
  }

  root.appendChild(grid);

  // Backdrop
  const backdrop = buildBackdrop();
  root.appendChild(backdrop);

  // Detail panel
  const detail = buildDetailPanel();
  root.appendChild(detail);

  // Lightbox
  const lightbox = buildLightbox();
  root.appendChild(lightbox);

  // Store references
  _elements = { root, grid, backdrop, detail, lightbox };

  // Mount
  containerEl.appendChild(root);

  // Event listeners
  document.addEventListener('keydown', onKeyDown);

  // Check URL hash for deep link on mount
  const hash = window.location.hash;
  const deepLinkMatch = hash.match(new RegExp(`#${_baseRoute}\\/(.+)`));
  if (deepLinkMatch) {
    const targetId = deepLinkMatch[1];
    // Delay to allow entrance animations to settle
    setTimeout(() => openProject(targetId), 700);
  }

  // Define filter logic
  const filterGallery = (query) => {
    const term = query.toLowerCase().trim();
    const tokens = term.split(/\s+/).filter(Boolean);
    let visibleCount = 0;
    _projects.forEach(project => {
      if (project.isHeader) return;
      const card = _cardEls.get(project.id);
      if (!card) return;
      if (project.hidden) {
        card.style.display = 'none';
        return;
      }
      if (tokens.length === 0) {
        card.style.display = '';
        return;
      }
      
      const isMatch = tokens.every(token => {
        const titleMatch = project.title && project.title.toLowerCase().includes(token);
        const tagsMatch = project.tags && project.tags.some(t => String(t).toLowerCase().includes(token));
        const descMatch = project.description && project.description.toLowerCase().includes(token);
        const statusMatch = project.status && project.status.toLowerCase().includes(token);
        const dateMatch = project.date && project.date.toLowerCase().includes(token);
        const keywordsMatch = project.keywords && project.keywords.some(k => String(k).toLowerCase().includes(token));
        
        return titleMatch || tagsMatch || descMatch || statusMatch || dateMatch || keywordsMatch;
      });
      
      if (isMatch) {
        card.style.display = '';
        visibleCount++;
      } else {
        card.style.display = 'none';
      }
    });

    // Show/hide headers based on visibleCount
    _projects.forEach(project => {
      if (project.isHeader) {
        const headerEl = _container.querySelector(`[data-header-id="${project.id}"]`);
        if (headerEl) {
          if (term && visibleCount === 0) {
            headerEl.style.display = 'none';
          } else {
            headerEl.style.display = '';
          }
        }
      }
    });
  };

  return { filterGallery };
}

/**
 * Tear down the gallery, removing DOM and event listeners.
 */
export function destroyGallery() {
  if (_activeId) {
    closeProject(true);
  }

  document.removeEventListener('keydown', onKeyDown);

  cancelAnimationFrame(_rafId);

  if (_elements.root && _elements.root.parentNode) {
    _elements.root.parentNode.removeChild(_elements.root);
  }

  _container = null;
  _projects = [];
  _activeId = null;
  _elements = {};
  _cardEls.clear();
}
