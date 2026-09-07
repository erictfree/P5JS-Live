// Taps use monotonic seconds, never frame counts or DOM event timestamps.
export function createTapTempo() {
  let taps = [];
  return {
    reset() { taps = []; },
    tap(time) {
      if (!Number.isFinite(time)) throw new TypeError('Tap needs a finite timestamp');
      const interval = time - taps.at(-1);
      if (interval < 0.12) return null;
      if (interval > 2.5) taps = [];
      taps.push(time);
      taps = taps.slice(-9);
      const intervals = taps.slice(1).map((t, i) => t - taps[i]).filter(t => t >= 0.2 && t <= 2);
      if (!intervals.length) return null;
      const sorted = [...intervals].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const accepted = intervals.filter(t => Math.abs(t - median) <= median * 0.2);
      const period = accepted.reduce((sum, t) => sum + t, 0) / accepted.length;
      return { bpm: 60 / period, time, taps: accepted.length + 1 };
    },
  };
}
