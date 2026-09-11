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

The first tethered Push 3 was identified on macOS as USB vendor `0x2982`, product
`0x1969`, with its vendor-specific display on interface 0. The controller now offers
**Connect Push display**, which asks Chrome for WebUSB permission and reads the USB
configuration and endpoint descriptors. This probe deliberately does not open or
claim the interface and sends no bytes.

The next explicit step opens the permitted device and claims display interface 0.
It can be released from the same panel. Claiming does not send a control or bulk
transfer; successful status reads **interface 0 claimed · no data sent**.

The hardware panel also exposes **Send test pattern once** after a successful claim.
It sends the fixed display-frame header followed by one complete 960×160 BGR565
frame to bulk OUT endpoint 1. Pixel rows include the required padding and XOR signal
shaping. This action sends no MIDI, control, diagnostic or firmware messages and
does not start a stream; Push clears the frame after its display timeout.

After the one-frame hardware check succeeds, **Start display** mirrors the existing
960×160 controller preview to Push at 15 fps. Frames are serialized so a slow USB
transfer cannot overlap the next one. **Stop display** ends the timer while retaining
the claimed interface; **Release** stops the stream, releases interface 0 and closes
the device.

**Show startup** displays `assets/brand/startup.bgr565` as a persistent five-frame-
per-second splash. The asset is tightly packed at the Push display's native 960×160
resolution and BGR565 color format; the transport adds row padding and signal
shaping. **Show controller** switches the same transport back to the live surface
preview.

After descriptor verification, try WebUSB display access first. If necessary, extend
the existing Node server. No Swift companion or additional background process is
introduced now. The display renderer provides pixels independently of the eventual
transport.

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
