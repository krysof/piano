(function initAudioFocusRecovery(global) {
  'use strict';

  function startSilentUnlockPulse(context) {
    if (!context || context.state === 'closed') return false;
    try {
      const source = context.createBufferSource();
      const gain = context.createGain();
      const buffer = context.createBuffer(1, 1, Math.max(8000, context.sampleRate || 44100));
      gain.gain.value = 0;
      source.buffer = buffer;
      source.connect(gain);
      gain.connect(context.destination);
      source.start(0);
      source.stop?.(context.currentTime + 0.01);
      source.addEventListener?.('ended', () => {
        try { source.disconnect(); } catch {}
        try { gain.disconnect(); } catch {}
      }, { once: true });
      return true;
    } catch {
      return false;
    }
  }

  async function resume(context, tone, options = {}) {
    if (!context || context.state === 'closed') return false;
    const userGesture = Boolean(options.userGesture);
    // 调用 resume/start 的动作必须直接发生在手势调用栈中；不能先 await。
    const attempts = [];
    try { attempts.push(Promise.resolve(context.resume?.())); } catch {}
    try { attempts.push(Promise.resolve(tone?.start?.())); } catch {}
    try { attempts.push(Promise.resolve(tone?.getContext?.()?.resume?.())); } catch {}
    try { attempts.push(Promise.resolve(global.FreezaMobileRuntime?.activateAudio?.(Boolean(options.recording)))); } catch {}
    if (userGesture) startSilentUnlockPulse(context);
    if (attempts.length) await Promise.allSettled(attempts);
    if (userGesture) startSilentUnlockPulse(context);
    return context.state === 'running';
  }

  const api = Object.freeze({ resume, startSilentUnlockPulse });
  global.FreezaAudioFocusRecovery = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
