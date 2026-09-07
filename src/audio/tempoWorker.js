import { createSpectralOnsets } from './spectralOnsets.js';
import { createTempoTracker } from '../rhythm/tempoTracker.js';
let picker = null, tracker = createTempoTracker(), expectedAt = null;
let resultReady = true, latestResult = null;
self.onmessage = ({ data }) => {
  if (data.ack) { resultReady = true; return; }
  const port = data.port;
  port.onmessage = ({ data: { at, sampleRate, samples } }) => {
    if (!picker || (expectedAt !== null && Math.abs(at - expectedAt) > 0.02)) {
      picker = createSpectralOnsets(sampleRate); tracker.reset();
    }
    expectedAt = at + samples.length / sampleRate;
    let result = null;
    for (const hit of picker.push(samples, at)) result = tracker.push(hit.at, hit.strength) ?? result;
    if (result) latestResult = result;
    if (latestResult && resultReady) {
      self.postMessage(latestResult); latestResult = null; resultReady = false;
    }
    port.postMessage('ready');
  };
  port.start();
};
