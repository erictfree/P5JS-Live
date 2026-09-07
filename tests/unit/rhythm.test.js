import { describe, it, expect } from 'vitest';
import { createTapTempo } from '../../src/rhythm/tapTempo.js';
import { createBeatClock, validateRhythmSettings } from '../../src/rhythm/clock.js';
import { createRhythmManager } from '../../src/rhythm/rhythmManager.js';
import { createTestHost } from './helpers.js';

describe('manual rhythm', () => {
  it('estimates jittered taps, ignores duplicates, and recovers after a pause', () => {
    const taps = createTapTempo();
    let result;
    for (let i = 0; i < 8; i++) result = taps.tap(i * 0.5 + (i % 2 ? 0.006 : 0));
    expect(result.bpm).toBeCloseTo(120, 0);
    expect(taps.tap(3.52)).toBeNull();
    expect(taps.tap(10)).toBeNull();
    expect(taps.tap(11).bpm).toBe(60);
  });
  it('rejects a single interval outlier', () => {
    const taps = createTapTempo();
    for (const t of [0, 0.5, 1, 1.5, 2]) taps.tap(t);
    expect(taps.tap(2.8).bpm).toBe(120);
  });
  it.each([15, 30, 60, 120])('does not accumulate drift after ten minutes at %s FPS', fps => {
    const clock = createBeatClock({ now: () => 0 });
    clock.setRate(123, 0);
    for (let i = 0; i <= 600 * fps; i++) clock.sample(i / fps);
    expect(clock.position(600)).toBeCloseTo(1230, 9);
  });
  it('counts ordinary missed boundaries but suppresses suspension backlog', () => {
    const clock = createBeatClock({ now: () => 0 });
    clock.setRate(240, 0); clock.sample(0);
    expect(clock.sample(1).crossings).toBe(4);
    expect(clock.sample(10).crossings).toBe(0);
    expect(clock.sample(10.25).crossings).toBe(1);
  });
  it('preserves phase through tempo edits and holds when Off', () => {
    let time = 0;
    const rhythm = createRhythmManager({ now: () => time });
    rhythm.configure({ source: 'manual', bpm: 120 });
    time = 0.3;
    expect(rhythm.sample().phase).toBeCloseTo(0.6);
    rhythm.configure({ bpm: 60 });
    expect(rhythm.sample().phase).toBeCloseTo(0.6);
    time = 0.5; rhythm.configure({ source: 'off' });
    const held = rhythm.sample().beat;
    time = 50;
    expect(rhythm.sample().beat).toBe(held);
    expect(rhythm.snapshot().bpm).toBeNull();
    expect(() => rhythm.configure({ bpm: NaN })).toThrow();
    expect(rhythm.settings().source).toBe('off');
  });
  it('keeps automatic estimates out of Manual and rejects stale generations', () => {
    let time = 1;
    const rhythm = createRhythmManager({ now: () => time });
    const estimate = { bpm: 120, at: 1, beatAt: 1, confidence: 0.9 };
    expect(rhythm.receiveEstimate(estimate)).toBe(false);
    rhythm.configure({ source: 'auto' });
    expect(rhythm.receiveEstimate(estimate, 0)).toBe(false);
    expect(rhythm.receiveEstimate(estimate, rhythm.generation())).toBe(true);
    time = 2;
    expect(rhythm.sample().status).toBe('holding');
    time = 3; rhythm.sample(); time = 4.1;
    expect(rhythm.sample().status).toBe('lost');
    rhythm.tap(); time += 0.5; rhythm.tap();
    expect(rhythm.settings()).toMatchObject({ source: 'manual', bpm: 120 });
    expect(rhythm.receiveEstimate({ ...estimate, at: time })).toBe(false);
  });
  it('provides the same frozen clock to every patch and keeps phase through scene edits', () => {
    const h = createTestHost(); globalThis.__clocks = [];
    h.evaluator.evaluate('const a = c => __clocks.push(c.clock); const scene = [a, a]; scene.draw();');
    h.host.rhythm.configure({ source: 'manual', bpm: 120 });
    h.frame(3);
    expect(__clocks.at(-1)).toBe(__clocks.at(-2));
    expect(Object.isFrozen(__clocks.at(-1))).toBe(true);
    const beat = __clocks.at(-1).beat;
    h.evaluator.evaluate('const other = [a]; other.draw();'); h.frame(3);
    expect(__clocks.at(-1).beat).toBeGreaterThan(beat);
    delete globalThis.__clocks;
  });
});

it('holds the last published Auto phase across a long suspension', () => {
  let time = 0;
  const rhythm = createRhythmManager({ now: () => time });
  rhythm.configure({ source: 'auto' });
  rhythm.receiveEstimate({ bpm: 120, at: 0, beatAt: 0, confidence: 0.9 });
  time = 0.5; const before = rhythm.sample();
  time = 30; const after = rhythm.sample();
  expect(after.beat).toBe(before.beat);
  expect(after.crossings).toBe(0);
  expect(after.status).toBe('listening');
});

it('changes algorithms atomically and rejects evidence from the previous tracker', () => {
  const rhythm = createRhythmManager({ now: () => 1 });
  expect(rhythm.settings().algorithm).toBe('plp');
  rhythm.configure({ source: 'auto' });
  const generation = rhythm.generation();
  const estimate = { bpm: 123, at: 1, beatAt: 1, confidence: 0.9 };
  expect(rhythm.receiveEstimate(estimate, generation)).toBe(true);
  rhythm.configure({ algorithm: 'grid' });
  expect(rhythm.sample()).toMatchObject({ status: 'listening', running: false, bpm: null });
  expect(rhythm.receiveEstimate(estimate, generation)).toBe(false);
  expect(rhythm.receiveEstimate(estimate, rhythm.generation())).toBe(true);
  expect(() => rhythm.configure({ algorithm: 'unavailable' })).toThrow('Unknown tempo algorithm');
  expect(rhythm.settings().algorithm).toBe('grid');
  expect(validateRhythmSettings({ source: 'auto' }).algorithm).toBe('plp');
});
