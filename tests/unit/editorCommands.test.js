import { describe, expect, it } from 'vitest';
import { moveLines } from '../../src/ui/editor.js';

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
