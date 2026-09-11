import { describe, expect, it } from 'vitest';
import { createRecentAudio } from '../../src/persistence/recentAudio.js';

function memoryStorage() {
  const map = new Map();
  return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) };
}

describe('recent audio names', () => {
  it('remembers names newest first, dedupes, caps the list, and never stores bytes', () => {
    let t = 0;
    const storage = memoryStorage();
    const recent = createRecentAudio({ storage, limit: 2, now: () => ++t });
    expect(recent.list()).toEqual([]);
    expect(recent.remember({ name: 'a.mp3', type: 'audio/mpeg', size: 10 })).toBe(true);
    recent.remember({ name: 'b.wav', type: 'audio/wav', size: 20 });
    recent.remember({ name: 'a.mp3', type: 'audio/mpeg', size: 10 });
    expect(recent.list().map(f => f.name)).toEqual(['a.mp3', 'b.wav']);
    recent.remember({ name: 'c.ogg', size: 30 });
    expect(recent.list().map(f => f.name)).toEqual(['c.ogg', 'a.mp3']);
    expect(storage.getItem('p5js-live.recent-audio.v1')).not.toContain('blob');
    expect(recent.forget('a.mp3')).toBe(true);
    expect(recent.forget('a.mp3')).toBe(false);
    expect(recent.list().map(f => f.name)).toEqual(['c.ogg']);
    expect(recent.remember(null)).toBe(false);
  });

  it('keeps a file handle per name when one is given (memory fallback without IndexedDB)', async () => {
    const recent = createRecentAudio({ storage: memoryStorage(), indexedDB: null });
    const handle = { kind: 'file', name: 'a.mp3' };
    recent.remember({ name: 'a.mp3', size: 1 }, handle);
    recent.remember({ name: 'b.mp3', size: 1 });
    expect(await recent.handleFor('a.mp3')).toBe(handle);
    expect(await recent.handleFor('b.mp3')).toBeNull();
    recent.forget('a.mp3');
    expect(await recent.handleFor('a.mp3')).toBeNull();
  });

  it('survives corrupt storage', () => {
    const storage = memoryStorage();
    storage.setItem('p5js-live.recent-audio.v1', '{nope');
    expect(createRecentAudio({ storage }).list()).toEqual([]);
  });
});
