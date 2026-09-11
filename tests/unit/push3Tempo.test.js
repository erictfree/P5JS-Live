import { describe, expect, it, vi } from 'vitest';
import { PUSH3_BUTTONS, PUSH3_WHITE } from '../../src/performance/push3Map.js';
import { beatLit, beatPulse, createPush3TempoLink, describeTempo } from '../../src/performance/push3Tempo.js';

const clockAt = (phase, bpm = 120, running = true, beat = phase) => ({ running, bpm, phase, beat, status: running ? 'running' : 'off', source: 'manual' });

function fakeLeds({ output = true } = {}) {
  return { hasOutput: vi.fn(() => output), setButton: vi.fn(() => ({ ok: true })) };
}

function fakeRhythm(settings = { source: 'manual', bpm: 120, multiplier: 1, algorithm: 'plp' }, snapshot = { bpm: 120 }) {
  return { settings: vi.fn(() => ({ ...settings })), snapshot: vi.fn(() => snapshot), configure: vi.fn(changes => { Object.assign(settings, changes); return { ...settings }; }) };
}

describe('Push 3 tempo link', () => {
  it('uses the same 80 ms beat window as the browser tap button', () => {
    expect(beatLit(clockAt(0))).toBe(true);
    expect(beatLit(clockAt(0.1, 120))).toBe(true); // 50 ms into a 500 ms beat
    expect(beatLit(clockAt(0.2, 120))).toBe(false); // 100 ms
    expect(beatLit(clockAt(0, 120, false))).toBe(false);
    expect(beatLit(null)).toBe(false);
  });

  it('pulses for the first quarter of each beat, never shorter than the browser flash', () => {
    expect(beatPulse(clockAt(0))).toBe(true);
    expect(beatPulse(clockAt(0.2, 120))).toBe(true);   // 100 ms into a 500 ms beat: inside the quarter
    expect(beatPulse(clockAt(0.3, 120))).toBe(false);
    expect(beatPulse(clockAt(0.3, 300))).toBe(true);   // 60 ms into a 200 ms beat: browser flash still on
    expect(beatPulse(clockAt(0, 120, false))).toBe(false);
  });

  it('pulses Tap Tempo on the beat, keeps the Metronome off, and sends only on change', () => {
    const leds = fakeLeds();
    const link = createPush3TempoLink({ leds, rhythm: fakeRhythm(), tap: vi.fn(), now: () => 1000 });

    expect(link.frame(clockAt(0, 120, true, 0))).toBe(true);
    link.frame(clockAt(0.1, 120, true, 0.1));
    link.frame(clockAt(0.5, 120, true, 0.5));
    link.frame(clockAt(0.9, 120, true, 0.9));
    link.frame(clockAt(0.01, 120, true, 1.01));
    link.frame(clockAt(0.5, 120, true, 1.5));

    expect(leds.setButton.mock.calls).toEqual([
      [PUSH3_BUTTONS.tapTempo, PUSH3_WHITE.full],
      [PUSH3_BUTTONS.metronome, PUSH3_WHITE.off],
      [PUSH3_BUTTONS.tapTempo, PUSH3_WHITE.dim],
      [PUSH3_BUTTONS.tapTempo, PUSH3_WHITE.full],
      [PUSH3_BUTTONS.tapTempo, PUSH3_WHITE.dim],
    ]);
    expect(link.snapshot()).toMatchObject({ metronomeColor: PUSH3_WHITE.off, tapColor: PUSH3_WHITE.dim });
  });

  it('dims Tap when the clock is off; sends nothing without an output', () => {
    const leds = fakeLeds();
    const link = createPush3TempoLink({ leds, rhythm: fakeRhythm(), tap: vi.fn(), now: () => 1000 });
    link.frame(clockAt(0, 120, false));
    link.frame(clockAt(0.5, 120, false));
    expect(leds.setButton.mock.calls).toEqual([
      [PUSH3_BUTTONS.tapTempo, PUSH3_WHITE.dim],
      [PUSH3_BUTTONS.metronome, PUSH3_WHITE.off],
    ]);

    const silent = fakeLeds({ output: false });
    const idle = createPush3TempoLink({ leds: silent, rhythm: fakeRhythm(), tap: vi.fn() });
    expect(idle.frame(clockAt(0))).toBe(false);
    expect(silent.setButton).not.toHaveBeenCalled();
  });

  it('flashes Tap Tempo green for the flash window after a press', () => {
    let time = 1000;
    const leds = fakeLeds();
    const link = createPush3TempoLink({ leds, rhythm: fakeRhythm(), tap: vi.fn(), now: () => time });
    link.frame(clockAt(0.5));
    link.handleInput({ kind: 'button', name: 'tapTempo', cc: 3, pressed: true, value: 127 });
    link.frame(clockAt(0.5));
    time += 50; link.frame(clockAt(0.5));
    time += 50; link.frame(clockAt(0.5));
    const tapWrites = leds.setButton.mock.calls.filter(([cc]) => cc === PUSH3_BUTTONS.tapTempo).map(([, color]) => color);
    expect(tapWrites).toEqual([PUSH3_WHITE.dim, PUSH3_WHITE.full, PUSH3_WHITE.dim]);
  });

  it('re-sends the LEDs after the output comes back', () => {
    let output = true;
    const leds = { hasOutput: () => output, setButton: vi.fn(() => ({ ok: true })) };
    const link = createPush3TempoLink({ leds, rhythm: fakeRhythm(), tap: vi.fn(), now: () => 1000 });
    link.frame(clockAt(0.5));
    output = false; link.frame(clockAt(0.5));
    output = true; link.frame(clockAt(0.5));
    expect(leds.setButton).toHaveBeenCalledTimes(4);
  });

  it('taps tempo on Tap Tempo press only, not release', () => {
    const tap = vi.fn();
    const link = createPush3TempoLink({ leds: fakeLeds(), rhythm: fakeRhythm(), tap });
    expect(link.handleInput({ kind: 'button', name: 'tapTempo', cc: 3, pressed: true, value: 127 })).toBe(true);
    expect(link.handleInput({ kind: 'button', name: 'tapTempo', cc: 3, pressed: false, value: 0 })).toBe(true);
    expect(tap).toHaveBeenCalledTimes(1);
    expect(link.handleInput({ kind: 'button', name: 'play', cc: 85, pressed: true, value: 127 })).toBe(false);
    expect(link.handleInput(null)).toBe(false);
  });

  it('nudges the manual BPM with the Tempo encoder, fine steps with Shift', () => {
    const rhythm = fakeRhythm();
    const link = createPush3TempoLink({ leds: fakeLeds(), rhythm, tap: vi.fn() });
    expect(link.handleInput({ kind: 'encoder', encoder: 'tempo', delta: 2 })).toBe(true);
    expect(rhythm.configure).toHaveBeenLastCalledWith({ source: 'manual', bpm: 122 });
    link.handleInput({ kind: 'button', name: 'shift', cc: 49, pressed: true, value: 127 });
    link.handleInput({ kind: 'encoder', encoder: 'tempo', delta: -1 });
    expect(rhythm.configure).toHaveBeenLastCalledWith({ source: 'manual', bpm: 121.9 });
    link.handleInput({ kind: 'button', name: 'shift', cc: 49, pressed: false, value: 0 });
    expect(link.handleInput({ kind: 'encoder', encoder: 0, delta: 1 })).toBe(false);
    expect(link.snapshot()).toMatchObject({ nudges: 2, shiftHeld: false });
  });

  it('starts from the tracked tempo and clamps to the valid range when in auto mode', () => {
    const rhythm = fakeRhythm({ source: 'auto', bpm: 120, multiplier: 1, algorithm: 'plp' }, { bpm: 298.6 });
    const link = createPush3TempoLink({ leds: fakeLeds(), rhythm, tap: vi.fn() });
    link.handleInput({ kind: 'encoder', encoder: 'tempo', delta: 5 });
    expect(rhythm.configure).toHaveBeenCalledWith({ source: 'manual', bpm: 300 });
  });

  it('describes tempo the way the toolbar does', () => {
    expect(describeTempo(clockAt(0.25, 137), { source: 'manual', bpm: 137 })).toMatchObject({ bpm: 137, label: 'Manual', running: true, lit: false });
    expect(describeTempo({ running: true, status: 'running', bpm: 98.4, phase: 0.01, source: 'auto' }, { source: 'auto', bpm: 120 })).toMatchObject({ bpm: 98.4, label: 'Tracking', lit: true });
    expect(describeTempo({ running: false, status: 'off', bpm: null, phase: 0, source: 'off' }, { source: 'off', bpm: 120 })).toMatchObject({ bpm: null, label: 'Off', running: false });
    expect(describeTempo({ running: false, status: 'listening', bpm: null, phase: 0, source: 'auto' }, { source: 'auto', bpm: 120 }).label).toBe('Listening');
  });
});
