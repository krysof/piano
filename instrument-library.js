(function attachInstrumentLibrary(global) {
  'use strict';

  const MUSYNG_KITE = 'MusyngKite';

  // scard_01 / sound_c2 names describe both the accompaniment pattern family
  // and the intended timbre.  Keep this table independent from app.js so new
  // cards can be added without growing the player monolith.
  const definitions = Object.freeze([
    { match: /^Saxophone(?:_|$)/i, displayName: 'MusyngKite Alto Sax', fallbackName: 'alto_sax', soundfont: MUSYNG_KITE, gain: 0.30 },
    { match: /^Violin(?:_|$)/i, displayName: 'MusyngKite Violin', fallbackName: 'violin', soundfont: MUSYNG_KITE, gain: 1.00 },
    { match: /^Erhu1(?:_|$)/i, displayName: 'MusyngKite Bowed Fiddle', fallbackName: 'fiddle', soundfont: MUSYNG_KITE, gain: 0.58 },
    { match: /^Pipa(?:_|$)/i, displayName: 'MusyngKite Shamisen', fallbackName: 'shamisen', soundfont: MUSYNG_KITE, gain: 0.49 },
    { match: /^Zither(?:_|$)/i, displayName: 'MusyngKite Koto', fallbackName: 'koto', soundfont: MUSYNG_KITE, gain: 0.39 },
    { match: /^Accordion(?:_|$)/i, displayName: 'MusyngKite Accordion', fallbackName: 'accordion', soundfont: MUSYNG_KITE, gain: 0.95 },
    { match: /^StringSet1(?:_|$)/i, displayName: 'MusyngKite String Ensemble', fallbackName: 'string_ensemble_1', soundfont: MUSYNG_KITE, gain: 0.28 },
    { match: /^EGsolo1(?:_|$)/i, displayName: 'FSBS Electric Guitar Distorted', fallbackName: 'distortion_guitar', guitarLibrary: true, sampleCode: 'GED', gain: 0.58, fallbackGain: 0.55 },
    { match: /^LGsolo2(?:_|$)/i, displayName: 'FSBS Electric Guitar Clean', fallbackName: 'electric_guitar_clean', guitarLibrary: true, sampleCode: 'GEC1', gain: 0.64, fallbackGain: 0.62 },
    { match: /^BlindingLead(?:_|$)/i, displayName: 'MusyngKite Saw Lead', fallbackName: 'lead_2_sawtooth', soundfont: MUSYNG_KITE, gain: 0.74 },
    { match: /^80sSynthBrass(?:_|$)/i, displayName: 'MusyngKite Synth Brass', fallbackName: 'synth_brass_1', soundfont: MUSYNG_KITE, gain: 0.62 },
    { match: /^MoonSailor(?:_|$)/i, displayName: 'MusyngKite Warm Pad', fallbackName: 'pad_2_warm', soundfont: MUSYNG_KITE, gain: 0.37 },
    { match: /^Key1(?:_|$)/i, displayName: 'MusyngKite Electric Piano', fallbackName: 'electric_piano_1', soundfont: MUSYNG_KITE, gain: 0.61 },
    { match: /^PianoEDM(?:_|$)/i, displayName: 'MusyngKite Bright Piano', fallbackName: 'bright_acoustic_piano', soundfont: MUSYNG_KITE, gain: 0.81 },
    { match: /^PianoRhodesWarm(?:_|$)/i, displayName: 'MusyngKite Warm Rhodes', fallbackName: 'electric_piano_1', soundfont: MUSYNG_KITE, gain: 0.61 },
    { match: /^PianoMKS20(?:_|$)/i, displayName: 'MusyngKite Electric Piano 2', fallbackName: 'electric_piano_2', soundfont: MUSYNG_KITE, gain: 0.70 },
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
      ...(definition.localPiano ? { localPiano: true } : {}),
      ...(definition.guitarLibrary ? { guitarLibrary: true, sampleCode: definition.sampleCode } : {}),
    };
  }

  function catalog() {
    return definitions.map(item => ({
      codePattern: item.match.source,
      name: item.displayName,
      soundfont: item.soundfont,
      instrument: item.fallbackName,
      engine: item.localPiano ? 'ToneSampler' : item.guitarLibrary ? 'FreezaGuitarSampler' : 'Soundfont',
    }));
  }

  global.FreezaInstrumentLibrary = Object.freeze({ sampledPreset, catalog });
})(window);
