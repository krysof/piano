(function initAudioScheduler(global) {
  'use strict';

  class AudioScheduler {
    constructor(options = {}) {
      this.now = options.now || (() => performance.now());
      this.setTimer = options.setTimer || ((fn, ms) => setTimeout(fn, ms));
      this.clearTimer = options.clearTimer || (id => clearTimeout(id));
      this.lookaheadMs = Math.max(20, Number(options.lookaheadMs) || 90);
      this.tasks = new Map();
      this.groups = new Map();
      this.nextId = 1;
    }

    scheduleAudio(context, delayMs, callback, group = 'audio') {
      const task = {
        id: this.nextId++,
        group,
        context,
        callback,
        dueAt: this.now() + Math.max(0, Number(delayMs) || 0),
        timer: null,
        cancelled: false,
        committed: false,
        release: null,
      };
      this.tasks.set(task.id, task);
      if (!this.groups.has(group)) this.groups.set(group, new Set());
      this.groups.get(group).add(task.id);
      this.arm(task);
      return Object.freeze({
        id: task.id,
        get dueAt() { return task.dueAt; },
        get committed() { return task.committed; },
        cancel: () => this.cancel(task.id),
      });
    }

    arm(task) {
      if (task.cancelled || task.committed) return;
      const remaining = task.dueAt - this.now();
      if (remaining <= this.lookaheadMs) {
        this.commit(task, remaining);
        return;
      }
      task.timer = this.setTimer(() => {
        task.timer = null;
        this.arm(task);
      }, Math.max(1, remaining - this.lookaheadMs));
    }

    commit(task, remainingMs) {
      if (task.cancelled || task.committed) return;
      task.committed = true;
      const contextNow = Number(task.context?.currentTime) || 0;
      const when = contextNow + Math.max(0, remainingMs) / 1000;
      const result = task.callback(when, task.dueAt);
      if (typeof result === 'function') task.release = result;
      else if (result && typeof result.stop === 'function') task.release = () => result.stop();
      // 保留一小段时间用于暂停/切歌时停止已提交但仍在发声的 AudioNode，
      // 随后自动释放引用，避免整首歌累计任务。
      task.timer = this.setTimer(() => {
        task.timer = null;
        this.remove(task);
      }, Math.max(1000, Math.max(0, remainingMs) + 8000));
    }

    cancel(id) {
      const task = this.tasks.get(id);
      if (!task || task.cancelled) return false;
      task.cancelled = true;
      if (task.timer !== null) this.clearTimer(task.timer);
      try { task.release?.(); } catch (_) { /* 已自然结束的 AudioNode 可忽略 */ }
      this.remove(task);
      return true;
    }

    cancelGroup(group, options = {}) {
      const includeCommitted = options.includeCommitted !== false;
      const ids = [...(this.groups.get(group) || [])];
      const cancellable = ids.filter(id => includeCommitted || !this.tasks.get(id)?.committed);
      cancellable.forEach(id => this.cancel(id));
      return cancellable.length;
    }

    clear() {
      [...this.tasks.keys()].forEach(id => this.cancel(id));
    }

    remove(task) {
      this.tasks.delete(task.id);
      const group = this.groups.get(task.group);
      group?.delete(task.id);
      if (group && !group.size) this.groups.delete(task.group);
    }

    snapshot() {
      return Object.freeze({
        pending: [...this.tasks.values()].filter(task => !task.committed).length,
        committed: [...this.tasks.values()].filter(task => task.committed).length,
        groups: Object.fromEntries([...this.groups].map(([name, ids]) => [name, ids.size])),
      });
    }
  }

  const api = Object.freeze({ create: options => new AudioScheduler(options) });
  global.FreezaAudioScheduler = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
