// Mirrors the browser's tempo controls onto Push 3: the Tap Tempo button LED flashes on
// each beat exactly like the toolbar tap button, pressing it taps tempo, and the Tempo
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

export function createPush3TempoLink({ leds, rhythm, tap, flashMs = TAP_FLASH_MS, idleColor = PUSH3_COLORS.darkGray, litColor = PUSH3_COLORS.litWhite } = {}) {
  let lastSent = null; // palette index last written to the Tap Tempo LED, null = nothing
  let shiftHeld = false;
  let taps = 0;
  let nudges = 0;

  function write(color) {
    if (lastSent === color) return;
    const result = leds.setButton(PUSH3_BUTTONS.tapTempo, color);
    lastSent = result.ok ? color : null;
  }

  // Call once per animation frame with the rhythm clock snapshot.
  function frame(clock) {
    if (!leds.hasOutput()) { lastSent = null; return false; }
    const lit = beatLit(clock, flashMs);
    write(lit ? litColor : idleColor);
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
      if (event.pressed) { tap(); taps += 1; }
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
    snapshot() { return { ledColor: lastSent, shiftHeld, taps, nudges }; },
  };
}
