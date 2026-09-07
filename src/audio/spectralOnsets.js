// A bounded, causal STFT novelty detector. FFT work runs in the analysis worker;
// the audio callback only supplies PCM. Timestamp events at the analysis window
// center, so buffering/worker latency does not move the estimated musical phase.
const SIZE = 2048, HOP = 512;
export function createSpectralOnsets(sampleRate) {
  const ring = new Float32Array(SIZE), real = new Float64Array(SIZE), imag = new Float64Array(SIZE);
  const window = Float64Array.from({ length: SIZE }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (SIZE - 1)));
  const reversed = Uint16Array.from({ length: SIZE }, (_, i) => {
    let n = i, value = 0;
    for (let bit = 0; bit < 11; bit++) { value = value * 2 + (n & 1); n >>= 1; }
    return value;
  });
  const previous = new Float64Array(SIZE / 2), peaks = new Float64Array(SIZE / 2);
  let cursor = 0, count = 0, lastFlux = 0, lastFluxAt = 0, average = 0, lastHit = -Infinity;
  function transform() {
    let energy = 0;
    for (let i = 0; i < SIZE; i++) {
      const value = ring[(cursor + i) % SIZE]; energy += value * value;
      real[reversed[i]] = value * window[i]; imag[reversed[i]] = 0;
    }
    for (let length = 2; length <= SIZE; length *= 2) {
      const angle = -2 * Math.PI / length, stepR = Math.cos(angle), stepI = Math.sin(angle);
      for (let base = 0; base < SIZE; base += length) {
        let wr = 1, wi = 0;
        for (let i = 0; i < length / 2; i++) {
          const a = base + i, b = a + length / 2;
          const tr = wr * real[b] - wi * imag[b], ti = wr * imag[b] + wi * real[b];
          real[b] = real[a] - tr; imag[b] = imag[a] - ti;
          real[a] += tr; imag[a] += ti;
          const next = wr * stepR - wi * stepI; wi = wr * stepI + wi * stepR; wr = next;
        }
      }
    }
    let low = 0, high = 0, lowBins = 0, highBins = 0;
    for (let i = 1; i < SIZE / 2; i++) {
      const hz = i * sampleRate / SIZE;
      if (hz > 8000) break;
      const magnitude = Math.hypot(real[i], imag[i]) / SIZE;
      peaks[i] = Math.max(magnitude, peaks[i] * 0.995, 0.0001);
      const normalized = magnitude / peaks[i];
      const change = Math.max(0, normalized - previous[i]); previous[i] = normalized;
      if (hz <= 250) { low += change; lowBins++; }
      else { high += change; highBins++; }
    }
    return { flux: low / lowBins * 0.75 + high / highBins * 0.25, rms: Math.sqrt(energy / SIZE) };
  }
  return {
    push(samples, at) {
      const hits = [];
      for (let i = 0; i < samples.length; i++) {
        ring[cursor] = samples[i]; cursor = (cursor + 1) % SIZE;
        if (++count % HOP !== 0) continue;
        const { flux, rms } = transform();
        const time = at + (i + 1 - SIZE / 2) / sampleRate;
        if (lastFlux > Math.max(0.015, average * 1.8) && lastFlux > flux && time - lastHit > 0.12 && rms > 0.002) {
          hits.push({ at: lastFluxAt, strength: lastFlux }); lastHit = lastFluxAt;
        }
        average += (flux - average) * 0.05;
        lastFlux = flux; lastFluxAt = time;
      }
      return hits;
    },
  };
}
