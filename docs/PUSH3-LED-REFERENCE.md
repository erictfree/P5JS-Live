# Push 3 LED control reference

This file consolidates the information needed to address Push 3 pads and illuminated
buttons from p5js.live. It covers Push 3 in tethered controller mode. Standard LED
messages travel over MIDI; they are separate from the WebUSB display framebuffer
implemented in `src/performance/push3DisplayTransport.js`.

## Sources and confidence

Use these sources in this order:

1. [Push 3 button and encoder map](https://github.com/federico-pepe/ableton-push-hack/blob/main/docs/push3-button-map.md)
   is the best exact map. Its author reports a complete hardware sweep on a tethered
   Push 3: 87 CC controls and 13 touch notes, with no unknowns.
2. [Push 3 LED color palette](https://github.com/federico-pepe/ableton-push-hack/blob/main/docs/push3-led-colors.md)
   contains the 128-entry palette queried from Push 3 firmware `2.4.5b8` using the
   documented palette-read SysEx command.
3. [Ableton's official Push 2 MIDI and display interface](https://github.com/Ableton/push-interface/blob/main/doc/AbletonPush2MIDIDisplayInterface.asc)
   is the authoritative public description of the MIDI LED mechanism, palette
   commands, brightness, MIDI modes, clocked animation, and safety constraints. Push
   3 retains these LED mechanics, but some physical control numbers changed; use the
   Push 3 map above for addresses.
4. [Ableton's Push 3 manual](https://www.ableton.com/en/push/manual/) documents Live,
   User, and External ports and the Live settings needed for User-port feedback.

The locally installed Live 12 application also contains compiled Push controller
resources here:

```text
/Applications/Ableton Live 12 Suite.app/Contents/Helpers/Push3.app/
  Contents/Resources/python/Push2/
```

Files such as `colors.pyc`, `elements.pyc`, and `pad_button_element.pyc` are useful as
a final cross-check. They are compiled implementation details, so they should not be
the primary specification.

## Core protocol

An LED message has three bytes:

```text
status       address       palette index
```

For pads, use Note On. The note number selects the pad and velocity selects the color:

```text
0x90 + channel, note, color
```

For illuminated buttons, use Control Change. The CC number selects the button and
the CC value selects the color or intensity:

```text
0xB0 + channel, cc, color
```

Channel 0 means a static value. The protocol numbers channels from 0 through 15 even
though MIDI user interfaces usually label them 1 through 16.

```js
// Static green on the bottom-left pad.
output.send([0x90, 36, 126]);

// Static sky blue on the first upper screen button.
output.send([0xB0, 102, 16]);

// Turn the same screen button off.
output.send([0xB0, 102, 0]);
```

For incoming button events, a press normally has value 127 and release has value 0.
Pad input velocity represents pressure and is independent of the velocity used when
the host sends a Note On back to set the pad color.

## Pad grid

Pads use notes 36–99. Rows ascend from bottom to top and columns from left to right:

```text
top     92  93  94  95  96  97  98  99
        84  85  86  87  88  89  90  91
        76  77  78  79  80  81  82  83
        68  69  70  71  72  73  74  75
        60  61  62  63  64  65  66  67
        52  53  54  55  56  57  58  59
        44  45  46  47  48  49  50  51
bottom  36  37  38  39  40  41  42  43
        left                         right
```

A convenient address function is:

```js
function pushPadNote(row, column) {
  if (!Number.isInteger(row) || row < 0 || row > 7) {
    throw new RangeError("Push row must be 0–7 from bottom to top");
  }
  if (!Number.isInteger(column) || column < 0 || column > 7) {
    throw new RangeError("Push column must be 0–7 from left to right");
  }
  return 36 + row * 8 + column;
}
```

## Button CC map

All addresses below are Push 3 values. Do not substitute the Push 2 map where the two
devices differ.

| Group | Control | CC |
| --- | --- | ---: |
| Screen | Upper buttons 1–8, left to right | 102–109 |
| Screen | Lower buttons 1–8, left to right | 20–27 |
| Top right | Set | 80 |
| Top right | Settings | 30 |
| Top right | Help | 81 |
| Top right | User Mode | 59 |
| View | Device | 110 |
| View | Mixer | 112 |
| View | Clip | 113 |
| View | Session | 34 |
| Edit | Undo | 119 |
| Edit | Save | 82 |
| Edit | Add | 32 |
| Edit | Swap | 33 |
| Track | Lock | 83 |
| Track | Stop Clips | 29 |
| Track | Mute | 60 |
| Track | Solo | 61 |
| Track | Select main channel | 28 |
| Transport | Tap Tempo | 3 |
| Transport | Metronome | 9 |
| Transport | Quantize | 116 |
| Transport | Fixed Length | 90 |
| Transport | Automate | 89 |
| Transport | New | 92 |
| Transport | Capture | 65 |
| Transport | Record | 86 |
| Transport | Play | 85 |
| Resolution | 1/4, 1/4t, 1/8, 1/8t | 36, 37, 38, 39 |
| Resolution | 1/16, 1/16t, 1/32, 1/32t | 40, 41, 42, 43 |
| Mode | Repeat | 56 |
| Mode | Accent | 57 |
| Mode | Scale | 58 |
| Mode | Layout | 31 |
| Mode | Note | 50 |
| Mode | Session | 51 |
| Clip | Double Loop | 117 |
| Clip | Duplicate | 88 |
| Clip | Convert | 35 |
| Clip | Delete | 118 |
| Navigation | Octave Up | 55 |
| Navigation | Octave Down | 54 |
| Navigation | Page Left | 62 |
| Navigation | Page Right | 63 |
| Modifier | Shift | 49 |
| Modifier | Select | 48 |
| D-pad | Up, right, down, left | 46, 45, 47, 44 |
| D-pad | Center press | 91 |

Encoder rotation is also CC data but should not be treated as an LED address table:

| Encoder | Rotation CC | Touch note | Press CC |
| --- | ---: | ---: | ---: |
| 1–8 | 71–78 | 0–7 | — |
| Volume | 79 | 8 | 111 |
| Tempo | 14 | 10 | 15 |
| Jog wheel | 70 | 11 | 94 |

Encoder rotation is relative and accelerated: clockwise values are positive deltas,
usually 1, and counterclockwise values are encoded as 127 for −1. Faster turns can
produce larger signed deltas. The jog wheel uses CC 93 and 95 for left and right
clicks; touch-strip contact is note 12; D-pad center touch is note 13. Note 9 is
unused on Push 3 (the Push 2 swing encoder was removed).

## Useful colors

The transmitted value is a palette index, not an arbitrary RGB triplet. These values
were measured on Push 3 and cover the main UI vocabulary:

| Name | Index | Measured RGB |
| --- | ---: | --- |
| Off | 0 | `#000000` |
| Warm red | 1 | `#FF4032` |
| Yellow | 7 | `#FADC3B` |
| Amber | 8 | `#FFC516` |
| Lime | 9 | `#B6FF0E` |
| Bright green | 10 | `#79FF18` |
| Green | 11 | `#34C216` |
| Mint | 13 | `#62FF55` |
| Teal | 15 | `#269E72` |
| Sky blue | 16 | `#31ADFF` |
| Blue | 17 | `#3663FC` |
| Indigo | 21 | `#3937FF` |
| Violet | 23 | `#972BFF` |
| Pink | 26 | `#FF2BD4` |
| Pastel yellow | 40 | `#FFF480` |
| Light cyan | 46 | `#80F3FF` |
| Lavender | 51 | `#CDBBE4` |
| Medium gray | 118 | `#595959` |
| Dark gray | 119 | `#1A1A1A` |
| Pure white | 120 | `#FFFFFF` |
| Standard lit-button white | 122 | `#CCCCCC` |
| Near-black gray | 124 | `#141414` |
| Pure blue | 125 | `#0000FF` |
| Pure green | 126 | `#00FF00` |
| Pure red | 127 | `#FF0000` |

### White LEDs

Buttons with white-only LEDs (Tap Tempo, Metronome, and most other non-pad buttons)
ignore the RGB palette. They read the palette's separate white component, which in the
default palette is effectively a brightness ramp by index:

| Index | White level |
| ---: | --- |
| 0 | off |
| 16 | dark gray |
| 48 | light gray |
| 127 | full |

So on a white button, 118, 119 and 122 all look near-white, and a colour like green (10)
looks almost off. Verified on Push 3 on 2026-09-11: Tap Tempo and Metronome are white
LEDs. Use `PUSH3_WHITE` from `push3Map.js` for these buttons.

Use the measured 128-entry source linked above when exact color matching is needed.
The palette is device state and may change in later firmware, so a production adapter
should keep semantic names and permit a hardware-query override rather than spreading
raw indices throughout application code.

## Hardware LED animation

Push performs transitions without requiring continuous color messages. First send a
starting color on channel 0. Then send the destination color to the same pad or button
on one of these channels:

| Channel | Behavior | Musical duration | Clock ticks |
| ---: | --- | --- | ---: |
| 0 | Static; stop animation | — | — |
| 1 | One shot | 1/24 note | 4 |
| 2 | One shot | 1/16 note | 6 |
| 3 | One shot | 1/8 note | 12 |
| 4 | One shot | 1/4 note | 24 |
| 5 | One shot | 1/2 note | 48 |
| 6 | Pulse | 1/24 note | 4 |
| 7 | Pulse | 1/16 note | 6 |
| 8 | Pulse | 1/8 note | 12 |
| 9 | Pulse | 1/4 note | 24 |
| 10 | Pulse | 1/2 note | 48 |
| 11 | Blink | 1/24 note | 4 |
| 12 | Blink | 1/16 note | 6 |
| 13 | Blink | 1/8 note | 12 |
| 14 | Blink | 1/4 note | 24 |
| 15 | Blink | 1/2 note | 48 |

```js
// Fade screen button 1 from off to pink over one quarter note.
output.send([0xB0, 102, 0]);
output.send([0xB4, 102, 26]);

// Pulse bottom-left pad between blue and sky blue at quarter-note rate.
output.send([0x90, 36, 17]);
output.send([0x99, 36, 16]);

// Stop its animation and leave it blue.
output.send([0x90, 36, 17]);
```

Animation timing follows MIDI real-time messages:

```text
0xFA  start and reset phase
0xFB  continue and reset phase
0xF8  advance one MIDI clock tick; send 24 per quarter note
0xFC  stop transport
```

In User mode, send clock to the User port. The official Push protocol notes that an
animation may not begin until the active port receives Start. Verified on Push 3
(2026-09-11): with Start but no clock ticks, animations do not run at a fallback tempo;
a pulse simply lands on its target colour and stays there. Keep a clock running for as
long as any animated LED is showing. For p5js.live, the existing
rhythm clock should schedule 24 `0xF8` messages per beat whenever hardware animation
is enabled.

## Browser implementation

Basic colors and animations use ordinary Web MIDI and do not require SysEx access:

```js
const access = await navigator.requestMIDIAccess();
const outputs = [...access.outputs.values()];
const output = outputs.find((candidate) =>
  /Ableton Push 3.*User Port/i.test(candidate.name ?? "")
);

if (!output) {
  throw new Error("Push 3 User Port output is unavailable");
}

output.send([0x90, 36, 16]);
```

Request `navigator.requestMIDIAccess({ sysex: true })` only if the application must
query or modify palette entries, global brightness, or another documented SysEx
setting. SysEx requires stronger browser permission and expands the risk surface.
The first implementation should use the measured palette and standard three-byte
messages.

Recommended module boundary:

```text
src/performance/push3MidiTransport.js
  connect()                 request Web MIDI after a user gesture
  listPorts()               return data-only port descriptions
  selectOutput(id)          choose the explicit User-port output
  setPad(row, col, color)   send Note On
  setButton(cc, color)      send Control Change
  animatePad(...)           send base and animation-channel colors
  animateButton(...)        send base and animation-channel colors
  startClock(bpm)           send Start and schedule 24 PPQN clock
  stopClock()               stop the local clock sender
  clearOwnedLeds()          clear only addresses the app claimed
  disconnect()              stop timers and release references
```

Keep semantic color names in one table. Validate every channel, address, and palette
index before sending. Serialize state changes at the adapter boundary and make the UI
consume logical controller state, matching the existing virtual Push architecture.

## Port ownership and Live coexistence

Push exposes Live, User, and External MIDI ports. The browser should normally use the
**User Port** for custom input and LED feedback. In Live's MIDI settings, output
Remote enables feedback to Push LEDs. If Live retains the User port and the browser
cannot open it, turn off Live's Track, Sync, and Remote switches for that User port
while testing the browser adapter.

Do not take over the Live port casually. It carries Ableton's control-surface session,
and competing color updates will cause flicker or state fights. Make the selected
port visible in the controller UI and refuse ambiguous automatic selection when more
than one Push output matches.

The WebUSB display and Web MIDI LEDs are independent transports. Claiming USB display
interface 0 should not imply MIDI ownership, and losing one transport should not tear
down the other.

## Safety and test sequence

Start with standard MIDI only:

1. Ask the user to select the Push User Port explicitly.
2. Light one pad with a static palette value.
3. Turn that pad off.
4. Light one known RGB button and one known white button.
5. Verify a one-shot transition without clock.
6. Send Start and a low-rate clock, then verify pulse and blink.
7. Clear only the LEDs p5js.live changed and disconnect.
8. Test with Live closed, then with Live open and the User port released.

Avoid undocumented SysEx, firmware, calibration, diagnostic, white-balance flash, and
PWM commands. Ableton explicitly warns that reserved commands can damage calibration
state or burden the device. Even documented persistent flash commands are unnecessary
for this application.

Automated tests should use a fake Web MIDI output and assert exact byte triples,
address bounds, pad orientation, animation channels, clock cancellation, reconnect,
and that no SysEx is emitted by the normal LED API. Real-hardware verification should
record firmware version, selected port name, test address, palette index, and observed
color before a mapping is considered supported.
