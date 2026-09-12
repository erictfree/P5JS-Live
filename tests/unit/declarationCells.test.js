import { describe, expect, it } from 'vitest';
import { declarationCellKind, lockedCellEdited } from '../../src/ui/editor.js';
import { createRegistry } from '../../src/host/registry.js';

const SOURCE = [
  '// %% controls performanceControls',
  'control("size", 50, { type: "continuous", min: 0, max: 100, step: 1 });',
  '',
  '// %% modulations',
  'modulation("lfo1", { wave: "sine", beats: 1, depth: 0.25, offset: 0 });',
  '',
  '// %% patch rings',
  'const rings = { draw() {} };',
  '',
].join('\n');

describe('generated declaration cells', () => {
  it('recognises the controls and modulations cells by their first word', () => {
    expect(declarationCellKind('controls performanceControls')).toBe('controls');
    expect(declarationCellKind('modulations')).toBe('modulations');
    expect(declarationCellKind('patch rings')).toBeNull();
    expect(declarationCellKind('')).toBeNull();
  });

  it('flags an edit only when it changes a declaration cell', () => {
    expect(lockedCellEdited(SOURCE, SOURCE)).toBeNull();
    expect(lockedCellEdited(SOURCE, SOURCE.replace('draw() {}', 'draw() { circle(0, 0, 9); }'))).toBeNull();
    expect(lockedCellEdited(SOURCE, SOURCE.replace('max: 100', 'max: 200'))).toBe('controls');
    expect(lockedCellEdited(SOURCE, SOURCE.replace('depth: 0.25', 'depth: 1'))).toBe('modulations');
    expect(lockedCellEdited(SOURCE, SOURCE.replace('// %% modulations\n', ''))).not.toBeNull(); // deleting the marker merges it into the controls cell
    expect(lockedCellEdited(SOURCE, `${SOURCE}// %% controls\ncontrol("x", 1);\n`)).toBe('controls'); // a second controls cell
    expect(lockedCellEdited(SOURCE, `// %% patch first\nconst first = {};\n\n${SOURCE}`)).toBeNull(); // cells move, text intact
  });
});

describe('registry removeParam', () => {
  it('drops a declared control and reports missing names', () => {
    const registry = createRegistry();
    registry.declareParam('size', 50, { min: 0, max: 100 });
    expect(registry.removeParam('size')).toBe(true);
    expect(registry.listParams()).toEqual([]);
    expect(registry.removeParam('size')).toBe(false);
  });
});
