(function attachPerformanceKeyShift(global) {
  'use strict';

  const DEFAULT_THRESHOLD = 46;

  function isEditable(target) {
    if (!target?.closest) return false;
    return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
  }

  function shiftForSwipe(deltaX, deltaY, threshold = DEFAULT_THRESHOLD) {
    if (Math.abs(deltaY) < threshold || Math.abs(deltaY) <= Math.abs(deltaX) * 1.2) return 0;
    return deltaY < 0 ? 1 : -1;
  }

  function bind({ surface, onShift, active = () => true } = {}) {
    if (!surface || typeof onShift !== 'function') return () => {};
    let drag = null;
    const previousTouchAction = surface.style.touchAction;
    surface.style.touchAction = 'none';

    const onPointerDown = event => {
      if (!active() || event.button > 0 || isEditable(event.target)
          || event.target?.closest?.('button, a, .camera-pip')) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      surface.setPointerCapture?.(event.pointerId);
    };
    const finishPointer = event => {
      if (!drag || event.pointerId !== drag.id) return;
      const shift = shiftForSwipe(event.clientX - drag.x, event.clientY - drag.y);
      drag = null;
      if (!shift || !active()) return;
      event.preventDefault();
      onShift(shift);
    };
    const cancelPointer = () => { drag = null; };
    const onKeyDown = event => {
      if (!active() || event.repeat || isEditable(event.target)) return;
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      onShift(event.key === 'ArrowUp' ? 1 : -1);
    };

    surface.addEventListener('pointerdown', onPointerDown);
    surface.addEventListener('pointerup', finishPointer);
    surface.addEventListener('pointercancel', cancelPointer);
    global.document?.addEventListener('keydown', onKeyDown);
    return () => {
      surface.style.touchAction = previousTouchAction;
      surface.removeEventListener('pointerdown', onPointerDown);
      surface.removeEventListener('pointerup', finishPointer);
      surface.removeEventListener('pointercancel', cancelPointer);
      global.document?.removeEventListener('keydown', onKeyDown);
    };
  }

  global.FreezaPerformanceKeyShift = Object.freeze({ bind, shiftForSwipe });
})(window);
