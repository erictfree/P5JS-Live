import { describe, it, expect, vi, afterEach } from 'vitest';
import { layer, isLayer } from '../../src/host/layer.js';
import { ShaderChain, compileShaderOperations } from '../../src/shaders/shaderChain.js';
import { sceneArrayEntries, moveSceneEntry } from '../../src/language/sourceBlocks.js';
import { createAppController } from '../../src/app/controller.js';
import { createTestHost } from './helpers.js';

describe('sketch composition', () => {
  it('branches immutable arrays without wrapping patch lifecycle methods', () => {
    const sketch = { draw() {} };
    const base = layer(sketch);
    const a = base.fx(new ShaderChain().hue(0.3)).opacity(0.5);
    const b = base.rotate(0.2).scale(2).translate(0.1, 0).mute();
    expect(Array.isArray(a)).toBe(true);
    expect(isLayer(a)).toBe(true);
    expect(base).toHaveLength(1);
    expect(a).toHaveLength(3);
    expect(b.muted).toBe(true);
    expect(b).toHaveLength(2); // consecutive convenience effects share one chain
    expect(a.muted).toBe(false);
    expect(a[0]).toBe(sketch);
    expect(Object.isFrozen(a)).toBe(true);
    expect(() => layer({})).toThrow('need a patch');
    expect(() => base.fx(null)).toThrow('need a patch');
  });

  it('keeps independent occurrence state and named live replacement inside layers', () => {
    const h = createTestHost();
    expect(h.evaluator.evaluate(`
      const sketch = { state: () => ({ count: 0, enters: 0, beats: 0 }),
        enter({state}) { state.enters++; }, beat({state}) { state.beats++; },
        draw({state}) { state.count++; } };
      const wrapped = layer(sketch);
      const show = [wrapped, wrapped]; activate(show);
    `).ok).toBe(true);
    h.frame(3, { beat: true });
    expect(h.registry.listScenes().map(({name}) => name)).toEqual(['show']);
    expect(h.registry.activeOrder()).toEqual(['sketch', 'sketch#2']);
    expect(h.stateStore.get('sketch')).toEqual({ count: 2, enters: 1, beats: 2 });
    expect(h.stateStore.get('sketch#2')).not.toBe(h.stateStore.get('sketch'));
    h.evaluator.evaluate('const sketch = { draw({state}) { state.count += 10; } };');
    h.frame(2);
    expect(h.stateStore.get('sketch').count).toBe(13);
    expect(h.stateStore.get('sketch#2').count).toBe(13);
  });

  it('retains mute and group structure through recovery without losing state', () => {
    const h = createTestHost();
    h.evaluator.evaluate(`const sketch = { state: () => ({count:0}), draw({state}) { state.count++; } };
      const show = [layer(sketch).mute()]; activate(show);`);
    h.frame(3);
    expect(h.stateStore.get('sketch').count).toBe(0);
    const snapshot = h.registry.snapshotConfiguration();
    h.registry.defineScene('other', ['sketch']); h.registry.activate('other');
    h.registry.restoreConfiguration(snapshot);
    expect(h.registry.activeTree()[0]).toMatchObject({ kind: 'group', layer: true, muted: true });
    h.evaluator.evaluate('const show = [layer(sketch).mute(false)]; activate(show);');
    h.frame(2);
    expect(h.stateStore.get('sketch').count).toBe(1);
  });

  it('rolls back a failed inline layer child and keeps later activation safe', () => {
    const h = createTestHost();
    h.evaluator.evaluate('const show = [layer(() => {})]; activate(show);'); h.frame(3);
    h.evaluator.evaluate('const show = [layer(() => { throw new Error("bad"); })]; activate(show);');
    h.frame(3);
    expect(h.registry.getStrategy('show[0][0]').version).toBe(1);
    expect(isLayer(h.evaluator.binding('show')[0])).toBe(true);
    expect(h.evaluator.evaluate('activate(show);').ok).toBe(true);
    h.frame(2);
    expect(h.registry.activeTree()[0].layer).toBe(true);
  });

  it('reports live groups and effects separately from pending source edits', () => {
    const h = createTestHost();
    const controller = createAppController({ ...h, audio: { status: () => ({}) } });
    let source = `// %% patch sketch
const sketch = { draw() {} };
// %% scene show
const show = [layer(sketch).fx(new ShaderChain().hue(0.3).blur(3)), sketch];
activate(show);`;
    controller.setSourceProvider(() => source);
    h.evaluator.evaluate(source); h.frame(); // stage only: no WebGL in this fixture
    let scene = controller.snapshot().scene;
    expect(scene.dirty).toBe(false);
    expect(scene.canReorder).toBe(true);
    expect(scene.tree[0].children[1]).toMatchObject({ kind: 'effect', passes: 2 });
    expect(scene.tree[0].children[1].operations.map(({name}) => name)).toEqual(['hue', 'blur']);
    source = moveSceneEntry(source, 'show', 1, -1);
    scene = controller.snapshot().scene;
    expect(scene.dirty).toBe(true);
    expect(scene.canReorder).toBe(false);
    expect(scene.tree[0].kind).toBe('group');
    controller.dispose();
  });
});

describe('source composition edits', () => {
  it('moves whole expressions without losing nested commas, strings, comments, or Unicode offsets', () => {
    const source = `// ✨ const show = [fake];
const show = [
  layer(sketch).fx(new ShaderChain().hue(0.3)), // keep this note
  [{ draw() { text("a,b]", 0, 0); } }, effect],
];`;
    const entries = sceneArrayEntries(source, 'show');
    expect(entries).toHaveLength(2);
    const moved = moveSceneEntry(source, 'show', 1, -1);
    expect(moved).toContain('// keep this note');
    expect(sceneArrayEntries(moved, 'show').map(({text}) => text)).toEqual(entries.map(({text}) => text).reverse());
    expect(moveSceneEntry(moved, 'show', 0, 1)).toBe(source);
  });
  it('declines ambiguous or out-of-range edits', () => {
    expect(moveSceneEntry('const show = [...patches, effect];', 'show', 1, -1)).toBeNull();
    expect(moveSceneEntry('const show = buildScene();', 'show', 0, 1)).toBeNull();
    expect(moveSceneEntry('const show = [a, b];', 'show', 0, -1)).toBeNull();
    expect(sceneArrayEntries('const show = [a,,b];', 'show')).toBeNull();
  });
  it('ignores shadowed scene declarations and delimiters in regular expressions', () => {
    const source = 'function build() { const show = [wrong]; }\nconst show = [() => /[},]/.test("x"), sketch];';
    expect(sceneArrayEntries(source, 'show').map(({text}) => text)).toEqual(['() => /[},]/.test("x")', 'sketch']);
    expect(moveSceneEntry(source, 'show', 1, -1)).toContain('const show = [sketch, () => /[},]/.test("x")];');
  });
  it('keeps trailing string, template, and regex literals attached to arrow expressions', () => {
    const source = 'const show = [() => "x,y", () => `z]`, () => /[},]/g];';
    expect(sceneArrayEntries(source, 'show').map(({text}) => text)).toEqual(['() => "x,y"', '() => `z]`', '() => /[},]/g']);
    expect(moveSceneEntry(source, 'show', 0, 1)).toBe('const show = [() => `z]`, () => "x,y", () => /[},]/g];');
  });
});

describe('shader sequencing plan', () => {
  it('materializes preceding colors before neighborhood filters', () => {
    const plan = compileShaderOperations(new ShaderChain().hue(0.3).blur(3).rgbSplit(2).operations);
    expect(plan.passes.map(({uniforms}) => [...new Set(uniforms.map(({operator}) => operator))]))
      .toEqual([['hue'], ['blur'], ['rgbSplit']]);
    expect(plan.passes.slice(0, -1).every(({fragmentSource}) => fragmentSource.includes('gl_FragColor = effectColour;'))).toBe(true);
    expect(plan.passes.at(-1).fragmentSource).toContain('texture2D(uOriginal, vTexCoord)');
    expect(plan.usesFeedback).toBe(false);
  });
  it('bounds repeated sampling and preserves repeated operators', () => {
    const chain = new ShaderChain().blur(2).blur(3).rotate(0.1).rotate(0.2);
    const plan = compileShaderOperations(chain.operations);
    expect(plan.passes).toHaveLength(2);
    expect(chain.passCount).toBe(2);
    expect(plan.passes[1].fragmentSource).toContain('vec4 stage3(vec2 uv)');
    expect(compileShaderOperations(new ShaderChain().color(1, 1, 1, 0.5).operations).fragmentSource)
      .toContain('vec4 blended = effectColour;');
  });
});

describe('shader resource ownership', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('reuses at most two render targets and allocates feedback only when requested', () => {
    const graphics = [];
    for (const [name, value] of Object.entries({ width: 100, height: 80, WEBGL: 'webgl', REPLACE: 'copy',
      blendMode() {}, image() {}, createGraphics(width, height, mode) {
        const target = { width, height, mode, pixelDensity() {}, noStroke() {}, clear() {}, shader() {}, rect() {}, image() {},
          createShader: () => ({ setUniform() {} }),
          resizeCanvas(w, h) { this.width = w; this.height = h; }, remove: vi.fn() };
        graphics.push(target); return target;
      } })) vi.stubGlobal(name, value);
    const chain = new ShaderChain().hue(.2).blur(2).blur(3);
    const context = { canvas: {}, time: 0, audio: {} };
    chain.draw(context); chain.draw(context);
    expect(graphics).toHaveLength(2);
    expect(graphics.every(({mode}) => mode === 'webgl')).toBe(true);
    chain.feedback(.5).draw(context);
    expect(graphics).toHaveLength(3);
    expect(graphics[2].mode).toBeUndefined();
    vi.stubGlobal('width', 200); chain.draw(context);
    expect(graphics.every(({width}) => width === 200)).toBe(true);
    chain.clear().hue(.1).draw(context);
    expect(graphics[1].remove).toHaveBeenCalledTimes(1);
    expect(graphics[2].remove).toHaveBeenCalledTimes(1);
    chain.dispose();
    expect(graphics[0].remove).toHaveBeenCalledTimes(1);
  });
});
