// Projection view for the audience window.
//
// The performer keeps the editor,
// the controls, error messages, and file names. The audience gets the canvas, and
// optionally a deliberate overlay that clarifies the performer's agency.
//
// Editor errors, file paths, transport
// controls, and private notes never appear here. Nothing in this module reads the
// diagnostics bus, and that is on purpose — there is no path from a stack trace to
// the projector.
//
// The popup
// gets its own 2D canvas and each frame is copied across with drawImage, rather than
// moving the p5 canvas into the other window. Moving it works until the popup is
// closed, at which point the running sketch loses its drawing surface mid-set. A copy
// costs well under a millisecond at 1280x720 and leaves the performer's stage intact,
// so both windows show the work.

const LAYOUTS = ['canvas', 'code', 'trace'];

const POPUP_STYLES = `
  :root { color-scheme: dark; --code-font-size: 15px; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden;
               font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: #e8e8ee; }
  #wrap { position: relative; width: 100vw; height: 100vh; }
  canvas { display: block; width: 100%; height: 100%; }
  #overlay { position: absolute; inset: auto 0 0 0; padding: 20px 26px;
             background: linear-gradient(to top, rgba(0,0,0,0.82), rgba(0,0,0,0)); }
  #overlay[hidden] { display: none; }
  pre { margin: 0; white-space: pre-wrap; font-size: var(--code-font-size); line-height: 1.45;
        text-shadow: 0 1px 3px rgba(0,0,0,0.9); max-height: 40vh; overflow: hidden; }
  .trace-row { display: flex; gap: 12px; align-items: baseline; padding: 1px 0; }
  .trace-index { color: #7c7c8a; min-width: 1.4em; }
  .trace-name { color: #7aa2f7; min-width: 9em; }
  .trace-map { color: #b9b9c6; }
  .trace-title { color: #7c7c8a; letter-spacing: 0.14em; text-transform: uppercase;
                 font-size: 11px; margin-bottom: 8px; }
  #hint { position: absolute; top: 12px; right: 16px; color: #55555f; font-size: 11px; }
`;

export function createProjection({ controller, onBlocked, onOpened }) {
  let win = null;
  let target = null; // the popup's 2D canvas
  let ctx = null;
  let overlay = null;
  let layout = 'canvas';
  let activeCode = '';
  let codeFontSize = 15;
  let unsubscribe = null;

  const isOpen = () => win !== null && !win.closed;

  /** Must be called from a user gesture, or the popup is blocked. */
  function open() {
    if (isOpen()) {
      win.focus();
      return true;
    }
    win = window.open('', 'p5js-live-projection', 'width=1280,height=720');
    if (!win) {
      onBlocked?.();
      win = null;
      return false;
    }

    win.document.title = 'p5js live — projection';
    win.document.head.innerHTML = `<style>${POPUP_STYLES}</style>`;
    win.document.documentElement.style.setProperty('--code-font-size', `${codeFontSize}px`);
    win.document.body.innerHTML = `
      <div id="wrap">
        <canvas id="projection-canvas"></canvas>
        <div id="hint">esc / cmd+w to close</div>
        <div id="overlay" hidden></div>
      </div>`;

    target = win.document.getElementById('projection-canvas');
    ctx = target.getContext('2d');
    overlay = win.document.getElementById('overlay');

    win.addEventListener('resize', resizeTarget);
    win.addEventListener('unload', handleClosed);
    win.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') win.close();
      // Cycle layouts from the projection window itself, so the performer can change
      // what the audience sees without going back to the laptop.
      if (event.key === 'Tab') {
        event.preventDefault();
        setLayout(LAYOUTS[(LAYOUTS.indexOf(layout) + 1) % LAYOUTS.length]);
      }
    });

    resizeTarget();
    unsubscribe = controller.subscribe(renderOverlay);
    renderOverlay();
    onOpened?.();
    return true;
  }

  function handleClosed() {
    unsubscribe?.();
    unsubscribe = null;
    win = null;
    target = null;
    ctx = null;
    overlay = null;
  }

  function close() {
    if (isOpen()) win.close();
    handleClosed();
  }

  function resizeTarget() {
    if (!isOpen() || !target) return;
    target.width = win.innerWidth;
    target.height = win.innerHeight;
  }

  /**
   * Copy the current frame across, letterboxed so the audience never sees a stretched
   * composition when the projector's aspect ratio differs from the laptop's.
   */
  function render(sourceCanvas) {
    if (!isOpen() || !ctx || !sourceCanvas) return;
    const { width: tw, height: th } = target;
    if (tw === 0 || th === 0) return;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, tw, th);

    const scale = Math.min(tw / sourceCanvas.width, th / sourceCanvas.height);
    const w = sourceCanvas.width * scale;
    const h = sourceCanvas.height * scale;
    ctx.drawImage(sourceCanvas, (tw - w) / 2, (th - h) / 2, w, h);
  }

  // --- overlays -------------------------------------------------------------------

  function setLayout(next) {
    if (!LAYOUTS.includes(next)) return layout;
    layout = next;
    renderOverlay();
    return layout;
  }

  function setActiveCode(source) {
    activeCode = source ?? '';
    if (layout === 'code') renderOverlay();
  }

  function setCodeFontSize(next) {
    const value = Math.min(24, Math.max(12, Math.round(Number(next) || 15)));
    codeFontSize = value;
    if (isOpen()) win.document.documentElement.style.setProperty('--code-font-size', `${value}px`);
    return value;
  }

  function renderOverlay() {
    if (!isOpen() || !overlay) return;

    if (layout === 'canvas') {
      overlay.hidden = true;
      overlay.replaceChildren();
      return;
    }
    overlay.hidden = false;

    if (layout === 'code') {
      // The most recently evaluated block, and nothing else. Not the buffer,
      // not the file name, not the error.
      const pre = win.document.createElement('pre');
      pre.textContent = activeCode.trim();
      overlay.replaceChildren(pre);
      return;
    }

    // Strategy names, layer order, and audio-to-behavior mappings.
    const snapshot = controller.snapshot();
    const title = win.document.createElement('div');
    title.className = 'trace-title';
    title.textContent = `scene: ${snapshot.scene.name ?? '—'}`;

    const records = new Map(snapshot.strategies.map((record) => [record.name, record]));
    const rows = snapshot.scene.order.map((instance, index) => {
      const record = records.get(instance.strategy);
      const row = win.document.createElement('div');
      row.className = 'trace-row';

      const idx = win.document.createElement('span');
      idx.className = 'trace-index';
      idx.textContent = `${index + 1}`;

      const label = win.document.createElement('span');
      label.className = 'trace-name';
      label.textContent = `${instance.id} v${record?.version ?? 0}`;

      const map = win.document.createElement('span');
      map.className = 'trace-map';
      map.textContent = audioMappings(record?.source ?? '').join(' · ') || 'no audio mapping';

      row.append(idx, label, map);
      return row;
    });

    overlay.replaceChildren(title, ...rows);
  }

  /**
   * Which audio features a strategy actually reads, recovered from its source.
   *
   * This is what makes the trace layout worth projecting: it shows the audience the
   * connection between what they are hearing and what they are seeing, which is the
   * thing that is otherwise invisible about this kind of performance.
   */
  function audioMappings(source) {
    const found = new Set();
    for (const match of source.matchAll(/\baudio\s*\.\s*(\w+)/g)) {
      if (match[1] === 'raw') continue;
      found.add(match[1]);
    }
    for (const match of source.matchAll(/\baudio\s*\.\s*raw\s*\.\s*(\w+)/g)) {
      found.add(`raw.${match[1]}`);
    }
    return [...found];
  }

  return {
    open,
    close,
    isOpen,
    render,
    setLayout,
    setActiveCode,
    setCodeFontSize,
  };
}
