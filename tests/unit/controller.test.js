import { describe, it, expect } from 'vitest';
import { createAppController } from '../../src/app/controller.js';
import { createTestHost } from './helpers.js';

function setup() {
  const runtime = createTestHost();
  const audio = { status: () => ({ source: 'none', contextState: 'running' }) };
  const controller = createAppController({ ...runtime, audio });
  return { ...runtime, controller };
}

describe('application controller boundary', () => {
  it('projects the runtime into data-only view snapshots', () => {
    const h = setup();
    h.evaluator.evaluate(`
      const rings = { draw() {} };
      const show = [rings, rings];
      show.draw();
    `);
    h.frame(2);

    const snapshot = h.controller.snapshot();
    expect(snapshot.scene).toMatchObject({
      name: 'show',
      order: [
        { id: 'rings', strategy: 'rings' },
        { id: 'rings#2', strategy: 'rings' },
      ],
      sourceOrder: [],
    });
    expect(snapshot.strategies[0]).toMatchObject({ name: 'rings', version: 1, copies: 2 });
    expect(snapshot.strategies[0]).not.toHaveProperty('definition');
    expect(snapshot).not.toHaveProperty('registry');
    expect(Object.isFrozen(snapshot)).toBe(true);
    h.controller.dispose();
  });

  it('reports scene source edits before they are evaluated into the runtime', () => {
    const h = setup();
    let source = `// %% patch plasma
const plasma = { draw() {} };
// %% patch rings
const rings = { draw() {} };
// %% scene scene
const scene = [
  plasma,
];
scene.draw();`;
    h.controller.setSourceProvider(() => source);
    h.evaluator.evaluate(source);
    h.frame(2);

    source = source.replace('  plasma,', '  rings, // waiting for evaluation\n  plasma,');
    h.controller.sourceChanged();

    expect(h.registry.activeOrder()).toEqual(['plasma']);
    expect(h.controller.snapshot().scene.sourceOrder).toEqual(['rings', 'plasma']);
    h.controller.dispose();
  });

  it('reports source-installed patches even when their evaluation failed', () => {
    const h = setup();
    h.controller.setSourceProvider(() => `// %% patch broken
const broken = { draw() { ((( } };`);

    expect(h.controller.snapshot()).toMatchObject({
      installedPatches: ['broken'],
      strategies: [],
    });
    h.controller.dispose();
  });

  it('describes public function, object, and class interfaces without exposing or invoking them', () => {
    const h = setup();
    h.evaluator.evaluate(`
      // %% patch examples
      const wash = ({ audio }) => {};
      const rings = {
        count: 4,
        spacing: 34,
        colours: [255, 90, 180],
        get dangerous() { throw new Error('the reference invoked a getter'); },
        addRings(amount) { this.count += amount; },
        diameter(index, audio) { return index + audio.bass; },
        draw({ audio }) {},
      };
      class Orbiters {
        #secret = 42;
        constructor() { this.colour = [120, 200, 255, 90]; }
        state() { return {}; }
        nextPosition(audio, state, dt) {}
        draw({ audio, state, dt }) {}
      }
      const orbiters = new Orbiters();
      const show = [wash, rings, orbiters];
      show.draw();
    `);
    h.frame(2);

    const snapshot = h.controller.snapshot();
    const byName = Object.fromEntries(snapshot.strategies.map((entry) => [entry.name, entry]));

    expect(byName.wash.reference).toMatchObject({
      kind: 'function',
      lifecycle: ['draw({ audio })'],
    });
    expect(byName.rings.reference).toEqual({
      kind: 'object',
      className: null,
      properties: [
        { name: 'count', value: '4' },
        { name: 'spacing', value: '34' },
        { name: 'colours', value: '[255, 90, 180]' },
        { name: 'dangerous', value: '[getter]' },
      ],
      methods: ['addRings(amount)', 'diameter(index, audio)'],
      lifecycle: ['draw({ audio })'],
    });
    expect(byName.orbiters.reference).toEqual({
      kind: 'class',
      className: 'Orbiters',
      properties: [{ name: 'colour', value: '[120, 200, 255, 90]' }],
      methods: ['nextPosition(audio, state, dt)'],
      lifecycle: ['state()', 'draw({ audio, state, dt })'],
    });
    expect(JSON.stringify(snapshot)).not.toContain('#secret');
    h.controller.dispose();
  });

  it('dispatches reset, parameter, and safe-state recovery actions', () => {
    const h = setup();
    h.evaluator.evaluate(`
      const counter = {
        state() { return { n: 0 }; },
        draw({ state }) { state.n++; },
      };
      const safe = [counter];
      const empty = [];
      empty.draw();
      safe.draw();
      control("speed", 1, { min: 0, max: 2 });
    `);
    h.frame(8);

    expect(h.controller.actions.setSafeState()).toMatchObject({ ok: true, sceneName: 'safe' });
    h.controller.actions.setParam('speed', 1.5);
    h.controller.actions.resetStrategy('counter');
    expect(h.stateStore.get('counter').n).toBe(0);

    h.evaluator.evaluate('empty.draw();');
    h.frame(2);
    expect(h.registry.activeSceneName()).toBe('empty');
    expect(h.controller.actions.restoreSafeState()).toMatchObject({ ok: true, sceneName: 'safe' });
    // Recovery now restores the parameter value captured with the safe state,
    // rather than only switching back to a scene name.
    expect(h.controller.snapshot().params[0].value).toBe(1);
    h.controller.dispose();
  });

  it('captures and restores a complete safe state without overwriting it on failure', () => {
    const h = setup();
    let source = `
      const counter = {
        state() { return { n: 0 }; },
        draw({ state }) { state.n++; state.version = 1; },
      };
      const trusted = [counter];
      trusted.draw();
      control("speed", 1, { min: 0, max: 4 });
    `;
    h.controller.setSourceProvider(() => source);
    h.evaluator.evaluate(source);
    h.frame(8);
    h.controller.actions.setParam('speed', 2.5);
    const safeCount = h.stateStore.get('counter').n;
    const captured = h.controller.actions.setSafeState();

    expect(captured.ok).toBe(true);
    expect(h.controller.snapshot().safeState.dirty).toBe(false);

    source = `
      const counter = { draw({ state }) { state.version = 2; } };
      const empty = [];
      empty.draw();
      control("speed", 0);
    `;
    h.controller.sourceChanged();
    h.evaluator.evaluate(source);
    h.frame(3);
    h.controller.actions.setParam('speed', 0.25);
    expect(h.controller.snapshot().safeState.dirty).toBe(true);

    const failed = h.evaluator.evaluate('class Counter { draw() { ((( } }');
    expect(failed.ok).toBe(false);
    expect(h.controller.snapshot().safeState.createdAt).toBe(captured.createdAt);

    const restored = h.controller.actions.restoreSafeState();
    source = restored.source;
    h.controller.sourceChanged();

    expect(restored.ok).toBe(true);
    expect(h.registry.activeSceneName()).toBe('trusted');
    expect(h.registry.activeOrder()).toEqual(['counter']);
    expect(h.registry.getStrategy('counter').version).toBe(1);
    expect(h.registry.getStrategy('counter').source).toContain('state.version = 1');
    expect(h.registry.listParams()[0].value).toBe(2.5);
    expect(h.stateStore.get('counter').n).toBe(safeCount);
    expect(h.controller.snapshot().safeState.dirty).toBe(false);
    h.controller.dispose();
  });

  it('restores a private transaction checkpoint without replacing the safe state', () => {
    const h = setup();
    let source = `
      const trustedPatch = {
        state() { return { frames: 0 }; },
        draw({ state }) { state.frames++; },
      };
      const trusted = [trustedPatch];
      trusted.draw();
      control("energy", 0.75);
    `;
    h.controller.setSourceProvider(() => source);
    h.evaluator.evaluate(source);
    h.frame(5);
    const safe = h.controller.actions.setSafeState();
    const checkpoint = h.controller.checkpoint();
    const trustedFrames = h.stateStore.get('trustedPatch').frames;

    source = 'const temporary = { draw() {} }; const other = [temporary]; other.draw();';
    h.evaluator.evaluate(source);
    h.frame(2);
    expect(h.registry.activeSceneName()).toBe('other');

    const restored = h.controller.restoreCheckpoint(checkpoint);
    expect(restored).toMatchObject({ ok: true, source: checkpoint.source, sceneName: 'trusted' });
    expect(h.registry.activeOrder()).toEqual(['trustedPatch']);
    expect(h.registry.listParams()[0].value).toBe(0.75);
    expect(h.stateStore.get('trustedPatch').frames).toBe(trustedFrames);
    expect(h.controller.snapshot().safeState.createdAt).toBe(safe.createdAt);
    h.controller.dispose();
  });

  it('includes controller mappings in safe-state dirtiness and restoration', () => {
    const runtime = createTestHost();
    let mappings = [{
      param: 'speed', transport: 'midi', device: 'Knobs', type: 'cc', channel: 1, number: 21,
    }];
    const listeners = new Set();
    const controlManager = {
      snapshotMappings: () => structuredClone(mappings),
      restoreMappings: (next) => {
        mappings = structuredClone(next ?? []);
        for (const listener of listeners) listener();
      },
      snapshot: () => ({
        midi: { supported: true, status: 'connected', devices: [], lastMessage: null },
        learning: null,
        mappings: structuredClone(mappings),
      }),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const controller = createAppController({
      ...runtime,
      audio: { status: () => ({ source: 'none', contextState: 'running' }) },
      controlManager,
    });
    let source = 'const patch = { draw() {} }; const scene = [patch]; scene.draw(); control("speed", 1);';
    controller.setSourceProvider(() => source);
    runtime.evaluator.evaluate(source);
    runtime.frame(2);
    expect(controller.actions.setSafeState().ok).toBe(true);

    mappings = [{ ...mappings[0], number: 22 }];
    for (const listener of listeners) listener();
    expect(controller.snapshot().safeState.dirty).toBe(true);

    expect(controller.actions.restoreSafeState().ok).toBe(true);
    expect(mappings[0].number).toBe(21);
    expect(controller.snapshot().safeState.dirty).toBe(false);
    controller.dispose();
  });

  it('notifies views without handing them model objects', () => {
    const h = setup();
    const received = [];
    const unsubscribe = h.controller.subscribe((snapshot) => received.push(snapshot));

    h.evaluator.evaluate('const idle = { draw() {} };');
    h.frame(2);

    expect(received.length).toBeGreaterThan(0);
    expect(received.at(-1).strategies[0].name).toBe('idle');
    expect(received.at(-1).strategies[0]).not.toHaveProperty('definition');
    unsubscribe();
    h.controller.dispose();
  });
});

describe('rhythm and signal checkpoint recovery', () => {
  it('restores triggered signal state and manual settings without rewinding the clock', () => {
    const h = setup();
    h.controller.setSourceProvider(() => 'motion source');
    h.host.rhythm.configure({ source: 'manual', bpm: 120 });
    h.evaluator.evaluate('const hitStep = sequence([10, 20, 30], {trigger: "onset"}); const patch = c => hitStep(c); const scene = [patch]; scene.draw();');
    h.frame(3); h.frame(1, { onset: true });
    const step = h.evaluator.binding('hitStep'); expect(step()).toBe(20);
    const checkpoint = h.controller.checkpoint();
    h.frame(1, { onset: true }); expect(step()).toBe(30);
    h.host.rhythm.configure({ bpm: 90 }); h.frame(5);
    const before = h.host.rhythm.snapshot().beat;
    expect(h.controller.restoreCheckpoint(checkpoint).ok).toBe(true);
    h.frame(1);
    expect(h.evaluator.binding('hitStep')).toBe(step); expect(step()).toBe(20);
    expect(h.host.rhythm.settings().bpm).toBe(120);
    expect(h.host.rhythm.snapshot().beat).toBeGreaterThanOrEqual(before);
  });
});
