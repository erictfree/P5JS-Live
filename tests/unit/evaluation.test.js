// Safety and recovery for direct strategy-object evaluation.

import { describe, it, expect } from 'vitest';
import { createTestHost } from './helpers.js';

const RINGS_V1 = `
  const rings = { draw({ state }) { state.n = (state.n || 0) + 1; } };
  const show = [rings];
  activate(show);
`;

describe('evaluation completion receipts', () => {
  it('identifies applied versions and discarded work without changing the running code', () => {
    const h = createTestHost();
    const first = h.evaluator.evaluate(RINGS_V1);
    expect(first.completion.status).toBe('queued');
    h.frame(2);
    expect(first.completion).toEqual({ status: 'applied', versions: { rings: 1 } });
    const rejected = h.evaluator.evaluate('const rings = { draw() {} };');
    h.evaluator.discardPending();
    h.frame(2);
    expect(rejected.completion.status).toBe('discarded');
    expect(h.registry.getStrategy('rings').version).toBe(1);
  });
});

describe('a syntax error never replaces a valid active strategy', () => {
  it('rejects before anything is staged', () => {
    const h = createTestHost();
    h.evaluator.evaluate(RINGS_V1);
    h.frame(2);
    const good = h.registry.getStrategy('rings').definition;

    const result = h.evaluator.evaluate('const rings = { draw({state}) { this is not js ((( } };');
    h.frame(2);

    expect(result.ok).toBe(false);
    expect(result.phase).toBe('syntax');
    expect(h.registry.getStrategy('rings').definition).toBe(good);
    expect(h.registry.getStrategy('rings').version).toBe(1);
  });

  it('survives a hundred consecutive syntax errors', () => {
    const h = createTestHost();
    h.evaluator.evaluate(RINGS_V1);
    h.frame(2);
    const good = h.registry.getStrategy('rings').definition;

    for (let i = 0; i < 100; i++) {
      h.evaluator.evaluate(`const rings = { draw() { ${i} !!! `);
      h.frame();
    }

    expect(h.registry.getStrategy('rings').definition).toBe(good);
    expect(h.stateStore.get('rings').n).toBeGreaterThan(100);
  });
});

describe('an evaluation error never replaces a valid active strategy', () => {
  it('installs an explicitly named first-class function patch before it is in a scene', () => {
    const h = createTestHost();
    const result = h.evaluator.evaluate(`// %% patch strobe
function strobe() {}`);
    h.frame();

    expect(result.ok).toBe(true);
    expect(h.registry.getStrategy('strobe').definition).toBe(h.evaluator.binding('strobe'));
    expect(typeof h.registry.getStrategy('strobe').definition).toBe('function');
  });

  it('does not promote a helper function just because it shares a patch cell', () => {
    const h = createTestHost();
    h.evaluator.evaluate(`// %% patch kaleido
function makeKaleido() { return { draw() {} }; }
const kaleido = makeKaleido();`);
    h.frame();

    expect(h.registry.hasStrategy('kaleido')).toBe(true);
    expect(h.registry.hasStrategy('makeKaleido')).toBe(false);
    expect(typeof h.evaluator.binding('makeKaleido')).toBe('function');
  });

  it('rejects the removed patch() registration API', () => {
    const h = createTestHost();
    const result = h.evaluator.evaluate('patch("rings", { draw() {} });');

    expect(result.ok).toBe(false);
    expect(result.phase).toBe('evaluation');
    expect(result.error.message).toContain('patch is not defined');
    expect(h.registry.hasStrategy('rings')).toBe(false);
  });

  it('rejects a strategy object with no draw method', () => {
    const h = createTestHost();
    h.evaluator.evaluate(RINGS_V1);
    h.frame(2);

    const result = h.evaluator.evaluate('const rings = { state() { return {}; } };');
    h.frame(2);

    expect(result.ok).toBe(false);
    expect(result.phase).toBe('evaluation');
    expect(result.error.message).toContain('draw()');
    expect(h.registry.getStrategy('rings').version).toBe(1);
  });

  it('rejects a scene array that references an undefined binding', () => {
    const h = createTestHost();
    h.evaluator.evaluate(RINGS_V1);
    h.frame(2);

    const result = h.evaluator.evaluate('const x = [rings, ghost]; activate(x);');

    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('ghost');
    expect(h.registry.listScenes().some((scene) => scene.name === 'x')).toBe(false);
  });

  it('discards a block that throws halfway through its declarations', () => {
    const h = createTestHost();
    h.evaluator.evaluate(RINGS_V1);
    h.frame(2);

    const result = h.evaluator.evaluate(`
      const wash = { draw() {} };
      throw new Error("boom");
      const rings = { draw() {} };
    `);
    h.frame(2);

    expect(result.ok).toBe(false);
    expect(h.registry.hasStrategy('wash')).toBe(false);
    expect(h.registry.getStrategy('rings').version).toBe(1);
  });

  it('keeps non-strategy objects as ordinary helper bindings', () => {
    const h = createTestHost();
    const result = h.evaluator.evaluate(`
      const palette = { hue: 190 };
      const rings = { draw({ state }) { state.hue = palette.hue; } };
      const show = [rings];
      activate(show);
    `);
    h.frame(2);

    expect(result.ok).toBe(true);
    expect(h.registry.hasStrategy('palette')).toBe(false);
    expect(h.evaluator.binding('palette')).toEqual({ hue: 190 });
    expect(h.stateStore.get('rings').hue).toBe(190);
  });

  it('rejects a helper object only when it is used as a strategy', () => {
    const h = createTestHost();
    const result = h.evaluator.evaluate('const helper = {}; const show = [helper]; activate(show);');

    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('draw()');
    expect(h.registry.hasStrategy('helper')).toBe(false);
  });

  it('rejects string scene names because activate() takes the array itself', () => {
    const h = createTestHost();
    const result = h.evaluator.evaluate(`
      const wash = { draw() {} };
      const show = [wash];
      activate("show");
    `);

    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('scene array');
  });

  it('rejects scene descriptors because scenes contain strategies directly', () => {
    const h = createTestHost();
    const result = h.evaluator.evaluate(`
      const wash = { draw() {} };
      const show = [{ strategy: wash, config: { alpha: 20 } }];
      activate(show);
    `);

    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('draw()');
  });

  it('does not expose the removed scene-mutation commands', () => {
    const h = createTestHost();
    const result = h.evaluator.evaluate(`
      const wash = { draw() {} };
      add(wash);
    `);

    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('add is not defined');
  });

  it('does not expose the retired go() scene alias', () => {
    const h = createTestHost();
    const result = h.evaluator.evaluate(`
      const wash = { draw() {} };
      const show = [wash];
      go(show);
    `);

    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('go is not defined');
  });
});

describe('first-class function strategies', () => {
  it('promotes a function when a scene uses it and passes draw inputs directly', () => {
    const h = createTestHost();
    h.evaluator.evaluate(`
      const wash = ({ state, audio }) => {
        state.total = (state.total || 0) + audio.level;
      };
      const show = [wash];
      activate(show);
    `);
    h.frame(5, { beat: false, level: 0.25 });

    expect(typeof h.registry.getStrategy('wash').definition).toBe('function');
    expect(h.stateStore.get('wash').total).toBeGreaterThan(0);
  });

  it('keeps factory functions as helpers and registers only the returned strategy', () => {
    const h = createTestHost();
    h.evaluator.evaluate(`
      function makePulse(count) {
        return ({ state }) => { state.count = count; };
      }
      const pulse = makePulse(7);
      const show = [pulse];
      activate(show);
    `);
    h.frame(3);

    expect(h.registry.hasStrategy('makePulse')).toBe(false);
    expect(h.registry.hasStrategy('pulse')).toBe(true);
    expect(h.stateStore.get('pulse').count).toBe(7);
  });

  it('hot-replaces a function after it has become a strategy', () => {
    const h = createTestHost();
    h.evaluator.evaluate(`
      const wash = ({ state }) => { state.version = 1; };
      const show = [wash];
      activate(show);
    `);
    h.frame(3);

    h.evaluator.evaluate('const wash = ({ state }) => { state.version = 2; };');
    h.frame(3);

    expect(h.registry.getStrategy('wash').version).toBe(2);
    expect(h.stateStore.get('wash').version).toBe(2);
  });

  it('rolls back a failed anonymous scene-slot replacement', () => {
    const h = createTestHost();
    h.evaluator.evaluate(`
      const show = [({ state }) => { state.good = (state.good || 0) + 1; }];
      activate(show);
    `);
    h.frame(5);
    const good = h.registry.getStrategy('show[0]').definition;
    const before = h.stateStore.get('show[0]').good;

    h.evaluator.evaluate(`
      const show = [({ state }) => {
        state.good = -999;
        missingInlineFunction();
      }];
    `);
    h.frame(2);

    expect(h.registry.getStrategy('show[0]').definition).toBe(good);
    expect(h.registry.getStrategy('show[0]').version).toBe(1);
    expect(h.stateStore.get('show[0]').good).toBe(before);
    expect(h.evaluator.hasBinding('show[0]')).toBe(false);
    expect(h.evaluator.binding('show')[0]).toBe(good);
    expect(h.evaluator.evaluate('const ordinaryValue = 3;').ok).toBe(true);
  });
});

describe('atomic class and factory cells', () => {
  it('captures every declaration while storing the whole cell as strategy source', () => {
    const h = createTestHost();
    const source = `// %% strategy counter
class Counter {
  #step = 3;
  draw({ state }) { state.total = (state.total || 0) + this.#step; }
}
const counter = new Counter();
const show = [counter];
activate(show);`;

    h.evaluator.evaluate(source);
    h.frame(3);

    expect(h.stateStore.get('counter').total).toBeGreaterThanOrEqual(6);
    expect(h.registry.getStrategy('counter').source).toBe(source);
    expect(h.evaluator.binding('Counter')).toBeTypeOf('function');
  });

  it('re-evaluates an edited class cell as a new patch version', () => {
    const h = createTestHost();
    const first = `// %% patch plasma
class Plasma {
  draw({ state }) { state.version = 1; }
}
const plasma = new Plasma();
const show = [plasma];
activate(show);`;
    const second = first.replace('state.version = 1', 'state.version = 2');

    expect(h.evaluator.evaluate(first).ok).toBe(true);
    h.frame(3);
    expect(h.evaluator.evaluate(second).ok).toBe(true);
    h.frame(3);

    expect(h.registry.getStrategy('plasma').version).toBe(2);
    expect(h.stateStore.get('plasma').version).toBe(2);
    expect(h.diagnostics.list().map((entry) => entry.detail ?? '')).not.toContain(
      expect.stringContaining('Cannot declare a class twice'),
    );
  });

  it('repairs duplicate installed class cells by using the newest definition', () => {
    const h = createTestHost();
    const source = `// %% patch plasma
class Plasma { draw({ state }) { state.version = 1; } }
const plasma = new Plasma();

// %% scene show
const show = [plasma];
activate(show);

// %% patch plasma
class Plasma { draw({ state }) { state.version = 2; } }
const plasma = new Plasma();`;

    const result = h.evaluator.evaluate(source, { label: 'buffer' });
    h.frame(3);

    expect(result.ok).toBe(true);
    expect(h.registry.getStrategy('plasma').source).toContain('state.version = 2');
    expect(h.stateStore.get('plasma').version).toBe(2);
    expect(h.diagnostics.list().some((entry) => entry.message.includes('Duplicate patch source repaired'))).toBe(true);
  });
});

describe('a first-frame runtime error restores the previous object', () => {
  it('restores both the previous object and the pre-candidate state', () => {
    const h = createTestHost();
    h.evaluator.evaluate(RINGS_V1);
    h.frame(20);
    const good = h.registry.getStrategy('rings').definition;
    const countBefore = h.stateStore.get('rings').n;

    h.evaluator.evaluate(
      'const rings = { draw({ state }) { state.n = 9999; missing.boom(); } };',
    );
    h.frame(2);

    const record = h.registry.getStrategy('rings');
    expect(record.definition).toBe(good);
    expect(record.version).toBe(1);
    expect(record.lastError.message).toContain('missing');
    expect(h.stateStore.get('rings').n).toBe(countBefore);
  });

  it('never files a failed object in history', () => {
    const h = createTestHost();
    h.evaluator.evaluate(RINGS_V1);
    h.frame(2);
    h.evaluator.evaluate('const rings = { draw() { missing.boom(); } };');
    h.frame(3);

    expect(h.registry.getStrategy('rings').history).toHaveLength(1);
    expect(h.registry.getStrategy('rings').history[0].version).toBe(1);
  });

  it('reports a first-frame code error for visible editor feedback', () => {
    const failures = [];
    const h = createTestHost({
      onCodeError: (name, error) => failures.push({ name, message: error.message }),
    });
    h.evaluator.evaluate(RINGS_V1);
    h.frame(2);

    h.evaluator.evaluate('const rings = { draw() { missing.boom(); } };');
    h.frame(2);

    expect(failures).toEqual([{ name: 'rings', message: 'missing is not defined' }]);
    expect(h.registry.getStrategy('rings').version).toBe(1);
  });

  it('restores the JavaScript binding as well as the registry object', () => {
    const h = createTestHost();
    h.evaluator.evaluate(RINGS_V1);
    h.frame(2);
    const good = h.registry.getStrategy('rings').definition;

    h.evaluator.evaluate('const rings = { draw() { missing.boom(); } };');
    h.frame(2);
    expect(h.evaluator.binding('rings')).toBe(good);

    h.evaluator.evaluate('const show = [rings, rings];');
    h.frame(2);
    expect(h.registry.getStrategy('rings').version).toBe(1);
    expect(h.registry.activeOrder()).toEqual(['rings', 'rings#2']);
  });

  it('keeps the last successfully running scene when a new scene candidate fails', () => {
    const h = createTestHost();
    h.evaluator.evaluate(`
      const good = { draw({ state }) { state.frames = (state.frames || 0) + 1; } };
      const trusted = [good];
      activate(trusted);
    `);
    h.frame(8);
    const before = h.stateStore.get('good').frames;

    h.evaluator.evaluate(`
      const broken = { draw() { throw new Error("first frame failed"); } };
      const risky = [broken];
      activate(risky);
    `);
    h.frame(3);

    expect(h.registry.activeSceneName()).toBe('trusted');
    expect(h.registry.activeOrder()).toEqual(['good']);
    expect(h.stateStore.get('good').frames).toBeGreaterThan(before);
    expect(h.diagnostics.latest().message).toContain('rolled back');
  });
});

describe('resource disposal', () => {
  it('disposes replaced, failed, and reset strategy objects', () => {
    const h = createTestHost();
    globalThis.__disposed = [];

    h.evaluator.evaluate(`
      const shader = {
        draw() {},
        dispose() { __disposed.push("old"); },
      };
      const show = [shader];
      activate(show);
    `);
    h.frame(2);

    h.evaluator.evaluate(`
      const shader = {
        draw() {},
        dispose() { __disposed.push("current"); },
      };
    `);
    h.frame(2);
    expect(globalThis.__disposed).toEqual(['old']);

    h.evaluator.evaluate(`
      const shader = {
        draw() { throw new Error("bad shader"); },
        dispose() { __disposed.push("failed"); },
      };
    `);
    h.frame(2);
    expect(globalThis.__disposed).toEqual(['old', 'failed']);

    h.host.reset();
    expect(globalThis.__disposed).toEqual(['old', 'failed', 'current']);
    delete globalThis.__disposed;
  });
});

describe('one failing strategy does not stop the others', () => {
  it('keeps drawing the rest of the scene, every frame', () => {
    const h = createTestHost();
    h.evaluator.evaluate(`
      const wash = { draw({ state }) { state.n = (state.n || 0) + 1; } };
      const broken = { draw() { throw new Error("always"); } };
      const rings = { draw({ state }) { state.n = (state.n || 0) + 1; } };
      const show = [wash, broken, rings];
      activate(show);
    `);
    h.frame(32);

    expect(h.stateStore.get('wash').n).toBeGreaterThan(25);
    expect(h.stateStore.get('rings').n).toBeGreaterThan(25);
    expect(h.registry.getStrategy('broken').status).toBe('failed');
  });

  it('throttles a strategy that throws every frame instead of flooding messages', () => {
    const h = createTestHost();
    h.evaluator.evaluate(`
      const broken = { draw() { throw new Error("always"); } };
      const show = [broken];
      activate(show);
    `);
    h.frame(400);

    const errors = h.diagnostics.list().filter((d) => d.level === 'error');
    expect(errors.length).toBeLessThan(10);
  });

  it('leaves p5 push/pop balanced when a strategy throws', () => {
    const h = createTestHost();
    h.evaluator.evaluate(`
      const broken = { draw() { throw new Error("always"); } };
      const show = [broken];
      activate(show);
    `);
    h.frame(10);

    expect(h.drawing.depth).toBe(0);
  });
});

describe('version history and reversion', () => {
  it('keeps successful versions and reverts to a chosen object', () => {
    const h = createTestHost();
    for (let i = 1; i <= 12; i++) {
      h.evaluator.evaluate(`
        const rings = { draw({ state }) { state.mark = ${i}; } };
        ${i === 1 ? 'const show = [rings]; activate(show);' : ''}
      `);
      h.frame(2);
    }
    const record = h.registry.getStrategy('rings');
    expect(record.version).toBe(12);
    expect(record.history.length).toBeGreaterThanOrEqual(10);

    h.evaluator.revert('rings', 5);
    h.frame(3);

    expect(h.registry.getStrategy('rings').version).toBe(13);
    expect(h.registry.getStrategy('rings').source).toContain('state.mark = 5');
    expect(h.stateStore.get('rings').mark).toBe(5);
  });
});

describe('replacement is scoped and lands at a frame boundary', () => {
  it('does not re-evaluate or reset unrelated objects', () => {
    const h = createTestHost();
    h.evaluator.evaluate(`
      const wash = { state() { return { born: 1 }; }, draw({ state }) { state.n = (state.n||0)+1; } };
      const rings = { draw() {} };
      const show = [wash, rings];
      activate(show);
    `);
    h.frame(10);
    const washState = h.stateStore.get('wash');
    const washVersion = h.registry.getStrategy('wash').version;

    h.evaluator.evaluate('const rings = { draw() {} };');
    h.frame(3);

    expect(h.stateStore.get('wash')).toBe(washState);
    expect(h.registry.getStrategy('wash').version).toBe(washVersion);
  });

  it('does not swap the implementation mid-frame', () => {
    const h = createTestHost();
    h.evaluator.evaluate('const rings = { draw() {} };');
    h.frame(2);
    const before = h.registry.getStrategy('rings').definition;

    h.evaluator.evaluate('const rings = { draw() { return 2; } };');
    expect(h.registry.getStrategy('rings').definition).toBe(before);

    h.frame(1);
    expect(h.registry.getStrategy('rings').definition).not.toBe(before);
  });
});
