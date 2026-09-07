import { createSpectralOnsets, SPECTRAL_HOP } from './spectralOnsets.js';
import { createTempoTracker } from '../rhythm/tempoTracker.js';
import { createPlpTracker } from '../rhythm/plpTracker.js';

// Shared by the worker and PCM benchmark so both exercise the same pipeline.
export function createTempoDetector({ sampleRate, algorithm = 'plp' }) {
  if (!['plp', 'grid'].includes(algorithm)) throw new TypeError('Unknown tempo algorithm');
  const picker = createSpectralOnsets(sampleRate);
  const tracker = algorithm === 'plp'
    ? createPlpTracker({ hopSeconds: SPECTRAL_HOP / sampleRate }) : createTempoTracker();
  return {
    push(samples, at) {
      const estimates = [];
      const hits = picker.push(samples, at, algorithm === 'plp' ? frame => {
        const result = tracker.push(frame);
        if (result) estimates.push(result);
      } : undefined);
      if (algorithm === 'grid') for (const hit of hits) {
        const result = tracker.push(hit.at, hit.strength);
        if (result) estimates.push(result);
      }
      return { hits, estimates };
    },
    size: tracker.size,
  };
}
