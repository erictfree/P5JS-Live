import { describe, it, expect, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { ARRAY_METHOD_NAMES, ARRAY_SHADER_METHODS, installArrayMethods } from '../../src/host/arrayApi.js';
import { ShaderChain } from '../../src/shaders/shaderChain.js';
import { validateStrategy } from '../../src/host/liveApi.js';
import { sceneMemberNames, insertSceneMember, describeBlock, findStatements } from '../../src/language/sourceBlocks.js';
import { createTestHost } from './helpers.js';

installArrayMethods();
const a = { draw() {} };
const b = { draw() {} };
const c = { draw() {} };
const names = entries => entries.filter(item => item instanceof ShaderChain).flatMap(item => item.operations.map(op => op.name));

describe('native array composition', () => {
  it('preserves nesting and source identities while branching immutable effect chains', () => {
    const pair = [a, b];
    const faint = pair.rotate(0, 0.2).opacity(0.2);
    const bright = faint.opacity(0.9);
    expect(pair).toEqual([a, b]);
    expect(faint.slice(0, 2)).toEqual(pair);
    expect(faint[0]).toBe(a);
    expect(names(faint)).toEqual(['rotate', 'color']);
    expect(names(bright)).toEqual(['rotate', 'color', 'color']);
    expect(bright[2]).not.toBe(faint[2]);
    expect(Object.isFrozen(faint)).toBe(true);
    const nested = [faint, c].blur(2);
    expect(nested[0]).toBe(faint);
    expect(nested[1]).toBe(c);
    expect(names(nested)).toEqual(['blur']);
  });

  it('keeps add order and explicit shader boundaries', () => {
    const after = [a, b].blur(3).add(c).opacity(0.5);
    expect(after[2].operations[0].name).toBe('blur');
    expect(after[3]).toBe(c);
    expect(after[4].operations[0].name).toBe('color');
    const explicit = new ShaderChain().hue(0.2).mix(0.4);
    const effects = [a].fx(explicit).blur(3);
    expect(effects[1]).toBe(explicit);
    expect(effects[2]).not.toBe(explicit);
    expect(explicit.operations).toHaveLength(1);
    const group = [b, c];
    expect([a].add(group)[1]).toBe(group);
    expect([].add(a, b).slice()).toEqual([a, b]);
  });

  it('accepts factories, computed access and borrowed methods as normal JavaScript', () => {
    const make = () => [a, b];
    const opacity = make().opacity;
    expect(opacity.call(make(), 0.2)[2].operations[0].args).toEqual([1, 1, 1, 0.2]);
    expect(make()['rotate'](0, 0.2)[2].operations[0].args).toEqual([0, 0.2]);
    expect(make()?.opacity?.(0.3)[2].operations[0].args.at(-1)).toBe(0.3);
    expect(() => opacity.call({}, 0.5)).toThrow('array of patches');
    expect(make().map(patch => patch).opacity(0.4)).toHaveLength(3);
  });

  it('exposes all selected shader operators and preserves native shift', () => {
    for (const name of ARRAY_SHADER_METHODS) {
      const effect = [a][name](...(name === 'modulate' ? [[b]] : [])).at(-1);
      expect(effect).toBeInstanceOf(ShaderChain);
      expect(effect.operations[0].name).toBe(name);
    }
    expect([a].colorShift(0.1, 0.2, 0.3, 0)[1].operations[0]).toMatchObject({ name: 'shift', args: [0.1, 0.2, 0.3, 0] });
    const native = [a, b];
    expect(native.shift()).toBe(a);
    expect(native).toEqual([b]);
    const amount = ({ time }) => time;
    expect([a].opacity(amount)[1].operations[0].args[3]).toBe(amount);
    expect([a].scale(2, 3, 4)[1].operations[0].args).toEqual([2, 3, 4, 0.5, 0.5]);
    // Layer conveniences have the same defaults before and after another method.
    for (const [name, args] of [['rotate', [0, 0]], ['scale', [1, 1, 1, 0.5, 0.5]]]) {
      expect([a][name]()[1].operations[0].args).toEqual(args);
      expect([a].opacity(1)[name]()[1].operations.at(-1).args).toEqual(args);
    }
  });

  it('rejects data, sparse and cyclic arrays while accepting shared nested groups', () => {
    expect(() => [1, 2].rotate()).toThrow('draw()');
    expect(() => [a, , b].opacity()).toThrow('empty array slot');
    const cycle = [a]; cycle.push(cycle);
    expect(() => cycle.opacity()).toThrow('cyclic array');
    expect(() => [a].add(cycle)).toThrow('cyclic array');
    expect(() => [a].mute('yes')).toThrow('boolean');
    const shared = [a];
    expect([shared, shared].opacity()).toHaveLength(3);
    expect(() => validateStrategy([a], 'notAPatch')).toThrow();
    expect([a].rotate().add(b).slice(0, 1)).toEqual([a]);
  });
});

describe('protected prototype methods', () => {
  it('throws on overwrite in sloppy and strict code and on descriptor replacement', () => {
    for (const name of ['opacity', 'draw']) {
      expect(() => new Function(`Array.prototype.${name} = () => {};`)()).toThrow('protected');
      expect(() => new Function(`"use strict"; Array.prototype.${name} = () => {};`)()).toThrow('protected');
      expect(() => Object.defineProperty(Array.prototype, name, { value() {} })).toThrow(TypeError);
      expect(Object.getOwnPropertyDescriptor(Array.prototype, name)).toMatchObject({ enumerable: false, configurable: false });
    }
    const keys = []; for (const key in [a, b]) keys.push(key);
    expect(keys).toEqual(['0', '1']);
    expect(() => installArrayMethods()).not.toThrow();
    expect([1, 2].map(value => value * 2)).toEqual([2, 4]);
  });

  it('preflights all names so a late collision installs nothing', () => {
    const prototype = runInNewContext('Array.prototype');
    const existing = () => {};
    Object.defineProperty(prototype, 'draw', { value: existing, configurable: true });
    expect(() => installArrayMethods(prototype)).toThrow('Array.draw already exists');
    expect('opacity' in prototype).toBe(false);
    expect(prototype.draw).toBe(existing);
    delete prototype.draw;
    const shift = prototype.shift;
    installArrayMethods(prototype);
    expect(prototype.shift).toBe(shift);
    for (const name of ARRAY_METHOD_NAMES) expect(typeof prototype[name]).toBe('function');
    expect(() => installArrayMethods(prototype)).not.toThrow();
  });
});

describe('array draw transactions', () => {
  it('selects scenes only through draw, with the last command winning at the boundary', () => {
    const h = createTestHost();
    expect(h.evaluator.evaluate('const patch = () => {}; const first = [patch]; const second = [patch, patch];').ok).toBe(true);
    h.frame();
    expect(h.registry.activeSceneName()).toBeNull();
    expect(h.registry.listScenes()).toEqual([]);
    expect(h.evaluator.evaluate('first.draw(); second.draw();').ok).toBe(true);
    expect(h.registry.activeSceneName()).toBeNull();
    h.frame();
    expect(h.registry.activeSceneName()).toBe('second');
    expect(h.registry.activeOrder()).toEqual(['patch', 'patch#2']);
  });

  it('rejects removed authoring aliases and exposes only controls in patch context', () => {
    const h = createTestHost();
    expect(h.evaluator.evaluate(`
      control('gain', 0.4);
      const patch = { state: () => ({}), draw(context) {
        context.state.gain = context.controls.gain;
        context.state.hasParamsAlias = Object.hasOwn(context, 'params');
      } };
      const scene = [patch]; scene.draw();
    `).ok).toBe(true);
    h.frame(2);
    expect(h.stateStore.get('patch')).toEqual({ gain: 0.4, hasParamsAlias: false });
    for (const source of ['layer(patch)', 'activate(scene)', 'param("gain", 0.9)']) {
      const result = h.evaluator.evaluate(source);
      expect(result.ok).toBe(false);
      expect(result.error).toBeInstanceOf(ReferenceError);
    }
    h.frame();
    expect(h.registry.activeSceneName()).toBe('scene');
    expect(h.stateStore.get('patch').gain).toBe(0.4);
  });

  it('can prepare a layer and draw it in a later evaluated block, retaining its source', () => {
    const h = createTestHost();
    const source = 'const scene = [() => {}].opacity(0.5);';
    expect(h.evaluator.evaluate(source).ok).toBe(true);
    h.frame();
    expect(h.registry.listScenes()).toEqual([]);
    expect(h.evaluator.evaluate('scene.draw();').ok).toBe(true);
    h.frame();
    expect(h.registry.activeSceneName()).toBe('scene');
    expect(h.registry.sceneSource('scene')).toBe(source);
    expect(h.registry.activeTree()).toHaveLength(2);
  });

  it('activates named arrays at frame boundaries, preserving p5 draw and patch state', () => {
    const h = createTestHost();
    const p5Draw = () => {};
    vi.stubGlobal('draw', p5Draw);
    try {
      const result = h.evaluator.evaluate(`
        const patch = { state: () => ({ n: 0 }), draw({state}) { state.n++; } };
        const scene = [[patch, patch]].draw();
      `);
      expect(result.ok).toBe(true);
      expect(h.registry.activeSceneName()).toBeNull();
      h.frame(3);
      expect(globalThis.draw).toBe(p5Draw);
      expect(h.registry.activeSceneName()).toBe('scene');
      expect(h.registry.activeOrder()).toEqual(['patch', 'patch#2']);
      expect(h.registry.hasStrategy('scene')).toBe(false);
      expect(h.stateStore.get('patch')).toEqual({ n: 2 });
      expect(h.stateStore.get('patch#2')).toEqual({ n: 2 });
      expect(h.evaluator.evaluate('const patch = { draw({state}) { state.n += 10; } };').ok).toBe(true);
      h.frame(2);
      expect(h.stateStore.get('patch')).toEqual({ n: 13 });
      expect(h.evaluator.evaluate('scene.draw();').ok).toBe(true);
      expect(() => h.evaluator.binding('scene').draw()).toThrow('while evaluating');
    } finally { vi.unstubAllGlobals(); }
  });

  it('preserves scope at the root and stages effects without classifying arrays as patches', () => {
    const h = createTestHost();
    expect(h.evaluator.evaluate(`
      const first = { draw() {} }; const second = { draw() {} }; const third = { draw() {} };
      const scene = [[first, second].rotate(0, 0.2), third].opacity(0.6);
      scene.draw();
    `).ok).toBe(true);
    h.frame(); // commit without invoking a shader in the Node fixture
    const tree = h.registry.activeTree();
    expect(tree).toHaveLength(3);
    expect(tree[0].kind).toBe('group');
    expect(tree[0].children.map(node => node.strategy)).toEqual(['first', 'second', 'scene[0][2]']);
    expect(tree[1].strategy).toBe('third');
    expect(h.registry.getStrategy('scene[2]').definition.operations[0].name).toBe('color');
    expect(h.registry.hasStrategy('scene')).toBe(false);
  });

  it('does not leak activation from failed evaluations or across independent hosts', () => {
    const h = createTestHost();
    expect(h.evaluator.evaluate('const patch = () => {}; const scene = [patch]; scene.draw();').ok).toBe(true);
    h.frame(2);
    expect(h.evaluator.evaluate('const bad = [patch]; bad.draw(); throw new Error("cancel");').ok).toBe(false);
    h.frame();
    expect(h.registry.activeSceneName()).toBe('scene');
    expect(() => [].draw()).toThrow('while evaluating');
    const other = createTestHost();
    expect(other.evaluator.evaluate('const scene = [() => {}]; scene.draw();').ok).toBe(true);
    other.frame();
    expect(h.registry.activeOrder()).toEqual(['patch']);
    expect(other.registry.activeOrder()).toEqual(['scene[0]']);
    expect(h.evaluator.evaluate('const bad = [1]; bad.draw();').ok).toBe(false);
  });

  it('retains root mute across array operations and resumes state', () => {
    const h = createTestHost();
    h.evaluator.evaluate('const patch = { state: () => ({n:0}), draw({state}) { state.n++; } }; const scene = [patch].mute(true).add(() => {}); scene.draw();');
    h.frame(3);
    expect(h.stateStore.get('patch').n).toBe(0);
    h.evaluator.evaluate('const scene = [patch].mute(false).add(() => {}); scene.draw();');
    h.frame(2);
    expect(h.stateStore.get('patch').n).toBe(1);
  });

  it('rolls back a failing child and can draw the recovered array again', () => {
    const h = createTestHost();
    h.evaluator.evaluate('const scene = [[() => {}].mute(false)]; scene.draw();'); h.frame(3);
    const original = h.registry.getStrategy('scene[0][0]').definition;
    h.evaluator.evaluate('const scene = [[() => { throw new Error("bad"); }].mute(false)]; scene.draw();'); h.frame(3);
    expect(h.registry.getStrategy('scene[0][0]').version).toBe(1);
    expect(h.evaluator.evaluate('scene.draw();').ok).toBe(true);
    h.frame(2);
    expect(h.registry.getStrategy('scene[0][0]').definition).toBe(original);
  });
});

describe('array source authoring', () => {
  it('finds patch names inside effect-bearing arrays and preserves methods during insertion', () => {
    const source = 'const scene = [[first, second].rotate(0, 0.2), third].opacity(0.6);\nscene.draw();';
    expect(sceneMemberNames(source, 'scene')).toEqual(['first', 'second', 'third']);
    const inserted = insertSceneMember(source, 'scene', 'fourth');
    expect(inserted).toBe('const scene = [[first, second].rotate(0, 0.2), third, fourth].opacity(0.6);\nscene.draw();');
    expect(describeBlock('scene.draw();')).toBe('draw scene');
  });

  it('keeps multiline fluent expressions in one editor block and finds appended patches', () => {
    const source = 'const scene = [[first].add(second).rotate(0, 0.2)]\n  // shared opacity\n  .opacity(0.6)\n  .add(third, [fourth].opacity(0.2));\nscene.draw();';
    expect(findStatements(source)).toHaveLength(2);
    expect(findStatements(source)[0].text).toContain('.add(third');
    expect(sceneMemberNames(source, 'scene')).toEqual(['first', 'second', 'third', 'fourth']);
  });
});
