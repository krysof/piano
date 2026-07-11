(function initInteractiveState(global) {
  'use strict';

  const PHASES = Object.freeze({
    IDLE: 'idle',
    COUNTDOWN: 'countdown',
    READY: 'ready',
    WAITING: 'waiting',
    PLAYING: 'playing',
    QUEUED: 'queued',
    TRANSITIONING: 'transitioning',
    COMPLETE: 'complete',
  });

  function cueKey(cue) {
    if (!cue) return '';
    if (cue._id) return `id:${cue._id}`;
    const time = Number(cue.time);
    return `cue:${Number.isFinite(time) ? time.toFixed(4) : ''}:${String(cue.chord || '')}`;
  }

  function sameCue(left, right) {
    if (!left || !right) return false;
    if (left === right) return true;
    return cueKey(left) === cueKey(right);
  }

  function gradeByError(progress, thresholds) {
    const error = Math.abs(Number(progress) - 100);
    const labels = ['SSS', 'SS', 'S', 'A', 'B', 'C', 'D', 'E'];
    for (let index = 0; index < thresholds.length; index += 1) {
      if (error <= thresholds[index]) return labels[index];
    }
    return 'F';
  }

  function judgeOneKeyTiming(progress, busy = false) {
    const value = Number(progress);
    if (!Number.isFinite(value) || value < 70 || value > 120 || busy) {
      return Object.freeze({ accepted: false, progress: value, grade: 'MISS' });
    }
    return Object.freeze({
      accepted: true,
      progress: value,
      grade: gradeByError(value, [2, 4, 6, 9, 12, 15, 18, 22]),
    });
  }

  function judgeManualTiming(progress) {
    const value = Number(progress);
    if (!Number.isFinite(value)) return Object.freeze({ accepted: false, progress: value, grade: 'MISS' });
    const ratedProgress = Math.max(85, Math.min(115, value));
    return Object.freeze({
      // 0.1% 是 performance.now() 与进度条不同帧取样的容差。
      accepted: value >= 84.9,
      progress: ratedProgress,
      grade: value >= 84.9 ? gradeByError(ratedProgress, [1.5, 3, 4.5, 6, 7.5, 9, 10.5, 12]) : 'MISS',
    });
  }

  class InteractiveState {
    constructor(mode = 'semi') {
      this.reset(mode);
    }

    reset(mode = this.mode || 'semi') {
      this.mode = mode;
      this.phase = PHASES.IDLE;
      this.phrase = null;
      this.transitioning = false;
      this.queue = [];
      this.wrongLockUntil = -Infinity;
      return this.snapshot();
    }

    beginCountdown(mode = this.mode) {
      this.reset(mode);
      this.phase = PHASES.COUNTDOWN;
    }

    finishCountdown() {
      if (this.phase === PHASES.COUNTDOWN || this.phase === PHASES.IDLE) {
        this.phase = PHASES.READY;
      }
    }

    canAcceptInput() {
      return this.phase !== PHASES.COUNTDOWN && this.phase !== PHASES.IDLE;
    }

    setWaiting(phrase) {
      this.phrase = phrase || null;
      this.transitioning = false;
      this.phase = phrase ? PHASES.WAITING : PHASES.READY;
      return this.phrase;
    }

    startPhrase(phrase) {
      this.phrase = phrase || null;
      this.transitioning = false;
      this.phase = phrase ? PHASES.PLAYING : PHASES.READY;
      return this.phrase;
    }

    markPhraseComplete(phrase = this.phrase) {
      if (phrase && this.phrase !== phrase) return false;
      if (this.phrase) this.phrase.musicVisualComplete = true;
      this.phase = this.queue.length ? PHASES.QUEUED : PHASES.COMPLETE;
      return true;
    }

    clearPhrase(phrase = null) {
      if (phrase && this.phrase !== phrase) return false;
      this.phrase = null;
      if (!this.transitioning) this.phase = this.queue.length ? PHASES.QUEUED : PHASES.READY;
      return true;
    }

    beginTransition() {
      if (this.transitioning) return false;
      this.transitioning = true;
      this.phase = PHASES.TRANSITIONING;
      return true;
    }

    finishTransition() {
      this.transitioning = false;
      this.phrase = null;
      this.phase = this.queue.length ? PHASES.QUEUED : PHASES.READY;
    }

    hasQueuedCue(cue) {
      return Boolean(cue && this.queue.some(request => sameCue(request?.cue, cue)));
    }

    enqueue(request) {
      if (!request || !request.cue || this.hasQueuedCue(request.cue)) return false;
      this.queue.push(request);
      if (!this.transitioning) this.phase = PHASES.QUEUED;
      return true;
    }

    shiftQueue() {
      const request = this.queue.shift() || null;
      if (!this.queue.length && !this.phrase && !this.transitioning) this.phase = PHASES.READY;
      return request;
    }

    decideRequest(request, options = {}) {
      if (!request?.cue) return Object.freeze({ action: 'ignore', reason: 'missing-cue' });
      if (!this.canAcceptInput()) return Object.freeze({ action: 'ignore', reason: this.phase });
      if (this.transitioning || this.phrase?.waiting) {
        const queued = this.enqueue(request);
        return Object.freeze({ action: queued ? 'queue' : 'ignore', reason: queued ? this.phase : 'duplicate' });
      }
      const pending = Boolean(options.pending);
      const boundaryPending = Boolean(options.boundaryPending);
      if (this.phrase && (pending || boundaryPending)) {
        const queued = this.enqueue(request);
        if (!queued) return Object.freeze({ action: 'ignore', reason: 'duplicate' });
        const catchup = Boolean(options.allowCatchup && options.melodyAlreadyStarted && pending);
        return Object.freeze({ action: catchup ? 'catchup' : 'queue', reason: catchup ? 'late-accompaniment' : 'phrase-active' });
      }
      return Object.freeze({ action: 'start', reason: 'ready' });
    }

    tryWrongFeedback(now, durationMs = 1000) {
      const at = Number(now);
      if (!Number.isFinite(at) || at < this.wrongLockUntil) return false;
      this.wrongLockUntil = at + Math.max(0, Number(durationMs) || 0);
      return true;
    }

    clearWrongFeedback() {
      this.wrongLockUntil = -Infinity;
    }

    snapshot() {
      return Object.freeze({
        mode: this.mode,
        phase: this.phase,
        phrase: this.phrase,
        transitioning: this.transitioning,
        queueLength: this.queue.length,
        queuedCueKeys: this.queue.map(item => cueKey(item?.cue)),
        wrongLockUntil: this.wrongLockUntil,
      });
    }
  }

  const api = Object.freeze({
    PHASES,
    cueKey,
    sameCue,
    judgeOneKeyTiming,
    judgeManualTiming,
    create: mode => new InteractiveState(mode),
  });
  global.FreezaInteractiveState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
