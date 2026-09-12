// Design tokens for the Push 3 screen (960×160, BGR565). Everything the display renderer
// draws with — colours, type, strokes, grid — lives here so the look can be tuned in one
// place and compared on the hardware with the style sheet (renderStyleSheet).
//
// Panel facts that shape these choices (see docs/PUSH3-DISPLAY-STYLE.md):
// - 16-bit colour: dark tints band and drift (dark amber reads olive). Use pure black,
//   near-white ink, and saturated colour only for thin strokes and text, never as large
//   dark fills.
// - 160 px tall: hairlines at 1 px read as crisp rules; 2 px strokes read as "lines";
//   anything 3 px+ reads heavy. Text under 11 px loses counters.
// - A proportional sans reads lighter than mono at the same size; the page already ships
//   Work Sans (400–500) and Space Grotesk (500–700), so the canvas can use them.

// Eric's palette (2026-09-11): lime, yellow, mint, steel blue, indigo, blue, purple, red, white.
export const PALETTE = Object.freeze({
  lime: '#AEFC53', yellow: '#F0E25F', mint: '#5FCF93', steelBlue: '#3273A5',
  indigo: '#5863DC', blue: '#2E6CC9', purple: '#A459EC', red: '#E13B3E', white: '#FFFFFF',
});

export const COLORS = Object.freeze({
  bg: '#000000',
  ink: PALETTE.white,    // the touched value, markers
  text: '#d9dddd',       // secondary text
  dim: '#a6adad',        // captions, labels
  faint: '#262a2c',      // rules, empty arcs
  hair: '#1b1f21',       // separators
  amber: PALETTE.purple, // modulations, tempo (token name kept for the renderer)
  teal: PALETTE.lime,    // identity marks in the browser; on screen the scene accent is used
  danger: PALETTE.red,
  // Scene accents by pad position, in the same order as the pad/LED palette
  // (push3Map PERFORMANCE_HUES). Yellow last; purple is reserved for modulation.
  columns: Object.freeze([PALETTE.lime, PALETTE.mint, PALETTE.steelBlue, PALETTE.indigo, PALETTE.blue, PALETTE.red, PALETTE.white, PALETTE.yellow]),
});

export const FONTS = Object.freeze({
  sans: '"Work Sans", "Helvetica Neue", Arial, sans-serif',
  display: '"Space Grotesk", "Work Sans", sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, Menlo, monospace',
});

// Type scale: [size px, weight]. Names describe the role, not the size.
export const TYPE = Object.freeze({
  tab: [13, 500],
  caption: [11, 400],
  info: [13, 500],
  infoSmall: [11, 400],
  value: [28, 400],
  valueSmall: [22, 400],
  title: [30, 500],
  strip: [13, 500],
});

// Lift applied only to frames sent to the Push (not the browser): the panel flattens
// mid-tones and desaturates. Tune on the hardware with the style sheet:
// p5jsLive.push3Display.setPanelProfile({ gamma: 0.8, saturation: 1.25 }).
export const PANEL = Object.freeze({ gamma: 0.8, saturation: 1.25 });

export const STROKES = Object.freeze({ rule: 1, arc: 2, arcTrack: 2, wave: 2, waveBig: 2.5 });

export const GRID = Object.freeze({ width: 960, height: 160, column: 120, columns: 8, topStrip: 18, infoLine: 40, bottomStrip: 18 });

export function font(role, family = FONTS.sans) {
  const [size, weight] = TYPE[role];
  return `${weight} ${size}px ${family}`;
}

// Reverse highlight: a filled block in `color` with black text — the Push idiom for
// "selected" (Live's active device tab). Use for one thing at a time.
export function reverseTab(ctx, x, y, w, h, color, text, fontSpec) {
  ctx.fillStyle = color; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#000000'; ctx.font = fontSpec;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 6, y + h / 2 + 0.5);
  ctx.textBaseline = 'alphabetic';
}
