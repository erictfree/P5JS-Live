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
