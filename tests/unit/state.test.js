// State identity and lifecycle for direct strategy objects.

import { describe, it, expect } from 'vitest';
import { createTestHost } from './helpers.js';

describe('replacing a strategy preserves compatible state', () => {
  it('hands the new object the same state object', () => {
    const h = createTestHost();
    h.evaluator.evaluate(`
      const orbiters = {
        state() { return { angle: 0, trail: [] }; },
        draw({ state }) { state.angle += 0.1; state.trail.push(state.angle); },
      };
      const show = [orbiters];
      show.draw();
    `);
    h.frame(30);

    const trailLength = h.stateStore.get('orbiters').trail.length;
    expect(trailLength).toBeGreaterThan(20);

    h.evaluator.evaluate(`
      const orbiters = {
        state() { return { angle: 999, trail: ["WRONG"] }; },
        draw({ state }) { state.angle += 1; },
      };
    `);
    h.frame(2);
    const settled = h.stateStore.get('orbiters').trail.length;
    h.frame(10);

    const state = h.stateStore.get('orbiters');
    expect(settled).toBeGreaterThanOrEqual(trailLength);
    expect(state.trail.length).toBe(settled);
    expect(state.trail[0]).not.toBe('WRONG');
  });

  it('runs state() exactly once when the object name first appears', () => {
    const h = createTestHost();
    let calls = 0;
    globalThis.__countStateCalls = () => {
      calls++;
      return { v: calls };
    };

    h.evaluator.evaluate(`
      const p = { state() { return __countStateCalls(); }, draw() {} };
      const show = [p];
      show.draw();
    `);
    h.frame(3);
    h.evaluator.evaluate('const p = { state() { return __countStateCalls(); }, draw() {} };');
    h.frame(3);

    expect(calls).toBe(1);
    delete globalThis.__countStateCalls;
  });
});

describe('explicit reset', () => {
  it('reset(object) re-runs the factory', () => {
    const h = createTestHost();
    h.evaluator.evaluate(`
      const orbiters = {
        state() { return { trail: [] }; },
        draw({ state }) { state.trail.push(1); },
      };
      const show = [orbiters];
      show.draw();
    `);
    h.frame(20);
    expect(h.stateStore.get('orbiters').trail.length).toBeGreaterThan(10);

    h.evaluator.evaluate('reset(orbiters);');
    h.frame(1);

    expect(h.stateStore.get('orbiters').trail).toEqual([]);
  });
});

describe('state compatibility', () => {
  it('reports state that cannot be snapshotted instead of crashing', () => {
    const h = createTestHost();
    h.evaluator.evaluate(`
      const bad = { state() { return { fn: () => {} }; }, draw() {} };
    `);
    h.frame(3);

    h.evaluator.evaluate('const bad = { draw() {} };');
    h.frame(3);

    const warnings = h.diagnostics.list().filter((d) => d.level === 'warn');
    expect(warnings.some((warning) => warning.message.includes('could not be snapshotted'))).toBe(true);
    expect(h.registry.getStrategy('bad').version).toBe(2);
  });

  it('falls back to an empty object when state() throws', () => {
    const h = createTestHost();
    h.evaluator.evaluate(
      'const p = { state() { throw new Error("nope"); }, draw() {} };',
    );
    h.frame(3);

    expect(h.stateStore.get('p')).toEqual({});
    expect(h.registry.getStrategy('p').status).toBe('ok');
  });
});

describe('scene arrays', () => {
  it('activates a named array and draws in array order', () => {
    const h = createTestHost();
    const order = [];
    globalThis.__order = order;
    h.evaluator.evaluate(`
      const a = { draw() { __order.push("a"); } };
      const b = { draw() { __order.push("b"); } };
      const show = [a, b];
      show.draw();
    `);
    h.frame(2);
    order.length = 0;
    h.frame(1);
    expect(order).toEqual(['a', 'b']);

    h.evaluator.evaluate('const show = [b, a];');
    h.frame(2);
    order.length = 0;
    h.frame(1);
    expect(order).toEqual(['b', 'a']);
    delete globalThis.__order;
  });

  it('changes membership while running without touching implementations', () => {
    const h = createTestHost();
    h.evaluator.evaluate(`
      const a = { draw({ state }) { state.n = (state.n||0)+1; } };
      const b = { draw({ state }) { state.n = (state.n||0)+1; } };
      const show = [a, b];
      show.draw();
    `);
    h.frame(10);
    const bVersion = h.registry.getStrategy('b').version;

    h.evaluator.evaluate('const show = [a];');
    h.frame(10);
    const bCount = h.stateStore.get('b').n;
    h.frame(10);

    expect(h.stateStore.get('b').n).toBe(bCount);
    expect(h.registry.getStrategy('b').version).toBe(bVersion);
    expect(h.stateStore.get('a').n).toBeGreaterThan(25);

    h.evaluator.evaluate('const show = [a, b];');
    h.frame(10);
    expect(h.stateStore.get('b').n).toBeGreaterThan(bCount);
  });

  it('runs enter once per activation and exit on departure', () => {
    const h = createTestHost();
    const log = [];
    globalThis.__log = log;
    h.evaluator.evaluate(`
      const a = {
        enter() { __log.push("enter"); },
        exit() { __log.push("exit"); },
        draw() {},
      };
      const show = [a];
      show.draw();
    `);
    h.frame(5);
    expect(log.filter((entry) => entry === 'enter')).toHaveLength(1);

    h.evaluator.evaluate('const show = [];');
    h.frame(3);
    expect(log).toContain('exit');
    delete globalThis.__log;
  });

  it('fires onset on a frame where the audio snapshot says so', () => {
    const h = createTestHost();
    const log = [];
    globalThis.__beats = log;
    h.evaluator.evaluate(`
      const a = { onset() { __beats.push(1); }, draw() {} };
      const show = [a];
      show.draw();
    `);
    h.frame(3, { onset: false });
    expect(log).toHaveLength(0);
    h.frame(1, { onset: true });
    expect(log).toHaveLength(1);
    delete globalThis.__beats;
  });
});

describe('source-authoritative scene membership', () => {
  it('registers a new strategy but leaves it inactive until a scene uses it', () => {
    const h = createTestHost();
    h.evaluator.evaluate('const first = { draw() {} };');
    h.frame(2);
    expect(h.registry.hasStrategy('first')).toBe(true);
    expect(h.registry.activeOrder()).not.toContain('first');

    h.evaluator.evaluate('const show = [first]; show.draw();');
    h.frame(2);
    expect(h.registry.activeOrder()).toEqual(['first']);
  });

  it('defers to explicit scene arrays in the same buffer', () => {
    const h = createTestHost();
    h.evaluator.evaluate(`
      const wash = { draw() {} };
      const calm = [wash];
      calm.draw();
    `);
    h.frame(3);

    h.evaluator.evaluate(`
      const chaos = { draw() {} };
      const wild = [chaos];
      wild.draw();
    `);
    h.frame(3);

    expect(h.registry.activeOrder()).toEqual(['chaos']);
    expect(h.registry.listScenes().find((scene) => scene.name === 'calm').order.map((i) => i.id)).toEqual([
      'wash',
    ]);
  });
});
