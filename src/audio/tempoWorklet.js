// Copy mono PCM only. A worker performs spectral analysis. One batch can be in
// flight; if the worker stalls, replace unsent samples rather than growing a queue.
class TempoAnalysisProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.batch = new Float32Array(4096); this.used = 0; this.ready = true; this.at = 0;
    this.port.onmessage = () => { this.ready = true; };
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      if (this.used === 0) this.at = currentTime + i / sampleRate;
      let value = 0;
      for (const channel of channels) value += channel[i] / channels.length;
      this.batch[this.used++] = value;
      if (this.used !== this.batch.length) continue;
      if (this.ready) {
        const samples = this.batch.slice();
        this.port.postMessage({ at: this.at, sampleRate, samples }, [samples.buffer]);
        this.ready = false;
      }
      this.used = 0;
    }
    // Outputs remain zero; microphone analysis is never monitored to speakers.
    return true;
  }
}
registerProcessor('astra-tempo-analysis', TempoAnalysisProcessor);
