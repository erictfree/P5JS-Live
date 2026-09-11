import { describe, expect, it, vi } from 'vitest';
import { createPerformanceLibrary, validBundle, validThumbnail } from '../../src/persistence/performanceLibrary.js';

function memoryStorage() {
  const map = new Map();
  return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) };
}
const bundle = (source = 'const scene = []; scene.draw();', scenes = []) => ({ source, performances: scenes, controls: [], rhythm: { source: 'off', bpm: 120, multiplier: 1, algorithm: 'plp' } });
const png = 'data:image/png;base64,AAAA';

describe('performance library', () => {
  it('saves, lists summaries without the bundle, and gets the full entry', () => {
    let t = 1000; const ids = ['a', 'b'];
    const lib = createPerformanceLibrary({ storage: memoryStorage(), now: () => t++, makeId: () => ids.shift() });
    expect(lib.save({ name: '  Friday set ', data: bundle('x', [{ id: 's1' }, { id: 's2' }]), thumbnail: png })).toMatchObject({ ok: true, performance: { id: 'a', name: 'Friday set', sceneCount: 2 } });
    expect(lib.save({ name: '', data: bundle() })).toEqual({ ok: false, reason: 'missing-name' });
    expect(lib.save({ name: 'bad', data: { nope: true } })).toEqual({ ok: false, reason: 'invalid-performance' });
    const [row] = lib.list();
    expect(row).toMatchObject({ id: 'a', name: 'Friday set', thumbnail: png, sceneCount: 2, createdAt: 1000, updatedAt: 1000 });
    expect(row.data).toBeUndefined();
    expect(lib.get('a').data.source).toBe('x');
    expect(lib.get('zzz')).toBeNull();
  });

  it('updates name, data and thumbnail in place and bumps updatedAt', () => {
    let t = 5;
    const lib = createPerformanceLibrary({ storage: memoryStorage(), now: () => t++, makeId: () => 'a' });
    lib.save({ name: 'One', data: bundle('v1') });
    expect(lib.update('a', { data: bundle('v2'), thumbnail: png })).toMatchObject({ ok: true, performance: { updatedAt: 6 } });
    expect(lib.get('a').data.source).toBe('v2');
    expect(lib.update('a', { name: '' })).toEqual({ ok: false, reason: 'missing-name' });
    expect(lib.update('a', { thumbnail: 'not-an-image' }).ok).toBe(true);
    expect(lib.get('a').thumbnail).toBeNull();
    expect(lib.update('missing', { name: 'x' })).toEqual({ ok: false, reason: 'missing' });
  });

  it('tracks the current performance and clears it when that entry is removed', () => {
    const ids = ['a', 'b'];
    const lib = createPerformanceLibrary({ storage: memoryStorage(), makeId: () => ids.shift() });
    lib.save({ name: 'A', data: bundle() }); lib.save({ name: 'B', data: bundle() });
    expect(lib.currentId()).toBeNull();
    expect(lib.setCurrent('b')).toBe(true);
    expect(lib.current()).toMatchObject({ id: 'b', name: 'B' });
    expect(lib.setCurrent('nope')).toBe(false);
    expect(lib.remove('b')).toBe(true);
    expect(lib.currentId()).toBeNull();
    expect(lib.list().map(e => e.id)).toEqual(['a']);
    expect(lib.remove('b')).toBe(false);
  });

  it('notifies subscribers and validates thumbnails and bundles', () => {
    const lib = createPerformanceLibrary({ storage: memoryStorage(), makeId: () => 'a' });
    const listener = vi.fn(); lib.subscribe(listener);
    lib.save({ name: 'A', data: bundle() });
    lib.update('a', { name: 'A2' });
    lib.setCurrent('a');
    lib.remove('a');
    expect(listener).toHaveBeenCalledTimes(4); // save, update, setCurrent, remove
    expect(validThumbnail(png)).toBe(true);
    expect(validThumbnail('http://x/y.png')).toBe(false);
    expect(validThumbnail('data:image/jpeg;base64,' + 'A'.repeat(300_000))).toBe(false);
    expect(validBundle({ source: 's' })).toBe(true);
    expect(validBundle({ source: 's', performances: 'no' })).toBe(false);
  });

  it('reorders entries and clamps at the ends', () => {
    const ids = ['a', 'b', 'c'];
    const lib = createPerformanceLibrary({ storage: memoryStorage(), makeId: () => ids.shift() });
    for (const name of ['A', 'B', 'C']) lib.save({ name, data: bundle() });
    expect(lib.move('c', -1)).toBe(true);
    expect(lib.list().map(e => e.id)).toEqual(['a', 'c', 'b']);
    expect(lib.move('a', -1)).toBe(false);
    expect(lib.move('b', 5)).toBe(false);
    expect(lib.move('a', 2)).toBe(true);
    expect(lib.list().map(e => e.id)).toEqual(['c', 'b', 'a']);
    expect(lib.move('zzz', 1)).toBe(false);
  });

  it('survives corrupt storage', () => {
    const storage = memoryStorage();
    storage.setItem('p5js-live.performance-library.v1', '{not json');
    const lib = createPerformanceLibrary({ storage });
    expect(lib.list()).toEqual([]);
    expect(lib.currentId()).toBeNull();
  });
});
