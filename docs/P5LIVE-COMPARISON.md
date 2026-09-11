# P5LIVE comparison and workflow opportunities

Reviewed 9 September 2026 against P5LIVE's public main branch and this project's current source/manual.

## Conclusion

Astra's next improvement should be making composition easier to author, recover, and carry between machines. More effects alone will not address its biggest workflow gaps. Keep the array-based scene model, explicit Run, shared audio/signals, and performance recall; build better assistance around them.

This is a documentation and source review, not a hardware compatibility test or an execution test of every external demo. Repository contents may differ from a deployed version.

## P5LIVE inventory

The [official project documentation](https://github.com/ffd8/P5LIVE#readme) describes these capabilities:

| Area | Offerings |
| --- | --- |
| Editing | Soft/hard compilation, autocompile, completion, parameter placeholders, configurable shortcuts/themes |
| Learning | Embedded p5 reference, snippets editor/manager, community snippets |
| Organization | Nested folders, cloning, filtering, imports/exports, autosave/backups |
| Performance | Separate output/code windows, view-only/exhibit modes, chalkboard, animated snippet insertion, keyboard sonification |
| Extensibility | Library loading, p5 version selection, Hydra/HY5, Strudel |
| Collaboration | Shared editing/chat, permissions, synchronized data |
| Process capture | Timestamped code recording, playback, scrubbing, export |
| Connections | MIDI; OSC through local server |
| Reliability | Loop protection, recovery entry points |

These are distinct from video recording: RECODING records editing activity. Collaborative source synchronization also differs from sending canvas video. Neither implies deterministic audiovisual replay.

### Complete demo-family inventory

The [demo catalog](https://github.com/ffd8/P5LIVE/blob/main/includes/demos/P5L_demos.json) contains 53 sketch entries: 51 examples in 13 folders, plus `new` and `recoding` workspaces.

| Folder | Entries | Subjects |
| --- | ---: | --- |
| meta | 3 | P5LIVE, collaboration, basel.codes |
| canvas | 7 | Small/poster/embed, chalkboard/animation, lo-fi, canvas API |
| audio | 4 | Analysis, Tone.js, XYscope, Strudel |
| math | 4 | Lissajous, sine strings, noise, easing |
| webgl | 4 | Primitives, OBJ, vertices, sphere/box |
| typo | 4 | Text-to-points, OpenType, Google Fonts |
| gui | 1 | Slider grid |
| libs | 3 | Glitch, Voronoi, non-p5 |
| input | 5 | Webcam/synthesis, MIDI/custom MIDI, OSC |
| hardware | 3 | Gamepad, serial, AR |
| HY5 | 6 | p5/Hydra texture exchange |
| hydra | 1 | Hydra-only |
| shaders | 6 | Warp, matcap, texture, Shadertoy template, blur, chromatic aberration |

The serial and AR examples explicitly retain p5 v1. Their presence does not prove general compatibility with our bundled p5 v2.3.2. The embed demo places an iframe behind the canvas; it is not an arbitrary website-to-shader texture importer.

## Comparison with Astra

Local evidence: `src/ui/editor.js`, `src/main.js`, `src/ui/projection.js`, `src/control/`, `src/persistence/`, `src/signals/`, `src/network/`, `index.html`, and `docs/USER-MANUAL.md`, `docs/API.md`, `docs/NETWORKING.md`.

| Capability | Astra today | Assessment |
| --- | --- | --- |
| Composing visuals | Nested arrays, chained effects, callback parameters, modulation image input | Core capability already present; improve authoring |
| Audio and motion | Shared analysis, tap/manual/experimental automatic rhythm, reusable signal operators | Substantial existing capability; demonstrate it better |
| Performance control | Named performances, quantized launching, virtual controller, MIDI Learn | Already present; physical Push verification remains outstanding |
| Code-as-image | Transparent `codeView()` patch; projection support | Already present; no need to build again |
| Completion/signatures | Highlighting and cell tools; no code completion/signature system found | High-value gap |
| Reusable fragments | Catalog patch installation/sharing, new-cell and array-wrap actions | Partial; no general reusable snippet manager found |
| Reference | Application reference and detailed manual | Partial; not an embedded full p5 reference/completion experience |
| Assets/dependencies | Local media supported; files omitted from project export; bundled p5 | Missing managed project assets/dependency lifecycle |
| Organization | Library filters, shared patches, named performances, project import/export | Present; collection/folder workflow could improve |
| Recovery | Autosave, version/safe state, candidate rollback | Present; not a chronological session recorder |
| Loop protection | Manual explicitly warns blocking code can freeze the tab | Reliability gap |
| Collaboration | Experimental canvas sharing; Network UI unavailable | No shared source editor |
| Output capture | Projection available; manual says recording unimplemented | Missing product workflow for capture |
| Other inputs | MIDI supported; OSC explicitly absent | Gamepad/serial/camera need intentional integrations, not merely API availability |
| Music engines | Reactive visuals architecture | No documented managed Strudel/Tone/Hydra integration |

A p5 technique being possible does not make its full example directly portable. Our host owns the main canvas and patch lifecycle. Raw sketches using global setup/draw, DOM nodes, event listeners, cameras, and their own WebGL canvas need adaptation and cleanup.

## Recommended order

### 1. Make the next line easy to write

Add contextual completion for installed patch names, array effects, `audio`, `clock`, and signal operators. Show argument signatures and short examples next to the cursor. Add a keyboard snippet picker for common compositions and reactive callbacks.

Examples of useful insertions: wrap selection in an array, audio-driven repetition, time-driven rotation, an envelope, and a nested group. Keep insertion separate from Run. Unknown patch names should offer nearby installed names; parse errors should point to the offending token.

This directly addresses observed mistakes such as malformed callback syntax and misspelled patch references. It improves speed without inventing a second visual programming language.

Acceptance: build an audio-reactive two-patch scene using completion and snippets without consulting the manual. Keyboard ownership must remain clear so performance shortcuts do not insert accidental text.

### 2. Make a performance portable

Introduce project assets with stable references for images, fonts, video, and models. Show loading/error states. Export a project bundle with selected local assets and a manifest; validate missing files before performance recall. Store dependency versions and licensing metadata where applicable.

Asset creation/disposal must follow the host lifecycle: changing a patch should not leak video elements, camera tracks, event listeners, or WebGL buffers. Do this before promising paste-in support for arbitrary p5 examples or external engines.

### 3. Make recovery chronological

Add a bounded local session journal of accepted runs, source revisions, performance launches, and control changes. Start with an inspectable timeline and restore/copy actions. Later add deliberate playback.

Keep draft edits, accepted runs, and live actions distinct. Replaying source alone cannot reproduce microphone input, external MIDI, random values, or GPU feedback. Audio/video recording is a separate feature with its own resource budget.

Separately investigate loop guards in evaluated code. Add recovery startup that can open saved source without evaluating it. Instrumented loop guards mitigate common mistakes but cannot promise interruption of every blocking operation.

### 4. Teach the capability we already have

Publish a small, tested technique collection: reactive typography, webcam texture, OBJ scene, feedback/modulation, and a controller-driven composition. Each should include a minimal version, a performance version, dependencies, and one suggested edit.

Organize examples by creative intent—text, camera, geometry, feedback, rhythm—alongside technical categories. Avoid installing a large scene merely to demonstrate one operator.

### 5. Add integrations when a performance needs them

Prioritize OSC if integrating with a DAW or another stage tool becomes a concrete need. Consider Strudel as an optional event source when users generate music inside the app; this is different from analyzing arbitrary incoming music. Explore collaboration separately from canvas networking.

Do not add a second synthesis engine solely for feature parity. Our composition and rhythm systems already provide a coherent foundation. Physical controller feedback/display work still needs device testing.

## Scope recommendation

First implementation batch: contextual completion/signatures, a compact recipe picker, clearer keyboard focus, and targeted error locations. Next: assets and recovery. Defer collaborative editing, AR, serial hardware, and broad engine hosting until a specific use case justifies their lifecycle and deployment costs.

No runtime changes were made for this review.
