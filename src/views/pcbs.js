import { createGallery, destroyGallery, openProject } from '../components/gallery.js';
import fm from 'front-matter';

// Dynamically import from both directories
const pcbFiles = import.meta.glob('../content/pcbs/**/*.md', { query: '?raw', import: 'default', eager: true });
const projectFiles = import.meta.glob('../content/projects/**/*.md', { query: '?raw', import: 'default', eager: true });

const ALL_PROJECTS = Object.entries(projectFiles).map(([path, rawContent]) => fm(rawContent).attributes);

// Parse them into the format expected by the gallery
const rawPcbs = Object.entries(pcbFiles)
  .map(([path, rawContent]) => {
    const parsed = fm(rawContent);
    const { attributes, body } = parsed;
    return {
      _originalPath: path,
      id: attributes.id || path.split('/').pop().replace('.md', ''),
      type: attributes.type || 'pcb',
      project: attributes.project || null,
      title: attributes.title || 'Untitled Board',
      thumbnail: attributes.thumbnail || '',
      description: body,
      images: attributes.images || [],
      tags: attributes.tags || [],
      keywords: attributes.keywords || [],
      kicad: attributes.kicad || [],
      status: attributes.status || null,
      date: attributes.date || '',
    };
  })
  .filter(p => p.type === 'pcb'); // Filter out project files from the PCBs directory

const PCBS = [];
const folderMap = {};

rawPcbs.forEach(pcb => {
  const parts = pcb._originalPath.split('/');
  if (parts.length >= 5) {
    const folder = parts[parts.length - 2];
    if (!folderMap[folder]) folderMap[folder] = [];
    folderMap[folder].push(pcb);
  } else {
    PCBS.push(pcb);
  }
});

Object.entries(folderMap).forEach(([folder, boards]) => {
  if (boards.length > 1) {
    // Sort boards by date descending
    boards.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    const latest = boards[0];
    
    const seriesTitle = folder.split('-').map(w => w.toUpperCase() === 'ESP' ? 'ESP' : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    
    const seriesParent = {
      id: `series-${folder}`,
      type: 'pcb',
      title: seriesTitle,
      thumbnail: latest.thumbnail,
      date: latest.date,
      tags: ['Revisions', `${boards.length} Revisions`],
      status: latest.status,
      kicad: [],
      images: [],
      description: `**This board has ${boards.length} revisions:**\n\n<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; margin: 1.5rem 0;">\n` +
        boards.map(b => `<a href="#/pcbs/${b.id}" style="text-decoration: none; color: inherit; display: block; border: 1px solid var(--gallery-border); border-radius: 8px; overflow: hidden; background: var(--gallery-card-bg); transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
<div style="width: 100%; aspect-ratio: 16/10; background: var(--gallery-bg); display: flex; align-items: center; justify-content: center; overflow: hidden;">
${b.thumbnail ? `<img src="${b.thumbnail}" alt="${b.title}" style="width: 100%; height: 100%; object-fit: cover;" loading="lazy" />` : `<span style="color: var(--gallery-text-muted); font-size: 0.85rem;">No Image</span>`}
</div>
<div style="padding: 1rem;">
<h4 style="margin: 0 0 0.5rem 0; font-size: 0.95rem;">${b.title}</h4>
<div style="font-size: 0.8rem; color: var(--gallery-text-muted);">${b.date}</div>
</div>
</a>`).join('') + `\n</div>\n\n---\n\n**Latest Revision Notes:**\n\n` + (latest.description || '')
    };
    
    PCBS.push(seriesParent);
    boards.forEach(b => {
      b.hidden = true;
      PCBS.push(b);
    });
  } else {
    PCBS.push(boards[0]);
  }
});

let currentGallery = null;

export async function createPcbsView(params) {
  // Inject Wikipedia-style series banner for boards tied to projects
  const pcbsWithBanners = PCBS.map(pcb => {
    let prefix = '';
    if (pcb.project) {
      const parent = ALL_PROJECTS.find(p => p.id === pcb.project);
      if (parent) {
        prefix = `> [!NOTE]\n> **Part of a Project**: This board is a component of the [${parent.title}](#/projects/${parent.id}) project.\n\n`;
      }
    }
    return { ...pcb, description: prefix + pcb.description };
  });

  const el = document.createElement('div');
  el.className = 'pcbs-view view';
  el.innerHTML = `
    <div class="pcbs-header">
      <h1>PCBs</h1>
      <p>Individual board designs and revisions.</p>
      <div class="search-container">
        <input type="text" id="gallery-search" class="gallery-search" placeholder="Search boards..." aria-label="Search PCBs">
      </div>
    </div>
    <div id="gallery-container"></div>
  `;

  requestAnimationFrame(() => {
    const container = el.querySelector('#gallery-container');
    if (container) {
      currentGallery = createGallery(container, pcbsWithBanners, '/pcbs');

      // Search listener
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

export function destroyPcbsView() {
  if (currentGallery) {
    destroyGallery();
    currentGallery = null;
  }
}
