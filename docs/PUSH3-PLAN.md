# Push 3 bidirectional control — plan

Status: draft v2, September 11, 2026. M0–M3 landed the same day (LED transport, tempo link, pad/encoder/bank input, pad LED feedback, effects pads on rows 5–8). M0 and M1 code landed the same day (`push3Map.js`, `push3MidiTransport.js`, LED bench row in the controller modal); verified on hardware the same day; M2 (input → launcher actions) is next. Builds on [HANDOFF.md](HANDOFF.md) §"Push 3 status" and [PERFORMANCE-CONTROLLERS-PLAN.md](PERFORMANCE-CONTROLLERS-PLAN.md). Addresses, palette indices and animation semantics come from [PUSH3-LED-REFERENCE.md](PUSH3-LED-REFERENCE.md), which is the ground truth for this plan; do not use Push 2 numbers where the two differ. Display output over WebUSB is already proven; this plan covers the other direction and the loop back: pads, buttons and encoders as input, and LED color as feedback.

## Short answer to "can we light the buttons?"

Yes, with three-byte MIDI and no sysex. A pad LED is set by a **Note On** to the pad's note (36–99) where the **velocity is a palette index (0–127)**; illuminated buttons are set the same way with **Control Change** on the button's CC. The **channel selects an animation**: channel 0 static, 1–5 one-shot fade, 6–10 pulse, 11–15 blink, at durations from 1/24 to 1/2 note. Animations run on the hardware, timed by MIDI clock we send (24 ticks per beat, plus Start), so a pulsing pad costs two messages, not a stream. The 128-entry palette has been measured on Push 3 firmware 2.4.5b8, so we can pick semantic colors by index without touching the palette.

## What we already have

The architecture rule from the handoff holds: hardware translates into logical launcher actions, and the virtual surface stays the reference. Most of the plumbing exists.

`src/performance/launcher.js` is the single logical-action hub. `dispatch({action, index, timing?, value?, relative?, fine?})` (line 114) accepts `pad` (0–63), `encoder` (0–7, absolute or relative), `tap`, `safe`, `bankNext`, `bankPrevious`. `receive(message)` (line 128) already matches parsed MIDI to learned routes and decodes relative two's-complement encoders, which is the Push encoding (clockwise 1…, counter-clockwise 127…, accelerated). `snapshot()`/`subscribe()` (lines 167–171) expose everything an LED renderer needs: bank, slots, active, queued, loading, error, targets.

`src/control/controlManager.js` does Web MIDI **input only**: `requestMIDIAccess({ sysex: false })` at line 64, enumerates `access.inputs`, hot-plugs via `onstatechange`, and parses to `{device, type: 'cc'|'note', channel, number, normalized}`. There is no output enumeration, no `send`, and velocity is normalized away.

`src/performance/surfaceDisplay.js` renders the 960×160 image in eight 120-pixel columns — one per encoder — and `push3DisplayTransport.js` streams it over WebUSB. The pad status vocabulary the UI already computes (`src/ui/performanceLauncher.js:164`) is `loading | queued | failed | playing | ready | empty`; that is exactly the set of states the pad LEDs should show.

## Design

**Two transports, one adapter, no second architecture.** The WebUSB display transport and a new Web MIDI transport are independent: claiming the display never implies MIDI ownership, and losing one never tears down the other. Above them, one adapter turns Push events into the launcher's existing action vocabulary and turns `launcher.snapshot()` into LED frames. The virtual surface is untouched and remains the reference behavior.

`src/performance/push3MidiTransport.js` (per the reference's recommended boundary): `connect()` after a user gesture, `listPorts()`, `selectOutput(id)` with an explicit User-port choice, `setPad(row, col, color)`, `setButton(cc, color)`, `animatePad/animateButton(base, target, channel)`, `startClock()/stopClock()`, `clearOwnedLeds()`, `disconnect()`. It validates every channel, address and palette index, records which LEDs it has touched so it only clears its own, and never emits sysex.

`src/performance/push3Map.js`: the data tables — pad note ↔ row/col, button CCs, encoder CCs and touch notes, the semantic color table (`off, ready, playing, queued, loading, failed, bankOn, bankOff, …` → palette index) — plus pure functions `decodePushMessage(raw) → {kind, id, value}`, `padIndexFromNote`, `noteFromPadIndex`. Unit-tested, DOM-free.

`src/performance/push3Adapter.js`: `createPush3Adapter({ launcher, transport, clock, controlManager, diagnostics })`. Registers as the launcher's message router for messages whose device is a Push port and passes everything else through to the existing `launcher.receive → parameter bindings` chain, so a second controller keeps working. Subscribes to the launcher and renders LED frames.

**Pad numbering.** The virtual surface numbers pads 1–64 in DOM order, top-left first. Push's note 36 is bottom-left. Proposed: `index = (7 − row) × 8 + col`, so pad 1 on the screen is the top-left physical pad. Decision to confirm (see below).

**Control manager changes.** Enumerate `access.outputs` alongside inputs and expose them; keep `sysex: false`. Carry the raw data byte in parsed messages so pad velocity/pressure can reach patches later. Add a `devicePorts(pattern)` helper so the adapter can find `Ableton Push 3 … User Port` input/output pairs, and refuse ambiguous automatic selection if more than one Push output matches. Generic MIDI Learn is unchanged.

**Default control map** (Push 3 addresses; every action remains overridable through the existing Learn UI):

| Physical | Message | Logical action |
|---|---|---|
| 64 pads | notes 36–99 | `pad` launch in current bank with the launcher's timing; **Shift** + pad = immediate; **Delete** + pad = clear slot |
| Encoders 1–8 | CC 71–78 relative; touch notes 0–7 | `encoder` relative; Shift = fine; touch highlights the column on the display |
| Page ← / → | CC 62 / 63 | `bankPrevious` / `bankNext` |
| Resolution row (1/4 … 1/32t) | CC 36–43 | select bank 1–8 directly; the current bank's button is lit |
| Tap Tempo | CC 3 | `tap` — **done** (`push3Tempo.js`), LED mirrors the toolbar beat flash |
| Play | CC 85 | **done**: toggles the audio file transport; LED green/dim/off |
| Undo | CC 119 | `safe` (restore last safe state) |
| Delete (alone) | CC 118 | cancel queued launch |
| Upper screen buttons | CC 102–109 | **done**: press resets the control under it to default; Shift + press cycles the column's control; LED off/dim/bright = unassigned/at default/moved |
| Lower screen buttons | CC 20–27 | **done**: modulation slots in list order — toggle, hold + encoder sets depth, Shift enters edit mode (encoders = wave/rate/mode/depth/offset/moves/on), first empty slot adds one; LED off/dim/amber/white; labels on the screen's bottom strip |
| Shift / Select | CC 49 / 48 | modifiers only; no action |
| Tempo encoder | CC 14 relative | **done**: nudge manual BPM ±1 (Shift ±0.1) |
| Volume encoder | CC 79 relative | **done**: master output level via a post-analyzer gain |
| Jog wheel | CC 70 relative, press CC 94, clicks CC 93/95 | **done**: browse the performance library on the screen; press to load |
| D-pad, touch strip | CC 44–47/91, note 12 | reserved; candidates: master brightness, ninth control |

The resolution row takes the role Push 2's right-hand scene buttons would have had: eight lit buttons in a row are a natural bank selector, and they have LEDs.

**LED feedback model.** `renderPushLeds(snapshot) → Map<address, {base, target?, channel}>` computes the desired frame for all 64 pads and the buttons we own (bank row, Play, Tap, Undo, Delete, Shift). The adapter diffs against the last frame and sends only changed LEDs, coalesced per animation frame; a full refresh is under ~80 short messages, steady state is near zero. Proposed states using measured palette indices:

| State | Color (index) | Animation |
|---|---|---|
| empty | off (0) | static |
| ready | dark gray (119) or dim of the slot's hue | static |
| selected (last pressed, not playing) | medium gray (118) | static |
| playing | green (11) | static; beat flash by one-shot to bright green (10) on channel 2 |
| queued | amber (8) | pulse to yellow (7), channel 9 (quarter note) |
| loading | white (122) | blink, channel 13 |
| failed | warm red (1) | static |
| bank button, current bank | sky blue (16) | static |
| bank button, other | dark gray (119) | static |
| Play while playing / paused | green (11) / off | static |
| Tap on each beat | one-shot white (122) → off, channel 1 | hardware |

Animations are hardware-timed, so the adapter sends MIDI Start (`0xFA`) on connect and 24 `0xF8` ticks per beat scheduled from the existing anchored rhythm clock in `src/rhythm/clock.js`, re-sending Start when tempo is re-anchored so phase stays locked to the visuals. When no tempo exists, the clock sender is idle and Push falls back to 120 BPM for animations, which is acceptable for loading/queued indication. The beat flash on the playing pad is a one-shot message per beat from our clock rather than a running pulse, so it stays exactly on our beat.

**Display content.** The 960×160 screen is the third output and already works end to end: `push3DisplayTransport.js` streams frames, the branded startup splash (`assets/brand/startup.bgr565`, 5 fps) is proven on hardware, and `surfaceDisplay.js` draws the eight-column controller preview at 15 fps. What is missing is content that earns its place during a performance. The proposal is one `renderPerformanceDisplay(canvas, snapshot, clock)` that replaces the current preview and is rendered from the same launcher snapshot the LEDs use, so screen, pads and buttons never disagree.

Layout, top to bottom: a header strip with the active performance name, bank number, and a beat indicator (eight small blocks stepping with the clock, plus BPM or "no tempo"); the eight encoder columns, each showing the assigned parameter name, its current value, and a horizontal bar, with the touched encoder's column highlighted (from touch notes 0–7) and unassigned columns dimmed; and a footer line for transient status — "Queued: Late-night lasers · next beat", the compact error message when a launch fails, or the safe-state notice. Screen-button labels sit in the top and bottom margins above/below each column once the screen buttons have roles, matching how Push labels them. Text uses the existing monospace style at sizes that stay legible at 160 px height; colors reuse the LED palette hues so a green pad and a green column mean the same thing.

Mode switching stays explicit: startup splash while idle or on connect, performance view while the adapter is attached, and the current test pattern kept behind the bench panel. The display keeps its independent claim/release lifecycle; if USB drops, LEDs and input continue.

**Lifecycle.** Connect: user picks the Push User Port in the controller modal (explicit, never silently automatic) → Start + clock → full LED frame. Disconnect (`onstatechange`): keep the scene running, drop the output, clear the last-frame cache. Reconnect: repeat connect automatically if the same port name returns. Release: `clearOwnedLeds()`, Stop (`0xFC`), disconnect. The Performances controller modal shows one Push card with two independent rows — Display (USB) and Control (MIDI) — each with its own status.

**Coexistence with Live.** Use only the User Port. If Live holds it, our output may open but produce no visible LEDs; detect this by watching for any input after connect and surface "Push User Port appears to be owned by Ableton Live — turn off Track/Sync/Remote for the User Port in Live's MIDI settings" instead of failing silently. Push 3 Standalone remains out of scope.

**Safety.** No sysex in the normal path. No undocumented commands ever. Tests assert that the LED API emits only `0x9n`/`0xBn` triples and real-time bytes.

## Milestones

M0 — **Done (variant).** Instead of extending `controlManager`, `push3MidiTransport.js` requests its own Web MIDI access (still `sysex: false`), enumerates outputs, pairs the User Port input by name, and handles output disconnect. `controlManager` is unchanged, so generic MIDI Learn is unaffected. Raw data bytes reach patches later via the adapter (M2).

M1 — **Done, verified on hardware 2026-09-11.** `push3MidiTransport.js` and `push3Map.js` with tests; an LED bench row in the controller modal that runs the reference's eight-step safety sequence (light one pad, clear it, light an RGB and a white button, one-shot without clock, Start + clock then pulse/blink, clear owned, disconnect) and logs raw incoming messages. One hardware session verifies the map and colors on Eric's unit and records firmware, port name and observations in PUSH3-LED-REFERENCE.md.

M2 — **Done.** `push3Adapter.js` routes pads (rows 1–4 launch, rows 5–8 toggle effects via `effectsBoard.js`), encoders 1–8, Page ◀ ▶ and Shift into launcher actions. The tempo link takes Tap Tempo and the Tempo encoder first. Other buttons are still unmapped.

M3 — **Mostly done.** `renderPadFrame` + diffing sender + clock sync from the rhythm clock in `push3Adapter.js`; Tap Tempo beat pulse in `push3Tempo.js`. Remaining: bank row on the resolution buttons, Play/Undo/Delete LEDs.

M4 — Display content: `renderPerformanceDisplay` (header, encoder columns with touch highlight, footer status, screen-button labels), rendered from the launcher snapshot and streamed through the existing transport; splash ↔ performance view switching.

M4b — Lifecycle: reconnect for both transports, Live-coexistence detection, unified Push card with independent Display and Control rows.

M5 — Docs and tests: USER-MANUAL Push section, e2e test with a fake MIDI device exercising launch → LED frame → clear on disconnect.

## Later, once the loop works

**Modulations on the lower display buttons (built 2026-09-11; see HANDOFF).** Treat an LFO, ramp,
envelope or random walk as something you *play*: the eight lower display buttons, one
under each display column, toggle a modulator on the control shown in that column, the
button LED shows it running, and pressing it in the browser (or Shift + button on Push)
opens its attributes — rate (free or beat-synced to the rhythm clock),
waveform (sine, triangle, ramp up/down, square, random), depth and offset, and the
target control. Modulators would live in the performance bundle beside the encoder
assignments, run in the host frame loop writing through `registry.setParam`, and pause
when their control is touched by a knob so the performer always wins. Open questions:
whether modulators are per scene or per performance, and how they show on the display
(a small waveform glyph in the control's column would do).

Pads as performance input to patches: expose pad pressure (and MPE slide if it arrives on the User Port) in the live context so a patch can react to the performer's hands. Touch strip as a ninth assignable control. Jog wheel to browse performances or scrub a parameter. Per-performance colors chosen in the launcher UI and mirrored on the pads via the measured palette.

## Decisions needed

1. **Decided:** pad 1 top-left, matching the virtual surface. Banks are 32 slots: rows 1–4 launch performances, rows 5–8 are effect toggles bound to the scene's toggle controls.
2. **Decided:** upper screen buttons reset the control under them; Shift + press cycles the column's control.
3. Shift: fine encoder steps and immediate launch (proposed), or hold-Shift for a second bank of pad actions?
4. Bank selection on the resolution row (proposed) versus the lower screen buttons?
