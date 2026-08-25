const BUILD = 'freeza-live-20260825-12';
const AUDIO_CACHE = 'freeza-live-audio-v1';

self.addEventListener('install', event => {
  void BUILD;
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const scopePath = new URL(self.registration.scope).pathname;
  const relativePath = url.pathname.startsWith(scopePath) ? url.pathname.slice(scopePath.length) : '';
  const stableAudio = url.origin === self.location.origin
    && /^(?:samples|soundfonts)\//.test(relativePath);
  if (!stableAudio) {
    // HTML、WASM、曲库和 FLM 保持网络直取，不能让手机停在旧谱面。
    event.respondWith(fetch(event.request));
    return;
  }
  // 音色文件体积大且路径稳定：第一次成功下载后直接复用，避免每次启动
  // 都让 iPhone 重复请求几十个采样。音色内容更新时手动递增 AUDIO_CACHE。
  event.respondWith(caches.open(AUDIO_CACHE).then(async cache => {
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) await cache.put(event.request, response.clone());
    return response;
  }));
});
