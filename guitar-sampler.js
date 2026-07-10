(function initFreezaGuitarSampler(global) {
  'use strict';

  const buffers = new Map();
  const pending = new Map();

  function libraryForCode(code) {
    const text = String(code || '').trim().toLowerCase();
    if (/^gs_1$/.test(text) || /nylon|classical/.test(text)) return 'nylon';
    if (/^gec2|jazz/.test(text)) return 'electric-jazz';
    if (/^ged|dist|overdrive|metal/.test(text)) return 'electric-distorted';
    if (/^gec|electric|clean/.test(text)) return 'electric-clean';
    return 'steel';
  }

  function manifestForCode(code) {
    return global.FreezaGuitarManifests?.[libraryForCode(code)] || null;
  }

  function encodedSampleUrl(manifest, sample) {
    return manifest.base + String(sample).split('/').map(encodeURIComponent).join('/');
  }

  function bufferKey(manifest, region) {
    return `${manifest.id}:${region.sample}`;
  }

  function decode(ctx, data) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = value => { if (!settled) { settled = true; resolve(value); } };
      const fail = error => { if (!settled) { settled = true; reject(error); } };
      const result = ctx.decodeAudioData(data.slice(0), done, fail);
      if (result && typeof result.then === 'function') result.then(done, fail);
    });
  }

  function loadRegion(ctx, manifest, region) {
    const id = bufferKey(manifest, region);
    if (buffers.has(id)) return Promise.resolve(buffers.get(id));
    if (pending.has(id)) return pending.get(id);
    const url = encodedSampleUrl(manifest, region.sample);
    const promise = fetch(url, { cache: 'force-cache' })
      .then(response => {
        if (!response.ok) throw new Error(`${response.status} ${url}`);
        return response.arrayBuffer();
      })
      .then(data => decode(ctx, data))
      .then(buffer => {
        buffers.set(id, buffer);
        pending.delete(id);
        return buffer;
      })
      .catch(error => {
        pending.delete(id);
        throw error;
      });
    pending.set(id, promise);
    return promise;
  }

  function regionsFor(manifest, midi, velocity, random = Math.random()) {
    const key = Math.round(Number(midi));
    const vel = Math.max(0, Math.min(127, Math.round(Number(velocity || 0) * 127)));
    let matches = manifest.regions.filter(region =>
      key >= region.lo && key <= region.hi && vel >= region.lovel && vel <= region.hivel);
    if (!matches.length) {
      const distance = region => Math.abs(region.center - key)
        + (vel < region.lovel ? region.lovel - vel : vel > region.hivel ? vel - region.hivel : 0) / 12;
      const nearest = manifest.regions.reduce((best, region) => distance(region) < distance(best) ? region : best);
      matches = manifest.regions.filter(region => region.center === nearest.center
        && vel >= region.lovel && vel <= region.hivel);
      if (!matches.length) matches = [nearest];
    }
    return matches.filter(region => random >= region.lorand && (random < region.hirand || region.hirand === 1));
  }

  function chooseRegion(manifest, midi, velocity) {
    const matches = regionsFor(manifest, midi, velocity);
    return matches[0] || regionsFor(manifest, midi, velocity, 0.5)[0];
  }

  function preload(ctx, code, midis = []) {
    const manifest = manifestForCode(code);
    if (!manifest) return Promise.resolve([]);
    const keys = [...new Set(midis.map(Number).filter(Number.isFinite))];
    const selected = keys.length
      ? manifest.regions.filter(region => keys.some(midi => midi >= region.lo && midi <= region.hi))
      : manifest.regions;
    const unique = [...new Map(selected.map(region => [region.sample, region])).values()]
      .sort((a, b) => Math.abs(a.center - 60) - Math.abs(b.center - 60));
    return Promise.allSettled(unique.map(region => loadRegion(ctx, manifest, region)));
  }

  function preloadAll(ctx, code) { return preload(ctx, code); }

  function play(ctx, destination, code, midi, duration, velocity, gainScale) {
    const manifest = manifestForCode(code);
    if (!manifest) return false;
    const region = chooseRegion(manifest, midi, velocity);
    const buffer = buffers.get(bufferKey(manifest, region));
    if (!buffer) {
      loadRegion(ctx, manifest, region).catch(error => console.warn('Guitar sample load failed:', error));
      return false;
    }
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = Math.pow(2, (Number(midi) - region.center) / 12);
    const regionGain = Math.pow(10, Number(region.volume || 0) / 20);
    const peak = Math.max(0.003, Math.min(1.4, Number(velocity || 0) * Number(gainScale || 1) * regionGain));
    const hold = Math.max(0.06, Math.min(4, Number(duration || 0.75)));
    const release = Math.max(0.08, Math.min(2.5, Number(manifest.release || 1)));
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.004);
    gain.gain.setTargetAtTime(peak * 0.84, now + 0.028, 0.16);
    gain.gain.setTargetAtTime(0.0001, now + hold, release / 4.6);
    source.connect(gain).connect(destination);
    source.start(now);
    source.stop(now + hold + release * 2.2);
    return true;
  }

  global.FreezaGuitarSampler = Object.freeze({ libraryForCode, preload, preloadAll, play });
})(window);
