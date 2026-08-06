(function initFreezaSampleInstrument(global) {
  'use strict';

  const buffers = new Map();
  const pending = new Map();

  function manifest(packId) {
    return global.FreezaSampleInstrumentManifests?.[String(packId || '')] || null;
  }

  function sampleUrl(pack, sample) {
    return pack.base + String(sample).split('/').map(encodeURIComponent).join('/');
  }

  function keyFor(pack, region) { return `${pack.id}:${region.sample}`; }

  function decode(ctx, bytes) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish(reject, new Error('instrument sample decode timeout')), 18000);
      function finish(callback, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(value);
      }
      const result = ctx.decodeAudioData(bytes.slice(0), value => finish(resolve, value), error => finish(reject, error));
      if (result?.then) result.then(value => finish(resolve, value), error => finish(reject, error));
    });
  }

  function load(ctx, pack, region) {
    const key = keyFor(pack, region);
    if (buffers.has(key)) return Promise.resolve(buffers.get(key));
    if (pending.has(key)) return pending.get(key);
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timeout = setTimeout(() => controller?.abort(), 18000);
    const url = sampleUrl(pack, region.sample);
    const promise = fetch(url, { cache: 'force-cache', ...(controller ? { signal: controller.signal } : {}) })
      .then(response => {
        if (!response.ok) throw new Error(`${response.status} ${url}`);
        return response.arrayBuffer();
      })
      .then(bytes => decode(ctx, bytes))
      .then(buffer => {
        buffers.set(key, buffer);
        return buffer;
      })
      .finally(() => {
        clearTimeout(timeout);
        pending.delete(key);
      });
    pending.set(key, promise);
    return promise;
  }

  function velocityValue(velocity) {
    return Math.max(0, Math.min(127, Math.round(Number(velocity || 0) * 127)));
  }

  function distance(region, midi, velocity) {
    return Math.abs(region.center - midi)
      + (velocity < region.lovel ? region.lovel - velocity : velocity > region.hivel ? velocity - region.hivel : 0) / 10;
  }

  function candidates(pack, midi, velocity, random = Math.random()) {
    const key = Math.round(Number(midi));
    const vel = velocityValue(velocity);
    let list = pack.regions.filter(region => key >= region.lo && key <= region.hi
      && vel >= region.lovel && vel <= region.hivel);
    if (!list.length) {
      const nearest = pack.regions.reduce((best, region) => distance(region, key, vel) < distance(best, key, vel) ? region : best);
      list = pack.regions.filter(region => region.center === nearest.center
        && vel >= region.lovel && vel <= region.hivel);
      if (!list.length) list = [nearest];
    }
    const rr = list.filter(region => random >= region.lorand && (random < region.hirand || region.hirand === 1));
    return rr.length ? rr : list;
  }

  function regionFor(pack, midi, velocity) { return candidates(pack, midi, velocity)[0]; }

  function nearestLoaded(pack, midi, velocity) {
    const key = Math.round(Number(midi));
    const vel = velocityValue(velocity);
    const loaded = pack.regions.filter(region => buffers.has(keyFor(pack, region)));
    return loaded.length
      ? loaded.reduce((best, region) => distance(region, key, vel) < distance(best, key, vel) ? region : best)
      : null;
  }

  function selectedRegions(pack, midis) {
    const notes = [...new Set((midis || []).map(Number).filter(Number.isFinite))];
    const regions = notes.length
      ? pack.regions.filter(region => notes.some(note => note >= region.lo && note <= region.hi))
      : pack.regions;
    return [...new Map(regions.map(region => [region.sample, region])).values()]
      .sort((a, b) => Math.abs(a.center - 60) - Math.abs(b.center - 60));
  }

  async function preload(ctx, packId, midis = [], onProgress = null) {
    const pack = manifest(packId);
    if (!pack) throw new Error(`Unknown sample pack: ${packId}`);
    const selected = selectedRegions(pack, midis);
    let settled = 0;
    if (typeof onProgress === 'function') onProgress(0, selected.length);
    const results = await Promise.allSettled(selected.map(region => load(ctx, pack, region).finally(() => {
      settled++;
      if (typeof onProgress === 'function') onProgress(settled, selected.length);
    })));
    const failed = results.filter(result => result.status === 'rejected');
    if (failed.length) throw new AggregateError(failed.map(item => item.reason), `${packId}: ${failed.length} sample(s) failed`);
    return results;
  }

  function connectProfile(ctx, source, destination, profile) {
    if (!profile || !ctx.createBiquadFilter) {
      source.connect(destination);
      return;
    }
    const nodes = [];
    if (profile.highpass) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = profile.highpass;
      nodes.push(filter);
    }
    if (profile.lowpass) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = profile.lowpass;
      nodes.push(filter);
    }
    if (profile.presence) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = profile.presence.frequency || 2200;
      filter.Q.value = profile.presence.q || 0.7;
      filter.gain.value = profile.presence.gain || 0;
      nodes.push(filter);
    }
    let current = source;
    nodes.forEach(node => { current.connect(node); current = node; });
    current.connect(destination);
  }

  function play(ctx, destination, packId, midi, duration, velocity, gainScale, when = ctx.currentTime, profile = null) {
    const pack = manifest(packId);
    if (!pack) return null;
    const preferred = regionFor(pack, midi, velocity);
    let region = preferred;
    let buffer = buffers.get(keyFor(pack, region));
    if (!buffer) {
      region = nearestLoaded(pack, midi, velocity);
      buffer = region ? buffers.get(keyFor(pack, region)) : null;
      load(ctx, pack, preferred).catch(error => console.warn('Instrument sample load failed:', error));
      if (!buffer) return null;
    }
    const start = Math.max(ctx.currentTime, Number(when) || ctx.currentTime);
    const hold = Math.max(0.05, Math.min(6, Number(duration) || 0.7));
    const attack = Math.max(0.002, Math.min(0.12, Number(pack.attack) || 0.004));
    const release = Math.max(0.05, Math.min(2.5, Number(pack.release) || 0.45));
    const regionGain = Math.pow(10, Number(region.volume || 0) / 20);
    const peak = Math.max(0.002, Math.min(1.4, Number(velocity || 0) * Number(gainScale || 1) * regionGain));
    const source = ctx.createBufferSource();
    const envelope = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = Math.pow(2, (Number(midi) - region.center) / 12);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(peak, start + attack);
    envelope.gain.setTargetAtTime(Math.max(0.0001, peak * (profile?.sustain ?? 0.9)), start + attack, 0.12);
    envelope.gain.setTargetAtTime(0.0001, start + hold, release / 4.6);
    source.connect(envelope);
    connectProfile(ctx, envelope, destination, profile);
    source.start(start);
    source.stop(Math.min(start + hold + release * 2.4, start + buffer.duration / source.playbackRate.value));
    return source;
  }

  function clear() {
    buffers.clear();
    pending.clear();
  }

  global.FreezaSampleInstrument = Object.freeze({ preload, play, clear });
})(window);
