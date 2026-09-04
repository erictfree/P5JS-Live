# p5js live: initial look around

Reviewed 2026-09-04 at 1280×720 in the Codex in-app browser, using the existing browser-local afterglow performance. This was not a clean-profile onboarding test. No application source was changed.

1. Entry — healthy. `01-entry.png`: clear audio-file, microphone, and silent entry choices, with visible keyboard focus. Silent entry worked. The mascot makes the welcome screen approachable; its tone differs from the spare performance workspace.
2. Performance workspace — strong visual identity, readability concerns. `02-performing.png`: full-window composition and folded source keep the instrument immediate. Toolbar glyphs and bottom hints are very small and visually subdued against animated output. The existing uncommitted dimmer feature addresses a real need; consider a discoverable control for it. The visible runtime reported approximately 60 FPS during inspection, not a benchmark.
3. Library — functional navigation, ambiguous counts. `03-library.png`: the source-first install/add/evaluate explanation is useful. Library reports 11 installed and 3 active while the runtime reports 18 installed and 10 active. `src/ui/panels.js:143` counts only library entries, whereas the runtime uses project-wide installed patches and scene occurrences. Explain count scope explicitly. All library groups initially appear collapsed, adding a discovery step.

Accessibility: the hidden tools and reference drawers remain in the browser accessibility tree in step 2. `src/main.js:936` toggles a CSS class; `src/ui/styles.css:718` moves drawers offscreen and disables pointer events without making their contents inert. Apply inert while closed and expose expanded state on the toggles. Small controls and animated backgrounds also merit contrast, zoom, and keyboard checks. Screen-reader operation and full accessibility compliance were not tested.

Architecture: the persistent host, transaction staging, first-frame validation, and independent instance state form a coherent performance model. Source remains the composition authority. `main.js` (1715 lines) and `editor.js` (1580 lines) are the main maintainability pressure points; extract cohesive responsibilities as they change rather than undertaking a broad rewrite.

Validation: npm test passed all 244 tests across 24 files. Browser inspection covered silent entry, existing performance rendering, and tools/library navigation. Audio input, MIDI hardware, audience projection, AI requests, end-to-end suites, and long-duration performance were not exercised.

Suggested order: fix hidden-drawer accessibility, clarify library/runtime count scope, then improve discoverability and readability without crowding the stage.
