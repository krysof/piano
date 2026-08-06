(function initFreezaSynthLead(global) {
  'use strict';

  function warm(ctx) {
    if (!ctx?.createOscillator || !ctx?.createBiquadFilter || !ctx?.createGain) {
      return Promise.reject(new Error('WebAudio synthesizer unavailable'));
    }
    return Promise.resolve(true);
  }

  function play(ctx, destination, _code, midi, duration, velocity, gainScale, when = ctx.currentTime) {
    if (!ctx || !destination) return null;
    const start = Math.max(ctx.currentTime, Number(when) || ctx.currentTime);
    const hold = Math.max(0.06, Math.min(4, Number(duration) || 0.65));
    const releaseAt = start + hold;
    const stopAt = releaseAt + 0.18;
    const frequency = 440 * Math.pow(2, (Number(midi) - 69) / 12);
    const peak = Math.max(0.008, Math.min(0.15,
      Number(velocity || 0.6) * Number(gainScale || 0.8) * 0.15));

    const output = ctx.createGain();
    const highpass = ctx.createBiquadFilter();
    const lowpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.setValueAtTime(95, start);
    lowpass.type = 'lowpass';
    lowpass.Q.setValueAtTime(1.15, start);
    lowpass.frequency.setValueAtTime(2700, start);
    lowpass.frequency.exponentialRampToValueAtTime(6200, start + 0.025);
    lowpass.frequency.exponentialRampToValueAtTime(3300, Math.min(releaseAt, start + 0.24));
    output.gain.setValueAtTime(0.0001, start);
    output.gain.exponentialRampToValueAtTime(peak, start + 0.009);
    output.gain.exponentialRampToValueAtTime(peak * 0.78, start + 0.085);
    output.gain.setValueAtTime(peak * 0.78, releaseAt);
    output.gain.exponentialRampToValueAtTime(0.0001, stopAt);
    highpass.connect(lowpass).connect(output).connect(destination);

    const oscillators = [];
    const lfo = ctx.createOscillator();
    const lfoDepth = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(5.2, start);
    lfoDepth.gain.setValueAtTime(0, start);
    lfoDepth.gain.linearRampToValueAtTime(5.5, start + Math.min(0.42, hold * 0.7));
    lfo.connect(lfoDepth);

    [
      { detune: -8, level: 0.33, pan: -0.34, type: 'sawtooth' },
      { detune: 0, level: 0.46, pan: 0, type: 'sawtooth' },
      { detune: 8, level: 0.33, pan: 0.34, type: 'sawtooth' },
      { detune: -1200, level: 0.07, pan: 0, type: 'square' },
    ].forEach(layer => {
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

  global.FreezaSynthLead = Object.freeze({ warm, play });
})(window);
