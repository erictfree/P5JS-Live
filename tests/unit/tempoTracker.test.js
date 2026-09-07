import { describe, it, expect } from 'vitest';
import { rhythmSamples } from '../fixtures/rhythm-audio.js';
import { trackFixture } from '../fixtures/tempo-harness.js';

describe('causal audio tempo tracking', () => {
  it.each([60, 90, 123, 150, 180])('tracks an original %s BPM audio fixture within ten seconds', bpm => {
    const fixture = rhythmSamples({ bpm });
    const result = trackFixture(fixture);
    expect(result.estimates.length).toBeGreaterThan(3);
    expect(result.estimates[0].at).toBeLessThan(10);
    const errors = result.estimates.map(e => Math.abs(e.bpm - bpm) / bpm);
    expect(errors.at(-1)).toBeLessThan(0.02);
    const phaseErrors = result.estimates.map(e => Math.min(...fixture.beats.map(t => Math.abs(t - e.beatAt)))).sort((a, b) => a - b);
    expect(phaseErrors[Math.floor(phaseErrors.length / 2)]).toBeLessThan(0.06);
    expect(result.retained).toBeLessThanOrEqual(80);
  });
  it.each(['silence', 'tone'])('does not invent a tempo from %s', kind => {
    expect(trackFixture(rhythmSamples({ [kind]: true })).estimates).toEqual([]);
  });
  it.each([{ missing: true }, { syncopated: true }, { jitter: 0.008 }])('tolerates %j in a rhythmic fixture', options => {
    const result = trackFixture(rhythmSamples({ bpm: 120, seconds: 20, ...options }));
    expect(result.estimates.length).toBeGreaterThan(0);
    expect(Math.abs(result.estimates.at(-1).bpm - 120)).toBeLessThan(2.4);
  });
});
