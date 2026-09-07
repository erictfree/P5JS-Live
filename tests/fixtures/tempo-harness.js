import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createTempoDetector } from '../../src/audio/tempoDetector.js';
const source = readFileSync(new URL('../../src/audio/tempoWorklet.js', import.meta.url), 'utf8');
// Execute the actual worklet with synthetic audio callback blocks. This checks the
// PCM-to-hop boundary as well as the tracker, without duplicating its arithmetic.
export function trackFixture({ samples, sampleRate }, algorithm = 'plp') {
  const detector = createTempoDetector({ sampleRate, algorithm });
  const estimates = [], hits = [];
  let Processor;
  const context = vm.createContext({ sampleRate, currentTime: 0, registerProcessor: (_, Class) => { Processor = Class; },
    AudioWorkletProcessor: class {
      constructor() { this.port = { postMessage: ({ at, samples }) => {
        const result = detector.push(samples, at);
        hits.push(...result.hits);
        estimates.push(...result.estimates.map(estimate => ({ ...estimate, receivedAt: at + samples.length / sampleRate })));
        // The real worker acknowledges asynchronously.
        this.acknowledge = true;
      } }; }
    },
  });
  vm.runInContext(source, context);
  const processor = new Processor();
  for (let i = 0; i + 128 <= samples.length; i += 128) {
    context.currentTime = i / sampleRate;
    processor.process([[samples.subarray(i, i + 128)]]);
    if (processor.acknowledge) { processor.port.onmessage(); processor.acknowledge = false; }
  }
  return { estimates, hits, retained: detector.size() };
}
