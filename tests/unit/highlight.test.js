// The mirror's syntax colouring.
//
// It is a scanner, not a parser, and it only decides colours — so what is worth
// testing is the handful of places where a naive scanner paints code as prose or
// prose as code: comments and strings that contain the other's opening marks, and
// tokens that span lines.

import { describe, it, expect } from 'vitest';
import { tokenize, tokenizeLines } from '../../src/ui/highlight.js';

/** The tokens that carry a colour, as "kind:text" — `text` runs are the background. */
const coloured = (source) =>
  tokenize(source)
    .filter((t) => t.kind !== 'text')
    .map((t) => `${t.kind}:${t.text}`);

describe('tokenize', () => {
  it('colours the host vocabulary apart from ordinary calls', () => {
    expect(coloured('const rings = { draw() { circle(1, 2); } };')).toEqual([
      'keyword:const',
      'call:draw',
      'call:circle',
      'number:1',
      'number:2',
    ]);
  });

  it('treats keywords, numbers and strings as themselves', () => {
    expect(coloured('const x = 0.5;')).toEqual(['keyword:const', 'number:0.5']);
    expect(coloured('tunnel.draw()')).toEqual(['call:draw']);
    expect(coloured('reset(rings)')).toEqual(['host:reset']);
  });

  it('does not read code inside a comment', () => {
    expect(coloured('// const x = { draw() {} }; 12')).toEqual([
      'comment:// const x = { draw() {} }; 12',
    ]);
  });

  it('does not read a comment marker inside a string', () => {
    expect(coloured('const s = "// not a comment";')).toEqual([
      'keyword:const',
      'string:"// not a comment"',
    ]);
  });

  it('stops an unterminated string at the line end', () => {
    // Mid-edit this is the common case. Running to the end of the file would paint
    // the rest of the project as a string on the way to typing the closing quote.
    const tokens = coloured('const s = "open\nconst t = 1;');
    expect(tokens).toEqual(['keyword:const', 'string:"open', 'keyword:const', 'number:1']);
  });

  it('reassembles the source exactly', () => {
    const source = 'const a = { draw() {\n  // note\n  fill(255);\n} };\n';
    expect(
      tokenize(source)
        .map((t) => t.text)
        .join(''),
    ).toBe(source);
  });
});

describe('tokenizeLines', () => {
  it('gives one entry per line', () => {
    const source = 'a\nb\n\nc';
    expect(tokenizeLines(source)).toHaveLength(4);
  });

  it('cuts a block comment at each line so no line needs the one before it', () => {
    const lines = tokenizeLines('/* one\n   two */\nreset(x)');
    expect(lines[0]).toEqual([{ kind: 'comment', text: '/* one' }]);
    expect(lines[1]).toEqual([{ kind: 'comment', text: '   two */' }]);
    expect(lines[2][0]).toEqual({ kind: 'host', text: 'reset' });
  });

  it('does the same for a template literal', () => {
    const lines = tokenizeLines('const s = `one\ntwo`;\nconst n = 2;');
    expect(lines[0].at(-1)).toEqual({ kind: 'string', text: '`one' });
    expect(lines[1][0]).toEqual({ kind: 'string', text: 'two`' });
    expect(lines[2]).toContainEqual({ kind: 'number', text: '2' });
  });

  it('reassembles each line exactly', () => {
    const source = 'const a = { draw() {\n  fill(255);\n} };';
    const rebuilt = tokenizeLines(source)
      .map((tokens) => tokens.map((t) => t.text).join(''))
      .join('\n');
    expect(rebuilt).toBe(source);
  });
});
