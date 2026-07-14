import { createGallery, destroyGallery, openProject } from '../components/gallery.js';
import fm from 'front-matter';

const projectFiles = import.meta.glob('../content/projects/**/*.md', { query: '?raw', import: 'default', eager: true });
const pcbFiles = import.meta.glob('../content/pcbs/**/*.md', { query: '?raw', import: 'default', eager: true });

const ALL_PCBS = Object.entries(pcbFiles)
  .map(([path, rawContent]) => {
    const parsed = fm(rawContent);
    const { attributes } = parsed;
    return {
      id: attributes.id || path.split('/').pop().replace('.md', ''),
      type: attributes.type || 'pcb',
      project: attributes.project || null,
      title: attributes.title || 'Untitled Board',
      thumbnail: attributes.thumbnail || '',
      date: attributes.date || '',
    };
  })
  .filter(p => p.type === 'pcb');

const PROJECTS = Object.entries(projectFiles)
  .map(([path, rawContent]) => {
    const parsed = fm(rawContent);
    const { attributes, body } = parsed;
    
    let finalBody = body;
    
    // Inject mini-gallery for Miscellaneous Boards
    if (attributes.id === 'miscellaneous-boards') {
      const miscPCBS = ALL_PCBS.filter(p => p.project === 'miscellaneous-boards');
      if (miscPCBS.length > 0) {
        // Collect all thumbnails for the left-side images section
        const miscThumbnails = miscPCBS
          .map(p => p.thumbnail)
          .filter(t => t); // filter out empty/null thumbnails
          
        if (!attributes.images) {
          attributes.images = [];
        }
        attributes.images.push(...miscThumbnails);

        const gridHtml = `
<div class="gallery__grid" style="padding: 0; margin-top: 2rem; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));">
${miscPCBS.map(p => `
<a href="#/pcbs/${p.id}" class="gallery__card" style="text-decoration: none; color: inherit;">
<div class="gallery__card-image" style="aspect-ratio: 16/10; background: var(--gallery-border);">
${p.thumbnail ? `<img src="${p.thumbnail}" alt="${p.title}" loading="lazy" style="width: 100%; height: 100%; object-fit: cover;">` : (p.kicad && p.kicad.length > 0 ? `<div style="width: 100%; height: 100%; overflow: hidden; position: relative;"><kicanvas-embed src="${p.kicad[0]}" controls="none" style="width: 100%; height: 100%; border: none; pointer-events: none;"></kicanvas-embed></div>` : `<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--gallery-text-muted); font-size: 0.85rem;">No Image</div>`)}
</div>
<div class="gallery__card-body" style="padding: 1rem;">
<h3 class="gallery__card-title" style="font-size: 0.95rem; margin: 0;">${p.title}</h3>
<span class="gallery__card-date" style="font-size: 0.75rem; color: var(--gallery-text-muted); margin-top: 0.5rem; display: block;">${p.date}</span>
</div>
</a>
`).join('')}
</div>
`;
        finalBody += `\n\n### Boards in this Collection\n\n${gridHtml}`;
      }
    }

    return {
      id: attributes.id || path.split('/').pop().replace('.md', ''),
      type: 'project',
      title: attributes.title || 'Untitled Project',
      thumbnail: attributes.thumbnail || (attributes.images && attributes.images.length > 0 ? attributes.images[0] : ''),
      description: finalBody,
      images: attributes.images || [],
      tags: attributes.tags || [],
      keywords: attributes.keywords || [],
      kicad: attributes.kicad || [],
      status: attributes.status || null,
      date: attributes.date || '',
    };
  });

let currentGallery = null;

export async function createProjectsView(params) {
  const el = document.createElement('div');
  el.className = 'pcbs-view view';
  el.innerHTML = `
    <div class="pcbs-header">
      <h1>Projects</h1>
      <p>Standalone engineering projects and tools.</p>
      <div class="search-container">
        <input type="text" id="gallery-search" class="gallery-search" placeholder="Search projects..." aria-label="Search projects">
      </div>
    </div>
    <div id="gallery-container"></div>
  `;

  requestAnimationFrame(() => {
    const container = el.querySelector('#gallery-container');
    if (container) {
      currentGallery = createGallery(container, PROJECTS, '/projects');

      const searchInput = el.querySelector('#gallery-search');
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          if (currentGallery && currentGallery.filterGallery) {
            currentGallery.filterGallery(e.target.value);
          }
        });
      }

      if (params && params.projectId) {
        setTimeout(() => openProject(params.projectId), 600);
      }
    }
  });

  return el;
}

export function destroyProjectsView() {
  if (currentGallery) {
    destroyGallery();
    currentGallery = null;
  }
}

