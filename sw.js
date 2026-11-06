'use strict';
// Increment the version whenever an application-shell file changes.
const PREFIX = `trait-workshop:${self.registration.scope}:`;
const CACHE = PREFIX + 'v0.7.16';
const SHELL = ['./', './index.html', './styles.css', './design.css', './drag.js', './project.js', './app.js', './storage.js', './psd-core.js', './psd-file.js', './psd-ui.js', './psd-worker.js', './vendor/ag-psd.js', './manifest.webmanifest', './icons/icon-192-v073.png', './icons/icon-512-v073.png', './icons/apple-touch-icon-v073.png', './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL.map(path => new Request(path, { cache: 'reload' })))));
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
  // Keep each shell version together, including while a newer version waits.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = event.request.mode === 'navigate' ? new URL('./index.html', self.registration.scope).href : event.request;
    return await cache.match(key) || fetch(event.request);
  })());
});




