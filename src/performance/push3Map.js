// Push 3 address tables and pure decoders. Numbers come from docs/PUSH3-LED-REFERENCE.md,
// which is the ground truth for Push 3 (not Push 2). Nothing here touches MIDI or the DOM.

export const PAD_FIRST_NOTE = 36;
export const PAD_LAST_NOTE = 99;
export const PAD_COUNT = 64;

// Illuminated buttons by Control Change number.
export const PUSH3_BUTTONS = Object.freeze({
  upper1: 102, upper2: 103, upper3: 104, upper4: 105, upper5: 106, upper6: 107, upper7: 108, upper8: 109,
  lower1: 20, lower2: 21, lower3: 22, lower4: 23, lower5: 24, lower6: 25, lower7: 26, lower8: 27,
  set: 80, settings: 30, help: 81, userMode: 59,
  device: 110, mixer: 112, clipView: 113, sessionView: 34,
  undo: 119, save: 82, add: 32, swap: 33,
  lock: 83, stopClips: 29, mute: 60, solo: 61, selectMain: 28,
  tapTempo: 3, metronome: 9, quantize: 116, fixedLength: 90, automate: 89, new: 92, capture: 65, record: 86, play: 85,
  quarter: 36, quarterTriplet: 37, eighth: 38, eighthTriplet: 39,
  sixteenth: 40, sixteenthTriplet: 41, thirtySecond: 42, thirtySecondTriplet: 43,
  repeat: 56, accent: 57, scale: 58, layout: 31, note: 50, session: 51,
  doubleLoop: 117, duplicate: 88, convert: 35, delete: 118,
  octaveUp: 55, octaveDown: 54, pageLeft: 62, pageRight: 63,
  shift: 49, select: 48,
  dpadUp: 46, dpadRight: 45, dpadDown: 47, dpadLeft: 44, dpadCenter: 91,
});

export const PUSH3_ENCODERS = Object.freeze({
  rotation: Object.freeze([71, 72, 73, 74, 75, 76, 77, 78]),
  touchNotes: Object.freeze([0, 1, 2, 3, 4, 5, 6, 7]),
  volume: Object.freeze({ cc: 79, touch: 8, press: 111 }),
  tempo: Object.freeze({ cc: 14, touch: 10, press: 15 }),
  jog: Object.freeze({ cc: 70, touch: 11, press: 94, left: 93, right: 95 }),
  touchStripNote: 12,
  dpadCenterTouchNote: 13,
});

// Measured palette indices (firmware 2.4.5b8). Keep semantic names here; never spread raw
// indices through application code.
export const PUSH3_COLORS = Object.freeze({
  off: 0, warmRed: 1, yellow: 7, amber: 8, lime: 9, brightGreen: 10, green: 11, mint: 13,
  teal: 15, skyBlue: 16, blue: 17, indigo: 21, violet: 23, pink: 26, pastelYellow: 40,
  lightCyan: 46, lavender: 51, mediumGray: 118, darkGray: 119, white: 120, litWhite: 122,
  nearBlack: 124, pureBlue: 125, pureGreen: 126, pureRed: 127,
});

// White-only LEDs (Tap Tempo, Metronome, most non-pad buttons) use the separate white
// palette, where the index is effectively a brightness ramp: 0 off, 16 dark gray,
// 48 light gray, 127 full (Ableton Push 2 interface doc, retained on Push 3). RGB palette
// names above are meaningless on these buttons: 118, 119 and 122 all read as near-white.
export const PUSH3_WHITE = Object.freeze({ off: 0, dim: 16, half: 48, bright: 90, full: 127 });

// The MIDI channel selects a hardware animation. Channel 0 is static and stops animation.
const DURATIONS = Object.freeze(['1/24', '1/16', '1/8', '1/4', '1/2']);
const ANIMATION_BASE = Object.freeze({ oneShot: 1, pulse: 6, blink: 11 });

export function animationChannel(kind, duration = '1/4') {
  if (kind === 'static') return 0;
  const base = ANIMATION_BASE[kind];
  const offset = DURATIONS.indexOf(duration);
  if (base === undefined) throw new RangeError(`Unknown Push animation "${kind}". Use static, oneShot, pulse or blink.`);
  if (offset < 0) throw new RangeError(`Unknown Push animation duration "${duration}". Use ${DURATIONS.join(', ')}.`);
  return base + offset;
}

export function describeAnimationChannel(channel) {
  if (channel === 0) return { kind: 'static', duration: null };
  for (const [kind, base] of Object.entries(ANIMATION_BASE)) {
    if (channel >= base && channel < base + DURATIONS.length) return { kind, duration: DURATIONS[channel - base] };
  }
  throw new RangeError('Push animation channels are 0–15.');
}

function assertInteger(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be an integer from ${min} to ${max}.`);
  }
}

// Row 0 is the bottom row and column 0 is the left column, matching Ableton's numbering.
export function padNoteFromRowColumn(row, column) {
  assertInteger(row, 0, 7, 'Push pad row');
  assertInteger(column, 0, 7, 'Push pad column');
  return PAD_FIRST_NOTE + row * 8 + column;
}

// Pad index 0 is the top-left pad, matching the virtual surface where pad 1 is top-left.
export function padNoteFromIndex(index) {
  assertInteger(index, 0, PAD_COUNT - 1, 'Push pad index');
  return padNoteFromRowColumn(7 - Math.floor(index / 8), index % 8);
}

export function padIndexFromNote(note) {
  assertInteger(note, PAD_FIRST_NOTE, PAD_LAST_NOTE, 'Push pad note');
  const offset = note - PAD_FIRST_NOTE;
  return (7 - Math.floor(offset / 8)) * 8 + (offset % 8);
}

export function isPadNote(note) {
  return Number.isInteger(note) && note >= PAD_FIRST_NOTE && note <= PAD_LAST_NOTE;
}

export function buttonName(cc) {
  return Object.entries(PUSH3_BUTTONS).find(([, value]) => value === cc)?.[0] ?? null;
}

// Relative encoder values are two's complement: 1… clockwise, 127… counter-clockwise.
export function relativeDelta(value) {
  return value > 63 ? value - 128 : value;
}

// Decode one raw Push message into a logical event. Returns null for anything else.
export function decodePushMessage(data) {
  if (!data || data.length < 3) return null;
  const command = data[0] & 0xf0;
  const number = data[1];
  const value = data[2];
  if (command === 0x90 || command === 0x80) {
    const pressed = command === 0x90 && value > 0;
    if (isPadNote(number)) {
      return { kind: 'pad', index: padIndexFromNote(number), note: number, pressed, pressure: pressed ? value : 0 };
    }
    const encoder = PUSH3_ENCODERS.touchNotes.indexOf(number);
    if (encoder >= 0) return { kind: 'encoderTouch', encoder, touched: pressed };
    if (number === PUSH3_ENCODERS.volume.touch) return { kind: 'encoderTouch', encoder: 'volume', touched: pressed };
    if (number === PUSH3_ENCODERS.tempo.touch) return { kind: 'encoderTouch', encoder: 'tempo', touched: pressed };
    if (number === PUSH3_ENCODERS.jog.touch) return { kind: 'encoderTouch', encoder: 'jog', touched: pressed };
    if (number === PUSH3_ENCODERS.touchStripNote) return { kind: 'touchStrip', touched: pressed };
    if (number === PUSH3_ENCODERS.dpadCenterTouchNote) return { kind: 'dpadTouch', touched: pressed };
    return null;
  }
  if (command !== 0xb0) return null;
  const encoder = PUSH3_ENCODERS.rotation.indexOf(number);
  if (encoder >= 0) return { kind: 'encoder', encoder, delta: relativeDelta(value) };
  if (number === PUSH3_ENCODERS.volume.cc) return { kind: 'encoder', encoder: 'volume', delta: relativeDelta(value) };
  if (number === PUSH3_ENCODERS.tempo.cc) return { kind: 'encoder', encoder: 'tempo', delta: relativeDelta(value) };
  if (number === PUSH3_ENCODERS.jog.cc) return { kind: 'encoder', encoder: 'jog', delta: relativeDelta(value) };
  if (number === PUSH3_ENCODERS.volume.press) return { kind: 'button', name: 'volumePress', cc: number, pressed: value > 0, value };
  if (number === PUSH3_ENCODERS.tempo.press) return { kind: 'button', name: 'tempoPress', cc: number, pressed: value > 0, value };
  if (number === PUSH3_ENCODERS.jog.press) return { kind: 'button', name: 'jogPress', cc: number, pressed: value > 0, value };
  if (number === PUSH3_ENCODERS.jog.left) return { kind: 'button', name: 'jogLeft', cc: number, pressed: value > 0, value };
  if (number === PUSH3_ENCODERS.jog.right) return { kind: 'button', name: 'jogRight', cc: number, pressed: value > 0, value };
  return { kind: 'button', name: buttonName(number), cc: number, pressed: value > 0, value };
}
