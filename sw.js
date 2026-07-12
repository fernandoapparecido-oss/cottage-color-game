/* Cottage Color — service worker (offline + fresh updates).
   Strategy: NETWORK-FIRST for same-origin GETs, falling back to cache when
   offline. This guarantees players see the latest version whenever they're
   online, while still loading offline. Bump CACHE to force a clean refresh. */
const CACHE = 'cottage-color-v3';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/styles.css',
  './src/boards.js',
  './src/pipeline.js',
  './src/curated.js',
  './src/levels.js',
  './src/game.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // Best-effort precache: don't fail the whole install if one asset 404s.
      return Promise.all(SHELL.map(function (u) {
        return c.add(u).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Network-first: try the network (and refresh the cache); if it fails (offline),
// serve from cache; final fallback is the cached index.html.
self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || caches.match('./index.html');
      });
    })
  );
});
