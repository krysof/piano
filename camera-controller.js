(function initCameraController(global) {
  'use strict';

  const RELEASE_DELAY_MS = 80;

  function normalizeFacing(facing) {
    return facing === 'environment' ? 'environment' : 'user';
  }

  function streamFacing(stream, fallback = 'user') {
    const setting = stream?.getVideoTracks?.()[0]?.getSettings?.().facingMode;
    return normalizeFacing(setting || fallback);
  }

  function detachAndStop(video, stream) {
    if (video?.srcObject === stream) {
      try { video.pause?.(); } catch {}
      video.srcObject = null;
    }
    stream?.getTracks?.().forEach(track => {
      try { track.stop(); } catch {}
    });
  }

  function canRetryWithIdeal(error) {
    return ['OverconstrainedError', 'ConstraintNotSatisfiedError', 'NotFoundError', 'AbortError', 'NotReadableError']
      .includes(error?.name);
  }

  async function acquire(mediaDevices, facing, width, height, exact) {
    const facingMode = exact ? { exact: facing } : { ideal: facing };
    return mediaDevices.getUserMedia({
      video: {
        facingMode,
        width: { ideal: width },
        height: { ideal: height },
      },
      audio: false,
    });
  }

  async function optimizeStream(stream, maxFrameRate = 30) {
    const track = stream?.getVideoTracks?.()[0];
    if (!track) return false;
    // 保持请求到的像素尺寸不变，只限制意外获得的 60fps 摄像头流。
    // 不支持 applyConstraints 的浏览器继续使用原流，不阻塞进入演奏。
    try {
      if ('contentHint' in track) track.contentHint = 'motion';
      if (track.applyConstraints) {
        await track.applyConstraints({ frameRate: { ideal: maxFrameRate, max: maxFrameRate } });
        return true;
      }
    } catch {}
    return false;
  }

  async function replace(options = {}) {
    const mediaDevices = options.mediaDevices;
    if (!mediaDevices?.getUserMedia) throw new Error('Camera API unavailable');
    const video = options.video || null;
    const facing = normalizeFacing(options.facing);
    const width = Math.max(1, Number(options.width) || 1280);
    const height = Math.max(1, Number(options.height) || 720);
    const maxFrameRate = Math.max(15, Number(options.maxFrameRate) || 30);

    // iOS/WebKit cannot reliably open the other lens while the previous track is
    // still attached to a video element. Detach first, stop every old track, then
    // yield briefly before requesting the new facing mode.
    detachAndStop(video, options.currentStream);
    await new Promise(resolve => setTimeout(resolve, RELEASE_DELAY_MS));

    let stream;
    let usedIdealFallback = false;
    try {
      stream = await acquire(mediaDevices, facing, width, height, true);
    } catch (error) {
      if (!canRetryWithIdeal(error)) throw error;
      usedIdealFallback = true;
      stream = await acquire(mediaDevices, facing, width, height, false);
    }
    const optimized = await optimizeStream(stream, maxFrameRate);

    if (video) {
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      // iOS can start the new camera while leaving play() pending. Starting it
      // is enough; never keep the direction buttons busy on that Promise.
      try { video.play?.()?.catch?.(() => {}); } catch {}
    }

    return {
      stream,
      facingMode: streamFacing(stream, facing),
      requestedFacing: facing,
      usedIdealFallback,
      optimized,
    };
  }

  const api = Object.freeze({ normalizeFacing, streamFacing, detachAndStop, optimizeStream, replace });
  global.FreezaCameraController = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
