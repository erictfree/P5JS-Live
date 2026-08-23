import { describe, expect, it } from 'vitest';
import {
  createPerformanceStore,
  performanceShortcutIndex,
} from '../../src/persistence/performanceStore.js';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

const snapshot = (name = 'Afterglow') => ({
  name,
  source: 'const scene = [plasma]; activate(scene);',
  sceneName: 'scene',
  safeScene: 'scene',
  params: [{ name: 'energy', value: 0.7, min: 0, max: 1, step: 0.1 }],
  audio: { analysis: { smoothing: 0.4, autoGain: false }, loop: true },
  view: { folded: true, codeHidden: false, projectionLayout: 'canvas', fpsThreshold: 45 },
});

describe('named performance persistence', () => {
  it('maps Cmd/Ctrl+Option/Alt+1…9 to zero-based visible performance slots', () => {
    expect(performanceShortcutIndex({ metaKey: true, ctrlKey: false, altKey: true, shiftKey: false, code: 'Digit1' })).toBe(0);
    expect(performanceShortcutIndex({ metaKey: false, ctrlKey: true, altKey: true, shiftKey: false, code: 'Digit9' })).toBe(8);
    expect(performanceShortcutIndex({ metaKey: true, ctrlKey: false, altKey: true, shiftKey: false, code: 'Numpad4' })).toBe(3);
    expect(performanceShortcutIndex({ metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, code: 'Digit1' })).toBe(null);
    expect(performanceShortcutIndex({ metaKey: true, ctrlKey: false, altKey: true, shiftKey: true, code: 'Digit1' })).toBe(null);
    expect(performanceShortcutIndex({ metaKey: true, ctrlKey: false, altKey: true, shiftKey: false, code: 'Digit0' })).toBe(null);
  });

  it('saves complete named recall points and lists newest first', () => {
    const storage = fakeStorage();
    let time = 100;
    let id = 0;
    const store = createPerformanceStore({
      storage,
      now: () => ++time,
      makeId: () => `slot-${++id}`,
    });

    store.save(snapshot('First'));
    store.save(snapshot('Second'));

    const performances = store.list();
    expect(performances.map((entry) => entry.name)).toEqual(['Second', 'First']);
    expect(performances[0]).toMatchObject({
      id: 'slot-2',
      sceneName: 'scene',
      safeScene: 'scene',
      audio: { analysis: { smoothing: 0.4, autoGain: false }, loop: true },
      view: { folded: true, projectionLayout: 'canvas', fpsThreshold: 45 },
    });
    expect(performances[0].params[0]).toMatchObject({ name: 'energy', value: 0.7 });
  });

  it('updates a slot without changing its identity or creation time', () => {
    const storage = fakeStorage();
    let time = 10;
    const store = createPerformanceStore({
      storage,
      now: () => ++time,
      makeId: () => 'one',
    });
    const created = store.save(snapshot()).performance;
    const updated = store.save({ ...snapshot('Afterglow'), sceneName: 'encore' }, { id: 'one' }).performance;

    expect(updated.id).toBe('one');
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).toBeGreaterThan(created.updatedAt);
    expect(store.get('one').sceneName).toBe('encore');
  });

  it('moves previous product performances to the p5js live storage key', () => {
    const storage = fakeStorage();
    storage.setItem('algolab.performances.v1', JSON.stringify({
      schema: 1,
      performances: [{
        ...snapshot('Migrated'),
        id: 'old-slot',
        createdAt: 10,
        updatedAt: 20,
      }],
    }));

    expect(createPerformanceStore({ storage }).list()[0].name).toBe('Migrated');
    expect(storage.getItem('p5js-live.performances.v1')).not.toBe(null);
    expect(storage.getItem('algolab.performances.v1')).toBe(null);
  });

  it('deletes only the requested performance and rejects incomplete snapshots', () => {
    const store = createPerformanceStore({
      storage: fakeStorage(),
      makeId: (() => { let id = 0; return () => String(++id); })(),
    });
    expect(store.save({ name: '', source: 'x' })).toMatchObject({ ok: false, reason: 'missing-name' });
    expect(store.save({ name: 'Broken', source: '' })).toMatchObject({ ok: false, reason: 'missing-source' });

    const first = store.save(snapshot('First')).performance;
    store.save(snapshot('Second'));
    expect(store.remove(first.id)).toBe(true);
    expect(store.list().map((entry) => entry.name)).toEqual(['Second']);
  });

  it('fails softly when browser storage is unavailable or corrupt', () => {
    const warnings = [];
    const diagnostics = { warn: (...args) => warnings.push(args) };
    const unavailable = {
      getItem() { throw new Error('SecurityError'); },
      setItem() { throw new Error('QuotaExceededError'); },
    };
    const store = createPerformanceStore({ storage: unavailable, diagnostics });
    expect(store.list()).toEqual([]);
    expect(store.save(snapshot())).toMatchObject({ ok: false, reason: 'storage' });
    expect(warnings.length).toBeGreaterThan(0);

    const corrupt = fakeStorage();
    corrupt.setItem('p5js-live.performances.v1', '{not json');
    expect(createPerformanceStore({ storage: corrupt }).list()).toEqual([]);
  });
});
