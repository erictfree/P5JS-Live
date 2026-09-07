import { createTempoDetector } from './tempoDetector.js';
let detector = null, expectedAt = null, previousRate = null;
let resultReady = true, latestResult = null;
self.onmessage = ({ data }) => {
  if (data.ack) { resultReady = true; return; }
  const port = data.port;
  const algorithm = data.algorithm;
  port.onmessage = ({ data: { at, sampleRate, samples } }) => {
    if (!detector || sampleRate !== previousRate || (expectedAt !== null && Math.abs(at - expectedAt) > 0.02)) {
      detector = createTempoDetector({ sampleRate, algorithm }); latestResult = null;
    }
    previousRate = sampleRate;
    expectedAt = at + samples.length / sampleRate;
    const result = detector.push(samples, at).estimates.at(-1);
    if (result) latestResult = result;
    if (latestResult && resultReady) {
      self.postMessage(latestResult); latestResult = null; resultReady = false;
    }
    port.postMessage('ready');
  };
  port.start();
};
