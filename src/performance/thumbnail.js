// Square thumbnails for performances: a centre crop of the stage, or of an uploaded
// image, scaled to a small JPEG data URL that fits comfortably in localStorage.

export const THUMBNAIL_SIZE = 128;

export function squareCrop(width, height) {
  const size = Math.min(width, height);
  return { sx: (width - size) / 2, sy: (height - size) / 2, size };
}

// `source` is anything drawImage accepts (canvas, image, bitmap) with width/height.
export function captureSquare(source, {
  size = THUMBNAIL_SIZE,
  createCanvas = () => globalThis.document.createElement('canvas'),
  type = 'image/jpeg',
  quality = 0.72,
} = {}) {
  const width = source?.width ?? source?.videoWidth ?? 0;
  const height = source?.height ?? source?.videoHeight ?? 0;
  if (!(width > 0 && height > 0)) return null;
  const { sx, sy, size: side } = squareCrop(width, height);
  const canvas = createCanvas();
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
  ctx.drawImage(source, sx, sy, side, side, 0, 0, size, size);
  return canvas.toDataURL(type, quality);
}

export async function thumbnailFromFile(file, options = {}) {
  const bitmap = await globalThis.createImageBitmap(file);
  try { return captureSquare(bitmap, options); }
  finally { bitmap.close?.(); }
}
