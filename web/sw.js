/**
 * Minimal service worker: makes the web app installable and lets the app shell
 * open on a flaky connection. Only same-origin GETs; API calls (Supabase,
 * Google) are never touched or cached.
 */
const CACHE = 'trialexit-shell-__APP_VERSION__';
const SHELL = ['./', './index.html', './ui.css', './app.js', './platform.js', './manifest.webmanifest', './icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// Network first (always fresh code), cache as fallback when offline.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    // no-cache: always ask the server whether the file changed (cheap 304s),
    // so a new release is picked up on the next load, never a stale copy.
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit ?? caches.match('./index.html'))),
  );
});
