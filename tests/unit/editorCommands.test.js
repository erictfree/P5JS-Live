import { describe, expect, it } from 'vitest';
import { moveLines, toggleArrayWrap } from '../../src/ui/editor.js';

describe('editor line movement', () => {
  it('moves the current line up and down while preserving its selection', () => {
    const source = 'one\ntwo\nthree';
    const up = moveLines(source, 5, 5, -1);
    expect(up).toEqual({ source: 'two\none\nthree', selectionStart: 1, selectionEnd: 1 });

    const down = moveLines(source, 5, 5, 1);
    expect(down).toEqual({ source: 'one\nthree\ntwo', selectionStart: 11, selectionEnd: 11 });
  });

  it('moves selected adjacent lines as one unit and stops at boundaries', () => {
    const source = 'zero\none\ntwo\nthree';
    const moved = moveLines(source, 5, 12, 1);
    expect(moved.source).toBe('zero\nthree\none\ntwo');
    expect(moved.selectionStart).toBe(11);
    expect(moved.selectionEnd).toBe(18);
    expect(moveLines(source, 0, 0, -1)).toBe(null);
    expect(moveLines(source, source.length, source.length, 1)).toBe(null);
  });
});

describe('editor array wrapping', () => {
  it('wraps the identifier at the caret and toggles it back off', () => {
    const source = 'const scene = [myPatch, glow];';
    const at = source.indexOf('myPatch') + 2;
    const wrapped = toggleArrayWrap(source, at, at);
    expect(wrapped).toEqual({
      source: 'const scene = [[myPatch], glow];',
      selectionStart: source.indexOf('myPatch') + 1,
      selectionEnd: source.indexOf('myPatch') + 1 + 'myPatch'.length,
    });
    expect(toggleArrayWrap(
      wrapped.source,
      wrapped.selectionStart,
      wrapped.selectionEnd,
    )).toEqual({
      source,
      selectionStart: source.indexOf('myPatch'),
      selectionEnd: source.indexOf('myPatch') + 'myPatch'.length,
    });
  });

  it('wraps a selected expression while leaving surrounding whitespace alone', () => {
    const source = '  myPatch.rotate(0.2),';
    const wrapped = toggleArrayWrap(source, 0, source.length - 1);
    expect(wrapped.source).toBe('  [myPatch.rotate(0.2)],');
    expect(wrapped.source.slice(wrapped.selectionStart, wrapped.selectionEnd))
      .toBe('myPatch.rotate(0.2)');
  });
});
