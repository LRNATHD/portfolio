/**
 * about.js — Clean, full-width About Me view
 */

export function createAboutView() {
  const el = document.createElement('div');
  el.className = 'about-view view';
  el.innerHTML = `
    <div class="about-container full-width-layout">
      <header class="about-header">
        <h1>About Me</h1>
      </header>

      <main class="about-content">
        <p class="placeholder-text">
          Hi, I'm Noah. I'm a hardware engineer and PCB designer specializing in microcontroller implementation, power systems, and embedded programming.
        </p>
        <p class="placeholder-text">
          This is a clean space for me to write about my background, work, and future projects.
        </p>
      </main>
    </div>
  `;
  return el;
}
