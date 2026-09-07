// Optional comparison dependency stays outside the project:
// node scripts/benchmark-tempo.mjs --aubio=/tmp/astra-tempo-comparison/node_modules/aubiojs/build/aubio.js
// --recording=/tmp/intro.f32 accepts mono 48 kHz little-endian float PCM.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { rhythmSamples } from '../tests/fixtures/rhythm-audio.js';
import { trackFixture } from '../tests/fixtures/tempo-harness.js';
const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
const aubio = args.aubio ? await (await import(pathToFileURL(args.aubio))).default() : null;
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? null;
const cases = [
  ...[60, 90, 123, 150, 180].map(bpm => ({ name: `${bpm} BPM`, bpm })),
  { name: 'Missing hits', bpm: 120, missing: true, seconds: 20 },
  { name: 'Syncopation', bpm: 120, syncopated: true },
  { name: 'Dense hats + missing kicks + chord', bpm: 120, dense: true, missing: true, seconds: 20 },
  { name: 'Jitter ±8ms', bpm: 120, jitter: 0.008 },
  { name: '120 → 150 BPM', bpm: 120, changeTo: 150, seconds: 30 },
  { name: 'Silence', silence: true }, { name: 'Sustained tone', tone: true }, { name: 'Noise', noise: true },
];
if (args.recording) {
  const bytes = readFileSync(args.recording);
  cases.push({ name: 'Existing intro.mp3 (unannotated)', fixture: { samples: new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), sampleRate: 48000, beats: [] } });
}
const report = [];
for (const options of cases) {
  const fixture = options.fixture ?? rhythmSamples(options);
  const row = { fixture: options.name, duration: fixture.samples.length / fixture.sampleRate };
  for (const algorithm of ['plp', 'grid']) {
    const start = performance.now();
    const result = trackFixture(fixture, algorithm);
    const elapsed = performance.now() - start;
    const phaseErrors = fixture.beats.length ? result.estimates.map(e => Math.min(...fixture.beats.map(t => Math.abs(t - e.beatAt))) * 1000) : [];
    // Union of intervals with fresh evidence as observed at batch delivery.
    // Repeated predictions from one onset cannot inflate tracking coverage.
    let end = 0, covered = 0;
    for (const estimate of result.estimates) {
      const until = Math.min(row.duration, estimate.at + 0.75);
      covered += Math.max(0, until - Math.max(end, estimate.receivedAt));
      end = Math.max(end, until);
    }
    row[algorithm] = { firstEstimateSeconds: result.estimates[0]?.receivedAt ?? null, finalBpm: result.estimates.at(-1)?.bpm ?? null,
      medianPhaseErrorMs: median(phaseErrors), trackingCoveragePercent: covered / row.duration * 100,
      estimates: result.estimates.length, analysisMs: elapsed, retainedFramesOrHits: result.retained };
  }
  if (aubio) {
    const tempo = new aubio.Tempo(2048, 512, fixture.sampleRate), estimates = [];
    const started = performance.now();
    for (let i = 0; i + 512 <= fixture.samples.length; i += 512) {
      const event = tempo.do(fixture.samples.subarray(i, i + 512));
      const bpm = tempo.getBpm();
      if (event && bpm > 0) estimates.push({ at: i / fixture.sampleRate, bpm, confidence: tempo.getConfidence() });
    }
    row.aubio = { firstEstimateSeconds: estimates[0]?.at ?? null, finalBpm: estimates.at(-1)?.bpm ?? null,
      estimates: estimates.length, analysisMs: performance.now() - started };
    tempo.delete();
  }
  report.push(row);
}
console.log(JSON.stringify(report, null, 2));
