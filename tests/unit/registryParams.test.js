import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/host/registry.js';

describe('registry updateParam', () => {
  it('edits range, step and default in place and keeps value and default inside the range', () => {
    const registry = createRegistry();
    registry.declareParam('size', 50, { min: 0, max: 100, step: 1 });
    expect(registry.updateParam('size', { min: 60, step: -5 })).toMatchObject({ min: 60, max: 100, step: 0, value: 60, default: 60 });
    registry.updateParam('size', { default: 80, max: 70 });
    expect(registry.listParams()[0]).toMatchObject({ min: 60, max: 70, default: 70, value: 60 });
    registry.updateParam('size', { max: 40 }); // crossed limits swap rather than invert
    expect(registry.listParams()[0]).toMatchObject({ min: 40, max: 60 });
    expect(registry.updateParam('missing', { min: 0 })).toBeNull();
    expect(registry.updateParam('size', { min: 'x', max: NaN })).toMatchObject({ min: 40, max: 60 }); // non-numbers ignored
  });

  it('survives a configuration snapshot and a later declaration restores the code', () => {
    const registry = createRegistry();
    registry.declareParam('size', 50, { min: 0, max: 100 });
    registry.updateParam('size', { min: 10, max: 90 });
    const fresh = createRegistry();
    fresh.restoreConfiguration(registry.snapshotConfiguration());
    expect(fresh.listParams()[0]).toMatchObject({ min: 10, max: 90 });
    fresh.declareParam('size', 50, { min: 0, max: 100 });
    expect(fresh.listParams()[0]).toMatchObject({ min: 0, max: 100, value: 50 });
  });
});
