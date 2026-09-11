import { describe, expect, it, vi } from 'vitest';
import { WAVEFORMS, createModulationEngine, validateModulation, waveValue } from '../../src/performance/modulations.js';

function fakeRegistry(params) {
  const map = new Map(params.map(p => [p.name, { ...p }]));
  return { listParams: () => [...map.values()].map(p => ({ ...p })), set: (name, value) => { map.get(name).value = value; } };
}
const size = { name: 'size', value: 50, min: 10, max: 110, step: 1 };
const mix = { name: 'mix', value: 0.5, min: 0, max: 1 };
const ids = () => { let n = 0; return () => `m${++n}`; };

describe('modulation waveforms', () => {
  it('cover the documented shapes in [-1, 1]', () => {
    expect(waveValue('sine', 0.25)).toBeCloseTo(1);
    expect(waveValue('triangle', 0)).toBe(-1);
    expect(waveValue('triangle', 0.5)).toBe(1);
    expect(waveValue('rampUp', 0.75)).toBe(0.5);
    expect(waveValue('rampDown', 0.75)).toBe(-0.5);
    expect(waveValue('square', 0.2)).toBe(1);
    expect(waveValue('square', 0.7)).toBe(-1);
    const state = { cycle: -1, value: 0 };
    const random = vi.fn().mockReturnValueOnce(1).mockReturnValueOnce(0);
    expect(waveValue('random', 0.1, random, state)).toBe(1);
    expect(waveValue('random', 0.9, random, state)).toBe(1); // held within the cycle
    expect(waveValue('random', 1.1, random, state)).toBe(-1); // new cycle, new value
    expect(waveValue('nope', 0.3)).toBe(0);
  });

  it('validates and clamps a modulation record', () => {
    expect(validateModulation({})).toBeNull();
    expect(validateModulation({ target: 'size', wave: 'weird', beats: 999, depth: 4, offset: -3, sync: 'yes' })).toMatchObject({ target: 'size', wave: 'sine', beats: 64, depth: 1, offset: -1, sync: true, on: true });
  });
});

describe('modulation engine', () => {
  it('swings a control around its base value, beat-synced, and leaves the registry untouched', () => {
    const registry = fakeRegistry([size, mix]);
    const engine = createModulationEngine({ registry, makeId: ids() });
    const m = engine.add({ target: 'size', wave: 'sine', beats: 1, depth: 0.5 });
    expect(m).toMatchObject({ id: 'm1', target: 'size', on: true, name: 'size ∿' });

    engine.frame({ running: true, beat: 0.25, bpm: 120 }, 1);
    expect(engine.value('size')).toBe(100); // 50 + 1 * 0.5 * 100
    expect(engine.modulate('size', 50)).toBe(100);
    expect(engine.modulate('mix', 0.5)).toBe(0.5);
    expect(registry.listParams().find(p => p.name === 'size').value).toBe(50);

    engine.frame({ running: true, beat: 0.75, bpm: 120 }, 2);
    expect(engine.value('size')).toBe(10); // clamped to min
    expect(engine.running('size')).toBe(true);
  });

  it('follows the knob: a new base value shifts the swing', () => {
    const registry = fakeRegistry([mix]);
    const engine = createModulationEngine({ registry, makeId: ids() });
    engine.add({ target: 'mix', wave: 'square', beats: 2, depth: 0.1 });
    engine.frame({ running: true, beat: 0.5, bpm: 120 }, 1);
    expect(engine.value('mix')).toBeCloseTo(0.6);
    registry.set('mix', 0.2);
    engine.frame({ running: true, beat: 0.5, bpm: 120 }, 2);
    expect(engine.value('mix')).toBeCloseTo(0.3);
  });

  it('free-runs in Hz when the clock is off or sync is disabled', () => {
    const registry = fakeRegistry([mix]);
    const engine = createModulationEngine({ registry, makeId: ids() });
    engine.add({ target: 'mix', wave: 'rampUp', hz: 1, sync: false, depth: 0.5, offset: 0 });
    engine.frame({ running: true, beat: 3 }, 10);
    expect(engine.value('mix')).toBeCloseTo(0); // phase 0 → -1 * 0.5 → clamp 0
    engine.frame({ running: true, beat: 3 }, 10.5);
    expect(engine.value('mix')).toBeCloseTo(0.5); // phase 0.5 → 0
    engine.frame({ running: true, beat: 3 }, 10.75);
    expect(engine.value('mix')).toBeCloseTo(0.75);
  });

  it('stacks two modulations on one target and drops ones whose control is gone', () => {
    const registry = fakeRegistry([mix]);
    const engine = createModulationEngine({ registry, makeId: ids() });
    engine.add({ target: 'mix', wave: 'square', beats: 1, depth: 0.1 });
    engine.add({ target: 'mix', wave: 'square', beats: 1, depth: 0.2 });
    engine.add({ target: 'ghost', wave: 'sine' });
    engine.frame({ running: true, beat: 0.25 }, 1);
    expect(engine.value('mix')).toBeCloseTo(0.8);
    expect(engine.value('ghost')).toBeUndefined();
  });

  it('toggles per target from the Push buttons, creating a default the first time', () => {
    const registry = fakeRegistry([size]);
    const engine = createModulationEngine({ registry, makeId: ids() });
    const listener = vi.fn(); engine.subscribe(listener);
    expect(engine.toggleForTarget('size')).toMatchObject({ id: 'm1', wave: 'sine', beats: 1, on: true });
    expect(engine.toggleForTarget('size')).toMatchObject({ id: 'm1', on: false });
    expect(engine.list()).toHaveLength(1);
    engine.frame({ running: true, beat: 0.25 }, 1);
    expect(engine.running('size')).toBe(false);
    expect(engine.value('size')).toBeUndefined();
    expect(engine.cycleWave('m1').wave).toBe(WAVEFORMS[1]);
    expect(engine.cycleWave('nope')).toBeNull();
    expect(listener).toHaveBeenCalled();
  });

  it('updates, removes, exports and imports', () => {
    const registry = fakeRegistry([size, mix]);
    const engine = createModulationEngine({ registry, makeId: ids() });
    engine.add({ target: 'size' });
    expect(engine.update('m1', { depth: 0.9, target: 'mix', name: 'Wobble' })).toMatchObject({ target: 'mix', depth: 0.9, name: 'Wobble' });
    expect(engine.update('zzz', { depth: 1 })).toBeNull();
    const saved = engine.export();
    expect(saved).toEqual([expect.objectContaining({ id: 'm1', target: 'mix', wave: 'sine', beats: 1, depth: 0.9, on: true })]);
    expect(engine.remove('m1')).toBe(true);
    expect(engine.remove('m1')).toBe(false);
    expect(engine.import([...saved, { junk: true }, { target: 'size', wave: 'square', on: false }])).toBe(2);
    expect(engine.list().map(m => [m.id, m.target, m.on])).toEqual([['m1', 'mix', true], [expect.any(String), 'size', false]]);
    engine.reset();
    expect(engine.list()).toEqual([]);
  });
});
