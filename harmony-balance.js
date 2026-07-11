(function initHarmonyBalance(root) {
  'use strict';

  // 代表性 C4 采样的离线 EBU R128 测量值（LUFS）。目标不是压平演奏强弱，
  // 而是让切换音色库时相同 velocity 的基础响度处于同一量级。
  const LIBRARIES = Object.freeze({
    piano: Object.freeze({ sourceLufs: -27.5, routeDb: -5.0 }),
    nylon: Object.freeze({ sourceLufs: -20.2, routeDb: -6.38 }),
    steel: Object.freeze({ sourceLufs: -14.8, routeDb: -6.38 }),
    'electric-clean': Object.freeze({ sourceLufs: -17.8, routeDb: -6.38 }),
    'electric-jazz': Object.freeze({ sourceLufs: -15.5, routeDb: -6.38 }),
    'electric-distorted': Object.freeze({ sourceLufs: -12.8, routeDb: -6.38 }),
  });
  const TARGET_LUFS = -34;

  function libraryForCode(code) {
    const text = String(code || '').trim().toLowerCase();
    if (/^pianostudio/.test(text) || /piano/.test(text)) return 'piano';
    if (/^gs_1$/.test(text) || /nylon|classical/.test(text)) return 'nylon';
    if (/^gec2|jazz/.test(text)) return 'electric-jazz';
    if (/^ged|dist|overdrive|metal/.test(text)) return 'electric-distorted';
    if (/^gec|electric|clean/.test(text)) return 'electric-clean';
    return 'steel';
  }

  function gainForCode(code, fallback = 0.65) {
    const profile = LIBRARIES[libraryForCode(code)];
    if (!profile) return Number(fallback) || 0.65;
    const gain = Math.pow(10, (TARGET_LUFS - profile.sourceLufs - profile.routeDb) / 20);
    return Math.max(0.08, Math.min(1, gain));
  }

  function estimatedRms(events = []) {
    const valid = events.map(event => ({
      delay: Math.max(0, Number(event.delay) || 0),
      duration: Math.max(0.02, Number(event.duration) || 0.2),
      velocity: Math.max(0, Number(event.velocity) || 0),
    })).filter(event => event.velocity > 0);
    if (!valid.length) return 0;
    const window = Math.max(0.1, ...valid.map(event => event.delay + event.duration));
    const energy = valid.reduce((sum, event) =>
      sum + event.velocity * event.velocity * Math.min(0.8, event.duration), 0) / window;
    return Math.sqrt(Math.max(0, energy));
  }

  function planGain(events = []) {
    const rms = estimatedRms(events);
    if (!(rms > 0)) return 1;
    // 只校正 pattern 密度造成的整体响度差，保留原谱 velocity 强弱与重拍。
    return Math.max(0.82, Math.min(1.18, 0.60 / rms));
  }

  root.FreezaHarmonyBalance = Object.freeze({
    libraryForCode,
    gainForCode,
    estimatedRms,
    planGain,
    targetLufs: TARGET_LUFS,
    libraries: LIBRARIES,
  });
})(typeof window !== 'undefined' ? window : globalThis);
