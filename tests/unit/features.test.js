// The shared audio snapshot.

import { describe, it, expect } from 'vitest';
import { createFeatureExtractor } from '../../src/audio/features.js';

const frame = (over = {}) => ({
  dt: 1 / 60,
  level: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  centroid: 0,
  nyquist: 22050,
  ...over,
});

describe('normalized bands', () => {
  it('keeps every summary value inside 0..1', () => {
    const fx = createFeatureExtractor();
    for (let i = 0; i < 200; i++) {
      const s = fx.compute(
        frame({ level: Math.random() * 3, bass: Math.random() * 400, mid: 255, treble: -20 }),
      );
      for (const key of ['level', 'bass', 'mid', 'treble', 'centroid']) {
        expect(s[key]).toBeGreaterThanOrEqual(0);
        expect(s[key]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('preserves p5.sound’s own scales under raw', () => {
    const fx = createFeatureExtractor();
    const s = fx.compute(frame({ bass: 200, mid: 100, treble: 30, centroid: 1200 }));
    expect(s.raw.bass).toBe(200);
    expect(s.raw.mid).toBe(100);
    expect(s.raw.centroid).toBe(1200);
  });

  it('exposes raw analysis as immutable plain arrays with the standard higher-order API', () => {
    const fx = createFeatureExtractor();
    const s = fx.compute(frame({
      nyquist: 24000,
      waveform: new Float32Array([-1, -0.5, 0, 0.5, 1]),
      spectrum: new Uint8Array([0, 40, 120, 240]),
    }));

    expect(Array.isArray(s.waveform)).toBe(true);
    expect(Array.isArray(s.spectrum)).toBe(true);
    expect(Object.isFrozen(s.waveform)).toBe(true);
    expect(Object.isFrozen(s.spectrum)).toBe(true);
    expect(s.waveform.map((sample) => sample * 2)).toEqual([-2, -1, 0, 1, 2]);
    expect(s.spectrum.filter((magnitude) => magnitude >= 100)).toEqual([120, 240]);
    expect(s.spectrum.reduce((total, magnitude) => total + magnitude, 0)).toBe(400);
    expect(s.sampleRate).toBe(48000);
    expect(s.nyquist).toBe(24000);
    expect(s.raw.waveform).toBe(s.waveform);
    expect(s.raw.spectrum).toBe(s.spectrum);
  });

  it('auto-gain makes a quiet source useful without pinning it at 1', () => {
    const fx = createFeatureExtractor();
    let last = 0;
    // A steady, quiet bass — a fixed /255 divisor would leave this near 0.04.
    for (let i = 0; i < 200; i++) last = fx.compute(frame({ bass: 10 })).bass;
    expect(last).toBeGreaterThan(0.8);
    expect(last).toBeLessThan(0.85);
  });

  it('uses one spectral ceiling so bass, mid and treble keep their balance', () => {
    const fx = createFeatureExtractor();
    let last;
    for (let i = 0; i < 200; i++) {
      last = fx.compute(frame({ bass: 200, mid: 100, treble: 50 }));
    }
    expect(last.bass).toBeGreaterThan(0.8);
    expect(last.mid / last.bass).toBeCloseTo(0.5, 2);
    expect(last.treble / last.bass).toBeCloseTo(0.25, 2);
  });

  it('auto-gain can be turned off mid-set', () => {
    const fx = createFeatureExtractor();
    for (let i = 0; i < 200; i++) fx.compute(frame({ bass: 10 }));
    expect(fx.compute(frame({ bass: 10 })).bass).toBeGreaterThan(0.8);

    fx.configure({ autoGain: false });
    // Now the raw proportion comes through: 10/255 is genuinely quiet.
    expect(fx.compute(frame({ bass: 10 })).bass).toBeLessThan(0.1);

    // And back on again, without having to reload or reset.
    fx.configure({ autoGain: true });
    expect(fx.compute(frame({ bass: 10 })).bass).toBeGreaterThan(0.8);
  });

  it('smoothing is adjustable and bounded to known keys', () => {
    const fx = createFeatureExtractor();
    expect(fx.configure({ smoothing: 0.9 }).smoothing).toBe(0.9);
    // An unknown key is ignored rather than quietly added to the option set.
    expect(fx.configure({ notAnOption: 1 }).notAnOption).toBeUndefined();
  });

  it('returns a frozen snapshot so one strategy cannot alter another’s audio', () => {
    const fx = createFeatureExtractor();
    const s = fx.compute(frame({ bass: 100, waveform: [0, 1], spectrum: [20, 40] }));
    expect(Object.isFrozen(s)).toBe(true);
    expect(Object.isFrozen(s.raw)).toBe(true);
    expect(() => s.waveform.push(2)).toThrow();
    expect(() => s.spectrum.sort()).toThrow();
  });

  it('treats silence as silence', () => {
    const s = createFeatureExtractor().silence();
    expect(s.level).toBe(0);
    expect(s.onset).toBe(false);
    expect(s.spectrum.length).toBe(0);
  });

  it('survives NaN and missing fields without emitting NaN', () => {
    const fx = createFeatureExtractor();
    const s = fx.compute({ dt: NaN, level: NaN, bass: undefined, nyquist: 0 });
    for (const key of ['level', 'bass', 'mid', 'treble', 'centroid', 'sinceOnset']) {
      expect(Number.isFinite(s[key])).toBe(true);
    }
  });
});

describe('onset detection', () => {
  it('fires on a rising edge and not on the frames that follow it', () => {
    const fx = createFeatureExtractor({ minOnsetInterval: 0.05 });
    for (let i = 0; i < 60; i++) fx.compute(frame({ bass: 20 })); // settle on quiet

    const hits = [];
    for (let i = 0; i < 20; i++) {
      // one loud frame, then sustained loudness
      hits.push(fx.compute(frame({ bass: 220 })).onset);
    }
    expect(hits[0]).toBe(true);
    expect(hits.slice(1, 6).every((b) => b === false)).toBe(true);
  });

  it('never beats on silence', () => {
    const fx = createFeatureExtractor();
    for (let i = 0; i < 300; i++) {
      expect(fx.compute(frame({ bass: 0, level: 0 })).onset).toBe(false);
    }
  });

  it('reports seconds since the last onset', () => {
    const fx = createFeatureExtractor({ minOnsetInterval: 0.05 });
    for (let i = 0; i < 60; i++) fx.compute(frame({ bass: 20 }));
    expect(fx.compute(frame({ bass: 220 })).onset).toBe(true);
    let s;
    for (let i = 0; i < 30; i++) s = fx.compute(frame({ bass: 220 }));
    expect(s.sinceOnset).toBeGreaterThan(0.4);
    expect(s.sinceOnset).toBeLessThan(0.6);
  });
});
