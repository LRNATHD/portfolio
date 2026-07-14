/**
 * seo.js — Dynamic SEO Management for SPA
 */

const DEFAULT_TITLE = 'Noah Smith — Hardware Engineer & PCB Designer';
const DEFAULT_DESC = 'Portfolio of Noah Smith — hardware engineer specializing in PCB design. Projects, writing, and more.';

/**
 * Updates the document title and meta description.
 * @param {object} options 
 * @param {string} [options.title] - Page title (will append the site name automatically if desired)
 * @param {string} [options.description] - Meta description
 */
export function updateSEO({ title, description }) {
  // Update Title
  if (title) {
    document.title = `${title} | Noah Smith`;
  } else {
    document.title = DEFAULT_TITLE;
  }

  // Update Meta Description
  let metaDesc = document.querySelector('meta[name="description"]');
  if (!metaDesc) {
    metaDesc = document.createElement('meta');
    metaDesc.name = 'description';
    document.head.appendChild(metaDesc);
  }
  metaDesc.content = description || DEFAULT_DESC;
}
