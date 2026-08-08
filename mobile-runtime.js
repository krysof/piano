(function initFreezaMobileRuntime(global) {
  'use strict';

  const REMOTE_ROOT = 'https://krysof.github.io/piano/';
  const REMOTE_PREFIXES = Object.freeze(['music/', 'vault-music/', 'samples/', 'soundfonts/']);
  const capacitor = global.Capacitor;
  const native = Boolean(capacitor?.isNativePlatform?.());

  function isRemoteAsset(value) {
    if (typeof value !== 'string') return false;
    const clean = value.replace(/^\.\//, '');
    return REMOTE_PREFIXES.some(prefix => clean.startsWith(prefix));
  }

  function assetUrl(value) {
    if (!native || !isRemoteAsset(value)) return value;
    return new URL(String(value).replace(/^\.\//, ''), REMOTE_ROOT).href;
  }

  // The native bundle intentionally excludes the large song/sample library.
  // Redirect only those resources; UI, WASM and patterns remain local/offline.
  if (native && typeof global.fetch === 'function') {
    const originalFetch = global.fetch.bind(global);
    global.fetch = (input, init) => {
      if (typeof input === 'string') return originalFetch(assetUrl(input), init);
      if (input instanceof URL) return originalFetch(new URL(assetUrl(input.href)), init);
      return originalFetch(input, init);
    };
  }

  let plugin = null;
  try {
    plugin = capacitor?.registerPlugin?.('FreezaNative') || capacitor?.Plugins?.FreezaNative || null;
  } catch {
    plugin = capacitor?.Plugins?.FreezaNative || null;
  }

  async function activateAudio(recording = false) {
    if (!native || !plugin?.activateAudio) return false;
    try {
      const result = await plugin.activateAudio({ recording: Boolean(recording) });
      return result?.active !== false;
    } catch (error) {
      console.warn('Native audio session activation failed', error);
      return false;
    }
  }

  global.FreezaMobileRuntime = Object.freeze({
    native,
    platform: capacitor?.getPlatform?.() || 'web',
    remoteRoot: REMOTE_ROOT,
    assetUrl,
    plugin,
    activateAudio,
  });
})(window);
