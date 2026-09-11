import { describe, expect, it } from 'vitest';
import { createPerformanceStore } from '../../src/persistence/performanceStore.js';

function memoryStorage() {
  const map = new Map();
  return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) };
}
const scene = (id, name) => ({ id, name, source: 'const scene = []; scene.draw();', createdAt: 1, updatedAt: 1, rhythm: { source: 'off', bpm: 120, multiplier: 1, algorithm: 'plp' } });

describe('scene store replace', () => {
  it('replaces the whole list and rejects invalid entries', () => {
    const store = createPerformanceStore({ storage: memoryStorage() });
    store.save({ name: 'old', source: 'x', rhythm: { source: 'off', bpm: 120, multiplier: 1, algorithm: 'plp' } });
    expect(store.replace([scene('a', 'A'), scene('b', 'B')])).toEqual({ ok: true, count: 2 });
    expect(store.list().map(s => s.id)).toEqual(['a', 'b']);
    expect(store.replace([{ id: 'broken' }])).toEqual({ ok: false, reason: 'invalid-performances' });
    expect(store.replace([])).toEqual({ ok: true, count: 0 });
    expect(store.list()).toEqual([]);
  });
});
