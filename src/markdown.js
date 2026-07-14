/**
 * markdown.js — Markdown rendering pipeline
 * Parses front matter + renders markdown to HTML
 */

import { marked } from 'marked';

// Configure marked
marked.setOptions({
  breaks: true,
  gfm: true,
});

/**
 * Parse YAML-like front matter from a markdown string.
 * Simple parser — handles key: value and key: [array] formats.
 */
export function parseFrontMatter(content) {
  const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = content.match(fmRegex);

  if (!match) {
    return { attributes: {}, body: content };
  }

  const fmBlock = match[1];
  const body = match[2];
  const attributes = {};

  for (const line of fmBlock.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    let value = trimmed.slice(colonIdx + 1).trim();

    // Handle arrays: [item1, item2]
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
    }

    attributes[key] = value;
  }

  return { attributes, body };
}

/**
 * Render markdown string to HTML.
 */
export function renderMarkdown(mdString) {
  return marked.parse(mdString);
}

/**
 * Fetch and parse a markdown file.
 * @param {string} url - URL to the .md file
 * @returns {{ attributes: object, html: string, body: string }}
 */
export async function fetchAndRender(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);

  const text = await res.text();
  const { attributes, body } = parseFrontMatter(text);
  const html = renderMarkdown(body);

  return { attributes, html, body };
}
