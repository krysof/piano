(function initPerformanceRecorder(global) {
  'use strict';

  const roundRect = (ctx, x, y, w, h, r = 12) => {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, h, radius);
      return;
    }
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  };

  function create(options = {}) {
    const state = { canvas: null, ctx: null, stream: null, raf: 0, lastFrame: 0, running: false };
    const root = options.root;
    const mediaVideo = options.mediaVideo;

    const relativeRect = (element, rootRect, sx, sy) => {
      const rect = element.getBoundingClientRect();
      return {
        x: (rect.left - rootRect.left) * sx,
        y: (rect.top - rootRect.top) * sy,
        w: rect.width * sx,
        h: rect.height * sy,
      };
    };

    const drawBox = (element, rootRect, sx, sy, fill = 'rgba(18,20,34,.96)', stroke = 'rgba(158,129,255,.24)') => {
      if (!element) return;
      const { x, y, w, h } = relativeRect(element, rootRect, sx, sy);
      state.ctx.fillStyle = fill;
      roundRect(state.ctx, x, y, w, h, Math.max(7, Math.min(w, h) * 0.06));
      state.ctx.fill();
      state.ctx.strokeStyle = stroke;
      state.ctx.lineWidth = Math.max(1, sx);
      state.ctx.stroke();
    };

    const drawCenteredText = (text, rect, size, color = '#f4f1ff', weight = 700) => {
      if (!text) return;
      state.ctx.save();
      state.ctx.fillStyle = color;
      state.ctx.font = `${weight} ${Math.max(7, size)}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;
      state.ctx.textAlign = 'center';
      state.ctx.textBaseline = 'middle';
      state.ctx.globalAlpha = 0.96;
      state.ctx.fillText(text, rect.x + rect.w / 2, rect.y + rect.h / 2, Math.max(8, rect.w - 6));
      state.ctx.restore();
    };

    const lineText = (line) => line?.querySelector('.lyric-base')?.textContent?.trim()
      || line?.textContent?.trim()
      || '';

    function drawFrame() {
      if (!state.running || !root || !state.ctx) return;
      const rootRect = root.getBoundingClientRect();
      if (!rootRect.width || !rootRect.height) return;
      const sx = state.canvas.width / rootRect.width;
      const sy = state.canvas.height / rootRect.height;
      const ctx = state.ctx;
      ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
      const gradient = ctx.createLinearGradient(0, 0, 0, state.canvas.height);
      gradient.addColorStop(0, '#080914');
      gradient.addColorStop(0.55, '#101225');
      gradient.addColorStop(1, '#070913');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, state.canvas.width, state.canvas.height);

      const hud = root.querySelector('.hud');
      const karaoke = root.querySelector('.karaoke');
      const slots = root.querySelectorAll('.piano-slot');
      drawBox(hud, rootRect, sx, sy, 'rgba(14,16,29,.98)');
      drawBox(karaoke, rootRect, sx, sy, 'rgba(16,18,32,.98)');
      slots.forEach(slot => drawBox(slot, rootRect, sx, sy, 'rgba(13,15,27,.98)'));

      const title = root.querySelector('.game-song-title');
      if (title) drawCenteredText(title.textContent.trim(), relativeRect(title, rootRect, sx, sy), 18 * sx, '#f4f0ff', 800);
      root.querySelectorAll('.game-controls .btn').forEach(button => {
        const rect = relativeRect(button, rootRect, sx, sy);
        const active = button.classList.contains('primary') || button.classList.contains('active-toggle');
        ctx.fillStyle = active ? '#7950e8' : '#111321';
        roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 8 * sx);
        ctx.fill();
        drawCenteredText(button.textContent.trim(), rect, 11 * sx, '#f7f5ff', 800);
      });

      const lines = [...root.querySelectorAll('.karaoke-line')].filter(line => lineText(line));
      lines.forEach(line => {
        const rect = relativeRect(line, rootRect, sx, sy);
        const active = line.classList.contains('active');
        if (active) {
          ctx.fillStyle = 'rgba(120,76,230,.18)';
          ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        }
        const computed = getComputedStyle(line);
        const fontSize = Math.min(36 * sx, (parseFloat(computed.fontSize) || 18) * sx);
        drawCenteredText(lineText(line), rect, fontSize, active ? '#bda5ff' : '#8b91a3', active ? 850 : 650);
      });

      root.querySelectorAll('.keyboard .key, .manual-keyboard .key').forEach(key => {
        const rect = relativeRect(key, rootRect, sx, sy);
        if (rect.w < 1 || rect.h < 1) return;
        const black = key.classList.contains('black');
        const active = key.classList.contains('active') || key.classList.contains('cue') || key.classList.contains('due');
        ctx.fillStyle = active ? (getComputedStyle(key).backgroundColor || '#8b5cf6') : (black ? '#090b12' : '#e9edf5');
        roundRect(ctx, rect.x, rect.y, rect.w, rect.h, Math.min(7 * sx, rect.w * .18));
        ctx.fill();
        ctx.strokeStyle = active ? 'rgba(255,255,255,.56)' : 'rgba(84,89,108,.7)';
        ctx.lineWidth = Math.max(0.7, sx * .7);
        ctx.stroke();
        const label = key.querySelector('.label')?.textContent?.trim();
        if (label) drawCenteredText(label, rect, Math.min(32 * sx, rect.w * .55), black ? '#fff' : '#242636', 850);
      });

      const pip = document.getElementById('cameraPip');
      if (pip && mediaVideo?.readyState >= 2 && pip.getAttribute('aria-hidden') !== 'true') {
        const rect = relativeRect(pip, rootRect, sx, sy);
        ctx.save();
        roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 14 * sx);
        ctx.clip();
        if (pip.classList.contains('front')) {
          ctx.translate(rect.x + rect.w, rect.y);
          ctx.scale(-1, 1);
          ctx.drawImage(mediaVideo, 0, 0, rect.w, rect.h);
        } else {
          ctx.drawImage(mediaVideo, rect.x, rect.y, rect.w, rect.h);
        }
        ctx.restore();
        ctx.strokeStyle = 'rgba(190,168,255,.85)';
        ctx.lineWidth = Math.max(2, sx * 1.5);
        roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 14 * sx);
        ctx.stroke();
      }

      document.querySelectorAll('body > .timing-rating').forEach(rating => {
        const rect = relativeRect(rating, rootRect, sx, sy);
        drawCenteredText(rating.textContent.trim(), rect, 30 * sx, '#fff2a6', 900);
      });
    }

    function tick(now) {
      if (!state.running) return;
      if (now - state.lastFrame >= 1000 / 30) {
        state.lastFrame = now;
        try { drawFrame(); } catch (error) { console.warn('Video compositor frame failed:', error); }
      }
      state.raf = requestAnimationFrame(tick);
    }

    function start() {
      if (state.running) return state.stream;
      if (!HTMLCanvasElement.prototype.captureStream || !root) return null;
      const rect = root.getBoundingClientRect();
      const width = 720;
      const height = Math.max(960, Math.min(1600, Math.round(width * rect.height / Math.max(1, rect.width))));
      state.canvas = document.createElement('canvas');
      state.canvas.width = width;
      state.canvas.height = height;
      state.ctx = state.canvas.getContext('2d', { alpha: false, desynchronized: true });
      state.stream = state.canvas.captureStream(30);
      state.running = true;
      state.lastFrame = 0;
      drawFrame();
      state.raf = requestAnimationFrame(tick);
      return state.stream;
    }

    function stop() {
      state.running = false;
      cancelAnimationFrame(state.raf);
      state.raf = 0;
      state.stream?.getVideoTracks?.().forEach(track => track.stop());
      state.stream = null;
      state.ctx = null;
      state.canvas = null;
    }

    return { start, stop, drawFrame, get canvas() { return state.canvas; } };
  }

  global.FreezaPerformanceRecorder = Object.freeze({ create });
})(window);
