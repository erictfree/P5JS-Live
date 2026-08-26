// Multiple references to one strategy in a scene create independent instances.
// Composition is changed only by evaluating a new version of the scene array.

import { describe, it, expect } from 'vitest';
import { createTestHost } from './helpers.js';

const COUNTER = `
  const c = { draw({ state }) { state.n = (state.n || 0) + 1; } };
  const show = [c];
  activate(show);
`;

const COUNTER_COPIES = `
  const c = { draw({ state }) { state.n = (state.n || 0) + 1; } };
  const show = [c, c];
  activate(show);
`;

describe('first-class strategy instances', () => {
  it('supplies declared live values as controls and physical keys as keyboard', () => {
    const h = createTestHost();
    h.evaluator.evaluate(`
      control("flash", false, { type: "button", mode: "momentary" });
      const probe = {
        draw({ controls, keyboard }) {
          globalThis.__liveContext = { flash: controls.flash, keyboard };
        }
      };
      const show = [probe];
      activate(show);
    `);
    h.frame();
    h.registry.setParam('flash', true);
    h.frame();

    expect(globalThis.__liveContext.flash).toBe(true);
    expect(globalThis.__liveContext.keyboard).toEqual({});
    delete globalThis.__liveContext;
  });

  it('keeps a stable scene object while its implementation is replaced', () => {
    const h = createTestHost();
    h.evaluator.evaluate(`
      const c = { draw() {} };
      const show = [c];
      activate(show);
    `);
    h.frame(2);

    const strategy = h.registry.activeStrategies()[0];
    const firstDraw = strategy.draw;
    const firstImplementation = strategy.implementation;
    expect(strategy).toMatchObject({ id: 'c', strategy: 'c' });
    expect(typeof strategy.draw).toBe('function');

    h.evaluator.evaluate('const c = { draw() { return 2; } };');
    h.frame(2);

    expect(h.registry.activeStrategies()[0]).toBe(strategy);
    expect(strategy.draw).toBe(firstDraw);
    expect(strategy.implementation).not.toBe(firstImplementation);
  });

  it('retains a class instance and invokes its methods with the instance as this', () => {
    const h = createTestHost();
    h.evaluator.evaluate(`
      class SophisticatedStrategy {
        #step = 2;
        constructor() { this.label = "class instance"; this.total = 0; }
        state() { return { owner: this.label, seen: 0 }; }
        advance() { this.total += this.#step; return this.total; }
        draw({ state }) { state.seen = this.advance(); }
      }
      const oop = new SophisticatedStrategy();
      const show = [oop];
      activate(show);
      globalThis.__oopImplementation = oop;
    `);
    h.frame(4);

    const strategy = h.registry.activeStrategies()[0];
    expect(h.registry.getStrategy('oop').definition).toBe(globalThis.__oopImplementation);
    expect(strategy.implementation).toBe(globalThis.__oopImplementation);
    expect(strategy.implementation.total).toBeGreaterThan(0);
    expect(h.stateStore.get('oop')).toMatchObject({ owner: 'class instance' });
    expect(h.stateStore.get('oop').seen).toBe(strategy.implementation.total);
    delete globalThis.__oopImplementation;
  });

  it('registers a declaration without implicitly adding it to the active scene', () => {
    const h = createTestHost();
    h.evaluator.evaluate('const spark = { hue: 40, draw() {} };');
    h.frame(2);

    expect(h.registry.hasStrategy('spark')).toBe(true);
    expect(h.registry.activeOrder()).toEqual([]);
    expect(h.registry.getStrategy('spark').definition.hue).toBe(40);
  });

  it('numbers duplicate references in their written order', () => {
    const h = createTestHost();
    h.evaluator.evaluate(`
      const a = { draw() {} };
      const b = { draw() {} };
      const show = [a, b, a, b];
      activate(show);
    `);
    h.frame(2);
    expect(h.registry.activeOrder()).toEqual(['a', 'b', 'a#2', 'b#2']);
  });

  it('gives every duplicate its own state', () => {
    const h = createTestHost();
    h.evaluator.evaluate(COUNTER_COPIES);
    h.frame(10);

    h.stateStore.get('c#2').n = 100;
    h.frame(2);
    expect(h.stateStore.get('c#2').n).toBeGreaterThan(h.stateStore.get('c').n);
    expect(h.stateStore.get('c')).not.toBe(h.stateStore.get('c#2'));
  });

  it('draws every duplicate', () => {
    const h = createTestHost();
    globalThis.__drawn = [];
    h.evaluator.evaluate(`
      const c = { draw() { __drawn.push("c"); } };
      const show = [c, c, c];
      activate(show);
    `);
    h.frame(2);

    globalThis.__drawn.length = 0;
    h.frame(1);
    expect(globalThis.__drawn).toEqual(['c', 'c', 'c']);
    delete globalThis.__drawn;
  });
});

describe('source-authoritative composition', () => {
  it('renders nested arrays as recursive isolated groups in written order', () => {
    const h = createTestHost();
    globalThis.__nestedOrder = [];
    h.evaluator.evaluate(`
      const a = { draw({ canvas }) { __nestedOrder.push(["a", canvas?.id ?? "root"]); } };
      const b = { draw({ canvas }) { __nestedOrder.push(["b", canvas?.id ?? "root"]); } };
      const c = { draw({ canvas }) { __nestedOrder.push(["c", canvas?.id ?? "root"]); } };
      const show = [a, [b, [c]], a];
      activate(show);
    `);
    h.frame(2);

    globalThis.__nestedOrder.length = 0;
    h.drawing.groups.length = 0;
    h.frame(1);

    expect(globalThis.__nestedOrder).toEqual([
      ['a', 'root'],
      ['b', 'show:group[1]'],
      ['c', 'show:group[1][1]'],
      ['a', 'root'],
    ]);
    expect(h.drawing.groups).toEqual([
      { type: 'begin', id: 'show:group[1]' },
      { type: 'begin', id: 'show:group[1][1]' },
      { type: 'end', id: 'show:group[1][1]' },
      { type: 'end', id: 'show:group[1]' },
    ]);
    expect(h.registry.activeOrder()).toEqual(['a', 'b', 'c', 'a#2']);
    delete globalThis.__nestedOrder;
  });

  it('calls a group factory once at evaluation while bare function patches run each frame', () => {
    const h = createTestHost();
    globalThis.__factoryCalls = 0;
    globalThis.__frameCalls = 0;
    h.evaluator.evaluate(`
      const framePatch = () => { __frameCalls += 1; };
      const objectPatch = { draw() {} };
      const makeGroup = () => { __factoryCalls += 1; return [objectPatch]; };
      const show = [framePatch, makeGroup()];
      activate(show);
    `);
    h.frame(5);

    expect(globalThis.__factoryCalls).toBe(1);
    expect(globalThis.__frameCalls).toBeGreaterThan(1);
    expect(h.registry.activeOrder()).toEqual(['framePatch', 'objectPatch']);
    delete globalThis.__factoryCalls;
    delete globalThis.__frameCalls;
  });

  it('preserves nested scene structure in configuration snapshots', () => {
    const h = createTestHost();
    h.evaluator.evaluate(`
      const a = { draw() {} };
      const b = { draw() {} };
      const show = [a, [b, [a]]];
      activate(show);
    `);
    h.frame(2);
    const snapshot = h.registry.snapshotConfiguration();

    h.evaluator.evaluate('const show = [b];');
    h.frame(2);
    h.registry.restoreConfiguration(snapshot);

    expect(h.registry.snapshotConfiguration().scenes.find(({ name }) => name === 'show').entries)
      .toEqual(['a', ['b', ['a']]]);
    expect(h.registry.activeOrder()).toEqual(['a', 'b', 'a#2']);
  });

  it('adds, removes, and reorders strategies by re-evaluating the array', () => {
    const h = createTestHost();
    h.evaluator.evaluate(`
      const a = { draw() {} };
      const b = { draw() {} };
      const show = [a];
      activate(show);
    `);
    h.frame(2);
    expect(h.registry.activeOrder()).toEqual(['a']);

    h.evaluator.evaluate('const show = [b, a, b];');
    h.frame(2);
    expect(h.registry.activeOrder()).toEqual(['b', 'a', 'b#2']);

    h.evaluator.evaluate('const show = [a];');
    h.frame(2);
    expect(h.registry.activeOrder()).toEqual(['a']);
  });

  it('does not change membership when only a strategy is re-evaluated', () => {
    const h = createTestHost();
    h.evaluator.evaluate(COUNTER);
    h.frame(2);
    for (let i = 0; i < 5; i++) {
      h.evaluator.evaluate('const c = { draw() {} };');
      h.frame(2);
    }
    expect(h.registry.activeOrder()).toEqual(['c']);
  });

  it('changes ordinary object properties through ordinary methods', () => {
    const h = createTestHost();
    h.evaluator.evaluate(`
      const c = {
        hue: 40,
        setHue(hue) { this.hue = hue; },
        draw({ state }) { state.n = (state.n || 0) + 1; state.hue = this.hue; },
      };
      const show = [c];
      activate(show);
    `);
    h.frame(5);
    const state = h.stateStore.get('c');

    const result = h.evaluator.evaluate('c.setHue(99);');
    h.frame(2);

    expect(result.ok).toBe(true);
    expect(h.registry.getStrategy('c').definition.hue).toBe(99);
    expect(h.stateStore.get('c')).toBe(state);
    expect(state.hue).toBe(99);
  });
});

describe('lifecycle is per scene instance', () => {
  it('runs enter and exit once for each copy', () => {
    const h = createTestHost();
    globalThis.__life = [];
    h.evaluator.evaluate(`
      const c = {
        enter() { __life.push("enter"); },
        exit() { __life.push("exit"); },
        draw() {},
      };
      const show = [c, c];
      activate(show);
    `);
    h.frame(3);
    expect(globalThis.__life).toEqual(['enter', 'enter']);

    h.evaluator.evaluate('const show = [c];');
    h.frame(3);
    expect(globalThis.__life.filter((entry) => entry === 'exit')).toHaveLength(1);
    delete globalThis.__life;
  });

  it('fires beat for every copy', () => {
    const h = createTestHost();
    let beats = 0;
    globalThis.__beat = () => beats++;
    h.evaluator.evaluate(`
      const c = { beat() { __beat(); }, draw() {} };
      const show = [c, c, c];
      activate(show);
    `);
    h.frame(2);

    beats = 0;
    h.frame(1, { beat: true });
    expect(beats).toBe(3);
    delete globalThis.__beat;
  });
});

describe('replacing a duplicated strategy', () => {
  it('replaces the behavior of every copy at once', () => {
    const h = createTestHost();
    globalThis.__versions = [];
    h.evaluator.evaluate(`
      const c = { draw() { __versions.push(1); } };
      const show = [c, c];
      activate(show);
    `);
    h.frame(2);

    h.evaluator.evaluate('const c = { draw() { __versions.push(2); } };');
    h.frame(2);
    globalThis.__versions.length = 0;
    h.frame(1);
    expect(globalThis.__versions).toEqual([2, 2]);
    delete globalThis.__versions;
  });

  it('preserves every copy’s state across replacement', () => {
    const h = createTestHost();
    h.evaluator.evaluate(COUNTER_COPIES);
    h.frame(20);
    h.stateStore.get('c#2').n += 20;
    const before = { one: h.stateStore.get('c').n, two: h.stateStore.get('c#2').n };

    h.evaluator.evaluate(
      'const c = { draw({ state }) { state.n = (state.n || 0) + 1; state.v2 = true; } };',
    );
    h.frame(3);

    expect(h.stateStore.get('c').n).toBeGreaterThanOrEqual(before.one);
    expect(h.stateStore.get('c#2').n).toBeGreaterThanOrEqual(before.two);
    expect(h.stateStore.get('c').n).not.toBe(h.stateStore.get('c#2').n);
  });

  it('rolls back all copy state when one candidate throws', () => {
    const h = createTestHost();
    h.evaluator.evaluate(COUNTER_COPIES);
    h.frame(20);
    const before = { one: h.stateStore.get('c').n, two: h.stateStore.get('c#2').n };

    h.evaluator.evaluate(
      'const c = { draw({ state }) { state.n = -999; missing.boom(); } };',
    );
    h.frame(2);

    expect(h.registry.getStrategy('c').version).toBe(1);
    expect(h.stateStore.get('c').n).toBe(before.one);
    expect(h.stateStore.get('c#2').n).toBe(before.two + 1);
  });

  it('does not commit until every stateful copy survives', () => {
    const h = createTestHost();
    h.evaluator.evaluate(`
      const c = { state: () => ({ n: 0 }), draw({ state }) { state.n++; } };
      const show = [c, c];
      activate(show);
    `);
    h.frame(2);
    h.stateStore.get('c#2').fail = true;
    const before = { one: h.stateStore.get('c').n, two: h.stateStore.get('c#2').n };

    h.evaluator.evaluate(`
      const c = {
        draw({ state }) {
          state.n = -999;
          if (state.fail) throw new Error("second copy failed");
        },
      };
    `);
    h.frame(2);

    expect(h.registry.getStrategy('c').version).toBe(1);
    expect(h.stateStore.get('c').n).toBe(before.one);
    expect(h.stateStore.get('c#2').n).toBe(before.two);
  });

  it('resets every copy with reset(strategy)', () => {
    const h = createTestHost();
    h.evaluator.evaluate(`
      const c = { state: () => ({ n: 0 }), draw({ state }) { state.n++; } };
      const show = [c, c];
      activate(show);
    `);
    h.frame(10);
    expect(h.stateStore.get('c').n).toBeGreaterThan(5);

    h.evaluator.evaluate('reset(c);');
    h.frame(1);
    expect(h.stateStore.get('c').n).toBeLessThanOrEqual(1);
    expect(h.stateStore.get('c#2').n).toBeLessThanOrEqual(1);
  });
});

describe('scene-local identities', () => {
  it('runs an anonymous arrow directly from a scene array', () => {
    const h = createTestHost();
    const result = h.evaluator.evaluate(`
      const show = [
        ({ state, time, audio }) => {
          state.calls = (state.calls || 0) + 1;
          state.last = time + audio.level;
        },
      ];
      activate(show);
    `);
    h.frame(4, { beat: false, level: 0.25 });

    expect(result.ok).toBe(true);
    expect(h.registry.activeOrder()).toEqual(['show[0]']);
    expect(h.registry.getStrategy('show[0]').definition).toBeTypeOf('function');
    expect(h.stateStore.get('show[0]')).toMatchObject({ calls: 3 });
  });

  it('runs an anonymous object with normal this and lifecycle methods', () => {
    const h = createTestHost();
    h.evaluator.evaluate(`
      const show = [{
        amount: 2,
        enter({ state }) { state.entered = (state.entered || 0) + 1; },
        draw({ state }) {
          this.total = (this.total || 0) + this.amount;
          state.total = this.total;
        },
      }];
      activate(show);
    `);
    h.frame(4);

    const implementation = h.registry.getStrategy('show[0]').definition;
    expect(h.registry.activeOrder()).toEqual(['show[0]']);
    expect(h.stateStore.get('show[0]').entered).toBe(1);
    expect(h.stateStore.get('show[0]').total).toBe(implementation.total);
    expect(implementation.total).toBeGreaterThan(0);
  });

  it('accepts a higher-order function result directly in the array', () => {
    const h = createTestHost();
    h.evaluator.evaluate(`
      function multiplyBy(amount) {
        return ({ state }) => {
          state.total = (state.total || 0) + amount;
        };
      }
      const show = [multiplyBy(4)];
      activate(show);
    `);
    h.frame(4);

    expect(h.registry.hasStrategy('multiplyBy')).toBe(false);
    expect(h.registry.activeOrder()).toEqual(['show[0]']);
    expect(h.stateStore.get('show[0]').total).toBe(12);
  });

  it('preserves slot state when an inline implementation is re-evaluated', () => {
    const h = createTestHost();
    h.evaluator.evaluate(`
      const show = [({ state }) => { state.calls = (state.calls || 0) + 1; }];
      activate(show);
    `);
    h.frame(5);
    const state = h.stateStore.get('show[0]');
    const before = state.calls;

    h.evaluator.evaluate(`
      const show = [({ state }) => {
        state.calls = (state.calls || 0) + 10;
        state.version = 2;
      }];
    `);
    h.frame(3);

    expect(h.registry.getStrategy('show[0]').version).toBe(2);
    expect(h.stateStore.get('show[0]')).toBe(state);
    expect(state.calls).toBeGreaterThan(before + 10);
    expect(state.version).toBe(2);
  });

  it('uses the array position as identity when an inline entry moves', () => {
    const h = createTestHost();
    h.evaluator.evaluate(`
      const named = () => {};
      const show = [({ state }) => { state.position = 0; }];
      activate(show);
    `);
    h.frame(3);

    h.evaluator.evaluate(`
      const show = [named, ({ state }) => { state.position = 1; }];
    `);
    h.frame(3);

    expect(h.registry.activeOrder()).toEqual(['named', 'show[1]']);
    expect(h.stateStore.get('show[1]').position).toBe(1);
    expect(h.stateStore.get('show[1]')).not.toBe(h.stateStore.get('show[0]'));
  });

  it('stores the containing scene cell as inline history source', () => {
    const h = createTestHost();
    h.evaluator.evaluate(`// %% patch named
const named = () => {};

// %% scene show
const show = [
  named,
  ({ state }) => { state.inline = true; },
];
activate(show);`, { label: 'buffer' });
    h.frame(3);

    const source = h.registry.getStrategy('show[1]').source;
    expect(source).toContain('// %% scene show');
    expect(source).toContain('state.inline = true');
    expect(source).not.toContain('// %% patch named');
  });

  it('names an invalid inline entry in its error message', () => {
    const h = createTestHost();
    const result = h.evaluator.evaluate(`
      const badScene = [{ helper: true }];
      activate(badScene);
    `);

    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('badScene[0]');
    expect(result.error.message).toContain('draw()');
  });
});
