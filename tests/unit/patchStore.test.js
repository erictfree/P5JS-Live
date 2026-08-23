import { describe, expect, it } from 'vitest';
import {
  createPatchStore,
  parsePatchSource,
  patchFromShareHash,
  patchShareHash,
  portablePatchSource,
} from '../../src/persistence/patchStore.js';

const SOURCE = `// %% patch bassFlower
// @title Bass Flower
// @author Maya Chen
// @description Opens with the bass.
// @category visual
// @version 3

const bassFlower = { draw({ audio }) { circle(20, 20, audio.bass * 40); } };`;

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
  };
}

describe('portable patches', () => {
  it('parses metadata and supplies friendly defaults for an ordinary editor cell', () => {
    expect(parsePatchSource(SOURCE).patch).toMatchObject({
      name: 'bassFlower',
      title: 'Bass Flower',
      author: 'Maya Chen',
      category: 'visual',
      version: '3',
    });
    const plain = portablePatchSource('// %% patch glow\n\nconst glow = { draw() {} };');
    expect(plain.ok).toBe(true);
    expect(plain.patch.source).toContain('// @title glow');
    expect(plain.patch.source.match(/@title/g)).toHaveLength(1);
  });

  it('round-trips Unicode source through a URL fragment', () => {
    const patch = parsePatchSource(`${SOURCE}\n// 💿`).patch;
    const decoded = patchFromShareHash(patchShareHash(patch));
    expect(decoded.ok).toBe(true);
    expect(decoded.patch.source).toContain('💿');
    expect(patchFromShareHash('#something-else')).toBe(null);
  });

  it('stores shared patches by name without evaluating them', () => {
    const store = createPatchStore({ storage: fakeStorage() });
    expect(store.save(parsePatchSource(SOURCE).patch)).toMatchObject({ ok: true, updated: false });
    expect(store.save(parsePatchSource(SOURCE.replace('Opens', 'Pulses')).patch))
      .toMatchObject({ ok: true, updated: true });
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].source).toContain('Pulses');
  });
});
