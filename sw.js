/*
 * Quality Disposition Dashboard — offline/PWA service worker.
 *
 * Scope: the public dashboard (index.html) only. admin.html does not
 * register this worker, so admin/audit data is never cached on disk.
 *
 * Strategy:
 *  - App shell (HTML/CSS/JS/icons): cache-first, refreshed in the
 *    background on every successful fetch (stale-while-revalidate), so the
 *    app still loads with no network at all.
 *  - Public dashboard GET /api/* calls: network-first. On success the
 *    response is cached; when the network is unavailable the last cached
 *    response is served instead, so the dashboard shows the last-loaded
 *    data rather than a blank screen. Non-GET requests and anything under
 *    /api/admin/ are never intercepted or cached.
 *
 * Bump SHELL_CACHE/API_CACHE version suffixes when app-shell files change
 * shape in a way that requires forcing old caches out (rare — the
 * stale-while-revalidate refresh already keeps the shell current).
 */
const SHELL_CACHE = 'qdash-shell-v1';
const API_CACHE = 'qdash-api-v1';

const SHELL_FILES = [
  '/',
  '/index.html',
  '/app.css',
  '/app.js',
  '/sfx.js',
  '/site.webmanifest',
  '/favicon.ico',
  '/favicon-32.png',
  '/favicon-180.png',
  '/favicon-192.png',
  '/favicon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .catch(() => {}) // a missing/renamed asset shouldn't block install
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => n !== SHELL_CACHE && n !== API_CACHE)
          .map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

function isShellRequest(url) {
  return SHELL_FILES.some((f) => url.pathname === f) ||
    url.pathname === '/index.html';
}

function isCacheableApiGet(request, url) {
  return request.method === 'GET' &&
    url.pathname.startsWith('/api/') &&
    !url.pathname.startsWith('/api/admin/');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return; // don't touch cross-origin
  if (request.method !== 'GET') return; // never intercept writes

  if (isCacheableApiGet(request, url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(API_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => {
            if (cached) return cached;
            return new Response(
              JSON.stringify({ error: 'offline', offline: true }),
              { status: 503, headers: { 'Content-Type': 'application/json' } }
            );
          })
        )
    );
    return;
  }

  if (isShellRequest(url) || SHELL_FILES.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetch(request)
          .then((response) => {
            if (response && response.ok) {
              const copy = response.clone();
              caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
  }
});
