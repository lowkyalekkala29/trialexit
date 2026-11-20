/**
 * Directory loading.
 *
 * The directory is the actual product surface — a dead link breaks the core
 * promise. So it lives in a public JSON file, ships bundled as an offline
 * fallback, and refreshes from GitHub at runtime. Fixing a dead URL is then a
 * pull request, not a store re-review.
 */

const REMOTE_URL =
  'https://raw.githubusercontent.com/lowkyalekkala29/trialexit/main/directory/directory.json';
const CACHE_KEY = 'directoryCache';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * @param {any} raw
 * @returns {import('./types.js').DirectoryEntry[]}
 */
export function normalizeDirectory(raw) {
  const rows = Array.isArray(raw) ? raw : raw?.entries;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && r.serviceId && r.cancelUrl)
    .map((r) => ({
      serviceId: String(r.serviceId),
      region: r.region === 'US' ? 'US' : 'IN',
      name: String(r.name ?? r.serviceId),
      cancelUrl: String(r.cancelUrl),
      domains: Array.isArray(r.domains) ? r.domains.map(String) : [],
      steps: Array.isArray(r.steps) ? r.steps.map(String) : [],
      requiresChat: Boolean(r.requiresChat),
      refundWindowDays: Number.isFinite(r.refundWindowDays) ? r.refundWindowDays : null,
      lastVerifiedAt: r.lastVerifiedAt ?? null,
      verified: r.verified === true,
      note: r.note ? String(r.note) : undefined,
    }));
}

/**
 * @param {import('./types.js').DirectoryEntry[]} entries
 * @param {string} hostname
 * @returns {import('./types.js').DirectoryEntry | undefined}
 */
export function matchByHost(entries, hostname) {
  const host = hostname.replace(/^www\./, '').toLowerCase();
  return entries.find((e) =>
    e.domains.some((d) => {
      const n = d.replace(/^www\./, '').toLowerCase();
      return host === n || host.endsWith(`.${n}`);
    }),
  );
}

/**
 * @param {import('./types.js').DirectoryEntry[]} entries
 * @param {string} query
 * @param {import('./types.js').Region} [region]
 */
export function search(entries, query, region) {
  const q = query.trim().toLowerCase();
  const pool = region ? entries.filter((e) => e.region === region) : entries;
  if (!q) return pool.slice(0, 8);
  return pool
    .filter((e) => e.name.toLowerCase().includes(q) || e.serviceId.includes(q))
    .slice(0, 8);
}

/**
 * Bundled data always wins on cold start; remote refreshes in the background
 * and is cached. A failed fetch must never block the UI.
 *
 * @param {import('./types.js').DirectoryEntry[]} bundled
 * @param {{ fetchImpl?: typeof fetch, now?: number }} [opts]
 * @returns {Promise<import('./types.js').DirectoryEntry[]>}
 */
export async function loadDirectory(bundled, opts = {}) {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const now = opts.now ?? Date.now();
  if (!fetchImpl) return bundled;
  try {
    const cached = await readCache();
    if (cached && now - cached.at < CACHE_TTL_MS) return normalizeDirectory(cached.data);

    const res = await fetchImpl(REMOTE_URL, { cache: 'no-store' });
    if (!res.ok) return cached ? normalizeDirectory(cached.data) : bundled;
    const data = await res.json();
    const entries = normalizeDirectory(data);
    if (entries.length === 0) return bundled;
    await writeCache({ at: now, data });
    return entries;
  } catch {
    const cached = await readCache();
    return cached ? normalizeDirectory(cached.data) : bundled;
  }
}

async function readCache() {
  try {
    const got = await chrome.storage.local.get(CACHE_KEY);
    return got?.[CACHE_KEY] ?? null;
  } catch {
    return null;
  }
}

/** @param {{ at: number, data: unknown }} value */
async function writeCache(value) {
  try {
    await chrome.storage.local.set({ [CACHE_KEY]: value });
  } catch {
    /* cache is best-effort */
  }
}

export { REMOTE_URL };
