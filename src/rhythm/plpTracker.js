// Streaming predominant local pulse, inspired by Meier, Chiu & Müller (2024):
// https://transactions.ismir.net/articles/10.5334/tismir.189
// Original implementation: a causal Fourier tempogram followed by overlapping
// pulse kernels. No future audio or model weights are required. Quality is a
// heuristic stability score, not a probability of musical correctness.
const TAU = 2 * Math.PI;
const wrap = phase => Math.atan2(Math.sin(phase), Math.cos(phase));
const clamp = x => Math.max(0, Math.min(1, x));

export function createPlpTracker({ hopSeconds }) {
  const windowSeconds = 6;
  const capacity = Math.ceil(windowSeconds / hopSeconds);
  const novelty = new Float64Array(capacity);
  const times = new Float64Array(capacity);
  const weights = Float64Array.from({ length: capacity }, (_, lag) =>
    0.5 + 0.5 * Math.cos(Math.PI * lag / capacity));
  const bins = Array.from({ length: 141 }, (_, i) => {
    const bpm = 60 + i;
    return { bpm,
      cos: Float64Array.from(weights, (weight, lag) => weight * Math.cos(TAU * bpm / 60 * lag * hopSeconds)),
      sin: Float64Array.from(weights, (weight, lag) => -weight * Math.sin(TAU * bpm / 60 * lag * hopSeconds)),
    };
  });
  let cursor, count, average, lastAt, nextAnalysis, kernels, lastSupportAt, stableSince, previous;
  function reset() {
    novelty.fill(0); times.fill(0); cursor = 0; count = 0; average = 0;
    lastAt = -Infinity; nextAnalysis = -Infinity; kernels = [];
    lastSupportAt = -Infinity; stableSince = null; previous = null;
  }
  reset();
  function push({ at, flux, rms }) {
    if (![at, flux, rms].every(Number.isFinite) || at <= lastAt) return null;
    if (at - lastAt > hopSeconds * 1.5) reset();
    lastAt = at;
    average += (flux - average) * (1 - Math.exp(-hopSeconds / 0.5));
    novelty[cursor] = rms > 0.002 ? Math.max(0, flux - average * 1.2) : 0;
    times[cursor] = at;
    cursor = (cursor + 1) % capacity; count = Math.min(capacity, count + 1);
    if (count * hopSeconds < 2.5 || at < nextAnalysis) return null;
    nextAnalysis = at + 0.08;

    let total = 0, maximum = 0;
    for (let lag = 0; lag < count; lag++) {
      const value = novelty[(cursor - 1 - lag + capacity) % capacity];
      total += value * weights[lag]; maximum = Math.max(maximum, value);
    }
    if (total < 0.04 || maximum < 0.015) return null;
    const candidates = bins.map(bin => {
      let real = 0, imag = 0;
      for (let lag = 0; lag < count; lag++) {
        const value = novelty[(cursor - 1 - lag + capacity) % capacity];
        real += value * bin.cos[lag]; imag += value * bin.sin[lag];
      }
      return { bpm: bin.bpm, strength: Math.hypot(real, imag) / total, phase: -Math.atan2(imag, real) };
    });
    // Prefer the slower interpretation only for effectively tied harmonics.
    // Small continuity weighting resists chatter without trapping tempo changes.
    let best = null;
    for (const candidate of candidates) {
      const continuity = previous && Math.abs(candidate.bpm - previous.bpm) / previous.bpm < 0.04 ? 1.03 : 1;
      const score = candidate.strength * continuity;
      if (!best || score > best.score) best = { ...candidate, score };
    }
    for (const candidate of candidates) {
      const ratio = best.bpm / candidate.bpm;
      if (ratio > 1.8 && Math.abs(ratio - Math.round(ratio)) < 0.025 &&
          candidate.strength >= best.strength * 0.985) { best = candidate; break; }
    }
    if (best.strength < 0.38) { stableSince = null; previous = null; kernels = []; return null; }
    const consistent = previous && Math.abs(best.bpm - previous.bpm) / previous.bpm < 0.05 &&
      Math.abs(wrap(best.phase - previous.phase - TAU * previous.bpm / 60 * (at - previous.at))) < 0.5;
    if (!consistent) { stableSince = at; kernels = []; }
    previous = { ...best, at };
    kernels.push(previous);
    kernels = kernels.filter(kernel => at - kernel.at <= 0.75);
    let real = 0, imag = 0, weightSum = 0, tempoSum = 0;
    for (const kernel of kernels) {
      const age = at - kernel.at;
      const weight = kernel.strength * (0.5 + 0.5 * Math.cos(Math.PI * age / 0.75));
      const phase = kernel.phase + TAU * kernel.bpm / 60 * age;
      real += Math.cos(phase) * weight; imag += Math.sin(phase) * weight;
      tempoSum += kernel.bpm * weight; weightSum += weight;
    }
    const bpm = tempoSum / weightSum;
    const phase = Math.atan2(imag, real);
    const beatAt = at - wrap(phase) / TAU * 60 / bpm;
    // Require several distinct supported beats, not a lone transient with a
    // deceptively strong Fourier response. Extra off-beat activity is permitted.
    const supported = new Set();
    for (let lag = 0; lag < count; lag++) {
      const index = (cursor - 1 - lag + capacity) % capacity;
      if (novelty[index] < Math.max(0.015, maximum * 0.18)) continue;
      const offset = (times[index] - beatAt) * bpm / 60;
      if (Math.abs(offset - Math.round(offset)) * 60 / bpm > 0.07) continue;
      supported.add(Math.round(offset));
      lastSupportAt = Math.max(lastSupportAt, times[index]);
    }
    const coherence = Math.hypot(real, imag) / weightSum;
    const confidence = clamp(clamp(best.strength / 0.65) * coherence);
    if (supported.size < 4 || at - stableSince < 0.4 || confidence < 0.65 || at - lastSupportAt > 0.75) return null;
    return { bpm, beatAt, at: lastSupportAt, confidence };
  }
  return { push, reset, size: () => count };
}
