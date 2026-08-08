(() => {
  if (window.FreezaMobileRuntime?.native) return;
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' })
      .catch(error => console.warn('PWA service worker unavailable', error));
  }, { once: true });
})();
