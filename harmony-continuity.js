(function initHarmonyContinuity(global) {
  'use strict';

  function planSegments({
    firstHalf = 0,
    segmentDuration = 0,
    availableDuration = 0,
    continuous = false,
    maxSegments = 32,
  } = {}) {
    const duration = Number(segmentDuration);
    const available = Number(availableDuration);
    if (!Number.isFinite(duration) || duration <= 0) return [];

    const count = continuous && Number.isFinite(available) && available > duration + 0.04
      ? Math.min(Math.max(1, Math.ceil(available / duration)), Math.max(1, Number(maxSegments) || 32))
      : 1;
    const normalizedHalf = Number(firstHalf) === 1 ? 1 : 0;
    return Array.from({ length: count }, (_, index) => ({
      half: (normalizedHalf + index) % 2,
      offset: index * duration,
    }));
  }

  global.FreezaHarmonyContinuity = { planSegments };
})(typeof window !== 'undefined' ? window : globalThis);
