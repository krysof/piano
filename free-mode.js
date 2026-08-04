(function attachFreeMode(global) {
  'use strict';

  const MIN_BPM = 40;
  const MAX_BPM = 240;
  const DEFAULT_BPM = 120;

  function clampBpm(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return DEFAULT_BPM;
    return Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(numeric)));
  }

  function create(initialBpm = DEFAULT_BPM) {
    let bpm = clampBpm(initialBpm);
    let lastTapAt = 0;
    let tapIntervals = [];

    return {
      get bpm() {
        return bpm;
      },

      setBpm(value) {
        bpm = clampBpm(value);
        return bpm;
      },

      adjust(delta) {
        return this.setBpm(bpm + Number(delta || 0));
      },

      tap(at = performance.now()) {
        const now = Number(at);
        if (!Number.isFinite(now)) return bpm;
        if (lastTapAt > 0) {
          const interval = now - lastTapAt;
          if (interval > 2000) {
            tapIntervals = [];
          } else if (interval >= 250 && interval <= 1500) {
            tapIntervals.push(interval);
            tapIntervals = tapIntervals.slice(-5);
            const average = tapIntervals.reduce((sum, item) => sum + item, 0) / tapIntervals.length;
            bpm = clampBpm(60000 / average);
          }
        }
        lastTapAt = now;
        return bpm;
      },

      resetTaps() {
        lastTapAt = 0;
        tapIntervals = [];
      },

      beatMs() {
        return 60000 / bpm;
      },

      barMs(beats = 4) {
        const count = Math.max(1, Number(beats) || 4);
        return this.beatMs() * count;
      },
    };
  }

  global.FreezaFreeMode = Object.freeze({
    MIN_BPM,
    MAX_BPM,
    DEFAULT_BPM,
    clampBpm,
    create,
  });
}(window));
