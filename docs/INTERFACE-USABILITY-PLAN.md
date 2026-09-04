# Interface usability implementation

Checkpoint: `c2fd788`, committed and pushed to `origin/main` before implementation.
Implementation branch: `codex/interface-usability`.

Preserve the full-window canvas, source-authoritative scenes, keyboard commands,
and first-frame rollback. All new controls are performer-only DOM elements.

1. Make orientation clear: clickable live scene name, layer count, safe-state status,
   with detailed runtime counts retained in Messages.
2. Add structured-cell status and Run controls. Distinguish live code from edited
   source; keep errors near the cell. Show success only after frame validation.
   Provide equivalent current-cell feedback in the complete editor.
3. Guide library actions: clarify catalog count scope, name the destination scene,
   make pending scene edits reviewable, and let running patches open their source.
4. Label essential toolbar controls and expose the existing performer-only dimmer.
   Keep closed drawers inert, reflect expanded state, and restore focus on closure.
5. Add a dismissible first-edit hint for new projects without interrupting returning
   performers or automatically evaluating edits.
6. Verify with focused behavior tests, the full unit and end-to-end suites, build,
   and browser inspection at 1280×720. Record results and commit the final change.

Acceptance: a performer can identify the live scene, find and edit a cell, see
unapplied changes, run it, understand a failed replacement, restore safe state,
and dim the background without knowing keyboard shortcuts. Library additions
remain source edits until explicitly run. Projection receives no new chrome.

## Results

All six steps implemented.

- Clickable live-scene identity, layer count and safe-state readiness replace the
  ambiguous stage counts. Detailed counts and FPS remain in Messages.
- Structured cells and the complete editor expose Run, Live/Edited state and local
  results. Evaluation receipts distinguish applied work from discarded work;
  first-frame failures retain the previous code and remain visible beside the cell.
  Lifecycle cleanup warnings are distinguished from rejected replacements.
- Open-cell controls remain available while scrolling. Source navigation targets
  the requested line, and first entry selects Plasma's speed value.
- Library labels scope counts to catalog entries. Pending additions can open their
  scene for review; active patches can open their source.
- Key controls have text labels, the dimmer has a visible pressed state, and closed
  drawers are inert with expanded-state attributes and Escape focus restoration.
- The first-edit hint is dismissible and does not reappear for restored projects.

Validation on 2026-09-04:

- 253 unit tests passed in 25 files.
- All 78 existing browser cases are covered: the full run passed 73, with five
  old label/layout expectations updated and passing on targeted rerun. The rerun
  also rechecked AI staging, live replacement, folding and source navigation.
- Four new browser cases passed: first entry and drawer focus; cell Run with syntax
  and first-frame errors; source-only library additions; complete-editor Run and AI
  acceptance. Total: 82 browser cases covered across the full run and reruns.
- Production build and whitespace checks passed.
- The final interface was inspected in the in-app browser at 1280×720, including
  long-scene navigation and performer-only dimming. Preview:
  `design-audit/astra-lookaround/04-interface-updated.png`.

Physical MIDI hardware and long-duration soak testing were outside this pass.
