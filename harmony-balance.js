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
  const PLAN_TARGET_RMS = 0.60;
  const PLAN_GAIN_MIN = 0.40;
  const PLAN_GAIN_MAX = 2.15;

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
    // A/B 不只会切音色，也可能切换到音符数量完全不同的 pattern。旧版只允许
    // 0.82–1.18 的轻量修正，遇到“一边单音、一边密集扫弦”时远远不够，因而
    // 切换后会明显跳音量。这里对整段的能量做完整归一化；单个音符之间的
    // velocity 比例与重拍仍原样保留，所以不会把 pattern 内部强弱压平。
    return Math.max(PLAN_GAIN_MIN, Math.min(PLAN_GAIN_MAX, PLAN_TARGET_RMS / rms));
  }

  root.FreezaHarmonyBalance = Object.freeze({
    libraryForCode,
    gainForCode,
    estimatedRms,
    planGain,
    planTargetRms: PLAN_TARGET_RMS,
    planGainRange: Object.freeze([PLAN_GAIN_MIN, PLAN_GAIN_MAX]),
    targetLufs: TARGET_LUFS,
    libraries: LIBRARIES,
  });
})(typeof window !== 'undefined' ? window : globalThis);
