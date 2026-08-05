(function initInteractiveClock(global) {
  'use strict';

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function currentSongTime(options = {}) {
    const offset = finite(options.playOffset) ?? 0;
    const now = finite(options.now) ?? 0;

    if (options.playing) {
      const startedAt = finite(options.playStartedAt) ?? now;
      return Math.max(0, offset + Math.max(0, now - startedAt) / 1000);
    }

    const phrase = options.manualMode ? options.phrase : null;
    if (!phrase || phrase.waiting || phrase.musicVisualComplete) return Math.max(0, offset);

    const performanceStart = finite(phrase.musicStartAt);
    const performanceEnd = finite(phrase.musicEndAt);
    const songStart = finite(phrase.timelineStart);
    const songEnd = finite(phrase.timelineEnd);
    if (performanceStart === null || performanceEnd === null
      || songStart === null || songEnd === null || performanceEnd <= performanceStart) {
      return Math.max(0, offset);
    }

    // 手动/一键模式的声音按一个完整片段连续播放。歌词游标也必须使用同一
    // 连续时钟，不能只在 Note On 触发时跳动；否则遇到休止或长音时画面会
    // 停在某个字上，看起来像播放器卡死。
    const progress = Math.max(0, Math.min(1,
      (now - performanceStart) / (performanceEnd - performanceStart)));
    return Math.max(0, songStart + (songEnd - songStart) * progress);
  }

  const api = Object.freeze({ currentSongTime });
  global.FreezaInteractiveClock = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
