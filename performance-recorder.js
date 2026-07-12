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
    const state = { canvas: null, ctx: null, stream: null, raf: 0, lastFrame: 0, running: false, mounted: false };
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

    function resizeCanvas(rootRect) {
      if (!state.canvas || !rootRect.width || !rootRect.height) return;
      const scale = Math.max(1, Math.min(2, 1080 / rootRect.width));
      const width = Math.max(360, Math.round(rootRect.width * scale));
      const height = Math.max(640, Math.round(rootRect.height * scale));
      if (state.canvas.width !== width || state.canvas.height !== height) {
        state.canvas.width = width;
        state.canvas.height = height;
      }
    }

    function drawFrame() {
      if (!state.running || !root || !state.ctx) return;
      const rootRect = root.getBoundingClientRect();
      if (!rootRect.width || !rootRect.height) return;
      resizeCanvas(rootRect);
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
      drawBox(hud, rootRect, sx, sy, '#121421', 'rgba(139,108,230,.38)');
      drawBox(karaoke, rootRect, sx, sy, '#111321', 'rgba(139,108,230,.32)');
      slots.forEach(slot => drawBox(slot, rootRect, sx, sy, '#10121d', 'rgba(139,108,230,.3)'));

      const title = root.querySelector('.game-song-title');
      if (title) drawCenteredText(title.textContent.trim(), relativeRect(title, rootRect, sx, sy), 18 * sx, '#f4f0ff', 800);
      root.querySelectorAll('.game-controls .btn').forEach(button => {
        const rect = relativeRect(button, rootRect, sx, sy);
        const active = button.classList.contains('primary') || button.classList.contains('active-toggle');
        ctx.fillStyle = active ? '#7950e8' : '#111321';
        roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 8 * sx);
        ctx.fill();
        ctx.strokeStyle = active ? 'rgba(191,168,255,.55)' : 'rgba(143,124,194,.22)';
        ctx.lineWidth = Math.max(1, sx * .7);
        ctx.stroke();
        drawCenteredText(button.textContent.trim(), rect, 11 * sx, '#f7f5ff', 800);
      });

      root.querySelectorAll('.karaoke-panel-title, .slot-heading').forEach(heading => {
        const rect = relativeRect(heading, rootRect, sx, sy);
        const label = heading.querySelector('b')?.textContent?.trim()
          || heading.querySelector('small')?.textContent?.trim()
          || heading.textContent.trim();
        ctx.save();
        ctx.fillStyle = '#a98cff';
        ctx.font = `800 ${Math.max(8, 9 * sx)}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, rect.x + 8 * sx, rect.y + rect.h / 2);
        ctx.restore();
      });

      const keyStatus = root.querySelector('#keyStatus');
      const comboStatus = root.querySelector('#comboStatus');
      const timeStatus = root.querySelector('#timeStatus');
      if (keyStatus) {
        const rect = relativeRect(keyStatus, rootRect, sx, sy);
        const value = keyStatus.querySelector('b')?.textContent?.trim() || '';
        drawCenteredText(`KEY  ${value}`, rect, 10 * sx, '#bba8ec', 850);
      }
      if (comboStatus && getComputedStyle(comboStatus).display !== 'none') {
        const rect = relativeRect(comboStatus, rootRect, sx, sy);
        const value = comboStatus.querySelector('b')?.textContent?.trim() || '0';
        drawCenteredText(`COMBO ${value}`, rect, 9 * sx, '#f1c36d', 850);
      }
      if (timeStatus) {
        const rect = relativeRect(timeStatus, rootRect, sx, sy);
        drawCenteredText(timeStatus.textContent.trim(), rect, 9 * sx, '#b8b3c9', 750);
      }

      const lines = [...root.querySelectorAll('.karaoke-line')].filter(line => lineText(line));
      lines.forEach(line => {
        const rect = relativeRect(line, rootRect, sx, sy);
        const active = line.classList.contains('active');
        if (active) {
          ctx.fillStyle = 'rgba(120,76,230,.18)';
          ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        }
        const tokens = [...line.querySelectorAll('.lyric-base [data-kidx], .lyric-base .lyric-block')];
        if (tokens.length) {
          tokens.forEach(token => {
            const tokenRect = relativeRect(token, rootRect, sx, sy);
            const computed = getComputedStyle(token);
            const fontSize = Math.min(36 * sx, (parseFloat(computed.fontSize) || 18) * sx);
            drawCenteredText(token.textContent || '·', tokenRect, fontSize, computed.color || (active ? '#bda5ff' : '#8b91a3'), active ? 850 : 650);
          });
        } else {
          const computed = getComputedStyle(line);
          const fontSize = Math.min(36 * sx, (parseFloat(computed.fontSize) || 18) * sx);
          drawCenteredText(lineText(line), rect, fontSize, active ? '#bda5ff' : '#8b91a3', active ? 850 : 650);
        }
      });

      const micCanvas = root.querySelector('#micWaveCanvas');
      if (micCanvas?.width && micCanvas?.height) {
        const waveRect = relativeRect(micCanvas, rootRect, sx, sy);
        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.drawImage(micCanvas, waveRect.x, waveRect.y, waveRect.w, waveRect.h);
        ctx.restore();
      }

      const playbackKeys = [...root.querySelectorAll('.keyboard .key')]
        .sort((a, b) => Number(a.classList.contains('black')) - Number(b.classList.contains('black')));
      playbackKeys.forEach(key => {
        const rect = relativeRect(key, rootRect, sx, sy);
        if (rect.w < 1 || rect.h < 1) return;
        const black = key.classList.contains('black');
        const active = key.classList.contains('active') || key.classList.contains('cue') || key.classList.contains('due');
        const noteColor = getComputedStyle(key).getPropertyValue('--note-color').trim() || '#67ddec';
        ctx.fillStyle = active ? noteColor : (black ? '#080a10' : '#e9edf5');
        roundRect(ctx, rect.x, rect.y, rect.w, rect.h, Math.min(7 * sx, rect.w * .18));
        ctx.fill();
        ctx.strokeStyle = active ? 'rgba(255,255,255,.56)' : 'rgba(84,89,108,.7)';
        ctx.lineWidth = Math.max(0.7, sx * .7);
        ctx.stroke();
      });

      root.querySelectorAll('.manual-keyboard .key').forEach(key => {
        const rect = relativeRect(key, rootRect, sx, sy);
        if (rect.w < 1 || rect.h < 1) return;
        const noteColor = getComputedStyle(key).getPropertyValue('--note-color').trim() || '#8b5cf6';
        const active = key.classList.contains('active') || key.classList.contains('cue') || key.classList.contains('due');
        const baseGradient = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
        baseGradient.addColorStop(0, active ? noteColor : '#24263a');
        baseGradient.addColorStop(.58, active ? noteColor : '#171a2a');
        baseGradient.addColorStop(1, active ? noteColor : '#201a39');
        ctx.fillStyle = baseGradient;
        roundRect(ctx, rect.x, rect.y, rect.w, rect.h, Math.min(13 * sx, rect.w * .16));
        ctx.fill();
        ctx.strokeStyle = active ? 'rgba(255,255,255,.55)' : 'rgba(166,145,217,.28)';
        ctx.lineWidth = Math.max(1, sx);
        ctx.stroke();

        const fill = key.querySelector('.chord-fill');
        if (fill) {
          const fillRect = relativeRect(fill, rootRect, sx, sy);
          if (fillRect.h > 1) {
            ctx.save();
            ctx.globalAlpha = .38;
            ctx.fillStyle = noteColor;
            ctx.fillRect(rect.x + 1, fillRect.y, rect.w - 2, Math.min(fillRect.h, rect.y + rect.h - fillRect.y));
            ctx.restore();
          }
        }

        ctx.strokeStyle = 'rgba(193,168,255,.34)';
        ctx.lineWidth = Math.max(1, sx * .8);
        ctx.beginPath();
        ctx.moveTo(rect.x, rect.y + rect.h * .47);
        ctx.lineTo(rect.x + rect.w, rect.y + rect.h * .63);
        ctx.stroke();

        const labelElement = key.querySelector('.key-label');
        if (labelElement) {
          const labelRect = relativeRect(labelElement, rootRect, sx, sy);
          drawCenteredText(labelElement.textContent.trim(), labelRect, Math.min(34 * sx, rect.w * .48), '#f7f5ff', 900);
        }
        drawCenteredText('B', { x: rect.x, y: rect.y + rect.h * .025, w: rect.w, h: rect.h * .22 }, 13 * sx, 'rgba(230,227,242,.72)', 850);
        drawCenteredText('A', { x: rect.x, y: rect.y + rect.h * .76, w: rect.w, h: rect.h * .22 }, 13 * sx, 'rgba(230,227,242,.72)', 850);
        const symbol = key.querySelector('.chord-symbol');
        if (symbol?.textContent?.trim()) {
          const symbolRect = relativeRect(symbol, rootRect, sx, sy);
          drawCenteredText(symbol.textContent.trim(), symbolRect, Math.min(24 * sx, rect.w * .34), '#fff8cc', 900);
        }
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
      document.querySelectorAll('body > .lyric-particle').forEach(particle => {
        const rect = relativeRect(particle, rootRect, sx, sy);
        const computed = getComputedStyle(particle);
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, Number(computed.opacity) || 0.55));
        ctx.fillStyle = computed.backgroundColor || computed.color || '#bda5ff';
        ctx.beginPath();
        ctx.arc(rect.x + rect.w / 2, rect.y + rect.h / 2, Math.max(1.2, Math.max(rect.w, rect.h) / 2), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
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

    function mount() {
      if (state.running) return state.stream;
      if (!HTMLCanvasElement.prototype.captureStream || !root) return null;
      state.canvas = document.createElement('canvas');
      state.canvas.className = 'game-render-canvas';
      state.canvas.setAttribute('aria-hidden', 'true');
      resizeCanvas(root.getBoundingClientRect());
      state.ctx = state.canvas.getContext('2d', { alpha: false, desynchronized: true });
      root.appendChild(state.canvas);
      state.mounted = true;
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
      state.canvas?.remove();
      state.canvas = null;
      state.mounted = false;
    }

    return {
      start: mount,
      mount,
      stop,
      drawFrame,
      get canvas() { return state.canvas; },
      get stream() { return state.stream; },
      get mounted() { return state.mounted; },
    };
  }

  global.FreezaPerformanceRecorder = Object.freeze({ create });
})(window);
