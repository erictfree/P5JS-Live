// Audio features — the shared per-frame snapshot.
//
// Pure and p5-free on purpose: this is the part with real arithmetic in it, so it is
// the part worth unit-testing. audioEngine.js does the p5.sound plumbing and hands the
// raw numbers here.
//
// Two normalization decisions are settled here:
//
//   - Normalized 0..1 values are the top-level names. p5.sound's own scales survive
//     under `raw`, so a patch can still use the underlying API deliberately.
//   - Normalization is a decaying-peak auto-gain, not a fixed divisor. A quiet track
//     and a loud track should both drive `map(audio.bass, 0, 1, ...)` usefully, which
//     is the mapping patch authors actually write. The three spectral bands share one
//     ceiling so their relative balance survives normalization.

const EPSILON = 1e-6;

export const FEATURE_DEFAULTS = Object.freeze({
  smoothing: 0.6, // 0 = no smoothing, ->1 = heavy
  gainDecay: 0.4, // how fast the auto-gain ceiling falls, per second
  gainFloor: 0.02, // never divide by something tiny and turn silence into noise
  gainTarget: 0.82, // leave visible/dynamic headroom instead of pinning every peak at 1
  autoGain: true, // off means "divide by nothing", raw 0..1 passes through
  onsetThreshold: 1.3, // bass must exceed this multiple of its recent average
  onsetFloor: 0.08, // ...and be at least this loud, so silence never beats
  onsetRise: 0.05, // ...and must actually have risen since the previous frame
  onsetMemory: 0.35, // seconds of bass history the average covers
  minOnsetInterval: 0.12, // seconds; ~500 BPM ceiling, filters double-triggers
});

export function createFeatureExtractor(overrides = {}) {
  // Held in one mutable object rather than closed-over constants, so the performer
  // can tune smoothing and auto-gain from the Audio panel mid-set.
  const options = { ...FEATURE_DEFAULTS, ...overrides };

  const smoothed = { level: 0, bass: 0, mid: 0, treble: 0, centroid: 0 };
  const ceiling = {
    level: options.gainFloor,
    bands: options.gainFloor,
  };
  let bassAverage = 0;
  let previousBass = 0;
  let sinceOnset = 999;

  // Patches should be able to teach and use ordinary JavaScript over analysis data.
  // A frozen plain Array has the full Array higher-order API and cannot be changed by
  // one patch before the next patch receives the same per-frame snapshot.
  const EMPTY = Object.freeze([]);

  /**
   * @param {object} input raw values straight off p5.sound
   * @param {number} input.dt seconds since the previous frame
   * @param {number} input.level 0..1 from p5.Amplitude
   * @param {number} input.bass 0..255 from p5.FFT#getEnergy
   * @param {number} input.mid 0..255
   * @param {number} input.treble 0..255
   * @param {number} input.centroid Hz from p5.FFT#getCentroid
   * @param {number} input.nyquist Hz, half the sample rate
   * @param {ArrayLike<number>} [input.waveform] time-domain samples, normally -1..1
   * @param {ArrayLike<number>} [input.spectrum] FFT magnitudes, normally 0..255
   */
  function compute(input) {
    const dt = clamp(input.dt ?? 0, 0, 0.25);
    const raw = {
      level: clamp(input.level ?? 0, 0, 8),
      bass: clamp((input.bass ?? 0) / 255, 0, 1),
      mid: clamp((input.mid ?? 0) / 255, 0, 1),
      treble: clamp((input.treble ?? 0) / 255, 0, 1),
    };

    // Exponential smoothing, made frame-rate independent so a 30 FPS laptop and a
    // 60 FPS one feel the same.
    const alpha = options.smoothing <= 0 ? 1 : 1 - Math.pow(options.smoothing, dt * 60);
    smoothed.level += (raw.level - smoothed.level) * alpha;
    smoothed.bass += (raw.bass - smoothed.bass) * alpha;
    smoothed.mid += (raw.mid - smoothed.mid) * alpha;
    smoothed.treble += (raw.treble - smoothed.treble) * alpha;

    const decay = Math.pow(1 - clamp(options.gainDecay, 0, 0.99), dt);
    const levelCeiling = trackCeiling('level', smoothed.level, decay);
    const bandCeiling = trackCeiling(
      'bands',
      Math.max(smoothed.bass, smoothed.mid, smoothed.treble),
      decay,
    );
    const level = applyGain(smoothed.level, levelCeiling);
    const bass = applyGain(smoothed.bass, bandCeiling);
    const mid = applyGain(smoothed.mid, bandCeiling);
    const treble = applyGain(smoothed.treble, bandCeiling);

    // Centroid on a log scale — musically, 200 Hz to 400 Hz is the same distance as
    // 2 kHz to 4 kHz, and a linear divide by nyquist would pin everything near zero.
    const nyquist = input.nyquist || 22050;
    const sampleRate = nyquist * 2;
    const centroidHz = clamp(input.centroid ?? 0, 0, nyquist);
    const centroid =
      centroidHz <= 20 ? 0 : clamp(Math.log(centroidHz / 20) / Math.log(nyquist / 20), 0, 1);

    // Onset detection for `audio.onset`.
    //
    // Deliberately computed from the RAW band energy, not the auto-gained value.
    // Auto-gain exists to flatten dynamics so map() behaves consistently — which is
    // exactly the information an onset detector needs. Running detection on the
    // normalized value means a steady quiet loop reads as permanently loud and
    // nothing ever registers as a hit.
    //
    // Three conditions, and all three are load-bearing:
    //   floor   — silence and room noise must never onset
    //   rise    — the energy has to have actually gone up since the last frame, so a
    //             sustained bass note fires once rather than every frame
    //   average — the rise has to be large relative to the recent past, not just any
    //             wobble
    sinceOnset += dt;
    const memoryAlpha = options.onsetMemory <= 0 ? 1 : clamp(dt / options.onsetMemory, 0, 1);
    const onset =
      raw.bass > options.onsetFloor &&
      raw.bass - previousBass > options.onsetRise &&
      raw.bass > bassAverage * options.onsetThreshold &&
      sinceOnset >= options.minOnsetInterval;
    if (onset) sinceOnset = 0;
    bassAverage += (raw.bass - bassAverage) * memoryAlpha;
    previousBass = raw.bass;

    const waveform = Object.freeze(Array.from(input.waveform ?? EMPTY));
    const spectrum = Object.freeze(Array.from(input.spectrum ?? EMPTY));

    return Object.freeze({
      level,
      bass,
      mid,
      treble,
      centroid,
      onset,
      sinceOnset,
      sampleRate,
      nyquist,
      waveform,
      spectrum,
      raw: Object.freeze({
        level: raw.level,
        bass: input.bass ?? 0,
        mid: input.mid ?? 0,
        treble: input.treble ?? 0,
        centroid: centroidHz,
        sampleRate,
        nyquist,
        waveform,
        spectrum,
      }),
    });
  }

  /** Decaying-peak ceiling: it jumps up instantly and sags back slowly. */
  function trackCeiling(channel, value, decay) {
    const current = ceiling[channel];
    const next = Math.max(value, Math.max(options.gainFloor, current * decay));
    ceiling[channel] = next;
    return next;
  }

  function applyGain(value, peak) {
    // With auto-gain off the ceiling still tracks, so switching it back on mid-set
    // resumes from a sensible level rather than from silence.
    if (!options.autoGain) return clamp(value, 0, 1);
    const target = clamp(options.gainTarget, 0.1, 1);
    return clamp((value / (peak + EPSILON)) * target, 0, 1);
  }

  /** The snapshot handed to strategies when there is no sound at all. */
  function silence() {
    return Object.freeze({
      level: 0,
      bass: 0,
      mid: 0,
      treble: 0,
      centroid: 0,
      onset: false,
      sinceOnset: 999,
      sampleRate: 0,
      nyquist: 0,
      waveform: EMPTY,
      spectrum: EMPTY,
      raw: Object.freeze({
        level: 0,
        bass: 0,
        mid: 0,
        treble: 0,
        centroid: 0,
        sampleRate: 0,
        nyquist: 0,
        waveform: EMPTY,
        spectrum: EMPTY,
      }),
    });
  }

  /** Tune smoothing and auto-gain live from the Audio panel. */
  function configure(changes = {}) {
    for (const [key, value] of Object.entries(changes)) {
      if (key in FEATURE_DEFAULTS) options[key] = value;
    }
    return { ...options };
  }

  function reset() {
    smoothed.level = smoothed.bass = smoothed.mid = smoothed.treble = smoothed.centroid = 0;
    ceiling.level = ceiling.bands = options.gainFloor;
    bassAverage = 0;
    previousBass = 0;
    sinceOnset = 999;
  }

  return { compute, silence, reset, configure, options: () => ({ ...options }) };
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return value < min ? min : value > max ? max : value;
}
