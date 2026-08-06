(function attachInstrumentLibrary(global) {
  'use strict';

  // scard_01 / sound_c2 names describe both the accompaniment pattern family
  // and the intended timbre.  Keep this table independent from app.js so new
  // cards can be added without growing the player monolith.
  const definitions = Object.freeze([
    { match: /^Saxophone(?:_|$)/i, displayName: 'VCSL Tenor Saxophone', samplePack: 'vcsl-tenor-sax', gain: 0.72, profile: { highpass: 90, presence: { frequency: 2350, q: 0.72, gain: 1.4 }, sustain: 0.88 } },
    { match: /^Violin(?:_|$)/i, displayName: 'VSCO Solo Violin Arco Vibrato', samplePack: 'vsco-solo-violin', gain: 0.76, profile: { highpass: 105, lowpass: 11800, presence: { frequency: 3100, q: 0.68, gain: 1.2 }, sustain: 0.91 } },
    { match: /^Erhu1(?:_|$)/i, displayName: 'VCSL Bowed Psaltery - Erhu Character', samplePack: 'vcsl-bowed-psaltery', gain: 0.76, profile: { highpass: 145, lowpass: 9200, presence: { frequency: 2500, q: 0.82, gain: 2.8 }, sustain: 0.9 } },
    { match: /^Pipa(?:_|$)/i, displayName: 'VCSL Plucked Psaltery - Pipa Character', samplePack: 'vcsl-plucked-psaltery', gain: 0.74, profile: { highpass: 125, presence: { frequency: 2800, q: 0.72, gain: 2.2 }, sustain: 0.78 } },
    { match: /^Zither(?:_|$)/i, displayName: 'VCSL Dan Tranh Zither', samplePack: 'vcsl-dan-tranh', gain: 0.68, profile: { highpass: 80, presence: { frequency: 2200, q: 0.65, gain: 1.4 }, sustain: 0.82 } },
    { match: /^Accordion(?:_|$)/i, displayName: 'FreePats Hohner Button Accordion', samplePack: 'freepats-hohner-accordion', gain: 0.72, profile: { highpass: 75, lowpass: 10500, presence: { frequency: 1800, q: 0.7, gain: 1.1 }, sustain: 0.92 } },
    { match: /^StringSet1(?:_|$)/i, displayName: 'VSCO Violin Section Vibrato', samplePack: 'vsco-violin-section', gain: 0.58, profile: { highpass: 85, lowpass: 10500, sustain: 0.92 } },
    { match: /^EGsolo1(?:_|$)/i, displayName: 'FSBS Electric Guitar Distorted', fallbackName: 'distortion_guitar', guitarLibrary: true, sampleCode: 'GED', gain: 0.58, fallbackGain: 0.55 },
    { match: /^LGsolo2(?:_|$)/i, displayName: 'FSBS Electric Guitar Clean', fallbackName: 'electric_guitar_clean', guitarLibrary: true, sampleCode: 'GEC1', gain: 0.64, fallbackGain: 0.62 },
    { match: /^BlindingLead(?:_|$)/i, displayName: 'Freeza Analog Unison Lead', synthLead: 'blinding', gain: 0.86 },
    { match: /^80sSynthBrass(?:_|$)/i, displayName: 'Freeza 80s Analog Brass', synthLead: 'brass80s', gain: 0.78 },
    { match: /^MoonSailor(?:_|$)/i, displayName: 'Freeza Moon Sailor Analog Pad', synthLead: 'moonPad', gain: 0.62 },
    { match: /^Key1(?:_|$)/i, displayName: 'VCSL TX81Z Piano 1', samplePack: 'vcsl-tx81z-piano-1', gain: 0.73, profile: { highpass: 45, lowpass: 11200, sustain: 0.84 } },
    { match: /^PianoEDM(?:_|$)/i, displayName: 'Salamander Bright Grand', localPiano: true, gain: 0.54 },
    { match: /^PianoRhodesWarm(?:_|$)/i, displayName: 'VCSL TX81Z FM Electric Piano', samplePack: 'vcsl-tx81z-fm-piano', gain: 0.69, profile: { highpass: 42, lowpass: 6700, presence: { frequency: 1250, q: 0.65, gain: 1.1 }, sustain: 0.86 } },
    { match: /^PianoMKS20(?:_|$)/i, displayName: 'VCSL TX81Z MKS-style Piano', samplePack: 'vcsl-tx81z-piano-1', gain: 0.78, profile: { highpass: 50, lowpass: 9800, presence: { frequency: 2100, q: 0.7, gain: 1.5 }, sustain: 0.82 } },
    { match: /^PianoStudio(?:_|$)/i, displayName: 'Salamander Grand Piano', localPiano: true, gain: 0.42 },
  ]);

  function sampledPreset(code, label, balanceGain) {
    const normalized = String(code || '').trim();
    const definition = definitions.find(item => item.match.test(normalized));
    if (!definition) return null;
    const baseGain = definition.gain;
    const gainKey = definition.sampleCode || normalized;
    const shouldUseLegacyBalance = definition.guitarLibrary || definition.localPiano;
    return {
      label,
      code: normalized,
      name: definition.displayName,
      fallbackName: definition.fallbackName,
      soundfont: definition.soundfont,
      gain: shouldUseLegacyBalance && typeof balanceGain === 'function' ? balanceGain(gainKey, baseGain) : baseGain,
      fallbackGain: definition.fallbackGain ?? baseGain,
      profile: definition.profile,
      ...(definition.localPiano ? { localPiano: true } : {}),
      ...(definition.guitarLibrary ? { guitarLibrary: true, sampleCode: definition.sampleCode } : {}),
      ...(definition.synthLead ? { synthLead: definition.synthLead } : {}),
      ...(definition.samplePack ? { samplePack: definition.samplePack } : {}),
    };
  }

  function catalog() {
    return definitions.map(item => ({
      codePattern: item.match.source,
      name: item.displayName,
      soundfont: item.soundfont,
      instrument: item.samplePack || item.fallbackName,
      engine: item.localPiano ? 'ToneSampler' : item.guitarLibrary ? 'FreezaGuitarSampler' : item.samplePack ? 'FreezaSampleInstrument' : item.synthLead ? 'FreezaSynthLead' : 'Unavailable',
    }));
  }

  global.FreezaInstrumentLibrary = Object.freeze({ sampledPreset, catalog });
})(window);
