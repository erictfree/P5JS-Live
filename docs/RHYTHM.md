# Timing and visual signals

Visuals can react to sound without knowing its tempo. `audio.onset` means a detected
hit; `clock` supplies a separate, optional pulse. A hit may fall between beats.

## Try Motion Lab

Open **Tools → Audio → Run Motion Lab**. This adds its source and selects the
`motionLab` scene; your other source stays in the project. It demonstrates all six
operators, with the same envelope driving p5 drawing and shader opacity.

Press **Esc** to release editor focus, then hold **H** to trigger the demonstration
without sound. **T** taps tempo. The blue ring follows the optional clock; the orange
ring uses seconds. With timing Off, the blue ring holds while the orange ring moves.
The complete source is [starter/motion-lab.js](../starter/motion-lab.js).

## Tap tempo

In **Tools → Audio → Rhythm**, choose Manual, tap **Tap**, or enter a BPM. Tapping or
entering BPM selects Manual. Two taps give an estimate; further consistent taps
stabilize it. A gap longer than 2.5 seconds starts a new tap sequence. Key repeat and
closely duplicated taps are ignored. Manual accepts 30–300 BPM.

**½ / ×2** changes the speed without resetting phase. **Align beat now** immediately
aligns the grid. Ordinary subsequent taps correct alignment gradually. Manual keeps
running through silence, audio pauses, source changes, and scene edits. Choose Off
to hold the clock. The compact transport readout appears while timing is enabled
and hides with navigation.

T works outside text fields. Typing in the editor is unchanged. The focused Tap
button also works with Enter or Space, without also toggling playback.

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

## Six numeric operators

Construct helpers in evaluated code, outside `draw()`. Each returns a function.
Call it with the patch context in p5 code or pass it directly as a shader argument.

```js
const breathe = lfo({ period: 4, min: 0.5, max: 1 });
const glow = envelope({ trigger: 'onset', attack: 0.02, release: 0.6 });
const zoom = ramp({ period: 8, from: 0.5, to: 1.5 });
const paletteIndex = sequence([0, 1, 3, 2], { trigger: 'onset' });
const diameter = remap(c => c.audio.bass, { from: [0, 1], to: [20, 200] });
const scatter = variation({ seed: 'show-one', period: 0.5, min: -100, max: 100 });
```

These are reusable definitions, not a complete scene. For example, given a patch
named `rings`, `[rings].opacity(breathe)` uses the helper directly. In a patch's
`draw(c)`, `circle(width / 2, height / 2, diameter(c))` reads a value.

| Helper | Options and defaults |
| --- | --- |
| `lfo(options)` | `period: 4` seconds or `beats`; `min: 0`, `max: 1`, `phase: 0` in cycles; `wave: 'sine'`, `'triangle'`, `'saw'`, or `'square'` |
| `envelope(options)` | `trigger: 'onset'`, `attack: 0.02`, `release: 0.4`, `unit: 'seconds'` or `'beats'`, `min: 0`, `max: 1` |
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
trigger. Envelopes start at rest, rise to `max`, then release to `min`; retriggering
starts from the current value. The initial envelope has no sustain stage.

Sequences and variation initially expose index zero. Timed intervals or triggers
advance the index; sequences wrap. Variation hashes the seed and index, so repeated
reads and differing frame rates do not change a timed sequence or p5's random stream.
Audio-triggered variation depends on the actual detected event history.

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

## Automatic tracking preview

The algorithm and AudioWorklet/worker pipeline are implemented, but **Auto is still
in validation** and disabled in the normal selector. For a deliberate trial, open
`/live/?tempoPreview=1`, then choose **Auto · experimental**. A previously saved Auto
selection remains an explicit opt-in on reload; choose Off or Manual to leave it.

Auto currently searches 60–200 BPM before the user's ½ / ×2 preference. It computes
spectral changes from fixed-hop audio samples, tests competing pulse grids over a
bounded eight-second window, and corrects tempo/phase gradually. It needs no supplied
BPM and never overrides Manual. It has no meter inference or external MIDI/Link sync.

Listening means no established estimate; Tracking means recent supporting evidence;
Holding predicts briefly without new evidence; Lost stops the clock after three
seconds without support. The quality meter is not a probability of musical accuracy.
A source change, loop discontinuity, or suspension clears stale evidence. Analysis
runs in a worker with at most one unacknowledged audio batch; overload drops analysis
rather than growing queues. Microphone audio is never routed to audible output.

Synthetic fixtures pass the initial timing targets, but the existing music clip
loses tracking through dense passages. This preview is not a dependable automatic
sync source yet. [Validation record](TEMPO-VALIDATION.md) documents measurements,
comparison with aubiojs, and the gate for normal availability.

Project schema 7 and performance schema 2 include timing settings. The onset API is
`audio.onset`, `audio.sinceOnset`, and the `onset(context)` lifecycle hook. No aliases
for the former beat names or legacy format adapters are provided.
