// Safety and performance behavior.

import { describe, it, expect } from 'vitest';
import { createTestHost } from './helpers.js';

const TWO_SCENES = `
  const safe = { draw({ state }) { state.n = (state.n || 0) + 1; } };
  const wild = { draw({ state }) { state.n = (state.n || 0) + 1; } };
  const calm = [safe];
  const chaos = [safe, wild];
  calm.draw();
`;

describe('safe scene designation', () => {
  it('records the active scene and refuses an unknown scene', () => {
    const h = createTestHost();
    h.evaluator.evaluate(TWO_SCENES);
    h.frame(3);
    expect(h.registry.safeSceneName()).toBeNull();
    expect(h.registry.setSafeScene()).toBe('calm');
    expect(h.registry.setSafeScene('nope')).toBeNull();
    expect(h.registry.safeSceneName()).toBe('calm');
  });
});

describe('frame rate warning', () => {
  it('warns only after the frame rate stays low for five seconds', () => {
    const h = createTestHost({ fpsThreshold: 30 });
    h.evaluator.evaluate('const a = { draw() {} }; const scene = [a]; scene.draw();');

    // 10 FPS. The window has to fill before any judgment is made.
    h.frame(60, { beat: false }, 1 / 10);
    expect(warnings(h)).toHaveLength(0);

    // Three more seconds at 10 FPS — still under the five-second threshold.
    h.frame(30, { beat: false }, 1 / 10);
    expect(warnings(h)).toHaveLength(0);

    // Past five seconds.
    h.frame(30, { beat: false }, 1 / 10);
    expect(warnings(h)).toHaveLength(1);
    expect(warnings(h)[0].message).toContain('below 30 FPS');
  });

  it('warns once per episode, not once per frame', () => {
    const h = createTestHost({ fpsThreshold: 30 });
    h.evaluator.evaluate('const a = { draw() {} }; const scene = [a]; scene.draw();');
    h.frame(600, { beat: false }, 1 / 10);
    expect(warnings(h)).toHaveLength(1);
  });

  it('says so when the frame rate recovers', () => {
    const h = createTestHost({ fpsThreshold: 30 });
    h.evaluator.evaluate('const a = { draw() {} }; const scene = [a]; scene.draw();');
    h.frame(200, { beat: false }, 1 / 10);
    expect(warnings(h)).toHaveLength(1);

    h.frame(120, { beat: false }, 1 / 60);
    const recovered = h.diagnostics.list().filter((d) => d.message.includes('recovered'));
    expect(recovered).toHaveLength(1);
  });

  it('never warns at a healthy frame rate', () => {
    const h = createTestHost({ fpsThreshold: 30 });
    h.evaluator.evaluate('const a = { draw() {} }; const scene = [a]; scene.draw();');
    h.frame(1200);
    expect(warnings(h)).toHaveLength(0);
  });

  it('honours a changed threshold', () => {
    const h = createTestHost({ fpsThreshold: 30 });
    h.evaluator.evaluate('const a = { draw() {} }; const scene = [a]; scene.draw();');
    h.host.setFpsThreshold(120); // now 60 FPS counts as slow
    h.frame(500);
    expect(warnings(h)).toHaveLength(1);
  });
});

describe('dt is capped after a stall', () => {
  it('hands strategies a bounded dt even after a long freeze', () => {
    const h = createTestHost();
    const seen = [];
    globalThis.__dt = seen;
    h.evaluator.evaluate('const a = { draw({ dt }) { __dt.push(dt); } }; const scene = [a]; scene.draw();');
    h.frame(2);
    expect(seen).toHaveLength(1);
    h.frame(1, { beat: false }, 30); // a thirty-second stall
    expect(seen).toHaveLength(2);
    expect(seen.at(-1)).toBe(0.1);
    expect(Math.max(...seen)).toBeLessThanOrEqual(0.1);
    delete globalThis.__dt;
  });
});

const warnings = (h) => h.diagnostics.list().filter((d) => d.level === 'warn');
