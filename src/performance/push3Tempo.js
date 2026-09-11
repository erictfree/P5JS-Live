// Mirrors the browser's tempo controls onto Push 3 the way Live does: Tap Tempo blinks on
// each beat using the same 80 ms window as the toolbar beat light, and the Metronome
// button's two-dot icon swings side to side by alternating colour every beat. Pressing
// Tap Tempo taps tempo; the Tempo encoder nudges the manual BPM. Pure logic over the LED
// transport; no DOM, no timers.

import { PUSH3_BUTTONS, PUSH3_WHITE } from './push3Map.js';

export const TAP_FLASH_MS = 80; // same window as rhythmPanel's beat light
const BPM_MIN = 30;
const BPM_MAX = 300;

// Same rule as the browser tap button: lit for the first 80 ms of every beat.
export function beatLit(clock, flashMs = TAP_FLASH_MS) {
  return Boolean(clock?.running && clock.bpm > 0 && clock.phase * 60000 / clock.bpm < flashMs);
}

// One tempo description shared by the Push screen and anything else that shows BPM.
export function describeTempo(clock, settings) {
  const source = settings?.source ?? clock?.source ?? 'off';
  const labels = { off: 'Off', listening: 'Listening', running: source === 'auto' ? 'Tracking' : 'Manual', holding: 'Holding', lost: 'Lost' };
  const bpm = source === 'manual' ? settings?.bpm ?? clock?.bpm ?? null : clock?.bpm ?? null;
  return {
    source,
    bpm: Number.isFinite(bpm) ? bpm : null,
    label: labels[clock?.status] ?? 'Off',
    running: Boolean(clock?.running),
    phase: clock?.phase ?? 0,
    lit: beatLit(clock),
  };
}

export function createPush3TempoLink({
  leds, rhythm, tap,
  now = () => (globalThis.performance?.now?.() ?? Date.now()),
  flashMs = TAP_FLASH_MS,
  // Tap Tempo and Metronome are white LEDs, so these are white-palette brightness steps.
  colors: {
    tapIdle = PUSH3_WHITE.dim, tapBeat = PUSH3_WHITE.full, tapPressed = PUSH3_WHITE.full,
    metronomeLeft = PUSH3_WHITE.full, metronomeRight = PUSH3_WHITE.dim, metronomeOff = PUSH3_WHITE.off,
  } = {},
} = {}) {
  const lastSent = { metronome: null, tap: null }; // palette index last written per LED
  let shiftHeld = false;
  let taps = 0;
  let nudges = 0;
  let tappedAt = -Infinity;

  function write(key, cc, color) {
    if (lastSent[key] === color) return;
    const result = leds.setButton(cc, color);
    lastSent[key] = result.ok ? color : null;
  }

  // Call once per animation frame with the rhythm clock snapshot. Returns true while
  // Tap Tempo is lit for this beat.
  function frame(clock) {
    if (!leds.hasOutput()) { lastSent.metronome = null; lastSent.tap = null; return false; }
    const lit = beatLit(clock, flashMs);
    const pressed = now() - tappedAt < flashMs;
    write('tap', PUSH3_BUTTONS.tapTempo, pressed ? tapPressed : lit ? tapBeat : tapIdle);
    // Alternate every beat so the ○● icon reads as a pendulum; steady when the clock is off.
    const swing = clock?.running && Number.isFinite(clock.beat) ? (Math.floor(clock.beat + 1e-9) % 2 === 0 ? metronomeLeft : metronomeRight) : metronomeOff;
    write('metronome', PUSH3_BUTTONS.metronome, swing);
    return lit;
  }

  function nudge(delta) {
    const settings = rhythm.settings();
    const current = settings.source === 'manual' ? settings.bpm : rhythm.snapshot().bpm ?? settings.bpm;
    const step = shiftHeld ? 0.1 : 1;
    const next = Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round((current + delta * step) * 10) / 10));
    rhythm.configure({ source: 'manual', bpm: next });
    nudges += 1;
    return next;
  }

  // Feed decoded Push input here. Returns true when the event was consumed.
  function handleInput(event) {
    if (!event) return false;
    if (event.kind === 'button' && event.name === 'shift') { shiftHeld = event.pressed; return false; }
    if (event.kind === 'button' && event.name === 'tapTempo') {
      if (event.pressed) { tap(); taps += 1; tappedAt = now(); }
      return true;
    }
    if (event.kind === 'encoder' && event.encoder === 'tempo' && Number.isFinite(event.delta) && event.delta !== 0) {
      nudge(event.delta);
      return true;
    }
    return false;
  }

  return {
    frame,
    handleInput,
    snapshot() { return { metronomeColor: lastSent.metronome, tapColor: lastSent.tap, shiftHeld, taps, nudges }; },
  };
}
