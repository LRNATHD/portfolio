/**
 * main.js — Application entry point
 * Registers routes and starts the SPA router.
 */

import { addRoute, startRouter } from './router.js';
import { createPcbsView } from './views/pcbs.js';
import { createProjectsView } from './views/projects.js';
import { createTimelineView } from './views/timeline.js';
import { createAboutView } from './views/about.js';

// Register routes
addRoute('/', (params) => createProjectsView(params), { transition: 'fade', title: 'Projects' });
addRoute('/projects', (params) => createProjectsView(params), { transition: 'fade', title: 'Projects' });
addRoute('/projects/:projectId', (params) => createProjectsView(params), { transition: 'zoom-in', title: 'Projects' });
addRoute('/pcbs', (params) => createPcbsView(params), { transition: 'zoom-in', title: 'PCBs' });
addRoute('/pcbs/:projectId', (params) => createPcbsView(params), { transition: 'zoom-in', title: 'PCBs' });
addRoute('/timeline', () => createTimelineView(), { transition: 'zoom-in', title: 'PCB Timeline' });
addRoute('/about', () => createAboutView(), { transition: 'fade', title: 'About' });

// Start
startRouter();

// Theme toggle logic
document.addEventListener('DOMContentLoaded', () => {
  const themeToggle = document.getElementById('theme-toggle');
  const themeIcon = themeToggle?.querySelector('.theme-icon');
  
  if (themeToggle) {
    // Set initial icon based on persisted theme
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    themeIcon.textContent = isLight ? '☾' : '☀';

    themeToggle.addEventListener('click', () => {
      const currentlyLight = document.documentElement.getAttribute('data-theme') === 'light';
      if (currentlyLight) {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('app-theme', 'dark');
        themeIcon.textContent = '☀';
      } else {
        document.documentElement.setAttribute('data-theme', 'light');
        localStorage.setItem('app-theme', 'light');
        themeIcon.textContent = '☾';
      }
    });
  }
});
