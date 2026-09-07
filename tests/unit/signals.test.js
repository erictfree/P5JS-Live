import { describe, it, expect } from 'vitest';
import { createSignalRuntime } from '../../src/signals/signals.js';
import { createTestHost } from './helpers.js';
function fixture() {
  const runtime = createSignalRuntime(), scope = runtime.scope();
  const frame = (time, options = {}) => runtime.beginFrame({ time, dt: 1 / 60,
    clock: { beat: 0, crossings: 0 }, audio: { onset: false }, controls: {}, ...options });
  return { runtime, api: scope.api, commit: () => scope.commit(), frame };
}
describe('visual signals', () => {
  it.each(['sine', 'triangle', 'saw', 'square'])('samples %s once per frame in a reversed range', wave => {
    const f = fixture(), value = f.api.lfo({ wave, period: 2, min: 10, max: 0 });
    f.commit();
    for (let time = 0; time <= 5; time += 0.017) {
      f.frame(time); const first = value();
      expect(value()).toBe(first); expect(first).toBeGreaterThanOrEqual(0); expect(first).toBeLessThanOrEqual(10);
    }
  });
  it('keeps seconds motion running while a beat signal holds', () => {
    const f = fixture(), seconds = f.api.lfo({ period: 4 }), beats = f.api.lfo({ beats: 4 }); f.commit();
    f.frame(0); expect(seconds()).toBe(0);
    f.frame(2); expect(seconds()).toBe(1); expect(beats()).toBe(0);
  });
  it('shares an envelope through a mapper and retriggers continuously', () => {
    const f = fixture(), env = f.api.envelope({ attack: 0.1, release: 0.4 });
    const size = f.api.remap(env, { to: [20, 200] }); f.commit();
    f.frame(0, { audio: { onset: true } }); expect(env()).toBe(0);
    f.frame(0.1); expect(env()).toBe(1); expect(size()).toBe(200);
    f.frame(0.3); expect(env()).toBeCloseTo(0.5);
    f.frame(0.3, { audio: { onset: true } }); expect(env()).toBeCloseTo(0.5);
    f.frame(0.4); expect(env()).toBeCloseTo(1);
    f.frame(1); expect(env()).toBe(0); expect(size()).toBe(20);
  });
  it('updates live envelopes even while their consumers do not draw', () => {
    const f = fixture(), env = f.api.envelope({ attack: 0, release: 1 }); f.commit();
    f.frame(0, { audio: { onset: true } }); f.frame(0.5);
    expect(env()).toBeCloseTo(0.5);
  });
  it('distinguishes adjacent onset pulses from a held gate', () => {
    const f = fixture();
    const hits = f.api.sequence([0, 1, 2], { trigger: 'onset' });
    const gates = f.api.sequence([0, 1, 2], { trigger: c => c.controls.held }); f.commit();
    f.frame(0, { audio: { onset: true }, controls: { held: true } });
    expect(hits()).toBe(1); expect(gates()).toBe(1);
    f.frame(0.1, { audio: { onset: true }, controls: { held: true } });
    expect(hits()).toBe(2); expect(gates()).toBe(1);
  });
  it('ramps start at commit, hold the endpoint, and reset on a trigger', () => {
    const f = fixture(); f.frame(10);
    const ramp = f.api.ramp({ from: 2, to: 6, period: 2 });
    const triggered = f.api.ramp({ trigger: 'onset', period: 1 }); f.commit();
    f.frame(11); expect(ramp()).toBe(4); expect(triggered()).toBe(0);
    f.frame(12, { audio: { onset: true } }); expect(ramp()).toBe(6);
    f.frame(12.5); expect(triggered()).toBe(0.5);
    f.frame(13, { audio: { onset: true } }); expect(triggered()).toBe(0);
    f.frame(20); expect(ramp()).toBe(6); expect(triggered()).toBe(1);
  });
  it('steps through all ordinary missed clock boundaries and repeats predictably', () => {
    const f = fixture(); const values = f.api.sequence([10, 20, 30], { trigger: 'beat' }); f.commit();
    f.frame(0); expect(values()).toBe(10);
    f.frame(1, { clock: { beat: 4, crossings: 4 } }); expect(values()).toBe(20); expect(values()).toBe(20);
  });
  it('reproduces seeded values at equal logical indices across frame rates', () => {
    const run = fps => {
      const f = fixture(), value = f.api.variation({ seed: 'show', period: 0.5 }); f.commit();
      for (let i = 0; i < fps * 3; i++) f.frame(i / fps);
      f.frame(3); return value();
    };
    expect(run(15)).toBe(run(120));
  });
  it('validates conflicting timing, sparse sequences, bounds, and callback outputs', () => {
    const f = fixture();
    expect(() => f.api.lfo({ period: 1, beats: 2 })).toThrow();
    expect(() => f.api.envelope({ attack: -1 })).toThrow();
    expect(() => f.api.sequence([, 2])).toThrow();
    expect(() => f.api.sequence([1], { trigger: 'onset', period: 1 })).toThrow();
    expect(() => f.api.remap(1, { from: [2, 2] })).toThrow();
    const bad = f.api.remap(() => NaN); f.commit(); f.frame(0);
    expect(() => bad()).toThrow(/finite/);
    expect(() => f.api.lfo()).toThrow(/outside draw/);
  });
  it('reports cyclic callback dependencies without blocking the host', () => {
    const f = fixture(); let value; value = f.api.remap(() => value()); f.commit();
    expect(() => f.frame(0)).not.toThrow(); expect(() => value()).toThrow(/Cyclic/);
  });
  it('runs attack, decay, held sustain, and release without retriggering a held gate', () => {
    const f = fixture();
    const value = f.api.envelope({ gate: c => c.controls.held, attack: 0.2, decay: 0.3, sustain: 0.4, release: 0.5 });
    const frame = (time, held) => f.frame(time, { controls: { held } });
    f.commit();
    frame(0, false); expect(value()).toBe(0);
    frame(1, true); expect(value()).toBe(0);
    frame(1.1, true); expect(value()).toBeCloseTo(0.5);
    frame(1.2, true); expect(value()).toBeCloseTo(1);
    frame(1.35, true); expect(value()).toBeCloseTo(0.7);
    frame(1.5, true); expect(value()).toBeCloseTo(0.4);
    frame(20, true); expect(value()).toBeCloseTo(0.4);
    frame(20, false); expect(value()).toBeCloseTo(0.4);
    frame(20.25, false); expect(value()).toBeCloseTo(0.2);
    frame(21, false); expect(value()).toBe(0);
  });
  it('releases from a partial attack and retriggers from the current release value', () => {
    const f = fixture(), value = f.api.envelope({ gate: c => c.controls.held, attack: 1, release: 1 });
    const frame = (time, held) => f.frame(time, { controls: { held } }); f.commit();
    frame(0, true); frame(0.4, true); expect(value()).toBeCloseTo(0.4);
    frame(0.4, false); expect(value()).toBeCloseTo(0.4);
    frame(0.9, false); expect(value()).toBeCloseTo(0.2);
    frame(0.9, true); expect(value()).toBeCloseTo(0.2);
    frame(1.4, true); expect(value()).toBeCloseTo(0.6);
  });
  it('releases during decay and handles zero stages, reversed ranges, and stopped beat time', () => {
    const f = fixture();
    const value = f.api.envelope({ gate: c => c.controls.held, attack: 0, decay: 2, sustain: 0.25, release: 1, unit: 'beats', min: 10, max: 2 });
    const instant = f.api.envelope({ gate: c => c.controls.held, attack: 0, decay: 0, sustain: 0.5, release: 0 });
    const frame = (time, beat, held) => f.frame(time, { clock: { beat, crossings: 0 }, controls: { held } }); f.commit();
    frame(0, 0, true); expect(value()).toBe(2); expect(instant()).toBe(0.5);
    frame(5, 0, true); expect(value()).toBe(2);
    frame(6, 1, true); expect(value()).toBe(5);
    frame(6, 1, false); expect(value()).toBe(5); expect(instant()).toBe(0);
    frame(7, 1, false); expect(value()).toBe(5);
    frame(8, 1.5, false); expect(value()).toBe(7.5);
    frame(9, 2, false); expect(value()).toBe(10);
  });
  it.each([15, 30, 60, 120])('gives the same lag step response at %s FPS', fps => {
    const f = fixture(), value = f.api.lag(1, { time: 1, initial: 0 }); f.commit();
    f.frame(0); expect(value()).toBe(0);
    for (let i = 1; i <= fps; i++) f.frame(i / fps);
    expect(value()).toBeCloseTo(1 - Math.exp(-1), 12);
    f.frame(2); expect(value()).toBeCloseTo(1 - Math.exp(-2), 12);
  });
  it('supports independent rise/fall lag, first-sample initialization, and immediate tracking', () => {
    const f = fixture(); let target = 10;
    const value = f.api.lag(() => target, { rise: 0.1, fall: 1 });
    const direct = f.api.lag(() => target, { time: 0, initial: 0 }); f.commit();
    f.frame(0); expect(value()).toBe(10); expect(direct()).toBe(10);
    target = 0; f.frame(1); expect(value()).toBeCloseTo(10 / Math.E); expect(direct()).toBe(0);
    target = 10; f.frame(1.1); expect(value()).toBeCloseTo(10 - (10 - 10 / Math.E) / Math.E);
  });
  it('holds beat-based lag when the clock stops and memoizes dependencies for all consumers', () => {
    const f = fixture(); let calls = 0;
    const source = f.api.remap(() => { calls++; return 1; });
    const value = f.api.lag(source, { time: 1, unit: 'beats', initial: 0 });
    const mapped = f.api.remap(value, { to: [20, 200] }); f.commit();
    f.frame(0); f.frame(10); expect(value()).toBe(0); expect(mapped()).toBe(20); expect(calls).toBe(2);
    f.frame(11, { clock: { beat: 1, crossings: 1 } });
    expect(value()).toBeCloseTo(1 - 1 / Math.E); expect(mapped()).toBeCloseTo(20 + 180 * value());
    value(); mapped(); expect(calls).toBe(3);
  });
  it('validates lag and ADSR options and recovers state after an invalid input frame', () => {
    const f = fixture();
    for (const options of [{ time: -1 }, { rise: Infinity }, { fall: NaN }, { initial: NaN }, { unit: 'frames' }]) {
      expect(() => f.api.lag(0, options)).toThrow();
    }
    for (const options of [{ gate: 'onset' }, { gate: true, trigger: 'beat' }, { gate: true, decay: -1 },
      { gate: true, sustain: 2 }, { gate: true, sustain: NaN }, { sustain: 0.4 }, { decay: 1 }]) {
      expect(() => f.api.envelope(options)).toThrow();
    }
    let target = 1, held = true;
    const value = f.api.lag(() => target, { time: 1, initial: 0 });
    const env = f.api.envelope({ gate: () => held, attack: 1 }); f.commit();
    f.frame(0); target = NaN; held = undefined; f.frame(0.5);
    expect(() => value()).toThrow(/finite/); expect(() => env()).toThrow(/gate/);
    target = 1; held = true; f.frame(1);
    expect(value()).toBeCloseTo(1 - 1 / Math.E); expect(env()).toBe(1);
  });
  it('restores independent lag and ADSR state from a safe-state snapshot', () => {
    const f = fixture(); let held = true;
    const value = f.api.lag(1, { time: 1, initial: 0 });
    const env = f.api.envelope({ gate: () => held, attack: 1, decay: 0, sustain: 1, release: 1 }); f.commit();
    f.frame(0); f.frame(0.5); const saved = f.runtime.snapshot();
    held = false; f.frame(0.5); f.frame(1.5); expect(env()).toBe(0);
    f.runtime.restore(saved); held = true; f.frame(0.5);
    expect(env()).toBe(0.5); expect(value()).toBeCloseTo(1 - Math.exp(-0.5));
    f.frame(1); expect(env()).toBe(1); expect(value()).toBeCloseTo(1 - 1 / Math.E);
  });
  it('does not enroll signals from a failed evaluation and rolls back a bad consumer', () => {
    const h = createTestHost(); globalThis.__values = [];
    h.evaluator.evaluate('const motion = lfo({period: 4}); const patch = c => __values.push(motion(c)); const scene = [patch]; scene.draw();');
    h.frame(3); const original = h.evaluator.binding('patch');
    const count = h.evaluator.signals.count();
    expect(h.evaluator.evaluate('const doomed = ramp(); throw Error("no");').ok).toBe(false);
    expect(h.evaluator.signals.count()).toBe(count);
    h.evaluator.evaluate('const bad = remap(() => NaN); const patch = c => bad(c);'); h.frame(3);
    expect(h.registry.getStrategy('patch').definition).toBe(original);
    expect(__values.length).toBeGreaterThan(1);
    delete globalThis.__values;
  });
});
