(function initFreezaRecordingDiagnostics(global) {
  'use strict';

  const SAMPLE_INTERVAL_MS = 48;

  function percentile(values, ratio) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
  }

  function create(ctx) {
    const sources = new Map();
    let timer = null;

    function createTap(name, label) {
      if (sources.has(name)) return sources.get(name).node;
      const node = ctx.createAnalyser();
      node.fftSize = 2048;
      node.smoothingTimeConstant = 0;
      sources.set(name, {
        name,
        label,
        node,
        data: new Float32Array(node.fftSize),
        peaks: [],
        transients: [],
        activeFrames: 0,
      });
      return node;
    }

    function reset() {
      sources.forEach(source => {
        source.peaks.length = 0;
        source.transients.length = 0;
        source.activeFrames = 0;
      });
    }

    function sample() {
      sources.forEach(source => {
        source.node.getFloatTimeDomainData(source.data);
        let peak = 0;
        let squareSum = 0;
        let diffSquareSum = 0;
        let previous = source.data[0] || 0;
        for (let i = 0; i < source.data.length; i++) {
          const value = source.data[i];
          peak = Math.max(peak, Math.abs(value));
          squareSum += value * value;
          if (i) {
            const diff = value - previous;
            diffSquareSum += diff * diff;
          }
          previous = value;
        }
        const rms = Math.sqrt(squareSum / source.data.length);
        if (rms < 0.00035) return;
        const diffRms = Math.sqrt(diffSquareSum / Math.max(1, source.data.length - 1));
        source.activeFrames++;
        source.peaks.push(peak);
        // 一阶差分 RMS 代表短促宽带起音；同时保留绝对响度，避免把安静底噪误判成瞬态。
        source.transients.push(diffRms * Math.sqrt(Math.max(0.0001, peak)));
      });
    }

    function start() {
      stopTimer();
      reset();
      timer = setInterval(sample, SAMPLE_INTERVAL_MS);
    }

    function stopTimer() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    }

    function stop() {
      sample();
      stopTimer();
      const sourceResults = Array.from(sources.values()).map(source => ({
        name: source.name,
        label: source.label,
        activeFrames: source.activeFrames,
        peak: percentile(source.peaks, 0.99),
        transientScore: percentile(source.transients, 0.95),
      }));
      const ranked = sourceResults
        .filter(source => source.activeFrames >= 2)
        .sort((a, b) => b.transientScore - a.transientScore);
      const strongest = ranked[0] || null;
      const runnerUp = ranked[1] || null;
      const dominant = strongest && (!runnerUp || strongest.transientScore >= runnerUp.transientScore * 1.18)
        ? strongest.name
        : 'mixed';
      const dominantLabel = dominant === 'mixed' ? '混合声部' : strongest?.label || '无';
      return Object.freeze({ dominant, dominantLabel, sources: sourceResults });
    }

    return Object.freeze({ createTap, start, stop });
  }

  global.FreezaRecordingDiagnostics = Object.freeze({ create });
})(window);
