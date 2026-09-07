import { createBeatClock, validateRhythmSettings, RHYTHM_DEFAULTS, fraction } from './clock.js';
import { createTapTempo } from './tapTempo.js';

export function createRhythmManager({ now = () => performance.now() / 1000 } = {}) {
  const clock = createBeatClock({ now });
  const taps = createTapTempo();
  let settings = { ...RHYTHM_DEFAULTS };
  let estimate = null, status = 'off', generation = 0, error = null;
  let lastSampleAt = now();
  let latest = Object.freeze({ source: 'off', status, running: false, bpm: null, beat: 0, phase: 0, tick: false, crossings: 0, confidence: null });
  const listeners = new Set();
  function notify() { for (const fn of listeners) fn({ ...settings }); }
  function invalidate() {
    generation++;
    estimate = null;
    error = null;
    if (settings.source === 'auto') {
      if (now() - lastSampleAt > 2) clock.hold(latest.beat);
      else clock.setRate(null);
      clock.suppress(); status = 'listening';
    }
  }
  function configure(changes) {
    const next = validateRhythmSettings({ ...settings, ...changes });
    const changedSource = next.source !== settings.source;
    settings = next;
    if (changedSource) { taps.reset(); invalidate(); clock.suppress(); }
    if (settings.source === 'manual') { status = 'running'; clock.setRate(settings.bpm); }
    else if (settings.source === 'off') { status = 'off'; clock.setRate(null); }
    else if (estimate) clock.setRate(estimate.bpm * settings.multiplier);
    notify();
    return { ...settings };
  }
  function tap(time = now()) {
    // Selecting Manual must happen before recording, since source changes clear taps.
    if (settings.source !== 'manual') configure({ source: 'manual' });
    const value = taps.tap(time);
    if (value) {
      configure({ bpm: value.bpm });
      clock.align(time, value.taps === 2);
    }
    return value;
  }
  function receiveEstimate(value, sourceGeneration = generation) {
    if (settings.source !== 'auto' || sourceGeneration !== generation) return false;
    if (!value || !Number.isFinite(value.bpm) || value.bpm < 30 || value.bpm > 300 ||
        !Number.isFinite(value.at) || !Number.isFinite(value.beatAt) ||
        !Number.isFinite(value.confidence) || value.confidence < 0.65 || now() - value.at > 1) return false;
    const bpm = estimate ? estimate.bpm * 0.75 + value.bpm * 0.25 : value.bpm;
    estimate = { ...value, bpm };
    clock.setRate(bpm * settings.multiplier);
    clock.correctPhase(fraction((now() - value.beatAt) * bpm * settings.multiplier / 60));
    status = 'running';
    error = null;
    return true;
  }
  function sample(time = now()) {
    if (settings.source === 'auto') {
      if (time - lastSampleAt > 2) invalidate();
      const age = estimate ? time - estimate.at : Infinity;
      if (age > 3 && estimate) { clock.setRate(null, time); status = 'lost'; estimate = null; }
      else if (estimate) status = age > 0.75 ? 'holding' : 'running';
    }
    lastSampleAt = time;
    const position = clock.sample(time);
    latest = Object.freeze({ ...position, source: settings.source, status,
      running: status === 'running' || status === 'holding',
      bpm: settings.source === 'manual' ? settings.bpm : estimate ? estimate.bpm * settings.multiplier : null,
      confidence: settings.source === 'auto' ? estimate?.confidence ?? 0 : null,
    });
    return latest;
  }
  return {
    configure, tap, sample, receiveEstimate, invalidate,
    align() { clock.align(now(), true); },
    multiply(factor) {
      return settings.source === 'auto'
        ? configure({ multiplier: Math.min(2, Math.max(0.5, settings.multiplier * factor)) })
        : configure({ source: 'manual', bpm: settings.bpm * factor });
    },
    settings: () => ({ ...settings }), snapshot: () => latest,
    generation: () => generation,
    fail(message) { invalidate(); error = message; },
    error: () => error,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
