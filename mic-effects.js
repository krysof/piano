(function (global) {
  'use strict';

  const PRESETS = Object.freeze({
    natural: Object.freeze({ label: '原声', beauty: 0, reverb: 4, echo: 0, delay: 90 }),
    beauty: Object.freeze({ label: '美声', beauty: 62, reverb: 18, echo: 8, delay: 105 }),
    clear: Object.freeze({ label: '清亮', beauty: 82, reverb: 10, echo: 3, delay: 85 }),
    warm: Object.freeze({ label: '温暖', beauty: 46, reverb: 16, echo: 5, delay: 115 }),
    ktv: Object.freeze({ label: 'KTV', beauty: 68, reverb: 30, echo: 24, delay: 145 }),
    stage: Object.freeze({ label: '舞台', beauty: 58, reverb: 42, echo: 30, delay: 185 }),
    hall: Object.freeze({ label: '大厅', beauty: 52, reverb: 58, echo: 34, delay: 230 }),
  });

  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
  const copyPreset = id => ({ ...(PRESETS[id] || PRESETS.beauty) });

  function makeImpulse(context, seconds = 2.3, decay = 2.8) {
    const rate = context.sampleRate || 48000;
    const length = Math.max(1, Math.round(rate * seconds));
    const impulse = context.createBuffer(2, length, rate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        const envelope = Math.pow(1 - i / length, decay);
        data[i] = (Math.random() * 2 - 1) * envelope;
      }
    }
    return impulse;
  }

  function create(context) {
    const input = context.createGain();
    const highpass = context.createBiquadFilter();
    const warmth = context.createBiquadFilter();
    const presence = context.createBiquadFilter();
    const compressor = context.createDynamicsCompressor();
    const dry = context.createGain();
    const convolver = context.createConvolver();
    const reverbWet = context.createGain();
    const delay = context.createDelay(1);
    const delayWet = context.createGain();
    const feedback = context.createGain();
    const output = context.createGain();

    highpass.type = 'highpass';
    highpass.frequency.value = 82;
    highpass.Q.value = 0.72;
    warmth.type = 'lowshelf';
    warmth.frequency.value = 220;
    presence.type = 'highshelf';
    presence.frequency.value = 3200;
    convolver.buffer = makeImpulse(context);

    input.connect(highpass).connect(warmth).connect(presence).connect(compressor);
    compressor.connect(dry).connect(output);
    compressor.connect(convolver).connect(reverbWet).connect(output);
    compressor.connect(delay).connect(delayWet).connect(output);
    delay.connect(feedback).connect(delay);

    let settings = copyPreset('beauty');
    const setParam = (param, value, time = 0.035) => {
      const now = context.currentTime || 0;
      if (typeof param.setTargetAtTime === 'function') param.setTargetAtTime(value, now, time);
      else param.value = value;
    };

    function apply(next = {}) {
      settings = {
        beauty: clamp(next.beauty ?? settings.beauty, 0, 100),
        reverb: clamp(next.reverb ?? settings.reverb, 0, 100),
        echo: clamp(next.echo ?? settings.echo, 0, 100),
        delay: clamp(next.delay ?? settings.delay, 40, 320),
      };
      const beauty = settings.beauty / 100;
      const reverb = settings.reverb / 100;
      const echo = settings.echo / 100;
      setParam(warmth.gain, 0.4 + beauty * 1.8);
      setParam(presence.gain, beauty * 3.8);
      setParam(compressor.threshold, -16 - beauty * 10);
      setParam(compressor.knee, 12 + beauty * 12);
      setParam(compressor.ratio, 2 + beauty * 2.2);
      setParam(compressor.attack, 0.008);
      setParam(compressor.release, 0.19 + beauty * 0.09);
      setParam(reverbWet.gain, reverb * 0.72);
      setParam(delay.delayTime, settings.delay / 1000);
      setParam(delayWet.gain, echo * 0.56);
      setParam(feedback.gain, Math.min(0.62, echo * 0.58));
      setParam(dry.gain, Math.max(0.76, 1 - reverb * 0.12 - echo * 0.08));
      return { ...settings };
    }

    function dispose() {
      [input, highpass, warmth, presence, compressor, dry, convolver, reverbWet, delay, delayWet, feedback, output]
        .forEach(node => { try { node.disconnect(); } catch (_) {} });
    }

    apply(settings);
    return { input, output, apply, dispose, getSettings: () => ({ ...settings }) };
  }

  global.FreezaMicEffects = Object.freeze({
    presets: PRESETS,
    preset: copyPreset,
    create,
  });
})(window);
