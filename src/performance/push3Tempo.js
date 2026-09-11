// Mirrors the browser's tempo controls onto Push 3. The Metronome button (directly below
// Tap Tempo) ticks on each beat using the same 80 ms window as the toolbar beat light.
// Tap Tempo stays lit so it is findable, flashes when pressed, and taps tempo. The Tempo
// encoder nudges the manual BPM. Pure logic over the LED transport; no DOM, no timers.

import { PUSH3_BUTTONS, PUSH3_COLORS } from './push3Map.js';

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
  colors: {
    metronomeIdle = PUSH3_COLORS.darkGray, metronomeOff = PUSH3_COLORS.off, metronomeBeat = PUSH3_COLORS.litWhite,
    tapIdle = PUSH3_COLORS.litWhite, tapPressed = PUSH3_COLORS.brightGreen,
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
  // the metronome LED is lit for this beat.
  function frame(clock) {
    if (!leds.hasOutput()) { lastSent.metronome = null; lastSent.tap = null; return false; }
    const lit = beatLit(clock, flashMs);
    write('metronome', PUSH3_BUTTONS.metronome, lit ? metronomeBeat : clock?.running ? metronomeIdle : metronomeOff);
    write('tap', PUSH3_BUTTONS.tapTempo, now() - tappedAt < flashMs ? tapPressed : tapIdle);
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
