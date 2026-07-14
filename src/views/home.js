/**
 * home.js — Home view
 * Simple landing page. User will customize later.
 */

export function createHomeView() {
  const el = document.createElement('div');
  el.className = 'home';
  el.innerHTML = `
    <div class="home-hero">
      <h1 class="home-title">
        Noah <span class="accent">Smith</span>
      </h1>
      <p class="home-subtitle">
        Hardware engineer & PCB designer. Building things that work in the real world.
      </p>
      <div class="home-divider"></div>
      <div class="home-cta-group">
        <a href="#/projects" class="btn btn-primary">View Projects</a>
        <a href="#/pcbs" class="btn btn-ghost">PCB Gallery</a>
      </div>
    </div>
  `;
  return el;
}
