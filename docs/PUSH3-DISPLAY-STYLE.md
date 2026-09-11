# Push 3 display style guide

A working study of how the 960 × 160 Push 3 screen should look for p5js.live, and the
rules the renderer follows. Tokens live in `src/performance/displayTheme.js`; the
renderer is `src/performance/surfaceDisplay.js`. To judge anything here, look at the
real panel: **Tools → Performance → Open controller → Show style sheet** streams a
specimen screen (type families and sizes, every colour as text, stroke and reverse-video
samples) to the Push. The browser preview is a useful sketch but the panel is the truth.

## What the panel does to pixels

- **Colour depth is 16-bit (BGR565).** Dark tints band and shift hue: a dark amber fill
  rendered olive; dark blues go grey. Rule: pure black background, colour only in thin
  strokes, small fills and text. Never a large dark tinted area.
- **Contrast is high, gamma is steep.** Mid greys drop faster than on a monitor, so the
  "dim" label grey is `#9a9f9f`, lighter than a monitor design would choose. Anything
  below about `#3a3f41` is effectively black.
- **160 px is short.** A 1 px rule reads as a hairline, 2 px reads as a line, 3 px and
  up reads heavy. Text under 11 px loses its counters; 13 px is the comfortable minimum
  for labels, 22–30 px for values.
- **Bright saturated colour glows.** Neon green and magenta bleed into neighbours; the
  column set is deliberately a step softer than the LED palette while keeping the same
  hue order so screen and buttons still match.

## Type

| Role | Face | Size / weight | Used for |
| --- | --- | --- | --- |
| value | Work Sans | 28 / 400 | control values, the big number in a column |
| title | Space Grotesk | 30 / 500 | performance name in the jog browser |
| tab | Work Sans | 13 / 500 | top and bottom strip labels |
| info | Work Sans | 13 / 500 | BPM, performance and scene names |
| caption | Work Sans | 11 / 400 | ranges, modulation glyph and rate |

Why a proportional sans: at the same pixel size it reads lighter and wider than mono,
and numbers set in 400 weight look like Live's readouts rather than a terminal. Mono
(IBM Plex Mono 500) is kept for code-like strings only, such as a modulation's identifier
in the strip, and even there Work Sans is acceptable. The system monospace is what the
first screens used and is the thing that read "clunky"; do not fall back to it.

## Colour

- **Black** `#000000` background, always.
- **Ink** `#ffffff` for values; **text** `#d9dddd` for secondary text; **dim** `#9a9f9f`
  for captions; **faint** `#262a2c` only for empty arcs and rules; **hair** `#1b1f21` for
  separators.
- **Column hues** (blue, purple, pink, teal, lime, amber, periwinkle, mint) identify the
  eight encoder columns. The same order lights the upper-button LEDs and the pads.
- **Amber** `#ffbe55` means modulation and tempo: the running-slot underline, the arc's
  live marker, the beat readout.
- **Teal** `#62d7b1` means identity: performance and scene names.
- **Danger** `#ff6f6f` is reserved for failed launches.

Colour carries meaning, so each hue should mean one thing on a given screen. Do not use a
column hue for state, or amber for a column.

## Highlighting

- **Reverse video** (a filled colour block with black text) is the Push idiom for "this
  one is selected", used by Live for the active device tab. Use it for exactly one
  element per screen: the editing modulation's slot in edit mode, the current
  performance in the jog browser. `reverseTab()` in the theme draws it.
- **Underline** (1 px rule in the element's colour) means "present and active":
  assigned column tabs, defined modulation slots.
- **Brightness** distinguishes states of the same thing: running amber vs. defined grey
  in the modulation strip; ink vs. dim between a value and its caption.
- **Motion** is for live signal only: the beat dot, the arc marker riding the modulated
  value, the scope's phase dot. Nothing static should animate.

## Layout grid

Eight 120 px columns aligned to the encoders and to both rows of display buttons.
Top strip 0–18 (upper-button labels), info line to 40, columns 40–140, bottom strip
142–160 (lower-button labels). The jog browser and modulation edit views own the column
band but keep the strips, so the buttons always have labels.

## Open questions to settle on the hardware

1. Is Work Sans 400 at 28 px light enough for values, or does Space Grotesk 500 read
   better at a distance?
2. Are the softened column hues distinct enough from each other on the panel, especially
   blue vs. periwinkle and teal vs. mint?
3. Do 1 px rules survive the panel's scaling, or should tab rules be 2 px?
4. Should the top strip use reverse video for the column whose encoder was last touched?

Record answers here and adjust `displayTheme.js`; the renderer reads the tokens.
