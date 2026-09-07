import { describe, expect, it } from 'vitest';
import { evaluateStartupProject } from '../../src/app/startupRecovery.js';
import { createTestHost } from './helpers.js';

const STARTER = `// %% patch myPatch
const myPatch = { draw() {} };

// %% scene scene
const scene = [myPatch];
scene.draw();`;

describe('startup project recovery', () => {
  it('keeps an atomic successful project unchanged', () => {
    const h = createTestHost();
    const result = evaluateStartupProject({
      source: STARTER,
      label: 'saved project',
      starterSource: STARTER,
      ...h,
    });

    expect(result).toMatchObject({ ok: true, recovered: false });
    expect(h.registry.activeOrder()).toEqual(['myPatch']);
  });

  it('recovers valid installed cells and supplies a visible fallback scene', () => {
    const h = createTestHost();
    const source = `// %% patch valid
const valid = { draw() {} };

// %% patch broken
const broken = { draw() { ((( } };

// %% scene show
const show = [valid, broken];
show.draw();`;
    const result = evaluateStartupProject({
      source,
      label: 'saved project',
      starterSource: STARTER,
      ...h,
    });

    expect(result).toMatchObject({ ok: true, recovered: true, fallback: 'starter' });
    expect(result.failedBlocks).toContain('patch broken');
    expect(h.registry.hasStrategy('valid')).toBe(true);
    expect(h.registry.activeOrder()).toEqual(['myPatch']);
  });

  it('uses the current starter even when a recovered patch has the old demo name', () => {
    const h = createTestHost();
    const source = `// %% patch plasma
const plasma = { draw() {} };

// %% patch another
const another = { draw() {} };

// %% patch broken
const broken = { draw() { ((( } };

// %% scene show
const show = [plasma, broken];
show.draw();`;
    const result = evaluateStartupProject({
      source,
      label: 'saved project',
      starterSource: STARTER,
      ...h,
    });

    expect(result).toMatchObject({ ok: true, recovered: true, fallback: 'starter' });
    expect(h.registry.hasStrategy('another')).toBe(true);
    expect(h.registry.hasStrategy('plasma')).toBe(true);
    expect(h.registry.activeOrder()).toEqual(['myPatch']);
  });
});
