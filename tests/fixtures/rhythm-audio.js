// Deterministic, original test audio. No licensed recordings or network required.
export function rhythmSamples({ bpm = 120, seconds = 14, sampleRate = 48000, missing = false, syncopated = false, dense = false, noise = false, tone = false, silence = false, jitter = 0, changeTo = null } = {}) {
  const samples = new Float32Array(seconds * sampleRate);
  if (silence) return { samples, beats: [], sampleRate };
  if (tone) {
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i * 2 * Math.PI * 110 / sampleRate) * 0.4;
    return { samples, beats: [], sampleRate };
  }
  const beats = [];
  let seed = 42, index = 0;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296 * 2 - 1;
  };
  if (noise) {
    for (let i = 0; i < samples.length; i++) samples[i] = random() * 0.3;
    return { samples, beats, sampleRate };
  }
  for (let at = 0.25; at < seconds - 0.1; at += 60 / (changeTo && at > seconds / 2 ? changeTo : bpm)) {
    const hitAt = at + (index % 2 ? jitter : -jitter);
    beats.push(hitAt);
    const add = (time, gain) => {
      const start = Math.round(time * sampleRate);
      for (let j = 0; j < 0.07 * sampleRate && start + j < samples.length; j++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const t = j / sampleRate;
        samples[start + j] += gain * Math.exp(-t * 65) * (Math.sin(t * 2 * Math.PI * 80) * 0.8 + (seed / 4294967296 * 2 - 1) * 0.2);
      }
    };
    if (!missing || index % 5 !== 3) add(hitAt, index % 7 === 0 ? 0.4 : 0.8);
    if (syncopated && index % 3 === 0) add(hitAt + 0.75 * 60 / bpm, 0.25);
    index++;
  }
  if (dense) {
    // Sixteenth-note hats and a sustained chord compete with the kick pulse.
    for (let at = 0.25; at < seconds - 0.1; at += 15 / bpm) {
      const start = Math.round(at * sampleRate);
      let previous = 0;
      for (let j = 0; j < 0.04 * sampleRate && start + j < samples.length; j++) {
        const value = random();
        samples[start + j] += (value - previous) * 0.22 * Math.exp(-j / sampleRate * 100);
        previous = value;
      }
    }
    for (let i = 0; i < samples.length; i++) {
      const t = i / sampleRate;
      samples[i] += Math.min(1, t) * 0.04 * (Math.sin(t * 2 * Math.PI * 220) + Math.sin(t * 2 * Math.PI * 277.18) + Math.sin(t * 2 * Math.PI * 329.63));
    }
  }
  return { samples, beats, sampleRate };
}
export function waveFile(fixture) {
  const { samples, sampleRate } = fixture;
  const data = Buffer.alloc(44 + samples.length * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(sampleRate, 24); data.writeUInt32LE(sampleRate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((value, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), 44 + i * 2));
  return data;
}
