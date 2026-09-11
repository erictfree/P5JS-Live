import { describe, expect, it, vi } from 'vitest';
import { createEffectsBoard, isEffectControl } from '../../src/performance/effectsBoard.js';

function fakeRegistry(params) {
  const map = new Map(params.map(p => [p.name, { ...p }]));
  return {
    listParams: vi.fn(() => [...map.values()]),
    setParam: vi.fn((name, value) => { map.get(name).value = value; }),
  };
}

describe('effects board', () => {
  it('binds only boolean toggle controls, in declaration order', () => {
    const registry = fakeRegistry([
      { name: 'size', value: 0.5 },
      { name: 'glow', value: false, mode: 'toggle' },
      { name: 'flash', value: false, mode: 'momentary' },
      { name: 'freeze', value: true, mode: 'toggle', type: 'button' },
    ]);
    const board = createEffectsBoard({ registry });
    expect(board.list()).toEqual([{ name: 'glow', value: false }, { name: 'freeze', value: true }]);
    expect(isEffectControl({ value: 0, mode: 'toggle' })).toBe(false);
  });

  it('toggles and sets by pad index through the registry', () => {
    const registry = fakeRegistry([{ name: 'glow', value: false, mode: 'toggle' }]);
    const board = createEffectsBoard({ registry });
    expect(board.toggle(0)).toEqual({ name: 'glow', value: true });
    expect(registry.setParam).toHaveBeenCalledWith('glow', true);
    expect(board.set(0, false)).toEqual({ name: 'glow', value: false });
    expect(board.toggle(1)).toBeNull();
    expect(board.toggle(-1)).toBeNull();
    expect(board.set(0, 'yes')).toBeNull();
  });

  it('caps the board at its size', () => {
    const registry = fakeRegistry(Array.from({ length: 40 }, (_, i) => ({ name: `fx${i}`, value: false, mode: 'toggle' })));
    const board = createEffectsBoard({ registry });
    expect(board.list()).toHaveLength(32);
    expect(board.entry(31).name).toBe('fx31');
    expect(board.entry(32)).toBeNull();
  });
});
