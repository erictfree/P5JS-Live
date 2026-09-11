# Project handoff

## Snapshot

This document describes `p5js.live` at commit `f2d83ac` on `main` as of
September 10, 2026. The repository is
[`erictfree/P5JS-Live`](https://github.com/erictfree/P5JS-Live), and the product is a
browser-based instrument for live-coding audio-reactive p5.js visuals.

The current direction is a code-first performance tool with an Ableton Live-like
visual rhythm. A performer edits small named patches, combines them in JavaScript
arrays, applies GPU effects directly to those arrays, and selects a scene with
`scene.draw()`. The running canvas, audio analysis, tempo clock, controls, MIDI
routes, and last safe image survive successful live edits.

## Start here

Requirements are a current Node.js installation and desktop Chrome. Chrome is
required for the experimental Push 3 WebUSB display path.

```sh
npm install
npm run dev
```

Open `http://localhost:5173/live/`.

Useful checks:

```sh
npm test -- --run
npm run build
npm run test:e2e
```

The complete unit suite currently has 376 passing tests. The production build emits
the hosted application under `dist/`. Browser tests may require permission to bind a
local port in a restricted development environment.

## Product model

A **patch** is a named JavaScript value that draws or produces a visual source. A
**scene** is an array of patches, functions, and nested arrays. Array order is draw
order. A nested array creates an offscreen compositing boundary, so array effects
apply to the combined result inside that boundary.

```js
const scene = [
  () => background(0),
  [myPatch, rings]
    .rotate(({ time }) => time * 0.2)
    .opacity(({ audio }) => 0.35 + audio.mid * 0.65),
];

scene.draw();
```

`scene.draw()` selects that array for rendering at the next frame boundary. Only one
scene is active at a time; a later `otherScene.draw()` replaces the selection. The
runtime validates malformed, sparse, and cyclic groups before activation. Array
effect methods are installed deliberately and fail at startup if a conflicting
native or third-party Array method already exists.

Patch parameters may be ordinary values or resolver functions receiving the live
context. The important context families are time/clock, normalized audio bands and
hits, controls, and frame/canvas information. Modulation helpers include LFOs,
ramps, steps, range mapping, envelopes, seeded variation, and lag/smoothing. See
[API.md](API.md), [COMPOSITION.md](COMPOSITION.md), [DATA-MODEL.md](DATA-MODEL.md),
and [RHYTHM.md](RHYTHM.md) before changing these semantics.

## Current performer workflow

- The editor and canvas share the live surface. `Cmd/Ctrl+Enter` evaluates the
  current block; failed changes retain the last good image.
- The top transport exposes tap tempo, BPM, play/pause, loop, audio, safe-state
  recovery, editor visibility, Tools, and Help.
- Space taps tempo when focus is outside an editable control. The Tap control flashes
  briefly on each clock beat once tempo exists.
- Tools contains Scene, Library, Controls, Audio, and Performances. Its message view
  uses compact errors rather than full-height cards.
- Audio accepts a file or microphone/line input. Rhythm can be off, manually tapped,
  or automatically estimated; visual audio reactions remain available without a
  tempo lock.
- The performance launcher stores named performances in 64-pad banks. Launches can
  happen immediately or at the next beat. Eight controller assignments support
  relative encoders and absolute pickup.
- A transparent video source can enter the same scene composition path as a patch.
- The starter scene is an intentionally rich audio/beat-reactive visual used to
  exercise composition, shaders, and recovery.

## Vocabulary: performance and scene

Decided 2026-09-11. A **performance** is the whole set a performer brings to a show:
working source, saved scenes, pad layout and encoder assignments, MIDI control
mappings, tempo and audio settings. A **scene** is one saved working window that a pad
or the Performance tab recalls. The **Scene** tab shows the current scene's composition.

The code predates this: `performanceStore` holds *scenes*, `projectStore` holds the
*performance* bundle, and identifiers such as `performance-list`, `performanceLauncher`
and `launcher.slots` refer to scenes. Storage keys are unchanged so nothing saved is
lost. User-facing text uses the new words; rename internals opportunistically.

## Performance library

`src/persistence/performanceLibrary.js` stores named performances in localStorage
(`p5js-live.performance-library.v1`). An entry is `{ id, name, createdAt, updatedAt,
thumbnail, data }` where `data` is exactly a performance file's parsed bundle
(`projectStore.parseProject`): working source, params, MIDI control mappings, rhythm,
safe scene, the scene list, and the launcher layout. One entry can be *current*
(`p5js-live.current-performance.v1`).

Behaviour, in `src/main.js` under "performance library":

- **Save performance** packages the working state, captures a square thumbnail of the
  stage inside the next draw (`captureSquare` in `src/performance/thumbnail.js`, 128 px
  JPEG), saves, and makes it current. Saving under the current name updates instead.
- **Autosave.** Once a performance is current, every path that persists the working
  project (`projectStore.saveSoon`) and every launcher change also updates the entry
  after 1.5 s. Thumbnails are not refreshed by autosave; use **Snapshot** or **Image…**
  (any image file, centre-cropped) on the current row.
- **Load** replaces the working source, settings, the *whole scene list*
  (`performanceStore.replace`) and the launcher layout, then makes it current.
- **New performance** and **Reset to starter** empty the scene list and layout and clear
  the current pointer; the dialog says whether the current performance is saved.
- **Bundle contents.** Besides the project fields, a performance file and library entry
  carry `audio: { analysis, loop, volume }` (analysis smoothing/auto-gain, file loop,
  master volume) and, in files, `name` and `thumbnail`. `parseProject` tolerates and
  drops malformed extras.
- **Export / Import** work on whole performances and sit in the open on the Performance
  tab: **export** writes the current one with its name and thumbnail, each library row
  has its own **Export**, and **Export all** at the bottom writes every entry to one
  library file (`format: p5js-live-performance-library`, each item a complete
  performance object). **import** accepts either kind: a single performance is added to
  the library and loaded after the trusted-code confirmation; a library file is added
  without running anything. **Rename** applies the typed name to the current entry;
  **↑ ↓** reorder the list, which is also the jog-wheel browsing order.
- **The Scene tab is only the running scene's name, the save form and the saved-scene
  list** (click a row to switch to it; the running one is marked). The composition tree,
  reorder arrows, Edit scene and the tutorial recipes were removed on 2026-09-11: the
  code is the composition. The two example buttons moved to the Library tab. The
  Performance tab keeps the Live launcher (Open controller) next to the library. **Reset to starter** is the only thing left
  in the collapsed "Start over" disclosure.
- **Start dialog "Recent".** `renderWelcomeRecent` in `src/main.js` lists the five most
  recently updated performances (thumbnail, scene count; click loads it and the dialog
  stays open for the source choice) and the last five audio files
  (`src/persistence/recentAudio.js`: names in localStorage; in Chrome the file handle
  from the File System Access API is kept in IndexedDB, no bytes). Clicking an audio
  row reopens the file through its handle — at most an Allow prompt — and loads it. A
  file that has moved is reported in the dialog's note line and dropped from Recent.
  Without a handle it falls back to the picker with a note naming the file. The Audio
  file buttons use `showOpenFilePicker` where available so handles get remembered.
- **Jog wheel on Push** browses the library: turn (or the click buttons beside it) to
  highlight, press to load. The screen swaps the encoder row for a browser strip with
  thumbnail, name and position; the browser list highlights the same row. A highlight
  expires after 8 s without input. Thumbnails are for performances only; scenes keep
  their text labels.

## Push 3 status

Real Push 3 display output has been proven on tethered Push 3 hardware. This work is
for Push 3 in controller mode, not Push 3 Standalone.

The tested device identifies as USB vendor `0x2982`, product `0x1969`. Its display is
960×160 BGR565 on interface 0 with bulk OUT endpoint 1. Each transmitted row is
2048 bytes, including padding. The implementation sends the fixed frame header and
applies the required XOR shaping to pixel bytes.

**Auto-connect.** After the Push has been chosen once in Chrome's WebUSB chooser (and
Web MIDI allowed), every later load of the same origin brings it up on its own:
`push3AutoConnect.js` finds the remembered device, claims interface 0, starts the
controller stream on the screen, connects MIDI, and releases everything on page
hide. A "Push 3 ready" message reports what came up. The manual buttons below remain
for the first run and for debugging. Note the origin includes the port, so a dev
server on a new port means one more chooser click.

To test it the first time:

1. Connect Push 3 by USB and use desktop Chrome. Safari has no WebUSB or Web MIDI, and
   the browser pane embedded in the Claude desktop app cannot show Chrome's device
   chooser or permission prompts, so Connect fails there with "not selected" or
   "denied" even when the hardware is fine. Confirm the Mac sees the device with
   `system_profiler SPUSBDataType | grep -A5 Push` before debugging the app.
2. Open **Tools → Performances → Open controller**.
3. Choose **Connect Push display** and select the Push device in Chrome's chooser.
4. Choose **Claim interface 0**.
5. Use **Show startup** for the branded splash or **Show controller** for the live
   960×160 controller preview.
6. Use **Stop** before changing transport behavior, and **Release** when finished.

The splash lives at `assets/brand/startup.bgr565`. It is exactly 307,200 bytes:
960×160 pixels with two tightly packed BGR565 bytes per pixel. The runtime adds the
Push row padding and XOR transformation. Startup streams at 5 fps; the controller
preview streams at 15 fps. Transfers are serialized to prevent overlapping USB
writes.

Push's own startup message may remain visible until the browser claims and
continuously streams the display. A one-shot frame appears only briefly because the
hardware clears it after a timeout. Ableton Live and the browser can contend for
device interfaces, so test browser ownership carefully before expanding MIDI or
display behavior. Do not send undocumented control, firmware, or diagnostic USB
messages.

### LED bench (pads and buttons)

Pad and button LEDs are driven over Web MIDI with three-byte messages, separate from
the WebUSB display. The controller modal has an **LED bench** row under the display
controls that runs the safety sequence from [PUSH3-LED-REFERENCE.md](PUSH3-LED-REFERENCE.md):

1. **Connect Push MIDI** requests Web MIDI without sysex. If exactly one output named
   like `Ableton Push 3 … User Port` exists it is selected; otherwise pick it in the
   **Output** menu. Never use the Live Port while Ableton Live is running.
2. **Light pad 1** sends Note On 92 with palette index 11 (green); **Pad 1 off** clears it.
3. **Light Play + Tap** sends CC 85 green and CC 3 lit-white.
4. **Fade upper 1** is a one-shot from off to pink on channel 5 (1/2 note).
5. **Pulse pad 64** starts a 120 BPM MIDI clock (Start + 24 ticks per beat) and pulses
   bottom-right between blue and sky blue on channel 9.
6. **Clear LEDs** turns off only the LEDs the app lit and stops the clock; **Release**
   does that and drops the output.

The hint line shows the last raw message from the paired User Port input, decoded
(pad index, button name, encoder delta), for verifying the input map. The full bench
sequence was verified on Eric's tethered Push 3 on 2026-09-11 in desktop Chrome: pad 1
lights top-left, the named colors match, one-shot and pulse animations run from the
sent clock, and input decodes. Firmware version was not recorded; add it to the LED
reference when convenient.

### Pads: performances and effects

Once Push MIDI is connected the pad grid is live in both directions, mirroring the
virtual surface exactly:

- **Rows 1–4 (pads 1–32): performances.** Each bank holds 32 slots (`PADS_PER_BANK`
  in `launcher.js`, 128 banks). A pad with a performance is lit steadily in a hue
  chosen by its position; the playing one pulses slowly in that hue (hardware half-note pulse toward off);
  queued pulses amber; loading blinks white; failed is red; empty is off. Pressing a
  pad launches it with the current timing setting (Shift forces immediate). Page ◀ ▶
  change bank.
- **Rows 5–8 (pads 33–64): effects.** Bound automatically, in declaration order, to
  the scene's boolean toggle controls — `control('glow', false, { mode: 'toggle' })`.
  Green when on, dim when off, dark when nothing is bound. Pressing flips the value
  through the registry, so the Controls tab and MIDI Learn stay in sync. The patch
  gates its optional drawing on the flag.
- **Encoders 1–8** drive the eight live controls shown under them on the display
  (Shift for fine steps). Empty encoders pick up newly declared numeric controls.
- **Upper display buttons** (between each encoder and its column): lit in the column's
  colour when a control is assigned there (the screen tab above the column uses the same
  hue), off when empty; a ↺ mark on the tab shows the value has moved from its default.
  Press resets the control to its default; Shift + press moves the column to the next
  numeric control.
- **Screen style** is documented in [PUSH3-DISPLAY-STYLE.md](PUSH3-DISPLAY-STYLE.md); tokens
  live in `src/performance/displayTheme.js`, and **Show style sheet** on the display row
  streams a specimen screen to the Push for judging type, colour and strokes in situ.
- **Screen layout (2026-09-11, after Live's Push 3 design):** top strip = eight tabs
  naming each encoder's control in its colour; one info line (beat dot + BPM, performance
  · scene · state, volume); eight columns with a caption (range, or the modulation's
  glyph and rate), a big value and a knob arc whose marker follows the live modulated
  value; bottom strip = modulation slots. `COLUMN_COLORS` in `surfaceDisplay.js` mirrors
  `PERFORMANCE_HUES`.
- **Play** mirrors the toolbar's audio transport: green while the file plays, dim when
  loaded but paused, off with no file. Pressing it is the same as the toolbar button.
- **Volume encoder** sets the master output level (2% per click, 0.5% with Shift). The
  engine routes file playback through a master gain placed *after* the analyzer tap,
  so lowering it changes what the room hears without dimming audio-reactive visuals.
  While the encoder moves (and for 2.5 s after) the screen shows the level and a bar
  under it whatever the source; with a file loaded the level stays visible there.
- Values changed anywhere (Push, controller dialog, Controls tab sliders, learned MIDI)
  now propagate everywhere: the Controls tab re-renders its rows on registry changes,
  and the Push screen model is refreshed even while the dialog is closed.
- **Pad animations use a fixed clock, not the app tempo.** Push only advances LED
  animations on incoming MIDI clock (with Start and no ticks a pulse freezes at its
  target colour, verified on hardware). The adapter keeps a 120 BPM clock running
  whenever an output exists, restarting it if the bench stops it, so a playing pad
  pulses once a second whatever the app tempo. Tap Tempo carries the beat.

The adapter sends the full 64-pad frame when an output appears and only changed
LEDs afterwards. Relevant files: `src/performance/push3Adapter.js` (input routing,
pad frame, diffing sender, clock sync), `src/performance/effectsBoard.js` (toggle
control binding), and their tests.

### Modulations

`src/performance/modulations.js` runs LFOs (sine, triangle, ramps, square, random step).
Every modulation is a named signal: a live global getter (`lfo1`, via
`createGlobalBindings`, skipping live-API/p5 names) and `modulations.<name>` on the draw
inputs (via `host.setModulationSource`); −1…1. A control target is optional.
**Modulations belong to the performance, not the scene** (decided 2026-09-11 after they
vanished on scene changes): they live in the project/performance bundle, are restored
by `restoreSettings(data, { modulations: true })` on performance load and startup, and
are left alone by scene launch/recall. The registry keeps the performer's base value; the engine
computes a per-frame output and `registry.setModulator` applies it when patches read
their controls, so knobs, sliders, MIDI Learn and saved values all see the base and a
knob always wins. Rates lock to the rhythm clock (`beats`) or free-run (`hz`). Depth and
offset are fractions of the control's range. `frame()` runs at the top of `draw` with
last frame's clock. Modulations save with the scene (`modulations` on the scene record
and in the project/performance bundle).

UI: the **Modulations** tab (`src/ui/modulationsPanel.js`). Push: the **lower display
buttons** are modulation slots in list order — press-and-release toggles modulation N,
Shift + press-release steps its waveform, and a press on the first empty slot adds a
new one (lfoN). **Hold** the button and turn the encoder above it to set depth (2% per
click); an edit suppresses the toggle on release. **Shift + press-release enters edit
mode** for that modulation (again to leave; LED white): the eight encoders become Wave,
Rate, Rate mode (beats/Hz), Depth, Offset, Control (target), On, spare, and the
screen shows those columns; the EDIT banner replaces the status line. Other encoders never touch controls
while editing.
LED off/dim/amber for empty/defined/running. The screen's bottom strip labels each slot
(glyph, name, rate; the next empty slot reads "+ new"); a modulation that targets a
control also shows its glyph and rate in that control's column and the readout follows
the live value. The virtual controller has the same eight buttons under its display.

### Tempo on Push

Once Push MIDI is connected, tempo is mirrored both ways without any bench button:

- **Tap Tempo** pulses full white for the first quarter of every beat (never shorter
  than the toolbar's 80 ms flash) and sits dim between beats. Pressing it calls the
  same tap action as the toolbar button.
- The **Metronome** button below it has a single LED and cannot show its two dots
  separately, so it is kept off rather than merely blinking.
- Both are white-only LEDs, so they use `PUSH3_WHITE` brightness steps, not the RGB
  palette. See the White LEDs section of the LED reference.
- Turning the **Tempo** encoder nudges the manual BPM by 1 per click, or 0.1 with
  Shift held. In Auto mode it starts from the tracked tempo and switches to Manual.
- The Push screen (**Show controller** on the display row) shows the BPM, the mode
  label (Manual, Tracking, Off…), and a beat dot in the header's right-hand block.
  The stream redraws the surface on every pull, so this stays live with the modal
  closed. The modal preview redraws each frame while open.

Relevant files:

- `src/performance/push3Tempo.js` — beat-window rule, `describeTempo`, and the link
  that owns the Tap LED and routes Tap/Tempo-encoder input into the rhythm manager.
- `tests/unit/push3Tempo.test.js`.
- `src/performance/push3Map.js` — pad notes, button CCs, encoder CCs, palette names,
  animation channels, and `decodePushMessage`. Pure and unit-tested.
- `src/performance/push3MidiTransport.js` — Web MIDI output/input, LED send with
  validation, hardware animation, clock sender, owned-LED clearing, reconnect.
- `tests/unit/push3Map.test.js`, `tests/unit/push3MidiTransport.test.js`.
- `src/performance/push3DisplayTransport.js` — permission, claim/release, BGR565
  encoding, framing, and serialized streaming.
- `src/performance/surfaceDisplay.js` — hardware-independent 960×160 surface
  rendering.
- `src/ui/performanceLauncher.js` — controller modal and Push display controls.
- `tests/unit/push3DisplayTransport.test.js` — transport and encoding coverage.
- [PERFORMANCE-CONTROLLERS-PLAN.md](PERFORMANCE-CONTROLLERS-PLAN.md) — broader MIDI
  and controller plan.

The next Push milestone is verified bidirectional control: exact pad/encoder/button
maps, LED feedback, reconnect behavior, coexistence with Live, and useful content on
the hardware display. The application already has generic MIDI Learn and a virtual
Push surface, so hardware events should feed those existing logical actions rather
than form a second controller architecture.

## Key source areas

- `src/main.js` composes the main runtime and UI services.
- `src/host/` evaluates blocks, stores patch and occurrence state, renders nested
  groups, and protects the active performance during replacement.
- `src/shaders/` compiles and runs GPU effect chains and managed image inputs.
- `src/audio/` owns audio analysis and tempo detection; `src/rhythm/` owns the shared
  clock and causal beat trackers; `src/signals/` supplies modulation helpers.
- `src/ui/` owns the editor overlays, Tools, transport, library, controls, and
  performance launcher.
- `src/performance/` owns performance recall, logical controller actions, the virtual
  surface, and Push display transport.
- `starter/` contains the built-in working material, including the downloadable
  `teapot.obj` example.
- `scripts/build-patch-library.mjs` creates the patch manifest before dev, tests, and
  builds.
- `scripts/build-hosted.mjs` assembles the hosted `dist/live/` application and copies
  required assets.

Read [ARCHITECTURE.md](ARCHITECTURE.md) before moving responsibilities between these
areas. [USER-MANUAL.md](USER-MANUAL.md) is the long-form product reference and should
be updated with any user-visible workflow or language change.

## Design decisions to preserve

1. Source is the composition authority. Avoid creating a second hidden scene graph
   in the interface.
2. Arrays are the beginner-facing composition form. Nested arrays are real render
   boundaries, and array effects transform their combined output.
3. Editing prepares a change; evaluation applies it. Keep the last successful
   performance running on syntax, reference, or first-frame failure.
4. GPU buffers and USB devices are runtime resources, not project data. Projects
   store source, performance settings, assignments, and routes.
5. Audio reactivity and musical tempo are related but independent. A visual must be
   able to respond to spectrum/level data even when no stable beat can be detected.
6. Hardware adapters translate into logical performance actions. The virtual
   controller remains the testable reference behavior.
7. Prefer compact, stage-safe UI. Large errors, stuck popovers, or panels that obscure
   the output are performance failures even when the underlying feature works.

## Known gaps and recommended order

1. **Push 3 input and feedback.** Verify MIDI ports and messages on the real device,
   map pads and encoders through the logical launcher, then add pad colors and display
   feedback. Handle disconnect/reconnect without losing the running scene.
2. **Performance transitions.** Prewarm a second renderer and add crossfade or
   transition semantics without interrupting audio, tempo, or controls.
3. **Multi-source shaders.** Make two-texture operations such as blend, difference,
   mask, key, and feedback easy within the array model. Preserve explicit nesting and
   predictable buffer lifetimes.
4. **Tempo validation.** Test automatic beat estimation across electronic, live-drum,
   ambient, and tempo-changing material. Expose alternate algorithms only when real
   tests show one method cannot cover the useful cases.
5. **Patch library depth.** Add tested examples for models, typography, input,
   feedback, video, math, and WebGL while keeping install state and source ownership
   clear.
6. **Recording and collaboration.** These are useful later, but performance safety,
   controller confidence, and composition fluency are currently more important.

For the wider comparison with P5LIVE, see [P5LIVE-COMPARISON.md](P5LIVE-COMPARISON.md).
The deferred ideas list is [DEFERRED_LIBRARY_IDEAS.md](DEFERRED_LIBRARY_IDEAS.md).

## Git and generated files

At this snapshot, `main` and `origin/main` both point to `f2d83ac`. The local
`output/` directory is untracked and contains generated review/manual artifacts; do
not add it wholesale. A normal source change should leave only intentional files in
the staged diff:

```sh
git status --short --branch
git diff --check
git diff --cached --check
```

Run the focused test for the area changed, the full unit suite, and `npm run build`
before pushing. Use the existing end-to-end tests when a workflow crosses editor,
runtime, canvas, or browser permission boundaries.
