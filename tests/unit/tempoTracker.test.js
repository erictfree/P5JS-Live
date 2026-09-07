import { describe, it, expect } from 'vitest';
import { rhythmSamples } from '../fixtures/rhythm-audio.js';
import { trackFixture } from '../fixtures/tempo-harness.js';

describe.each(['plp', 'grid'])('causal audio tempo tracking (%s)', algorithm => {
  it.each([60, 90, 123, 150, 180])('tracks an original %s BPM audio fixture within ten seconds', bpm => {
    const fixture = rhythmSamples({ bpm });
    const result = trackFixture(fixture, algorithm);
    expect(result.estimates.length).toBeGreaterThan(3);
    expect(result.estimates[0].at).toBeLessThan(10);
    const errors = result.estimates.map(e => Math.abs(e.bpm - bpm) / bpm);
    expect(errors.at(-1)).toBeLessThan(0.02);
    const phaseErrors = result.estimates.map(e => Math.min(...fixture.beats.map(t => Math.abs(t - e.beatAt)))).sort((a, b) => a - b);
    expect(phaseErrors[Math.floor(phaseErrors.length / 2)]).toBeLessThan(0.06);
    expect(result.retained).toBeLessThanOrEqual(algorithm === 'plp' ? 563 : 80);
  });
  it.each(['silence', 'tone', 'noise'])('does not invent a tempo from %s', kind => {
    expect(trackFixture(rhythmSamples({ [kind]: true }), algorithm).estimates).toEqual([]);
  });
  it.each([{ missing: true }, { syncopated: true }, { jitter: 0.008 }])('tolerates %j in a rhythmic fixture', options => {
    const result = trackFixture(rhythmSamples({ bpm: 120, seconds: 20, ...options }), algorithm);
    expect(result.estimates.length).toBeGreaterThan(0);
    expect(Math.abs(result.estimates.at(-1).bpm - 120)).toBeLessThan(2.4);
  });
});

describe('streaming pulse tracker', () => {
  it.each([44100, 48000])('tracks a dense musical fixture at %s Hz', sampleRate => {
    const fixture = rhythmSamples({ bpm: 120, seconds: 20, sampleRate, dense: true, missing: true });
    const { estimates } = trackFixture(fixture);
    expect(estimates[0]?.at).toBeLessThan(10);
    expect(Math.abs(estimates.at(-1)?.bpm - 120)).toBeLessThan(2.4);
    const nearEnd = estimates.filter(e => e.at > 10);
    expect(nearEnd.length).toBeGreaterThan(30);
    expect(nearEnd.filter(e => Math.abs(e.bpm - 120) < 2.4).length / nearEnd.length).toBeGreaterThan(0.9);
  });
  it('reacquires a changed tempo and stops supporting the clock when sound ends', () => {
    const fixture = rhythmSamples({ bpm: 120, changeTo: 150, seconds: 30 });
    fixture.samples.fill(0, 25 * fixture.sampleRate);
    const { estimates } = trackFixture(fixture);
    expect(estimates.find(e => e.at > 15 && Math.abs(e.bpm - 150) < 3)?.at).toBeLessThan(22);
    expect(estimates.at(-1).at).toBeLessThan(25.1);
  });
});
