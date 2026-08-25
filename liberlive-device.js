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
    connections: new Map(),
    error: '',
    gatt: null,
    readCharacteristic: null,
    writeCharacteristic: null,
    uploading: false,
    streamGeneration: 0,
    streamQueue: Promise.resolve(),
    streamRecords: [],
    streamReminder: null,
    streamCursor: 0,
    streamSentNotes: 0,
    streamQueuedCues: 0,
    streamCueTotal: 0,
    streamStaged: false,
    streamReady: false,
    streamComplete: false,
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

  function decodeAFrame(dataInput) {
    const data = Uint8Array.from(dataInput || []);
    if (data.length < 19 || data[0] !== 0x24 || data[1] !== 0x41) return null;
    const total = data[2] | ((data[3] & 0x0f) << 8);
    const headerSize = (data[3] >>> 4) & 0x0f;
    if (total !== data.length || headerSize < 12 || data.length < 4 + headerSize + 3) return null;
    const headerEnd = 4 + headerSize;
    if (crc8(data.subarray(0, headerEnd)) !== data[headerEnd]) return null;
    const encryptedBody = data.subarray(headerEnd + 1, data.length - 2);
    const expectedBodyCrc = data[data.length - 2] | (data[data.length - 1] << 8);
    if (crc16(encryptedBody) !== expectedBodyCrc) return null;
    const iv = Uint8Array.from(data.subarray(4, headerEnd),
      (value, index) => value ^ KEY_A[index % KEY_A.length]);
    const frameKey = Uint8Array.from(iv,
      (value, index) => value ^ KEY_A[index % KEY_A.length]);
    const outerBody = Uint8Array.from(encryptedBody,
      (value, index) => value ^ frameKey[index % frameKey.length]);
    // A101 replies use the same inner KEY_A layer as app command bodies.
    return xor(outerBody, KEY_A);
  }

  function commandNameFromBody(bodyInput) {
    const body = Uint8Array.from(bodyInput || []);
    const length = body[0] || 0;
    if (length < 1 || length > 32 || body.length < length + 1) return '';
    let name = '';
    for (let index = 1; index <= length; index += 1) {
      const value = body[index];
      if (value < 0x20 || value > 0x7e) return '';
      name += String.fromCharCode(value);
    }
    return name;
  }

  function ingestDeviceData(source, dataInput) {
    let device = null;
    if (source && typeof source === 'object') {
      device = { id: String(source.id || ''), name: String(source.name || 'LiberLive') };
      source = String(source.source || '');
    }
    const data = Uint8Array.from(dataInput || []);
    const counter = counterFromAFrame(data);
    if (counter !== null) state.counter = (counter + 100) >>> 0;
    const decoded = decodeAFrame(data);
    const command = commandNameFromBody(decoded);
    window.dispatchEvent(new CustomEvent('freeza-liberlive-data', {
      detail: { source, device, data, counter, decoded, command },
    }));
    // Real A101 input arrives as an encrypted $A frame whose inner command is
    // noti_chord/noti_note.  The old data[0] === 0x02 check only
    // covered an early diagnostic packet, so the app stopped advancing after
    // the initial preloaded window on real instruments.
    // noti_chord is the physical chord-button action. noti_note is emitted by
    // the instrument for melody notes after that action and must never consume
    // another App chord cue.
    const physicalCommand = command === 'noti_chord';
    if (source === 'notify' && command === 'noti_note') {
      window.dispatchEvent(new CustomEvent('freeza-liberlive-note', {
        detail: { device, data, decoded, command },
      }));
    }
    if (source === 'notify' && (physicalCommand || (!command && data[0] === 0x02))) {
      window.dispatchEvent(new CustomEvent('freeza-liberlive-press', {
        detail: { device, data, decoded, command },
      }));
    }
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
    const connectedDevices = [...state.connections.values()].map(connection => ({
      id: String(connection.id || connection.device?.id || ''),
      name: String(connection.name || connection.device?.name || 'LiberLive'),
      connected: true,
    }));
    return Object.freeze({
      supported: supported(),
      native: nativeSupported(),
      scanning: state.scanning,
      connecting: state.connecting,
      connected: state.connected,
      device: state.device ? { ...state.device } : null,
      connectedDevices,
      devices: state.devices.map(device => ({
        ...device,
        connected: connectedDevices.some(item => item.id === device.id),
      })),
      error: state.error,
      uploading: state.uploading,
      streamReady: state.streamReady,
      streamStaged: state.streamStaged,
      streamComplete: state.streamComplete,
      streamCursor: state.streamCursor,
      streamTotal: state.streamRecords.length,
    });
  }

  function emit() {
    const value = snapshot();
    state.subscribers.forEach(listener => listener(value));
    window.dispatchEvent(new CustomEvent('freeza-liberlive-state', { detail: value }));
  }

  function refreshConnectionState() {
    const connected = [...state.connections.values()];
    state.connected = connected.length > 0;
    state.device = connected[0]
      ? { id: String(connected[0].id || ''), name: String(connected[0].name || 'LiberLive') }
      : null;
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
      state.devices = Array.from(event?.devices || []).map(device => ({
        id: String(device.id),
        name: String(device.name || 'LiberLive'),
        connected: Boolean(device.connected),
        connecting: Boolean(device.connecting),
      }));
      for (const device of state.devices) {
        if (device.connected) state.connections.set(device.id, { id: device.id, name: device.name, native: true });
        else if (!device.connecting) state.connections.delete(device.id);
      }
      refreshConnectionState();
      state.error = String(event?.error || '');
      emit();
    });
    await plugin.addListener('liberLiveConnectionChanged', event => {
      const next = String(event?.state || '');
      const id = String(event?.id || '');
      const name = String(event?.name || state.devices.find(device => device.id === id)?.name || 'LiberLive');
      state.connecting = state.devices.some(device => device.connecting)
        || next === 'connecting' || next === 'discovering';
      if (next === 'connected' && id) {
        state.connections.set(id, { id, name, native: true });
        remember({ id, name });
      } else if ((next === 'disconnected' || next === 'error') && id) {
        state.connections.delete(id);
      }
      refreshConnectionState();
      state.error = String(event?.error || '');
      emit();
    });
    await plugin.addListener('liberLiveData', event => {
      const data = fromBase64(event?.data || '');
      ingestDeviceData({ source: event?.source || '', id: event?.id || '', name: event?.name || '' }, data);
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
      emit();
      try {
        const result = await nativePlugin().scanLiberLive();
        state.devices = Array.from(result?.devices || []).map(device => ({
          id: String(device.id), name: String(device.name || 'LiberLive'),
          connected: Boolean(device.connected), connecting: Boolean(device.connecting),
        }));
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
      const previous = state.devices.filter(item => item.id !== device.id);
      state.devices = [...previous, { id: device.id, name: device.name || 'LiberLive', nativeDevice: device }];
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
    if (state.connections.has(found.id)) return snapshot();
    state.connecting = true;
    state.error = '';
    emit();
    try {
      if (nativeSupported()) {
        await ensureNativeListeners();
        const result = await nativePlugin().connectLiberLive({ id });
        const name = String(result?.name || found.name);
        state.connections.set(id, { id, name, native: true });
      } else {
        const device = found.nativeDevice;
        device.addEventListener('gattserverdisconnected', () => {
          state.connections.delete(found.id);
          refreshConnectionState();
          emit();
        }, { once: true });
        const gatt = await device.gatt.connect();
        const service = await gatt.getPrimaryService(SERVICE);
        const notify = await service.getCharacteristic(NOTIFY);
        const readCharacteristic = await service.getCharacteristic(READ);
        const writeCharacteristic = await service.getCharacteristic(WRITE);
        await notify.startNotifications();
        notify.addEventListener('characteristicvaluechanged', event => {
          const view = event.target.value;
          const data = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
          ingestDeviceData({ source: 'notify', id: found.id, name: found.name }, data);
        });
        state.connections.set(found.id, {
          id: found.id, name: found.name, device, gatt, readCharacteristic, writeCharacteristic,
        });
        try {
          const value = await readCharacteristic.readValue();
          ingestDeviceData({ source: 'read', id: found.id, name: found.name }, new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
        } catch { /* A101 notifications are sufficient after setup. */ }
      }
      refreshConnectionState();
      remember({ id: found.id, name: found.name });
    } catch (error) {
      state.connections.delete(found.id);
      refreshConnectionState();
      state.error = error?.message || 'LiberLive 连接失败';
      throw error;
    } finally {
      state.connecting = false;
      emit();
    }
    return snapshot();
  }

  async function disconnect(id = '') {
    const targetId = String(id || '');
    if (nativeSupported()) await nativePlugin().disconnectLiberLive(targetId ? { id: targetId } : {});
    else {
      const targets = targetId
        ? [state.connections.get(targetId)].filter(Boolean)
        : [...state.connections.values()];
      targets.forEach(connection => connection.gatt?.disconnect?.());
    }
    if (targetId) state.connections.delete(targetId);
    else state.connections.clear();
    refreshConnectionState();
    state.connecting = false;
    if (!state.connected) resetDeviceStream();
    emit();
  }

  async function writeRaw(bytes) {
    const data = Uint8Array.from(bytes);
    if (!state.connected) throw new Error('LiberLive 琴尚未连接');
    if (nativeSupported()) return nativePlugin().writeLiberLive({ data: toBase64(data) });
    const targets = [...state.connections.values()];
    if (!targets.length) throw new Error('LiberLive 写入特征不可用');
    await Promise.all(targets.map(connection => {
      const characteristic = connection.writeCharacteristic;
      if (!characteristic) throw new Error(`${connection.name} 写入特征不可用`);
      if (characteristic.writeValueWithResponse) return characteristic.writeValueWithResponse(data);
      return characteristic.writeValue(data);
    }));
  }

  async function writeBody(body, counter) {
    return writeRaw(makeMFrame(xor(Uint8Array.from(body), KEY_A), counter));
  }

  // B1/1E is retained only for byte-level protocol diagnostics. The working
  // original-app flow uses encrypted $M bodies after the BLE initialization
  // sequence; see prepareDeviceSong()/advanceDeviceSong() below.
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

  const STREAM_FRAME_DELAY_MS = 60;
  const INITIAL_CUE_WINDOW = 4;
  const TOP_UP_CUE_WINDOW = 1;
  const LEGACY_INITIAL_NOTE_WINDOW = 6;
  const LEGACY_TOP_UP_NOTE_WINDOW = 4;

  function plainRecordBody(record) {
    return xor(record.body, KEY_A);
  }

  function transposeDeviceRecord(record, semitones = 0) {
    const shift = Math.max(-14, Math.min(14, Math.round(Number(semitones) || 0)));
    if (!shift) return record;
    const plain = plainRecordBody(record);
    const command = commandNameFromBody(plain);
    const shifted = plain.slice();
    if (command === 'set_remind_chord') {
      const rootOffset = 1 + plain[0];
      if (rootOffset < shifted.length) {
        shifted[rootOffset] = ((shifted[rootOffset] % 12) + shift + 120) % 12;
      }
    } else if (plain[0] === 0x01 && plain[1] === 0x07 && plain.length >= 4) {
      const itemTypes = [...plain.subarray(3, 3 + plain[2])];
      let offset = 3 + plain[2];
      for (const itemType of itemTypes) {
        if (itemType === 0x01 && offset + 13 <= shifted.length) {
          const marker = shifted[offset + 3] & 0x80;
          const pitch = shifted[offset + 3] & 0x7f;
          shifted[offset + 3] = marker | Math.max(0, Math.min(0x7f, pitch + shift));
          offset += 13;
        } else if (itemType === 0x02 && offset + 15 <= shifted.length) {
          const flags = shifted[offset + 3] & 0xf0;
          const root = shifted[offset + 3] & 0x0f;
          shifted[offset + 3] = flags | ((root + shift + 120) % 12);
          offset += 15;
        } else if (itemType === 0x05 && offset + 8 <= shifted.length) {
          offset += shifted[offset + 7] === 1 ? 12 : 10;
        } else {
          break;
        }
      }
    }
    return { ...record, body: xor(shifted, KEY_A) };
  }

  function recordKind(record) {
    const plain = plainRecordBody(record);
    const remindName = 'set_remind_chord';
    const isReminder = plain.length >= remindName.length + 1
      && [...remindName].every((char, index) => plain[index + 1] === char.charCodeAt(0));
    if (isReminder) return 'reminder';
    if (plain[0] !== 0x01) return 'control';
    if (plain[1] === 0x06) return 'meta';
    if (plain[1] === 0x07) return 'note';
    if (plain[1] === 0x0f) return 'reset';
    return 'control';
  }

  function deviceRecordChord(record) {
    const plain = plainRecordBody(record);
    if (plain[0] !== 0x01 || plain[1] !== 0x07 || plain.length < 4) return null;
    const itemTypes = [...plain.subarray(3, 3 + plain[2])];
    let offset = 3 + plain[2];
    for (const itemType of itemTypes) {
      if (itemType === 0x01 && offset + 13 <= plain.length) offset += 13;
      else if (itemType === 0x02 && offset + 15 <= plain.length) {
        const view = new DataView(plain.buffer, plain.byteOffset + offset, 15);
        return {
          root: plain[offset + 3] & 0x0f,
          index: view.getUint16(1, true),
          position: view.getFloat32(7, true),
        };
      } else if (itemType === 0x05 && offset + 8 <= plain.length) {
        offset += plain[offset + 7] === 1 ? 12 : 10;
      } else break;
    }
    return null;
  }

  function chordRootSemitone(chord) {
    const match = String(chord || '').trim().replaceAll('♯', '#').replaceAll('♭', 'b')
      .match(/^([A-G])([#b]?)/i);
    if (!match) return null;
    const natural = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1].toUpperCase()];
    return (natural + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0) + 12) % 12;
  }

  function bindCanonicalCueTimeline(records, cues) {
    const timeline = Array.from(cues || []);
    let cueIndex = 0;
    for (const record of records) {
      const deviceChord = deviceRecordChord(record);
      record.cueIndex = -1;
      if (!deviceChord) continue;
      const cue = timeline[cueIndex];
      if (!cue) throw new Error(`原琴曲谱多出第 ${cueIndex + 1} 个和弦事件`);
      const expectedRoot = chordRootSemitone(cue.chord || cue.root);
      if (expectedRoot != null && expectedRoot !== deviceChord.root) {
        throw new Error(`原琴与画面第 ${cueIndex + 1} 个和弦不一致`);
      }
      record.cueIndex = cueIndex;
      record.deviceChord = deviceChord;
      cueIndex += 1;
    }
    if (timeline.length && cueIndex !== timeline.length) {
      throw new Error(`原琴与画面和弦数量不一致（${cueIndex}/${timeline.length}）`);
    }
    return cueIndex;
  }

  function resetDeviceStream() {
    state.streamGeneration += 1;
    state.streamRecords = [];
    state.streamReminder = null;
    state.streamCursor = 0;
    state.streamSentNotes = 0;
    state.streamQueuedCues = 0;
    state.streamCueTotal = 0;
    state.streamStaged = false;
    state.streamReady = false;
    state.streamComplete = false;
    emit();
  }

  async function resetInstrumentSong() {
    if (!state.connected) throw new Error('LiberLive 琴尚未连接');
    resetDeviceStream();
    const generation = state.streamGeneration;
    return queueStreamTask(async currentGeneration => {
      if (currentGeneration !== generation) return { cancelled: true };
      const resetBody = xor(Uint8Array.from([0x01, 0x0f]), KEY_A);
      await writeRaw(makeMFrame(resetBody));
      await readResponse();
      await new Promise(resolve => setTimeout(resolve, STREAM_FRAME_DELAY_MS));
      if (currentGeneration !== state.streamGeneration) return { cancelled: true };
      await writeRaw(makeMFrame(resetBody));
      return { reset: true };
    });
  }

  function queueStreamTask(operation) {
    const generation = state.streamGeneration;
    const task = state.streamQueue.catch(() => {}).then(async () => {
      if (generation !== state.streamGeneration) return { cancelled: true };
      if (!state.connected) throw new Error('LiberLive 琴尚未连接');
      return operation(generation);
    });
    state.streamQueue = task;
    return task;
  }

  async function sendStreamRecord(record, generation) {
    if (generation !== state.streamGeneration) return false;
    await writeRaw(makeMFrame(record.body));
    // A102 replies are protocol acknowledgements, not CoreBluetooth write
    // acknowledgements.  They must be consumed before the next setup command.
    if (record.needsResponse) await readResponse();
    // Setup frames retain the captured-app pacing.  Once fill-note streaming
    // begins, the payload's short bounded delay keeps top-ups ahead of playing
    // without making the launch screen wait on a large initial window.
    const delay = recordKind(record) === 'note'
      ? Math.max(8, Number(record.delayMs) || 0)
      : Math.max(STREAM_FRAME_DELAY_MS, Number(record.delayMs) || 0);
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    return generation === state.streamGeneration;
  }

  async function sendUntilNoteBudget(noteBudget, generation, onProgress) {
    let notes = 0;
    while (state.streamCursor < state.streamRecords.length) {
      const record = state.streamRecords[state.streamCursor];
      const kind = recordKind(record);
      if (kind === 'note' && notes >= noteBudget) break;
      if (!await sendStreamRecord(record, generation)) return { cancelled: true };
      state.streamCursor += 1;
      if (kind === 'note') {
        notes += 1;
        state.streamSentNotes += 1;
      }
      if (record.cueIndex >= 0) state.streamQueuedCues = record.cueIndex + 1;
      onProgress?.(state.streamCursor / state.streamRecords.length,
        state.streamCursor, state.streamRecords.length);
    }
    state.streamComplete = state.streamCursor >= state.streamRecords.length;
    emit();
    return { frames: state.streamCursor, notes, complete: state.streamComplete };
  }


  async function sendUntilCueTarget(cueTarget, generation, onProgress, drainAfterLastCue = false) {
    const target = Math.max(0, Math.min(state.streamCueTotal, Math.round(Number(cueTarget) || 0)));
    const drainTail = drainAfterLastCue && state.streamCueTotal > 0 && target >= state.streamCueTotal;
    while (state.streamCursor < state.streamRecords.length
      && (state.streamQueuedCues < target || drainTail)) {
      const record = state.streamRecords[state.streamCursor];
      if (!await sendStreamRecord(record, generation)) return { cancelled: true };
      state.streamCursor += 1;
      if (recordKind(record) === 'note') state.streamSentNotes += 1;
      if (record.cueIndex >= 0) state.streamQueuedCues = record.cueIndex + 1;
      onProgress?.(state.streamCursor / state.streamRecords.length,
        state.streamCursor, state.streamRecords.length);
    }
    state.streamComplete = state.streamCursor >= state.streamRecords.length;
    emit();
    return {
      frames: state.streamCursor,
      queuedCues: state.streamQueuedCues,
      complete: state.streamComplete,
    };
  }

  async function stageDeviceSong(payload, { onProgress, keyShift = 0, cueTimeline = [] } = {}) {
    if (!state.connected) throw new Error('LiberLive 琴尚未连接');
    const parsedRecords = parseDevicePayload(payload);
    const reminderIndex = parsedRecords.findIndex(record => recordKind(record) === 'reminder');
    const reminder = reminderIndex >= 0 ? parsedRecords[reminderIndex] : null;
    const rawRecords = reminderIndex >= 0
      ? parsedRecords.filter((_record, index) => index !== reminderIndex)
      : parsedRecords;
    const cueTotal = bindCanonicalCueTimeline(rawRecords, cueTimeline);
    const records = rawRecords.map(record => transposeDeviceRecord(record, keyShift));
    if (!records.length) throw new Error('原琴载荷为空');
    state.streamGeneration += 1;
    state.streamRecords = records;
    state.streamReminder = reminder;
    state.streamCursor = 0;
    state.streamSentNotes = 0;
    state.streamQueuedCues = 0;
    state.streamCueTotal = cueTotal;
    state.streamStaged = false;
    state.streamReady = false;
    state.streamComplete = false;
    const generation = state.streamGeneration;
    emit();
    return queueStreamTask(async currentGeneration => {
      if (currentGeneration !== generation) return { cancelled: true };
      // During 3/2/1 send only invisible setup/meta commands.  The reminder
      // and first fill-note window are deliberately held back so neither the
      // App nor the instrument shows C before performance actually starts.
      const result = await sendUntilNoteBudget(0, generation, onProgress);
      if (result.cancelled) return result;
      state.streamStaged = true;
      emit();
      return { ...result, staged: true, total: records.length + (reminder ? 1 : 0) };
    });
  }

  async function activateDeviceSong({ onProgress } = {}) {
    if (!state.streamStaged) throw new Error('原琴曲谱初始化尚未完成');
    const generation = state.streamGeneration;
    return queueStreamTask(async currentGeneration => {
      if (currentGeneration !== generation) return { cancelled: true };
      // The first fill-note frame already contains the first chord and makes
      // the instrument show its reminder. Sending set_remind_chord immediately
      // before it produces the same first (usually red/C) cue twice.
      state.streamReminder = null;
      const result = state.streamCueTotal > 0
        ? await sendUntilCueTarget(INITIAL_CUE_WINDOW, generation, onProgress)
        : await sendUntilNoteBudget(LEGACY_INITIAL_NOTE_WINDOW, generation, onProgress);
      if (result.cancelled) return result;
      state.streamReady = true;
      emit();
      return { ...result, ready: true, total: state.streamRecords.length };
    });
  }

  async function prepareDeviceSong(payload, options = {}) {
    await stageDeviceSong(payload, options);
    return activateDeviceSong(options);
  }

  async function advanceDeviceSong({ cueIndex = null, cueCount = TOP_UP_CUE_WINDOW } = {}) {
    if (!state.streamReady) throw new Error('原琴曲谱窗口尚未准备');
    if (state.streamComplete) return { frames: state.streamCursor, notes: 0, complete: true };
    if (state.streamCueTotal <= 0) {
      return queueStreamTask(generation => sendUntilNoteBudget(LEGACY_TOP_UP_NOTE_WINDOW, generation));
    }
    const consumed = Number.isFinite(Number(cueIndex))
      ? Math.max(0, Math.round(Number(cueIndex)) + 1)
      : Math.max(0, state.streamQueuedCues - INITIAL_CUE_WINDOW + 1);
    const target = consumed + INITIAL_CUE_WINDOW + Math.max(0, Math.round(Number(cueCount) || 0));
    return queueStreamTask(generation => sendUntilCueTarget(
      target,
      generation,
      null,
      consumed >= state.streamCueTotal,
    ));
  }

  function stopDeviceSong() {
    resetDeviceStream();
  }

  async function readResponse() {
    if (!state.connected) throw new Error('LiberLive 琴尚未连接');
    if (nativeSupported()) {
      const result = await nativePlugin().readLiberLive();
      const data = fromBase64(result?.data || '');
      return data;
    }
    const targets = [...state.connections.values()];
    if (!targets.length) throw new Error('LiberLive 读取特征不可用');
    const replies = await Promise.all(targets.map(async connection => {
      if (!connection.readCharacteristic) throw new Error(`${connection.name} 读取特征不可用`);
      const value = await connection.readCharacteristic.readValue();
      const data = new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
      ingestDeviceData({ source: 'read', id: connection.id, name: connection.name }, data);
      return data;
    }));
    return replies[0] || new Uint8Array();
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
    crc8, crc16, xor, makeMFrame, counterFromAFrame, decodeAFrame, commandNameFromBody,
    scan, connect, disconnect, writeRaw, writeBody, readResponse,
    parseDevicePayload, sendDevicePayload, sendFrames, sendBodies,
    legacyCommand, commandSetTempo, commandPlayChord, commandRemindChord, commandPlayNote,
    recordKind, deviceRecordChord, bindCanonicalCueTimeline, transposeDeviceRecord, resetInstrumentSong, stageDeviceSong, activateDeviceSong,
    prepareDeviceSong, advanceDeviceSong, stopDeviceSong,
    snapshot, subscribe,
  });
})();
