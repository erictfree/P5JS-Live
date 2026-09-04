# Tools workspace implementation

Approved reference: `design-audit/tools-review/panels.html`.
Checkpoint: `d3c1444`, committed and pushed before implementation.

## Work plan

1. Replace equal-weight navigation with Library, Controls, Audio, and Performances;
   put Settings, Messages, and AI assistant below scrolling content. Preserve saved
   section names, add wide/compact preference, and make narrow Tools fill the screen.
2. Lead Library with search and category/scope filtering. Show descriptions, pending
   scene additions, and clear next actions. Preserve explicit source review and Run.
3. Make live controls readable and keep DOM/focus stable during parameter changes.
   Move MIDI device setup below controls and retain all existing control types.
4. Add real audio loading, input and transport actions in the Audio panel, with
   playback progress and normalized signal readings. Retain existing audio engine.
5. Organize performance/file/recovery actions and interface settings. Lead AI with
   the editor entry point and collapse connection configuration. Prioritize warnings
   and errors in Messages and count only those in the badge.
6. Verify browser behavior, responsive layout, existing regression tests, unit tests,
   and production build; commit and push the implementation.

## Implementation notes

The mockup's example data, simulated hardware, and fabricated audio waveform are
not shipped into the app. Signal values come from the controller's shared audio
snapshot. Playback progress is read-only; this change does not add seeking to the
audio engine. Saved opacity preferences are preserved; fresh installations use a
solid panel. Performance recall and file actions retain their existing behavior.

The mobile drawer closes when locating source. Focus uses `preventScroll` when
opening/closing the animated drawer so the browser cannot horizontally scroll the
stage to an offscreen panel. Tabs preserve each section's scroll position, and each
navigation group has a keyboard entry point.

Installing from a filtered Library exposed an existing editor insertion hazard:
the hidden source textarea could fail to take focus, allowing native `insertText`
to write into search instead. Native insertion now requires source-editor focus;
otherwise the authoritative source uses its existing assignment fallback. The
browser regression verifies that the query survives installation and scene review.

## Validation

- `npm test`: 253 tests passed across 25 files.
- `npm run build`: passed after the final UI changes.
- All 87 browser cases verified across the full run and targeted reruns. The full
  run passed 74; 12 failures required updates for approved labels/Review behavior,
  and one exposed the search insertion bug fixed above. The focused 26-case rerun
  passed 25, and the remaining diagnostic-wording assertion passed on its final
  rerun. Runtime lifecycle, shader output, undo, recall, search, audio, and mobile
  source/AI focus checks remain covered.
- Visually inspected the real Library and Audio panels in the in-app browser,
  including saved opacity and the corrected empty signal meter.
- HTML nesting/unique IDs, JavaScript syntax, and `git diff --check`: passed.
