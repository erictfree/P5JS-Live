import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestHost } from './helpers.js';
import { ShaderChain, SHADER_IMAGE_TEXTURES, compileShaderOperations } from '../../src/shaders/shaderChain.js';

// Test real host traversal and input wiring, while leaving GPU sampling to browser tests.
function fixture() {
  const h = createTestHost();
  vi.spyOn(ShaderChain.prototype, 'draw').mockImplementation(function (ctx) {
    for (const { uniform } of this.imageInputs) expect(ctx[SHADER_IMAGE_TEXTURES].get(uniform)).toBeTruthy();
    globalThis.__modulationOwnerState = ctx.state;
  });
  vi.spyOn(h.drawing, 'endGroup');
  return h;
}
afterEach(() => { vi.restoreAllMocks(); delete globalThis.__modulationOwnerState; });
const source = `
const source = { state: () => ({ frames: 0, hits: 0, enters: 0, exits: 0 }),
 enter({state}) { state.enters++; }, onset({state}) { state.hits++; },
 exit({state}) { state.exits++; }, draw({state}) { state.frames++; } };
const text = () => {};
const scene = [[text].modulate([source], 0.1)]; scene.draw();`;

describe('image modulation', () => {
  it('compiles signed, alpha-weighted displacement and bounds texture samplers per pass', () => {
    const image = [() => {}];
    const plan = compileShaderOperations(new ShaderChain().hue(0.2).modulate(image).modulate(image, 0.2).blur(2).operations);
    expect(plan.passes).toHaveLength(4);
    expect(plan.passes[1].fragmentSource).toContain('uniform sampler2D u_1_image;');
    expect(plan.passes[1].fragmentSource).toContain('(modulation1.rg - 0.5) * modulation1.a * u_1_amount');
    expect(plan.passes.every(p => p.uniforms.filter(u => u.type === 'sampler2D').length <= 1)).toBe(true);
  });

  it('runs hidden inputs through the host lifecycle without compositing them', () => {
    const h = fixture();
    expect(h.evaluator.evaluate(source).ok).toBe(true);
    h.frame(3, { onset: true });
    expect(h.stateStore.get('source')).toEqual({ frames: 2, hits: 2, enters: 1, exits: 0 });
    const node = h.registry.activeTree()[0].children[1];
    expect(node.inputs[0].layer.children[0].strategy).toBe('source');
    expect(h.drawing.endGroup).toHaveBeenCalledWith(expect.objectContaining({id: expect.stringContaining('input0')}), {composite: false});
    expect(globalThis.__modulationOwnerState).toBe(h.stateStore.get(node.id));
    expect(h.evaluator.evaluate('const scene = [text]; scene.draw();').ok).toBe(true);
    h.frame(2);
    expect(h.stateStore.get('source').exits).toBe(1);
  });

  it('keeps occurrence state independent when an image is reused, and replaces named inputs live', () => {
    const h = fixture();
    expect(h.evaluator.evaluate(source.replace('[[text].modulate([source], 0.1)]', '[[text].modulate([source], 0.1), [text].modulate([source], 0.2)]')).ok).toBe(true);
    h.frame(3);
    expect(h.registry.activeInstancesOf('source')).toHaveLength(2);
    expect(h.stateStore.get('source')).not.toBe(h.stateStore.get('source#2'));
    expect(h.evaluator.evaluate('const source = { draw({state}) { state.frames += 10; } };').ok).toBe(true);
    h.frame(2);
    expect(h.stateStore.get('source').frames).toBe(13);
    expect(h.stateStore.get('source#2').frames).toBe(13);
  });

  it('supports nested modulating inputs and preserves them through runtime snapshots', () => {
    const h = fixture();
    expect(h.evaluator.evaluate(source.replace('[source], 0.1','[source].modulate([text], 0.2).blur(3), 0.1')).ok).toBe(true);
    h.frame(3);
    const snapshot = h.registry.snapshotRuntime();
    const order = h.registry.activeOrder();
    h.registry.defineScene('empty', []); h.registry.activate('empty');
    h.registry.restoreRuntime(snapshot); h.frame();
    expect(h.registry.activeOrder()).toEqual(order);
    expect(h.stateStore.get('source').frames).toBe(3);
  });

  it('rewires a named shader on replacement and removes old inputs', () => {
    const h = fixture();
    expect(h.evaluator.evaluate(`const a = () => {}; const b = () => {};
      const fx = new ShaderChain().modulate([a]); const scene = [fx]; scene.draw();`).ok).toBe(true);
    h.frame(3);
    expect(h.registry.activeOrder()).toContain('a');
    expect(h.evaluator.evaluate('const fx = new ShaderChain().modulate([b]);').ok).toBe(true);
    h.frame(2);
    expect(h.registry.activeOrder()).toContain('b');
    expect(h.registry.activeOrder()).not.toContain('a');
    expect(h.evaluator.evaluate('const fx = () => {};').ok).toBe(true);
    h.frame(2);
    expect(h.registry.activeOrder()).toEqual(['fx']);
  });

  it('restores named shader input wiring from history while preserving other scene entries', () => {
    const h = fixture();
    expect(h.evaluator.evaluate(`const back = () => {}; const a = () => {}; const b = () => {};
      const fx = new ShaderChain().modulate([a]); const scene = [back, fx]; scene.draw();`).ok).toBe(true);
    h.frame(3);
    expect(h.evaluator.evaluate('const fx = new ShaderChain().modulate([b]);').ok).toBe(true);
    h.frame(3);
    expect(h.registry.activeOrder()).toEqual(['back','b','fx']);
    expect(h.evaluator.revert('fx', 1).ok).toBe(true);
    h.frame(3);
    expect(h.registry.activeOrder()).toEqual(['back','a','fx']);
  });

  it('does not resurrect a captured old input definition after a named patch is replaced', () => {
    const h = fixture(); h.evaluator.evaluate(source); h.frame(3);
    for (let i = 0; i < 16; i++) {
      h.evaluator.evaluate('const source = { draw({state}) { state.frames += 10; } };'); h.frame(3);
    }
    h.evaluator.restoreBindings(h.evaluator.snapshotBindings());
    const good = h.registry.getStrategy('source').definition;
    expect(h.evaluator.evaluate('const next = scene.opacity(0.7); next.draw();').ok).toBe(true); h.frame(2);
    expect(h.registry.getStrategy('source').definition).toBe(good);
    expect(h.registry.activeInstancesOf('source')).toHaveLength(1);
  });

  it('rejects wrong, sparse, cyclic and symbolic self-referencing inputs before activation', () => {
    const h = fixture(); h.evaluator.evaluate(source); h.frame(3);
    for (const code of [
      'const scene = [text].modulate(text); scene.draw();',
      'const scene = [text].modulate([1]); scene.draw();',
      'const scene = [text].modulate([,]); scene.draw();',
      'const a = []; const b = [text].modulate(a); a.push(b); const scene = [b]; scene.draw();',
      'const f = new ShaderChain(); f.modulate([f]); const scene = [f]; scene.draw();',
    ]) expect(h.evaluator.evaluate(code).ok, code).toBe(false);
    expect(h.registry.activeSceneName()).toBe('scene');
    h.evaluator.evaluate('const fx = new ShaderChain().modulate([text]); const scene = [fx]; scene.draw();'); h.frame(3);
    expect(h.evaluator.evaluate('const text = new ShaderChain().modulate([fx]);').ok).toBe(false);
  });

  it('rolls back a failed image patch and restores an anonymous input for later scene evaluation', () => {
    const h = fixture();
    const good='const scene = [() => {}].modulate([() => {}]); scene.draw();';
    h.evaluator.evaluate(good); h.frame(3);
    h.evaluator.evaluate(good.replace('.modulate([() => {}])', '.modulate([() => { throw new Error("input broke"); }])'));
    h.frame(3);
    expect(h.registry.listStrategies().filter(r => r.candidate)).toHaveLength(0);
    expect(h.evaluator.evaluate('const recovered = [...scene]; recovered.draw();').ok).toBe(true);
    h.frame(3);
    expect(h.registry.listStrategies().some(r => r.definition?.toString().includes('input broke'))).toBe(false);
  });

  it('does not advance a muted input and still supplies a cleared neutral texture', () => {
    const h = fixture();
    h.evaluator.evaluate(source.replace('[source], 0.1', '[source].mute(), 0.1')); h.frame(3, {onset: true});
    expect(h.stateStore.get('source')).toEqual({frames:0,hits:0,enters:0,exits:0});
    expect(h.drawing.endGroup).toHaveBeenCalledWith(expect.anything(), {composite:false});
  });
});
