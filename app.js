const $ = (id) => document.getElementById(id);
const DEFAULT_MIDI = 'music/后来_刘若英_C2_959553.mid';
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const audio = { ctx: null, master: null, recordDest: null, gameRecordGain: null, toneRecorderConnected: false };
const sampled = { piano: null, ready: false };
const freepatsGuitar = {
  base: 'samples/freepats_spanish_guitar/SpanishClassicalGuitar-SFZ-20190618/',
  regions: [],
  buffers: new Map(),
};
const wasmParser = { promise: null, exports: null };
const patterns = { manifest: null, byCode: new Map(), promise: null };
let song = null;
let lyricLines = [];
let lastLyricIndex = -1;
let lastLyricParticleAt = 0;
let timers = [];
let cueTimers = [];
let harmonyTimers = [];
let cueRuntimeTimer = null;
let activeCue = null;
let nextCueIndex = 0;
let currentDrumCode = null;
let playStartedAt = 0;
let playOffset = 0;
let playing = false;
let clockTimer = null;
let lastTrack2Index = -1;
let wakeLock = null;
let melodyEnabled = true;
let melodyUserTouched = false;
let melodyGain = 1.0;
let harmonyGain = 1.55;
let micEnabled = false;
// 麦克风固定 95% 防爆麦：这是内部隐藏值，不在界面暴露，也不允许用户调节。
const FIXED_MIC_GAIN = 0.95;
let micGain = FIXED_MIC_GAIN;
const mic = { stream: null, source: null, gain: null, analyser: null, data: null, freqData: null, raf: 0, level: 0, ready: false };
const recorder = { media: null, chunks: [], blob: null, url: '', mime: '', active: false, requestedStop: false, hadMic: false };
let drumsEnabled = false;
let drumMode = 'auto';
let playMode = 'semi';
let guideMode = false;
let nextManualMelodyIndex = 0;
let manualMelodyTimers = [];
let manualLastPressAt = 0;
let manualSpeedScale = 1;
let midiReady = false;
let midiReadyPromise = null;
let sampleReadyPromise = Promise.resolve(false);
let startRequested = false;
let countdownTimer = null;
let harmonyAutoTimers = [];
let harmonyToneMode = 1;
let userPickEvents = [];
let initialPickSlot = null;
let userKeyShift = 0;
let HARMONY_TONES = [
  { label: 'A', code: 'GS_3', name: 'acoustic_guitar_steel', gain: 0.78 },
  { label: 'B', code: 'PianoStudio_4', name: 'Salamander Grand Piano', localPiano: true, gain: 0.42 },
];
const soundfont = { instruments: new Map(), promises: new Map(), ready: false };
const NATURAL_TO_MIDI = { C: 60, D: 62, E: 64, F: 65, G: 67, A: 69, B: 71 };
const NOTE_PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const PC_NOTE_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const cueState = new Map();
const harmonyRepeat = new Map();

function setPill(id, text, type = '') {
  const el = $(id);
  el.textContent = text;
  el.className = `${id === 'timeStatus' ? 'meter' : 'pill'} ${type}`.trim();
}
function labelOf(midi) { return NOTE_NAMES[midi % 12].replace('#', '♯') + Math.floor(midi / 12 - 1); }
function toneNoteOf(midi) { return NOTE_NAMES[midi % 12] + Math.floor(midi / 12 - 1); }
function fmt(sec) {
  sec = Math.max(0, sec || 0);
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
function updatePlayButton() {
  const btn = $('playBtn');
  if (!btn) return;
  btn.textContent = playing ? '⏸' : '▶';
  btn.classList.toggle('playing', !!playing);
  btn.setAttribute('aria-label', playing ? 'pause' : 'play/resume');
}

function updateClock() {
  if (!song) { setPill('timeStatus', '00:00 - 00:00'); updatePlayButton(); return; }
  const now = playing ? playOffset + (performance.now() - playStartedAt) / 1000 : playOffset;
  setPill('timeStatus', `${fmt(Math.min(now, song.duration))} - ${fmt(song.duration)}`);
  updatePlayButton();
}

async function loadPatternManifest() {
  if (patterns.promise) return patterns.promise;
  patterns.promise = fetch('patterns/player_bundle/catalog/player_patterns_manifest.json?v=reset-20260706-21', { cache: 'no-store' })
    .then(res => {
      if (!res.ok) throw new Error(`pattern manifest HTTP ${res.status}`);
      return res.json();
    })
    .then(manifest => {
      patterns.manifest = manifest;
      patterns.byCode = new Map((manifest.patterns || []).map(p => [p.code, p]));
      return manifest;
    });
  return patterns.promise;
}

async function loadWasmParser() {
  if (wasmParser.promise) return wasmParser.promise;
  wasmParser.promise = WebAssembly.instantiateStreaming(fetch('pkg/piano_wasm.wasm?v=reset-20260706-21'), {})
    .catch(async () => {
      const res = await fetch('pkg/piano_wasm.wasm?v=reset-20260706-21', { cache: 'no-store' });
      const bytes = await res.arrayBuffer();
      return WebAssembly.instantiate(bytes, {});
    })
    .then(result => {
      wasmParser.exports = result.instance.exports;
      return wasmParser.exports;
    });
  return wasmParser.promise;
}

async function parseMidiWithWasm(buffer) {
  const bytes = new Uint8Array(buffer);
  const wasm = await loadWasmParser();
  const cap = wasm.input_capacity ? wasm.input_capacity() : 0;
  if (!wasm.memory || !wasm.input_ptr || !wasm.parse_midi_bytes || bytes.length > cap) {
    throw new Error('WASM parser unavailable');
  }
  const ptr = wasm.input_ptr();
  new Uint8Array(wasm.memory.buffer, ptr, bytes.length).set(bytes);
  const len = wasm.parse_midi_bytes(bytes.length);
  const outPtr = wasm.output_ptr();
  const json = new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, outPtr, len));
  const parsed = JSON.parse(json);
  if (parsed.error) throw new Error(parsed.error);
  parsed.parsedBy = 'wasm';
  return parsed;
}

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    if (!wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (err) {
    console.warn('Wake Lock unavailable:', err);
  }
}

async function releaseWakeLock() {
  try {
    if (wakeLock) await wakeLock.release();
  } catch {}
  wakeLock = null;
}

function initSamplePiano() {
  if (!window.Tone) {
    setPill('sampleStatus', '⚠️ Tone.js 未加载，使用内置音色', 'warn');
    sampleReadyPromise = Promise.resolve(false);
    return sampleReadyPromise;
  }
  sampleReadyPromise = new Promise(resolve => {
    sampled.piano = new Tone.Sampler({
    urls: {
      A0: 'A0.mp3', C1: 'C1.mp3', 'D#1': 'Ds1.mp3', 'F#1': 'Fs1.mp3', A1: 'A1.mp3',
      C2: 'C2.mp3', 'D#2': 'Ds2.mp3', 'F#2': 'Fs2.mp3', A2: 'A2.mp3',
      C3: 'C3.mp3', 'D#3': 'Ds3.mp3', 'F#3': 'Fs3.mp3', A3: 'A3.mp3',
      C4: 'C4.mp3', 'D#4': 'Ds4.mp3', 'F#4': 'Fs4.mp3', A4: 'A4.mp3',
      C5: 'C5.mp3', 'D#5': 'Ds5.mp3', 'F#5': 'Fs5.mp3', A5: 'A5.mp3',
      C6: 'C6.mp3', 'D#6': 'Ds6.mp3', 'F#6': 'Fs6.mp3', A6: 'A6.mp3',
      C7: 'C7.mp3', 'D#7': 'Ds7.mp3', 'F#7': 'Fs7.mp3', A7: 'A7.mp3', C8: 'C8.mp3',
    },
    release: 1.25,
    baseUrl: 'samples/salamander/',
      onload: () => {
        sampled.ready = true;
        setPill('sampleStatus', '✅ Salamander Grand Piano 采样音色', 'ok');
        resolve(true);
      },
    }).toDestination();
    Tone.Destination.volume.value = -5;
  });
  return sampleReadyPromise;
}
function ensureAudio() {
  if (!audio.ctx) {
    audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
    audio.master = audio.ctx.createGain();
    audio.master.gain.value = 0.48;
    audio.master.connect(audio.ctx.destination);
    audio.recordDest = audio.ctx.createMediaStreamDestination();
    audio.gameRecordGain = audio.ctx.createGain();
    audio.gameRecordGain.gain.value = 1;
    audio.master.connect(audio.gameRecordGain).connect(audio.recordDest);
  }
  if (audio.ctx.state === 'suspended') audio.ctx.resume();
  connectToneToRecorder();
}

function connectToneToRecorder() {
  if (!window.Tone || !audio.recordDest || audio.toneRecorderConnected) return;
  try {
    const dest = Tone.getDestination ? Tone.getDestination() : Tone.Destination;
    if (dest?.connect) {
      dest.connect(audio.recordDest);
      audio.toneRecorderConnected = true;
    }
  } catch (err) {
    console.warn('Tone recorder connect failed:', err);
  }
}
function midiToFreq(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

function initFreepatsRegions() {
  if (freepatsGuitar.regions.length) return;
  const direct = [
    [32,'G#1.wav'], [33,'A1.wav'], [34,'A#1.wav'], [35,'B1.wav'], [36,'C2.wav'], [37,'C#2.wav'],
    [38,'D2.wav'], [39,'D#2.wav'], [40,'E2.wav'], [41,'F2.wav'], [48,'C3.wav'], [53,'F3.wav'],
    [54,'F#3.wav'], [55,'G3.wav'], [56,'G#3.wav'], [57,'A3.wav'], [58,'A#3.wav'], [59,'B3.wav'],
    [60,'C4.wav'], [61,'C#4.wav'], [62,'D4.wav'], [63,'D#4.wav'], [64,'E4.wav'], [65,'F4.wav'],
    [66,'F#4.wav'], [67,'G4.wav'], [70,'A#4.wav'], [71,'B4.wav'], [72,'C5.wav'], [73,'C#5.wav'],
    [74,'D5.wav'], [75,'D#5.wav'], [76,'E5.wav'], [77,'F5.wav'], [78,'F#5.wav'], [79,'G5.wav'],
    [80,'G#5.wav'], [81,'A5.wav'], [82,'A#5.wav'], [83,'B5.wav'],
  ];
  freepatsGuitar.regions = [
    { lo: 29, hi: 31, center: 31, sample: 'G1.wav' },
    ...direct.map(([key, sample]) => ({ lo: key, hi: key, center: key, sample })),
    { lo: 42, hi: 43, center: 43, sample: 'G2.wav' },
    { lo: 44, hi: 45, center: 45, sample: 'A2.wav' },
    { lo: 46, hi: 47, center: 47, sample: 'B2.wav' },
    { lo: 49, hi: 50, center: 50, sample: 'D3.wav' },
    { lo: 51, hi: 52, center: 52, sample: 'E3.wav' },
    { lo: 68, hi: 69, center: 69, sample: 'A4.wav' },
    { lo: 84, hi: 88, center: 84, sample: 'C6.wav' },
  ].sort((a, b) => a.lo - b.lo);
}

function freepatsRegionFor(midi) {
  initFreepatsRegions();
  const clipped = Math.max(29, Math.min(88, Math.round(midi)));
  return freepatsGuitar.regions.find(r => clipped >= r.lo && clipped <= r.hi)
    || freepatsGuitar.regions.reduce((best, r) =>
      Math.abs(r.center - clipped) < Math.abs(best.center - clipped) ? r : best, freepatsGuitar.regions[0]);
}

async function getFreepatsBuffer(region) {
  ensureAudio();
  if (freepatsGuitar.buffers.has(region.sample)) return freepatsGuitar.buffers.get(region.sample);
  const url = `${freepatsGuitar.base}samples/${encodeURIComponent(region.sample)}`;
  const promise = fetch(url, { cache: 'force-cache' })
    .then(res => {
      if (!res.ok) throw new Error(`FreePats sample HTTP ${res.status}`);
      return res.arrayBuffer();
    })
    .then(buf => audio.ctx.decodeAudioData(buf));
  freepatsGuitar.buffers.set(region.sample, promise);
  return promise;
}

function playFreepatsGuitarNote(midi, duration = 0.75, velocity = 0.5, gainScale = 0.78) {
  ensureAudio();
  const region = freepatsRegionFor(midi);
  getFreepatsBuffer(region).then(buffer => {
    const ctx = audio.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buffer;
    src.playbackRate.value = Math.pow(2, (midi - region.center) / 12);
    const peak = Math.max(0.025, Math.min(0.9, velocity * gainScale));
    const hold = Math.max(0.06, Math.min(2.2, duration));
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.006);
    gain.gain.setTargetAtTime(peak * 0.72, now + 0.035, 0.22);
    gain.gain.setTargetAtTime(0.0001, now + hold, 0.42);
    src.connect(gain).connect(audio.master);
    src.start(now);
    src.stop(now + hold + 1.6);
  }).catch(err => {
    console.warn('FreePats guitar failed:', err);
    fallbackSoftNote(midi, duration, velocity);
  });
}

function localSoundfontUrl(name, soundfont, format) {
  const fmt = format === 'ogg' ? 'ogg' : 'mp3';
  return `soundfonts/FluidR3_GM/${name}-${fmt}.js`;
}

function getSoundfontInstrument(preset) {
  if (preset.localPiano || preset.freepatsGuitar) return Promise.resolve(null);
  if (!window.Soundfont || !audio.ctx) return Promise.resolve(null);
  if (soundfont.instruments.has(preset.name)) return Promise.resolve(soundfont.instruments.get(preset.name));
  if (!soundfont.promises.has(preset.name)) {
    const p = Soundfont.instrument(audio.ctx, preset.name, {
      soundfont: 'FluidR3_GM',
      format: 'mp3',
      nameToUrl: localSoundfontUrl,
      destination: audio.master,
      gain: preset.gain || 0.65,
    }).then(inst => {
      soundfont.instruments.set(preset.name, inst);
      return inst;
    }).catch(err => {
      console.warn('SoundFont load failed:', preset.name, err);
      return null;
    });
    soundfont.promises.set(preset.name, p);
  }
  return soundfont.promises.get(preset.name);
}

function fallbackSoftNote(midi, duration = 0.75, velocity = 0.5) {
  ensureAudio();
  const ctx = audio.ctx;
  const now = ctx.currentTime;
  const freq = midiToFreq(midi);
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  filter.type = 'lowpass';
  filter.frequency.value = 1200;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.025, velocity * 0.16), now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.15, duration));
  osc.connect(filter).connect(gain).connect(audio.master);
  osc.start(now);
  osc.stop(now + Math.max(0.15, duration) + 0.04);
}

function playHarmonyToneNote(midi, duration = 0.75, velocity = 0.5, toneMode = harmonyToneMode) {
  const preset = HARMONY_TONES[(toneMode - 1 + HARMONY_TONES.length) % HARMONY_TONES.length];
  ensureAudio();
  if (preset.freepatsGuitar) {
    playFreepatsGuitarNote(midi, duration, velocity, (preset.gain || 0.78) * harmonyGain);
    return;
  }
  if (preset.localPiano && sampled.ready && sampled.piano && window.Tone) {
    Tone.start();
    sampled.piano.triggerAttackRelease(toneNoteOf(midi), duration, undefined, Math.max(0.035, velocity * (preset.gain || 0.42) * harmonyGain));
    return;
  }
  getSoundfontInstrument(preset).then(inst => {
    if (!inst) return fallbackSoftNote(midi, duration, velocity);
    const note = preset.drum ? Math.min(81, Math.max(35, midi)) : midi;
    inst.play(note, audio.ctx.currentTime, Math.max(0.08, duration), {
      gain: Math.max(0.05, Math.min(1, velocity * (preset.gain || 0.65) * harmonyGain)),
    });
  });
}

function drumPitchToMidi(pitch) {
  const p = Math.round(Number(pitch));
  if (p === 24) return 36; // kick
  if (p === 25 || p === 26) return 38; // snare
  if (p === 30) return 42; // closed hat
  if (p === 41) return 46; // open hat
  return Math.max(35, Math.min(81, p + 12));
}

function playDrumPatternNote(patternNote) {
  ensureAudio();
  const preset = { name: 'synth_drum', gain: 0.58 };
  getSoundfontInstrument(preset).then(inst => {
    if (!inst) return;
    const midi = drumPitchToMidi(patternNote.pitch);
    inst.play(midi, audio.ctx.currentTime, Math.max(0.05, Number(patternNote.duration || 0.2) * beatMs() / 1000), {
      gain: Math.max(0.04, Math.min(0.85, Number(patternNote.velocity || 64) / 127)),
    });
  });
}

function playNote(midi, duration = 0.55, velocity = 0.6) {
  if (sampled.ready && sampled.piano && window.Tone) {
    Tone.start();
    sampled.piano.triggerAttackRelease(toneNoteOf(midi), duration, undefined, Math.max(0.04, Math.min(1, velocity * melodyGain)));
    return;
  }
  ensureAudio();
  const now = audio.ctx.currentTime;
  const osc = audio.ctx.createOscillator();
  const gain = audio.ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = midiToFreq(midi);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.04, Math.min(1, velocity * melodyGain)), now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(gain).connect(audio.master);
  osc.start(now); osc.stop(now + duration + 0.05);
}

function flash(keyboardId, midi, ms = 520, mode = 'active') {
  document.querySelectorAll(`#${keyboardId} .key[data-midi="${midi}"]`).forEach(k => {
    k.classList.add(mode);
    setTimeout(() => {
      k.classList.remove(mode);
      k.classList.add('release');
      if (mode !== 'harmony') burstParticles(k, keyboardId === 'playbackKeyboard' ? 'playback' : 'manual');
      setTimeout(() => k.classList.remove('release'), 360);
    }, ms);
  });
}

function burstParticles(key, source) {
  const rect = key.getBoundingClientRect();
  const root = document.body;
  const noteClass = [...key.classList].find(c => c.startsWith('note-')) || 'note-c';
  const count = source === 'manual' ? 18 : 12;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    p.className = `particle ${source} ${noteClass}`;
    const x = rect.left + rect.width * (0.18 + Math.random() * 0.64);
    const y = rect.top + rect.height * (0.18 + Math.random() * 0.70);
    const angle = Math.random() * Math.PI * 2;
    const dist = (source === 'manual' ? 42 : 28) + Math.random() * (source === 'manual' ? 54 : 36);
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(angle) * dist - Math.random() * 22}px`);
    p.style.setProperty('--rot', `${Math.random() * 540 - 270}deg`);
    p.style.setProperty('--size', `${4 + Math.random() * (source === 'manual' ? 8 : 5)}px`);
    root.appendChild(p);
    setTimeout(() => p.remove(), 820);
  }
}

function burstMissParticles(key) {
  const rect = key.getBoundingClientRect();
  const root = document.body;
  const count = 26;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    p.className = 'particle miss';
    const x = rect.left + rect.width * (0.18 + Math.random() * 0.64);
    const y = rect.top + rect.height * (0.22 + Math.random() * 0.58);
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.35;
    const dist = 34 + Math.random() * 78;
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(angle) * dist + 22}px`);
    p.style.setProperty('--rot', `${Math.random() * 900 - 450}deg`);
    p.style.setProperty('--size', `${3 + Math.random() * 9}px`);
    root.appendChild(p);
    setTimeout(() => p.remove(), 900);
  }
}

function cueProgressForKey(key) {
  const state = cueState.get(key.dataset.root);
  if (!state) return null;
  const now = performance.now();
  if (now < state.start || now > state.end) return null;
  if (now <= state.due) {
    return ((now - state.start) / Math.max(1, state.due - state.start)) * 70;
  }
  return 70 + ((now - state.due) / Math.max(1, state.end - state.due)) * 30;
}

function isGoodTiming(key) {
  const p = cueProgressForKey(key);
  return p !== null && p >= 65 && p <= 75;
}
function playVisualNote(midi, velocity, source) {
  playNote(midi, 0.65, velocity);
  flash(source === 'manual' ? 'manualKeyboard' : 'playbackKeyboard', midi);
  $('nowPlaying').textContent = source === 'manual' ? `手动弹奏：${labelOf(midi)}` : `主旋律：${labelOf(midi)}`;
}

function playHarmonyVisualNote(midi, delay = 0, duration = 0.58, velocity = 0.42, toneMode = harmonyToneMode) {
  const timer = setTimeout(() => {
    playHarmonyToneNote(midi, duration, velocity, toneMode);
    flash('playbackKeyboard', midi, Math.max(360, duration * 720), 'harmony');
  }, delay);
  harmonyTimers.push(timer);
}

function clearHarmonyTimers() {
  harmonyTimers.forEach(clearTimeout);
  harmonyTimers = [];
}

function updateToneButton() {
  const btn = $('toneBtn');
  if (!btn) return;
  btn.textContent = HARMONY_TONES[harmonyToneMode - 1]?.label || 'A';
  btn.dataset.tone = HARMONY_TONES[harmonyToneMode - 1]?.code || '';
  btn.setAttribute('aria-pressed', harmonyToneMode > 1 ? 'true' : 'false');
}

function percentLabel(v) {
  return `${Math.round(v * 100)}%`;
}

function updateVolumeButtons() {
  const mv = $('menuMelodyVolValue');
  const hv = $('menuHarmonyVolValue');
  const micv = $('menuMicGainValue');
  const mr = $('menuMelodyVolRange');
  const hr = $('menuHarmonyVolRange');
  const mir = $('menuMicGainRange');
  if (mv) mv.textContent = percentLabel(melodyGain);
  if (hv) hv.textContent = percentLabel(harmonyGain);
  if (micv) micv.textContent = percentLabel(micGain);
  if (mr) { mr.value = String(Math.round(melodyGain * 100)); mr.style.setProperty('--pct', `${Math.round((melodyGain * 100 - 25) / 175 * 100)}%`); }
  if (hr) { hr.value = String(Math.round(harmonyGain * 100)); hr.style.setProperty('--pct', `${Math.round((harmonyGain * 100 - 25) / 175 * 100)}%`); }
  if (mir) { mir.value = String(Math.round(micGain * 100)); mir.style.setProperty('--pct', `${Math.round((micGain * 100 - 25) / 175 * 100)}%`); }
}

function adjustMelodyGain(delta) {
  melodyGain = Math.max(0.25, Math.min(2.0, Math.round((melodyGain + delta) * 20) / 20));
  updateVolumeButtons();
}

function adjustHarmonyGain(delta) {
  harmonyGain = Math.max(0.25, Math.min(2.5, Math.round((harmonyGain + delta) * 20) / 20));
  updateVolumeButtons();
}

function adjustMicGain(delta) {
  micGain = FIXED_MIC_GAIN;
  if (mic.gain) mic.gain.gain.value = FIXED_MIC_GAIN;
  updateVolumeButtons();
}
function updateKeyButtons() {
  const label = userKeyShift === 0 ? '0' : `${userKeyShift > 0 ? '+' : ''}${userKeyShift}`;
  const down = $('keyDownBtn');
  const up = $('keyUpBtn');
  if (down) {
    down.textContent = '降';
    down.title = `整首降Key · 当前 ${label}`;
    down.dataset.shift = label;
  }
  if (up) {
    up.textContent = '升';
    up.title = `整首升Key · 当前 ${label}`;
    up.dataset.shift = label;
  }
  const menuValue = $('menuKeyValue');
  if (menuValue) {
    menuValue.textContent = label;
    menuValue.title = `当前 Key ${label}`;
  }
  const menuRange = $('menuKeyRange');
  if (menuRange) {
    menuRange.value = String(userKeyShift);
    menuRange.style.setProperty('--pct', `${((userKeyShift + 14) / 28) * 100}%`);
  }
}

function previewKeyShift(delta) {
  ensureAudio();
  // 试听变调后的实际音高：先响根音，再轻轻带出当前 Key 的 C 和弦色彩。
  const root = shiftedMidi(60);
  playNote(root, 0.38, 0.72);
  setTimeout(() => playHarmonyToneNote(root + 4, 0.32, 0.42, harmonyToneMode), 70);
  setTimeout(() => playHarmonyToneNote(root + 7, 0.32, 0.40, harmonyToneMode), 115);
}

function applyKeyShift(delta) {
  userKeyShift = Math.max(-14, Math.min(14, userKeyShift + delta));
  updateKeyButtons();
  renderManualKeyboard();
  renderPlaybackForMelody();
  updateLyrics();
  if (activeCue) {
    const midi = NATURAL_TO_MIDI[activeCue.cue.root];
    if (activeCue.hit) hitCue(midi, activeCue.cue);
    else startCue(midi, activeCue.cue);
  }
  warmHarmonyTones(true);
  previewKeyShift(delta);
  if (playing) scheduleFrom(currentPlayTime());
}

async function ensureMic() {
  if (!micEnabled) return false;
  ensureAudio();
  if (mic.ready && mic.stream) return true;
  if (!navigator.mediaDevices?.getUserMedia) {
    alert('这个浏览器不支持麦克风录音');
    micEnabled = false;
    updateMicMenu();
    return false;
  }
  try {
    mic.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
    });
    mic.source = audio.ctx.createMediaStreamSource(mic.stream);
    micGain = FIXED_MIC_GAIN;
    mic.gain = audio.ctx.createGain();
    mic.gain.gain.value = FIXED_MIC_GAIN;
    mic.analyser = audio.ctx.createAnalyser();
    mic.analyser.fftSize = 512;
    mic.analyser.smoothingTimeConstant = 0.68;
    mic.data = new Uint8Array(mic.analyser.fftSize);
    mic.freqData = new Uint8Array(mic.analyser.frequencyBinCount);
    mic.source.connect(mic.gain);
    mic.gain.connect(mic.analyser);
    mic.gain.connect(audio.recordDest);
    mic.ready = true;
    startMicMeter();
    return true;
  } catch (err) {
    console.warn('Mic permission failed:', err);
    alert('麦克风没有授权，录音里不会有人声');
    micEnabled = false;
    updateMicMenu();
    return false;
  }
}

function updateMicMenu() {
  document.querySelectorAll('[data-mic]').forEach(b => b.classList.toggle('selected', (b.dataset.mic === 'on') === micEnabled));
  const meter = $('micMeter');
  if (meter) meter.classList.toggle('off', !micEnabled);
}

function stopMic() {
  cancelAnimationFrame(mic.raf);
  mic.raf = 0;
  if (mic.stream) {
    mic.stream.getTracks().forEach(track => track.stop());
  }
  mic.stream = null;
  mic.source = null;
  mic.gain = null;
  mic.analyser = null;
  mic.data = null;
  mic.freqData = null;
  mic.ready = false;
  mic.level = 0;
  const wave = $('micWave');
  if (wave) {
    wave.classList.remove('live');
    wave.style.setProperty('--mic-level', '0');
    drawMicWave(false);
  }
  const karaoke = document.querySelector('.karaoke');
  if (karaoke) {
    karaoke.classList.remove('mic-live');
    karaoke.style.setProperty('--mic-level', '0');
  }
}

function setupMicWave() {
  const wave = $('micWave');
  if (!wave || wave.dataset.ready === '1') return;
  if (!$('micWaveCanvas')) {
    const canvas = document.createElement('canvas');
    canvas.id = 'micWaveCanvas';
    canvas.className = 'mic-wave-canvas';
    wave.prepend(canvas);
  }
  wave.querySelectorAll('.eq').forEach((eq, sideIndex) => {
    for (let i = 0; i < 34; i += 1) {
      const bar = document.createElement('span');
      const h = 18 + Math.round(Math.abs(Math.sin((i + 1.25) * (sideIndex ? 0.77 : 0.64))) * 62 + (i % 4) * 5);
      bar.style.setProperty('--i', i);
      bar.style.setProperty('--h', h);
      eq.appendChild(bar);
    }
  });
  wave.dataset.ready = '1';
}

function drawMicWave(live) {
  const canvas = $('micWaveCanvas');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!live || !mic.data || !mic.freqData) return;

  const level = Math.max(0.02, mic.level);
  const horizon = h * 0.64;
  const barBase = h * 0.78;
  const barMax = h * 0.42;

  const drawBars = (side) => {
    const leftSide = side === 'left';
    const count = 42;
    const startX = leftSide ? w * 0.035 : w * 0.56;
    const endX = leftSide ? w * 0.44 : w * 0.965;
    const gap = 2 * dpr;
    const bw = Math.max(2 * dpr, (endX - startX) / count - gap);
    const grad = ctx.createLinearGradient(0, barBase - barMax, 0, barBase);
    if (leftSide) {
      grad.addColorStop(0, 'rgba(205,242,255,.92)');
      grad.addColorStop(.22, 'rgba(0,178,255,.82)');
      grad.addColorStop(1, 'rgba(0,85,255,.12)');
      ctx.shadowColor = 'rgba(0,146,255,.72)';
    } else {
      grad.addColorStop(0, 'rgba(255,226,255,.92)');
      grad.addColorStop(.22, 'rgba(235,48,255,.82)');
      grad.addColorStop(1, 'rgba(147,48,255,.12)');
      ctx.shadowColor = 'rgba(221,45,255,.70)';
    }
    ctx.shadowBlur = 8 * dpr;
    ctx.fillStyle = grad;
    for (let i = 0; i < count; i += 1) {
      const logical = leftSide ? i : count - 1 - i;
      const bin = Math.min(mic.freqData.length - 1, Math.floor((logical / count) * mic.freqData.length * 0.72));
      const raw = mic.freqData[bin] / 255;
      const shaped = Math.pow(raw, 1.25);
      const bh = Math.max(2 * dpr, (0.03 + shaped * 0.97) * barMax * (0.38 + level * 0.92));
      const x = startX + i * (bw + gap);
      const y = barBase - bh;
      const step = 7 * dpr;
      for (let yy = y; yy < barBase; yy += step) {
        ctx.globalAlpha = Math.max(0.16, Math.min(0.82, 1 - (yy - y) / Math.max(1, bh)));
        ctx.fillRect(x, yy, bw, Math.min(step * 0.72, barBase - yy));
      }
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  };

  const drawWave = (side) => {
    const leftSide = side === 'left';
    const x0 = leftSide ? 0 : w * 0.52;
    const x1 = leftSide ? w * 0.48 : w;
    const amp = (10 + level * 46) * dpr;
    const grad = ctx.createLinearGradient(x0, 0, x1, 0);
    if (leftSide) {
      grad.addColorStop(0, 'rgba(0,96,255,.04)');
      grad.addColorStop(.35, 'rgba(0,213,255,.95)');
      grad.addColorStop(1, 'rgba(58,119,255,.02)');
      ctx.shadowColor = 'rgba(0,196,255,.9)';
    } else {
      grad.addColorStop(0, 'rgba(165,74,255,.02)');
      grad.addColorStop(.65, 'rgba(255,55,235,.95)');
      grad.addColorStop(1, 'rgba(255,62,206,.04)');
      ctx.shadowColor = 'rgba(255,54,229,.88)';
    }
    ctx.lineWidth = 1.35 * dpr;
    ctx.strokeStyle = grad;
    ctx.shadowBlur = 11 * dpr;
    ctx.beginPath();
    const steps = 150;
    for (let i = 0; i <= steps; i += 1) {
      const p = i / steps;
      const idx = Math.min(mic.data.length - 1, Math.floor(p * (mic.data.length - 1)));
      const sample = (mic.data[idx] - 128) / 128;
      const x = x0 + (x1 - x0) * p;
      const y = horizon + sample * amp;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.26;
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.moveTo(x0, horizon);
    ctx.lineTo(x1, horizon);
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  drawBars('left');
  drawBars('right');
  drawWave('left');
  drawWave('right');
}

function startMicMeter() {
  cancelAnimationFrame(mic.raf);
  const tick = () => {
    let level = 0;
    if (mic.analyser && mic.data) {
      mic.analyser.getByteTimeDomainData(mic.data);
      if (mic.freqData) mic.analyser.getByteFrequencyData(mic.freqData);
      let sum = 0;
      for (const v of mic.data) {
        const x = (v - 128) / 128;
        sum += x * x;
      }
      level = Math.min(1, Math.sqrt(sum / mic.data.length) * 4.5 * Math.max(0.25, micGain));
    }
    mic.level = mic.level * 0.72 + level * 0.28;
    const bar = $('micMeter')?.querySelector('span');
    if (bar) bar.style.transform = `scaleY(${Math.max(0.04, micEnabled ? mic.level : 0.04)})`;
    const karaoke = document.querySelector('.karaoke');
    if (karaoke) {
      const live = micEnabled && mic.ready;
      karaoke.classList.toggle('mic-live', live);
      karaoke.style.setProperty('--mic-level', live ? mic.level.toFixed(3) : '0');
      karaoke.style.setProperty('--mic-fountain-h', `${Math.round(18 + mic.level * 64)}%`);
      karaoke.style.setProperty('--mic-fountain-o', `${Math.min(0.72, 0.08 + mic.level * 0.78).toFixed(3)}`);
    }
    const wave = $('micWave');
    if (wave) {
      const live = micEnabled && mic.ready;
      wave.classList.toggle('live', live);
      wave.style.setProperty('--mic-level', live ? mic.level.toFixed(3) : '0');
      wave.style.setProperty('--mic-height', `${Math.round(18 + mic.level * 82)}%`);
      drawMicWave(live);
    }
    mic.raf = requestAnimationFrame(tick);
  };
  tick();
}

function recorderMimeType() {
  const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  return candidates.find(t => window.MediaRecorder?.isTypeSupported?.(t)) || '';
}

async function startRecording() {
  if (recorder.active || !window.MediaRecorder) return;
  ensureAudio();
  if (micEnabled) await ensureMic();
  recorder.hadMic = !!(micEnabled && mic.ready);
  recorder.chunks = [];
  recorder.blob = null;
  if (recorder.url) URL.revokeObjectURL(recorder.url);
  recorder.url = '';
  recorder.mime = recorderMimeType();
  try {
    recorder.media = new MediaRecorder(audio.recordDest.stream, recorder.mime ? { mimeType: recorder.mime } : undefined);
    recorder.media.ondataavailable = e => { if (e.data?.size) recorder.chunks.push(e.data); };
    recorder.media.onstop = () => {
      recorder.active = false;
      recorder.blob = new Blob(recorder.chunks, { type: recorder.mime || recorder.chunks[0]?.type || 'audio/webm' });
      recorder.url = URL.createObjectURL(recorder.blob);
      if (!recorder.requestedStop && recorder.blob.size && recorder.hadMic) promptSaveRecording();
      recorder.requestedStop = false;
    };
    recorder.media.start(1000);
    recorder.active = true;
  } catch (err) {
    console.warn('MediaRecorder start failed:', err);
  }
}

function stopRecording(autoPrompt = false) {
  if (recorder.active && recorder.media?.state !== 'inactive') {
    recorder.requestedStop = !autoPrompt;
    recorder.media.stop();
  } else if (autoPrompt && recorder.blob) {
    promptSaveRecording();
  }
}

function recordingExt() {
  const type = recorder.blob?.type || recorder.mime || '';
  if (type.includes('mp4')) return 'mp4';
  if (type.includes('ogg')) return 'ogg';
  return 'webm';
}

function downloadRecording() {
  if (!recorder.blob) {
    if (recorder.active) {
      stopRecording(false);
      setTimeout(downloadRecording, 650);
    } else {
      alert('还没有可保存的录音');
    }
    return;
  }
  const a = document.createElement('a');
  a.href = recorder.url || URL.createObjectURL(recorder.blob);
  a.download = `freeza-live-${new Date().toISOString().replace(/[:.]/g, '-')}.${recordingExt()}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function closeSavePrompt() {
  const modal = $('savePrompt');
  if (modal) modal.classList.remove('show');
}

function promptSaveRecording() {
  if (!recorder.hadMic || !recorder.blob?.size) return;
  const modal = $('savePrompt');
  const size = $('savePromptSize');
  if (size) size.textContent = `${(recorder.blob.size / 1024 / 1024).toFixed(2)} MB · ${recordingExt().toUpperCase()}`;
  if (modal) {
    modal.classList.add('show');
    return;
  }
  downloadRecording();
}

function songPlaybackTransposeSemitones() {
  // 和弦/分解伴奏统一使用原曲调号 + 用户升降 Key。
  return songTransposeSemitones() + userKeyShift;
}

function shiftedMidi(midi) {
  return Math.max(21, Math.min(108, Math.round(midi + userKeyShift)));
}

function shiftedRootLabel(root) {
  return transposeRootName(root, userKeyShift).replace('#', '♯');
}

function shiftedRootClass(root) {
  return noteClassForRoot(root);
}

function updatePlaybackToggles() {
  const melodyBtn = $('melodyToggle');
  const drumBtn = $('drumToggle');
  if (melodyBtn) {
    melodyBtn.classList.toggle('active-toggle', melodyEnabled);
    melodyBtn.setAttribute('aria-pressed', melodyEnabled ? 'true' : 'false');
  }
  if (drumBtn) {
    drumBtn.classList.toggle('active-toggle', drumMode !== 'off');
    drumBtn.setAttribute('aria-pressed', drumMode !== 'off' ? 'true' : 'false');
    drumBtn.title = `鼓机：${drumMode === 'auto' ? '自动' : drumMode === 'on' ? '开' : '关'}`;
  }
}

function firstRealLyricStart() {
  const line = lyricLines.find(l => !l.prelude && String(l.text || '').trim());
  return Number.isFinite(line?.start) ? line.start : Infinity;
}

function shouldAutoPlayMelodyAt(time) {
  if (!melodyEnabled || playMode === 'manual') return false;
  if (guideMode) return time < firstRealLyricStart() - 0.001;
  return true;
}

function isAutoChordMode() { return playMode === 'auto'; }
function isSemiAutoMode() { return playMode === 'semi'; }
function isManualMode() { return playMode === 'manual'; }

function currentHarmonyPreset() {
  return HARMONY_TONES[(harmonyToneMode - 1 + HARMONY_TONES.length) % HARMONY_TONES.length] || HARMONY_TONES[0];
}

function currentChordPattern() {
  return chordPatternAtTime(currentPlayTime()).pattern;
}

function currentDrumPattern() {
  return currentDrumCode ? patterns.byCode.get(currentDrumCode) : null;
}

function resolveDrumPatternCode(codes = []) {
  const candidates = Array.isArray(codes) ? codes.filter(Boolean) : [codes].filter(Boolean);
  for (const code of candidates) {
    if (patterns.byCode.has(code)) return code;
  }
  const styleDrums = song?.styleInfo?.midiPrograms?.drumCodes || [];
  const text = candidates.join(' ');
  const fallback = /_3\b/i.test(text) ? styleDrums[1] : /_2\b/i.test(text) ? styleDrums[0] : null;
  if (fallback && patterns.byCode.has(fallback)) return fallback;
  for (const code of styleDrums) {
    if (patterns.byCode.has(code)) return code;
  }
  const loose = candidates
    .flatMap(code => [...patterns.byCode.keys()].filter(k => k.toLowerCase() === String(code).toLowerCase()))
    .find(Boolean);
  return loose || null;
}

function chordNameForPressedRoot(root, cue) {
  const base = String(cue?.chord || root || '').trim();
  if (!base) return root;
  return base.replace(/^([A-G][#b]?)/i, root);
}


function chordNameForPerformedRoot(root, cue) {
  // 下方按键显示会跟随升降 Key；实际和弦音也必须按这个显示后的根音发声。
  const shiftedRoot = transposeRootName(root, userKeyShift);
  return transposeChordName(chordNameForPressedRoot(shiftedRoot, cue), songTransposeSemitones());
}

function songTransposeSemitones() {
  const explicit = Number(song?.styleInfo?.chordTransposeSemitones);
  if (Number.isFinite(explicit)) return explicit;
  const tone = String(song?.styleInfo?.tone || '').trim();
  if (!tone) return 0;
  const normalized = tone.startsWith('#') && tone.length >= 2
    ? `${tone[1].toUpperCase()}#`
    : tone[0]?.toUpperCase() + tone.slice(1);
  const pc = NOTE_PC[normalized];
  return Number.isFinite(pc) ? pc : 0;
}

function transposeRootName(root, semis) {
  const pc = NOTE_PC[root];
  if (!Number.isFinite(pc)) return root;
  return PC_NOTE_SHARP[(pc + semis + 120) % 12];
}

function transposeChordName(chordName, semis = songPlaybackTransposeSemitones()) {
  if (!semis) return chordName;
  return String(chordName || '').replace(/^([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?$/, (_, root, rest, bass) => {
    const transposedRoot = transposeRootName(root, semis);
    const transposedBass = bass ? `/${transposeRootName(bass, semis)}` : '';
    return `${transposedRoot}${rest || ''}${transposedBass}`;
  });
}

function presetForStyleCode(code, label) {
  const c = String(code || '').trim();
  if (/^PianoStudio/i.test(c)) return { label, code: c, name: 'Salamander Grand Piano', localPiano: true, gain: 0.42 };
  if (/^GS_3$/i.test(c)) return { label, code: c, name: 'acoustic_guitar_steel', gain: 0.78 };
  if (/^GS_1$/i.test(c)) return { label, code: c, name: 'FreePats Spanish Classical Guitar', freepatsGuitar: true, gain: 0.9 };
  if (/electric|eg|ged|gec/i.test(c)) return { label, code: c, name: 'electric_guitar_clean', gain: 0.64 };
  if (/drum|chap/i.test(c)) return { label, code: c, name: 'synth_drum', gain: 0.74, drum: true };
  return { label, code: c || label, name: 'acoustic_guitar_steel', gain: 0.70 };
}

function refreshHarmonyTonesFromStyle(styleInfo) {
  const programCodes = (styleInfo?.midiPrograms?.chordPrograms || [])
    .map(c => c?.code)
    .filter(Boolean);
  const chordCodes = programCodes.length
    ? programCodes
    : (styleInfo?.midiPrograms?.chordCodes || styleInfo?.configPack?.chords?.map(c => c?.code) || []);
  const unique = [...new Set(chordCodes.filter(Boolean))]
    .slice(0, 2);
  if (unique.length >= 2) {
    HARMONY_TONES = unique.map((code, i) => presetForStyleCode(code, i === 0 ? 'A' : 'B'));
    harmonyToneMode = Math.min(Math.max(1, harmonyToneMode), HARMONY_TONES.length);
    updateToneButton();
  }
  currentDrumCode = styleInfo?.midiPrograms?.drumCodes?.[0]
    || styleInfo?.configPack?.drums?.[0]?.code
    || null;
}

function rootFromChord(text) {
  const m = String(text || '').trim().match(/^([A-G])/i);
  return m ? m[1].toUpperCase() : null;
}

function parseChordInfo(chordName) {
  const clean = String(chordName || '').trim();
  const m = clean.match(/^([A-G])([#b]?)(.*?)(?:\/([A-G][#b]?))?$/);
  if (!m) {
    return {
      rootName: 'C',
      rootPc: 0,
      bassPc: 0,
      intervals: [0, 4, 7],
      chordPcs: [0, 4, 7],
    };
  }
  const rootName = m[1] + (m[2] || '');
  const rootPc = NOTE_PC[rootName] ?? 0;
  const q = (m[3] || '').toLowerCase();
  let intervals = q.includes('dim') ? [0, 3, 6] : q.includes('aug') ? [0, 4, 8] : q.startsWith('m') && !q.startsWith('maj') ? [0, 3, 7] : [0, 4, 7];
  if (q.includes('sus2')) intervals = [0, 2, 7];
  if (q.includes('sus4') || q.includes('sus')) intervals = [0, 5, 7];
  if (q.includes('6')) intervals.push(9);
  if (q.includes('maj7')) intervals.push(11);
  else if (q.includes('7')) intervals.push(10);
  if (q.includes('9')) intervals.push(14);
  const bassPc = m[4] && NOTE_PC[m[4]] !== undefined ? NOTE_PC[m[4]] : rootPc;
  const chordPcs = intervals.map(i => (rootPc + i) % 12);
  return { rootName, rootPc, bassPc, intervals, chordPcs };
}

function parseChordNotes(chordName) {
  const info = parseChordInfo(chordName);
  const { rootPc, bassPc, intervals } = info;
  const rootBase = 48 + rootPc; // C3-ish
  const notes = intervals.map(i => rootBase + i);
  if (bassPc !== rootPc) notes.unshift(36 + bassPc);
  return [...new Set(notes)].map(n => {
    while (n < 45) n += 12;
    while (n > 76) n -= 12;
    return n;
  });
}


function warmHarmonyMidiSet(maxCues = 96) {
  const set = new Set();
  const roots = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const active = chordAtTime(currentPlayTime()) || song?.chordCues?.[0] || null;
  const pattern = currentChordPattern();
  for (const root of roots) {
    const chord = chordNameForPerformedRoot(root, active || { chord: root, root });
    parseChordNotes(chord).forEach(n => set.add(n));
    if (pattern?.notes?.length) {
      pattern.notes.slice(0, 20).forEach(n => set.add(patternPitchToChordMidi(n.pitch, chord)));
    }
  }
  (song?.chordCues || []).slice(0, maxCues).forEach(cue => {
    parseChordNotes(transposeChordName(cue.chord)).forEach(n => set.add(n));
  });
  if (!set.size) [48, 52, 55, 60, 64, 67, 72].forEach(n => set.add(n));
  return [...set];
}

function warmFreepatsForSong() {
  ensureAudio();
  const regions = new Map();
  warmHarmonyMidiSet().forEach(midi => {
    const region = freepatsRegionFor(midi);
    regions.set(region.sample, region);
  });
  return Promise.all([...regions.values()].map(region => getFreepatsBuffer(region))).catch(err => {
    console.warn('FreePats warmup failed:', err);
  });
}

function warmSoundfontPreset(preset) {
  ensureAudio();
  // 只加载 SoundFont，不发任何试音。之前 0.0001 gain 在部分移动浏览器仍可能听见，
  // 所以倒计时 321 期间会莫名响一声。
  return getSoundfontInstrument(preset);
}

function warmHarmonyPreset(preset) {
  if (!preset) return Promise.resolve();
  ensureAudio();
  if (preset.freepatsGuitar) return warmFreepatsForSong();
  if (preset.localPiano) {
    if (window.Tone) Promise.resolve(Tone.start()).catch(() => {});
    return Promise.resolve();
  }
  return warmSoundfontPreset(preset);
}

function warmHarmonyTones(all = false) {
  const presets = all ? HARMONY_TONES : [currentHarmonyPreset()];
  return Promise.allSettled(presets.map(preset => warmHarmonyPreset(preset))).then(results => {
    results.forEach((res, i) => {
      if (res.status === 'rejected') console.warn('Harmony tone warmup failed:', presets[i]?.code || presets[i]?.name, res.reason);
    });
    return results;
  });
}

function patternPitchToChordMidi(pitch, chordName) {
  // LiberLive chord pattern pitch is a template index, not an absolute MIDI note.
  // Guitar templates commonly use 24/26/31..36; piano templates use C-major
  // reference notes 48/52/55/60/64/67/72. Map those template degrees to the
  // current chord symbol while preserving octave/register and slash bass.
  const info = parseChordInfo(chordName);
  const rootLow = nearestMidiForPc(info.rootPc, 48);
  const rootMid = nearestMidiForPc(info.rootPc, 60);
  const bassLow = nearestMidiForPc(info.bassPc, 40);
  const thirdPc = info.chordPcs[1] ?? info.rootPc;
  const fifthPc = info.chordPcs[2] ?? info.rootPc;
  const seventhPc = info.chordPcs[3] ?? info.rootPc;
  const degree = (pc, around) => clampHarmonyMidi(nearestMidiForPc(pc, around));
  const p = Math.round(Number(pitch) || 0);
  const guitarMap = {
    24: degree(info.bassPc, 40),       // slash bass / low bass
    26: degree(fifthPc, 43),           // alternate bass, often fifth
    31: degree(info.rootPc, 48),       // root
    32: degree(thirdPc, rootLow + 4),  // 3rd / sus tone
    33: degree(fifthPc, rootLow + 7),  // 5th
    34: degree(info.rootPc, 60),       // upper root
    35: degree(thirdPc, rootMid + 4),  // upper 3rd
    36: degree(fifthPc, rootMid + 7),  // upper 5th
  };
  if (guitarMap[p] !== undefined) return guitarMap[p];
  const cMajorTemplate = {
    43: degree(fifthPc, 43),
    48: degree(info.rootPc, 48),
    52: degree(thirdPc, 52),
    55: degree(fifthPc, 55),
    60: degree(info.rootPc, 60),
    64: degree(thirdPc, 64),
    67: degree(fifthPc, 67),
    72: degree(info.rootPc, 72),
  };
  if (cMajorTemplate[p] !== undefined) return cMajorTemplate[p];
  if (p === 7) return bassLow;
  if (p === 8) return degree(fifthPc, 43);
  if (p === 9) return degree(seventhPc, 46);
  return parseChordNotes(chordName)[Math.abs(p) % parseChordNotes(chordName).length] || rootMid;
}

function nearestMidiForPc(pc, around) {
  let best = pc + 12 * Math.round((around - pc) / 12);
  while (best < 40) best += 12;
  while (best > 84) best -= 12;
  return best;
}

function clampHarmonyMidi(n) {
  while (n < 40) n += 12;
  while (n > 76) n -= 12;
  return n;
}

function chordAtTime(time) {
  const cues = song?.chordCues || [];
  if (!cues.length) return null;
  let current = cues[0];
  for (const cue of cues) {
    if (cue.time > time) break;
    current = cue;
  }
  return current;
}

function extractStyleInfo(noteTracks) {
  const styleText = noteTracks.flatMap(t => t.texts || []).find(e => String(e.text).startsWith('LLSTYLE:'))?.text;
  if (!styleText) return null;
  try { return JSON.parse(styleText.slice('LLSTYLE:'.length)); }
  catch (err) { console.warn('Invalid LLSTYLE', err); return null; }
}

function extractDrumEvents(noteTracks) {
  return noteTracks.flatMap(t => t.texts || [])
    .filter(e => String(e.text || '').startsWith('LLDRUM:'))
    .map(e => {
      try {
        const data = JSON.parse(String(e.text).slice('LLDRUM:'.length));
        return {
          time: e.time,
          switchType: Number(data.switchType || 0),
          drumCodes: data.drumCodes || [],
          raw: data,
        };
      } catch (err) {
        console.warn('Invalid LLDRUM', err);
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);
}

function extractPickEvents(noteTracks) {
  return noteTracks.flatMap(t => t.texts || [])
    .filter(e => String(e.text || '').startsWith('LLEXT:'))
    .map(e => {
      try {
        const data = JSON.parse(String(e.text).slice('LLEXT:'.length));
        if (String(data.type) !== '7') return null;
        return {
          time: e.time,
          pickType: Number(data.pickType ?? data.pick ?? 0),
          pickAction: Number(data.pickAction ?? data.action ?? 1),
          raw: data,
        };
      } catch (err) {
        console.warn('Invalid LLEXT type=7', err);
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);
}

function chordPatternCodes() {
  const style = song?.styleInfo || {};
  const midi = style.midiPrograms || {};
  const top = style.topLevel || {};
  const pack = style.configPack || {};
  const codes = [
    top.rhythmicPatternA,
    top.rhythmicPatternB,
    ...(midi.chordCodes || []),
    ...(pack.chords || []).map(c => c?.code),
  ].filter(Boolean);
  const unique = [...new Set(codes)];
  return [unique[0] || HARMONY_TONES[0]?.code, unique[1] || HARMONY_TONES[1]?.code || unique[0]].filter(Boolean);
}

function pickSlotFromType(pickType) {
  // C2 的 type=7：0 通常为 A；部分曲谱用 1/2 指向 B。
  return Number(pickType) === 0 ? 0 : 1;
}

function chordPatternSlotAtTime(time = currentPlayTime()) {
  const userSlot = Math.max(0, harmonyToneMode - 1);
  // 默认照 MIDI 的 LLEXT type=7 事件走；用户切 A/B 时，不全局强制，
  // 而是在当前时间插入一个本地 type=7 事件，直到下一次 MIDI/用户事件覆盖。
  const baseEvents = (song?.pickEvents || []).map((ev, i) => ({ ...ev, _order: i * 2 }));
  const manualEvents = userPickEvents.map((ev, i) => ({ ...ev, _order: i * 2 + 1 }));
  const events = [...baseEvents, ...manualEvents].sort((a, b) => (a.time - b.time) || (a._order - b._order));
  let slot = Number(song?.styleInfo?.midiPrograms?.chordDefaultIndex);
  if (!Number.isFinite(slot)) slot = userSlot;
  for (const ev of events) {
    if (ev.time > time + 0.001) break;
    if (ev.pickAction === 0) continue;
    slot = pickSlotFromType(ev.pickType);
  }
  return Math.max(0, Math.min(1, slot));
}

function insertUserPickEvent(slot, time = currentPlayTime()) {
  const pickType = slot <= 0 ? 0 : 2;
  const eventTime = Math.max(0, Number(time) || 0);
  // 同一瞬间快速切换时改写最后一个本地事件，不堆叠。
  const last = userPickEvents[userPickEvents.length - 1];
  if (last && Math.abs(last.time - eventTime) < 0.08) {
    last.pickType = pickType;
    last.pickAction = 1;
    last.time = eventTime;
  } else {
    userPickEvents.push({ time: eventTime, pickType, pickAction: 1, manual: true });
  }
  userPickEvents.sort((a, b) => a.time - b.time);
}

function chordPatternAtTime(time = currentPlayTime()) {
  const codes = chordPatternCodes();
  const slot = chordPatternSlotAtTime(time);
  const code = codes[slot] || codes[0] || currentHarmonyPreset()?.code;
  return { slot, code, pattern: code ? patterns.byCode.get(code) : null };
}

function nextChordCueTimeAfter(time) {
  const next = (song?.chordCues || []).find(c => c.time > time + 0.04);
  return next?.time ?? Math.min((song?.duration || time + 4), time + 4);
}

function nextPickEventTimeAfter(time) {
  const next = (song?.pickEvents || []).find(e => e.time > time + 0.04);
  return next?.time ?? Infinity;
}

function patternWindowNotes(pattern, fromTime, endTime) {
  if (!pattern?.notes?.length) return [];
  const beat = beatMs() / 1000;
  const barBeats = patternBeats(pattern);
  const barSec = Math.max(0.001, barBeats * beat);
  const out = [];
  const firstBar = Math.floor(fromTime / barSec) - 1;
  const lastBar = Math.ceil(endTime / barSec) + 1;
  for (let bar = firstBar; bar <= lastBar; bar++) {
    const barStart = bar * barSec;
    for (const n of pattern.notes) {
      const t = barStart + Number(n.beat || 0) * beat;
      if (t < fromTime - 0.012 || t >= endTime - 0.001) continue;
      out.push({ note: n, time: t });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

function patternPhraseForCue(pattern, cueTime, now) {
  if (!pattern?.notes?.length) return [];
  const beat = beatMs() / 1000;
  const elapsed = Math.max(0, now - cueTime);
  const events = pattern.notes
    .map(n => ({
      note: n,
      phase: Math.max(0, Number(n.beat || 0) * beat),
    }))
    .sort((a, b) => a.phase - b.phase);
  if (!events.length) return [];

  // 分解和弦以当前 chord cue 为起点：自动到点时 beat0 立刻响。
  // 如果玩家按慢了，已经过去的 pattern 音不慢慢补，
  // 从下一颗/当前颗剩余音开始并把第一颗对齐到按下瞬间，后面仍保留 pattern 的 beat 间距。
  let remaining = events.filter(e => {
    const dur = Math.max(0.05, Number(e.note.duration || 0.35) * beat);
    return e.phase + dur >= elapsed - 0.018;
  });
  if (!remaining.length) remaining = events;
  const basePhase = Math.max(elapsed, remaining[0].phase);
  return remaining.map(e => ({
    note: e.note,
    offset: Math.max(0, e.phase - basePhase),
  }));
}

function fitPhraseToNextCue(events, beatSec, cueTime, now, baseScale = 1) {
  if (!events?.length) return baseScale;
  const nextTime = nextChordCueTimeAfter(cueTime);
  if (!Number.isFinite(nextTime) || nextTime <= now + 0.08) return baseScale;
  const naturalEnd = events.reduce((max, { note: n, offset }) => {
    const dur = Math.max(0.05, Number(n.duration || 0.35) * beatSec);
    return Math.max(max, Number(offset || 0) + dur);
  }, 0.001);
  const available = Math.max(0.12, nextTime - now - 0.018);
  // 只在按慢/剩余时间不足时加速追赶；不拉长，避免声音变慢变散。
  return naturalEnd > available ? Math.max(0.35, Math.min(baseScale, available / naturalEnd)) : baseScale;
}

function currentStyleCode() {
  return song?.styleInfo?.configPack?.chords?.find(c => c.pickType === 1)?.code
    || song?.styleInfo?.topLevel?.rhythmicPatternB
    || song?.styleInfo?.configPack?.chords?.[0]?.code
    || song?.styleInfo?.topLevel?.rhythmicPatternA
    || 'default';
}

function beatMs() {
  const bpm = Number(song?.styleInfo?.tempo) || 75;
  return 60000 / bpm;
}

function patternBeats(pattern) {
  const beat = String(pattern?.beat || song?.styleInfo?.beat || '4/4');
  const n = Number(beat.split('/')[0]);
  return Number.isFinite(n) && n > 0 ? n : 4;
}

function pcOfRoot(root) {
  return NOTE_PC[root] ?? NOTE_PC[String(root || '').match(/^([A-G][#b]?)/)?.[1]] ?? 0;
}

function transposeMidi(midi, semitone) {
  let n = midi + semitone;
  while (n < 45) n += 12;
  while (n > 76) n -= 12;
  return n;
}

function track2SliceForCue(cue) {
  if (!song?.accompanimentTrack?.notes?.length || !cue) return [];
  const cues = song.chordCues || [];
  const idx = Math.max(0, cues.indexOf(cue));
  const start = cue.time;
  const end = cues[idx + 1]?.time ?? start + beatMs() / 1000 * 2;
  return song.accompanimentTrack.notes
    .filter(n => n.time >= start - 0.001 && n.time < end - 0.001)
    .slice(0, 32);
}

class Reader {
  constructor(buf) { this.dv = new DataView(buf); this.u8 = new Uint8Array(buf); this.p = 0; }
  str(n) { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8[this.p++]); return s; }
  u16() { const v = this.dv.getUint16(this.p); this.p += 2; return v; }
  u32() { const v = this.dv.getUint32(this.p); this.p += 4; return v; }
  u8v() { return this.u8[this.p++]; }
  bytes(n) { const b = this.u8.slice(this.p, this.p + n); this.p += n; return b; }
  vlq() { let v = 0, b; do { b = this.u8v(); v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; }
}
function findChunk(u8, start, marker) {
  const codes = [...marker].map(c => c.charCodeAt(0));
  for (let i = Math.max(0, start); i <= u8.length - codes.length; i++) {
    let ok = true;
    for (let j = 0; j < codes.length; j++) {
      if (u8[i + j] !== codes[j]) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
}
function parseMidi(arrayBuffer) {
  const r = new Reader(arrayBuffer);
  if (r.str(4) !== 'MThd') throw new Error('不是标准 MIDI 文件');
  const headerLen = r.u32();
  const format = r.u16();
  const trackCount = r.u16();
  const division = r.u16();
  if (headerLen > 6) r.bytes(headerLen - 6);
  const ppq = division & 0x8000 ? 480 : division;
  const tempoEvents = [{ tick: 0, usPerQuarter: 500000 }];
  const tracks = [];

  for (let t = 0; t < trackCount; t++) {
    const marker = r.str(4);
    if (marker !== 'MTrk') {
      const found = findChunk(r.u8, r.p - 4, 'MTrk');
      if (found < 0) throw new Error(`第 ${t + 1} 轨缺少 MTrk`);
      r.p = found + 4;
    }
    const end = r.p + r.u32();
    let tick = 0, running = 0;
    const events = [];
    const texts = [];
    while (r.p < end) {
      tick += r.vlq();
      let status = r.u8v();
      if (status < 0x80) { r.p--; status = running; } else if (status < 0xf0) { running = status; }
      if (status === 0xff) {
        const type = r.u8v(); const len = r.vlq(); const data = r.bytes(len);
        if (type === 0x51 && len === 3) tempoEvents.push({ tick, usPerQuarter: (data[0] << 16) | (data[1] << 8) | data[2] });
        if (type === 0x01 || type === 0x03 || type === 0x05 || type === 0x06) {
          texts.push({ tick, type, text: decodeText(data) });
        }
        if (type === 0x2f) break;
      } else if (status === 0xf0 || status === 0xf7) {
        r.bytes(r.vlq());
      } else {
        const cmd = status & 0xf0, channel = status & 0x0f;
        const a = r.u8v();
        const b = (cmd === 0xc0 || cmd === 0xd0) ? 0 : r.u8v();
        if (cmd === 0x90 && b > 0) events.push({ tick, type: 'on', note: a, velocity: b / 127, channel, track: t });
        else if (cmd === 0x80 || (cmd === 0x90 && b === 0)) events.push({ tick, type: 'off', note: a, velocity: 0, channel, track: t });
      }
    }
    r.p = end;
    tracks.push({ events, texts });
  }
  tempoEvents.sort((a,b) => a.tick - b.tick);
  function tickToSec(tick) {
    let sec = 0, lastTick = 0, tempo = 500000;
    for (const te of tempoEvents) {
      if (te.tick > tick) break;
      sec += (te.tick - lastTick) * tempo / ppq / 1_000_000;
      lastTick = te.tick; tempo = te.usPerQuarter;
    }
    sec += (tick - lastTick) * tempo / ppq / 1_000_000;
    return sec;
  }
  function notesWithDurations(events) {
    const timed = events.map(e => ({ ...e, time: tickToSec(e.tick) }));
    const open = new Map();
    const notes = [];
    for (const e of timed) {
      const key = `${e.channel}:${e.note}`;
      if (e.type === 'on') {
        if (!open.has(key)) open.set(key, []);
        open.get(key).push(e);
      } else if (e.type === 'off') {
        const stack = open.get(key);
        const on = stack?.shift();
        if (on) notes.push({ ...on, duration: Math.max(0.08, e.time - on.time) });
      }
    }
    for (const stack of open.values()) {
      for (const on of stack) notes.push({ ...on, duration: 0.45 });
    }
    return notes.sort((a, b) => a.time - b.time || a.note - b.note);
  }
  const noteTracks = tracks.map((track, i) => ({
    number: i,
    notes: notesWithDurations(track.events),
    texts: track.texts.map(e => ({ ...e, time: tickToSec(e.tick) })),
  }));
  const trackName = (t) => (t.texts || []).find(e => e.type === 0x03)?.text || '';
  const byName = (name) => noteTracks.find(t => trackName(t).toLowerCase() === name.toLowerCase());
  const melodyTrack = byName('Lead') || noteTracks[1] || { number: 1, notes: [] };
  const accompanimentTrack = byName('Accompaniment') || noteTracks[2] || { number: 2, notes: [] };
  const chordTrack = byName('Chord Names') || noteTracks.find(t => (t.texts || []).some(e => /^[A-G][#b]?(m|maj|dim|aug|sus|add|\/|\d|$)/i.test(String(e.text || '').trim()))) || { number: 4, notes: [], texts: [] };
  const chordCues = chordTrack.texts
    .filter(e => e.type === 0x01)
    .map(e => ({ time: e.time, chord: e.text, root: rootFromChord(e.text) }))
    .filter(e => e.root && NATURAL_TO_MIDI[e.root]);
  const styleInfo = extractStyleInfo(noteTracks);
  const drumEvents = extractDrumEvents(noteTracks);
  const pickEvents = extractPickEvents(noteTracks);
  const duration = melodyTrack.notes.at(-1)?.time || 0;
  return { format, trackCount, ppq, noteTracks, melodyTrack, accompanimentTrack, chordCues, styleInfo, drumEvents, pickEvents, duration };
}

function decodeText(bytes) {
  try { return new TextDecoder('utf-8').decode(bytes); }
  catch { return Array.from(bytes).map(b => String.fromCharCode(b)).join(''); }
}

function cleanLyricText(text) {
  return String(text || '')
    .replace(/\r?\n/g, '')
    .replace(/[｜|]/g, '')
    .replace(/^\/+/, '')
    .trim();
}

function lyricPiecesFromEvent(e) {
  const raw = String(e.text || '');
  const pieces = [];
  let buf = '';
  for (const ch of raw) {
    if (ch === '\n' || ch === '\r') {
      if (buf) pieces.push({ time: e.time, text: buf.replace(/[｜|]/g, '').replace(/^\/+/, ''), breakAfter: false });
      pieces.push({ time: e.time, text: '', breakAfter: true });
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf) pieces.push({ time: e.time, text: buf.replace(/[｜|]/g, '').replace(/^\/+/, ''), breakAfter: false });
  return pieces;
}

function escapeHtml(text) {
  return String(text || '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function noteClassForRoot(root) {
  const clean = String(root || 'C').trim();
  const displayRoot = transposeRootName(clean.match(/^([A-G][#b]?)/i)?.[1] || clean[0] || 'C', userKeyShift);
  return `note-${String(displayRoot || 'C').trim()[0]?.toLowerCase() || 'c'}`;
}

function lyricTokenHtml(token, blue = false, index = 0) {
  const text = typeof token === 'string' ? token : token?.text;
  const cls = noteClassForRoot(token?.root);
  const now = currentPlayTime();
  const cueStart = Number.isFinite(token?.cueStartTime) ? token.cueStartTime : Number.isFinite(token?.time) ? token.time - 0.08 : null;
  const cueEnd = Number.isFinite(token?.cueEndTime) ? token.cueEndTime : Number.isFinite(token?.time) ? token.time + 0.18 : null;
  const isCueNow = token?.root && cueStart != null && cueEnd != null && now >= cueStart && now <= cueEnd;
  const isCueSoon = token?.root && cueStart != null && now < cueStart && cueStart - now <= 1.0;
  const cueClass = `${isCueNow ? ' cue-now' : ''}${isCueSoon ? ' cue-soon' : ''}`;
  const data = ` data-kidx="${index}"`;
  if (/\s/.test(text || '')) {
    // 空格也当成一个歌词字：底层/拉幕层都画同一个色块，随卡拉 OK 进度从左到右扫过去。
    return `<span class="lyric-block stable-block ${cls || 'note-c'}${blue ? ' blue' : ''}${cueClass}"${data}></span>`;
  }
  const keyClass = token?.root ? ` lyric-key ${cls}${blue ? ' blue' : ''}${cueClass}` : '';
  return `<span class="lyric-char${keyClass}"${data}>${escapeHtml(text || '')}</span>`;
}

function chordRootNearTime(time, threshold = 0.32) {
  const cue = (song?.chordCues || []).find(c => Math.abs(c.time - time) <= threshold);
  return cue?.root || '';
}

function tokensForLine(lineOrText) {
  if (lineOrText && typeof lineOrText === 'object') {
    if (lineOrText.events?.length) {
      let consecutiveBlankBlocks = 0;
      return lineOrText.events
        .map(e => ({ text: e.text, time: e.time, root: e.root, chordSpace: !!e.chordSpace, cueStartTime: e.cueStartTime, cueEndTime: e.cueEndTime }))
        .filter(t => {
          if (!t.chordSpace) { consecutiveBlankBlocks = 0; return true; }
          consecutiveBlankBlocks += 1;
          return consecutiveBlankBlocks <= 10;
        });
    }
    return [...String(lineOrText.text || '')].map(ch => ({ text: ch, time: lineOrText.start }));
  }
  return [...String(lineOrText || '')].map(ch => ({ text: ch }));
}

function setKaraokeLine(el, lineOrText, progress = 0, active = false) {
  el.classList.toggle('active', active);
  el.classList.toggle('next', !active);
  el.style.setProperty('--progress', active ? `${progress.toFixed(1)}%` : '0%');
  const tokens = tokensForLine(lineOrText);
  const baseHtml = tokens.map((t, i) => lyricTokenHtml(t, false, i)).join('');
  const blueHtml = tokens.map((t, i) => lyricTokenHtml(t, true, i)).join('');
  el.innerHTML = baseHtml
    ? `<span class="lyric-wrap"><span class="lyric-base">${baseHtml}</span><span class="lyric-blue" aria-hidden="true">${blueHtml}</span></span>`
    : '';
}

function alignLineEventsToText(line, rawEvents) {
  const chars = [...(line.text || '')];
  const events = [...rawEvents].sort((a, b) => a.time - b.time);
  const out = [];
  let eventIndex = 0;
  let lastTime = line.start;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (/\s/.test(ch)) {
      let runEnd = i;
      while (runEnd < chars.length && /\s/.test(chars[runEnd])) runEnd++;
      const nextEvent = events[eventIndex];
      const nextTime = nextEvent?.time ?? line.end;
      const runLen = runEnd - i;
      for (let j = 0; j < runLen; j++) {
        const t = lastTime + (nextTime - lastTime) * ((j + 1) / (runLen + 1));
        const time = Math.max(line.start, Math.min(line.end, t));
        out.push({ time, text: ' ', root: chordAtTime(time)?.root, virtual: true });
      }
      i = runEnd - 1;
      continue;
    }
    const ev = events[eventIndex++];
    const time = ev?.time ?? Math.min(line.end, lastTime + 0.15);
    out.push({ time, text: ch, root: '', virtual: !ev });
    lastTime = time;
  }
  return out;
}

function buildLyricLines() {
  const beatSec = beatMs() / 1000;
  const explicitLines = (song?.noteTracks || []).flatMap(t => t.texts || [])
    .filter(e => String(e.text || '').startsWith('LLLYRIC_LINE:'))
    .map(e => {
      try {
        const data = JSON.parse(String(e.text).slice('LLLYRIC_LINE:'.length));
        const startBeat = Number(data.time);
        const endBeat = Number(data.endTime);
        const start = Number.isFinite(startBeat) ? startBeat * beatSec : e.time;
        const end = Number.isFinite(endBeat) ? endBeat * beatSec : start + 2;
        return {
          start,
          end,
          text: String(data.text || ''),
          events: [],
          paragraphType: data.paragraphType,
        };
      } catch (err) {
        console.warn('Invalid LLLYRIC_LINE', err);
        return null;
      }
    })
    .filter(line => line && line.text)
    .sort((a, b) => a.start - b.start);
  if (explicitLines.length) {
    const lyricEvents = (song?.noteTracks?.find(t => (t.texts || []).some(e => e.type === 0x03 && e.text === 'Lyrics'))?.texts || song?.noteTracks?.[3]?.texts || [])
      .filter(e => e.type === 0x05 || e.type === 0x01)
      .flatMap(lyricPiecesFromEvent)
      .filter(e => e.text)
      .sort((a, b) => a.time - b.time);
    lyricLines = explicitLines.map((line, i) => {
      const end = Math.max(line.end, explicitLines[i + 1]?.start ?? line.end);
      const raw = lyricEvents.filter(e => e.time >= line.start - 0.001 && e.time < end - 0.001);
      const fullLine = { ...line, end };
      return { ...fullLine, events: alignLineEventsToText(fullLine, raw) };
    });
    const firstStart = lyricLines[0]?.start ?? 0;
    const preludeCues = (song?.chordCues || []).filter(c => c.time < firstStart - 0.001);
    if (preludeCues.length) {
      const preludeLines = [];
      for (let i = 0; i < preludeCues.length; i += 10) {
        const chunk = preludeCues.slice(i, i + 10);
        preludeLines.push({
          start: chunk[0]?.time ?? 0,
          end: preludeCues[i + 10]?.time ?? firstStart,
          text: ' '.repeat(chunk.length),
          events: chunk.map(c => ({ time: c.time, text: ' ', root: c.root, virtual: true, chordSpace: true })),
          prelude: true,
        });
      }
      lyricLines.unshift(...preludeLines);
    }
    return;
  }
  const rawEvents = (song?.noteTracks?.[3]?.texts || [])
    .filter(e => e.type === 0x05 || e.type === 0x01)
    .flatMap(lyricPiecesFromEvent)
    .filter(e => (e.text || e.breakAfter) && !/^track\s*name/i.test(e.text))
    .sort((a, b) => a.time - b.time);
  const hasExplicitLineBreaks = rawEvents.some(e => e.breakAfter);
  const events = rawEvents.filter(e => e.text || e.breakAfter);
  const lines = [];
  let current = null;
  const flush = () => {
    if (!current || !current.text.trim()) return;
    current.end = current.events.at(-1)?.time ?? current.start;
    lines.push(current);
  };
  for (const ev of events) {
    if (ev.breakAfter) {
      flush();
      current = null;
      continue;
    }
    const last = current?.events?.at(-1);
    const hardBreak = /[。！？!?；;]$/.test(last?.text || '');
    const commaBreak = /[，、,]$/.test(last?.text || '') && current?.text?.length >= 8;
    const longGap = !hasExplicitLineBreaks && last && ev.time - last.time > 0.85 && current?.text?.length >= 4;
    const tooLong = !hasExplicitLineBreaks && current && current.text.length >= 11 && (last ? ev.time - last.time > 0.24 : false);
    if (!current || hardBreak || commaBreak || longGap || tooLong) {
      flush();
      current = { start: ev.time, end: ev.time + 1.8, text: '', events: [] };
    }
    current.text += ev.text;
    current.events.push(ev);
  }
  flush();
  lyricLines = lines.map((line, i) => ({
    ...line,
    end: Math.max(line.end + 0.65, lines[i + 1]?.start ?? song?.duration ?? line.end + 2),
  }));
}

function lyricEventStart(e) {
  return Number.isFinite(e?.cueStartTime) ? e.cueStartTime : e?.time;
}

function lyricEventEnd(e, fallback) {
  return Number.isFinite(e?.cueEndTime) ? e.cueEndTime : fallback;
}

function lineProgressAt(line, now) {
  const events = line?.events || [];
  const eventCharCount = (e) => Math.max(1, [...(e?.text || '')].length);
  const totalChars = Math.max(1, events.reduce((sum, e) => sum + eventCharCount(e), 0));
  const eventStart = lyricEventStart;
  const eventEnd = lyricEventEnd;
  if (!events.length || now < eventStart(events[0])) return 0;
  for (let i = 0; i < events.length; i++) {
    const cur = events[i];
    const next = events[i + 1];
    const curStart = eventStart(cur);
    const nextStart = next ? eventStart(next) : null;
    const charsBefore = events.slice(0, i).reduce((sum, e) => sum + eventCharCount(e), 0);
    const curChars = eventCharCount(cur);
    const prevStart = i > 0 ? eventStart(events[i - 1]) : curStart - 0.42;
    const prevGap = Math.max(0.16, curStart - prevStart);
    // 绑定到和弦 cue 的字：65% 进入时开始扫到这个字，75% 后扫完。
    // 普通字：仍按歌词相邻时间点扫。
    const naturalEnd = nextStart ?? (curStart + Math.min(0.72, Math.max(0.26, prevGap)));
    const end = Math.min(line.end ?? naturalEnd, eventEnd(cur, naturalEnd));
    if (!next || now < nextStart) {
      const frac = Math.max(0, Math.min(1, (now - curStart) / Math.max(0.08, end - curStart)));
      return Math.min(100, ((charsBefore + curChars * frac) / totalChars) * 100);
    }
  }
  return 100;
}

function syncActiveKaraokeProgress(el, line, now) {
  const tokens = tokensForLine(line);
  const events = tokens;
  const base = el?.querySelector('.lyric-base');
  const wrap = el?.querySelector('.lyric-wrap');
  if (!base || !wrap || !tokens.length || !events.length) return;
  let currentIndex = -1;
  let frac = 0;
  for (let i = 0; i < events.length; i++) {
    const cur = events[i];
    const next = events[i + 1];
    const curStart = lyricEventStart(cur);
    const nextStart = next ? lyricEventStart(next) : null;
    const prevStart = i > 0 ? lyricEventStart(events[i - 1]) : curStart - 0.42;
    const prevGap = Math.max(0.16, curStart - prevStart);
    const naturalEnd = nextStart ?? (curStart + Math.min(0.72, Math.max(0.26, prevGap)));
    const end = Math.min(line.end ?? naturalEnd, lyricEventEnd(cur, naturalEnd));
    if (!next || now < nextStart) {
      currentIndex = i;
      frac = Math.max(0, Math.min(1, (now - curStart) / Math.max(0.08, end - curStart)));
      break;
    }
  }
  if (currentIndex < 0) return;
  const node = base.querySelector(`[data-kidx="${currentIndex}"]`);
  if (!node) return;
  const rr = wrap.getBoundingClientRect();
  const nr = node.getBoundingClientRect();
  const x = (nr.left - rr.left) + nr.width * frac;
  const pct = Math.max(0, Math.min(100, (x / Math.max(1, rr.width)) * 100));
  el.style.setProperty('--progress', `${pct.toFixed(2)}%`);
}

function lyricEventAt(time, maxHold = Infinity) {
  const events = lyricLines.flatMap(line => (line.events || []).map((ev, index) => ({ ...ev, line, index })))
    .sort((a, b) => a.time - b.time);
  if (!events.length) return null;
  for (let i = 0; i < events.length; i++) {
    const cur = events[i];
    const next = events[i + 1];
    const end = next?.time ?? (cur.line?.end ?? cur.time + 0.6);
    if (time >= cur.time && time < end && time - cur.time <= maxHold) return cur;
    if (time < cur.time) break;
  }
  return null;
}

function allLyricEvents() {
  return lyricLines.flatMap(line => (line.events || []).map((ev, index) => ({ ev, line, index })))
    .sort((a, b) => a.ev.time - b.ev.time);
}

function lyricLineForTime(time) {
  if (!lyricLines.length) return null;
  return lyricLines.find((line, i) => time >= line.start - 0.001 && time < (lyricLines[i + 1]?.start ?? line.end ?? Infinity) - 0.001)
    || lyricLines.find(line => time >= line.start - 0.001 && time < (line.end ?? Infinity) - 0.001)
    || null;
}

function lyricEventForChordCue(cue, maxDistance = 0.008) {
  const events = allLyricEvents().filter(x => String(x.ev.text || '').trim());
  if (!events.length || !cue) return null;
  let best = null;
  for (const item of events) {
    const d = Math.abs(item.ev.time - cue.time);
    // 只绑定“同一时间点/同一拍”的歌词字；有和弦但没字，就插入空格。
    // 这里的 8ms 只用于 MIDI tick/浮点转换误差，不用于抓附近歌词。
    if (d <= maxDistance && (!best || d < best.distance)) best = { ...item, distance: d };
  }
  return best;
}

function bindChordCuesToLyrics() {
  lyricLines.forEach(line => {
    line.events = (line.events || []).filter(ev => !ev.chordSpace);
    line.events.forEach(ev => {
      ev.root = '';
      ev.cueId = '';
      delete ev.cueStartTime;
      delete ev.cueEndTime;
    });
  });
  (song?.chordCues || []).forEach((cue, i) => {
    cue._lyricChar = '';
    cue._lyricEventTime = null;
    const id = `${i}-${cue.time}-${cue.chord}`;
    const hit = lyricEventForChordCue(cue);
    let ev = hit?.ev || null;
    if (!ev) {
      const line = lyricLineForTime(cue.time);
      if (!line) return;
      ev = { time: cue.time, text: ' ', root: cue.root, virtual: true, chordSpace: true };
      line.events.push(ev);
      line.events.sort((a, b) => a.time - b.time);
    } else {
      ev.root = cue.root;
    }
    ev.cueId = id;
    // 下方提示：65% = cue.time - 71ms，70% = cue.time，75% = cue.time + 71ms。
    // 歌词绑定字/空格也用这段窗口，保证视觉同步。
    ev.cueStartTime = Math.max(0, cue.time - (5 / 70));
    ev.cueEndTime = cue.time + (5 / 70);
    cue._lyricChar = String(ev.text || '').trim() ? ([...String(ev.text)].at(-1) || '') : '';
    cue._lyricIsBlank = !String(ev.text || '').trim();
    cue._lyricEventTime = ev.time;
  });
}

function lyricCharForCue(cue) {
  if (cue?._lyricChar) return cue._lyricChar;
  return '';
}

function cueLyricDisplayForCue(cue) {
  const ch = lyricCharForCue(cue);
  if (ch) return { text: ch, blank: false };
  if (cue?._lyricIsBlank) return { text: '■', blank: true };
  const fallback = lyricCharAt(cue?.time ?? currentPlayTime());
  return fallback ? { text: fallback, blank: false } : { text: '■', blank: true };
}

function spawnLyricGhost(box, lines) {
  // v74: 不再叠加旧字幕层，避免旧层盖住第一行；整组新字幕统一滚动。
}

function ensureKaraokeLines(maxLines = 12) {
  const box = document.querySelector('.karaoke');
  if (!box) return [];
  const status = box.querySelector('.karaoke-status');
  for (let i = 1; i <= maxLines; i++) {
    if (!$(`lyricLine${i}`)) {
      const div = document.createElement('div');
      div.id = `lyricLine${i}`;
      div.className = `karaoke-line ${i === 1 ? 'active' : 'next'}`;
      box.insertBefore(div, status || null);
    }
  }
  return Array.from({ length: maxLines }, (_, i) => $(`lyricLine${i + 1}`)).filter(Boolean);
}

function visibleLyricLineCount() {
  const box = document.querySelector('.karaoke');
  const h = box?.clientHeight || 280;
  const w = window.innerWidth || 390;
  const rowH = Math.max(30, Math.min(42, w * 0.090));
  return Math.max(7, Math.min(12, Math.floor((h - 18) / rowH)));
}

function updateLyrics() {
  const allLines = ensureKaraokeLines(12);
  const box = document.querySelector('.karaoke');
  const count = visibleLyricLineCount();
  const lines = allLines.slice(0, count);
  const l1 = lines[0];
  if (!lines.every(Boolean)) return;
  if (box) { box.style.setProperty('--lyric-lines', count); box.style.gridTemplateRows = `repeat(${count}, auto)`; }
  allLines.forEach((line, i) => { line.style.display = i < count ? '' : 'none'; });
  if (!lyricLines.length) {
    lines.forEach(l => setKaraokeLine(l, '', 0, false));
    return;
  }
  const now = currentPlayTime();
  let idx = lyricLines.findIndex((line, i) => now >= line.start && now < (lyricLines[i + 1]?.start ?? line.end));
  if (idx < 0) idx = now < lyricLines[0].start ? 0 : lyricLines.length - 1;
  const cur = lyricLines[idx];
  if (idx !== lastLyricIndex) {
    lastLyricIndex = idx;
    if (box) {
      box.classList.remove('roll');
      void box.offsetWidth;
      box.classList.add('roll');
      setTimeout(() => box.classList.remove('roll'), 360);
    }
  }
  const progress = lineProgressAt(cur, now);
  const activeSlot = Math.min(lines.length - 1, Math.max(0, Math.floor(lines.length * 0.62)));
  const startIdx = Math.max(0, Math.min(idx - activeSlot, Math.max(0, lyricLines.length - lines.length)));
  let activeEl = l1;
  for (let i = 0; i < lines.length; i++) {
    const lineIndex = startIdx + i;
    const active = lineIndex === idx;
    if (active) activeEl = lines[i];
    setKaraokeLine(lines[i], lyricLines[lineIndex] || '', active ? progress : 0, active);
  }
  syncActiveKaraokeProgress(activeEl, cur, now);
  if (playing) emitLyricParticles(activeEl, progress);
}

function lyricCharAt(time) {
  const ev = lyricEventAt(time, 0.72);
  return ev && String(ev.text).trim() ? [...ev.text].at(-1) : '';
}

function emitLyricParticles(line, progress) {
  const now = performance.now();
  if (now - lastLyricParticleAt < 95 || progress <= 0 || progress >= 99.5) return;
  lastLyricParticleAt = now;
  const r = line.getBoundingClientRect();
  const x = r.left + r.width * progress / 100;
  const y = r.top + r.height * (0.35 + Math.random() * 0.35);
  for (let i = 0; i < 4; i++) {
    const p = document.createElement('span');
    p.className = 'lyric-particle';
    const dx = (Math.random() * 42 - 12).toFixed(1) + 'px';
    const dy = (-10 - Math.random() * 34).toFixed(1) + 'px';
    p.style.left = `${x + Math.random() * 8 - 4}px`;
    p.style.top = `${y + Math.random() * 8 - 4}px`;
    p.style.setProperty('--dx', dx);
    p.style.setProperty('--dy', dy);
    p.style.setProperty('--rot', `${Math.random() * 260 - 130}deg`);
    p.style.setProperty('--size', `${2 + Math.random() * 4}px`);
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 700);
  }
}

async function loadDefaultMidi() {
  try {
    await loadPatternManifest();
    const res = await fetch(DEFAULT_MIDI, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = await res.arrayBuffer();
    song = await parseMidiWithWasm(buffer);
    const textParsed = parseMidi(buffer);
    song.noteTracks.forEach((track, i) => {
      if (textParsed.noteTracks[i]?.texts?.length) track.texts = textParsed.noteTracks[i].texts;
    });
    song.chordCues = textParsed.chordCues;
    // 文本事件轨是 LLSTYLE / LLDRUM / LLEXT / LLLYRIC_LINE 的权威来源，不能被 WASM 解析结果里的空字段覆盖。
    song.styleInfo = textParsed.styleInfo || song.styleInfo;
    song.drumEvents = extractDrumEvents(song.noteTracks);
    song.pickEvents = extractPickEvents(song.noteTracks);
    userPickEvents = [];
    if (initialPickSlot !== null) insertUserPickEvent(initialPickSlot, 0);
    const summary = song.noteTracks.map(t => `Track ${t.number}:${t.notes.length}`).join(' / ');
    setPill('midiStatus', `✅ MIDI 已加载：${song.trackCount} 轨 · WASM`, 'ok');
    setPill('trackStatus', `只播放 Track 1 主旋律 · ${song.melodyTrack.notes.length} 音 · ${summary}`, song.melodyTrack.notes.length ? 'ok' : 'warn');
    refreshHarmonyTonesFromStyle(song.styleInfo);
    buildLyricLines();
    bindChordCuesToLyrics();
    renderPlaybackForMelody();
    updateClock();
    updateLyrics();
    midiReady = true;
    return song;
  } catch (err) {
    console.warn(err);
    setPill('midiStatus', `⚠️ MIDI 加载失败：${err.message}`, 'warn');
    setPill('trackStatus', '音轨：-', 'warn');
    throw err;
  }
}
function scheduleFrom(offset = 0) {
  if (!song || !song.melodyTrack.notes.length) return;
  clearTimers();
  playing = true;
  updatePlayButton();
  playOffset = offset;
  playStartedAt = performance.now();
  if (melodyEnabled && playMode !== 'manual') {
    const notes = song.melodyTrack.notes.filter(e => e.time >= offset && shouldAutoPlayMelodyAt(e.time));
    for (const e of notes) {
      const delay = Math.max(0, (e.time - offset) * 1000);
      timers.push(setTimeout(() => playVisualNote(shiftedMidi(e.note), e.velocity, 'playback'), delay));
    }
  }
  scheduleDrumsFrom(offset);
  if (isAutoChordMode()) scheduleAutoHarmonyFrom(offset);
  else scheduleChordCues(offset);
  timers.push(setTimeout(finishPlayback, Math.max(0, (song.duration - offset) * 1000) + 900));
  clockTimer = setInterval(() => { updateClock(); updateLyrics(); }, 33);
  updateClock();
  updateLyrics();
  updatePlayButton();
}

function scheduleDrumsFrom(offset = 0) {
  if (drumMode === 'off') return;
  if (drumMode === 'auto') {
    if (song?.drumEvents?.length) return scheduleAutomatedDrumsFrom(offset);
    return;
  }
  const pattern = currentDrumPattern();
  if (!pattern?.notes?.length || !song?.duration) return;
  const beat = beatMs();
  const barBeats = patternBeats(pattern);
  const barSec = barBeats * beat / 1000;
  const firstBar = Math.max(0, Math.floor(offset / barSec) - 1);
  for (let bar = firstBar; bar * barSec <= song.duration + barSec; bar++) {
    const barStart = bar * barSec;
    for (const n of pattern.notes) {
      const t = barStart + Number(n.beat || 0) * beat / 1000;
      if (t < offset - 0.02 || t > song.duration + 0.5) continue;
      const delay = Math.max(0, (t - offset) * 1000);
      timers.push(setTimeout(() => playDrumPatternNote(n), delay));
    }
  }
}

function scheduleAutomatedDrumsFrom(offset = 0) {
  if (!song?.drumEvents?.length || !song?.duration) return;
  const events = song.drumEvents;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.switchType !== 1) continue;
    const end = events.slice(i + 1).find(e => e.switchType === 0 || resolveDrumPatternCode(e.drumCodes))?.time ?? song.duration;
    if (end <= offset - 0.02 || ev.time > song.duration + 0.5) continue;
    const code = resolveDrumPatternCode(ev.drumCodes);
    const pattern = code ? patterns.byCode.get(code) : null;
    if (!pattern?.notes?.length) {
      console.warn('No drum pattern for LLDRUM', ev.drumCodes);
      continue;
    }
    scheduleDrumPatternWindow(pattern, Math.max(offset, ev.time), ev.time, Math.min(end, song.duration), offset);
  }
}

function scheduleDrumPatternWindow(pattern, fromTime, anchorTime, endTime, offset) {
  const beat = beatMs();
  const barBeats = patternBeats(pattern);
  const barSec = barBeats * beat / 1000;
  const firstBar = Math.max(0, Math.floor((fromTime - anchorTime) / barSec) - 1);
  for (let bar = firstBar; anchorTime + bar * barSec <= endTime + barSec; bar++) {
    const barStart = anchorTime + bar * barSec;
    for (const n of pattern.notes) {
      const t = barStart + Number(n.beat || 0) * beat / 1000;
      if (t < fromTime - 0.02 || t >= endTime - 0.001 || t > song.duration + 0.5) continue;
      const delay = Math.max(0, (t - offset) * 1000);
      timers.push(setTimeout(() => playDrumPatternNote(n), delay));
    }
  }
}
function clearTimers() {
  clearCountdown();
  timers.forEach(clearTimeout); timers = [];
  cueTimers.forEach(clearTimeout); cueTimers = [];
  clearInterval(cueRuntimeTimer); cueRuntimeTimer = null;
  activeCue = null;
  clearHarmonyTimers();
  harmonyAutoTimers.forEach(clearTimeout);
  harmonyAutoTimers = [];
  manualMelodyTimers.forEach(clearTimeout);
  manualMelodyTimers = [];
  clearInterval(clockTimer); clockTimer = null;
  document.querySelectorAll('#manualKeyboard .cue, #manualKeyboard .due').forEach(k => k.classList.remove('cue', 'due'));
  document.querySelectorAll('#manualKeyboard .cue-lyric').forEach(el => { el.textContent = ''; });
  cueState.clear();
}


function scheduleAutoHarmonyFrom(offset = 0) {
  // 自动模式 = 半自动的自动按键版：先出现提示，到点自动按下并产生同样特效。
  if (!song?.chordCues?.length) return;
  nextCueIndex = song.chordCues.findIndex(c => c.time >= offset - 0.02);
  if (nextCueIndex < 0) nextCueIndex = song.chordCues.length;
  activeCue = null;
  cueRuntimeTimer = setInterval(updateCueRuntime, 40);
  updateCueRuntime();
}


function scheduleChordCues(offset = 0) {
  if (!song?.chordCues?.length) return;
  nextCueIndex = song.chordCues.findIndex(c => c.time >= offset - 0.02);
  if (nextCueIndex < 0) nextCueIndex = song.chordCues.length;
  activeCue = null;
  cueRuntimeTimer = setInterval(updateCueRuntime, 40);
  updateCueRuntime();
}

function startCue(midi, cue) {
  clearManualCueVisuals();
  document.querySelectorAll(`#manualKeyboard .key[data-midi="${midi}"]`).forEach(k => {
    const perfNow = performance.now();
    const due = playing ? playStartedAt + (cue.time - playOffset) * 1000 : perfNow + Math.max(0, (cue.time - currentPlayTime()) * 1000);
    cueState.set(k.dataset.root, { start: due - 1000, due, end: due + 1100, cueId: cue?._id });
    const lyric = k.querySelector('.cue-lyric');
    if (lyric) {
      const display = cueLyricDisplayForCue(cue);
      lyric.textContent = display.text;
      lyric.classList.toggle('blank', !!display.blank);
      lyric.dataset.cueId = cue?._id || '';
      delete lyric.dataset.floatShattered;
      lyric.classList.remove('shatter', 'hold', 'appear');
      void lyric.offsetWidth;
      lyric.classList.add('appear');
    }
    k.classList.remove('due', 'active', 'release');
    k.classList.remove('cue');
    void k.offsetWidth;
    k.classList.add('cue');
  });
}

function shatterCueLyricElement(el) {
  if (!el || !el.textContent || el.dataset.floatShattered === '1') return;
  el.dataset.floatShattered = '1';
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const clone = document.createElement('span');
  clone.className = `cue-float-shatter${el.classList.contains('blank') ? ' blank' : ''}`;
  clone.style.left = `${r.left + r.width / 2}px`;
  clone.style.top = `${r.top + r.height / 2}px`;
  clone.style.fontSize = cs.fontSize;
  const label = document.createElement('span');
  label.className = 'cue-float-label';
  label.textContent = el.textContent;
  clone.appendChild(label);
  const key = el.closest('.key');
  const keyStyle = key ? getComputedStyle(key) : null;
  const cue2 = keyStyle?.getPropertyValue('--cue2')?.trim() || cs.color || '#31d8ff';
  const cue3 = keyStyle?.getPropertyValue('--cue3')?.trim() || '#168bff';
  clone.style.setProperty('--cue2', cue2);
  clone.style.setProperty('--cue3', cue3);
  const pieces = el.classList.contains('blank') ? 18 : 28;
  for (let i = 0; i < pieces; i++) {
    const dot = document.createElement('span');
    dot.className = 'cue-debris';
    const angle = (Math.PI * 2 * i / pieces) + (Math.random() - .5) * .95;
    const dist = 18 + Math.random() * 64;
    dot.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    dot.style.setProperty('--dy', `${Math.sin(angle) * dist - 18 - Math.random() * 28}px`);
    dot.style.setProperty('--s', `${3 + Math.random() * 8}px`);
    dot.style.setProperty('--rot', `${Math.random() * 780 - 390}deg`);
    dot.style.setProperty('--delay', `${Math.random() * .10}s`);
    dot.style.setProperty('--hue', `${Math.round(Math.random() * 60 - 30)}deg`);
    clone.appendChild(dot);
  }
  document.body.appendChild(clone);
  setTimeout(() => clone.remove(), 980);
}

function hitCue(midi, cue) {
  document.querySelectorAll(`#manualKeyboard .key[data-midi="${midi}"]`).forEach(k => {
    if (cue?._id && k.dataset.cueId && k.dataset.cueId !== cue._id) return;
    k.classList.remove('cue');
    const lyric = k.querySelector('.cue-lyric');
    if (lyric && lyric.textContent) {
      lyric.classList.remove('shatter');
      lyric.classList.add('hold');
    }
    void k.offsetWidth;
    k.classList.add('due');
  });
}

function clearManualCueVisuals() {
  document.querySelectorAll('#manualKeyboard .cue, #manualKeyboard .due').forEach(k => {
    k.classList.remove('cue', 'due');
    delete k.dataset.cueId;
  });
  document.querySelectorAll('#manualKeyboard .cue-lyric').forEach(el => {
    el.textContent = '';
    el.classList.remove('blank', 'shatter', 'hold', 'appear');
    delete el.dataset.floatShattered;
    delete el.dataset.cueId;
  });
  cueState.clear();
}

function finishActiveCue() {
  if (!activeCue) return;
  document.querySelectorAll('#manualKeyboard .cue-lyric').forEach(el => {
    if (el.textContent && !el.classList.contains('shatter')) {
      shatterCueLyricElement(el);
      el.classList.remove('hold', 'shatter');
      void el.offsetWidth;
      el.classList.add('shatter');
    }
  });
  setTimeout(clearManualCueVisuals, 820);
  activeCue = null;
}

function updateCueRuntime() {
  if ((!playing && !isManualMode()) || !song?.chordCues?.length) return;
  const now = currentPlayTime();
  if (activeCue) {
    if (!activeCue.hit && now >= activeCue.cue.time) {
      activeCue.hit = true;
      hitCue(activeCue.midi, activeCue.cue);
      if (isAutoChordMode()) autoPressCue(activeCue);
    }
    if (now >= activeCue.cue.time + 0.74) {
      finishActiveCue();
    }
    return;
  }
  const cue = song.chordCues[nextCueIndex];
  if (!cue) return;
  if (now >= cue.time - 1.0) {
    cue._id = `${nextCueIndex}-${cue.time}-${cue.chord}`;
    const midi = NATURAL_TO_MIDI[cue.root];
    activeCue = { cue, midi, hit: now >= cue.time };
    nextCueIndex++;
    startCue(midi, cue);
    if (activeCue.hit) {
      hitCue(midi, cue);
      if (isAutoChordMode()) autoPressCue(activeCue);
    }
  }
}

function clearCountdown() {
  clearTimeout(countdownTimer);
  countdownTimer = null;
  const el = $('countdownOverlay');
  if (el) {
    el.classList.remove('show');
    el.textContent = '';
  }
}

function enterPlaybackAfterCountdown() {
  if (isManualMode()) {
    playing = false;
    clearTimers();
    ensureManualClock();
    scheduleChordCues(0);
    updateClock();
    updateLyrics();
  } else {
    playPlayback();
  }
}

function setLoadingStatus(text) {
  const el = $('loadingText');
  if (el) el.textContent = text;
}

async function prepareStartAssets() {
  setLoadingStatus('加载 MIDI / WASM / 风格包…');
  await (midiReadyPromise || Promise.resolve());
  setLoadingStatus('启动音频引擎…');
  ensureAudio();
  if (window.Tone) await Promise.resolve(Tone.start()).catch(() => {});
  setLoadingStatus('加载钢琴采样…');
  await Promise.race([sampleReadyPromise, new Promise(resolve => setTimeout(resolve, 5000))]);
  setLoadingStatus('加载伴奏音色…');
  await warmHarmonyTones(true);
  if (micEnabled) {
    setLoadingStatus('打开麦克风…');
    await ensureMic();
  }
  setLoadingStatus('准备开始…');
}

function startCountdownThenPlay() {
  const el = $('countdownOverlay');
  const steps = ['3', '2', '1'];
  let i = 0;
  const tick = () => {
    if (!el) return playPlayback();
    el.textContent = steps[i];
    el.classList.remove('pop');
    el.classList.add('show');
    void el.offsetWidth;
    el.classList.add('pop');
    i++;
    if (i < steps.length) {
      countdownTimer = setTimeout(tick, 760);
    } else {
      countdownTimer = setTimeout(() => {
        clearCountdown();
        enterPlaybackAfterCountdown();
      }, 760);
    }
  };
  tick();
}

function playPlayback() {
  if (!song) return;
  if (playOffset <= 0.01 || playOffset >= song.duration) nextManualMelodyIndex = 0;
  if (window.Tone) Tone.start();
  requestWakeLock();
  startRecording();
  scheduleFrom(playOffset >= song.duration ? 0 : playOffset);
}

function currentPlayTime() {
  if (!song) return 0;
  return playing ? playOffset + (performance.now() - playStartedAt) / 1000 : playOffset;
}

function playTrack2At(root) {
  if (!song?.accompanimentTrack?.notes?.length) {
    playVisualNote(shiftedMidi(NATURAL_TO_MIDI[root] || 60), 0.75, 'manual');
    return;
  }
  const now = currentPlayTime();
  const notes = song.accompanimentTrack.notes;
  let bestIndex = -1;
  let bestScore = Infinity;
  for (let i = 0; i < notes.length; i++) {
    if (i <= lastTrack2Index && Math.abs(notes[i].time - now) < 2.0) continue;
    const delta = notes[i].time - now;
    const score = Math.abs(delta) + (delta < -0.25 ? 0.9 : 0);
    if (score < bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  const note = notes[bestIndex];
  if (!note) {
    playVisualNote(shiftedMidi(NATURAL_TO_MIDI[root] || 60), 0.75, 'manual');
    return;
  }
  lastTrack2Index = bestIndex;
  playVisualNote(shiftedMidi(note.note), note.velocity || 0.65, 'manual');
}


function autoPressCue(active) {
  if (!active?.cue) return;
  const root = active.cue.root || rootFromChord(active.cue.chord) || 'C';
  const keys = document.querySelectorAll(`#manualKeyboard .key[data-root="${root}"]`);
  keys.forEach(key => {
    key.classList.remove('cue', 'due', 'miss', 'release');
    key.classList.add('active');
    burstParticles(key, 'manual');
    setTimeout(() => {
      key.classList.remove('active');
      key.classList.add('release');
      setTimeout(() => key.classList.remove('release'), 360);
    }, 520);
  });
  playStyledHarmony(root, active.cue);
  cueState.delete(root);
}

function normalizedHarmonyVelocity(rawVelocity) {
  const raw = Number(rawVelocity || 56) / 127;
  // 网页采样比原机声卡弱，不能直接把 pattern velocity 当最终音量。
  // 保留强弱，但给伴奏单音足够的输出下限，避免听起来整体小一截。
  return Math.max(0.42, Math.min(0.92, raw * 1.32));
}

function playStyledHarmony(root, forcedCue = null) {
  clearHarmonyTimers();
  const now = currentPlayTime();
  const cue = forcedCue || chordAtTime(now) || { chord: root, root };
  const chordName = chordNameForPerformedRoot(root, cue);
  warmHarmonyTones(false);
  const { slot, code, pattern } = chordPatternAtTime(now);
  if (pattern?.notes?.length) {
    const beat = beatMs();
    const beatSec = beat / 1000;
    const cueTime = Number.isFinite(cue?.time) ? cue.time : now;
    const baseSpeed = isManualMode() ? manualSpeedScale : 1;
    const events = patternPhraseForCue(pattern, cueTime, now);
    const speed = fitPhraseToNextCue(events, beatSec, cueTime, now, baseSpeed);
    for (const { note: n, offset } of events) {
      const delay = Math.max(0, offset * 1000 * speed);
      const midi = patternPitchToChordMidi(n.pitch, chordName);
      const duration = Math.max(0.045, Number(n.duration || 0.35) * beatSec * speed);
      const velocity = normalizedHarmonyVelocity(n.velocity);
      playHarmonyVisualNote(midi, delay, duration, velocity, slot + 1);
    }
    return;
  }

  // fallback MIDI 和弦轨：只在 LiberLive pattern 资源缺失时使用。
  // Track 2 是普通和弦展开，不等同于原机 pattern，但可以保证普通/降级播放器仍有伴奏。
  const fallbackNotes = track2SliceForCue(cue);
  if (fallbackNotes.length) {
    const start = fallbackNotes[0].time;
    const naturalEnd = fallbackNotes.reduce((max, n) => Math.max(max, (n.time - start) + Number(n.duration || 0.45)), 0.001);
    let nextTime = nextChordCueTimeAfter(Number.isFinite(cue?.time) ? cue.time : now);
    if (nextTime <= now + 0.08) nextTime = nextChordCueTimeAfter(now);
    const targetEnd = Math.max(0.12, nextTime - now - 0.018);
    const baseSpeed = isManualMode() ? manualSpeedScale : 1;
    const speed = Math.max(0.25, Math.min(1.12, Math.min(baseSpeed, targetEnd / naturalEnd)));
    for (const n of fallbackNotes) {
      const delay = Math.max(0, (n.time - start) * 1000 * speed);
      playHarmonyVisualNote(shiftedMidi(n.note), delay, Math.max(0.08, Number(n.duration || 0.45) * speed), normalizedHarmonyVelocity((n.velocity || 0.48) * 127), harmonyToneMode);
    }
    console.warn('No LiberLive chord pattern loaded; using Track 2 fallback chord notes for', code || currentHarmonyPreset()?.code);
    return;
  }

  console.warn('No LiberLive chord pattern or Track 2 fallback loaded for', code || currentHarmonyPreset()?.code);
}
function pausePlayback() {
  if (!playing) return;
  playOffset += (performance.now() - playStartedAt) / 1000;
  playing = false;
  updatePlayButton();
  clearTimers();
  releaseWakeLock();
  updateClock();
  updateLyrics();
  $('nowPlaying').textContent = '已暂停';
}
function stopPlayback() {
  playing = false;
  updatePlayButton();
  playOffset = 0;
  nextManualMelodyIndex = 0;
  clearTimers();
  stopRecording(false);
  releaseWakeLock();
  updateClock();
  updateLyrics();
  document.querySelectorAll('.key.active').forEach(k => k.classList.remove('active'));
  $('nowPlaying').textContent = '已停止';
}
function finishPlayback() {
  playing = false;
  updatePlayButton();
  playOffset = song?.duration || 0;
  nextManualMelodyIndex = 0;
  clearTimers();
  stopRecording(true);
  releaseWakeLock();
  updateClock();
  updateLyrics();
  document.querySelectorAll('.key.active').forEach(k => k.classList.remove('active'));
  $('nowPlaying').textContent = '播放完成';
}
function restartPlayback() { stopPlayback(); playPlayback(); }

function rangeForMelody() {
  const melodyNotes = song?.melodyTrack?.notes?.map(n => shiftedMidi(n.note)) || [];
  const chordNotes = (song?.chordCues || []).flatMap(c => parseChordNotes(transposeChordName(c.chord)));
  const notes = [...melodyNotes, ...chordNotes];
  if (!notes.length) return { start: 48, end: 72 };
  let min = Math.min(...notes);
  let max = Math.max(...notes);
  min = Math.max(21, min - 2);
  max = Math.min(108, max + 2);
  while (min > 21 && min % 12 !== 0) min--;
  while (max < 108 && max % 12 !== 11) max++;
  return { start: min, end: max };
}

function whiteCount(start, end) {
  let count = 0;
  for (let midi = start; midi <= end; midi++) {
    if (!NOTE_NAMES[midi % 12].includes('#')) count++;
  }
  return count;
}

function renderPlaybackForMelody() {
  const { start, end } = rangeForMelody();
  renderKeyboard('playbackKeyboard', start, end, 'playback');
  const kb = $('playbackKeyboard');
  const whites = whiteCount(start, end);
  const viewport = kb.parentElement.clientWidth || window.innerWidth;
  const width = Math.max(8, Math.floor((viewport - 24) / Math.max(1, whites)));
  kb.style.setProperty('--white-key', `${width}px`);
  kb.style.minWidth = '0';
  kb.style.width = '100%';
}

function renderKeyboard(id, start, end, source) {
  const kb = $(id); kb.innerHTML = '';
  for (let midi = start; midi <= end; midi++) {
    const name = NOTE_NAMES[midi % 12];
    const key = document.createElement('div');
    key.className = `key ${name.includes('#') ? 'black' : 'white'} note-${name[0].toLowerCase()}`;
    key.dataset.midi = midi;
    key.textContent = '';
    key.title = labelOf(midi);
    key.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      requestWakeLock();
      playVisualNote(midi, 0.6, source);
    });
    kb.appendChild(key);
  }
}


function clearManualMelodyTimers() {
  manualMelodyTimers.forEach(clearTimeout);
  manualMelodyTimers = [];
}

function ensureManualClock() {
  if (clockTimer) return;
  clockTimer = setInterval(() => { updateClock(); updateLyrics(); }, 33);
}

function playNextManualMelodyNote() {
  const notes = song?.melodyTrack?.notes || [];
  if (!notes.length || nextManualMelodyIndex >= notes.length) return;
  clearManualMelodyTimers();
  ensureManualClock();

  const pressAt = performance.now();
  const startIndex = nextManualMelodyIndex;
  const startTime = notes[startIndex].time;
  const nextCue = (song?.chordCues || []).find(c => c.time > startTime + 0.08);
  const chunkEnd = Math.min(song?.duration || Infinity, nextCue?.time ?? (startTime + 1.8));
  let endIndex = notes.findIndex((n, i) => i > startIndex && n.time >= chunkEnd - 0.001);
  if (endIndex < 0) endIndex = Math.min(notes.length, startIndex + 8);
  endIndex = Math.max(endIndex, startIndex + 1);

  const chunk = notes.slice(startIndex, endIndex);
  const originalSpan = Math.max(0.001, chunk.at(-1).time - startTime);
  const pressGap = manualLastPressAt ? (pressAt - manualLastPressAt) / 1000 : 0;
  const targetSpan = pressGap && pressGap < originalSpan
    ? Math.max(0.16, pressGap * 0.86)
    : originalSpan;
  const scale = Math.min(1, targetSpan / originalSpan);
  manualSpeedScale = scale;
  manualLastPressAt = pressAt;
  playing = false;

  chunk.forEach((note, localIndex) => {
    const idx = startIndex + localIndex;
    const delay = Math.max(0, (note.time - startTime) * scale * 1000);
    manualMelodyTimers.push(setTimeout(() => {
      playOffset = note.time;
      playVisualNote(shiftedMidi(note.note), note.velocity || 0.65, 'playback');
      if (nextManualMelodyIndex <= idx) nextManualMelodyIndex = idx + 1;
      updateClock();
      updateLyrics();
    }, delay));
  });
}


function renderManualKeyboard() {
  const kb = $('manualKeyboard');
  kb.innerHTML = '';
  const notes = [
    ['C', 60], ['D', 62], ['E', 64], ['F', 65], ['G', 67], ['A', 69], ['B', 71],
  ];
  for (const [label, midi] of notes) {
    const displayLabel = shiftedRootLabel(label);
    const key = document.createElement('div');
    key.className = `key white ${shiftedRootClass(label)}`;
    key.dataset.midi = midi;
    key.dataset.root = label;
    key.dataset.display = displayLabel;
    key.innerHTML = `<span class="cue-fill"></span><span class="hit-line"></span><span class="cue-lyric"></span><span class="key-label">${displayLabel}</span>`;
    key.title = `${displayLabel} (${label})`;
    key.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      requestWakeLock();
      warmHarmonyTones(false);
      if (isManualMode()) playNextManualMelodyNote();
      const good = isGoodTiming(key);
      if (good) {
        if (activeCue && (activeCue.cue?.root === label || key.dataset.cueId === activeCue.cue?._id)) {
          activeCue.hit = true;
          hitCue(activeCue.midi, activeCue.cue);
          window.setTimeout(() => finishActiveCue(), 740);
        }
        key.classList.add('active');
        playStyledHarmony(label);
        burstParticles(key, 'manual');
        setTimeout(() => {
          key.classList.remove('active');
          key.classList.add('release');
          setTimeout(() => key.classList.remove('release'), 360);
        }, 620);
      } else {
        finishActiveCue();
        playStyledHarmony(label);
        key.classList.add('miss');
        burstMissParticles(key);
        setTimeout(() => key.classList.remove('miss'), 420);
      }
      cueState.delete(label);
    });
    kb.appendChild(key);
  }
}


$('playBtn').onclick = () => { requestWakeLock(); warmHarmonyTones(true); if (playing) pausePlayback(); else playPlayback(); };
$('keyDownBtn').onclick = () => { applyKeyShift(-1); };
$('keyUpBtn').onclick = () => { applyKeyShift(1); };
$('restartBtn').onclick = () => { requestWakeLock(); warmHarmonyTones(true); restartPlayback(); };
$('saveRecBtn').onclick = () => downloadRecording();
$('savePromptDownload')?.addEventListener('click', () => { closeSavePrompt(); downloadRecording(); });
$('savePromptCancel')?.addEventListener('click', closeSavePrompt);
$('savePrompt')?.addEventListener('click', (ev) => { if (ev.target?.id === 'savePrompt') closeSavePrompt(); });
$('toneBtn').onclick = () => {
  harmonyToneMode = harmonyToneMode % HARMONY_TONES.length + 1;
  insertUserPickEvent(harmonyToneMode - 1);
  updateToneButton();
  warmHarmonyTones(false);
};
$('melodyToggle').onclick = () => {
  melodyEnabled = !melodyEnabled;
  updatePlaybackToggles();
  if (playing) scheduleFrom(currentPlayTime());
};
$('drumToggle').onclick = () => {
  drumMode = drumMode === 'off' ? 'auto' : 'off';
  drumsEnabled = drumMode !== 'off';
  updatePlaybackToggles();
  if (playing) scheduleFrom(currentPlayTime());
};

function setupStartScreen() {
  const screen = $('startScreen');
  if (!screen) return;
  // 默认必须关麦克风；只有用户主动点“开”才申请权限。
  micEnabled = false;
  stopMic();
  // 麦克风默认必须关闭：初始化时强制 UI 和状态一致，避免浏览器缓存旧 class。
  screen.querySelectorAll('[data-mic]').forEach(b => b.classList.toggle('selected', b.dataset.mic === 'off'));
  updateMicMenu();
  screen.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      playMode = btn.dataset.mode || 'semi';
      screen.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('selected', b === btn));
    });
  });
  screen.querySelectorAll('[data-drum]').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      drumMode = btn.dataset.drum || 'auto';
      drumsEnabled = drumMode !== 'off';
      screen.querySelectorAll('[data-drum]').forEach(b => b.classList.toggle('selected', b === btn));
      screen.querySelector('[data-group="drum"]')?.classList.toggle('is-off', drumMode === 'off');
      updatePlaybackToggles();
    });
  });
  const melodyCard = screen.querySelector('[data-group="melody"].source-card');
  if (melodyCard) {
    melodyCard.addEventListener('click', () => {
      melodyUserTouched = true;
      melodyEnabled = !melodyEnabled;
      melodyCard.querySelector('[data-melody="on"]')?.classList.toggle('selected', melodyEnabled);
      melodyCard.classList.toggle('is-off', !melodyEnabled);
      updatePlaybackToggles();
    });
  } else {
    screen.querySelectorAll('[data-melody]').forEach(btn => {
      btn.addEventListener('click', () => {
        melodyUserTouched = true;
        melodyEnabled = btn.dataset.melody !== 'off';
        screen.querySelectorAll('[data-melody]').forEach(b => b.classList.toggle('selected', b === btn));
        updatePlaybackToggles();
      });
    });
  }
  screen.querySelectorAll('[data-mic]').forEach(btn => {
    btn.addEventListener('click', async () => {
      micEnabled = btn.dataset.mic === 'on';
      if (!micEnabled) stopMic();
      updateMicMenu();
      if (micEnabled) await ensureMic();
    });
  });
  $('menuKeyDown')?.addEventListener('click', () => applyKeyShift(-1));
  $('menuKeyUp')?.addEventListener('click', () => applyKeyShift(1));
  $('menuKeyRange')?.addEventListener('input', (ev) => {
    const next = Math.max(-14, Math.min(14, Number(ev.target.value) || 0));
    if (next === userKeyShift) return;
    userKeyShift = next;
    updateKeyButtons();
    renderManualKeyboard();
    renderPlaybackForMelody();
    updateLyrics();
    previewKeyShift(0);
    if (playing) scheduleFrom(currentPlayTime());
  });
  screen.querySelectorAll('[data-pick]').forEach(btn => {
    btn.addEventListener('click', () => {
      harmonyToneMode = btn.dataset.pick === 'B' ? 2 : 1;
      initialPickSlot = harmonyToneMode - 1;
      insertUserPickEvent(initialPickSlot, 0);
      screen.querySelectorAll('[data-pick]').forEach(b => b.classList.toggle('selected', b === btn));
      updateToneButton();
      warmHarmonyTones(false);
    });
  });
  $('menuMelodyVolDown')?.addEventListener('click', () => adjustMelodyGain(-0.05));
  $('menuMelodyVolUp')?.addEventListener('click', () => adjustMelodyGain(0.05));
  $('menuHarmonyVolDown')?.addEventListener('click', () => adjustHarmonyGain(-0.05));
  $('menuHarmonyVolUp')?.addEventListener('click', () => adjustHarmonyGain(0.05));
  $('menuMicGainDown')?.addEventListener('click', () => adjustMicGain(0));
  $('menuMicGainUp')?.addEventListener('click', () => adjustMicGain(0));
  $('menuMelodyVolRange')?.addEventListener('input', (ev) => { melodyGain = Math.max(0.25, Math.min(2, Number(ev.target.value) / 100)); updateVolumeButtons(); });
  $('menuHarmonyVolRange')?.addEventListener('input', (ev) => { harmonyGain = Math.max(0.25, Math.min(2, Number(ev.target.value) / 100)); updateVolumeButtons(); });
  $('menuMicGainRange')?.addEventListener('input', () => adjustMicGain(0));
  updateVolumeButtons();
  updateMicMenu();
  screen.querySelectorAll('[data-guide]').forEach(btn => {
    btn.addEventListener('click', () => {
      guideMode = btn.dataset.guide === 'on';
      screen.querySelectorAll('[data-guide]').forEach(b => b.classList.toggle('selected', b === btn));
    });
  });
  $('startGameBtn')?.addEventListener('click', startGameFromMenu);
}

async function startGameFromMenu() {
  if (startRequested) return;
  startRequested = true;
  const screen = $('startScreen');
  screen?.classList.add('loading');
  requestWakeLock();
  setLoadingStatus('准备载入…');
  try {
    await prepareStartAssets();
  } catch (err) {
    console.warn('start waits for midi failed', err);
    startRequested = false;
    screen?.classList.remove('loading');
    return;
  }
  screen?.classList.remove('loading');
  document.body.classList.add('game-started');
  // 默认半自动必须有主旋律；只有用户在开始页明确点了“主旋律关”才关闭。
  if (!melodyUserTouched && playMode === 'semi') melodyEnabled = true;
  drumsEnabled = drumMode !== 'off';
  updatePlaybackToggles();
  playOffset = 0;
  nextManualMelodyIndex = 0;
  manualLastPressAt = 0;
  manualSpeedScale = 1;
  clearManualMelodyTimers();
  startCountdownThenPlay();
}

document.addEventListener('contextmenu', ev => ev.preventDefault());
document.addEventListener('selectstart', ev => ev.preventDefault());
document.addEventListener('gesturestart', ev => ev.preventDefault());
document.addEventListener('gesturechange', ev => ev.preventDefault());
document.addEventListener('gestureend', ev => ev.preventDefault());
let lastTouchEnd = 0;
document.addEventListener('touchend', ev => {
  const now = Date.now();
  if (now - lastTouchEnd <= 350) ev.preventDefault();
  lastTouchEnd = now;
}, { passive: false });
document.addEventListener('dblclick', ev => ev.preventDefault(), { passive: false });
document.addEventListener('selectionchange', () => {
  const sel = window.getSelection && window.getSelection();
  if (sel && !sel.isCollapsed) sel.removeAllRanges();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && playing) requestWakeLock();
});

renderKeyboard('playbackKeyboard', 48, 72, 'playback');
renderManualKeyboard();
updateToneButton();
updateKeyButtons();
updateVolumeButtons();
updatePlaybackToggles();
setupStartScreen();
setupMicWave();
initSamplePiano();
midiReadyPromise = loadDefaultMidi();
