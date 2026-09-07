export const RHYTHM_DEFAULTS = Object.freeze({ source: 'off', bpm: 120, multiplier: 1 });
export const fraction = value => ((value % 1) + 1) % 1;
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function validateRhythmSettings(value = {}) {
  const result = { ...RHYTHM_DEFAULTS, ...value };
  if (!['off', 'manual', 'auto'].includes(result.source)) throw new TypeError('Unknown rhythm source');
  if (!Number.isFinite(result.bpm) || result.bpm < 30 || result.bpm > 300) {
    throw new RangeError('Tempo must be between 30 and 300 BPM');
  }
  if (![0.5, 1, 2].includes(result.multiplier)) throw new RangeError('Auto multiplier must be ½, 1, or 2');
  return { source: result.source, bpm: result.bpm, multiplier: result.multiplier };
}

// An anchored clock avoids accumulating frame-step rounding error. Rate changes
// reanchor at the current position; phase correction slews over one second.
export function createBeatClock({ now = () => performance.now() / 1000 } = {}) {
  let anchorTime = now(), anchorBeat = 0, rate = 0;
  let correction = 0, correctionAt = anchorTime;
  let sampledAt = anchorTime, sampledBeat = 0, suppress = true;
  function position(time = now()) {
    return anchorBeat + (time - anchorTime) * rate + correction * clamp(time - correctionAt, 0, 1);
  }
  function setRate(bpm, time = now()) {
    anchorBeat = position(time);
    anchorTime = time;
    correction = 0;
    rate = bpm === null ? 0 : bpm / 60;
  }
  function align(time = now(), immediate = false) {
    const beat = position(time);
    const error = Math.round(beat) - beat;
    anchorBeat = beat;
    anchorTime = time;
    correctionAt = time;
    correction = error;
    if (immediate) {
      anchorBeat += error;
      correction = 0;
      suppress = true;
    }
  }
  function correctPhase(phase, time = now()) {
    const beat = position(time);
    const error = fraction(phase - fraction(beat) + 0.5) - 0.5;
    anchorBeat = beat;
    anchorTime = correctionAt = time;
    // The clock always moves forward, even at the slowest permitted tempo.
    correction = clamp(error, -rate * 0.5, rate * 0.5);
  }
  function sample(time = now()) {
    const beat = position(time);
    const suspended = time - sampledAt > 2;
    const crossings = suppress || suspended || rate === 0 ? 0 : Math.max(0, Math.floor(beat + 1e-9) - Math.floor(sampledBeat + 1e-9));
    sampledAt = time;
    sampledBeat = beat;
    suppress = false;
    return { beat, phase: fraction(beat), tick: crossings > 0, crossings, suspended };
  }
  function hold(beat, time = now()) {
    anchorBeat = beat; anchorTime = time; rate = 0; correction = 0; suppress = true;
  }
  return { position, setRate, hold, align, correctPhase, sample, suppress: () => { suppress = true; } };
}
