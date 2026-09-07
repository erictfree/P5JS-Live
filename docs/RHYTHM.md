# Timing and visual signals

Visuals can react to sound without knowing its tempo. `audio.onset` means a detected
hit; `clock` supplies a separate, optional pulse. A hit may fall between beats.

## Try Motion Lab

Open **Tools → Audio → Run Motion Lab**. This adds its source and selects the
`motionLab` scene; your other source stays in the project. It demonstrates all seven
operators, including both triggered and held envelopes. The same held envelope
drives a p5 circle and shader opacity; lag also drives the border's blur.

Press **Esc** to release editor focus, then hold **H** to trigger the hit examples
and sustain the ADSR. Release **H** to watch its release stage. In the Lag cell, the
outline jumps to each raw variation value while the filled circle follows smoothly.
**Space** (or **T**) taps tempo. The blue ring follows the optional clock; the orange
ring uses seconds. With timing Off, the blue ring holds while the orange ring moves.
The complete source is [starter/motion-lab.js](../starter/motion-lab.js).
Close Tools and press **E** after Esc for an unobscured canvas; E restores the code.

## Tap tempo

**Tap** is always visible in the top navigation, including when timing is Off.
Press **Esc** to release editor focus, then tap **Space** or **T**, or click **Tap**.
Each press registers on keydown and briefly lights the Tap buttons. While the clock
is running, both Tap buttons also flash amber for 80 milliseconds on each beat.
In **Tools → Audio → Rhythm**, you can also choose Manual or enter a BPM. Tapping or
entering BPM selects Manual. Two taps give an estimate; further consistent taps
stabilize it. A gap longer than 2.5 seconds starts a new tap sequence. Key repeat and
closely duplicated taps are ignored. Manual accepts 30–300 BPM.

**½ / ×2** changes the speed without resetting phase. **Align beat now** immediately
aligns the grid. Ordinary subsequent taps correct alignment gradually. Manual keeps
running through silence, audio pauses, source changes, and scene edits. Choose Off
to hold the clock. The compact BPM readout appears while timing is enabled.
Tap and the readout hide with navigation; the keyboard shortcuts still work.

**Shift+Space** plays or pauses audio. Typing in the editor and other text fields is
unchanged. Focused buttons keep their normal keyboard activation: Space activates
the focused button, and on Tap it registers a tap immediately. Enter also activates
Tap. Holding a key does not generate repeated taps.

## One clock snapshot per frame

Every patch and shader receives the same frozen `context.clock`:

| Field | Meaning |
| --- | --- |
| `source` | `off`, `manual`, or `auto` |
| `status` | `off`, `listening`, `running`, `holding`, or `lost` |
| `running` | Whether beat position advances, including Holding |
| `bpm` | Effective tempo, or `null` when unavailable |
| `beat` | Continuous beat position; initially zero |
| `phase` | Fractional beat position, from 0 inclusive to 1 exclusive |
| `tick` | At least one beat boundary crossed this frame |
| `crossings` | Number of boundaries crossed during an ordinary frame gap |
| `confidence` | Tracker quality from 0–1 in Auto; `null` otherwise |

A stopped clock holds its position. No fallback tempo is invented. The clock uses
monotonic elapsed time rather than a capped animation step. Ordinary dropped frames
count missed boundaries; a gap over two seconds suppresses catch-up events. After
suspension, Manual resumes at current phase and Auto reacquires.

Tempo does not identify a downbeat, bar, or time signature. `.draw()` still selects
a scene at the next rendering boundary; it does not wait for a beat.

## Seven numeric operators

Construct helpers in evaluated code, outside `draw()`. Each returns a function.
Call it with the patch context in p5 code or pass it directly as a shader argument.

```js
const breathe = lfo({ period: 4, min: 0.5, max: 1 });
const glow = envelope({ trigger: 'onset', attack: 0.02, release: 0.6 });
const zoom = ramp({ period: 8, from: 0.5, to: 1.5 });
const paletteIndex = sequence([0, 1, 3, 2], { trigger: 'onset' });
const diameter = remap(c => c.audio.bass, { from: [0, 1], to: [20, 200] });
const scatter = variation({ seed: 'show-one', period: 0.5, min: -100, max: 100 });
const softBass = lag(c => c.audio.bass, { rise: 0.04, fall: 0.3 });
```

These are reusable definitions, not a complete scene. For example, given a patch
named `rings`, `[rings].opacity(breathe)` uses the helper directly. In a patch's
`draw(c)`, `circle(width / 2, height / 2, diameter(c))` reads a value.

| Helper | Options and defaults |
| --- | --- |
| `lfo(options)` | `period: 4` seconds or `beats`; `min: 0`, `max: 1`, `phase: 0` in cycles; `wave: 'sine'`, `'triangle'`, `'saw'`, or `'square'` |
| `envelope(options)` | Triggered attack/release by default: `trigger: 'onset'`, `attack: 0.02`, `release: 0.4`. Supply `gate` for ADSR, adding `decay: 0.1`, `sustain: 0.7`. Both modes: `unit: 'seconds'` or `'beats'`, `min: 0`, `max: 1`. |
| `lag(source, options)` | Smooth a number or context callback. `time: 0.15`, optional `rise` and `fall` overrides, `unit: 'seconds'` or `'beats'`, optional `initial` value. |
| `ramp(options)` | `period: 1` seconds or `beats`; `from: 0`, `to: 1`; optional `trigger` |
| `sequence(values, options)` | Nonempty numeric array; `period: 1` seconds, `beats`, or `trigger` |
| `remap(source, options)` | A number or context callback; `from: [0, 1]`, `to: [0, 1]`, `clamp: true` |
| `variation(options)` | `seed: 1` (number or string), `min: 0`, `max: 1`; `period: 1` seconds, `beats`, or `trigger` |

`period` and `beats` are mutually exclusive. Beat-based durations explicitly use the
optional clock. Seconds-based motion and onset triggers work with timing Off.
Envelopes and ramps allow zero duration for an immediate transition; periodic
intervals must be positive. Numbers must be finite. Reversed ranges intentionally
invert the result. Mapping rejects a zero-width input range.

LFOs follow shared host time or beat position. The default sine starts at its low
endpoint at phase zero. Ramps without triggers start when their code is applied,
then hold their endpoint. Triggered ramps wait at `from` and reset to it on each
trigger. Triggered envelopes start at rest, rise to `max`, then release to `min`;
retriggering starts from the current value. Held ADSR envelopes add decay and
sustain, as described below.

Sequences and variation initially expose index zero. Timed intervals or triggers
advance the index; sequences wrap. Variation hashes the seed and index, so repeated
reads and differing frame rates do not change a timed sequence or p5's random stream.
Audio-triggered variation depends on the actual detected event history.

### Smooth values with lag

`lag()` is a one-pole low-pass filter for numeric visual controls. Use it to soften
audio jitter, smooth stepped sequences, or make a parameter follow another signal:

```js
const steps = sequence([0.7, 1.2, 0.9, 1.4], { period: 1 });
const size = lag(steps, { time: 0.2 });
const bass = lag(c => c.audio.bass, { rise: 0.04, fall: 0.35 });
```

Pass `size` to `[myPatch].scale(size)` or call `size(c)` in a p5 patch. `time` is a
time constant: the output covers about 63% of a fixed difference in one time
constant and 95% in three. This is exponential smoothing, not a queued delay or a
fixed-duration ramp. `rise` and `fall` override `time` for increasing and decreasing
numeric values. Durations are nonnegative; zero follows the target immediately.

By default, lag starts at the first sampled input. Add `initial: 0` to ease from
zero instead. `unit: 'beats'` measures the durations in beats and holds progress
when the optional clock stops. The response uses elapsed logical time, so smoothing
does not become slower when frames drop. Continuously changing inputs are sampled
once per visual frame. The name avoids p5's existing `smooth()` drawing command.

### Hold an ADSR envelope

Use a **gate** when a gesture should sustain a value until released:

```js
const held = envelope({
  gate: c => c.keyboard.keys.has('h'),
  attack: 0.2,
  decay: 0.3,
  sustain: 0.55,
  release: 0.7,
});
```

After releasing editor focus with Esc, holding H starts attack toward `max`, then
decay toward the sustain level. That level remains while H is held. Releasing H
starts release toward `min`, including if attack or decay is still underway.
Pressing H again during release starts attack from the current value. Sustain is
a fraction from 0 to 1 between `min` and `max`, not a duration. Defaults are shown
in the table. Zero-length stages complete immediately; reversed ranges also work.

`gate` accepts a boolean, finite number, or context callback returning either;
false/zero releases and true/nonzero holds. For example, a callback can read a
control or an audio threshold. Durations use seconds by default; choose
`unit: 'beats'` for beat durations, which hold when the clock stops.

Choose `gate` for ADSR or `trigger` for a one-shot attack/release envelope; they
cannot be combined. Supplying decay or sustain without a gate is an error.
`trigger: c => c.keyboard.keys.has('h')` triggers once when pressed and then
releases automatically; `gate` stays at sustain until the key is released.

### Triggers and shared reads

- `trigger: 'onset'` consumes detected audio-hit pulses, including adjacent frames.
- `trigger: 'beat'` uses clock crossings; ordinary missed boundaries advance a
  sequence by the appropriate count, without firing callback bursts.
- A trigger function is a **gate**: false/zero to true/nonzero triggers once, and
  holding it does not retrigger. Example: `trigger: c => c.controls.flash`.

All reads of one helper in a frame agree. A helper reused by three parameters owns
one state. Create two helpers for independent state. A mapping can consume another
helper, such as `remap(glow, { to: [20, 200] })`.

Signal input callbacks receive a shared frame context: `time`, `dt`, `frame`,
`audio`, `clock`, `controls`, and `keyboard`. They have no per-patch `state` or render
target. Keep input callbacks pure; the host samples them once before drawing,
including when their visual consumer is temporarily inactive. Cyclic dependencies
and invalid numeric results report through the consuming patch's error boundary.

### Live edits and recovery

New stateful definitions start fresh after successful evaluation. Unchanged helper
instances keep running. As with ordinary JavaScript closures, an existing patch
keeps its captured helper: after editing the signals cell, run the consumers too,
or use **Cmd/Ctrl+Shift+Enter** to run all. Use `controls` for tuning that should
apply immediately without rebuilding definitions.

Source and seeds persist; exported projects do not store live envelope state or
past audio events. In-memory Safe State checkpoints retain supported signal state
alongside patch state. Restoring never rewinds the shared clock or sound, so a ramp
whose original end time has passed is complete. Failed evaluation cannot enroll new
helpers; a failed replacement consumer retains its prior implementation.

Signal ownership follows ordinary JavaScript references, including closures and
bounded version history. Weak registrations let discarded definitions be collected;
helpers hold no audio nodes or GPU buffers.

## Automatic tracking

Load a song or select mic/line input, then choose **Tools → Audio → Rhythm →
Timing → Auto · experimental**. Auto is available on the normal `/live/` page;
no preview URL is needed. Timing still starts Off in a new project.

The **Algorithm** selector offers two choices:

| Algorithm | Approach |
| --- | --- |
| **Pulse (PLP)**, the default | Follows periodic structure in continuous spectral changes. Combines recent pulse estimates to stabilize phase through extra hits and missing beats. |
| **Onset grid** | Fits candidate grids to individually detected hits over the last eight seconds. Useful as an alternative for clear percussion. |

Switch algorithms while music plays to compare them. Each switch clears previous
evidence and starts Listening; the old worker cannot change the new clock. The
selection is saved with projects and performances. **Tap** or entering a BPM takes
over with Manual immediately; **½ / ×2** selects another pulse speed.

Both algorithms search 60–200 BPM before the user's ½ / ×2 preference, need no
supplied BPM, and correct tempo/phase gradually. They do not infer a bar, downbeat,
or time signature, and do not provide external MIDI/Link sync.

Listening means no established estimate; Tracking means recent supporting evidence;
Holding predicts briefly without new evidence; Lost stops the clock after three
seconds without support. The quality meter is not a probability of musical accuracy.
A source change, loop discontinuity, or suspension clears stale evidence. Analysis
runs in a worker with at most one unacknowledged audio batch; overload drops analysis
rather than growing queues. Microphone audio is never routed to audible output.

Pulse passes synthetic timing checks and supports more of the existing music clip
than Onset grid, but both still lose tracking. Auto remains experimental while we
try it with representative music. [Validation record](TEMPO-VALIDATION.md) describes
the implementation, measurements, and remaining accuracy checks.

Project schema 7 and performance schema 2 include timing settings, including
`algorithm: 'plp' | 'grid'` (default `'plp'`). The onset API is
`audio.onset`, `audio.sinceOnset`, and the `onset(context)` lifecycle hook. No aliases
for the former beat names or legacy format adapters are provided.
