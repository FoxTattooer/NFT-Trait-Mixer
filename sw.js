'use strict';
// Increment the version whenever an application-shell file changes.
const PREFIX = `trait-workshop:${self.registration.scope}:`;
const CACHE = PREFIX + 'v0.7.182';
const ROADMAP = './plan-rozvoje.html';
const SHOWROOM_ART = './art/showroom-dripd.png?build=0775';
const SKIN_ART = ['cup', 'emerald', 'gold', 'lime', 'mosaic', 'orange', 'purple', 'rainbow', 'red', 'silver', 'water']
  .flatMap(material => [`./art/skin-relief/${material}.webp`, `./art/skin-relief/${material}-tag.webp`]);
const LOOKBOOK_ART = ['./art/lookbook/tag-icons.webp', './art/lookbook/5panel.webp', './art/lookbook/gun.webp'];
const OFFLINE_ART = new Set([SHOWROOM_ART, ...LOOKBOOK_ART, ...SKIN_ART].map(path => new URL(path, self.registration.scope).href));
const PDF_DOCUMENTS = new Set([
  './docs/NFT-Trait-Mixer-pruvodce-v0.7.97.pdf',
  './docs/NFT-Trait-Mixer-mobilni-design.pdf',
].map(path => new URL(path, self.registration.scope).pathname));
const SHELL = [
  './layer-inventory.css?build=07164', './layer-inventory.js?build=07160',
  './inventory-base.js?build=07160', './inventory-base-ui.js?build=07131', './inventory-preview.js?build=07112', './inventory-review.js?build=07113', './inventory-dripd.json?build=07111',
  './pdf-info.css?build=07158', './pdf-info.js?build=07101',
  './trait-comparison.css?build=07158', './trait-comparison.js?build=07179',
  './lookbook.css?build=07182', './lookbook-cards.js?build=07148', './lookbook.js?build=07182',
  './', './index.html', ROADMAP, './styles.css?build=07158', './design.css?build=07169', './compact.css?build=07182',
  './schemes.css?build=07182', './drag.js?build=07135', './project.js?build=07179', './diagnostics.js?build=07182',
  './showroom-mint.css?build=07158', './showroom-mint.js?build=07156',
  './showroom.css?build=07158', './showroom.js?build=07156', SHOWROOM_ART, ...LOOKBOOK_ART, ...SKIN_ART, './art/fox-credit-drop.png',
  './step-history.js?build=07169', './app.js?build=07182', './recent.js?build=0789', './storage.js?build=07178', './final.js?build=07179', './folder-export.js?build=07162', './final-ui.js?build=07179', './final-builder.js?build=07164',
  './psd-core.js?build=0786', './psd-core.js',
  './psd-export.js?build=07161', './psd-export.js', './psd-file.js', './psd-ui.js?build=07153', './psd-worker.js', './vendor/ag-psd.js',
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
  const isPdf = url.pathname.endsWith('.pdf');
  if (isPdf && (!PDF_DOCUMENTS.has(url.pathname) || event.request.headers.has('range'))) return;
  // Keep each shell version together, including while a newer version waits.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Precached artwork is ready even on a stalled connection.
    if (OFFLINE_ART.has(url.href)) {
      const artwork = await cache.match(event.request);
      if (artwork) return artwork;
    }
    const roadmapURL = new URL(ROADMAP, self.registration.scope);
    const key = !isPdf && event.request.mode === 'navigate'
      ? (url.pathname === roadmapURL.pathname ? roadmapURL.href : new URL('./index.html', self.registration.scope).href)
      : event.request;
    // Prefer deployed files when online; retain cached shell for offline usage.
    try {
      const response = await fetch(event.request, { cache: 'no-store' });
      if (response.ok) {
        if (isPdf) await cache.put(key, response.clone()).catch(() => {});
        else await cache.put(key, response.clone());
        return response;
      }
    } catch (_) { /* offline: use cached shell */ }
    return await cache.match(key) || fetch(event.request);
  })());
});





