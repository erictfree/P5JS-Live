import { describe, it, expect, vi } from 'vitest';
import { createCodeViewFactory } from '../../src/visuals/codeView.js';
import { createTestHost } from './helpers.js';

function fixture() {
  const context = () => ({
    scale: vi.fn(), fillText: vi.fn(), drawImage: vi.fn(), measureText: text => ({ width: text.length * 8 }),
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), fillRect: vi.fn(),
    setTransform: vi.fn(), clearRect: vi.fn(),
  });
  const images = [];
  const createCanvas = vi.fn(() => {
    const ctx = context();
    const image = { width: 0, height: 0, getContext: () => ctx, ctx };
    images.push(image);
    return image;
  });
  const view = { fontSize: 16, fontFamily: 'monospace', lineHeight: 22,
    colors: { text: '#fff', keyword: '#a783ff' },
    lines: [{ x: 24, y: 24, tokens: [{kind:'keyword',text:'const'}, {kind:'text',text:'\tx = 1;'}] }],
    cursor: { x: 24, y: 24, prefix: 'const\tx' },
  };
  const readView = vi.fn(() => view);
  const codeView = createCodeViewFactory({ readView, createCanvas });
  const canvas = { width: 640, height: 480, drawingContext: context() };
  return { images, view, codeView, canvas, readView, createCanvas };
}

describe('code as an image', () => {
  it('caches glyphs across frames, repaints live text and resize, and expands tabs across tokens', () => {
    const f = fixture(), patch = f.codeView();
    patch.draw({canvas:f.canvas}); patch.draw({canvas:f.canvas});
    expect(f.createCanvas).toHaveBeenCalledTimes(1);
    expect(f.images[0].ctx.fillText).toHaveBeenCalledTimes(2);
    expect(f.images[0].ctx.fillText.mock.calls[1]).toEqual([' x = 1;', 64, 35]);
    expect(f.images[0].ctx.fillRect).not.toHaveBeenCalled(); // no opaque text backing
    expect(f.canvas.drawingContext.drawImage).toHaveBeenCalledTimes(2);
    f.view.lines[0].tokens[1].text = ' y = 2;'; patch.draw({canvas:f.canvas});
    expect(f.images[0].ctx.fillText).toHaveBeenCalledTimes(4);
    f.canvas.width = 800; patch.draw({canvas:f.canvas});
    expect(f.images[0].width).toBe(800);
    expect(f.images[0].ctx.fillText).toHaveBeenCalledTimes(6);
  });

  it('keeps optional cursor blinking out of the glyph cache and releases/recreates resources', () => {
    const f = fixture(), patch = f.codeView({cursor:true});
    patch.draw({canvas:f.canvas,time:0.1}); patch.draw({canvas:f.canvas,time:0.7});
    expect(f.canvas.drawingContext.fillRect).toHaveBeenCalledTimes(1);
    expect(f.images[0].ctx.fillText).toHaveBeenCalledTimes(2);
    patch.dispose(); expect(f.images[0].width).toBe(0); expect(f.images[0].height).toBe(0);
    patch.draw({canvas:f.canvas}); expect(f.createCanvas).toHaveBeenCalledTimes(2);
  });

  it('validates options during evaluation and tracks applied, not queued or rejected, source', () => {
    const h = createTestHost();
    const good = 'const letters = codeView({ patch: "myPatch", fontSize: 24 });';
    expect(h.evaluator.evaluate(good).ok).toBe(true);
    expect(h.evaluator.lastRunSource()).toBe('');
    h.frame(); expect(h.evaluator.lastRunSource()).toBe(good);
    for (const options of ['null', '{source:"bad"}', '{source:"editor",patch:"myPatch"}', '{fontSize:NaN}', '{fontSize:0}', '{cursor:1}', '{patch:"a()"}', '{typo:true}']) {
      expect(h.evaluator.evaluate(`const letters = codeView(${options});`).ok).toBe(false);
    }
    expect(h.evaluator.lastRunSource()).toBe(good);
    h.evaluator.evaluate('const discarded = 1;'); h.evaluator.discardPending(); h.frame();
    expect(h.evaluator.lastRunSource()).toBe(good);
    h.evaluator.clearBindings(); expect(h.evaluator.lastRunSource()).toBe('');
  });
});
