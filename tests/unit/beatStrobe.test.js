import { expect, it, vi } from 'vitest';
import { LIBRARY } from '../../starter/library.js';

function setup() {
  const rect = vi.fn(), fill = vi.fn();
  const names = ['colorMode', 'blendMode', 'rectMode', 'noStroke', 'fill', 'rect', 'RGB', 'BLEND', 'CORNER', 'width', 'height'];
  const patch = new Function(...names, LIBRARY.find(p => p.name === 'beatStrobe').source + '\nreturn beatStrobe;')(
    vi.fn(), vi.fn(), vi.fn(), vi.fn(), fill, rect, 'RGB', 'BLEND', 'CORNER', 640, 480,
  );
  const state = {};
  const draw = (time, running, tick = false, onset = false) => patch.draw({ time, clock: { running, tick }, audio: { onset }, state });
  return { patch, draw, rect, fill };
}
it('follows the clock and ignores off-beat audio hits while tempo is running', () => {
  const h = setup(); h.draw(0, true, false, true); expect(h.rect).not.toHaveBeenCalled();
  h.draw(1, true, true); expect(h.rect).toHaveBeenCalledWith(0, 0, 640, 480);
  expect(h.fill).toHaveBeenCalledWith(255, 255, 255, 102);
  h.rect.mockClear(); h.draw(1.04, true); expect(h.rect).toHaveBeenCalledOnce();
  h.draw(1.07, true, false, true); expect(h.rect).toHaveBeenCalledOnce();
});
it('uses detected hits without a clock, with no flashes in silence', () => {
  const h = setup(); h.draw(0, false); expect(h.rect).not.toHaveBeenCalled();
  h.draw(1, false, false, true); h.draw(1.03, false); h.draw(1.08, false);
  expect(h.rect).toHaveBeenCalledTimes(2);
});
it('falls back after clock loss and bounds opacity', () => {
  const h = setup(); h.patch.opacity = 3; h.draw(0, true, true);
  h.draw(2, false, false, true); expect(h.rect).toHaveBeenCalledTimes(2);
  expect(h.fill).toHaveBeenLastCalledWith(255, 255, 255, 255);
});
