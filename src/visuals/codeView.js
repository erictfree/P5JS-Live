// A transparent image of source code. Source/layout is supplied by the editor;
// this patch owns only a disposable raster cache, never editor or project state.
export function createCodeViewFactory({ readView = () => null, createCanvas = () => document.createElement('canvas') } = {}) {
  return function codeView(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('codeView() options must be an object');
    const allowed = new Set(['source', 'patch', 'fontSize', 'cursor']);
    for (const key of Object.keys(options)) if (!allowed.has(key)) throw new TypeError(`Unknown codeView() option "${key}"`);
    if (options.source !== undefined && !['editor', 'lastRun'].includes(options.source)) throw new TypeError('codeView() source must be "editor" or "lastRun"');
    if (options.patch !== undefined && (typeof options.patch !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(options.patch))) throw new TypeError('codeView() patch must be a binding name, such as "myPatch"');
    if (options.patch !== undefined && options.source !== undefined) throw new TypeError('codeView() accepts either patch or source, not both');
    if (options.fontSize !== undefined && (!Number.isFinite(options.fontSize) || options.fontSize < 6 || options.fontSize > 160)) throw new RangeError('codeView() fontSize must be between 6 and 160');
    if (options.cursor !== undefined && typeof options.cursor !== 'boolean') throw new TypeError('codeView() cursor must be true or false');
    const settings = Object.freeze({ source: 'editor', cursor: false, ...options });
    let image = null;
    let signature = '';

    return {
      draw({ canvas, time = 0 }) {
        const view = readView(settings);
        if (!view) return;
        const target = canvas?.drawingContext;
        if (!target || typeof target.drawImage !== 'function') throw new Error('codeView() needs the scene’s 2D drawing surface');
        const width = canvas.width, height = canvas.height;
        const { cursor, ...content } = view;
        const next = JSON.stringify([width, height, content]);
        if (!image) image = createCanvas();
        if (signature !== next) {
          if (image.width !== width || image.height !== height) { image.width = width; image.height = height; }
          const ctx = image.getContext('2d');
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, width, height);
          const scale = settings.fontSize ? settings.fontSize / view.fontSize : 1;
          ctx.scale(scale, scale);
          ctx.font = `${view.fontSize}px ${view.fontFamily}`;
          ctx.textBaseline = 'middle';
          for (const line of view.lines) {
            ctx.save();
            if (line.clip) { ctx.beginPath(); ctx.rect(...line.clip); ctx.clip(); }
            let x = line.x, column = 0;
            for (const token of line.tokens) {
              const run = expandTabs(token.text, column);
              column = run.column;
              ctx.fillStyle = view.colors[token.kind] ?? view.colors.text;
              ctx.fillText(run.text, x, line.y + view.lineHeight / 2);
              x += ctx.measureText(run.text).width;
            }
            ctx.restore();
          }
          signature = next;
        }
        target.drawImage(image, 0, 0, width, height);
        if (settings.cursor && cursor && time % 1 < 0.55) {
          const scale = settings.fontSize ? settings.fontSize / view.fontSize : 1;
          target.save();
          target.scale(scale, scale);
          target.font = `${view.fontSize}px ${view.fontFamily}`;
          target.fillStyle = view.colors.text;
          if (cursor.clip) { target.beginPath(); target.rect(...cursor.clip); target.clip(); }
          const x = cursor.x + target.measureText(expandTabs(cursor.prefix).text).width;
          target.fillRect(x, cursor.y, 1.5, view.lineHeight);
          target.restore();
        }
      },
      dispose() {
        if (image) { image.width = 0; image.height = 0; image = null; }
        signature = '';
      },
    };
  };
}

function expandTabs(text, column = 0) {
  let expanded = '';
  for (const char of text) {
    const run = char === '\t' ? ' '.repeat(2 - column % 2) : char;
    expanded += run;
    column += run.length;
  }
  return { text: expanded, column };
}
