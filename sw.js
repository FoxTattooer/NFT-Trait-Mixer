'use strict';
// Increment the version whenever an application-shell file changes.
const PREFIX = `trait-workshop:${self.registration.scope}:`;
const CACHE = PREFIX + 'v0.7.100';
const ROADMAP = './plan-rozvoje.html';
const SHOWROOM_ART = './art/showroom-dripd.png?build=0775';
const SHELL = [
  './', './index.html', ROADMAP, './styles.css?build=0768', './design.css?build=0798', './compact.css?build=0798',
  './schemes.css?build=07100', './drag.js?build=0760', './project.js?build=0793', './diagnostics.js?build=07100',
  './showroom.css?build=0799', './showroom.js?build=0799', SHOWROOM_ART, './art/fox-credit-drop.png',
  './app.js?build=0797', './recent.js?build=0789', './storage.js?build=0794', './final.js?build=0788', './final-ui.js?build=0788',
  './psd-core.js?build=0786', './psd-core.js',
  './psd-file.js', './psd-ui.js?build=0789', './psd-worker.js', './vendor/ag-psd.js',
  './procreate-worker.js?build=0789', './procreate-file.js?build=0789', './procreate-plist.js', './procreate-tiles.js',
  './vendor/procreate-zip.js', './vendor/procreate-lzo.js', './manifest.webmanifest', './icons/icon-192-v073.png',
  './icons/icon-512-v073.png', './icons/apple-touch-icon-v073.png', './icons/apple-touch-icon.png',
  './icons/icon-192.png', './icons/icon-512.png',
];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL.map(path => new Request(path, { cache: 'reload' })));
    // Remove the retired artwork even while the new worker is waiting.
    const previousCache = PREFIX + 'v0.7.69';
    if (await caches.has(previousCache)) {
      const previous = await caches.open(previousCache);
      await Promise.all(['./art/dripd-artwork.jpg', './art/drip-chrome-drop.jpg']
        .map(path => previous.delete(new URL(path, self.registration.scope).href)));
    }
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  if (url.pathname.endsWith('.pdf')) return;
  // Keep each shell version together, including while a newer version waits.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // The versioned intro artwork must be ready even on a stalled connection.
    if (url.href === new URL(SHOWROOM_ART, self.registration.scope).href) {
      const artwork = await cache.match(event.request);
      if (artwork) return artwork;
    }
    const roadmapURL = new URL(ROADMAP, self.registration.scope);
    const key = event.request.mode === 'navigate'
      ? (url.pathname === roadmapURL.pathname ? roadmapURL.href : new URL('./index.html', self.registration.scope).href)
      : event.request;
    // Prefer deployed files when online; retain cached shell for offline usage.
    try {
      const response = await fetch(event.request, { cache: 'no-store' });
      if (response.ok) {
        await cache.put(key, response.clone());
        return response;
      }
    } catch (_) { /* offline: use cached shell */ }
    return await cache.match(key) || fetch(event.request);
  })());
});





