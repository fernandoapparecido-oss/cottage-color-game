/* Cottage Color — service worker (offline + instant load).
   Bump CACHE when assets change so clients pick up the new version. */
const CACHE = 'cottage-color-v1';
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

// Cache-first for same-origin GET; fall back to network and cache the result.
self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
        return res;
      }).catch(function () { return caches.match('./index.html'); });
    })
  );
});
