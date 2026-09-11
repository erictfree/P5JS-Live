// Turns Push 3 input into the launcher's existing logical actions and renders launcher
// state back onto the 64 pad LEDs. Rows 1–4 (pad indices 0–31) are performance slots in
// the current bank; rows 5–8 (32–63) are effect toggles. The virtual surface in
// performanceLauncher.js splits the same way and remains the reference behaviour.

import { PUSH3_COLORS, animationChannel } from './push3Map.js';
import { PADS_PER_BANK } from './launcher.js';


// One steady hue per slot position so neighbouring pads read as different performances.
export const PERFORMANCE_HUES = Object.freeze([
  PUSH3_COLORS.skyBlue, PUSH3_COLORS.violet, PUSH3_COLORS.pink, PUSH3_COLORS.teal,
  PUSH3_COLORS.lime, PUSH3_COLORS.amber, PUSH3_COLORS.blue, PUSH3_COLORS.mint,
]);

export const PAD_LED = Object.freeze({
  playingBlink: animationChannel('blink', '1/4'), // hard on/off each beat reads as a pulse; the soft fade read as a dim
  queuedPulse: animationChannel('pulse', '1/8'),
  loadingBlink: animationChannel('blink', '1/8'),
  effectOn: PUSH3_COLORS.green,
  effectOff: PUSH3_COLORS.darkGray,
  failed: PUSH3_COLORS.warmRed,
  queued: PUSH3_COLORS.amber,
  queuedTarget: PUSH3_COLORS.yellow,
  loading: PUSH3_COLORS.litWhite,
  off: PUSH3_COLORS.off,
});

export function slotStatus(state, entries, slot) {
  const id = state.slots[slot];
  if (!id) return 'empty';
  const known = entries.some(entry => entry.id === id);
  if (state.loading === id) return 'loading';
  if (state.queued?.id === id) return 'queued';
  if (state.error?.id === id) return 'failed';
  if (state.active === id) return 'playing';
  return known ? 'ready' : 'empty';
}

// Desired LED for one pad: { base, target?, channel }. Pure, so it can be unit-tested.
export function padLed(status, index) {
  const hue = PERFORMANCE_HUES[index % PERFORMANCE_HUES.length];
  switch (status) {
    // Blink in the pad's own hue on the beat, never toward white.
    case 'playing': return { base: hue, target: PAD_LED.off, channel: PAD_LED.playingBlink };
    case 'queued': return { base: PAD_LED.queued, target: PAD_LED.queuedTarget, channel: PAD_LED.queuedPulse };
    case 'loading': return { base: PAD_LED.loading, target: PAD_LED.off, channel: PAD_LED.loadingBlink };
    case 'failed': return { base: PAD_LED.failed, channel: 0 };
    case 'ready': return { base: hue, channel: 0 };
    case 'on': return { base: PAD_LED.effectOn, channel: 0 };
    case 'off': return { base: PAD_LED.effectOff, channel: 0 };
    default: return { base: PAD_LED.off, channel: 0 };
  }
}

// Full 64-pad frame from launcher + store + effects state. Also pure.
export function renderPadFrame({ state, entries, effects }) {
  const frame = new Map();
  for (let index = 0; index < PADS_PER_BANK; index += 1) {
    frame.set(index, padLed(slotStatus(state, entries, state.bank * PADS_PER_BANK + index), index));
  }
  for (let index = 0; index < 64 - PADS_PER_BANK; index += 1) {
    const effect = effects[index];
    frame.set(PADS_PER_BANK + index, padLed(effect ? (effect.value ? 'on' : 'off') : 'unbound', index));
  }
  return frame;
}

const ledKey = led => `${led.base}/${led.target ?? ''}/${led.channel}`;

export function createPush3Adapter({
  launcher, leds, store, registry, effects, diagnostics,
  schedule = callback => (globalThis.requestAnimationFrame ?? setTimeout)(callback),
} = {}) {
  let shiftHeld = false;
  let lastFrame = new Map();
  let renderQueued = false;
  let clockBpm = null;
  let hadOutput = false;

  function sendFrame(frame) {
    let sent = 0;
    for (const [index, led] of frame) {
      const previous = lastFrame.get(index);
      if (previous && ledKey(previous) === ledKey(led)) continue;
      const result = led.channel && led.target !== undefined
        ? leds.animatePad(index, led.base, led.target, led.channel)
        : leds.setPad(index, led.base);
      if (result.ok) { lastFrame.set(index, led); sent += 1; }
    }
    return sent;
  }

  function render() {
    renderQueued = false;
    if (!leds.hasOutput()) { lastFrame = new Map(); return 0; }
    return sendFrame(renderPadFrame({ state: launcher.snapshot(), entries: store.list(), effects: effects.list() }));
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    schedule(render);
  }

  // Keep the hardware animation clock on the app tempo so pulses land on the beat.
  function syncClock(clock) {
    if (!leds.hasOutput()) { clockBpm = null; return; }
    const bpm = clock?.running && Number.isFinite(clock.bpm) && clock.bpm >= 30 && clock.bpm <= 300 ? clock.bpm : null;
    if (bpm === null) { if (clockBpm !== null) { leds.stopClock(); clockBpm = null; } return; }
    if (clockBpm === null || Math.abs(bpm - clockBpm) > 0.5) { leds.startClock(bpm); clockBpm = bpm; }
  }

  // Once per animation frame with the rhythm clock snapshot.
  function frame(clock) {
    const has = leds.hasOutput();
    if (has && !hadOutput) { lastFrame = new Map(); scheduleRender(); }
    if (!has && hadOutput) { lastFrame = new Map(); clockBpm = null; }
    hadOutput = has;
    syncClock(clock);
  }

  // Decoded Push input. Returns true when consumed.
  function handleInput(event) {
    if (!event) return false;
    if (event.kind === 'button' && event.name === 'shift') { shiftHeld = event.pressed; return false; }
    if (event.kind === 'pad') {
      if (!event.pressed) return true;
      if (event.index < PADS_PER_BANK) {
        launcher.dispatch({ action: 'pad', index: event.index, ...(shiftHeld ? { timing: 'immediate' } : {}) });
      } else {
        const result = effects.toggle(event.index - PADS_PER_BANK);
        if (!result) diagnostics?.info?.('No effect on that pad', 'Declare a toggle control in the scene to bind it.');
      }
      return true;
    }
    if (event.kind === 'encoder' && Number.isInteger(event.encoder)) {
      launcher.dispatch({ action: 'encoder', index: event.encoder, value: event.delta, relative: true, fine: shiftHeld });
      return true;
    }
    if (event.kind === 'button' && event.pressed) {
      if (event.name === 'pageLeft') { launcher.dispatch({ action: 'bankPrevious' }); return true; }
      if (event.name === 'pageRight') { launcher.dispatch({ action: 'bankNext' }); return true; }
    }
    return event.kind === 'button' && ['pageLeft', 'pageRight'].includes(event.name);
  }

  const unsubscribe = [
    launcher.subscribe(scheduleRender),
    registry.subscribe(scheduleRender),
    leds.subscribe(() => { if (leds.hasOutput() !== hadOutput) scheduleRender(); }),
  ];

  return {
    frame,
    handleInput,
    render,
    snapshot() { return { shiftHeld, clockBpm, lit: lastFrame.size }; },
    dispose() { for (const stop of unsubscribe) stop(); },
  };
}
