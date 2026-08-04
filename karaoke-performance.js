(function initKaraokePerformance(global) {
  'use strict';

  function create() {
    let layout = null;
    let revision = 0;
    let nextObjectId = 1;
    let objectIds = new WeakMap();
    let lineStates = new WeakMap();
    let geometry = new WeakMap();

    const objectId = value => {
      if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
        return `primitive:${String(value ?? '')}`;
      }
      let id = objectIds.get(value);
      if (!id) {
        id = nextObjectId++;
        objectIds.set(value, id);
      }
      return `object:${id}`;
    };

    const stateFor = element => {
      let state = lineStates.get(element);
      if (!state) {
        state = { signature: '', progress: '', display: '' };
        lineStates.set(element, state);
      }
      return state;
    };

    return {
      objectId,

      getLayout(calculate) {
        if (!layout) layout = calculate();
        return layout;
      },

      invalidateLayout() {
        layout = null;
        geometry = new WeakMap();
        revision += 1;
      },

      revision() {
        return revision;
      },

      renderLine(element, signature, render) {
        const state = stateFor(element);
        if (state.signature === signature) return false;
        render();
        state.signature = signature;
        geometry.delete(element);
        return true;
      },

      setProgress(element, value) {
        const state = stateFor(element);
        if (state.progress === value) return false;
        element.style.setProperty('--progress', value);
        state.progress = value;
        return true;
      },

      setDisplay(element, value) {
        const state = stateFor(element);
        if (state.display === value) return false;
        element.style.display = value;
        state.display = value;
        return true;
      },

      getGeometry(element, key, measure) {
        const cached = geometry.get(element);
        if (cached?.key === key) return cached.value;
        const value = measure();
        geometry.set(element, { key, value });
        return value;
      },

      clearGeometry(element) {
        if (element) geometry.delete(element);
        else geometry = new WeakMap();
      },

      reset() {
        layout = null;
        revision += 1;
        objectIds = new WeakMap();
        lineStates = new WeakMap();
        geometry = new WeakMap();
      },
    };
  }

  global.FreezaKaraokePerformance = Object.freeze({ create });
}(typeof window !== 'undefined' ? window : globalThis));
