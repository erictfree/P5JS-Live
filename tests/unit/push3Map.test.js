import { describe, expect, it } from 'vitest';
import {
  PUSH3_BUTTONS,
  PUSH3_COLORS,
  PUSH3_WHITE,
  animationChannel,
  buttonName,
  decodePushMessage,
  describeAnimationChannel,
  padIndexFromNote,
  padNoteFromIndex,
  padNoteFromRowColumn,
  relativeDelta,
} from '../../src/performance/push3Map.js';

describe('Push 3 map', () => {
  it('addresses pads bottom-left first by row and column, as Ableton documents', () => {
    expect(padNoteFromRowColumn(0, 0)).toBe(36);
    expect(padNoteFromRowColumn(0, 7)).toBe(43);
    expect(padNoteFromRowColumn(7, 0)).toBe(92);
    expect(padNoteFromRowColumn(7, 7)).toBe(99);
    expect(() => padNoteFromRowColumn(8, 0)).toThrow(RangeError);
  });

  it('maps virtual pad index 0 (top-left on screen) to the top-left physical pad', () => {
    expect(padNoteFromIndex(0)).toBe(92);
    expect(padNoteFromIndex(7)).toBe(99);
    expect(padNoteFromIndex(56)).toBe(36);
    expect(padNoteFromIndex(63)).toBe(43);
    for (let index = 0; index < 64; index += 1) expect(padIndexFromNote(padNoteFromIndex(index))).toBe(index);
    expect(() => padNoteFromIndex(64)).toThrow(RangeError);
    expect(() => padIndexFromNote(35)).toThrow(RangeError);
  });

  it('uses Push 3 button numbers where they differ from Push 2', () => {
    expect(PUSH3_BUTTONS.play).toBe(85);
    expect(PUSH3_BUTTONS.tapTempo).toBe(3);
    expect(PUSH3_BUTTONS.pageLeft).toBe(62);
    expect(PUSH3_BUTTONS.upper1).toBe(102);
    expect(PUSH3_BUTTONS.lower1).toBe(20);
    expect(buttonName(118)).toBe('delete');
    expect(buttonName(1)).toBeNull();
  });

  it('turns animation names into the documented channels', () => {
    expect(animationChannel('static')).toBe(0);
    expect(animationChannel('oneShot', '1/24')).toBe(1);
    expect(animationChannel('oneShot', '1/2')).toBe(5);
    expect(animationChannel('pulse', '1/4')).toBe(9);
    expect(animationChannel('blink', '1/8')).toBe(13);
    expect(describeAnimationChannel(9)).toEqual({ kind: 'pulse', duration: '1/4' });
    expect(() => animationChannel('sparkle')).toThrow(RangeError);
    expect(() => animationChannel('pulse', '1/3')).toThrow(RangeError);
  });

  it('decodes relative encoder values as signed deltas', () => {
    expect(relativeDelta(1)).toBe(1);
    expect(relativeDelta(3)).toBe(3);
    expect(relativeDelta(127)).toBe(-1);
    expect(relativeDelta(125)).toBe(-3);
  });

  it('decodes pads, buttons, encoders and touches into logical events', () => {
    expect(decodePushMessage([0x90, 92, 100])).toEqual({ kind: 'pad', index: 0, note: 92, pressed: true, pressure: 100 });
    expect(decodePushMessage([0x80, 36, 0])).toEqual({ kind: 'pad', index: 56, note: 36, pressed: false, pressure: 0 });
    expect(decodePushMessage([0xb0, 85, 127])).toEqual({ kind: 'button', name: 'play', cc: 85, pressed: true, value: 127 });
    expect(decodePushMessage([0xb0, 85, 0])).toMatchObject({ kind: 'button', name: 'play', pressed: false });
    expect(decodePushMessage([0xb0, 71, 127])).toEqual({ kind: 'encoder', encoder: 0, delta: -1 });
    expect(decodePushMessage([0xb0, 14, 2])).toEqual({ kind: 'encoder', encoder: 'tempo', delta: 2 });
    expect(decodePushMessage([0x90, 3, 127])).toEqual({ kind: 'encoderTouch', encoder: 3, touched: true });
    expect(decodePushMessage([0x90, 12, 127])).toEqual({ kind: 'touchStrip', touched: true });
    expect(decodePushMessage([0xb0, 93, 127])).toMatchObject({ kind: 'button', name: 'jogLeft' });
    expect(decodePushMessage([0xf8])).toBeNull();
    expect(decodePushMessage([0xe0, 0, 64])).toBeNull();
  });

  it('keeps a white-LED brightness scale separate from the RGB palette', () => {
    expect(PUSH3_WHITE.off).toBe(0);
    expect(PUSH3_WHITE.dim).toBe(16);
    expect(PUSH3_WHITE.full).toBe(127);
    expect(PUSH3_WHITE.dim).toBeLessThan(PUSH3_WHITE.half);
    expect(PUSH3_WHITE.half).toBeLessThan(PUSH3_WHITE.full);
  });

  it('keeps the measured palette anchors', () => {
    expect(PUSH3_COLORS.off).toBe(0);
    expect(PUSH3_COLORS.green).toBe(11);
    expect(PUSH3_COLORS.skyBlue).toBe(16);
    expect(PUSH3_COLORS.litWhite).toBe(122);
    expect(PUSH3_COLORS.pureRed).toBe(127);
  });
});
