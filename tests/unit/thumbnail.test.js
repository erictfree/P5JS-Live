import { describe, expect, it, vi } from 'vitest';
import { THUMBNAIL_SIZE, captureSquare, squareCrop } from '../../src/performance/thumbnail.js';

function fakeCanvas() {
  const ctx = { fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '' };
  return { width: 0, height: 0, getContext: () => ctx, toDataURL: vi.fn(() => 'data:image/jpeg;base64,xyz'), ctx };
}

describe('thumbnails', () => {
  it('crops the centre square of any aspect ratio', () => {
    expect(squareCrop(1920, 1080)).toEqual({ sx: 420, sy: 0, size: 1080 });
    expect(squareCrop(600, 800)).toEqual({ sx: 0, sy: 100, size: 600 });
    expect(squareCrop(500, 500)).toEqual({ sx: 0, sy: 0, size: 500 });
  });

  it('draws the crop into a small square canvas and returns a data URL', () => {
    const canvas = fakeCanvas();
    const url = captureSquare({ width: 1920, height: 1080 }, { createCanvas: () => canvas });
    expect(url).toBe('data:image/jpeg;base64,xyz');
    expect(canvas.width).toBe(THUMBNAIL_SIZE);
    expect(canvas.ctx.drawImage).toHaveBeenCalledWith({ width: 1920, height: 1080 }, 420, 0, 1080, 1080, 0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.72);
  });

  it('returns null for an empty source', () => {
    expect(captureSquare({ width: 0, height: 0 }, { createCanvas: fakeCanvas })).toBeNull();
    expect(captureSquare(null, { createCanvas: fakeCanvas })).toBeNull();
  });
});
