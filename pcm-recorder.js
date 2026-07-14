(function initFreezaPcmRecorder(global) {
  'use strict';

  const preparedContexts = new WeakMap();

  function wavHeader(sampleRate, channels, dataBytes) {
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);
    const writeText = (offset, text) => {
      for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
    };
    writeText(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    writeText(8, 'WAVE');
    writeText(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true);
    writeText(36, 'data');
    view.setUint32(40, dataBytes, true);
    return buffer;
  }

  function prepare(context, moduleUrl) {
    if (!context?.audioWorklet?.addModule || typeof global.AudioWorkletNode !== 'function') {
      return Promise.resolve(false);
    }
    if (!preparedContexts.has(context)) {
      const load = context.audioWorklet.addModule(moduleUrl).then(() => true);
      const timeout = new Promise(resolve => setTimeout(() => resolve(false), 1500));
      preparedContexts.set(context, Promise.race([load, timeout])
        .catch(error => {
          preparedContexts.delete(context);
          console.warn('PCM recorder worklet unavailable:', error);
          return false;
        }));
    }
    return preparedContexts.get(context);
  }

  async function create(context, source, options = {}) {
    const moduleUrl = options.moduleUrl || 'pcm-recorder-worklet.js';
    if (!await prepare(context, moduleUrl)) return null;

    let node = null;
    let silentSink = null;
    try {
      // Safari 对 outputChannelCount/channelCountMode 的组合支持不一致。
      // 使用最小构造参数，由上游立体声总线决定输入声道数。
      node = new AudioWorkletNode(context, 'freeza-pcm-recorder', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
      });
      silentSink = context.createGain();
      silentSink.gain.value = 0;
      node.connect(silentSink).connect(context.destination);
      source.connect(node);
    } catch (error) {
      try { node?.disconnect(); } catch (_) {}
      try { silentSink?.disconnect(); } catch (_) {}
      console.warn('PCM recorder node unavailable:', error);
      return null;
    }

    let chunks = [];
    let dataBytes = 0;
    let active = false;
    let stopResolve = null;
    let sessionId = 0;

    node.port.onmessage = event => {
      const message = event.data || {};
      if (message.sessionId !== sessionId) return;
      if (message.type === 'pcm' && message.buffer) {
        chunks.push(message.buffer);
        dataBytes += message.buffer.byteLength;
      } else if (message.type === 'stopped' && stopResolve) {
        const resolve = stopResolve;
        stopResolve = null;
        resolve();
      }
    };

    const cleanup = () => {
      try { source.disconnect(node); } catch (_) {}
      try { node.disconnect(); } catch (_) {}
      try { silentSink.disconnect(); } catch (_) {}
      node.port.onmessage = null;
    };

    return {
      start() {
        if (active) return;
        chunks = [];
        dataBytes = 0;
        sessionId += 1;
        active = true;
        node.port.postMessage({ type: 'start', sessionId });
      },
      async stop() {
        if (!active) return null;
        active = false;
        await new Promise(resolve => {
          stopResolve = resolve;
          node.port.postMessage({ type: 'stop', sessionId });
        });
        const header = wavHeader(context.sampleRate, 2, dataBytes);
        const blob = new Blob([header, ...chunks], { type: 'audio/wav' });
        cleanup();
        chunks = [];
        dataBytes = 0;
        return blob;
      },
      dispose() {
        active = false;
        cleanup();
        chunks = [];
        dataBytes = 0;
      },
      get active() { return active; },
      get bitsPerSecond() { return context.sampleRate * 2 * 16; },
    };
  }

  global.FreezaPcmRecorder = Object.freeze({ prepare, create, wavHeader });
})(window);
