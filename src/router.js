/**
 * router.js — Hash-based SPA router with animated transitions
 */

import { updateSEO } from './utils/seo.js';

const routes = [];
let currentView = null;
let currentRoute = null;

/**
 * Register a route.
 * @param {string} pattern - Hash pattern, e.g. '/projects' or '/writing/:slug'
 * @param {Function} handler - (params) => HTMLElement
 * @param {object} [options] - { transition: 'fade'|'slide-left'|'zoom-in' }
 */
export function addRoute(pattern, handler, options = {}) {
  const paramNames = [];
  const regexStr = pattern.replace(/:([^/]+)/g, (_, name) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  routes.push({
    pattern,
    regex: new RegExp(`^${regexStr}$`),
    paramNames,
    handler,
    transition: options.transition || 'fade',
    title: options.title,
    description: options.description,
  });
}

/**
 * Navigate programmatically.
 */
export function navigate(hash) {
  window.location.hash = hash;
}

/**
 * Get the current route name (first segment).
 */
export function getCurrentRouteName() {
  const hash = window.location.hash.slice(1) || '/';
  const segment = hash.split('/')[1] || 'projects';
  return segment;
}

/**
 * Determine transition type based on route order.
 */
function getTransition(fromRoute, toRoute) {
  if (!fromRoute) return 'fade';

  const routeOrder = { '/': 0, '/projects': 0, '/pcbs': 1, '/timeline': 2, '/about': 3 };
  const fromBase = '/' + (fromRoute.split('/')[1] || '');
  const toBase = '/' + (toRoute.split('/')[1] || '');
  const fromIdx = routeOrder[fromBase] ?? 1;
  const toIdx = routeOrder[toBase] ?? 1;

  if (fromBase === toBase) return 'fade';
  if (toIdx > fromIdx) return 'slide-left';
  return 'slide-right';
}

/**
 * Start the router.
 */
export function startRouter() {
  const container = document.getElementById('view-container');

  async function handleRoute() {
    const hash = window.location.hash.slice(1) || '/';

    // Find matching route
    let matched = null;
    let params = {};
    for (const route of routes) {
      const match = hash.match(route.regex);
      if (match) {
        matched = route;
        route.paramNames.forEach((name, i) => {
          params[name] = match[i + 1];
        });
        break;
      }
    }

    if (!matched) {
      // Fallback to home
      window.location.hash = '#/';
      return;
    }

    // Get the transition type
    const transition = getTransition(currentRoute, hash);
    currentRoute = hash;

    // Update SEO
    if (matched.title || matched.description) {
      updateSEO({ title: matched.title, description: matched.description });
    } else {
      updateSEO({}); // reset to default
    }

    // Build the new view
    const newViewEl = await matched.handler(params);
    newViewEl.classList.add('view');

    // Update active nav link
    updateNavLinks();

    // Transition
    if (currentView) {
      // Exit old view
      currentView.classList.add(`${transition}-exit`);
      void currentView.offsetHeight; // Force reflow
      currentView.classList.add(`${transition}-exit-active`);

      // Enter new view
      newViewEl.classList.add(`${transition}-enter`);
      container.appendChild(newViewEl);
      void newViewEl.offsetHeight; // Force reflow
      newViewEl.classList.add(`${transition}-enter-active`);

      // Clean up old view after transition
      const oldView = currentView;
      setTimeout(() => {
        oldView.remove();
      }, 500);
    } else {
      // First load — just fade in
      newViewEl.classList.add('fade-enter');
      container.appendChild(newViewEl);
      void newViewEl.offsetHeight; // Force reflow
      newViewEl.classList.add('fade-enter-active');
    }

    currentView = newViewEl;
  }

  function updateNavLinks() {
    const routeName = getCurrentRouteName();
    document.querySelectorAll('.nav-link').forEach(link => {
      const linkRoute = link.dataset.route;
      link.classList.toggle('active', linkRoute === routeName);
    });
  }

  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}
