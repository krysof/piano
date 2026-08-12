// Original LiberLive C1/C2/U1 control connection.
// This is deliberately separate from Web MIDI: the guitar uses a private BLE GATT service.
(() => {
  'use strict';

  const SERVICE = '000000ff-0000-1000-8000-00805f9b34fb';
  const NOTIFY = '0000a101-0000-1000-8000-00805f9b34fb';
  const READ = '0000a102-0000-1000-8000-00805f9b34fb';
  const WRITE = '0000a103-0000-1000-8000-00805f9b34fb';
  const KEY_M = Uint8Array.from([0x0a, 0xcb, 0x13, 0xdc, 0xf8, 0xb1, 0xc6, 0x84, 0x33, 0xaa, 0x03, 0x39]);
  const KEY_A = Uint8Array.from([0xb6, 0x1e, 0x2a, 0xb7, 0x69, 0x0d, 0xea, 0x06, 0x7e, 0x6d, 0xea, 0xcc]);
  const REMEMBER_KEY = 'freeza-liberlive-device-v1';

  const state = {
    scanning: false,
    connecting: false,
    connected: false,
    device: null,
    devices: [],
    error: '',
    gatt: null,
    readCharacteristic: null,
    writeCharacteristic: null,
    uploading: false,
    realtimeGeneration: 0,
    realtimeQueue: Promise.resolve(),
    realtimeFirstNote: true,
    realtimeReady: false,
    listenersReady: false,
    counter: Date.now() >>> 0,
    subscribers: new Set(),
  };

  const nativePlugin = () => window.FreezaMobileRuntime?.plugin || null;
  const nativeSupported = () => Boolean(window.FreezaMobileRuntime?.native && nativePlugin()?.scanLiberLive);
  const browserSupported = () => Boolean(navigator.bluetooth?.requestDevice);
  const supported = () => nativeSupported() || browserSupported();

  function crc8(data) {
    let value = 0;
    for (const byte of data) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit += 1) value = value & 0x80 ? ((value << 1) ^ 0x31) & 0xff : (value << 1) & 0xff;
    }
    return value;
  }

  function crc16(data) {
    let value = 0;
    for (const byte of data) {
      value ^= byte << 8;
      for (let bit = 0; bit < 8; bit += 1) value = value & 0x8000 ? ((value << 1) ^ 0x1021) & 0xffff : (value << 1) & 0xffff;
    }
    return value;
  }

  function xor(bytes, key = KEY_A) {
    return Uint8Array.from(bytes, (value, index) => value ^ key[index % key.length]);
  }

  function nextCounter() {
    const value = state.counter >>> 0;
    state.counter = (value + 50) >>> 0;
    return value;
  }

  function makeMFrame(encodedBodyInput, counter = nextCounter()) {
    const body = Uint8Array.from(encodedBodyInput);
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv.subarray(0, 8));
    iv[8] = (counter >>> 24) & 0xff;
    iv[9] = (counter >>> 16) & 0xff;
    iv[10] = (counter >>> 8) & 0xff;
    iv[11] = counter & 0xff;
    const combined = Uint8Array.from(KEY_M, (value, index) => value ^ iv[index]);
    const encryptedBody = Uint8Array.from(body, (value, index) => value ^ combined[index % 12]);
    const header = Uint8Array.from(iv, (value, index) => value ^ KEY_M[index]);
    const total = 4 + header.length + 1 + encryptedBody.length + 2;
    const frame = new Uint8Array(total);
    frame[0] = 0x24;
    frame[1] = 0x4d;
    frame[2] = total & 0xff;
    frame[3] = 0xc0 | ((total >>> 8) & 0x0f);
    frame.set(header, 4);
    frame[16] = crc8(frame.subarray(0, 16));
    frame.set(encryptedBody, 17);
    const bodyCrc = crc16(encryptedBody);
    frame[total - 2] = bodyCrc & 0xff;
    frame[total - 1] = (bodyCrc >>> 8) & 0xff;
    return frame;
  }

  function counterFromAFrame(dataInput) {
    const data = Uint8Array.from(dataInput || []);
    if (data.length < 16 || data[0] !== 0x24 || data[1] !== 0x41) return null;
    const headerSize = (data[3] >>> 4) & 0x0f;
    if (headerSize < 12 || data.length < 4 + headerSize) return null;
    const base = 4 + 8;
    return (((data[base] ^ KEY_A[8]) << 24)
      | ((data[base + 1] ^ KEY_A[9]) << 16)
      | ((data[base + 2] ^ KEY_A[10]) << 8)
      | (data[base + 3] ^ KEY_A[11])) >>> 0;
  }

  function ingestDeviceData(source, dataInput) {
    const data = Uint8Array.from(dataInput || []);
    const counter = counterFromAFrame(data);
    if (counter !== null) state.counter = (counter + 100) >>> 0;
    window.dispatchEvent(new CustomEvent('freeza-liberlive-data', { detail: { source, data, counter } }));
  }

  function toBase64(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  function fromBase64(value) {
    const binary = atob(String(value || ''));
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  }

  function snapshot() {
    return Object.freeze({
      supported: supported(),
      native: nativeSupported(),
      scanning: state.scanning,
      connecting: state.connecting,
      connected: state.connected,
      device: state.device ? { ...state.device } : null,
      devices: state.devices.map(device => ({ ...device })),
      error: state.error,
      uploading: state.uploading,
      realtimeReady: state.realtimeReady,
    });
  }

  function emit() {
    const value = snapshot();
    state.subscribers.forEach(listener => listener(value));
    window.dispatchEvent(new CustomEvent('freeza-liberlive-state', { detail: value }));
  }

  function remember(device) {
    try { localStorage.setItem(REMEMBER_KEY, JSON.stringify(device)); } catch { /* optional */ }
  }

  async function ensureNativeListeners() {
    if (!nativeSupported() || state.listenersReady) return;
    state.listenersReady = true;
    const plugin = nativePlugin();
    await plugin.addListener('liberLiveDevicesChanged', event => {
      state.scanning = Boolean(event?.scanning);
      state.devices = Array.from(event?.devices || []).map(device => ({ id: String(device.id), name: String(device.name || 'LiberLive') }));
      state.error = String(event?.error || '');
      emit();
    });
    await plugin.addListener('liberLiveConnectionChanged', event => {
      const next = String(event?.state || '');
      state.connecting = next === 'connecting' || next === 'discovering';
      state.connected = next === 'connected';
      if (state.connected) {
        state.device = { id: state.device?.id || '', name: String(event?.name || state.device?.name || 'LiberLive') };
        remember(state.device);
      } else if (next === 'disconnected' || next === 'error') {
        state.device = null;
      }
      state.error = String(event?.error || '');
      emit();
    });
    await plugin.addListener('liberLiveData', event => {
      const data = fromBase64(event?.data || '');
      ingestDeviceData(event?.source || '', data);
    });
  }

  async function scan() {
    state.error = '';
    if (!supported()) {
      state.error = '当前浏览器不能访问原版 LiberLive 琴，请使用 Freeza Live App';
      emit();
      return snapshot();
    }
    if (nativeSupported()) {
      await ensureNativeListeners();
      state.scanning = true;
      state.devices = [];
      emit();
      try {
        const result = await nativePlugin().scanLiberLive();
        state.devices = Array.from(result?.devices || []).map(device => ({ id: String(device.id), name: String(device.name || 'LiberLive') }));
      } catch (error) {
        state.scanning = false;
        state.error = error?.message || 'LiberLive 扫描失败';
      }
      emit();
      return snapshot();
    }

    // Web Bluetooth supplies its own secure device chooser; discovery must be
    // called directly from the user's click gesture.
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'LiberLive' }],
        optionalServices: [SERVICE],
      });
      if (device.name?.startsWith('LiberLiveAudio')) throw new Error('请选择 LiberLiveC1/C2/U1 控制设备，不是 LiberLiveAudio');
      state.devices = [{ id: device.id, name: device.name || 'LiberLive', nativeDevice: device }];
      await connect(device.id);
    } catch (error) {
      if (error?.name !== 'NotFoundError') state.error = error?.message || 'LiberLive 扫描失败';
    }
    emit();
    return snapshot();
  }

  async function connect(id) {
    const found = state.devices.find(device => device.id === id);
    if (!found) throw new Error('未找到 LiberLive 琴');
    state.device = { id: found.id, name: found.name };
    state.connecting = true;
    state.error = '';
    emit();
    try {
      if (nativeSupported()) {
        await ensureNativeListeners();
        const result = await nativePlugin().connectLiberLive({ id });
        state.device = { id, name: String(result?.name || found.name) };
      } else {
        const device = found.nativeDevice;
        device.addEventListener('gattserverdisconnected', () => {
          state.connected = false;
          state.connecting = false;
          state.gatt = null;
          state.readCharacteristic = null;
          state.writeCharacteristic = null;
          emit();
        }, { once: true });
        state.gatt = await device.gatt.connect();
        const service = await state.gatt.getPrimaryService(SERVICE);
        const notify = await service.getCharacteristic(NOTIFY);
        state.readCharacteristic = await service.getCharacteristic(READ);
        state.writeCharacteristic = await service.getCharacteristic(WRITE);
        await notify.startNotifications();
        notify.addEventListener('characteristicvaluechanged', event => {
          const view = event.target.value;
          const data = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
          ingestDeviceData('notify', data);
        });
        try {
          const value = await state.readCharacteristic.readValue();
          ingestDeviceData('read', new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
        } catch { /* A101 notifications are sufficient after setup. */ }
      }
      state.connected = true;
      remember(state.device);
    } catch (error) {
      state.device = null;
      state.connected = false;
      state.error = error?.message || 'LiberLive 连接失败';
      throw error;
    } finally {
      state.connecting = false;
      emit();
    }
    return snapshot();
  }

  async function disconnect() {
    state.realtimeGeneration += 1;
    state.realtimeReady = false;
    state.realtimeFirstNote = true;
    if (nativeSupported()) await nativePlugin().disconnectLiberLive();
    else state.gatt?.disconnect?.();
    state.connected = false;
    state.connecting = false;
    state.device = null;
    state.gatt = null;
    state.readCharacteristic = null;
    state.writeCharacteristic = null;
    emit();
  }

  async function writeRaw(bytes) {
    const data = Uint8Array.from(bytes);
    if (!state.connected) throw new Error('LiberLive 琴尚未连接');
    if (nativeSupported()) return nativePlugin().writeLiberLive({ data: toBase64(data) });
    if (!state.writeCharacteristic) throw new Error('LiberLive 写入特征不可用');
    if (state.writeCharacteristic.writeValueWithResponse) return state.writeCharacteristic.writeValueWithResponse(data);
    return state.writeCharacteristic.writeValue(data);
  }

  async function writeBody(body, counter) {
    return writeRaw(makeMFrame(xor(Uint8Array.from(body), KEY_A), counter));
  }

  // BLEPlay's stable path does not preload set_fill_notes.  It writes the
  // compact B1/1E command for the event that is due now.  Keep the same byte
  // layout here so connected instruments never receive a whole song burst.
  function legacyCommand(command, parts = []) {
    const payload = [];
    const appendU16 = value => {
      const number = Math.max(0, Math.min(0xffff, Math.round(Number(value) || 0)));
      payload.push(number & 0xff, (number >>> 8) & 0xff);
    };
    const appendF32 = value => {
      const buffer = new ArrayBuffer(4);
      new DataView(buffer).setFloat32(0, Number(value) || 0, true);
      payload.push(...new Uint8Array(buffer));
    };
    for (const part of parts) {
      if (part?.type === 'u16') appendU16(part.value);
      else if (part?.type === 'f32') appendF32(part.value);
      else payload.push(Math.max(0, Math.min(0xff, Math.round(Number(part?.value ?? part) || 0))));
    }
    return Uint8Array.from([
      0xb1, 0x1e, command & 0xff,
      payload.length & 0xff, (payload.length >>> 8) & 0xff,
      ...payload,
    ]);
  }

  function commandSetTempo(bpm) {
    return legacyCommand(0x1a, [{ type: 'u16', value: bpm }]);
  }

  function chordRootId(root) {
    const letter = String(root || '').toUpperCase().match(/[A-G]/)?.[0];
    return ({ C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 })[letter] ?? 0;
  }

  function chordTypeId(chord) {
    const symbol = String(chord || '').split('/')[0].replace(/^[A-G](?:#|b)?/i, '').toLowerCase();
    if (/^(m7b5|m7♭5|ø)/.test(symbol)) return 5;
    if (/^(maj7|m7\+)/.test(symbol)) return 3;
    if (/^m7/.test(symbol)) return 4;
    if (/^(dim|o)/.test(symbol)) return 5;
    if (/^(aug|\+)/.test(symbol)) return 6;
    if (/^sus4/.test(symbol)) return 7;
    if (/^sus2/.test(symbol)) return 8;
    if (/^m(?!aj)/.test(symbol)) return 1;
    if (/^7/.test(symbol)) return 2;
    return 0;
  }

  function commandPlayChord(root, chord, rhythm, bpm) {
    return legacyCommand(0x08, [
      chordRootId(root),
      chordTypeId(chord),
      { type: 'u16', value: rhythm },
      bpm,
    ]);
  }

  function commandRemindChord(root, chord) {
    return legacyCommand(0x0c, [chordRootId(root), chordTypeId(chord), 0]);
  }

  function commandPlayNote(first, beat, duration, pitch, velocity) {
    return legacyCommand(0x22, [
      first ? 1 : 0,
      { type: 'f32', value: beat },
      { type: 'f32', value: duration },
      pitch,
      velocity,
    ]);
  }

  function queueRealtimeWrite(bytes, generation = state.realtimeGeneration) {
    const task = state.realtimeQueue.catch(() => {}).then(async () => {
      if (generation !== state.realtimeGeneration) return { cancelled: true };
      if (!state.connected) throw new Error('LiberLive 琴尚未连接');
      await writeRaw(bytes);
      return { written: true };
    });
    state.realtimeQueue = task;
    return task;
  }

  async function startRealtimeSong({ bpm = 75 } = {}) {
    if (!state.connected) throw new Error('LiberLive 琴尚未连接');
    state.realtimeGeneration += 1;
    state.realtimeFirstNote = true;
    state.realtimeReady = false;
    const generation = state.realtimeGeneration;
    await queueRealtimeWrite(commandSetTempo(bpm), generation);
    if (generation !== state.realtimeGeneration) return { cancelled: true };
    state.realtimeReady = true;
    emit();
    return { ready: true, mode: 'realtime' };
  }

  async function playRealtimeChord({ root, chord, bpm = 75 } = {}) {
    if (!state.realtimeReady) await startRealtimeSong({ bpm });
    const generation = state.realtimeGeneration;
    // BLEPlay's proven B1/1E path always uses rhythm_id=0. Do not feed the
    // web player's A/B pattern slot into this device-only protocol field.
    await queueRealtimeWrite(commandPlayChord(root, chord, 0, bpm), generation);
    return queueRealtimeWrite(commandRemindChord(root, chord), generation);
  }

  async function playRealtimeNote({ beat = 0, duration = 0.25, pitch = 60, velocity = 90 } = {}) {
    if (!state.realtimeReady) throw new Error('原琴实时演奏尚未准备');
    const first = state.realtimeFirstNote;
    state.realtimeFirstNote = false;
    return queueRealtimeWrite(commandPlayNote(first, beat, duration, pitch, velocity));
  }

  function stopRealtimeSong() {
    state.realtimeGeneration += 1;
    state.realtimeReady = false;
    state.realtimeFirstNote = true;
    emit();
  }

  async function readResponse() {
    if (!state.connected) throw new Error('LiberLive 琴尚未连接');
    if (nativeSupported()) {
      const result = await nativePlugin().readLiberLive();
      const data = fromBase64(result?.data || '');
      return data;
    }
    if (!state.readCharacteristic) throw new Error('LiberLive 读取特征不可用');
    const value = await state.readCharacteristic.readValue();
    const data = new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
    ingestDeviceData('read', data);
    return data;
  }

  function parseDevicePayload(input) {
    const bytes = Uint8Array.from(input || []);
    if (bytes.length < 12 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'LLD1') {
      throw new Error('原琴载荷不是 LLD1');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint16(4, true) !== 1 || view.getUint16(6, true) !== 0) {
      throw new Error('不支持的原琴载荷版本');
    }
    const count = view.getUint32(8, true);
    const records = [];
    let offset = 12;
    for (let index = 0; index < count; index += 1) {
      if (offset + 7 > bytes.length) throw new Error('原琴载荷记录被截断');
      const flags = bytes[offset];
      const delayMs = view.getUint16(offset + 1, true);
      const length = view.getUint32(offset + 3, true);
      offset += 7;
      if (flags & ~1 || length === 0 || offset + length > bytes.length) throw new Error('原琴载荷记录无效');
      records.push({
        needsResponse: Boolean(flags & 1),
        delayMs,
        body: bytes.slice(offset, offset + length),
      });
      offset += length;
    }
    if (offset !== bytes.length) throw new Error('原琴载荷包含多余数据');
    return records;
  }

  async function sendDevicePayload(payload, { onProgress } = {}) {
    void payload;
    void onProgress;
    throw new Error('整首曲谱发送已禁用；原琴使用逐事件实时演奏');
  }

  async function sendFrames(frames, { delay = 45, onProgress } = {}) {
    for (let index = 0; index < frames.length; index += 1) {
      await writeRaw(frames[index]);
      onProgress?.((index + 1) / frames.length, index);
      if (delay > 0 && index + 1 < frames.length) await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  async function sendBodies(bodies, { delay = 60, onProgress } = {}) {
    for (let index = 0; index < bodies.length; index += 1) {
      await writeRaw(makeMFrame(bodies[index]));
      onProgress?.((index + 1) / bodies.length, index);
      if (delay > 0 && index + 1 < bodies.length) await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  function subscribe(listener) {
    state.subscribers.add(listener);
    listener(snapshot());
    return () => state.subscribers.delete(listener);
  }

  window.FreezaLiberLive = Object.freeze({
    SERVICE, NOTIFY, READ, WRITE,
    crc8, crc16, xor, makeMFrame, counterFromAFrame,
    scan, connect, disconnect, writeRaw, writeBody, readResponse,
    parseDevicePayload, sendDevicePayload, sendFrames, sendBodies,
    legacyCommand, commandSetTempo, commandPlayChord, commandRemindChord, commandPlayNote,
    startRealtimeSong, playRealtimeChord, playRealtimeNote, stopRealtimeSong,
    snapshot, subscribe,
  });
})();
