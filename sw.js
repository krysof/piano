const BUILD = 'freeza-live-20260805-09';

self.addEventListener('install', event => {
  void BUILD;
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// Network-only by design: Freeza Live updates its song catalog frequently and
// must never strand a phone on an old FLM/WASM build.  A controlled fetch
// handler still provides the installable PWA surface without stale assets.
self.addEventListener('fetch', event => {
  if (event.request.method === 'GET') event.respondWith(fetch(event.request));
});
