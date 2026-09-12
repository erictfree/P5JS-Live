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

## Panel profile

The canvas draws the exact palette hex values; the frame is then packed to 16-bit and the
LCD applies its own gamma, which reads flatter and less saturated than a monitor. A lift
is applied only to frames sent to the Push (`PANEL` in `displayTheme.js`: gamma 0.8,
saturation 1.1; `setPanelProfile` in the display transport). The browser preview never
gets it, so preview and panel are meant to look alike, not identical. Tune from the
console while the style sheet streams:

```js
p5jsLive.push3Display.setPanelProfile({ gamma: 0.75, saturation: 1.35 })
```

The same two values are sliders on the controller dialog's display row (**Panel colour**),
live on the Push and remembered per browser; **Reset** returns to `PANEL`. Record the
values that look right here and copy them into `PANEL` so every browser starts there.

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

The palette is Live's own track palette, the colours on Ableton's Push 3 screens
(adopted 2026-09-11 from screenshots: one vivid accent per screen on black, off-white
values, mid-grey labels, track tabs in their own colours). `PALETTE` in `displayTheme.js`:

| Name | Hex | Role |
| --- | --- | --- |
| Lime | `#BFFB00` | scene accent, pad 1; default accent with no scene; current marks in the browser |
| Purple | `#D86CE4` | scene accent, pad 2 |
| Mint | `#25FFA8` | scene accent, pad 3 |
| Cyan | `#10A4EE` | scene accent, pad 4 |
| Blue | `#5480E4` | scene accent, pad 5 |
| Red | `#FF3636` | scene accent, pad 6; **danger** |
| White | `#FFFFFF` | scene accent, pad 7; the touched value, markers, the beat dot |
| Yellow | `#FFF034` | scene accent, pad 8 — used last |
| Orange | `#FFA529` | **tempo**: the BPM readout; fallback modulation colour |
| Modulation colours | by slot | each modulation takes the palette colour of its slot (lime for slot 1, purple for 2 …): its lower button LED when running, its bottom-strip tab, the marker on the arc it drives, its edit screen, and its row and scope in the browser |
| Text `#F0F0F0`, label `#8C8C8C`, rule `#3A3A3A`, hair `#1E1E1E` | | text, captions, empty arcs and rules, separators |

Pad and upper-button LEDs use the nearest measured Push palette entries in the same
order (`PERFORMANCE_HUES` in `push3Adapter.js`).

- **Black** `#000000` background, always.
- **Values take the accent**, the way Live sets a device's numbers in the track colour;
  the touched column's value flips to white. **dim** `#a6adad` is for captions and
  labels; **faint** `#262a2c` only for empty arcs and rules; **hair** `#1b1f21` for
  separators. Grey means inactive, never a live value.
- **One accent per screen.** The running scene's pad colour (the same eight-hue order
  the pads use) colours the tabs, arcs, the scene name and the touched column's value,
  and lights every assigned upper-button LED — Live's selected-track idiom. With no scene
  running the accent is teal on screen and white on the buttons. The eight hues are not
  spread across the columns; that read as a rainbow rather than a state.
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

## Decisions from the hardware (2026-09-11)

- **Type: Work Sans** for everything, values at 400. Judged against Space Grotesk, Plex
  Mono and the system mono on the style sheet; Work Sans read best at distance.
- **Colour: one step more saturated** than the first pass. The panel desaturates a little,
  so hues that look slightly strong on a monitor land right on the Push. The current
  set is in `displayTheme.js`.
- Everything on the sheet was readable, including 1 px rules.

- **Reverse video marks the column whose encoder moved last** (top strip, fades after
  2.5 s) and, in edit mode, the modulation being edited (title tab and bottom strip).
  Nothing else uses it.

## Open questions

1. Blue vs. periwinkle and teal vs. mint: keep an eye on whether they stay distinct once
   real scenes fill all eight columns.

Record answers here and adjust `displayTheme.js`; the renderer reads the tokens.
