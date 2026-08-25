// Source-authoritative project persistence.

import { describe, it, expect } from 'vitest';
import { createRegistry } from '../../src/host/registry.js';
import { createProjectStore } from '../../src/persistence/projectStore.js';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

function setup() {
  const registry = createRegistry();
  const storage = fakeStorage();
  const store = createProjectStore({ registry, storage });

  registry.stageStrategy('wash', { draw() {} }, 'const wash = { draw() {} };');
  registry.confirmStrategy('wash');
  registry.stageStrategy('rings', { draw() {} }, 'const rings = { draw() {} };');
  registry.confirmStrategy('rings');
  registry.defineScene('tunnel', ['wash', 'rings']);
  registry.activate('tunnel');
  registry.setSafeScene('tunnel');
  registry.declareParam('trail', 0.08, { min: 0, max: 0.3, step: 0.01 });
  return { registry, storage, store };
}

function fakeControls(initial = []) {
  let mappings = structuredClone(initial);
  return {
    snapshotMappings: () => structuredClone(mappings),
    restoreMappings: (next) => {
      mappings = structuredClone(next ?? []);
      return mappings.length;
    },
    current: () => structuredClone(mappings),
  };
}

const SOURCE = [
  'const wash = { draw() {} };',
  'const rings = { draw() {} };',
  'const tunnel = [wash, rings];',
  'activate(tunnel);',
].join('\n');

describe('local persistence', () => {
  it('round-trips source and performer settings', () => {
    const { storage, store } = setup();
    store.save(SOURCE);
    const loaded = store.load();

    expect(storage.getItem('p5js-live.project.v5')).not.toBe(null);
    expect(loaded.source).toBe(SOURCE);
    expect(loaded.safeScene).toBe('tunnel');
    expect(loaded.params[0]).toMatchObject({ name: 'trail', value: 0.08 });
  });

  it('moves the previous product save to the p5js live storage key', () => {
    const registry = createRegistry();
    const storage = fakeStorage();
    storage.setItem(
      'algolab.project.v5',
      JSON.stringify({ schema: 6, source: SOURCE, safeScene: 'tunnel', params: [] }),
    );

    const loaded = createProjectStore({ registry, storage }).load();

    expect(loaded.source).toBe(SOURCE);
    expect(storage.getItem('p5js-live.project.v5')).not.toBe(null);
    expect(storage.getItem('algolab.project.v5')).toBe(null);
  });

  it('does not save a second copy of scene membership or order', () => {
    const { store } = setup();
    store.save(SOURCE);
    const loaded = store.load();

    expect(loaded).not.toHaveProperty('scenes');
    expect(loaded).not.toHaveProperty('activeScene');
    expect(loaded.source).toContain('const tunnel = [wash, rings]');
  });

  it('restores tuned parameter values over source defaults', () => {
    const { registry, store } = setup();
    registry.setParam('trail', 0.25);
    store.save(SOURCE);

    const fresh = createRegistry();
    fresh.declareParam('trail', 0.08, { min: 0, max: 0.3 });
    createProjectStore({ registry: fresh, storage: fakeStorage() }).restoreSettings(store.load());

    expect(fresh.listParams()[0].value).toBe(0.25);
  });

  it('round-trips external controller mappings without live device handles', () => {
    const registry = createRegistry();
    const storage = fakeStorage();
    const controls = fakeControls([{
      param: 'trail',
      transport: 'midi',
      device: 'Test · Knobs',
      type: 'cc',
      channel: 1,
      number: 21,
    }]);
    const store = createProjectStore({ registry, storage, controlManager: controls });
    store.save(SOURCE);
    expect(store.load().controls).toEqual(controls.current());

    const restored = fakeControls();
    createProjectStore({ registry, storage, controlManager: restored }).restoreSettings(store.load());
    expect(restored.current()).toEqual(controls.current());
    expect(JSON.stringify(store.load())).not.toContain('onmidimessage');
  });

  it('starts fresh rather than throwing on a corrupt or outdated save', () => {
    const registry = createRegistry();
    const storage = fakeStorage();
    storage.setItem('response.project.v1', '{ not json');
    expect(createProjectStore({ registry, storage }).load()).toBe(null);

    storage.setItem('response.project.v1', JSON.stringify({ schema: 99, source: 'x' }));
    expect(createProjectStore({ registry, storage }).load()).toBe(null);

    storage.setItem('response.project.v1', JSON.stringify({ schema: 5, source: 'old syntax' }));
    expect(createProjectStore({ registry, storage }).load()).toBe(null);
  });

  it('does not restore the retired built-in patch set from an obsolete key', () => {
    const registry = createRegistry();
    const storage = fakeStorage();
    storage.setItem(
      'algolab.project.v1',
      JSON.stringify({ schema: 6, source: SOURCE, safeScene: 'tunnel', params: [] }),
    );

    expect(createProjectStore({ registry, storage }).load()).toBe(null);
  });

  it('does not restore the intermediate cleanup save either', () => {
    const registry = createRegistry();
    const storage = fakeStorage();
    storage.setItem(
      'algolab.project.v2',
      JSON.stringify({ schema: 6, source: SOURCE, safeScene: 'tunnel', params: [] }),
    );

    expect(createProjectStore({ registry, storage }).load()).toBe(null);

    storage.setItem(
      'algolab.project.v3',
      JSON.stringify({ schema: 6, source: SOURCE, safeScene: 'tunnel', params: [] }),
    );
    expect(createProjectStore({ registry, storage }).load()).toBe(null);

    storage.setItem(
      'algolab.project.v4',
      JSON.stringify({ schema: 6, source: SOURCE, safeScene: 'tunnel', params: [] }),
    );
    expect(createProjectStore({ registry, storage }).load()).toBe(null);
  });

  it('does not automatically restore projects saved under former product names', () => {
    const registry = createRegistry();
    for (const key of [
      'response.project.v1',
      'patchbay.project.v1',
      'patchlab.project.v1',
      'livecode-lab.project.v1',
    ]) {
      const storage = fakeStorage();
      storage.setItem(
        key,
        JSON.stringify({ schema: 6, source: SOURCE, safeScene: 'tunnel', params: [] }),
      );
      expect(createProjectStore({ registry, storage }).load()).toBe(null);
    }
  });

  it('does not throw when storage is unavailable', () => {
    const registry = createRegistry();
    const storage = {
      getItem() { throw new Error('SecurityError'); },
      setItem() { throw new Error('QuotaExceededError'); },
      removeItem() {},
    };
    const store = createProjectStore({ registry, storage });
    expect(store.load()).toBe(null);
    expect(store.save(SOURCE)).toBe(false);
  });
});

describe('export is human-readable', () => {
  it('writes source as lines and keeps composition only in that source', () => {
    const { store } = setup();
    const text = store.exportProject(SOURCE);
    const data = JSON.parse(text);

    expect(data.format).toBe('p5js-live-project');
    expect(text).not.toContain('\\n');
    expect(data.source).toEqual(SOURCE.split('\n'));
    expect(data).not.toHaveProperty('scenes');
    expect(data).not.toHaveProperty('activeScene');
    expect(data.safeScene).toBe('tunnel');
    expect(data.params[0].name).toBe('trail');
    expect(Date.parse(data.exportedAt)).not.toBeNaN();
  });

  it('round-trips named performances containing their own authored patch source', () => {
    const { store } = setup();
    const performances = [{
      id: 'afterglow',
      name: 'Afterglow',
      createdAt: 10,
      updatedAt: 20,
      source: 'const myNewPatch = { draw() {} };\nconst scene = [myNewPatch];\nactivate(scene);',
      params: [],
      audio: {},
      view: {},
    }];
    const parsed = store.parseProject(store.exportProject(SOURCE, { performances }));

    expect(parsed.ok).toBe(true);
    expect(parsed.data.performances).toEqual(performances);
    expect(parsed.data.performances[0].source).toContain('myNewPatch');
  });
});

describe('import parsing is separate from running', () => {
  it('round-trips an exported project without inventing composition data', () => {
    const { store } = setup();
    const parsed = store.parseProject(store.exportProject(SOURCE));

    expect(parsed.ok).toBe(true);
    expect(parsed.data.source).toBe(SOURCE);
    expect(parsed.data).not.toHaveProperty('scenes');
    expect(parsed.data.safeScene).toBe('tunnel');
    expect(parsed.data.performances).toEqual([]);
  });

  it('still imports projects exported under former product names', () => {
    const { store } = setup();
    for (const format of [
      'livecode-lab-project',
      'patchlab-project',
      'patchbay-project',
      'response-project',
      'algolab-project',
    ]) {
      const parsed = store.parseProject(
        JSON.stringify({ format, schema: 6, source: SOURCE.split('\n') }),
      );
      expect(parsed.ok).toBe(true);
      expect(parsed.data.source).toBe(SOURCE);
    }
  });

  it('rejects files that are not p5js live projects', () => {
    const { store } = setup();
    expect(store.parseProject('not json at all').ok).toBe(false);
    expect(store.parseProject('{"hello":1}').error).toContain('Not a p5js live project');
    expect(
      store.parseProject(JSON.stringify({ format: 'p5js-live-project', schema: 99 })).error,
    ).toContain('format version 99');
    expect(
      store.parseProject(JSON.stringify({ format: 'p5js-live-project', schema: 6 })).error,
    ).toContain('no source');
  });

  it('parses without applying anything to the registry', () => {
    const { registry, store } = setup();
    const before = registry.listScenes();

    store.parseProject(
      JSON.stringify({
        format: 'p5js-live-project',
        schema: 6,
        source: ['const evil = { draw() {} };'],
      }),
    );

    expect(registry.listScenes()).toEqual(before);
    expect(registry.hasStrategy('evil')).toBe(false);
  });
});
