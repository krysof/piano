(function initFreezaSynthLead(global) {
  'use strict';

  function warm(ctx) {
    if (!ctx?.createOscillator || !ctx?.createBiquadFilter || !ctx?.createGain) {
      return Promise.reject(new Error('WebAudio synthesizer unavailable'));
    }
    return Promise.resolve(true);
  }

  const profiles = Object.freeze({
    blinding: {
      attack: 0.009, release: 0.18, lowpass: [2700, 6200, 3300], highpass: 95,
      sustain: 0.78, vibrato: [5.2, 5.5],
      layers: [
        { detune: -8, level: 0.33, pan: -0.34, type: 'sawtooth' },
        { detune: 0, level: 0.46, pan: 0, type: 'sawtooth' },
        { detune: 8, level: 0.33, pan: 0.34, type: 'sawtooth' },
        { detune: -1200, level: 0.07, pan: 0, type: 'square' },
      ],
    },
    brass80s: {
      attack: 0.028, release: 0.32, lowpass: [1100, 5100, 2500], highpass: 72,
      sustain: 0.72, vibrato: [5.0, 2.4],
      layers: [
        { detune: -14, level: 0.26, pan: -0.42, type: 'sawtooth' },
        { detune: 0, level: 0.43, pan: 0, type: 'sawtooth' },
        { detune: 14, level: 0.26, pan: 0.42, type: 'sawtooth' },
        { detune: -1200, level: 0.11, pan: 0, type: 'square' },
      ],
    },
    moonPad: {
      attack: 0.16, release: 0.95, lowpass: [850, 3100, 1850], highpass: 60,
      sustain: 0.88, vibrato: [4.3, 1.7],
      layers: [
        { detune: -17, level: 0.24, pan: -0.58, type: 'sawtooth' },
        { detune: -5, level: 0.24, pan: -0.2, type: 'triangle' },
        { detune: 5, level: 0.24, pan: 0.2, type: 'triangle' },
        { detune: 17, level: 0.24, pan: 0.58, type: 'sawtooth' },
        { detune: -1200, level: 0.08, pan: 0, type: 'sine' },
      ],
    },
  });

  function play(ctx, destination, code, midi, duration, velocity, gainScale, when = ctx.currentTime) {
    if (!ctx || !destination) return null;
    const profile = profiles[code] || profiles.blinding;
    const start = Math.max(ctx.currentTime, Number(when) || ctx.currentTime);
    const hold = Math.max(0.06, Math.min(4, Number(duration) || 0.65));
    const releaseAt = start + hold;
    const stopAt = releaseAt + profile.release;
    const frequency = 440 * Math.pow(2, (Number(midi) - 69) / 12);
    const peak = Math.max(0.008, Math.min(0.15,
      Number(velocity || 0.6) * Number(gainScale || 0.8) * 0.15));

    const output = ctx.createGain();
    const highpass = ctx.createBiquadFilter();
    const lowpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.setValueAtTime(profile.highpass, start);
    lowpass.type = 'lowpass';
    lowpass.Q.setValueAtTime(1.15, start);
    lowpass.frequency.setValueAtTime(profile.lowpass[0], start);
    lowpass.frequency.exponentialRampToValueAtTime(profile.lowpass[1], start + Math.max(0.025, profile.attack * 1.8));
    lowpass.frequency.exponentialRampToValueAtTime(profile.lowpass[2], Math.min(releaseAt, start + 0.3));
    output.gain.setValueAtTime(0.0001, start);
    output.gain.exponentialRampToValueAtTime(peak, start + profile.attack);
    output.gain.exponentialRampToValueAtTime(peak * profile.sustain, start + profile.attack + 0.09);
    output.gain.setValueAtTime(peak * profile.sustain, releaseAt);
    output.gain.exponentialRampToValueAtTime(0.0001, stopAt);
    highpass.connect(lowpass).connect(output).connect(destination);

    const oscillators = [];
    const lfo = ctx.createOscillator();
    const lfoDepth = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(profile.vibrato[0], start);
    lfoDepth.gain.setValueAtTime(0, start);
    lfoDepth.gain.linearRampToValueAtTime(profile.vibrato[1], start + Math.min(0.42, hold * 0.7));
    lfo.connect(lfoDepth);

    profile.layers.forEach(layer => {
      const osc = ctx.createOscillator();
      const layerGain = ctx.createGain();
      const panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
      osc.type = layer.type;
      osc.frequency.setValueAtTime(frequency, start);
      osc.detune.setValueAtTime(layer.detune, start);
      lfoDepth.connect(osc.detune);
      layerGain.gain.setValueAtTime(layer.level, start);
      osc.connect(layerGain);
      if (panner) {
        panner.pan.setValueAtTime(layer.pan, start);
        layerGain.connect(panner).connect(highpass);
      } else {
        layerGain.connect(highpass);
      }
      osc.start(start);
      osc.stop(stopAt + 0.03);
      oscillators.push(osc);
    });
    lfo.start(start);
    lfo.stop(stopAt + 0.03);

    let stopped = false;
    return {
      stop() {
        if (stopped) return;
        stopped = true;
        const now = ctx.currentTime;
        try {
          output.gain.cancelScheduledValues(now);
          output.gain.setValueAtTime(Math.max(0.0001, output.gain.value), now);
          output.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);
        } catch {}
        oscillators.forEach(osc => { try { osc.stop(now + 0.03); } catch {} });
        try { lfo.stop(now + 0.03); } catch {}
      },
    };
  }

  global.FreezaSynthLead = Object.freeze({ warm, play, profiles: Object.keys(profiles) });
})(window);
