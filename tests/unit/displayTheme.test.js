import { describe, expect, it } from 'vitest';
import { COLORS, TYPE, font, reverseTab } from '../../src/performance/displayTheme.js';

describe('display theme tokens', () => {
  it('builds canvas font strings from the type scale', () => {
    expect(font('value')).toBe('400 28px "Work Sans", "Helvetica Neue", Arial, sans-serif');
    expect(font('tab', 'monospace')).toBe('500 13px monospace');
    expect(Object.keys(TYPE)).toContain('caption');
  });

  it('keeps eight column colours in LED palette order and a black background', () => {
    expect(COLORS.columns).toHaveLength(8);
    expect(COLORS.bg).toBe('#000000');
  });

  it('draws a reverse tab as a filled block with black text', () => {
    const calls = [];
    const ctx = { fillRect: (...a) => calls.push(['rect', ...a]), fillText: (...a) => calls.push(['text', ...a]), set fillStyle(v) { calls.push(['fill', v]); } };
    reverseTab(ctx, 10, 20, 100, 16, '#ff0000', 'sel', '500 13px x');
    expect(calls).toEqual([['fill', '#ff0000'], ['rect', 10, 20, 100, 16], ['fill', '#000000'], ['text', 'sel', 16, 28.5]]);
  });
});
