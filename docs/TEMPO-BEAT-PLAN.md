# Tempo, detected hits, and visual motion

Status: implementation plan and delivery record, September 7, 2026. Manual timing
and all six visual operators are implemented. The Auto pipeline is implemented as
an explicit preview, gated from normal controls because recorded-audio validation
has not passed. Use [the current guide](RHYTHM.md) for shipped API signatures and
[the validation record](TEMPO-VALIDATION.md) for evidence. The sections below retain
the planning rationale; proposed signatures and targets are superseded by that guide.

## Intended experience

Astra remains an audio-reactive visual instrument. A performer can supply arbitrary
music, microphone input, or silence and get useful visuals without providing BPM.
Tap tempo and automatic estimation offer an optional rhythmic reference for motion.
Raw reactions to sound continue independently of that reference.

The first deliverable is a dependable tap-tempo control and shared beat position.
The second delivers a small visual signal library: LFOs, attack/release envelopes,
ramps, stepped sequences, range mapping, and seeded variation. These helpers work
with sound, elapsed time, or the optional clock; none requires automatic tempo
detection. Automatic tracking follows behind an accuracy and performance check
using actual audio inputs.

## Three separate concepts

| Concept | Meaning | Example |
| --- | --- | --- |
| Audio feature | A measurement of incoming sound | Bass energy changes a circle's size. |
| Detected onset / hit | A sudden change in sound that may occur between musical beats | A transient triggers a burst. |
| Tempo clock | An optional estimate or performer-supplied grid that continues between hits | A shape completes one rotation every four beats. |

Detected hits are not guaranteed beats. A steady tempo also does not identify the
first beat of a bar. The initial feature should expose beat position without
claiming to infer meter, bar boundaries, or song structure.

## Current implementation and the naming change

- [features.js](../src/audio/features.js) already produces levels, frequency bands,
  `audio.beat`, and `audio.sinceBeat`. Its current beat detector is a bass-onset
  heuristic, sampled through the visual frame loop.
- [hostLoop.js](../src/host/hostLoop.js) supplies elapsed time and scene time and
  invokes a patch's `beat()` hook when `audio.beat` is true.
- [audioEngine.js](../src/audio/audioEngine.js) supplies one shared visual-analysis
  snapshot per frame. Its source can be a file, microphone/line input, or silence.
- MIDI currently handles notes and CC controls; it does not consume timing clock.
- The Audio panel already has an onset light. There is no need for a code-pattern
  highlighter to make a first tempo feature understandable.

Recommended clean API naming: rename `audio.beat` to `audio.onset`,
`audio.sinceBeat` to `audio.sinceOnset`, and the patch `beat()` lifecycle hook to
`onset()`. Update the validator, host, patches, examples, reference, and tests in
the same change. Put the new optional musical clock in `context.clock`.

This follows the project's preference for a clean API: do not add compatibility
aliases or source rewriting. Shipped content is updated; externally saved source
using those old names requires an explicit edit. The rename must not change the
detector's behavior in the same commit.

## Timing sources and defaults

| Choice | Behavior |
| --- | --- |
| Off — default | Audio reactions and time-based motion work. No tempo is invented. |
| Manual | Tap a pulse or enter BPM. The clock continues through silence. |
| Auto — opt-in | Estimate tempo and beat phase from the current audio, and display the tracking state. |

Tapping or entering BPM explicitly selects Manual. Auto never takes over a manual
clock by itself. Selecting Off stops the optional clock while audio and visuals
continue. Selecting Auto starts a fresh acquisition for the current source.

### Manual timing

Provide **Tap**, editable **BPM**, **½ / ×2**, and **Align beat now** controls.

- All tap inputs use the same timestamped action. Use a monotonic clock, independent
  of frame rate or the number of drawing patches.
- Show a provisional estimate after two taps; use several recent intervals to
  stabilize it. Four consistent taps should establish a usable tempo. Use robust
  interval statistics so one stray tap does not immediately replace the tempo.
- Ignore key repeat and duplicate pointer/click delivery. A long gap starts a fresh
  tap sequence; an existing manual clock may keep running while the new estimate
  is being established.
- Suggested initial manual range: 30–300 BPM. Invalid, zero, and non-finite values
  are rejected without changing a working clock.
- Taps establish both tempo and intended beat alignment. Subsequent correction
  should be gradual; **Align beat now** explicitly reanchors phase immediately.
- Changing BPM or applying ½ / ×2 preserves current phase and changes its future
  rate. It does not manufacture an audio hit or replay past clock pulses.
- `t` is the proposed tap shortcut, available after releasing editor focus. It must
  not consume characters inside text fields. A focused Tap button also supports
  ordinary keyboard activation without triggering audio playback at the same time.

### Automatic timing

Treat this as a live causal tracking problem: the performer cannot wait for a song
to end, and microphone input has no future samples to inspect.

1. Consume timestamped onset-strength information at a stable audio-analysis rate.
   The existing per-render-frame `audio.onset` boolean is useful visual input but
   is not a sufficient sampling pipeline for dependable tempo estimation.
2. Track several plausible periods over a bounded recent window. Evaluate both
   tempo and alignment; taking the reciprocal of the last hit interval is insufficient.
3. Prefer stable hypotheses and handle half/double-tempo ambiguity. Expose ½ / ×2
   as a metrical preference in Auto; an explicit BPM edit or Tap selects Manual.
4. Enter tracking only after sustained supporting evidence. Smooth rate and phase
   corrections to avoid jerking every visual when an estimate changes.
5. Publish a quality score and age of supporting evidence. Treat confidence as a
   calibrated tracker-quality signal, not a probability of being musically correct.
6. During a short dropout, continue prediction with a visible **Holding** state.
   After a bounded grace period, stop the optional clock and show **Lost**. Start
   with a three-second grace period as a tunable rehearsal default.

Use a fixed-hop audio analysis path for Auto. An AudioWorklet can hand bounded,
timestamped blocks to a worker for feature extraction/tracking; avoid heavy analysis,
unbounded allocation, or growing queues in the audio callback. Keep this optional
path independent of the existing visual audio snapshot. Discard stale results after
a source change, seek, or reset using a source-generation identifier.

Map audio sample timestamps into the host's monotonic time domain. Reestablish that
mapping after audio-context suspension/resume; audio time and wall time cannot be
assumed to advance together. Measure analysis delay and compensate the predicted
phase explicitly instead of timestamping a late worker message as a new beat.

Before selecting an estimator, compare a small causal baseline with a suitable
existing implementation using the same fixtures. Check browser delivery, dependency
size, licensing, CPU cost, and timestamp/latency behavior. No new dependency is
selected by this plan. Whole-track analysis can be considered separately for files.

## Runtime contract

Use one host-owned rhythm service, sampled once before drawing. Every patch and
shader in a frame receives the same read-only clock snapshot.

Proposed fields:

| Field | Contract |
| --- | --- |
| `clock.source` | `off`, `manual`, or `auto` |
| `clock.status` | `off`, `listening`, `running`, `holding`, or `lost` |
| `clock.running` | True while the clock advances, including bounded Holding |
| `clock.bpm` | Effective BPM while advancing; `null` when unavailable |
| `clock.beat` | Continuous beat position; initially zero, held when stopped |
| `clock.phase` | Fractional beat position from 0 inclusive to 1 exclusive |
| `clock.tick` | True if at least one clock beat boundary was crossed this frame |
| `clock.crossings` | Number of boundaries crossed since the previous sample |
| `clock.confidence` | Auto quality score from 0 to 1; `null` for Manual or Off |

Phase and beat position are retained when tracking is lost, so beat-based motion
can hold its current value. Before a clock has ever run, beat-based helpers use
their initial phase. Seconds-based helpers continue normally. Show the stopped
status clearly; do not silently switch beat-based motion to an arbitrary BPM.

Use absolute monotonic elapsed time for tempo advancement, not the host's capped
simulation `dt`. During ordinary low frame rates, calculate crossings arithmetically
and deliver one snapshot; do not loop over missed beats to invoke callback bursts.
After tab suspension or a long scheduling gap, suppress catch-up pulses. Manual
reconstructs current phase; Auto invalidates stale evidence and reacquires.

Maintain phase continuity through ordinary rate corrections and source handoffs.
Explicit alignment is a marked discontinuity: clear stale crossing bookkeeping,
emit at most one intentional pulse, and never replay earlier beats.

## Visual signal helpers

Include all six operators in this delivery. They produce changing values for
visual properties such as size, rotation, color, opacity, and shader parameters.
They do not generate audio or introduce another scene-composition language.

| Operator | Initial behavior | Visual use |
| --- | --- | --- |
| LFO | Repeat a sine, triangle, saw, or square wave within a range. | Breathe a shape's size or oscillate distortion. |
| Attack/release envelope | A trigger rises from the current value to a peak over attack time, then falls to rest over release time. | Flash on an audio hit, then fade smoothly. |
| Ramp | Move from a start value to an end value over a duration and hold the endpoint. An optional trigger restarts it. | Zoom in over several seconds. |
| Stepped sequence | Select successive numeric values at a time interval or on a trigger; wrap at the end. | Change a palette index on each detected hit. |
| Range mapping | Convert a numeric signal from one range to another, with explicit clamping. | Map bass energy from 0–1 to a diameter of 20–200. |
| Seeded variation | Choose a reproducible numeric value for each timed or triggered step. Hold between steps. | Change position or hue without random flicker every frame. |

All helpers return ordinary functions accepting the draw context and returning a
number. A p5 patch can call that function with its context; array effects and
ShaderChain can accept it through their existing parameter callback paths. Mapping
can consume another helper, so the operators compose without special wiring.
Instantiate a helper once outside drawing, then reuse it wherever needed.

Use `lfo`, `envelope`, `ramp`, `sequence`, `remap`, and `variation` as working names
for the plan. Final exports must pass a namespace audit against p5, the live API,
and editor bindings before implementation. In particular, avoid repurposing p5's
`map()` or `random()`. These are ordinary live-code helpers, not new Array methods.

Proposed syntax, not current API:

```js
const breathe = lfo({ period: 4, min: 0.7, max: 1 }); // four seconds
const synced = lfo({ beats: 4, min: 0.7, max: 1 });   // four clock beats

const scene = [backdrop, [rings].opacity(synced)];
scene.draw();
```

The named patches above stand for existing patch definitions. This illustrates the
shared callback contract; exact option signatures for the other helpers will be
specified together before implementation.

### Time and trigger contracts

- Seconds are the default time unit. Beat durations explicitly opt into
  `context.clock`; conflicting time bases are errors. For the LFO example,
  `period` means seconds and `beats` means clock beats. Phase zero starts at the
  low endpoint of the default sine cycle.
- Time-driven motion uses shared host time or beat position, independent of scene
  time and the number of consumers. Beat-driven motion holds when the clock stops;
  seconds-driven motion and audio triggers continue with timing Off.
- A trigger is an event, such as a detected onset, a clock boundary, or a rising
  edge deliberately derived from a control. Specify pulse and held-gate adapters
  explicitly: a held control must not retrigger every frame, while distinct onset
  events must not be collapsed merely because they arrive in adjacent frames.
- Envelopes start at rest and retrigger from their current value to avoid a jump.
  The initial envelope has attack and release only, without sustain. Zero attack
  or release is an intentional immediate transition; durations cannot be negative.
- Ramps without a trigger start when their defining code is successfully applied.
  Triggered ramps wait at the start value; retriggering restarts from that specified
  value. This deliberate reset differs from an envelope's continuous retrigger.
  A completed ramp holds its endpoint; repetition uses an LFO or a repeated trigger.
- Sequences initially expose their first value. Each subsequent trigger or timed
  boundary advances one step. Periodic sequences derive the current index directly
  from elapsed time; clock-triggered sequences account for `clock.crossings` during
  ordinary missed frames. Neither emits a burst of callbacks to catch up. Suppress
  trigger backlogs after suspension, consistent with the clock contract.
- Seeded variation derives its value from a seed and logical step index, rather
  than consuming p5's global random stream. The same seed, settings, and step index
  reproduce the same value across render rates. Audio-triggered variation also
  depends on the actual trigger history; this is not a promise of audio replay.

### Sampling, state, and validation

Every helper sees the same frame inputs. Repeated reads in one frame return the
same value: using an envelope in three parameters must not advance it three times.
Shared helper instances share state; two separately constructed envelopes respond
independently. Chaining a mapper around an envelope must preserve this behavior.

Derive periodic values directly from absolute time. Stateful helpers need a host
sampling/lifecycle contract with a frame identifier, timestamped triggers, and
explicit ownership. Do not let draw order or whether one shader parameter happened
to be read determine which events a live helper observes. Finalize enrollment,
replacement, and disposal of these helpers as part of the existing evaluation
transaction before adding their public exports; failed evaluation must leave the
running helpers untouched. This is bounded signal state, not a second scheduler.

New stateful helper definitions start fresh when successfully applied: envelopes
at rest, ramps at their start, and triggered sequences/variation at index zero.
Unchanged helper instances continue across patch edits and scene selections.
Periodic LFOs retain their relationship to shared host time/beat position. Document
this distinction in the example rather than implying that source edits can infer
and migrate arbitrary closure state.

Validate finite numeric values, nonempty numeric sequences, positive periods, and
nonnegative envelope/ramp durations. A zero-duration ramp reaches its endpoint
immediately. Range mapping rejects a zero-width input range; reversed ranges are
valid for inversion, and clamping defaults on. Reject conflicting timing/trigger
options rather than silently choosing one. Detect cyclic signal dependencies and
report invalid callback results through normal live-code diagnostics while
preserving the last working scene.

Keep the initial outputs numeric. Palette selection can use a numeric index in
ordinary JavaScript; vector/color objects and an editable modulation-routing graph
are outside this delivery.

## Performer interface

Add a compact **Rhythm** section to **Tools → Audio**:

- timing source selector: Off / Manual / Auto;
- Tap and BPM, with ½ / ×2 and Align beat now;
- separately labeled **Detected hit** and **Clock beat** indicators;
- Auto status: Listening, Tracking, Holding, or Lost, plus an optional quality meter.

When timing is enabled, offer a compact toolbar readout with BPM and a tap target.
Respect the existing hide-navigation command. Keep detailed controls in Tools.
Use text and accessible labels alongside indicators; do not announce every beat
through an ARIA live region. Announce source and tracking-status changes instead.

Exact code-token highlighting, a piano roll, meter inference, quantized scene
launch, MIDI clock, and Link are later extensions, outside the initial delivery.
Run continues to apply code immediately at a rendering boundary.

## Audio changes, scene changes, and persistence

| Event | Expected behavior |
| --- | --- |
| Patch edit or scene selection | Rhythm continues; visual scene time may restart independently. |
| File/microphone source change | Clear Auto evidence and queued analysis; keep Manual tempo. |
| Seek or file loop discontinuity | Reacquire Auto; do not mistake pre-seek evidence for the new position. |
| Audio pause, silence, or input failure | Manual continues; Auto enters Holding then Lost unless evidence returns. |
| Resume after suspension | No catch-up event burst; discard stale Auto results. |
| Reevaluate a helper | Apply a new definition transactionally; periodic motion uses shared time, while new stateful definitions start fresh as specified above. |

Persist timing source, manual BPM, and user metrical preference with project and
performance settings. Do not serialize analysis buffers, tap history, confidence,
or an estimated live phase as though it will still match future audio.

On reload, Manual starts a new phase from its saved BPM; Auto starts Listening.
During live performance recall or Safe State restore, apply saved settings without
rewinding the current beat position. A tempo-setting change preserves current
phase; entering Auto reacquires. Safe State remains visual/project recovery, not
an attempt to rewind live sound. Saved-setting application must participate in
recall failure recovery so a rejected recall does not leave timing changed.

Update project/performance storage, import/export, restore paths, and validation
together. Follow the existing schema policy; do not introduce legacy adapters.

Helper definitions and seeds live in source. Project export does not capture a
live envelope's position or pretend to replay prior triggers. Reconstructing source
on recall uses the helper initialization rules above. In-memory rollback must
retain the previous helper instances and their state when an evaluation or recall
fails. Specify Safe State's helper reset behavior alongside its existing occurrence
state behavior; do not silently claim that arbitrary signal closures are restored.

## Delivery sequence

Suggested code boundaries: pure clock/tap logic in `src/rhythm/clock.js` and
`tapTempo.js`; source selection and snapshots in `src/rhythm/rhythmManager.js`;
visual helper definitions and sampling in `src/signals/` so they do not require a
running tempo clock; optional causal tracking in `src/rhythm/tempoTracker.js`.
The Auto analysis producer/worker belongs at the audio boundary. These are proposed
files. Wire the service through the existing
host, controller, and persistence interfaces rather than putting its state in UI
handlers or individual patches.

### 1. Clarify hits and implement Manual

- Rename the onset fields/hook and update all shipped consumers.
- Add pure, independently testable tap-tempo and phase-clock modules.
- Wire one rhythm service into the host/controller, Audio panel, shortcut map,
  performance settings, and persistence.
- Add a small diagnostic scene: one mark for detected hits, one for clock beats,
  and a smoothly rotating hand for beat phase. It must work in silence with Tap.

Completion: accurate Manual timing, clear source/status, no changes to audio
reaction semantics, and consistent shared phase across patches and shaders.

### 2. Add the visual signal library

- Specify the six helpers' options, units, trigger adapters, validation, and names
  together; check p5/live API collisions and editor reserved names.
- Implement pure sampling first: LFO waveforms, range mapping, time-indexed
  sequences, and seeded values. Add the shared sampling/lifecycle contract before
  introducing envelopes, triggered ramps, and triggered stepping.
- Wire helper construction and ownership through evaluation, replacement, recovery,
  and disposal. Reuse the current context-callback interface for p5 and shaders.
- Add a runnable Motion Lab with all six operators: a breathing shape, hit-driven
  glow, gradual zoom, stepped palette index, bass-to-size mapping, and reproducible
  variation. Show seconds and optional beat timing side by side. Include a manual
  trigger so envelopes and sequences can be tested without sound.
- Verify timing Off, Manual, shared reads, nested helper composition, patch/scene
  changes, helper replacement, and failed evaluation/recall.

Completion: all six helpers work in p5 patches and array/shader effects without new
scene syntax or per-consumer clocks. Their audio-reactive and seconds-based uses
remain useful without tempo estimation. Auto is not a dependency for this stage.

### 3. Evaluate and integrate Auto

- Build timestamped fixtures and an estimator comparison harness first.
- Introduce the bounded audio-analysis path and tracker behind the same service.
- Implement acquisition, smoothing, metrical preference, Holding, and Lost states.
- Expose Auto only after the comparison meets agreed accuracy and load targets.
  If results remain unreliable, retain the useful Manual feature and record the
  failing cases rather than presenting unstable estimates as dependable timing.

Completion: the tracker follows representative audio, admits uncertainty, and
cannot interrupt Manual timing or ordinary reactive visuals.

### 4. Rehearse and document

Update the data model, API, quickstart, and manual keyboard table. Publish runnable
tempo diagnostic and Motion Lab examples. Rehearse with a file, microphone/line
input, quiet material, changing tempo, and deliberate errors. Tune defaults from
those observations.

## Verification and proposed acceptance targets

These are targets to validate during implementation, not measured results.

- **Tap:** synthetic exact taps recover their period; eight taps with modest
  jitter stay within 2% of target BPM. Test a stray tap, tempo change, long pause,
  key repeat, pointer duplication, and the low/high supported tempo bounds.
- **Clock:** ten minutes of simulated time has no accumulated phase error beyond
  numeric tolerance, regardless of render sampling at 15, 30, 60, or 120 FPS.
  Test missed frames, rate changes, alignment, source switches, and suspension.
- **LFO:** repeated reads in one frame agree; output stays within its bounds;
  verify all waveform boundaries, phase offsets, and inverted ranges. Seconds mode
  needs no audio; beat mode holds cleanly when timing stops.
- **Envelope and ramp:** verify attack/release duration, endpoint holds, zero
  durations, retriggers, and late frames against timestamped expected values.
  Reading the output from multiple consumers must not speed it up. Test pulse
  events in adjacent frames separately from a sustained gate.
- **Sequence and variation:** verify first value, wraparound, missed boundaries,
  repeat reads, suspension, and Off behavior. The same seed and logical indices
  yield identical values at different render rates without altering p5 randomness.
- **Mapping and composition:** verify endpoints, clamping, inversion, invalid input
  ranges, and an envelope mapped into both a p5 property and shader argument.
  Reject cyclic dependencies and non-finite signal values with useful diagnostics.
- **Signal lifecycle:** unchanged helpers continue; replacements follow documented
  initialization; failed edits and recalls retain prior signal state. Repeated live
  edits must not accumulate helper registrations or retain old patch resources.
- **Auto:** begin with synthetic and recorded, licensed test inputs covering a
  steady pulse, syncopation, missing kicks, loudness changes, sustained tones,
  ambient audio, tempo changes, and ambiguous half/double interpretations.
  Proposed steady-pulse target: establish tempo within ten seconds, within 2% BPM
  and 60 ms median beat alignment after compensating measured analysis delay.
- **Honest uncertainty:** silence and sustained tones should not create a confident
  grid. Score half/double errors explicitly rather than counting them as correct.
  Report per-fixture failures and reacquisition time; do not claim universal beat
  detection from a successful click-track test.
- **Load:** adding Auto should keep median frame time within 5% of the same scene's
  baseline on the rehearsal machine and avoid sustained growth of queues or memory.
  Measure audio analysis separately from visual rendering.
- **Browser workflow:** tapping while code is focused types normally; releasing
  focus enables the shortcut; switching scenes keeps phase; source failure leaves
  visuals running; settings round-trip and rejected recalls recover correctly.

## The Strudel reference

Strudel highlights the part of a musical pattern responsible for a currently
playing event. It is a reference for making live behavior legible, rather than a
dependency for this feature. Astra's first application is the separately labeled
hit/clock indicators above. Exact source-token tracing can be assessed later.
[Strudel REPL documentation](https://strudel.cc/technical-manual/repl/)

Automatic beat-tracker research should distinguish causal processing from full-file
analysis. Aubio documents incremental tempo processing, confidence, beat timestamps,
and delay; Essentia's RhythmExtractor2013 tutorial explicitly describes its use of
whole-track statistics. Neither is selected here.
[Aubio tempo API](https://aubio.org/doc/latest/tempo_8h.html),
[Essentia beat-detection tutorial](https://essentia.upf.edu/tutorial_rhythm_beatdetection.html)
