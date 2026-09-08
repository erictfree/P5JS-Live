# Performance launcher and controller support

Implemented the usable performance workflow without requiring physical hardware. The
virtual Push and hardware adapters send the same logical actions to the launcher.

## This implementation

- Stable 64-pad banks referencing saved performance IDs; editable slot assignments.
- Immediate and next-beat launches, with visible selection, queue, loading, playing,
  and failure state. An unavailable clock falls back to immediate launch.
- Eight named control assignments per performance, relative encoder changes and
  absolute pickup. Control ranges and saved initial values come from source controls.
- A virtual Push surface with a 960×160 display preview, pad status, encoders, bank
  navigation, tap tempo, and safe-state action.
- Generic MIDI Learn routes physical notes/CCs to logical pads, encoders, and buttons.
  The current device/parameter mappings remain available.
- Live launch preserves audio, clock, hardware mappings and editor view. Full
  snapshot Recall remains available. Syntax is checked before replacing the runtime;
  failed first frames restore the existing checkpoint. Previous edits are recoverable.
- Launcher assignments and MIDI routes persist separately from performance recall
  and are included in project export/import.
- Unit and browser tests use simulated events and the actual scene renderer.

## Hardware verification still required

Push 1, Push 2 and Push 3 are target profiles, not verified integrations. Their
automatic message maps, exact LED palettes, display transport, expression settings,
reconnection and coexistence with Live require real-device tests. Generic learned
MIDI routes may be used experimentally; this does not certify a Push model.

Try WebUSB display access first when a regular, tethered Push 3 is available. If
necessary, extend the existing Node server. No Swift companion or additional
background process is introduced now. The display renderer should provide pixels
independently of the eventual transport.

Crossfades, prewarming a second rendering runtime, expressive MPE routing and native
hardware display transfer remain later work. The simulator proves application
behavior, not physical-device compatibility.

## Validation and entry point

Open Tools → Performances → Open controller, then Add two demo performances.
Orbits and Tiles each expose eight source controls and work without audio input.
The automated suite checks stable holes/banks, queue replacement and clock loss,
failed loads, per-performance assignments, pickup, relative CCs, simulated reconnect,
project serialization, actual canvas colors and preservation of host settings.
The browser tests also exercise full Recall and the existing modifier shortcuts.
