import { describe, expect, it } from 'vitest';
import { changedLineNumbers } from '../../src/ui/sourceDiff.js';

describe('changedLineNumbers', () => {
  it('marks replacements and insertions in the proposed source', () => {
    expect([...changedLineNumbers('one\ntwo\nfour', 'one\nTWO\nthree\nfour')]).toEqual([1, 2]);
  });

  it('marks the nearest surviving line for a deletion', () => {
    expect([...changedLineNumbers('one\ntwo\nthree', 'one\nthree')]).toEqual([1]);
  });

  it('returns no lines when source is unchanged', () => {
    expect([...changedLineNumbers('same', 'same')]).toEqual([]);
  });
});
