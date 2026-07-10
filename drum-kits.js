(function initFreezaDrumKits(global) {
  'use strict';

  const BASE = 'samples/drums/fluidr3';
  const buffers = new Map();
  const pending = new Map();

  function kitForCode(code) {
    const text = String(code || '').toLowerCase();
    if (/brush/.test(text)) return 'brush';
    if (/jazz|swing|bossa/.test(text)) return 'jazz';
    if (/orchestra|symph|march/.test(text)) return 'orchestra';
    if (/808|trap|hip.?hop|drumelc_bass/.test(text)) return 'tr808';
    if (/elect|elc|dance|techno|house|edm|disco/.test(text)) return 'electronic';
    if (/rock|metal|power|punk/.test(text)) return 'power';
    return 'standard';
  }

  function key(kit, midi) { return `${kit}:${midi}`; }

  function decode(ctx, data) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = value => { if (!settled) { settled = true; resolve(value); } };
      const fail = error => { if (!settled) { settled = true; reject(error); } };
      const result = ctx.decodeAudioData(data.slice(0), done, fail);
      if (result && typeof result.then === 'function') result.then(done, fail);
    });
  }

  function load(ctx, kit, midi) {
    const id = key(kit, midi);
    if (buffers.has(id)) return Promise.resolve(buffers.get(id));
    if (pending.has(id)) return pending.get(id);
    const url = `${BASE}/${kit}/${midi}.mp3`;
    const promise = fetch(url)
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
        if (kit !== 'standard') return load(ctx, 'standard', midi);
        throw error;
      });
    pending.set(id, promise);
    return promise;
  }

  function preload(ctx, code, midis) {
    const kit = kitForCode(code);
    const notes = [...new Set((midis || []).map(Number).filter(Number.isFinite))];
    return Promise.allSettled(notes.map(midi => load(ctx, kit, midi)));
  }

  function play(ctx, destination, code, midi, velocity, volume) {
    const kit = kitForCode(code);
    const buffer = buffers.get(key(kit, midi)) || buffers.get(key('standard', midi));
    if (!buffer) {
      load(ctx, kit, midi).catch(error => console.warn('Drum sample load failed:', error));
      return false;
    }
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = Math.max(0.001, Math.min(2.4, Number(velocity || 0) * Number(volume || 1)));
    source.connect(gain).connect(destination);
    source.start(ctx.currentTime);
    return true;
  }

  global.FreezaDrumKits = Object.freeze({ kitForCode, preload, play });
})(window);
