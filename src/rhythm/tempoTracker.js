// Causal onset-grid tracker. It scores several periods and phases over the last
// eight seconds, rather than treating every transient interval as a beat period.
// This is an estimate of a pulse, never a downbeat or a time signature.
const fract = x => ((x % 1) + 1) % 1;
const distance = x => Math.min(fract(x), 1 - fract(x));
export function createTempoTracker() {
  let events = [], previous = null, stable = 0, lastAt = -Infinity;
  function reset() { events = []; previous = null; stable = 0; lastAt = -Infinity; }
  function push(at, strength = 1) {
    if (!Number.isFinite(at) || !Number.isFinite(strength) || strength <= 0 || at - lastAt < 0.1) return null;
    if (at - lastAt > 3) reset();
    lastAt = at;
    events.push({ at, strength: Math.min(4, strength) });
    events = events.filter(e => e.at >= at - 8).slice(-80);
    if (events.length < 5 || at - events[0].at < 1.5) return null;
    const periods = new Set();
    // Adjacent and nonadjacent pairs retain candidates when kicks are missing or
    // subdivisions dominate. Quantization bounds the comparison work.
    for (let i = 1; i < events.length; i++) for (let j = Math.max(0, i - 5); j < i; j++) {
      const gap = events[i].at - events[j].at;
      for (let multiple = 1; multiple <= 4; multiple++) {
        const period = gap / multiple;
        if (period >= 0.3 && period <= 1) periods.add(Math.round(period * 1000) / 1000);
      }
    }
    if (previous) periods.add(previous.period);
    const total = events.reduce((sum, e) => sum + e.strength, 0);
    let best = null;
    for (const period of periods) {
      // Compare a bounded phase set. Strong recent hits are phase candidates.
      const anchors = [...events].sort((a, b) => b.strength - a.strength).slice(0, 8);
      for (const anchor of anchors) {
        let support = 0, occupied = new Set(), error = 0;
        for (const e of events) {
          const offset = (e.at - anchor.at) / period;
          const delta = distance(offset) * period;
          if (delta < 0.06) {
            const weight = e.strength * Math.max(0, 1 - delta / 0.075);
            support += weight; error += delta * weight;
            occupied.add(Math.round(offset));
          }
        }
        const possible = Math.floor((at - events[0].at) / period) + 1;
        const coverage = Math.min(1, occupied.size / possible);
        const precision = support / total;
        // Reward explaining transients and filling the predicted grid. Sparse
        // half/double candidates cannot win simply by fitting a subset perfectly.
        const quality = Math.sqrt(coverage * precision);
        const continuity = previous && Math.abs(period - previous.period) < previous.period * 0.04 ? 0.025 : 0;
        const score = quality + continuity;
        if (!best || score > best.score) best = { period, anchor: anchor.at, score, quality, error: support ? error / support : 1 };
      }
    }
    if (!best || best.quality < 0.65 || best.error > 0.045) { stable = 0; return null; }
    if (previous && Math.abs(best.period - previous.period) < previous.period * 0.04) stable++;
    else stable = 1;
    previous = best;
    if (stable < 3) return null;
    // Evidence freshness only advances on a hit fitting the selected grid.
    if (distance((at - best.anchor) / best.period) * best.period > 0.06) return null;
    return { bpm: 60 / best.period, beatAt: best.anchor + Math.round((at - best.anchor) / best.period) * best.period,
      at, confidence: Math.min(1, best.quality), events: events.length };
  }
  return { push, reset, size: () => events.length };
}
