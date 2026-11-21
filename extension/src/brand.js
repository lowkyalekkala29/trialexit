/**
 * Service monograms. We deliberately do not ship third-party logos (trademark
 * + store review); a brand-coloured initial is recognisable enough.
 */
const COLORS = {
  netflix: '#e50914',
  spotify: '#1db954',
  'youtube-premium': '#ff0033',
  'chatgpt-plus': '#10a37f',
  'adobe-cc': '#fa0f00',
  jiohotstar: '#0f1c4d',
  'prime-video': '#00a8e1',
  'linkedin-premium': '#0a66c2',
  audible: '#f8991c',
  sonyliv: '#111111',
  zee5: '#8230c6',
  canva: '#00c4cc',
  'claude-pro': '#d97757',
  hulu: '#1ce783',
  'disney-plus': '#113ccf',
  'google-one': '#4285f4',
  dropbox: '#0061ff',
};

const FALLBACK = ['#64748b', '#0ea5e9', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#6366f1'];

function esc(v) {
  return String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

/** @param {string} serviceId @param {string} name @param {string} [size] */
export function logoHtml(serviceId, name, size = '') {
  let color = COLORS[serviceId];
  if (!color) {
    let h = 0;
    for (const ch of String(serviceId || name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    color = FALLBACK[h % FALLBACK.length];
  }
  const initial = (String(name).trim()[0] ?? '?').toUpperCase();
  return `<span class="logo ${size}" style="--logo:${color}" aria-hidden="true">${esc(initial)}</span>`;
}
