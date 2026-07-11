const $ = (id) => document.getElementById(id);
const ASSET_VERSION = 'reset-20260711-10';
const SONG_CATALOG = Object.freeze(Array.from(window.FreezaSongCatalog || []));
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const audio = {
  ctx: null,
  master: null,
  recordDest: null,
  gameRecordGain: null,
  toneRecorderConnected: false,
  toneRecorderAttempted: false,
};
const sampled = { piano: null, ready: false };
const wasmParser = { promise: null, exports: null };
const patterns = { manifest: null, byCode: new Map(), promise: null };
let song = null;
let lyricLines = [];
let lastLyricIndex = -1;
let lastLyricParticleAt = 0;
let timers = [];
let cueTimers = [];
let harmonyTimers = [];
let cueRuntimeRaf = null;
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
let drumGain = 1.55;
let micEnabled = false;
let cameraEnabled = false;
// 麦克风固定 95% 防爆麦：这是内部隐藏值，不在界面暴露，也不允许用户调节。
const FIXED_MIC_GAIN = 0.95;
let micGain = FIXED_MIC_GAIN;
const mic = { stream: null, source: null, gain: null, analyser: null, data: null, freqData: null, raf: 0, level: 0, ready: false };
const cameraPreviewState = { stream: null, facingMode: 'user', switching: false, userPositioned: false };
const recorder = { media: null, chunks: [], blob: null, url: '', mime: '', active: false, requestedStop: false, hadMic: false };
let drumsEnabled = false;
let drumMode = 'auto';
let drumModeBeforeOff = 'auto';
let drumPatternSlot = 0;
let playMode = 'semi';
let guideMode = false;
let nextManualMelodyIndex = 0;
let manualMelodyTimers = [];
let interactivePhrase = null;
let interactiveTransitioning = false;
let interactivePressQueue = [];
let midiReady = false;
let midiReadyPromise = null;
let sampleReadyPromise = Promise.resolve(false);
let startRequested = false;
let selectedSongId = null;
let songSelectionPending = false;
let countdownTimer = null;
let harmonyAutoTimers = [];
let harmonyToneMode = 1;
let userPickEvents = [];
let initialPickSlot = null;
let userKeyShift = 0;
let playbackNeedsFocusResync = false;
let focusResyncing = false;
let focusResumePosition = null;
let focusResyncRetryTimer = null;
let HARMONY_TONES = [
  { label: 'A', code: 'GS_3', name: 'FSS Steel String Guitar', fallbackName: 'acoustic_guitar_steel', guitarLibrary: true, gain: 0.78 },
  { label: 'B', code: 'PianoStudio_4', name: 'Salamander Grand Piano', localPiano: true, gain: 0.42 },
];
const soundfont = { instruments: new Map(), promises: new Map(), ready: false };
const drumKit = { ctx: null, noise: null };
const NATURAL_TO_MIDI = { C: 60, D: 62, E: 64, F: 65, G: 67, A: 69, B: 71 };
const NOTE_PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const PC_NOTE_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const cueState = new Map();
const harmonyRepeat = new Map();
const TIMING_GRADES = ['SSS', 'SS', 'S', 'A', 'B', 'C', 'D', 'E', 'F', 'MISS'];
const timingRatingCounts = new Map(TIMING_GRADES.map(grade => [grade, 0]));

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
  if (!song) { setPill('timeStatus', '00:00 - 00:00'); updatePlayButton(); updateGamePickControls(); return; }
  const now = playing ? playOffset + (performance.now() - playStartedAt) / 1000 : playOffset;
  setPill('timeStatus', `${fmt(Math.min(now, song.duration))} - ${fmt(song.duration)}`);
  updatePlayButton();
  updateGamePickControls(now);
}

async function loadPatternManifest() {
  if (patterns.promise) return patterns.promise;
  patterns.promise = fetch(`patterns/player_bundle/catalog/player_patterns_manifest.json?v=${ASSET_VERSION}`, { cache: 'no-store' })
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
  const url = `pkg/piano_wasm.wasm?v=${ASSET_VERSION}`;
  wasmParser.promise = WebAssembly.instantiateStreaming(fetch(url, { cache: 'no-store' }), {})
    .catch(async () => {
      const res = await fetch(url, { cache: 'no-store' });
      const bytes = await res.arrayBuffer();
      return WebAssembly.instantiate(bytes, {});
    })
    .then(result => {
      wasmParser.exports = result.instance.exports;
      return wasmParser.exports;
    });
  return wasmParser.promise;
}

function withTimeout(promise, timeoutMs, label = 'operation') {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
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

function runWasmCommand(command) {
  const wasm = wasmParser.exports;
  if (!wasm?.memory || !wasm.input_ptr || !wasm.input_capacity || !wasm.process_command) {
    throw new Error('WASM playback core unavailable');
  }
  const bytes = new TextEncoder().encode(JSON.stringify(command));
  if (bytes.length > wasm.input_capacity()) throw new Error('WASM command exceeds input capacity');
  new Uint8Array(wasm.memory.buffer, wasm.input_ptr(), bytes.length).set(bytes);
  const len = wasm.process_command(bytes.length);
  const json = new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, wasm.output_ptr(), len));
  const result = JSON.parse(json);
  if (result.error) throw new Error(result.error);
  return result;
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
    // Tone.js 和原生 WebAudio 必须共用同一个 AudioContext；否则
    // Tone.Destination 无法连接到原生 MediaStreamDestination，录音会丢掉钢琴声。
    const toneContext = window.Tone?.getContext?.();
    const toneRawContext = toneContext?.rawContext || toneContext?._context || null;
    audio.ctx = toneRawContext || new (window.AudioContext || window.webkitAudioContext)();
    audio.master = audio.ctx.createGain();
    audio.master.gain.value = 0.48;
    audio.master.connect(audio.ctx.destination);
    audio.recordDest = audio.ctx.createMediaStreamDestination();
    audio.gameRecordGain = audio.ctx.createGain();
    audio.gameRecordGain.gain.value = 1;
    audio.master.connect(audio.gameRecordGain).connect(audio.recordDest);
  }
  // iOS Safari 从后台回来时可能把 Context 标记为 suspended 或
  // interrupted。两种状态都要主动恢复，不能只处理 suspended。
  if (audio.ctx.state !== 'running' && audio.ctx.state !== 'closed') {
    audio.ctx.resume().catch(() => {});
  }
  connectToneToRecorder();
}

function playLaunchTone(frequency, delay = 0, duration = 0.09, level = 0.055, type = 'sine') {
  ensureAudio();
  const ctx = audio.ctx;
  if (!ctx || !audio.master) return;
  const start = ctx.currentTime + Math.max(0, delay);
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(Math.max(60, frequency), start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(60, frequency * 1.025), start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(level, start + Math.min(0.012, duration * 0.28));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(audio.master);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function playLaunchUiSound(kind = 'select', value = 0.5) {
  try {
    const position = Math.max(0, Math.min(1, Number(value) || 0));
    if (kind === 'brand') {
      playLaunchTone(392, 0, 0.12, 0.052, 'triangle');
      playLaunchTone(523.25, 0.055, 0.14, 0.047, 'sine');
      playLaunchTone(783.99, 0.12, 0.18, 0.038, 'sine');
    } else if (kind === 'panel') {
      playLaunchTone(493.88, 0, 0.075, 0.037, 'triangle');
      playLaunchTone(659.25, 0.045, 0.095, 0.032, 'sine');
    } else if (kind === 'start') {
      playLaunchTone(392, 0, 0.11, 0.05, 'triangle');
      playLaunchTone(523.25, 0.045, 0.14, 0.048, 'triangle');
      playLaunchTone(659.25, 0.09, 0.18, 0.044, 'sine');
    } else if (kind === 'toggle') {
      playLaunchTone(330, 0, 0.055, 0.034, 'square');
      playLaunchTone(494, 0.032, 0.07, 0.027, 'sine');
    } else if (kind === 'slider') {
      playLaunchTone(360 + position * 520, 0, 0.036, 0.022, 'sine');
    } else {
      playLaunchTone(440, 0, 0.06, 0.034, 'triangle');
      playLaunchTone(587.33, 0.028, 0.075, 0.026, 'sine');
    }
  } catch (err) {
    console.warn('Launch UI sound unavailable:', err);
  }
}

function setupLaunchUiSounds(screen) {
  let lastSliderSoundAt = 0;
  const soundKindFor = (target) => {
    if (target?.dataset?.uiSound) return target.dataset.uiSound;
    if (target?.id === 'startGameBtn') return 'start';
    if (target?.closest?.('.launch-switch')) return 'toggle';
    return 'select';
  };
  screen.addEventListener('pointerdown', (event) => {
    const target = event.target.closest('button, [data-ui-sound]');
    if (target && screen.contains(target)) playLaunchUiSound(soundKindFor(target));
  });
  screen.addEventListener('click', (event) => {
    if (event.detail !== 0) return;
    const target = event.target.closest('button, [data-ui-sound]');
    if (target && screen.contains(target)) playLaunchUiSound(soundKindFor(target));
  });
  screen.querySelectorAll('[data-ui-sound]').forEach(target => {
    target.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        playLaunchUiSound(soundKindFor(target));
      }
    });
  });
  screen.querySelectorAll('.launch-range').forEach(range => {
    range.addEventListener('input', () => {
      if (range.id === 'menuKeyRange') return; // Key 已播放实际变调试听音。
      const now = performance.now();
      if (now - lastSliderSoundAt < 42) return;
      lastSliderSoundAt = now;
      const min = Number(range.min) || 0;
      const max = Number(range.max) || 1;
      playLaunchUiSound('slider', (Number(range.value) - min) / Math.max(1, max - min));
    });
  });
}

function setupGameUiSounds() {
  const controls = document.querySelector('.game-controls');
  if (!controls || controls.dataset.soundReady === 'true') return;
  controls.dataset.soundReady = 'true';
  controls.addEventListener('pointerdown', event => {
    const button = event.target.closest('.btn');
    if (!button) return;
    const kind = button.id === 'saveRecBtn' ? 'panel'
      : ['melodyToggle', 'drumToggle', 'toneBtn'].includes(button.id) ? 'toggle'
      : 'select';
    playLaunchUiSound(kind);
  });
}

function connectToneToRecorder() {
  if (!window.Tone || !audio.recordDest || audio.toneRecorderConnected || audio.toneRecorderAttempted) return;
  audio.toneRecorderAttempted = true;
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

function localSoundfontUrl(name, soundfont, format) {
  const fmt = format === 'ogg' ? 'ogg' : 'mp3';
  return `soundfonts/FluidR3_GM/${name}-${fmt}.js`;
}

function getSoundfontInstrument(preset) {
  if (preset.localPiano) return Promise.resolve(null);
  if (!window.Soundfont || !audio.ctx) return Promise.resolve(null);
  const soundfontName = preset.fallbackName || preset.name;
  if (soundfont.instruments.has(soundfontName)) return Promise.resolve(soundfont.instruments.get(soundfontName));
  if (!soundfont.promises.has(soundfontName)) {
    const p = Soundfont.instrument(audio.ctx, soundfontName, {
      soundfont: 'FluidR3_GM',
      format: 'mp3',
      nameToUrl: localSoundfontUrl,
      destination: audio.master,
      gain: preset.gain || 0.65,
    }).then(inst => {
      soundfont.instruments.set(soundfontName, inst);
      return inst;
    }).catch(err => {
      console.warn('SoundFont load failed:', soundfontName, err);
      return null;
    });
    soundfont.promises.set(soundfontName, p);
  }
  return soundfont.promises.get(soundfontName);
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
  if (preset.guitarLibrary && window.FreezaGuitarSampler?.play(
    audio.ctx, audio.master, preset.code, midi, duration, velocity, (preset.gain || 0.78) * harmonyGain,
  )) return;
  if (preset.localPiano && sampled.ready && sampled.piano && window.Tone) {
    Tone.start();
    sampled.piano.triggerAttackRelease(toneNoteOf(midi), duration, undefined, Math.max(0.035, velocity * (preset.gain || 0.42) * harmonyGain));
    return;
  }
  withTimeout(getSoundfontInstrument(preset), 1400, `SoundFont ${preset.name}`).then(inst => {
    if (!inst) return fallbackSoftNote(midi, duration, velocity);
    const note = preset.drum ? Math.min(81, Math.max(35, midi)) : midi;
    inst.play(note, audio.ctx.currentTime, Math.max(0.08, duration), {
      gain: Math.max(0.05, Math.min(1, velocity * (preset.gain || 0.65) * harmonyGain)),
    });
  }).catch(() => fallbackSoftNote(midi, duration, velocity));
}

function drumPitchToMidi(pitch) {
  const p = Math.round(Number(pitch));
  // C2 drum pattern 使用 GM percussion note - 12 的模板编号。
  // 不能把 25/26、41 等压成同一种鼓，否则整套 pattern 只剩“咚咚”声。
  return Math.max(35, Math.min(81, p + 12));
}

function drumVoiceForMidi(midi) {
  if (midi === 35 || midi === 36) return 'kick';
  if (midi === 37) return 'rim';
  if (midi === 38 || midi === 40) return 'snare';
  if (midi === 39) return 'clap';
  if (midi === 42 || midi === 44) return 'closed-hat';
  if (midi === 46) return 'open-hat';
  if ([41, 43, 45, 47, 48, 50].includes(midi)) return 'tom';
  if ([49, 51, 52, 53, 55, 57, 59].includes(midi)) return 'cymbal';
  return 'percussion';
}

function drumNoiseBuffer() {
  const ctx = audio.ctx;
  if (drumKit.ctx === ctx && drumKit.noise) return drumKit.noise;
  const length = Math.ceil(ctx.sampleRate * 1.2);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  drumKit.ctx = ctx;
  drumKit.noise = buffer;
  return buffer;
}

function playDrumNoise(when, duration, peak, filterType, frequency, q = 0.7) {
  const ctx = audio.ctx;
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = drumNoiseBuffer();
  filter.type = filterType;
  filter.frequency.setValueAtTime(frequency, when);
  filter.Q.value = q;
  gain.gain.setValueAtTime(Math.max(0.0001, peak), when);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  source.connect(filter).connect(gain).connect(audio.master);
  source.start(when, Math.random() * 0.12);
  source.stop(when + duration + 0.02);
}

function playDrumOsc(when, duration, peak, type, startFrequency, endFrequency = startFrequency) {
  const ctx = audio.ctx;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(startFrequency, when);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), when + duration);
  gain.gain.setValueAtTime(Math.max(0.0001, peak), when);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  osc.connect(gain).connect(audio.master);
  osc.start(when);
  osc.stop(when + duration + 0.02);
}

function playDrumKitNote(midi, velocity, patternDuration) {
  ensureAudio();
  const now = audio.ctx.currentTime;
  const level = Math.min(1.6, (0.035 + Math.max(0, velocity) * 1.05) * drumGain);
  const voice = drumVoiceForMidi(midi);
  if (voice === 'kick') {
    playDrumOsc(now, 0.34, level * 0.95, 'sine', 155, 46);
  } else if (voice === 'rim') {
    playDrumNoise(now, 0.055, level * 0.62, 'bandpass', 1850, 5.5);
    playDrumOsc(now, 0.045, level * 0.28, 'square', 540, 410);
  } else if (voice === 'snare') {
    playDrumNoise(now, 0.18, level * 0.78, 'highpass', 1050, 0.8);
    playDrumOsc(now, 0.13, level * 0.30, 'triangle', 210, 125);
  } else if (voice === 'clap') {
    [0, 0.018, 0.038].forEach((delay, i) => {
      playDrumNoise(now + delay, 0.075, level * (0.50 - i * 0.08), 'bandpass', 1450, 1.1);
    });
  } else if (voice === 'closed-hat') {
    playDrumNoise(now, 0.065, level * 0.42, 'highpass', 7200, 0.7);
  } else if (voice === 'open-hat') {
    playDrumNoise(now, Math.max(0.24, Math.min(0.72, patternDuration)), level * 0.46, 'highpass', 6500, 0.6);
  } else if (voice === 'tom') {
    const tomFrequency = 82 + (midi - 41) * 13;
    playDrumOsc(now, 0.28, level * 0.72, 'sine', tomFrequency * 1.45, tomFrequency);
  } else if (voice === 'cymbal') {
    playDrumNoise(now, Math.max(0.34, Math.min(1.05, patternDuration)), level * 0.44, 'highpass', midi === 53 ? 4200 : 5200, 1.0);
    if (midi === 53) playDrumOsc(now, 0.22, level * 0.16, 'square', 860, 790);
  } else {
    playDrumNoise(now, 0.13, level * 0.46, 'bandpass', 2100 + (midi - 54) * 85, 2.2);
  }
}

function prepareDrumPattern(pattern, drumCode = pattern?.code, onProgress = null) {
  if (!pattern?.notes?.length || !window.FreezaDrumKits) return Promise.resolve();
  ensureAudio();
  return window.FreezaDrumKits.preload(
    audio.ctx,
    drumCode,
    pattern.notes.map(note => drumPitchToMidi(note.pitch)),
    onProgress,
  );
}

function playDrumPatternNote(patternNote, drumCode = currentDrumCode) {
  ensureAudio();
  const midi = drumPitchToMidi(patternNote.pitch);
  const velocity = Math.max(0, Math.min(1, Number(patternNote.velocity || 0) / 127));
  const duration = Math.max(0.05, Number(patternNote.duration || 0.2) * beatMs() / 1000);
  if (window.FreezaDrumKits?.play(audio.ctx, audio.master, drumCode, midi, velocity, drumGain)) return;
  playDrumKitNote(midi, velocity, duration);
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
      setTimeout(() => k.classList.remove('release'), 360);
    }, ms);
  });
}

function cueProgressForKey(key) {
  const state = cueState.get(key.dataset.root);
  if (!state) return null;
  const now = performance.now();
  if (now < state.start || now > state.end) return null;
  // 线性 140% 模型：出现(0) → 1 秒 → 应按点(100) → 生命周期结束(140)。
  return ((now - state.start) / 1000) * 100;
}

function isGoodTiming(key) {
  const p = cueProgressForKey(key);
  return p !== null && p >= 90 && p <= 110;
}

function timingGrade(progress, correctKey = true) {
  if (!correctKey || !Number.isFinite(progress)) return 'MISS';
  const error = Math.abs(progress - 100);
  if (error <= 1) return 'SSS';
  if (error <= 2) return 'SS';
  if (error <= 3) return 'S';
  if (error <= 4) return 'A';
  if (error <= 5) return 'B';
  if (error <= 6) return 'C';
  if (error <= 7) return 'D';
  if (error <= 8) return 'E';
  if (error <= 10) return 'F';
  return 'MISS';
}

function resetTimingRatings() {
  TIMING_GRADES.forEach(grade => timingRatingCounts.set(grade, 0));
}

function recordTimingGrade(grade) {
  const normalized = TIMING_GRADES.includes(grade) ? grade : 'MISS';
  timingRatingCounts.set(normalized, (timingRatingCounts.get(normalized) || 0) + 1);
  return normalized;
}

function showTimingRating(key, grade, count = true) {
  if (!key) return;
  const normalized = count ? recordTimingGrade(grade) : grade;
  key._timingRating?.remove();
  const rect = key.getBoundingClientRect();
  const rating = document.createElement('span');
  rating.className = `timing-rating grade-${String(normalized).toLowerCase()}`;
  rating.textContent = normalized;
  rating.style.left = `${rect.left + rect.width / 2}px`;
  // 出现点比和弦文字再高约 1/3 个现有上移行程（40 / 3 ≈ 13.3px）。
  rating.style.top = `${rect.top + rect.height * 0.06 - 14}px`;
  document.body.appendChild(rating);
  key._timingRating = rating;
  rating.addEventListener('animationend', () => {
    if (key._timingRating === rating) key._timingRating = null;
    rating.remove();
  }, { once: true });
}

function showPerformanceResults() {
  const modal = $('resultPrompt');
  const grid = $('resultGradeGrid');
  if (!modal || !grid) return;
  grid.innerHTML = TIMING_GRADES.map(grade => `
    <div class="result-grade grade-${grade.toLowerCase()}">
      <dt>${grade}</dt><dd>${timingRatingCounts.get(grade) || 0}</dd>
    </div>`).join('');
  const total = TIMING_GRADES.reduce((sum, grade) => sum + (timingRatingCounts.get(grade) || 0), 0);
  const totalEl = $('resultTotal');
  if (totalEl) totalEl.textContent = `总判定 ${total}`;
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
}

function closePerformanceResults() {
  const modal = $('resultPrompt');
  modal?.classList.remove('show');
  modal?.setAttribute('aria-hidden', 'true');
}

function returnToSongScreen() {
  closePerformanceResults();
  closeSavePrompt();
  playing = false;
  playOffset = 0;
  nextManualMelodyIndex = 0;
  startRequested = false;
  clearTimers();
  resetInteractiveSequencer();
  resetHarmonyHalfSequence();
  stopCamera();
  cameraPreviewState.userPositioned = false;
  document.querySelectorAll('body > .timing-rating, body > .lyric-particle').forEach(el => el.remove());
  document.body.classList.remove('game-started', 'song-selected');
  $('songScreen')?.setAttribute('aria-hidden', 'false');
  $('startScreen')?.setAttribute('aria-hidden', 'true');
  $('startScreen')?.classList.remove('loading');
  updatePlayButton();
  updateClock();
  updateLyrics();
  releaseWakeLock();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function playVisualNote(midi, velocity, source) {
  playNote(midi, 0.65, velocity);
  flash(source === 'manual' ? 'manualKeyboard' : 'playbackKeyboard', midi);
  $('nowPlaying').textContent = source === 'manual' ? `手动弹奏：${labelOf(midi)}` : `主旋律：${labelOf(midi)}`;
}

function playHarmonyVisualNote(midi, delay = 0, duration = 0.58, velocity = 0.42, toneMode = harmonyToneMode) {
  const event = {
    midi, duration, velocity, toneMode,
    dueAt: performance.now() + Math.max(0, delay),
    fired: false,
    timer: null,
  };
  const timer = setTimeout(() => {
    event.fired = true;
    playHarmonyToneNote(midi, duration, velocity, toneMode);
    flash('playbackKeyboard', midi, Math.max(360, duration * 720), 'harmony');
  }, delay);
  event.timer = timer;
  harmonyTimers.push(timer);
  return event;
}

function clearHarmonyTimers() {
  harmonyTimers.forEach(clearTimeout);
  harmonyTimers = [];
}

// 前后半相位属于“连续演奏的和弦根音”，不属于 A/B 音色。A 前半后切 B
// 再按同根音，B 必须接后半；B→A 也相同。换根音后从前半重新开始。
function nextHarmonyHalfForRoot(root) {
  const previous = harmonyRepeat.get('last');
  const half = previous?.root === root ? (previous.half === 0 ? 1 : 0) : 0;
  harmonyRepeat.set('last', { root, half });
  return half;
}

function resetHarmonyHalfSequence() {
  harmonyRepeat.clear();
}

function updateToneButton() {
  const btn = $('toneBtn');
  if (!btn) return;
  const label = drumPatternSlot > 0 ? 'B' : 'A';
  btn.textContent = `鼓${label}`;
  btn.dataset.drumSlot = label;
  btn.setAttribute('aria-label', `切换鼓机节奏，当前 ${label}`);
  btn.setAttribute('aria-pressed', drumPatternSlot > 0 ? 'true' : 'false');
}

function availableDrumCodes() {
  const style = song?.styleInfo;
  return [...new Set([
    ...(style?.midiPrograms?.drumCodes || []),
    style?.topLevel?.rhythmicDrumA,
    style?.topLevel?.rhythmicDrumB,
    ...(style?.configPack?.drums || []).map(item => item?.code),
  ].filter(Boolean))];
}

function syncStartDrumToneMenu(screen = $('startScreen')) {
  if (!screen) return;
  const codes = availableDrumCodes();
  const hasLoadedChoice = Boolean(song);
  screen.querySelectorAll('[data-drum-tone]').forEach(button => {
    const slot = button.dataset.drumTone === 'B' ? 1 : 0;
    const unavailable = hasLoadedChoice && slot > 0 && codes.length < 2;
    button.disabled = unavailable;
    button.classList.toggle('selected', !unavailable && slot === drumPatternSlot);
    button.setAttribute('aria-pressed', !unavailable && slot === drumPatternSlot ? 'true' : 'false');
    button.title = unavailable
      ? '当前歌曲只提供一套鼓机音色'
      : `鼓机音色 ${button.dataset.drumTone}${codes[slot] ? ` · ${codes[slot]}` : ''}`;
  });
}

function selectDrumPatternSlot(slot, reschedule = true) {
  const codes = availableDrumCodes();
  const requestedSlot = Number(slot) > 0 ? 1 : 0;
  // MIDI 尚未载入时保留首页选择；载入后若歌曲只有一套鼓组才回落到 A。
  drumPatternSlot = codes.length === 1 ? 0 : requestedSlot;
  currentDrumCode = codes[drumPatternSlot] || codes[0] || currentDrumCode;
  updateToneButton();
  syncStartDrumToneMenu();
  updatePlaybackToggles();
  const pattern = currentDrumPattern();
  if (pattern) prepareDrumPattern(pattern, currentDrumCode);
  if (reschedule && playing && drumsEnabled) scheduleFrom(currentPlayTime());
}

function selectGameDrumPatternSlot(slot) {
  const previousMode = drumMode;
  const wasPowered = drumsEnabled;
  // 鼓 A/B 是纯 pattern 选择器，绝不能改变“智能 / 开 / 关”状态。
  selectDrumPatternSlot(slot, false);
  drumMode = previousMode;
  drumsEnabled = wasPowered;
  updatePlaybackToggles();
  // 强制开启模式使用玩家选择的 A/B，需要立即重排；智能模式继续完全
  // 服从歌曲 LLDRUM 事件，切 A/B 只保存下一次“开”模式所用的鼓组。
  if (playing && wasPowered && drumMode === 'on') scheduleFrom(currentPlayTime());
}

function percentLabel(v) {
  return `${Math.round(v * 100)}%`;
}

function updateVolumeButtons() {
  const mv = $('menuMelodyVolValue');
  const hv = $('menuHarmonyVolValue');
  const dv = $('menuDrumVolValue');
  const micv = $('menuMicGainValue');
  const mr = $('menuMelodyVolRange');
  const hr = $('menuHarmonyVolRange');
  const dr = $('menuDrumVolRange');
  const mir = $('menuMicGainRange');
  if (mv) mv.textContent = percentLabel(melodyGain);
  if (hv) hv.textContent = percentLabel(harmonyGain);
  if (dv) dv.textContent = percentLabel(drumGain);
  if (micv) micv.textContent = percentLabel(micGain);
  if (mr) { mr.value = String(Math.round(melodyGain * 100)); mr.style.setProperty('--pct', `${Math.round((melodyGain * 100 - 25) / 175 * 100)}%`); }
  if (hr) { hr.value = String(Math.round(harmonyGain * 100)); hr.style.setProperty('--pct', `${Math.round((harmonyGain * 100 - 25) / 175 * 100)}%`); }
  if (dr) { dr.value = String(Math.round(drumGain * 100)); dr.style.setProperty('--pct', `${Math.round((drumGain * 100 - 25) / 175 * 100)}%`); }
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
    // Key 和音量条同款：--pct 只表示滑块位置，不做中线特殊填充。
    menuRange.style.setProperty('--pct', `${((userKeyShift + 14) / 28) * 100}%`);
  }
  updateCurrentKeyStatus();
}

function updateCurrentKeyStatus() {
  const status = $('keyStatus');
  if (!status) return;
  const pitchClass = ((songTransposeSemitones() + userKeyShift) % 12 + 12) % 12;
  const keyName = PC_NOTE_SHARP[pitchClass].replace('#', '♯');
  const value = status.querySelector('b');
  if (value) value.textContent = keyName;
  status.title = `当前 Key：${keyName}（升降 ${userKeyShift >= 0 ? '+' : ''}${userKeyShift}）`;
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
  syncLaunchSwitch('mic', micEnabled);
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

function updateCameraMenu(statusText = '') {
  document.querySelectorAll('[data-camera]').forEach(button => {
    button.classList.toggle('selected', (button.dataset.camera === 'on') === cameraEnabled);
  });
  syncLaunchSwitch('camera', cameraEnabled);
  const facing = cameraPreviewState.facingMode === 'environment' ? '后置' : '前置';
  const status = $('cameraStatus');
  if (status) status.textContent = statusText || (cameraEnabled ? `${facing}画面` : '默认前置');
  const label = $('cameraFacingLabel');
  if (label) label.textContent = facing;
  const pip = $('cameraPip');
  const live = cameraEnabled && Boolean(cameraPreviewState.stream);
  document.body.classList.toggle('camera-live', live);
  if (pip) {
    pip.classList.toggle('front', cameraPreviewState.facingMode !== 'environment');
    pip.setAttribute('aria-hidden', live ? 'false' : 'true');
    pip.tabIndex = live ? 0 : -1;
  }
}

function releaseCameraStream(stream = cameraPreviewState.stream) {
  stream?.getTracks?.().forEach(track => track.stop());
}

function stopCamera(disable = true) {
  releaseCameraStream();
  cameraPreviewState.stream = null;
  cameraPreviewState.switching = false;
  if (disable) cameraEnabled = false;
  const video = $('cameraPreview');
  if (video) video.srcObject = null;
  updateCameraMenu();
}

async function attachCameraStream(stream, intendedFacing = 'user') {
  cameraPreviewState.stream = stream;
  const settings = stream.getVideoTracks?.()[0]?.getSettings?.() || {};
  cameraPreviewState.facingMode = settings.facingMode || intendedFacing;
  const video = $('cameraPreview');
  if (video) {
    video.srcObject = stream;
    await video.play?.().catch(() => {});
  }
  updateCameraMenu();
  positionCameraPip(!cameraPreviewState.userPositioned);
  return true;
}

async function requestCamera(videoConstraints, intendedFacing = 'user') {
  const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
  return attachCameraStream(stream, intendedFacing);
}

async function ensureCamera() {
  if (!cameraEnabled) return false;
  if (cameraPreviewState.stream) return true;
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraEnabled = false;
    updateCameraMenu('浏览器不支持');
    alert('这个浏览器不支持摄像头预览');
    return false;
  }
  try {
    return await requestCamera({
      facingMode: { ideal: 'user' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    }, 'user');
  } catch (error) {
    console.warn('Camera permission failed:', error);
    cameraEnabled = false;
    updateCameraMenu('未授权');
    alert('摄像头没有授权，演奏画面不会显示预览');
    return false;
  }
}

async function switchCamera() {
  if (!cameraEnabled || cameraPreviewState.switching) return false;
  cameraPreviewState.switching = true;
  const previousFacing = cameraPreviewState.facingMode;
  const currentTrack = cameraPreviewState.stream?.getVideoTracks?.()[0];
  const currentDeviceId = currentTrack?.getSettings?.().deviceId;
  let constraints;
  let intendedFacing = previousFacing === 'environment' ? 'user' : 'environment';
  try {
    const devices = (await navigator.mediaDevices?.enumerateDevices?.() || []).filter(device => device.kind === 'videoinput');
    if (devices.length > 1) {
      const currentIndex = Math.max(0, devices.findIndex(device => device.deviceId === currentDeviceId));
      const next = devices[(currentIndex + 1) % devices.length];
      constraints = { deviceId: { exact: next.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } };
    } else {
      constraints = { facingMode: { exact: intendedFacing }, width: { ideal: 1280 }, height: { ideal: 720 } };
    }
    releaseCameraStream();
    cameraPreviewState.stream = null;
    await requestCamera(constraints, intendedFacing);
    playLaunchUiSound('select');
    return true;
  } catch (error) {
    console.warn('Camera switch failed:', error);
    try {
      await requestCamera({ facingMode: { ideal: previousFacing } }, previousFacing);
      updateCameraMenu('没有其他摄像头');
    } catch (restoreError) {
      console.warn('Camera restore failed:', restoreError);
      stopCamera();
    }
    return false;
  } finally {
    cameraPreviewState.switching = false;
  }
}

function positionCameraPip(forceDefault = false) {
  requestAnimationFrame(() => {
    const pip = $('cameraPip');
    if (!pip || !document.body.classList.contains('game-started') || !cameraPreviewState.stream) return;
    const rect = pip.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const margin = 10;
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    let left = parseFloat(pip.style.left);
    let top = parseFloat(pip.style.top);
    if (forceDefault || !cameraPreviewState.userPositioned || !Number.isFinite(left) || !Number.isFinite(top)) {
      const karaokeRect = document.querySelector('.karaoke')?.getBoundingClientRect();
      left = karaokeRect ? karaokeRect.right - rect.width - 12 : maxLeft;
      top = karaokeRect ? karaokeRect.bottom - rect.height - 12 : maxTop;
    }
    pip.style.left = `${Math.max(margin, Math.min(maxLeft, left))}px`;
    pip.style.top = `${Math.max(margin, Math.min(maxTop, top))}px`;
  });
}

function setupCameraPip() {
  const pip = $('cameraPip');
  if (!pip || pip.dataset.ready === '1') return;
  pip.dataset.ready = '1';
  let drag = null;
  pip.addEventListener('pointerdown', event => {
    if (!cameraEnabled) return;
    event.preventDefault();
    const rect = pip.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
    pip.setPointerCapture?.(event.pointerId);
    pip.classList.add('dragging');
  });
  pip.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) > 5) drag.moved = true;
    if (!drag.moved) return;
    cameraPreviewState.userPositioned = true;
    const rect = pip.getBoundingClientRect();
    const margin = 8;
    pip.style.left = `${Math.max(margin, Math.min(window.innerWidth - rect.width - margin, drag.left + dx))}px`;
    pip.style.top = `${Math.max(margin, Math.min(window.innerHeight - rect.height - margin, drag.top + dy))}px`;
  });
  const finish = event => {
    if (!drag || event.pointerId !== drag.id) return;
    const shouldSwitch = !drag.moved;
    pip.releasePointerCapture?.(drag.id);
    drag = null;
    pip.classList.remove('dragging');
    if (shouldSwitch) switchCamera();
  };
  pip.addEventListener('pointerup', finish);
  pip.addEventListener('pointercancel', event => {
    if (drag && event.pointerId === drag.id) {
      drag = null;
      pip.classList.remove('dragging');
    }
  });
  pip.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      switchCamera();
    }
  });
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
    const drumLabel = drumMode === 'auto' ? '智能' : drumMode === 'on' ? '开' : '关';
    drumBtn.textContent = drumLabel;
    drumBtn.classList.toggle('active-toggle', drumMode !== 'off');
    drumBtn.setAttribute('aria-pressed', drumMode !== 'off' ? 'true' : 'false');
    drumBtn.setAttribute('aria-label', `鼓机状态：${drumLabel}，点击切换`);
    drumBtn.title = `鼓机：${drumLabel} · ${drumMode === 'auto' ? '跟随歌曲事件' : `鼓组 ${drumPatternSlot > 0 ? 'B' : 'A'}`}`;
  }
  updateToneButton();
  updateGamePickControls();
}

function syncMelodyGuideMenu(screen = $('startScreen')) {
  if (!screen) return;
  screen.querySelectorAll('[data-melody]').forEach(button => {
    button.classList.toggle('selected', (button.dataset.melody === 'on') === melodyEnabled);
  });
  screen.querySelectorAll('[data-guide]').forEach(button => {
    button.classList.toggle('selected', (button.dataset.guide === 'on') === guideMode);
  });
  syncLaunchSwitch('melody', melodyEnabled, guideMode, screen);
  syncLaunchSwitch('guide', guideMode, false, screen);
}

function syncLaunchSwitch(group, enabled, locked = false, root = document) {
  const control = root?.querySelector?.(`[data-group="${group}"]`);
  if (!control?.classList.contains('launch-switch')) return;
  control.classList.toggle('state-off', !enabled);
  control.classList.toggle('is-locked', locked);
  control.setAttribute('aria-disabled', locked ? 'true' : 'false');
  control.closest('.launch-toggle-item')?.classList.toggle('is-locked', locked);
  control.querySelectorAll('button').forEach(button => {
    button.disabled = locked;
  });
}

function firstRealLyricStart() {
  const line = lyricLines.find(l => !l.prelude && String(l.text || '').trim());
  return Number.isFinite(line?.start) ? line.start : Infinity;
}

function shouldAutoPlayMelodyAt(time) {
  if (guideMode) return time < firstRealLyricStart() - 0.001;
  return melodyEnabled && playMode !== 'manual';
}

function isAutoChordMode() { return playMode === 'auto'; }
function isSemiAutoMode() { return playMode === 'semi'; }
function isManualMode() { return playMode === 'manual'; }

function updateGamePickControls(time = currentPlayTime()) {
  const enabled = isAutoChordMode();
  const activeSlot = song ? chordPatternSlotAtTime(time) : Math.max(0, harmonyToneMode - 1);
  const button = $('pickToneBtn');
  if (!button) return;
  const label = activeSlot > 0 ? 'B' : 'A';
  button.textContent = `拨${label}`;
  button.dataset.pickSlot = label;
  button.disabled = !enabled;
  button.setAttribute('aria-disabled', enabled ? 'false' : 'true');
  button.setAttribute('aria-pressed', activeSlot > 0 ? 'true' : 'false');
  button.setAttribute('aria-label', `切换拨片音色，当前 ${label}`);
  button.title = enabled ? `点击切换到拨片 ${activeSlot > 0 ? 'A' : 'B'}` : '仅全自动模式可用';
}

function selectGamePickSlot(slot) {
  if (!isAutoChordMode()) return;
  const normalized = Number(slot) > 0 ? 1 : 0;
  harmonyToneMode = normalized + 1;
  initialPickSlot = normalized;
  insertUserPickEvent(normalized, currentPlayTime());
  updateGamePickControls();
  warmHarmonyTones(false);
  if (playing) scheduleFrom(currentPlayTime());
}

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
  if (/^GS_1$/i.test(c)) return { label, code: c, name: 'FreePats Spanish Classical Guitar', fallbackName: 'acoustic_guitar_nylon', guitarLibrary: true, gain: 0.9 };
  if (/^GEC2/i.test(c)) return { label, code: c, name: 'FSBS Electric Guitar Jazz', fallbackName: 'electric_guitar_clean', guitarLibrary: true, gain: 0.64 };
  if (/^GED/i.test(c)) return { label, code: c, name: 'FSBS Electric Guitar Distorted', fallbackName: 'distortion_guitar', guitarLibrary: true, gain: 0.58 };
  if (/^GEC|electric|eg/i.test(c)) return { label, code: c, name: 'FSBS Electric Guitar Clean', fallbackName: 'electric_guitar_clean', guitarLibrary: true, gain: 0.64 };
  if (/drum|chap/i.test(c)) return { label, code: c, name: 'synth_drum', gain: 0.74, drum: true };
  return { label, code: c || label, name: 'FSS Steel String Guitar', fallbackName: 'acoustic_guitar_steel', guitarLibrary: true, gain: 0.70 };
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
  const drumCodes = availableDrumCodes();
  if (drumCodes.length === 1) drumPatternSlot = 0;
  currentDrumCode = drumCodes[drumPatternSlot] || drumCodes[0] || null;
  updateToneButton();
  syncStartDrumToneMenu();
}

function rootFromChord(text) {
  const m = String(text || '').trim().match(/^([A-G])/i);
  return m ? m[1].toUpperCase() : null;
}



function parseChordNotes(chordName) {
  return runWasmCommand({ op: 'chordNotes', chord: chordName }).notes || [];
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

function warmSoundfontPreset(preset) {
  ensureAudio();
  // 只加载 SoundFont，不发任何试音。之前 0.0001 gain 在部分移动浏览器仍可能听见，
  // 所以倒计时 321 期间会莫名响一声。
  return getSoundfontInstrument(preset);
}

function warmHarmonyPreset(preset) {
  if (!preset) return Promise.resolve();
  ensureAudio();
  if (preset.guitarLibrary && window.FreezaGuitarSampler) {
    const priority = window.FreezaGuitarSampler.preload(audio.ctx, preset.code, warmHarmonyMidiSet());
    priority.finally(() => window.FreezaGuitarSampler.preloadAll(audio.ctx, preset.code));
    return priority;
  }
  if (preset.localPiano) {
    if (window.Tone) Promise.resolve(Tone.start()).catch(() => {});
    return Promise.resolve();
  }
  return warmSoundfontPreset(preset);
}

function fullyWarmHarmonyPreset(preset, onProgress = null) {
  if (!preset) return Promise.resolve([]);
  ensureAudio();
  if (preset.guitarLibrary && window.FreezaGuitarSampler) {
    return window.FreezaGuitarSampler.preloadAll(audio.ctx, preset.code, onProgress);
  }
  if (typeof onProgress === 'function') onProgress(0, 1);
  const promise = preset.localPiano
    ? Promise.resolve(sampleReadyPromise)
    : warmSoundfontPreset(preset);
  return Promise.resolve(promise).finally(() => {
    if (typeof onProgress === 'function') onProgress(1, 1);
  });
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
  return Number(runWasmCommand({ op: 'mapPatternPitch', pitch, chord: chordName }).midi);
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
  const explicitLines = (song?.lyricLineEvents || [])
    .map(e => {
      const data = e.data || {};
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





function lyricProgressState(line, now) {
  return runWasmCommand({
    op: 'lyricProgress',
    now,
    lineEnd: Number.isFinite(Number(line?.end)) ? Number(line.end) : null,
    events: (line?.events || []).map(event => ({
      time: Number(event.time) || 0,
      text: String(event.text || ''),
      cueStartTime: Number.isFinite(Number(event.cueStartTime)) ? Number(event.cueStartTime) : null,
      cueEndTime: Number.isFinite(Number(event.cueEndTime)) ? Number(event.cueEndTime) : null,
    })),
  });
}

function syncActiveKaraokeProgress(el, line, state) {
  const tokens = tokensForLine(line);
  const base = el?.querySelector('.lyric-base');
  const wrap = el?.querySelector('.lyric-wrap');
  if (!base || !wrap || !tokens.length) return null;
  const currentIndex = Number(state?.currentIndex ?? -1);
  const frac = Math.max(0, Math.min(1, Number(state?.fraction ?? 0)));
  if (currentIndex < 0) return null;
  const node = base.querySelector(`[data-kidx="${currentIndex}"]`);
  if (!node) return null;
  const br = base.getBoundingClientRect();
  const nr = node.getBoundingClientRect();
  // 紫色层按歌词内容宽度（max-content）裁剪；进度也必须以同宽的 base 为基准。
  // 长歌词会溢出 lyric-wrap，若使用 wrap.width 会把进度严重放大。
  const x = (nr.left - br.left) + nr.width * frac;
  const pct = Math.max(0, Math.min(100, (x / Math.max(1, br.width)) * 100));
  el.style.setProperty('--progress', `${pct.toFixed(2)}%`);
  // 特效必须使用和紫色裁剪边界完全相同的实际像素坐标，不能再用整行容器宽度。
  // 当前行在面板里居中，而歌词内容宽度通常远小于整行；以整行百分比换算会明显偏离文字。
  return {
    progress: pct,
    x: br.left + x,
    y: nr.top + nr.height * 0.56,
    tokenRect: nr,
  };
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

function splitTrailingChordSpaceLines(maxBlocksPerLine = 10) {
  const split = [];
  for (const line of lyricLines) {
    const events = [...(line.events || [])].sort((a, b) => a.time - b.time);
    let trailingStart = events.length;
    while (trailingStart > 0 && events[trailingStart - 1]?.chordSpace) trailingStart -= 1;
    const lyricEvents = events.slice(0, trailingStart);
    const blankEvents = events.slice(trailingStart);
    const hasLyrics = lyricEvents.some(event => String(event.text || '').trim());
    if (!hasLyrics || blankEvents.length < 2) {
      line.events = events;
      split.push(line);
      continue;
    }

    // 一句歌词结束后若还有多个无字和弦，不把一长串色块粘在歌词后面。
    // 原歌词行在第一个空格 cue 前结束，后续色块按最多十个组成独立行。
    const originalEnd = line.end;
    line.events = lyricEvents;
    line.end = Math.max(line.start, blankEvents[0].time);
    split.push(line);
    for (let i = 0; i < blankEvents.length; i += maxBlocksPerLine) {
      const chunk = blankEvents.slice(i, i + maxBlocksPerLine);
      const nextStart = blankEvents[i + maxBlocksPerLine]?.time;
      split.push({
        start: chunk[0].time,
        end: Math.max(chunk[0].time, nextStart ?? originalEnd),
        text: ' '.repeat(chunk.length),
        events: chunk,
        paragraphType: line.paragraphType,
        chordOnly: true,
      });
    }
  }
  lyricLines = split.sort((a, b) => a.start - b.start);
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
  splitTrailingChordSpaceLines();
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

function ensureKaraokeLines(lineCount) {
  const box = document.querySelector('.karaoke');
  if (!box) return [];
  const status = box.querySelector('.karaoke-status');
  for (let i = 1; i <= lineCount; i++) {
    if (!$(`lyricLine${i}`)) {
      const div = document.createElement('div');
      div.id = `lyricLine${i}`;
      div.className = `karaoke-line ${i === 1 ? 'active' : 'next'}`;
      box.insertBefore(div, status || null);
    }
  }
  return Array.from({ length: lineCount }, (_, i) => $(`lyricLine${i + 1}`)).filter(Boolean);
}

function karaokeLayoutMetrics(box = document.querySelector('.karaoke')) {
  if (!box) return { count: 1, fontSize: 16, activeFontSize: 19 };
  const style = getComputedStyle(box);
  const availableHeight = Math.max(1, box.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0));
  const availableWidth = Math.max(1, box.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0));
  const lengths = lyricLines.map(line => [...String(line?.text || '')].length).filter(Boolean).sort((a, b) => a - b);
  const representativeLength = lengths.length ? lengths[Math.floor((lengths.length - 1) * 0.9)] : 10;
  const geometricFont = Math.sqrt(availableWidth * availableHeight) * 0.05;
  const widthLimitedFont = availableWidth * 0.92 / Math.max(1, representativeLength + 1);
  const fontSize = Math.max(12, Math.min(geometricFont, widthLimitedFont));
  const activeFontSize = fontSize * 1.18;
  const rowHeight = fontSize * 1.23;
  const activeExtra = activeFontSize - fontSize;
  const resolutionCount = Math.max(1, Math.floor((availableHeight - activeExtra) / Math.max(1, rowHeight)));
  const count = lyricLines.length ? Math.min(lyricLines.length, resolutionCount) : resolutionCount;
  box.style.setProperty('--lyric-font-size', `${fontSize.toFixed(2)}px`);
  box.style.setProperty('--active-lyric-font-size', `${activeFontSize.toFixed(2)}px`);
  box.style.setProperty('--lyric-row-height', `${rowHeight.toFixed(2)}px`);
  return { count, fontSize, activeFontSize, rowHeight, availableHeight, availableWidth };
}

function updateLyrics() {
  const box = document.querySelector('.karaoke');
  const { count } = karaokeLayoutMetrics(box);
  const lines = ensureKaraokeLines(count);
  const l1 = lines[0];
  if (!lines.every(Boolean)) return;
  if (box) box.style.setProperty('--lyric-lines', count);
  box?.querySelectorAll('.karaoke-line').forEach((line, i) => { line.style.display = i < count ? '' : 'none'; });
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
  const progressState = lyricProgressState(cur, now);
  const progress = Number(progressState.progress || 0);
  const activeSlot = Math.min(lines.length - 1, Math.max(0, Math.floor(lines.length * 0.62)));
  const startIdx = Math.max(0, Math.min(idx - activeSlot, Math.max(0, lyricLines.length - lines.length)));
  let activeEl = l1;
  for (let i = 0; i < lines.length; i++) {
    const lineIndex = startIdx + i;
    const active = lineIndex === idx;
    if (active) activeEl = lines[i];
    setKaraokeLine(lines[i], lyricLines[lineIndex] || '', active ? progress : 0, active);
  }
  const visualProgress = syncActiveKaraokeProgress(activeEl, cur, progressState);
  if (playing) emitLyricParticles(visualProgress);
}

function lyricCharAt(time) {
  const ev = lyricEventAt(time, 0.72);
  return ev && String(ev.text).trim() ? [...ev.text].at(-1) : '';
}

function emitLyricParticles(visualProgress) {
  const now = performance.now();
  const progress = Number(visualProgress?.progress);
  if (now - lastLyricParticleAt < 95 || progress <= 0 || progress >= 99.5) return;
  const x = Number(visualProgress.x);
  const y = Number(visualProgress.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  lastLyricParticleAt = now;
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

async function loadSongMidi(songConfig) {
  try {
    await loadPatternManifest();
    if (!songConfig?.path) throw new Error('未选择歌曲');
    const res = await fetch(songConfig.path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = await res.arrayBuffer();
    song = await parseMidiWithWasm(buffer);
    song.catalog = songConfig;
    // MIDI、歌词、和弦与全部 LiberLive 私有事件只有 WASM 一个权威解析器。
    userPickEvents = [];
    if (initialPickSlot !== null) insertUserPickEvent(initialPickSlot, 0);
    const summary = song.noteTracks.map(t => `Track ${t.number}:${t.notes.length}`).join(' / ');
    setPill('midiStatus', `✅ MIDI 已加载：${song.trackCount} 轨 · WASM`, 'ok');
    setPill('trackStatus', `只播放 Track 1 主旋律 · ${song.melodyTrack.notes.length} 音 · ${summary}`, song.melodyTrack.notes.length ? 'ok' : 'warn');
    refreshHarmonyTonesFromStyle(song.styleInfo);
    updateCurrentKeyStatus();
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

function songConfigById(id) {
  return SONG_CATALOG.find(item => item.id === id) || null;
}

function updateSongSelectionUi(message = '') {
  document.querySelectorAll('#songScreen [data-song-id]').forEach(card => {
    const selected = card.dataset.songId === selectedSongId;
    card.classList.toggle('selected', selected);
    card.classList.toggle('loading', selected && songSelectionPending);
    card.disabled = songSelectionPending;
  });
  const status = $('songSelectStatus');
  if (status) status.textContent = message || (selectedSongId ? '曲目已准备' : '请选择一首歌曲');
}

function renderSongCatalog() {
  const grid = $('songGrid');
  if (!grid) return;
  grid.replaceChildren();
  const count = $('songLibraryCount');
  if (count) count.textContent = String(SONG_CATALOG.length).padStart(2, '0');

  for (const config of SONG_CATALOG) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `song-card song-card-${config.theme || 'spectrum'}`;
    card.dataset.songId = config.id;
    card.style.setProperty('--song-hue', String(config.hue ?? 262));

    const art = document.createElement('span');
    art.className = 'song-art';
    art.setAttribute('aria-hidden', 'true');
    const artPrimary = document.createElement('i');
    const artSecondary = document.createElement('i');
    if (config.theme === 'moon') {
      artPrimary.className = 'song-art-moon';
      artSecondary.className = 'song-art-rings';
    } else {
      artPrimary.className = 'song-art-orbit';
      artSecondary.className = 'song-art-wave';
    }
    const initial = document.createElement('b');
    initial.textContent = Array.from(config.title)[0] || '♪';
    art.append(artPrimary, artSecondary, initial);

    const content = document.createElement('span');
    content.className = 'song-card-content';
    const kicker = document.createElement('span');
    kicker.className = 'song-card-kicker';
    kicker.textContent = 'PERFORMANCE';
    const title = document.createElement('strong');
    title.textContent = config.title;
    const artist = document.createElement('em');
    artist.textContent = config.artist;
    const tags = document.createElement('span');
    tags.className = 'song-tags';
    for (const value of [config.subtitle, config.duration, `${config.bpm} BPM`, config.tone]) {
      const tag = document.createElement('i');
      tag.textContent = value;
      tags.append(tag);
    }
    content.append(kicker, title, artist, tags);

    const action = document.createElement('span');
    action.className = 'song-card-action';
    const actionLabel = document.createElement('b');
    actionLabel.textContent = '选择曲目';
    const arrow = document.createElement('i');
    arrow.textContent = '→';
    action.append(actionLabel, arrow);
    card.append(art, content, action);
    grid.append(card);
  }
}

async function selectSong(songId) {
  if (songSelectionPending) return;
  const config = songConfigById(songId);
  if (!config) return;
  selectedSongId = config.id;
  songSelectionPending = true;
  midiReady = false;
  song = null;
  lyricLines = [];
  updateSongSelectionUi(`正在载入《${config.title}》…`);
  midiReadyPromise = loadSongMidi(config);
  try {
    await midiReadyPromise;
    const selectedStatus = $('selectedSongStatus');
    if (selectedStatus) selectedStatus.textContent = `${config.title} · ${config.artist}`;
    const gameTitle = $('gameSongTitle');
    if (gameTitle) {
      gameTitle.textContent = config.title;
      gameTitle.title = `${config.title} · ${config.artist}`;
    }
    document.body.classList.add('song-selected');
    $('songScreen')?.setAttribute('aria-hidden', 'true');
    $('startScreen')?.setAttribute('aria-hidden', 'false');
    updateSongSelectionUi(`《${config.title}》已载入`);
  } catch (error) {
    console.warn('Song selection failed:', error);
    updateSongSelectionUi(`载入失败：${error.message}`);
  } finally {
    songSelectionPending = false;
    updateSongSelectionUi(song ? `《${config.title}》已载入` : `载入失败，请重试`);
  }
}

function setupSongScreen() {
  const screen = $('songScreen');
  if (!screen) return;
  renderSongCatalog();
  setupLaunchUiSounds(screen);
  screen.querySelectorAll('[data-song-id]').forEach(card => {
    card.addEventListener('click', () => {
      selectSong(card.dataset.songId);
    });
  });
  updateSongSelectionUi();
}
function scheduleFrom(offset = 0, preserveInteractive = false, skipChordCueAtOffset = false) {
  if (!song || !song.melodyTrack.notes.length) return;
  if (!preserveInteractive) resetInteractiveSequencer();
  clearTimers();
  playing = true;
  updatePlayButton();
  playOffset = offset;
  playStartedAt = performance.now();
  const notes = song.melodyTrack.notes.filter(e => e.time >= offset && shouldAutoPlayMelodyAt(e.time));
  for (const e of notes) {
    const delay = Math.max(0, (e.time - offset) * 1000);
    timers.push(setTimeout(() => playVisualNote(shiftedMidi(e.note), e.velocity, 'playback'), delay));
  }
  scheduleDrumsFrom(offset);
  if (isAutoChordMode()) scheduleAutoHarmonyFrom(offset);
  else scheduleChordCues(offset, skipChordCueAtOffset);
  timers.push(setTimeout(finishPlayback, Math.max(0, (song.duration - offset) * 1000) + 900));
  clockTimer = setInterval(() => { updateClock(); updateLyrics(); }, 33);
  updateClock();
  updateLyrics();
  updatePlayButton();
}

function scheduleDrumsFrom(offset = 0) {
  if (!drumsEnabled || drumMode === 'off') return;
  if (drumMode === 'auto') {
    if (song?.drumEvents?.length) return scheduleAutomatedDrumsFrom(offset);
    return;
  }
  const pattern = currentDrumPattern();
  if (!pattern?.notes?.length || !song?.duration) return;
  prepareDrumPattern(pattern, currentDrumCode || pattern.code);
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
      timers.push(setTimeout(() => playDrumPatternNote(n, currentDrumCode || pattern.code), delay));
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
    prepareDrumPattern(pattern, code);
    scheduleDrumPatternWindow(pattern, code, Math.max(offset, ev.time), ev.time, Math.min(end, song.duration), offset);
  }
}

function scheduleDrumPatternWindow(pattern, drumCode, fromTime, anchorTime, endTime, offset) {
  const plan = runWasmCommand({
    op: 'patternWindow',
    notes: pattern.notes,
    beatSec: beatMs() / 1000,
    barBeats: patternBeats(pattern),
    fromTime,
    anchorTime,
    endTime: Math.min(endTime, (song?.duration || endTime) + 0.5),
  });
  for (const event of plan.events || []) {
    const delay = Math.max(0, (Number(event.time) - offset) * 1000);
    timers.push(setTimeout(() => playDrumPatternNote(event.note, drumCode || pattern.code), delay));
  }
}
function clearTimers() {
  clearCountdown();
  timers.forEach(clearTimeout); timers = [];
  cueTimers.forEach(clearTimeout); cueTimers = [];
  cancelAnimationFrame(cueRuntimeRaf); cueRuntimeRaf = null;
  activeCue = null;
  clearHarmonyTimers();
  harmonyAutoTimers.forEach(clearTimeout);
  harmonyAutoTimers = [];
  manualMelodyTimers.forEach(clearTimeout);
  manualMelodyTimers = [];
  clearInterval(clockTimer); clockTimer = null;
  document.querySelectorAll('#manualKeyboard .chord-cue, #manualKeyboard .chord-due').forEach(k => {
    k.classList.remove('chord-cue', 'chord-due', 'chord-press', 'chord-release', 'chord-hit');
    k.style.removeProperty('--chord-scale');
  });
  document.querySelectorAll('#manualKeyboard .chord-symbol').forEach(el => { el.textContent = ''; });
  cueState.clear();
}


function scheduleAutoHarmonyFrom(offset = 0) {
  // 自动模式 = 半自动的自动按键版：先出现提示，到点自动按下并产生同样特效。
  if (!song?.chordCues?.length) return;
  nextCueIndex = song.chordCues.findIndex(c => c.time >= offset - 0.02);
  if (nextCueIndex < 0) nextCueIndex = song.chordCues.length;
  activeCue = null;
  startCueRuntimeLoop();
}


function scheduleChordCues(offset = 0, skipCueAtOffset = false) {
  if (!song?.chordCues?.length) return;
  const threshold = skipCueAtOffset ? offset + 0.02 : offset - 0.02;
  nextCueIndex = song.chordCues.findIndex(c => c.time >= threshold);
  if (nextCueIndex < 0) nextCueIndex = song.chordCues.length;
  activeCue = null;
  startCueRuntimeLoop();
}

function startCue(midi, cue) {
  // 取消上一个 cue 安排的延迟清理，避免它把本次 cue 的提示字擦掉。
  clearTimeout(cueCleanupTimer);
  clearManualCueVisuals();
  document.querySelectorAll(`#manualKeyboard .key[data-midi="${midi}"]`).forEach(k => {
    const perfNow = performance.now();
    const due = playing ? playStartedAt + (cue.time - playOffset) * 1000 : perfNow + Math.max(0, (cue.time - currentPlayTime()) * 1000);
    cueState.set(k.dataset.root, { start: due - 1000, due, end: due + 400, cueId: cue?._id });
    const symbol = k.querySelector('.chord-symbol');
    if (symbol) {
      const display = cueLyricDisplayForCue(cue);
      symbol.textContent = display.text;
      symbol.dataset.text = display.text;
      symbol.classList.toggle('blank', !!display.blank);
      symbol.dataset.cueId = cue?._id || '';
      delete symbol.dataset.floatShattered;
      symbol.classList.remove('hit', 'fail');
    }
    k.classList.remove('chord-due', 'chord-press', 'chord-release');
    k.classList.remove('chord-cue');
    setCueFillProgress(k, 0);
    void k.offsetWidth;
    k.classList.add('chord-cue');
  });
}

function hitCue(midi, cue) {
  document.querySelectorAll(`#manualKeyboard .key[data-midi="${midi}"]`).forEach(k => {
    if (cue?._id && k.dataset.cueId && k.dataset.cueId !== cue._id) return;
    k.classList.add('chord-due');
  });
}

function clearManualCueVisuals() {
  document.querySelectorAll('#manualKeyboard .chord-cue, #manualKeyboard .chord-due').forEach(k => {
    k.classList.remove('chord-cue', 'chord-due', 'chord-press', 'chord-release', 'chord-hit');
    k.style.removeProperty('--chord-scale');
    delete k.dataset.cueId;
  });
  document.querySelectorAll('#manualKeyboard .chord-symbol').forEach(el => {
    el.textContent = '';
    el.classList.remove('blank', 'hit', 'fail');
    delete el.dataset.floatShattered;
    delete el.dataset.cueId;
  });
  cueState.clear();
}

let cueCleanupTimer = null;

function finishActiveCue() {
  if (!activeCue) return;
  document.querySelectorAll('#manualKeyboard .chord-symbol').forEach(el => {
    if (el.textContent && !el.classList.contains('hit')) {
      burstChordSymbol(el);
      el.classList.add('hit');
      el.closest('.key')?.classList.add('chord-hit');
    }
  });
  clearTimeout(cueCleanupTimer);
  cueCleanupTimer = setTimeout(clearManualCueVisuals, 620);
  activeCue = null;
}

function burstChordSymbol(el) {
  if (!el || el.dataset.floatShattered === '1') return;
  el.dataset.floatShattered = '1';
  const key = el.closest('.key');
  if (!key) return;
  const text = el.classList.contains('blank') ? '' : (el.dataset.text || el.textContent || '');
  const count = text ? 8 : 5;
  for (let i = 0; i < count; i++) {
    const shard = document.createElement('span');
    shard.className = 'chord-shard';
    const angle = -Math.PI / 2 + (Math.random() - .5) * Math.PI * 1.4;
    const dist = 14 + Math.random() * 30;
    shard.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    shard.style.setProperty('--dy', `${Math.sin(angle) * dist - Math.random() * 10}px`);
    shard.style.setProperty('--rot', `${Math.random() * 160 - 80}deg`);
    shard.style.setProperty('--s', `${3 + Math.random() * 5}px`);
    shard.style.setProperty('--delay', `${Math.random() * .06}s`);
    key.appendChild(shard);
    setTimeout(() => shard.remove(), 720);
  }
}

// 没按/按早/按错：整键轻微快速摇晃，不显示 X（docs/UI.md）。
function failActiveCue(showMissRating = true) {
  if (!activeCue) return;
  document.querySelectorAll(`#manualKeyboard .key[data-midi="${activeCue.midi}"]`).forEach(k => {
    if (!activeCue.cue?._id || !k.dataset.cueId || k.dataset.cueId === activeCue.cue._id) {
      if (showMissRating) showTimingRating(k, 'MISS');
      k.classList.remove('chord-miss');
      void k.offsetWidth;
      k.classList.add('chord-miss');
      setTimeout(() => k.classList.remove('chord-miss'), 820);
    }
  });
  document.querySelectorAll('#manualKeyboard .chord-symbol').forEach(el => {
    if (el.textContent && !el.classList.contains('hit')) {
      el.classList.add('fail');
    }
  });
  clearTimeout(cueCleanupTimer);
  cueCleanupTimer = setTimeout(clearManualCueVisuals, 620);
  activeCue = null;
}

function rejectEarlyChordPress(key) {
  if (!key) return;
  key.classList.remove('chord-early-reject');
  void key.offsetWidth;
  key.classList.add('chord-early-reject');
  setTimeout(() => key.classList.remove('chord-early-reject'), 460);
  if (navigator.vibrate) navigator.vibrate(35);
}

function startCueRuntimeLoop() {
  cancelAnimationFrame(cueRuntimeRaf);
  const loop = () => {
    updateCueRuntime();
    cueRuntimeRaf = requestAnimationFrame(loop);
  };
  loop();
}

function setCueFillProgress(key, progress) {
  const scale = Math.max(0, Math.min(1, progress / 140));
  key.style.setProperty('--chord-scale', scale.toFixed(4));
}

function updateCueRuntime() {
  if ((!playing && !isManualMode()) || !song?.chordCues?.length) return;
  const now = currentPlayTime();
  if (activeCue) {
    const progress = 100 + (now - activeCue.cue.time) * 100;
    document.querySelectorAll(`#manualKeyboard .key[data-midi="${activeCue.midi}"]`).forEach(k => {
      if (!activeCue.cue?._id || !k.dataset.cueId || k.dataset.cueId === activeCue.cue._id) {
        setCueFillProgress(k, progress);
      }
    });
    if (!activeCue.hit && now >= activeCue.cue.time) {
      activeCue.hit = true;
      hitCue(activeCue.midi, activeCue.cue);
      if (isAutoChordMode()) autoPressCue(activeCue);
    }
    // 生命周期 140%：应按点后 0.4s（110% 之后仍未按 → miss 打叉）。
    if (now >= activeCue.cue.time + 0.4) {
      if (activeCue.pressed) finishActiveCue();
      else failActiveCue();
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
  clearCountdownCuePreview();
  const el = $('countdownOverlay');
  if (el) {
    el.classList.remove('show', 'pop');
    el.textContent = '';
  }
}

function clearCountdownCuePreview() {
  document.querySelectorAll('#manualKeyboard .countdown-cue-preview').forEach(key => {
    key.classList.remove('countdown-cue-preview');
    const symbol = key.querySelector('.chord-symbol[data-countdown-preview="1"]');
    if (symbol) {
      symbol.textContent = '';
      delete symbol.dataset.countdownPreview;
    }
  });
}

function showCountdownCuePreview() {
  clearCountdownCuePreview();
  const cue = (song?.chordCues || []).find(item => item?.root && NATURAL_TO_MIDI[item.root]);
  if (!cue) return;
  const midi = NATURAL_TO_MIDI[cue.root];
  document.querySelectorAll(`#manualKeyboard .key[data-midi="${midi}"]`).forEach(key => {
    const symbol = key.querySelector('.chord-symbol');
    if (!symbol) return;
    symbol.textContent = shiftedRootLabel(cue.root);
    symbol.dataset.countdownPreview = '1';
    key.classList.add('countdown-cue-preview');
  });
}

function enterPlaybackAfterCountdown() {
  if (isManualMode()) {
    if (guideMode) {
      playManualGuideIntro();
      return;
    }
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

function playManualGuideIntro() {
  const introEnd = Math.min(song?.duration || 0, firstRealLyricStart());
  if (!Number.isFinite(introEnd) || introEnd <= 0.001) {
    playing = false;
    playOffset = 0;
    ensureManualClock();
    scheduleChordCues(0);
    updateClock();
    updateLyrics();
    return;
  }
  clearTimers();
  playing = true;
  playOffset = 0;
  playStartedAt = performance.now();
  updatePlayButton();
  startRecording();
  for (const note of song.melodyTrack.notes.filter(note => note.time < introEnd - 0.001)) {
    const delay = Math.max(0, note.time * 1000);
    timers.push(setTimeout(() => playVisualNote(shiftedMidi(note.note), note.velocity, 'playback'), delay));
  }
  clockTimer = setInterval(() => { updateClock(); updateLyrics(); }, 33);
  timers.push(setTimeout(() => {
    clearTimers();
    playing = false;
    playOffset = introEnd;
    const nextIndex = song.melodyTrack.notes.findIndex(note => note.time >= introEnd - 0.001);
    nextManualMelodyIndex = nextIndex < 0 ? song.melodyTrack.notes.length : nextIndex;
    ensureManualClock();
    scheduleChordCues(introEnd);
    updatePlayButton();
    updateClock();
    updateLyrics();
  }, introEnd * 1000));
}

function setLoadingStatus(text) {
  const el = $('loadingText');
  if (el) el.textContent = text;
}

const loadingCategoryProgress = new Map();
const LOADING_CATEGORY_IDS = ['core', 'piano', 'pickA', 'pickB', 'drums', 'mic'];

function updateLoadingOverall() {
  const values = LOADING_CATEGORY_IDS.map(id => loadingCategoryProgress.get(id) || 0);
  const progress = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const percent = Math.round(progress * 100);
  const label = $('loadingPercent');
  const bar = $('loadingOverallBar');
  if (label) label.textContent = `${percent}%`;
  if (bar) bar.style.width = `${percent}%`;
}

function setLoadingCategory(id, progress, detail = '', state = '') {
  const normalized = Math.max(0, Math.min(1, Number(progress) || 0));
  loadingCategoryProgress.set(id, normalized);
  const item = document.querySelector(`.launch-loading-item[data-load-id="${id}"]`);
  if (item) {
    item.style.setProperty('--load-progress', normalized.toFixed(4));
    item.classList.remove('loading', 'done', 'error');
    const stateClass = state || (normalized >= 1 ? 'done' : normalized > 0 ? 'loading' : '');
    if (stateClass) item.classList.add(stateClass);
    const description = item.querySelector('small');
    const status = item.querySelector('b');
    if (description && detail) description.textContent = detail;
    if (status) status.textContent = state === 'error' ? '部分可用' : normalized >= 1 ? '完成' : normalized > 0 ? `${Math.round(normalized * 100)}%` : '等待';
  }
  updateLoadingOverall();
}

function resetLoadingProgress() {
  loadingCategoryProgress.clear();
  LOADING_CATEGORY_IDS.forEach(id => setLoadingCategory(id, 0));
  setLoadingStatus('正在检查演奏资源…');
}

function drumSelectionsForSong() {
  const codes = new Set(availableDrumCodes().slice(0, 2));
  if (currentDrumCode) codes.add(currentDrumCode);
  for (const event of song?.drumEvents || []) {
    const code = resolveDrumPatternCode(event.drumCodes);
    if (code) codes.add(code);
  }
  return [...codes]
    .map(code => [patterns.byCode.get(code), code])
    .filter(([pattern]) => pattern?.notes?.length);
}

async function loadAllSongDrums() {
  const selections = drumSelectionsForSong();
  if (!selections.length) {
    setLoadingCategory('drums', 1, '歌曲未使用鼓机');
    return;
  }
  const counters = new Map(selections.map(([pattern, code]) => [code, {
    done: 0,
    total: Math.max(1, new Set(pattern.notes.map(note => drumPitchToMidi(note.pitch))).size),
  }]));
  const refresh = () => {
    const values = [...counters.values()];
    const done = values.reduce((sum, value) => sum + value.done, 0);
    const total = values.reduce((sum, value) => sum + value.total, 0);
    setLoadingCategory('drums', total ? done / total : 1, `${selections.length} 套歌曲鼓组`);
  };
  refresh();
  await Promise.all(selections.map(([pattern, code]) => prepareDrumPattern(pattern, code, (done, total) => {
    counters.set(code, { done, total: Math.max(1, total) });
    refresh();
  })));
  setLoadingCategory('drums', 1, `${selections.length} 套歌曲鼓组`);
}

async function loadHarmonyCategory(id, preset) {
  if (!preset) {
    setLoadingCategory(id, 1, '当前风格未配置');
    return;
  }
  const detail = preset.name || preset.code || `拨片 ${preset.label || ''}`;
  setLoadingCategory(id, 0.01, detail);
  await fullyWarmHarmonyPreset(preset, (done, total) => {
    setLoadingCategory(id, total ? done / total : 1, detail);
  });
  setLoadingCategory(id, 1, detail);
}

async function prepareStartAssets() {
  setLoadingStatus('解析 MIDI / WASM / 风格包…');
  setLoadingCategory('core', 0.08, '解析 MIDI · WASM · 风格包');
  await (midiReadyPromise || Promise.resolve());
  setLoadingCategory('core', 1, `${song?.trackCount || 0} 轨 · 风格已解析`);
  setLoadingStatus('启动音频引擎并缓存全部音色…');
  ensureAudio();
  if (window.Tone) await Promise.resolve(Tone.start()).catch(() => {});
  setLoadingCategory('piano', 0.05, '等待钢琴采样解码');
  const pianoTask = Promise.resolve(sampleReadyPromise)
    .then(() => setLoadingCategory('piano', 1, '钢琴采样已缓存'))
    .catch(error => {
      console.warn('Piano preload failed:', error);
      setLoadingCategory('piano', 1, '使用 WebAudio 备用音色', 'error');
    });
  const categoryTasks = [
    pianoTask,
    loadHarmonyCategory('pickA', HARMONY_TONES[0]).catch(error => {
      console.warn('Pick A preload failed:', error);
      setLoadingCategory('pickA', 1, '备用音色可用', 'error');
    }),
    loadHarmonyCategory('pickB', HARMONY_TONES[1] || HARMONY_TONES[0]).catch(error => {
      console.warn('Pick B preload failed:', error);
      setLoadingCategory('pickB', 1, '备用音色可用', 'error');
    }),
    loadAllSongDrums().catch(error => {
      console.warn('Drum preload failed:', error);
      setLoadingCategory('drums', 1, '合成鼓组可用', 'error');
    }),
  ];
  if (micEnabled) {
    setLoadingCategory('mic', 0.1, '等待浏览器授权');
    categoryTasks.push(ensureMic().then(ready => {
      setLoadingCategory('mic', 1, ready ? '录音输入已连接' : '未获得权限', ready ? 'done' : 'error');
    }));
  } else {
    setLoadingCategory('mic', 1, '当前未启用');
  }
  await Promise.all(categoryTasks);
  setLoadingStatus('全部演奏资源已就绪');
}

function startCountdownThenPlay() {
  const el = $('countdownOverlay');
  const steps = ['3', '2', '1'];
  let i = 0;
  showCountdownCuePreview();
  const tick = () => {
    if (!el) return playPlayback();
    el.textContent = steps[i];
    el.classList.add('show');
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
  if (playOffset <= 0.01 || playOffset >= song.duration) {
    nextManualMelodyIndex = 0;
    resetHarmonyHalfSequence();
  }
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
  active.pressed = true;
  const root = active.cue.root || rootFromChord(active.cue.chord) || 'C';
  const keys = document.querySelectorAll(`#manualKeyboard .key[data-root="${root}"]`);
  recordTimingGrade('SSS');
  keys.forEach(key => {
    showTimingRating(key, 'SSS', false);
    showPickZoneFeedback(key, chordPatternSlotAtTime(active.cue.time));
    key.classList.remove('chord-due', 'miss', 'chord-release');
    key.classList.add('chord-press');
    setTimeout(() => {
      key.classList.remove('chord-press');
      key.classList.add('chord-release');
      setTimeout(() => key.classList.remove('chord-release'), 220);
    }, 520);
  });
  playStyledHarmony(root, active.cue);
  cueState.delete(root);
}

function showPickZoneFeedback(key, slot) {
  if (!key) return;
  const normalized = slot > 0 ? 1 : 0;
  key.dataset.pick = normalized ? 'B' : 'A';
  const zone = key.querySelector(`.pick-zone[data-pick-slot="${normalized}"]`);
  if (!zone) return;
  zone.classList.remove('picked');
  void zone.offsetWidth;
  zone.classList.add('picked');
  setTimeout(() => zone.classList.remove('picked'), 420);
}

function normalizedHarmonyVelocity(rawVelocity) {
  const raw = Number(rawVelocity || 56) / 127;
  // 网页采样比原机声卡弱，不能直接把 pattern velocity 当最终音量。
  // 保留强弱，但给伴奏单音足够的输出下限，避免听起来整体小一截。
  return Math.max(0.42, Math.min(0.92, raw * 1.32));
}

function playStyledHarmony(root, forcedCue = null, timeScale = 1) {
  clearHarmonyTimers();
  const now = currentPlayTime();
  const cue = forcedCue || chordAtTime(now) || { chord: root, root };
  const chordName = chordNameForPerformedRoot(root, cue);
  const scheduled = [];
  let segmentEnd = nextChordCueTimeAfter(Number.isFinite(cue?.time) ? cue.time : now);
  if (!Number.isFinite(segmentEnd) || segmentEnd <= now + 0.02) segmentEnd = Math.min(song?.duration || now + 1.8, now + 1.8);
  warmHarmonyTones(false);
  const { slot, code, pattern } = chordPatternAtTime(now);
  if (pattern?.notes?.length) {
    const half = nextHarmonyHalfForRoot(root);
    // 和弦结构、pattern 前后半切分、音高映射和 BPM 布局统一由 WASM 计算。
    const plan = runWasmCommand({
      op: 'harmonyPlan',
      chord: chordName,
      half,
      bpm: Number(song?.styleInfo?.tempo) || 75,
      barBeats: patternBeats(pattern),
      notes: pattern.notes,
    });
    for (const event of plan.events || []) {
      const velocity = normalizedHarmonyVelocity(event.velocity);
      scheduled.push(playHarmonyVisualNote(
        Number(event.midi),
        Number(event.delay) * timeScale * 1000,
        Math.max(0.045, Number(event.duration) * timeScale),
        velocity,
        slot + 1,
      ));
    }
    return { root, cue, segmentEnd, events: scheduled };
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
    const speed = Math.max(0.25, Math.min(1.12, timeScale, targetEnd / naturalEnd));
    for (const n of fallbackNotes) {
      const delay = Math.max(0, (n.time - start) * 1000 * speed);
      scheduled.push(playHarmonyVisualNote(shiftedMidi(n.note), delay, Math.max(0.08, Number(n.duration || 0.45) * speed), normalizedHarmonyVelocity((n.velocity || 0.48) * 127), harmonyToneMode));
    }
    console.warn('No LiberLive chord pattern loaded; using Track 2 fallback chord notes for', code || currentHarmonyPreset()?.code);
    return { root, cue, segmentEnd, events: scheduled };
  }

  console.warn('No LiberLive chord pattern or Track 2 fallback loaded for', code || currentHarmonyPreset()?.code);
  return { root, cue, segmentEnd, events: scheduled };
}
function pausePlayback() {
  if (!playing) return;
  playOffset += (performance.now() - playStartedAt) / 1000;
  playing = false;
  updatePlayButton();
  clearTimers();
  resetInteractiveSequencer();
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
  resetInteractiveSequencer();
  resetHarmonyHalfSequence();
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
  resetInteractiveSequencer();
  resetHarmonyHalfSequence();
  stopRecording(true);
  releaseWakeLock();
  updateClock();
  updateLyrics();
  document.querySelectorAll('.key.active').forEach(k => k.classList.remove('active'));
  $('nowPlaying').textContent = '播放完成';
  showPerformanceResults();
}
function restartPlayback() { resetTimingRatings(); stopPlayback(); playPlayback(); }

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

function playNextManualMelodyNote(timeScale = 1) {
  const notes = song?.melodyTrack?.notes || [];
  if (!notes.length || nextManualMelodyIndex >= notes.length) return { events: [], segmentEnd: playOffset };
  ensureManualClock();

  const startIndex = nextManualMelodyIndex;
  const startTime = notes[startIndex].time;
  const nextCue = (song?.chordCues || []).find(c => c.time > startTime + 0.08);
  // 最后一个和弦必须把剩余主旋律完整播完，不能只截取固定 1.8 秒后永远到不了结算。
  const chunkEnd = Math.min(song?.duration || Infinity, nextCue?.time ?? (song?.duration || startTime + 1.8));
  let endIndex = notes.findIndex((n, i) => i > startIndex && n.time >= chunkEnd - 0.001);
  if (endIndex < 0) endIndex = nextCue ? Math.min(notes.length, startIndex + 8) : notes.length;
  endIndex = Math.max(endIndex, startIndex + 1);

  const chunk = notes.slice(startIndex, endIndex);
  playing = false;

  const events = chunk.map((note, localIndex) => {
    const idx = startIndex + localIndex;
    const delay = Math.max(0, (note.time - startTime) * timeScale * 1000);
    const event = { note, idx, dueAt: performance.now() + delay, fired: false, timer: null };
    event.timer = setTimeout(() => {
      event.fired = true;
      playOffset = note.time;
      playVisualNote(shiftedMidi(note.note), note.velocity || 0.65, 'playback');
      if (nextManualMelodyIndex <= idx) nextManualMelodyIndex = idx + 1;
      updateClock();
      updateLyrics();
    }, delay);
    manualMelodyTimers.push(event.timer);
    return event;
  });
  return { events, segmentEnd: chunkEnd, endIndex, startTime };
}

function resetInteractiveSequencer() {
  interactivePhrase = null;
  interactiveTransitioning = false;
  interactivePressQueue = [];
}

function nextCueAfter(cue) {
  const cues = song?.chordCues || [];
  const index = cue ? cues.indexOf(cue) : -1;
  return index >= 0 ? (cues[index + 1] || null) : null;
}

function cueForInteractivePress(root) {
  let cue = activeCue?.cue || chordAtTime(currentPlayTime()) || null;
  if (interactivePhrase?.cue && cue === interactivePhrase.cue) {
    const next = nextCueAfter(interactivePhrase.cue);
    if (next && (!root || next.root === root || rootFromChord(next.chord) === root)) cue = next;
  }
  return cue || { chord: root, root, time: currentPlayTime() };
}

function timingForInteractivePhrase(cue, timing = {}) {
  const nowSong = currentPlayTime();
  const nowPerf = performance.now();
  const cueTime = Number.isFinite(Number(cue?.time)) ? Number(cue.time) : nowSong;
  const nextTime = nextChordCueTimeAfter(cueTime);
  return runWasmCommand({
    op: 'interactiveTiming',
    nowSong,
    nowPerf,
    cueTime,
    nextTime,
    songDuration: song?.duration || cueTime + 1.8,
    progress: Number.isFinite(Number(timing.progress)) ? Number(timing.progress) : null,
    dueAt: Number(timing.dueAt || nowPerf),
  });
}

function startInteractivePhraseNow(root, cue, timing = {}) {
  clearHarmonyTimers();
  const scheduleTiming = timingForInteractivePhrase(cue, timing);
  let melody = { events: [], segmentEnd: scheduleTiming.boundary };
  if (isManualMode()) {
    clearManualMelodyTimers();
    melody = playNextManualMelodyNote(scheduleTiming.timeScale);
  }
  const harmony = playStyledHarmony(root, cue, scheduleTiming.timeScale);
  interactivePhrase = {
    root,
    cue: harmony?.cue || cue,
    segmentEnd: Math.max(Number(melody?.segmentEnd || 0), Number(harmony?.segmentEnd || 0)),
    melodyEvents: melody?.events || [],
    harmonyEvents: harmony?.events || [],
  };
  if (isManualMode() && !nextCueAfter(interactivePhrase.cue)) {
    const finalPhrase = interactivePhrase;
    const finalDueAt = [
      ...finalPhrase.melodyEvents.map(event => event.dueAt + Number(event.note?.duration || 0.45) * 1000),
      ...finalPhrase.harmonyEvents.map(event => event.dueAt + Number(event.duration || 0.45) * 1000),
    ].reduce((latest, dueAt) => Math.max(latest, dueAt), performance.now());
    const completionTimer = setTimeout(() => {
      if (interactivePhrase === finalPhrase && !interactiveTransitioning) finishPlayback();
    }, Math.max(0, finalDueAt - performance.now()) + 500);
    manualMelodyTimers.push(completionTimer);
  }
}

function beginInteractivePhrase(root, cue, timing = {}) {
  const scheduleTiming = timingForInteractivePhrase(cue, timing);
  if (scheduleTiming.earlyRejected) return;
  if (scheduleTiming.waitMs > 24) {
    const request = { root, cue, timing: { ...timing, progress: 100, dueAt: performance.now() + scheduleTiming.waitMs } };
    const waiting = { root, cue, waiting: true, waitingUntil: performance.now() + scheduleTiming.waitMs, waitingTimer: null };
    waiting.waitingTimer = setTimeout(() => {
      if (interactivePhrase !== waiting) return;
      interactivePhrase = null;
      startInteractivePhraseNow(request.root, request.cue, request.timing);
      if (interactivePressQueue.length) {
        const next = interactivePressQueue.shift();
        setTimeout(() => requestInteractivePhrase(next.root, next.cue, next.timing), 0);
      }
    }, scheduleTiming.waitMs);
    manualMelodyTimers.push(waiting.waitingTimer);
    interactivePhrase = waiting;
    return;
  }
  startInteractivePhraseNow(root, cue, timing);
}

function pendingInteractiveEvents(phrase, nowSong, nowPerf) {
  const harmony = (phrase?.harmonyEvents || [])
    .filter(event => !event.fired)
    .map(event => ({ type: 'harmony', event, remaining: Math.max(0, (event.dueAt - nowPerf) / 1000) }));
  if (isManualMode()) {
    return harmony.concat((phrase?.melodyEvents || [])
      .filter(event => !event.fired)
      .map(event => ({ type: 'melody', event, remaining: Math.max(0, (event.dueAt - nowPerf) / 1000) })));
  }
  const boundary = Number(phrase?.segmentEnd || nowSong);
  const melody = (song?.melodyTrack?.notes || [])
    .map((note, idx) => ({ note, idx }))
    .filter(({ note }) => note.time > nowSong + 0.008 && note.time < boundary - 0.001 && shouldAutoPlayMelodyAt(note.time))
    .map(({ note, idx }) => ({ type: 'melody', event: { note, idx }, remaining: note.time - nowSong }));
  return harmony.concat(melody);
}

function finishInteractiveTransition(mode, boundary) {
  playOffset = Math.max(playOffset, Math.min(song?.duration || boundary, boundary));
  interactiveTransitioning = false;
  interactivePhrase = null;
  // 触发追赶时，队首就是玩家已经提前按下、马上要真正播放的 boundary cue。
  // 重新调度提示时必须跳过它，否则同一个 cue 会先以 100% 进度瞬间重画一次，
  // 看起来像“下一个和弦飞快升起”。
  const next = interactivePressQueue.shift();
  if (mode === 'semi') {
    scheduleFrom(playOffset, true, Boolean(next));
  } else {
    const notes = song?.melodyTrack?.notes || [];
    const boundaryIndex = notes.findIndex(note => note.time >= playOffset - 0.001);
    if (boundaryIndex >= 0) nextManualMelodyIndex = Math.max(nextManualMelodyIndex, boundaryIndex);
    ensureManualClock();
    scheduleChordCues(playOffset, Boolean(next));
    updateClock();
    updateLyrics();
  }
  if (next) beginInteractivePhrase(next.root, next.cue, next.timing);
  if (interactivePressQueue.length) {
    const following = interactivePressQueue.shift();
    setTimeout(() => requestInteractivePhrase(following.root, following.cue, following.timing), 0);
  }
}

function accelerateInteractivePhrase() {
  if (!interactivePhrase || interactiveTransitioning) return;
  const mode = isManualMode() ? 'manual' : 'semi';
  const nowSong = currentPlayTime();
  const nowPerf = performance.now();
  const boundary = Math.max(nowSong, Math.min(song?.duration || Infinity, Number(interactivePhrase.segmentEnd || nowSong)));
  const pending = pendingInteractiveEvents(interactivePhrase, nowSong, nowPerf);
  if (!pending.length) return finishInteractiveTransition(mode, boundary);

  const catchup = runWasmCommand({ op: 'catchup', remaining: pending.map(item => item.remaining) });
  const catchupDuration = Number(catchup.duration);
  const scale = Number(catchup.scale);
  interactiveTransitioning = true;
  clearTimers();
  playing = false;
  interactivePhrase = null;

  for (const [index, item] of pending.entries()) {
    const delay = Math.max(0, Number(catchup.delays?.[index] ?? item.remaining * scale) * 1000);
    if (item.type === 'harmony') {
      const event = item.event;
      playHarmonyVisualNote(event.midi, delay, Math.max(0.045, event.duration * scale), event.velocity, event.toneMode);
    } else {
      const { note, idx } = item.event;
      const timer = setTimeout(() => {
        playOffset = note.time;
        playVisualNote(shiftedMidi(note.note), note.velocity || 0.65, 'playback');
        if (isManualMode() && nextManualMelodyIndex <= idx) nextManualMelodyIndex = idx + 1;
        updateClock();
        updateLyrics();
      }, delay);
      manualMelodyTimers.push(timer);
    }
  }
  const settleMs = catchupDuration <= 0.08 ? 8 : 45;
  const done = setTimeout(() => finishInteractiveTransition(mode, boundary), catchupDuration * 1000 + settleMs);
  manualMelodyTimers.push(done);
}

function requestInteractivePhrase(root, cue = cueForInteractivePress(root), timing = {}) {
  const request = { root, cue, timing };
  if (interactiveTransitioning) {
    interactivePressQueue.push(request);
    return;
  }
  if (interactivePhrase?.waiting) {
    interactivePressQueue.push(request);
    return;
  }
  const nowSong = currentPlayTime();
  const pending = interactivePhrase && pendingInteractiveEvents(interactivePhrase, nowSong, performance.now()).length;
  if (pending) {
    interactivePressQueue.push(request);
    accelerateInteractivePhrase();
    return;
  }
  beginInteractivePhrase(root, cue, timing);
}

function triggerChordKey(label, pickSlot, key) {
  if (!key || !song || !document.body.classList.contains('game-started')) return false;
  requestWakeLock();
  const pressedCue = cueForInteractivePress(label);
  const pressProgress = cueProgressForKey(key);
  const pressCueState = cueState.get(label);
  if (isSemiAutoMode() || isManualMode()) {
    const timing = timingForInteractivePhrase(pressedCue, {
      progress: pressProgress,
      dueAt: pressCueState?.due,
    });
    if (timing.earlyRejected) {
      showTimingRating(key, 'MISS');
      rejectEarlyChordPress(key);
      return false;
    }
  }
  const normalizedPickSlot = pickSlot > 0 ? 1 : 0;
  harmonyToneMode = Math.min(HARMONY_TONES.length, Math.max(1, normalizedPickSlot + 1));
  // 有效按键必须让本次和弦立刻读取所选 A/B。以前把事件写到 cue.time，
  // 在判定窗前半段（90~99）按 B 时当前时刻仍会读到 A，听感像 B 慢半拍。
  const pickTime = currentPlayTime();
  insertUserPickEvent(normalizedPickSlot, pickTime);
  showPickZoneFeedback(key, normalizedPickSlot);
  warmHarmonyTones(false);
  // 命中判定只影响计分/歌词推进，视觉与 autoPressCue 完全同款（docs/UI.md）。
  const matchesActiveCue = Boolean(activeCue
    && (activeCue.cue?.root === label || key.dataset.cueId === activeCue.cue?._id));
  showTimingRating(key, timingGrade(pressProgress, matchesActiveCue));
  if (isGoodTiming(key) && matchesActiveCue) {
    activeCue.hit = true;
    activeCue.pressed = true;
    hitCue(activeCue.midi, activeCue.cue);
    const completedCue = activeCue;
    window.setTimeout(() => { if (activeCue === completedCue) finishActiveCue(); }, 260);
  } else {
    failActiveCue(false);
  }
  key.classList.remove('chord-due', 'miss', 'chord-release');
  key.classList.add('chord-press');
  if (isSemiAutoMode() || isManualMode()) {
    requestInteractivePhrase(label, pressedCue, { progress: pressProgress, dueAt: pressCueState?.due });
  } else {
    playStyledHarmony(label, pressedCue);
  }
  setTimeout(() => {
    key.classList.remove('chord-press');
    key.classList.add('chord-release');
    setTimeout(() => key.classList.remove('chord-release'), 220);
  }, 520);
  cueState.delete(label);
  return true;
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
    key.innerHTML = `<span class="pick-regions" aria-hidden="true"><span class="pick-zone pick-zone-a" data-pick-slot="0">A</span><span class="pick-zone pick-zone-b" data-pick-slot="1">B</span></span><span class="chord-fill"></span><span class="chord-line"></span><span class="chord-symbol"></span><span class="key-label">${displayLabel}</span>`;
    key.title = `${displayLabel} (${label}) · 左下拨片 A / 右上拨片 B`;
    key.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      const explicitZone = ev.target.closest?.('.pick-zone');
      const rect = key.getBoundingClientRect();
      const normalizedX = Math.max(0, Math.min(1, (ev.clientX - rect.left) / Math.max(1, rect.width)));
      const normalizedY = Math.max(0, Math.min(1, (ev.clientY - rect.top) / Math.max(1, rect.height)));
      const pickBoundary = 0.47 + normalizedX * 0.16;
      const pickSlot = explicitZone
        ? Number(explicitZone.dataset.pickSlot || 0)
        : (normalizedY >= pickBoundary ? 0 : 1);
      triggerChordKey(label, pickSlot, key);
    });
    kb.appendChild(key);
  }
}

const MIDI_ROOT_BY_PITCH_CLASS = Object.freeze({
  0: 'C', 2: 'D', 4: 'E', 5: 'F', 7: 'G', 9: 'A', 11: 'B',
});

function updateExternalMidiUi(status = window.FreezaMidiInput?.snapshot?.() || {}) {
  const connectButton = $('midiConnectBtn');
  const startStatus = $('midiStartStatus');
  const gameStatus = $('gameMidiStatus');
  const gameLabel = $('gameMidiLabel');
  const deviceNames = (status.devices || []).map(device => device.name).filter(Boolean);
  const deviceSummary = deviceNames.length > 1 ? `${deviceNames[0]} 等 ${deviceNames.length} 台` : deviceNames[0];
  let text = '点击连接 USB / 蓝牙';
  if (!status.supported) text = '此浏览器不支持 Web MIDI';
  else if (status.connecting) text = '正在请求 MIDI 权限…';
  else if (status.error) text = status.error;
  else if (status.connected) text = deviceSummary || `已连接 ${status.count} 台设备`;
  else if (status.authorized) text = '已授权，等待 MIDI 设备';
  if (startStatus) {
    startStatus.textContent = text;
    startStatus.title = text;
  }
  if (connectButton) {
    connectButton.classList.toggle('connected', Boolean(status.connected));
    connectButton.classList.toggle('connecting', Boolean(status.connecting));
    connectButton.classList.toggle('unsupported', !status.supported);
    connectButton.disabled = !status.supported || Boolean(status.connecting);
    connectButton.title = status.connected ? `MIDI 已连接：${deviceSummary}` : text;
  }
  if (gameStatus) {
    gameStatus.setAttribute('aria-hidden', status.connected ? 'false' : 'true');
    gameStatus.tabIndex = status.connected ? 0 : -1;
    gameStatus.title = status.connected ? `MIDI 已连接：${deviceSummary}` : text;
  }
  if (gameLabel) gameLabel.textContent = status.count > 1 ? `MIDI ×${status.count}` : 'MIDI';
}

function handleExternalMidiNote(message) {
  if (!document.body.classList.contains('game-started') || !song) return;
  const sourcePitchClass = ((Number(message.note) - userKeyShift) % 12 + 12) % 12;
  const root = MIDI_ROOT_BY_PITCH_CLASS[sourcePitchClass];
  if (!root) return; // 黑键只有在 Key shift 后与当前七个显示键重合时才触发。
  const key = document.querySelector(`#manualKeyboard .key[data-root="${root}"]`);
  if (!key) return;
  ensureAudio();
  audio.ctx?.resume?.().catch(() => {});
  window.Tone?.start?.().catch?.(() => {});
  const pickSlot = song ? chordPatternSlotAtTime(currentPlayTime()) : Math.max(0, harmonyToneMode - 1);
  triggerChordKey(root, pickSlot, key);
}

async function requestExternalMidiConnection() {
  if (!window.FreezaMidiInput) return;
  playLaunchUiSound('select');
  await window.FreezaMidiInput.connect();
}

function setupExternalMidiInput() {
  if (!window.FreezaMidiInput) {
    updateExternalMidiUi({ supported: false, connected: false, devices: [] });
    return;
  }
  window.FreezaMidiInput.setHandlers({
    onNote: handleExternalMidiNote,
    onStatus: updateExternalMidiUi,
  });
  $('midiConnectBtn')?.addEventListener('click', requestExternalMidiConnection);
  $('gameMidiStatus')?.addEventListener('click', requestExternalMidiConnection);
}


$('playBtn').onclick = () => { requestWakeLock(); warmHarmonyTones(true); if (playing) pausePlayback(); else playPlayback(); };
$('keyDownBtn').onclick = () => { applyKeyShift(-1); };
$('keyUpBtn').onclick = () => { applyKeyShift(1); };
$('restartBtn').onclick = () => { requestWakeLock(); warmHarmonyTones(true); restartPlayback(); };
$('saveRecBtn').onclick = () => downloadRecording();
$('savePromptDownload')?.addEventListener('click', () => { closeSavePrompt(); downloadRecording(); });
$('savePromptCancel')?.addEventListener('click', closeSavePrompt);
$('savePrompt')?.addEventListener('click', (ev) => { if (ev.target?.id === 'savePrompt') closeSavePrompt(); });
$('resultHomeBtn')?.addEventListener('click', () => { playLaunchUiSound('select'); returnToSongScreen(); });
$('toneBtn').onclick = () => {
  selectGameDrumPatternSlot(drumPatternSlot > 0 ? 0 : 1);
};
$('pickToneBtn').onclick = () => {
  const currentSlot = song ? chordPatternSlotAtTime(currentPlayTime()) : Math.max(0, harmonyToneMode - 1);
  selectGamePickSlot(currentSlot > 0 ? 0 : 1);
};
$('melodyToggle').onclick = () => {
  melodyEnabled = !melodyEnabled;
  if (melodyEnabled) guideMode = false;
  syncMelodyGuideMenu();
  updatePlaybackToggles();
  if (playing) scheduleFrom(currentPlayTime());
};
$('drumToggle').onclick = () => {
  // 演奏页鼓机按固定顺序循环：智能 → 开 → 关 → 智能。
  drumMode = drumMode === 'auto' ? 'on' : drumMode === 'on' ? 'off' : 'auto';
  if (drumMode !== 'off') drumModeBeforeOff = drumMode;
  drumsEnabled = drumMode !== 'off';
  updatePlaybackToggles();
  if (playing) scheduleFrom(currentPlayTime());
};

function setupStartScreen() {
  const screen = $('startScreen');
  if (!screen) return;
  setupLaunchUiSounds(screen);
  // 默认必须关麦克风；只有用户主动点“开”才申请权限。
  micEnabled = false;
  stopMic();
  cameraEnabled = false;
  stopCamera();
  // 麦克风默认必须关闭：初始化时强制 UI 和状态一致，避免浏览器缓存旧 class。
  screen.querySelectorAll('[data-mic]').forEach(b => b.classList.toggle('selected', b.dataset.mic === 'off'));
  updateMicMenu();
  screen.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      playMode = btn.dataset.mode || 'semi';
      screen.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('selected', b === btn));
      updateGamePickControls();
    });
  });
  screen.querySelectorAll('[data-drum]').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      drumMode = btn.dataset.drum || 'auto';
      if (drumMode !== 'off') drumModeBeforeOff = drumMode;
      drumsEnabled = drumMode !== 'off';
      screen.querySelectorAll('[data-drum]').forEach(b => b.classList.toggle('selected', b === btn));
      screen.querySelector('[data-group="drum"]')?.classList.toggle('is-off', drumMode === 'off');
      updatePlaybackToggles();
    });
  });
  screen.querySelector('[data-group="melody"]')?.addEventListener('click', () => {
    if (guideMode) return;
    melodyUserTouched = true;
    melodyEnabled = !melodyEnabled;
    if (melodyEnabled) guideMode = false;
    syncMelodyGuideMenu(screen);
    updatePlaybackToggles();
  });
  screen.querySelector('[data-group="mic"]')?.addEventListener('click', async () => {
    micEnabled = !micEnabled;
    if (!micEnabled) stopMic();
    updateMicMenu();
    if (micEnabled) await ensureMic();
  });
  screen.querySelector('[data-group="camera"]')?.addEventListener('click', async () => {
    cameraEnabled = !cameraEnabled;
    if (!cameraEnabled) stopCamera();
    else {
      updateCameraMenu('正在连接…');
      await ensureCamera();
    }
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
      // A/B 是整组翻转开关：点已选中的 A 也必须切到 B，反之亦然。
      harmonyToneMode = harmonyToneMode === 1 ? 2 : 1;
      initialPickSlot = harmonyToneMode - 1;
      insertUserPickEvent(initialPickSlot, 0);
      screen.querySelectorAll('[data-pick]').forEach(b => b.classList.toggle('selected', (b.dataset.pick === 'B') === (harmonyToneMode === 2)));
      updateToneButton();
      warmHarmonyTones(false);
    });
  });
  screen.querySelectorAll('[data-drum-tone]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      // 与拨片一致，点当前已选项也切换到另一套鼓机音色。
      selectDrumPatternSlot(drumPatternSlot > 0 ? 0 : 1, false);
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
  $('menuDrumVolRange')?.addEventListener('input', (ev) => { drumGain = Math.max(0.25, Math.min(2, Number(ev.target.value) / 100)); updateVolumeButtons(); });
  $('menuMicGainRange')?.addEventListener('input', () => adjustMicGain(0));
  updateVolumeButtons();
  updateMicMenu();
  syncMelodyGuideMenu(screen);
  syncStartDrumToneMenu(screen);
  updateGamePickControls();
  screen.querySelector('[data-group="guide"]')?.addEventListener('click', () => {
    guideMode = !guideMode;
    syncMelodyGuideMenu(screen);
    updatePlaybackToggles();
  });
  $('startGameBtn')?.addEventListener('click', startGameFromMenu);
  $('changeSongBtn')?.addEventListener('click', () => { playLaunchUiSound('select'); returnToSongScreen(); });
}

async function startGameFromMenu() {
  if (startRequested) return;
  startRequested = true;
  const screen = $('startScreen');
  resetLoadingProgress();
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
  refreshPerformanceLayout();
  positionCameraPip(!cameraPreviewState.userPositioned);
  // 默认半自动必须有主旋律；只有用户在开始页明确点了“主旋律关”才关闭。
  if (!melodyUserTouched && playMode === 'semi' && !guideMode) melodyEnabled = true;
  drumsEnabled = drumMode !== 'off';
  updatePlaybackToggles();
  playOffset = 0;
  nextManualMelodyIndex = 0;
  resetTimingRatings();
  resetInteractiveSequencer();
  resetHarmonyHalfSequence();
  clearManualMelodyTimers();
  startCountdownThenPlay();
}

let performanceLayoutRaf = 0;
function refreshPerformanceLayout() {
  cancelAnimationFrame(performanceLayoutRaf);
  performanceLayoutRaf = requestAnimationFrame(() => {
    performanceLayoutRaf = 0;
    if (!document.body.classList.contains('game-started')) return;
    renderPlaybackForMelody();
    updateLyrics();
    positionCameraPip(false);
  });
}

window.addEventListener('resize', refreshPerformanceLayout, { passive: true });
window.addEventListener('orientationchange', refreshPerformanceLayout, { passive: true });
window.visualViewport?.addEventListener('resize', refreshPerformanceLayout, { passive: true });

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
function markPlaybackForFocusResync() {
  if (!playing) return;
  if (!playbackNeedsFocusResync) {
    // 后台暂停歌曲时间轴。回到前台从离开点继续，而不是把后台经过的
    // 时间当作已演奏，亦不会一次性补触发积压事件。
    focusResumePosition = Math.min(song?.duration || Infinity, currentPlayTime());
    playOffset = focusResumePosition;
    playStartedAt = performance.now();
  }
  playbackNeedsFocusResync = true;
  // 离开前台时立刻撤销尚未触发的 timer/rAF，避免浏览器回到前台后
  // 把后台积压的和弦回调一次性全部执行。
  clearTimers();
}

async function resyncPlaybackAfterFocus() {
  if (!playbackNeedsFocusResync || focusResyncing || document.hidden) return;
  if (!playing || !song) {
    playbackNeedsFocusResync = false;
    focusResumePosition = null;
    return;
  }
  focusResyncing = true;
  clearTimeout(focusResyncRetryTimer);
  focusResyncRetryTimer = null;
  const resumeAt = Math.min(song.duration, focusResumePosition ?? playOffset);
  try {
    ensureAudio();
    // Safari 可能在 visibilitychange 后短暂保持 interrupted。给本次恢复
    // 一个有限等待，未成功则稍后重试；不能提前清掉待恢复标记。
    await Promise.race([
      Promise.allSettled([
        audio.ctx?.resume?.(),
        window.Tone ? Tone.start() : Promise.resolve(),
        window.Tone?.getContext?.()?.resume?.(),
      ]),
      new Promise(resolve => setTimeout(resolve, 700)),
    ]);
    if (audio.ctx?.state === 'running') {
      playbackNeedsFocusResync = false;
      focusResumePosition = null;
      if (playing) scheduleFrom(resumeAt);
      requestWakeLock();
    } else if (!document.hidden && playing) {
      focusResyncRetryTimer = setTimeout(resyncPlaybackAfterFocus, 350);
    }
  } finally {
    focusResyncing = false;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) markPlaybackForFocusResync();
  else {
    resyncPlaybackAfterFocus();
    if (cameraPreviewState.stream) $('cameraPreview')?.play?.().catch(() => {});
  }
});
window.addEventListener('blur', markPlaybackForFocusResync);
window.addEventListener('focus', resyncPlaybackAfterFocus);
window.addEventListener('pageshow', event => {
  if (event.persisted) playbackNeedsFocusResync = playing;
  resyncPlaybackAfterFocus();
});
// 若 iOS 要求下一次用户手势才能恢复 AudioContext，这个捕获阶段会先于
// 琴键/控制按钮执行恢复，然后继续此前挂起的演奏调度。
document.addEventListener('pointerdown', () => {
  if (audio.ctx?.state !== 'running') {
    audio.ctx?.resume?.().catch(() => {});
    window.Tone?.start?.().catch?.(() => {});
  }
  if (playbackNeedsFocusResync) resyncPlaybackAfterFocus();
}, { capture: true, passive: true });

renderKeyboard('playbackKeyboard', 48, 72, 'playback');
renderManualKeyboard();
setupCameraPip();
setupExternalMidiInput();
updateToneButton();
updateKeyButtons();
updateVolumeButtons();
updatePlaybackToggles();
setupSongScreen();
setupStartScreen();
setupGameUiSounds();
setupMicWave();
initSamplePiano();
midiReadyPromise = Promise.resolve(null);
