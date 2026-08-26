// The editor determines blocks from ordinary top-level declarations and commands.
//
// The scanner does not need to be a parser. It needs to never mistake a brace inside
// a string or a comment for structure, because that is what produces an evaluation
// range that cuts a strategy in half.

import { describe, it, expect } from 'vitest';
import {
  findCells,
  findBlocks,
  blockAt,
  describeBlock,
  insertSceneMember,
  sceneMemberNames,
  moveSceneCellsLast,
  renameLegacyStarterScene,
  upgradeLegacyActivation,
} from '../../src/language/sourceBlocks.js';

const SOURCE = `// a comment with a brace {
const wash = {
  draw({ audio }) {
    fill(0, 0, 0, 20);
    rect(0, 0, width, height);
  },
};

const rings = {
  draw({ audio }) {
    const label = "a string with ; and } in it";
    text(label, 10, 10);
  },
};

const tunnel = [wash, rings];
activate(tunnel)
`;

describe('findBlocks', () => {
  it('finds each top-level statement', () => {
    const blocks = findBlocks(SOURCE);
    expect(blocks.map((b) => describeBlock(b.text))).toEqual([
      'strategy wash',
      'strategy rings',
      'scene tunnel',
      'activate tunnel',
    ]);
  });

  it('is not fooled by braces or semicolons inside strings', () => {
    const blocks = findBlocks(SOURCE);
    const rings = blocks.find((b) => describeBlock(b.text) === 'strategy rings');
    expect(rings.text).toContain('a string with ; and } in it');
    expect(rings.text.trimEnd().endsWith('};')).toBe(true);
  });

  it('ends a statement at a newline when brackets are balanced', () => {
    const blocks = findBlocks(SOURCE);
    expect(blocks.at(-1).text.trim()).toBe('activate(tunnel)');
  });

  it('handles template literals, regexes, and block comments', () => {
    const source = [
      'const a = { draw() { const s = `x ${ { y: 1 } } z`; } };',
      'const r = /}\\/;{/g;',
      '/* } ; } */',
      'activate(a)',
    ].join('\n');
    const blocks = findBlocks(source);
    expect(blocks).toHaveLength(3);
    expect(blocks[0].text).toContain('${ { y: 1 } }');
    expect(blocks.at(-1).text.trim()).toBe('activate(a)');
  });

  it('recognizes a constructed class instance as a strategy declaration', () => {
    expect(describeBlock('const plasma = new class Plasma { draw() {} }();')).toBe(
      'strategy plasma',
    );
    expect(describeBlock('const orbiters = new Orbiters();')).toBe('strategy orbiters');
  });

  it('returns nothing for an empty or comment-only buffer', () => {
    expect(findBlocks('')).toEqual([]);
    expect(findBlocks('// nothing here\n/* or here */')).toEqual([]);
  });
});

describe('explicit evaluation cells', () => {
  const source = `// %% strategy orbiters
class Orbiters {
  draw() {}
}
const orbiters = new Orbiters();

// %% scene show
const show = [orbiters];
activate(show);
`;

  it('groups a class and its instance into one atomic block', () => {
    const blocks = findBlocks(source);
    expect(blocks).toHaveLength(2);
    expect(blocks.map((block) => describeBlock(block.text))).toEqual([
      'strategy orbiters',
      'scene show',
    ]);
    expect(blocks[0].text).toContain('class Orbiters');
    expect(blocks[0].text).toContain('new Orbiters()');
  });

  it('selects the entire cell from either declaration', () => {
    const onClass = blockAt(source, source.indexOf('class Orbiters'));
    const onInstance = blockAt(source, source.indexOf('new Orbiters'));
    expect(onClass.text).toBe(onInstance.text);
  });

  it('moves a library patch installed below a scene ahead of that scene', () => {
    const misplaced = `// project notes

// %% patch wash
const wash = { draw() {} };

// %% scene tunnel
const tunnel = [wash, newPatch];
activate(tunnel);

// %% patch newPatch
const newPatch = { draw() {} };
`;

    const ordered = moveSceneCellsLast(misplaced);
    expect(ordered.startsWith('// %% patch wash')).toBe(true);
    expect(ordered.indexOf('// %% patch wash')).toBeLessThan(ordered.indexOf('// project notes'));
    expect(ordered.indexOf('// %% patch wash')).toBeLessThan(ordered.indexOf('// %% patch newPatch'));
    expect(ordered.indexOf('// %% patch newPatch')).toBeLessThan(ordered.indexOf('// %% scene tunnel'));
    expect(ordered).toContain('// project notes');
  });

  it('puts a hidden preamble inside the first cell even when the scene is already last', () => {
    const prefixed = `// project notes\n\n${source}`;
    const ordered = moveSceneCellsLast(prefixed);

    expect(ordered.startsWith('// %% strategy orbiters\n// project notes')).toBe(true);
    expect(findCells(ordered)[0].start).toBe(0);
  });

  it('leaves a project unchanged when its scene is already last', () => {
    expect(moveSceneCellsLast(source)).toBe(source);
  });

  it('uses a blank cursor line as the exact scene-layer insertion point', () => {
    const scene = `// %% scene show
const show = [
  plasma,

];
activate(show);`;
    const blank = scene.indexOf('\n\n') + 1;

    expect(insertSceneMember(scene, 'show', 'rings', { before: 'plasma', at: blank }))
      .toBe(`// %% scene show
const show = [
  plasma,
  rings,
];
activate(show);`);
  });

  it('inserts before a top-level scene line when the cursor is in its indentation', () => {
    const scene = `// %% scene show
const show = [
  wash,
  plasma,
];
activate(show);`;
    const plasmaLine = scene.indexOf('  plasma,') + 1;

    expect(insertSceneMember(scene, 'show', 'rings', { before: 'plasma', at: plasmaLine }))
      .toBe(`// %% scene show
const show = [
  wash,
  rings,
  plasma,
];
activate(show);`);
  });

  it('inserts before a top-level scene line when the cursor is inside its patch name', () => {
    const scene = `// %% scene show
const show = [
  wash,
  plasma,
];
activate(show);`;
    const plasmaName = scene.indexOf('plasma') + 3;

    expect(insertSceneMember(scene, 'show', 'rings', { at: plasmaName }))
      .toBe(`// %% scene show
const show = [
  wash,
  rings,
  plasma,
];
activate(show);`);
  });

  it('does not split a nested multi-line scene expression at the cursor', () => {
    const scene = `const scene = [
  makeShaderFlow({
    warp: 0.2,
  }),
  plasma,
];`;
    const nestedLine = scene.indexOf('    warp:');

    expect(insertSceneMember(scene, 'scene', 'rings', { before: 'plasma', at: nestedLine }))
      .toBe(`const scene = [
  makeShaderFlow({
    warp: 0.2,
  }),
  rings,
  plasma,
];`);
  });

  it('renames only the marked legacy starter scene', () => {
    const legacy = `// %% patch plasma
const plasma = { draw() {} };

// %% scene tunnel
const tunnel = [plasma];
go(tunnel);
`;
    const renamed = renameLegacyStarterScene(legacy);

    expect(renamed).toContain('// %% scene scene');
    expect(renamed).toContain(`const scene = [
  plasma,
];`);
    expect(renamed).toContain('activate(scene);');
    expect(renamed).not.toContain('tunnel');
  });

  it('does not rename a deliberately different project', () => {
    expect(renameLegacyStarterScene('const tunnel = [plasma];\ngo(tunnel);')).toBe(
      'const tunnel = [plasma];\ngo(tunnel);',
    );
  });
});

describe('upgradeLegacyActivation', () => {
  it('upgrades executable calls but leaves strings and comments untouched', () => {
    const source = `// go(scene) is the retired spelling
const note = "go(scene)";
controller.go(scene);
go(scene);`;

    expect(upgradeLegacyActivation(source)).toBe(`// go(scene) is the retired spelling
const note = "go(scene)";
controller.go(scene);
activate(scene);`);
  });
});

describe('insertSceneMember', () => {
  it('preserves a commented-out patch and adds a separate active line', () => {
    const source = `// %% scene scene
const scene = [
  // plasma,
];
activate(scene);`;

    expect(insertSceneMember(source, 'scene', 'rings', { before: 'plasma' })).toBe(`// %% scene scene
const scene = [
  // plasma,
  rings,
];
activate(scene);`);
  });

  it('inserts before an active post-processing patch without rewriting comments', () => {
    const source = `const scene = [
  wash, // keep this note
  plasma,
];`;

    expect(insertSceneMember(source, 'scene', 'rings', { before: 'plasma' })).toBe(`const scene = [
  wash, // keep this note
  rings,
  plasma,
];`);
  });

  it('keeps compact scene arrays compact', () => {
    expect(insertSceneMember('const scene = [plasma];', 'scene', 'rings', { before: 'plasma' }))
      .toBe('const scene = [rings, plasma];');
    expect(insertSceneMember('const scene = [wash];', 'scene', 'rings', { before: 'plasma' }))
      .toBe('const scene = [wash, rings];');
  });
});

describe('sceneMemberNames', () => {
  it('reads named leaves recursively without treating inline expressions as patches', () => {
    const source = `const scene = [
      background,
      [asciiNoise, [plasma]],
      ({ time }) => circle(time, 20, 10),
      makeGroup(),
      vignette,
    ];`;
    expect(sceneMemberNames(source, 'scene')).toEqual([
      'background',
      'asciiNoise',
      'plasma',
      'vignette',
    ]);
  });
});

describe('blockAt', () => {
  it('finds the block containing the cursor', () => {
    const cursor = SOURCE.indexOf('rect(0, 0');
    expect(describeBlock(blockAt(SOURCE, cursor).text)).toBe('strategy wash');
  });

  it('finds the block when the cursor sits on its closing line', () => {
    const cursor = SOURCE.indexOf('text(label');
    expect(describeBlock(blockAt(SOURCE, cursor).text)).toBe('strategy rings');
  });

  it('falls back to the last block past the end of the buffer', () => {
    expect(describeBlock(blockAt(SOURCE, SOURCE.length).text)).toBe('activate tunnel');
  });

  it('returns null when there is nothing to evaluate', () => {
    expect(blockAt('   \n  ', 2)).toBe(null);
  });
});
