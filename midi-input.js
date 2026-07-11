// Web MIDI adapter for USB and OS-paired Bluetooth MIDI keyboards.
// This module normalizes device state, notes and common performance controls; playback stays in app.js.
(() => {
  const state = {
    access: null,
    connecting: false,
    authorized: false,
    error: '',
    inputs: new Map(),
    pressed: new Set(),
    onNote: null,
    onNoteOff: null,
    onControl: null,
    onPitchBend: null,
    onStatus: null,
  };

  const supported = () => typeof navigator !== 'undefined'
    && typeof navigator.requestMIDIAccess === 'function';

  function snapshot() {
    const devices = Array.from(state.inputs.values()).map(input => ({
      id: input.id || '',
      name: input.name || input.manufacturer || 'MIDI 键盘',
      manufacturer: input.manufacturer || '',
      state: input.state || 'connected',
    }));
    return Object.freeze({
      supported: supported(),
      connecting: state.connecting,
      authorized: state.authorized,
      connected: devices.length > 0,
      count: devices.length,
      devices,
      error: state.error,
    });
  }

  function emitStatus() {
    state.onStatus?.(snapshot());
  }

  function noteKey(input, channel, note) {
    return `${input.id || input.name || 'midi'}:${channel}:${note}`;
  }

  function inputKey(input, index = 0) {
    return input.id || `${input.manufacturer || ''}:${input.name || index}`;
  }

  function handleMessage(input, event) {
    const data = event?.data;
    if (!data || data.length < 2) return;
    const status = Number(data[0]);
    const command = status & 0xf0;
    const channel = status & 0x0f;
    const data1 = Number(data[1] || 0);
    const data2 = Number(data[2] || 0);
    const common = {
      channel,
      inputId: input.id || '',
      inputName: input.name || input.manufacturer || 'MIDI 键盘',
      receivedAt: Number(event.receivedTime || globalThis.performance?.now?.() || Date.now()),
    };
    if (command === 0xe0) {
      const raw = (data2 << 7) | data1;
      state.onPitchBend?.({ ...common, raw, value: Math.max(-1, Math.min(1, (raw - 8192) / 8192)) });
      return;
    }
    if (command === 0xb0) {
      state.onControl?.({ ...common, controller: data1, raw: data2, value: Math.max(0, Math.min(1, data2 / 127)) });
      return;
    }
    const note = data1;
    if (!Number.isInteger(note) || note < 0 || note > 127) return;
    const key = noteKey(input, channel, note);
    if (command === 0x80 || (command === 0x90 && data2 === 0)) {
      state.pressed.delete(key);
      state.onNoteOff?.({ ...common, key, note, velocity: Math.max(0, Math.min(1, data2 / 127)) });
      return;
    }
    if (command !== 0x90 || state.pressed.has(key)) return;
    state.pressed.add(key);
    state.onNote?.({
      ...common,
      key,
      note,
      velocity: Math.max(0, Math.min(1, data2 / 127)),
    });
  }

  function refreshInputs() {
    const next = new Map();
    for (const input of state.access?.inputs?.values?.() || []) {
      if (input.type && input.type !== 'input') continue;
      if (input.state === 'disconnected') continue;
      input.onmidimessage = event => handleMessage(input, event);
      next.set(inputKey(input, next.size), input);
    }
    for (const [key, input] of state.inputs) {
      if (!next.has(key) && input.onmidimessage) input.onmidimessage = null;
    }
    state.inputs = next;
    state.pressed.clear();
    emitStatus();
  }

  async function connect() {
    if (!supported()) {
      state.error = '此浏览器不支持 Web MIDI';
      emitStatus();
      return snapshot();
    }
    if (state.access) {
      refreshInputs();
      return snapshot();
    }
    if (state.connecting) return snapshot();
    state.connecting = true;
    state.error = '';
    emitStatus();
    try {
      state.access = await navigator.requestMIDIAccess({ sysex: false });
      state.authorized = true;
      state.access.onstatechange = refreshInputs;
      refreshInputs();
    } catch (error) {
      state.error = error?.name === 'SecurityError'
        ? '需要 HTTPS 才能连接 MIDI'
        : error?.name === 'NotAllowedError'
          ? 'MIDI 权限未开启'
          : `MIDI 连接失败：${error?.message || '未知错误'}`;
    } finally {
      state.connecting = false;
      emitStatus();
    }
    return snapshot();
  }

  function setHandlers({ onNote, onNoteOff, onControl, onPitchBend, onStatus } = {}) {
    state.onNote = typeof onNote === 'function' ? onNote : null;
    state.onNoteOff = typeof onNoteOff === 'function' ? onNoteOff : null;
    state.onControl = typeof onControl === 'function' ? onControl : null;
    state.onPitchBend = typeof onPitchBend === 'function' ? onPitchBend : null;
    state.onStatus = typeof onStatus === 'function' ? onStatus : null;
    emitStatus();
  }

  window.FreezaMidiInput = Object.freeze({ connect, setHandlers, snapshot });
})();
