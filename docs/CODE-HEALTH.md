# Code health review — 2026-09-07

The current runtime has no abandoned module subtree. The review traced the browser
entry point through 37 modules, checked build/server entry points and package
dependencies, inspected returned APIs and live-code dispatch, and compared CSS and
media references with the interface.

## Cleanup completed

| Area | Change |
| --- | --- |
| Recovery | Removed scene-only panic methods. Safe State restoration remains the single manual recovery action. Startup recovery uses the configured starter, with no special treatment for a patch named `plasma`. |
| Rendering | Removed the flat-scene fallback and unused public access to the per-patch draw helper. The host consumes the recursive scene tree. |
| Audio | Removed the abandoned welcome-preview loader and old analyzer-routing fallback. File and microphone input use the vendored runtime's native audio nodes. Loop changes during loading and playback use the current transport setting. |
| API surface | Removed unused editor/projection methods, the unused network-manager setter, unused state-store method exposures, and an unused microphone-entry variable. |
| Test data | Moved shader-operator and library-group expectation lists out of runtime modules into their tests. The real patch library and shader implementations remain covered. |
| CSS | Removed an obsolete spacer selector and 33 declarations superseded by later rules for the same selectors. Dynamic syntax, network, library, and scene classes remain. |
| Deployment | Added a manifest of current media in `scripts/build-hosted.mjs`. About 7 MB of obsolete media no longer ships; original artwork and design history remain in the repository. |

## Tests that needed repair

The frame-timing test previously defined a patch without selecting a scene, then
accepted an empty sample list. It now selects a scene and verifies that a real draw
receives a capped frame delta after a stall.

The soak test used an old global audio-context accessor and referenced patches and
a scene it never defined. It now creates a named scene containing two p5 patches,
a nested array effect chain, and a backdrop. It checks that the patches actually
run throughout repeated successful edits, syntax errors, and first-frame failures.

A browser test now exercises microphone routing with Chrome's fake audio device,
including real analysis and returning to silence without replacing the canvas,
scene, draw callback, or audio context.

## Verification

- 275 unit tests passed; state and occurrence tests were rerun after the final API pruning.
- All 98 existing Chromium tests and the new microphone test passed.
- The three-minute soak completed 720 evaluations in 191 seconds, averaging
  56.2 FPS. Mean measured heap use was 29.8 MB in the first half and 30.4 MB in the
  second half, a 1.8% increase. Audio, canvas, scene, and lifecycle checks passed.
- Computed styles matched before and after CSS cleanup for 599 elements at
  1280 px and 430 px widths, with the welcome screen and expanded tools states.
- The production build passed, and every local resource reference in its two
  entry pages resolved. Deployment media contains only the current hero and video.

These measurements describe this Chromium run; the 30-minute rehearsal remains a
separate optional check.

## Remaining maintenance opportunities

- `main.js` and `ui/editor.js` still combine many responsibilities. Extracting audio
  entry, performance recall, and keyboard wiring into focused modules would make
  later changes easier to review.
- CSS still contains multiple sections for some components. The overridden
  declarations are gone; organizing each component's base styles and responsive
  rules together would improve navigation.
- Shader lifecycle methods and patch methods are invoked dynamically, so text
  searches alone cannot establish that a method is dead. Keep runtime tests as
  part of future cleanup passes.

The final import/export and tree-shaking scan found no unused runtime exports or
discarded local declarations. This is a scoped code-health review, not a proof that
every possible live-authored program or device combination is correct.
