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

## Push 3 status

Real Push 3 display output has been proven on tethered Push 3 hardware. This work is
for Push 3 in controller mode, not Push 3 Standalone.

The tested device identifies as USB vendor `0x2982`, product `0x1969`. Its display is
960×160 BGR565 on interface 0 with bulk OUT endpoint 1. Each transmitted row is
2048 bytes, including padding. The implementation sends the fixed frame header and
applies the required XOR shaping to pixel bytes.

To test it:

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

### Tempo on Push

Once Push MIDI is connected, tempo is mirrored both ways without any bench button:

- The Push **Tap Tempo** LED flashes lit-white for the first 80 ms of every beat, the
  same rule as the toolbar tap button, and sits dark gray otherwise. It goes dark when
  the clock is off.
- Pressing **Tap Tempo** on the Push calls the same tap action as the toolbar button.
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
