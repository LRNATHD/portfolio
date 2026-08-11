/**
 * timeline.js — Chronological view of all fabricated boards
 */
import fm from 'front-matter';

// Dynamically import all PCB files
const pcbFiles = import.meta.glob('../content/pcbs/**/*.md', { query: '?raw', import: 'default', eager: true });

export function createTimelineView() {
  const el = document.createElement('div');
  el.className = 'timeline-view view';

  // Parse and collect all boards
  const allBoards = Object.entries(pcbFiles)
    .map(([path, rawContent]) => {
      const parsed = fm(rawContent);
      const { attributes, body } = parsed;
      
      // Clean up body text for a short snippet
      let snippet = body ? body.replace(/[#*`_\[\]>]/g, '').trim() : '';
      if (snippet.length > 120) snippet = snippet.substring(0, 120) + '...';

      return {
        id: attributes.id || path.split('/').pop().replace('.md', ''),
        type: attributes.type || 'pcb',
        title: attributes.title || 'Untitled Board',
        thumbnail: attributes.thumbnail || '',
        date: attributes.date || '',
        tags: attributes.tags || [],
        description: snippet,
        timestamp: new Date(attributes.date || 0).getTime()
      };
    })
    .filter(b => b.type === 'pcb' && b.date); // Must be a pcb and have a date

  // Sort descending (newest first)
  allBoards.sort((a, b) => b.timestamp - a.timestamp);

  el.innerHTML = `
    <div class="timeline-container">
      <header class="timeline-header">
        <h1>PCB Timeline</h1>
        <p>A chronological history of my fabricated designs.</p>
      </header>

      <div class="timeline-track">
        ${allBoards.map(board => `
          <div class="timeline-node">
            <div class="timeline-date">${board.date}</div>
            <div class="timeline-point"></div>
            <div class="timeline-content">
              <a href="#/pcbs/${board.id}" class="timeline-card">
                <div class="timeline-thumbnail">
                  ${board.thumbnail ? `<img src="${board.thumbnail}" alt="${board.title}" loading="lazy" />` : '<span class="no-image">No Image</span>'}
                </div>
                <div class="timeline-card-info">
                  <h3>${board.title}</h3>
                  ${board.tags && board.tags.length > 0 ? `
                  <div class="timeline-card-tags">
                    ${board.tags.slice(0, 3).map(tag => `<span class="timeline-tag">${tag}</span>`).join('')}
                  </div>
                  ` : ''}
                  ${board.description ? `<p class="timeline-card-desc">${board.description}</p>` : ''}
                </div>
              </a>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  return el;
}
