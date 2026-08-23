import { describe, expect, it } from 'vitest';
import {
  ShaderChain,
  SHADER_BLEND_MODES,
  SHADER_COLOR_OPERATORS,
  SHADER_TRANSFORM_OPERATORS,
  compileShaderOperations,
  resolveShaderUniform,
} from '../../src/shaders/shaderChain.js';
import { createTestHost } from './helpers.js';

describe('ShaderChain', () => {
  it('is a fluent first-class patch with the documented single-input operators', () => {
    const chain = new ShaderChain();

    for (const name of [...SHADER_TRANSFORM_OPERATORS, ...SHADER_COLOR_OPERATORS]) {
      expect(chain[name]()).toBe(chain);
    }

    expect(typeof chain.draw).toBe('function');
    expect(typeof chain.dispose).toBe('function');
    expect(chain.operations.map(({ name }) => name)).toEqual([
      ...SHADER_TRANSFORM_OPERATORS,
      ...SHADER_COLOR_OPERATORS,
    ]);
  });

  it('compiles transforms before sampling and colours after sampling in one pass', () => {
    const chain = new ShaderChain()
      .rotate(0.2, 0.1)
      .pixelate(24, 16)
      .hue(0.3)
      .contrast(1.2);
    const compiled = compileShaderOperations(chain.operations);

    expect(compiled.fragmentSource).toContain('uniform float u_0_angle;');
    expect(compiled.fragmentSource).toContain('uniform float u_1_pixelX;');
    expect(compiled.fragmentSource).toContain('vec4 colour = texture2D(uScene, fract(uv));');
    expect(compiled.fragmentSource.indexOf('vec2 centered = uv')).toBeLessThan(
      compiled.fragmentSource.indexOf('vec4 colour = texture2D'),
    );
    expect(compiled.fragmentSource.indexOf('vec3 hsv2')).toBeGreaterThan(
      compiled.fragmentSource.indexOf('vec4 colour = texture2D'),
    );
    expect(compiled.uniforms).toHaveLength(6);
  });

  it('keeps kaleidoscope samples centered in the source image', () => {
    const compiled = compileShaderOperations(new ShaderChain().kaleid(6).operations);
    expect(compiled.fragmentSource).toContain(
      'uv = vec2(0.5) + kaleidRadius * vec2(cos(kaleidAngle), sin(kaleidAngle));',
    );
  });

  it('compiles standard spatial effects, feedback and alpha-safe wet/dry compositing', () => {
    const chain = new ShaderChain()
      .transform(0.1, -0.1, 1.2, 0.8, 0.2, 0.5, 0.5)
      .noiseWarp(0.02, 5, 0.1)
      .blur(3)
      .bloom(0.7, 5, 0.5)
      .rgbSplit(4, 0.2)
      .feedback(0.4, 0.95, 1.01)
      .lumaMask(0.2, 0.1, 0);
    const compiled = compileShaderOperations(chain.operations, { blendMode: 'screen' });

    expect(compiled.fragmentSource).toContain('uniform sampler2D uFeedback;');
    expect(compiled.fragmentSource).toContain('uniform float uMix;');
    expect(compiled.fragmentSource).toContain('valueNoise(');
    expect(compiled.fragmentSource).toContain('blurColour2');
    expect(compiled.fragmentSource).toContain('feedbackColour5');
    expect(compiled.fragmentSource).toContain('colour.a *= lumaAlpha6');
    expect(compiled.fragmentSource).toContain(
      '1.0 - (1.0 - original.rgb) * (1.0 - effectColour.rgb)',
    );
    expect(compiled.fragmentSource).toContain('mix(original, blended, clamp(uMix');
  });

  it('supports the standard blend vocabulary and rejects ambiguous modes', () => {
    expect(SHADER_BLEND_MODES).toEqual([
      'alpha', 'add', 'multiply', 'screen', 'overlay',
      'difference', 'subtract', 'lighten', 'darken',
    ]);
    expect(new ShaderChain().blend('normal')).toBeInstanceOf(ShaderChain);
    expect(new ShaderChain().blend('mult')).toBeInstanceOf(ShaderChain);
    expect(() => new ShaderChain().blend('mystery')).toThrow('Unknown shader blend mode');
    expect(() => compileShaderOperations([], { blendMode: 'mystery' }))
      .toThrow('Unknown shader blend mode');
  });

  it('resolves literal and higher-order parameters from the current draw context', () => {
    const context = { time: 4, audio: { bass: 0.5 } };
    const literal = { type: 'float', value: 1.25, operator: 'scale', argument: 'amount' };
    const dynamic = {
      type: 'float',
      value: ({ time, audio }) => time * audio.bass,
      operator: 'rotate',
      argument: 'angle',
    };
    const vector = {
      type: 'vec4',
      value: ({ audio }) => [audio.bass, 1, 1, 1],
      operator: 'sum',
      argument: 'scale',
    };

    expect(resolveShaderUniform(literal, context)).toBe(1.25);
    expect(resolveShaderUniform(dynamic, context)).toBe(2);
    expect(resolveShaderUniform(vector, context)).toEqual([0.5, 1, 1, 1]);
  });

  it('rejects invalid live values before they reach WebGL', () => {
    expect(() => resolveShaderUniform(
      { type: 'float', value: () => NaN, operator: 'hue', argument: 'amount' },
      {},
    )).toThrow('finite number');
    expect(() => resolveShaderUniform(
      { type: 'vec4', value: [1, 2], operator: 'sum', argument: 'scale' },
      {},
    )).toThrow('four numbers');
  });

  it('is available to ordinary evaluated live code without a registration wrapper', () => {
    const h = createTestHost();
    const result = h.evaluator.evaluate(`// %% patch flow
const flow = new ShaderChain()
  .rotate(({ time }) => time * 0.1)
  .scale(({ audio }) => 1 + audio.bass * 0.2)
  .hue(0.1);`);
    h.frame(2);

    expect(result.ok).toBe(true);
    expect(h.registry.hasStrategy('flow')).toBe(true);
    expect(h.evaluator.binding('flow')).toBeInstanceOf(ShaderChain);
    expect(h.evaluator.binding('flow').operations.map(({ name }) => name))
      .toEqual(['rotate', 'scale', 'hue']);
  });

  it('can be constructed anonymously in a scene slot', () => {
    const h = createTestHost();
    const result = h.evaluator.evaluate(`
      const show = [
        new ShaderChain()
          .rotate(({ time, audio }) => time * 0.1 + audio.bass * 0.2)
          .contrast(1.1),
      ];
      activate(show);
    `);

    // Apply the transaction, but do not draw: the unit host deliberately has no p5
    // WebGL renderer. The browser acceptance test owns the real draw path.
    h.frame(1);

    expect(result.ok).toBe(true);
    expect(h.registry.activeOrder()).toEqual(['show[0]']);
    expect(h.registry.getStrategy('show[0]').definition).toBeInstanceOf(ShaderChain);
    expect(h.registry.getStrategy('show[0]').definition.operations.map(({ name }) => name))
      .toEqual(['rotate', 'contrast']);
  });
});
