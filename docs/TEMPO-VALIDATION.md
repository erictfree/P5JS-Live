# Tempo algorithm validation

Measured September 7, 2026 on the development Mac. These are local development
measurements, not a claim of universal beat recognition.

## Availability

Manual timing and the visual signal helpers are available normally. Following
the decision to try competing trackers in the instrument, **Auto · experimental**
is now enabled on `/live/`. **Pulse (PLP)** is its default algorithm; **Onset grid**
retains the earlier tracker for live comparison. New projects still start with
timing Off. General music accuracy remains unproven; opening experimental access
does not mean the accuracy checks below have passed.

## Pulse implementation and first comparison

Pulse is an original streaming implementation inspired by the real-time
[predominant local pulse research by Meier, Chiu, and Müller](https://transactions.ismir.net/articles/10.5334/tismir.189).
It computes a causal Fourier tempogram over up to six seconds of continuous
spectral novelty, searches 60–200 BPM, and combines recent pulse kernels to obtain
phase and tempo. Overlapping kernels cover 0.75 seconds. All audio is past or
present; projecting the pulse forward does not read future samples. This is a
compact adaptation, not a reproduction of the paper's benchmark system.

The detector shares the existing 2048-sample FFT / 512-sample hop frontend. It
requires multiple supported beats and stable phase before publishing an estimate.
Evidence timestamps only advance with supporting audio; repeated predictions
cannot keep the clock running indefinitely after sound stops. The worklet and
worker queues remain bounded. Selecting another algorithm replaces the worker and
invalidates its generation, preserving the existing rejection of late results.
No third-party DSP dependency, copied implementation, or model weights were added.

The updated harness exercises the shared production detector through the actual
worklet. First estimate now means **batch delivery time**, including acquisition
and buffering, rather than the timestamp of an earlier supporting hit.

| Original audio fixture | Pulse first estimate | Final BPM | Median beat alignment error |
| --- | ---: | ---: | ---: |
| 60 BPM | 3.33 s | 60 | 6.51 ms |
| 90 BPM | 2.99 s | 90 | 5.83 ms |
| 123 BPM | 2.99 s | 123 | 5.21 ms |
| 150 BPM | 2.99 s | 150 | 5.07 ms |
| 180 BPM | 2.99 s | 180 | 4.91 ms |
| Dense hats, missing kicks, sustained chord | 2.99 s | 120 | 8.19 ms |

Missing hits, syncopation, ±8 ms jitter, a 120→150 BPM change, 44.1/48 kHz input,
and loss of audio also pass. Silence, a sustained tone, and deterministic broadband
noise emit no estimates. These are generated fixtures, not a music accuracy score.

On the existing unannotated 67.97-second `intro.mp3`, Pulse supplied fresh supported
tracking for **36.5%** of the full duration versus **13.9%** for Onset grid. This
counts the union of delivered estimates' 0.75-second freshness intervals, excludes
Holding, and includes startup time. It does not count repeated estimates as new
coverage. Pulse's first estimate arrived at **14.59 s**, versus **2.73 s** for grid;
the final estimates were approximately **130** and **130.72 BPM**. More coverage is
not proof of correct beats. This clip still exposes dropouts and slow acquisition.

## Earlier Onset grid measurements

### Causal audio fixtures (Onset grid)

The harness runs the actual AudioWorklet processor on generated mono PCM, then
the production spectral-onset and grid-tracking modules. It does not supply beat
times to the algorithm. Expected event times are used only to score its output.
Fixtures are deterministic original test sounds; no downloaded music is bundled.

| Input | First estimate | Final BPM | Median alignment error |
| --- | ---: | ---: | ---: |
| 60 BPM | 8.25 s | 60.00 | 4.67 ms |
| 90 BPM | 4.25 s | 89.96 | 4.33 ms |
| 123 BPM | 3.17 s | 122.95 | 4.21 ms |
| 150 BPM | 2.65 s | 150.00 | 4.67 ms |
| 180 BPM | 2.58 s | 180.18 | 8.67 ms |
| Missing hits | 3.74 s | 119.76 | 2.33 ms |
| Syncopation | 2.24 s | 119.76 | 4.67 ms |
| Jitter ±8ms | 3.23 s | 120.24 | 7.33 ms |
| 120 → 150 BPM | 3.24 s | 150.00 | 7.33 ms |
| Silence | — | — | — |
| Sustained tone | — | — | — |

Steady 60–180 BPM fixtures meet the initial ten-second acquisition, 2% BPM, and
60 ms median alignment targets. Silence and a sustained tone produce no estimates.
Missing hits, syncopation, level changes, jitter, and a 120→150 BPM change are
included. The automatic search range is currently 60–200 BPM before ½ / ×2.

### Established implementation comparison (before Pulse)

Compared aubiojs 0.2.1 (Tempo, 2048-sample window, 512-sample hop, 48 kHz) on the
same causal buffers. It was installed only under `/tmp`; no new application
dependency or third-party DSP code was added.

Aubiojs generally acquired the clean fixtures in about three seconds. It selected
roughly 91 BPM on the 180 BPM fixture: that half-tempo result is recorded as an
error, not counted as correct. Its wrapper also returned tempo events on the
sustained-tone fixture; this comparison did not impose a calibrated confidence
threshold on those events, so it is not evidence that all such events should be
presented as confident to a performer.

The repository’s 67.97-second `assets/sounds/intro.mp3` was decoded locally for
comparison. It has no annotated beat ground truth, so agreement between algorithms
cannot establish accuracy. The new tracker emitted 18 supported updates, with
an early ~87 BPM interpretation and a late ~130 BPM interpretation. Aubiojs emitted
143 tempo events and ended near 131.55 BPM. The long gap in that tracker's support
originally kept Auto behind a preview URL.

The spectral detector improved transient analysis compared with the initial
energy-only prototype, but did not solve that recorded-audio failure. The obsolete
energy detector was removed. Do not lower confidence thresholds merely to make
the indicator remain lit.

The [aubiojs project](https://github.com/qiuxiang/aubiojs) documents its JavaScript
Tempo wrapper; the [aubio API](https://aubio.org/doc/latest/tempo_8h.html) documents
incremental processing and confidence. The upstream library and wrapper have
different license declarations, another reason this comparison does not imply a
runtime dependency decision.

## Reproduce

```sh
npx vitest run tests/unit/rhythm.test.js tests/unit/signals.test.js tests/unit/tempoTracker.test.js
npx playwright test tests/e2e/rhythm.spec.js
node scripts/benchmark-tempo.mjs
```

For the optional comparison, install aubiojs in a temporary directory with install
scripts disabled, then pass its absolute `build/aubio.js` path as `--aubio=PATH`.
The benchmark accepts `--recording=PATH` for mono 48 kHz little-endian float PCM.
Audio and benchmark dependencies are not copied into the application build.

## Before treating Auto as dependable

- Add annotated, permission-cleared recordings covering dense electronic music,
  acoustic percussion, ambient material, changing tempo, and multiple meters.
- Measure tracking coverage, false locks, half/double errors, phase error, and
  reacquisition time across those recordings, not only generated pulses.
- Compare the selectable algorithms on those recordings while preserving uncertainty.
- Retain source-generation rejection, bounded queues in both directions, and the
  frame-time budget; rehearse with real microphone/line-input hardware.

Browser verification covers actual audio decoding, worklet/worker wiring, Manual
takeover, source removal, namespace checks, shared signal reads, settings reload,
and garbage collection after repeated signal edits. Hardware microphone latency
and cross-browser audio scheduling remain rehearsal work.

## Browser load measurement

With Motion Lab at 1280×720 and code/Tools hidden, 120 actual p5 frames per window
measured a median **17.40 ms with timing Off** and **17.10 ms with Auto preview**.
This met the 5% regression budget in that run; the difference is within ordinary
scheduling noise, not evidence that Auto improves performance. A separate run with
the editor/Tools present measured 20.00 ms and 21.00 ms. Counting display refresh
callbacks was discarded as a measurement method because this Mac can refresh at
120 Hz while p5 is configured to draw at 60 FPS.

## Regression checks

The Pulse/algorithm-selector change passes the full **329-test unit suite**, the
production build, and **10 rhythm browser tests**. Browser checks cover real PCM
through both workers, live switching in both directions, source removal, Manual
takeover, saved algorithm selection, both native menus remaining stable, compact
layout, and beat flashes. Actual p5 frame medians were **22.60 ms Off** and
**22.20 ms Pulse** in the same Motion Lab scene, within the 5% regression budget;
the small difference is scheduling noise. The earlier run described next predates
selectable algorithms.

An additional browser alignment assertion compares the visible Tap flash with
known 123 BPM PCM beats after phase correction settles, including live algorithm
switches. The six sampled Pulse flashes were 37–66 ms from the expected beats;
Onset grid's three samples were 17–40 ms. The reference uses the native audio
buffer's scheduled start because p5/Tone schedules playback ahead of the UI's
reported position. This is a browser scheduling check, not a measurement of
speaker, microphone, or display hardware latency.

Final unit suite: **313 passed**. Browser verification covered the **106-test full
regression suite** plus four added checks for keyboard/button behavior and the
preview gate, collection of discarded helpers, frame time, and narrow Tools layout.
Those added checks and the affected rhythm/documentation cases passed after the
final fixes. Production build, whitespace checks, and 132 local documentation links
also passed. The Auto accuracy gate above remains open despite these software checks.
