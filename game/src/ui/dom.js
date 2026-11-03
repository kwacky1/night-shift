// Tiny DOM helpers. No framework, no virtual DOM.
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const $ = (sel, root = document) => root.querySelector(sel);

export const el = (tag, className, html) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
};

// Manual double-click detection. Native dblclick is unreliable when a click re-renders the target.
const DOUBLE_MS = 450;
let lastDown = { key: null, at: 0 };
export const isDoubleDown = (key) => {
  const now = performance.now();
  const hit = lastDown.key === key && now - lastDown.at < DOUBLE_MS;
  lastDown = hit ? { key: null, at: 0 } : { key, at: now };
  return hit;
};

// Ephemeral UI-only state that never belongs in the game state (and never goes to the MCP bridge).
export const ui = {
  renamingId: null,
  startMenuOpen: false,
  internOnline: false,
};
