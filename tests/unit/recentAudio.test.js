import { describe, expect, it } from 'vitest';
import { createRecentAudio } from '../../src/persistence/recentAudio.js';

describe('recent audio cache (memory fallback)', () => {
  it('remembers files newest first, caps the list, and hands back a File', async () => {
    let t = 0;
    const recent = createRecentAudio({ indexedDB: null, limit: 2, now: () => ++t });
    expect(await recent.list()).toEqual([]);
    expect(await recent.remember(new File(['aaa'], 'a.mp3', { type: 'audio/mpeg' }))).toBe(true);
    await recent.remember(new File(['bb'], 'b.wav', { type: 'audio/wav' }));
    await recent.remember(new File(['c'], 'c.ogg', { type: 'audio/ogg' }));
    expect((await recent.list()).map(f => f.name)).toEqual(['c.ogg', 'b.wav']);
    const file = await recent.get('b.wav');
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('b.wav');
    expect(await file.text()).toBe('bb');
    expect(await recent.get('a.mp3')).toBeNull();
    expect(await recent.forget('b.wav')).toBe(true);
    expect((await recent.list()).map(f => f.name)).toEqual(['c.ogg']);
    expect(await recent.remember(null)).toBe(false);
  });
});
