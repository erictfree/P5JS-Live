// Turns Push 3 input into the launcher's existing logical actions and renders launcher
// state back onto the 64 pad LEDs. Rows 1–4 (pad indices 0–31) are performance slots in
// the current bank; rows 5–8 (32–63) are effect toggles. The virtual surface in
// performanceLauncher.js splits the same way and remains the reference behaviour.

import { PUSH3_BUTTONS, PUSH3_COLORS, animationChannel } from './push3Map.js';
import { PADS_PER_BANK } from './launcher.js';


// One steady hue per slot position so neighbouring pads read as different performances.
export const PERFORMANCE_HUES = Object.freeze([
  PUSH3_COLORS.skyBlue, PUSH3_COLORS.violet, PUSH3_COLORS.pink, PUSH3_COLORS.teal,
  PUSH3_COLORS.lime, PUSH3_COLORS.amber, PUSH3_COLORS.blue, PUSH3_COLORS.mint,
]);

// Upper display buttons sit between each encoder and its display column.
export const UPPER_BUTTONS = Object.freeze([
  PUSH3_BUTTONS.upper1, PUSH3_BUTTONS.upper2, PUSH3_BUTTONS.upper3, PUSH3_BUTTONS.upper4,
  PUSH3_BUTTONS.upper5, PUSH3_BUTTONS.upper6, PUSH3_BUTTONS.upper7, PUSH3_BUTTONS.upper8,
]);
export const LOWER_BUTTONS = Object.freeze([
  PUSH3_BUTTONS.lower1, PUSH3_BUTTONS.lower2, PUSH3_BUTTONS.lower3, PUSH3_BUTTONS.lower4,
  PUSH3_BUTTONS.lower5, PUSH3_BUTTONS.lower6, PUSH3_BUTTONS.lower7, PUSH3_BUTTONS.lower8,
]);
// Lower display buttons: one modulation slot each, in list order (the first eight).
// Off = empty slot, dim = defined but stopped, bright amber = running.
export const LOWER_LED = Object.freeze({ none: PUSH3_COLORS.off, defined: PUSH3_COLORS.darkGray, running: PUSH3_COLORS.amber });

export function modulationSlots(modulations) {
  const list = modulations?.list?.() ?? [];
  return Array.from({ length: LOWER_BUTTONS.length }, (_, index) => list[index] ?? null);
}

export function renderLowerButtons({ modulations }) {
  const frame = new Map();
  modulationSlots(modulations).forEach((m, index) => {
    const color = !m ? LOWER_LED.none : m.on ? LOWER_LED.running : LOWER_LED.defined;
    frame.set(LOWER_BUTTONS[index], { base: color, channel: 0 });
  });
  return frame;
}

export const UPPER_LED = Object.freeze({
  unassigned: PUSH3_COLORS.off,
  atDefault: PUSH3_COLORS.darkGray,   // assigned, untouched: findable but quiet
  moved: PUSH3_COLORS.litWhite,       // value differs from its saved default: press to reset
});

// Play button mirrors the toolbar's audio transport: green while the file plays, dim when
// a file is loaded but paused, off when there is nothing to play.
export const PLAY_LED = Object.freeze({ playing: PUSH3_COLORS.green, paused: PUSH3_COLORS.darkGray, none: PUSH3_COLORS.off });
export function playLed(status) {
  if (!status || status.kind !== 'file' || !status.loaded) return PLAY_LED.none;
  return status.playing ? PLAY_LED.playing : PLAY_LED.paused;
}

export const PAD_LED = Object.freeze({
  playingPulse: animationChannel('pulse', '1/2'), // slowest hardware pulse: one second per cycle at the fixed animation clock
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
    // Slow breathe in the pad's own hue, never toward white.
    case 'playing': return { base: hue, target: PAD_LED.off, channel: PAD_LED.playingPulse };
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

// Upper button LEDs from the encoder targets: lit when the column has a control, bright
// when that control has moved away from its default. Pure.
export function renderUpperButtons({ targets, params }) {
  const frame = new Map();
  UPPER_BUTTONS.forEach((cc, index) => {
    const param = params.find(p => p.name === targets[index]);
    let color = UPPER_LED.unassigned;
    if (param && typeof param.value === 'number') {
      const moved = Number.isFinite(param.default) && Math.abs(param.value - param.default) > 1e-9;
      color = moved ? UPPER_LED.moved : UPPER_LED.atDefault;
    }
    frame.set(cc, { base: color, channel: 0 });
  });
  return frame;
}

const ledKey = led => `${led.base}/${led.target ?? ''}/${led.channel}`;

// Push only advances LED animations on incoming MIDI clock. Feed it a fixed rate that is
// unrelated to the app tempo, so a playing pad pulses slowly and steadily; the beat is
// shown on Tap Tempo instead.
export const ANIMATION_CLOCK_BPM = 120;

// Jog wheel: browse the performance library on the screen; press to load.
export const BROWSE_TIMEOUT_MS = 8000;

export function createPush3Adapter({
  launcher, leds, store, registry, effects, diagnostics, transport = null, modulations = null,
  library = null, onBrowse = null, now = () => (globalThis.performance?.now?.() ?? Date.now()),
  schedule = callback => (globalThis.requestAnimationFrame ?? setTimeout)(callback),
} = {}) {
  let shiftHeld = false;
  let lastFrame = new Map();
  let lastButtons = new Map();
  let lastPlay = null;
  let browse = null; // { index, until } while the jog wheel is browsing performances
  const heldLower = new Map(); // lower button index → { moved } while pressed
  let renderQueued = false;
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

  function sendButtons(frame) {
    let sent = 0;
    for (const [cc, led] of frame) {
      const previous = lastButtons.get(cc);
      if (previous && ledKey(previous) === ledKey(led)) continue;
      if (leds.setButton(cc, led.base).ok) { lastButtons.set(cc, led); sent += 1; }
    }
    return sent;
  }

  function render() {
    renderQueued = false;
    if (!leds.hasOutput()) { lastFrame = new Map(); lastButtons = new Map(); return 0; }
    const state = launcher.snapshot();
    const params = registry.listParams();
    return sendFrame(renderPadFrame({ state, entries: store.list(), effects: effects.list() }))
      + sendButtons(renderUpperButtons({ targets: state.targets, params }))
      + sendButtons(renderLowerButtons({ modulations }));
  }

  // Lower button N = modulation N. Press-and-release toggles it (Shift: steps its
  // waveform); the first empty slot creates a new modulation (lfoN). While the button is
  // held, the encoder above it edits the modulation instead of its control: depth by
  // default, rate with Shift. A press that edited something does not toggle on release.
  const BEAT_STEPS = [0.25, 0.5, 1, 2, 4, 8, 16];
  function lowerButtonRelease(index) {
    const held = heldLower.get(index);
    heldLower.delete(index);
    if (!modulations || !held || held.moved) return Boolean(held);
    const slots = modulationSlots(modulations);
    const m = slots[index];
    if (!m) {
      const firstEmpty = slots.findIndex(slot => !slot);
      return index === firstEmpty ? Boolean(modulations.add({})) : false;
    }
    return shiftHeld ? Boolean(modulations.cycleWave(m.id)) : Boolean(modulations.toggle(m.id));
  }
  function editHeldModulation(index, delta) {
    const held = heldLower.get(index);
    if (!held || !modulations) return false;
    const m = modulationSlots(modulations)[index];
    if (!m) return true; // holding an empty slot swallows the turn
    held.moved = true;
    if (shiftHeld) {
      if (m.sync) {
        const at = BEAT_STEPS.findIndex(b => Math.abs(b - m.beats) < 1e-9);
        const next = BEAT_STEPS[Math.min(BEAT_STEPS.length - 1, Math.max(0, (at < 0 ? 2 : at) + Math.sign(delta)))];
        modulations.update(m.id, { beats: next });
      } else {
        modulations.update(m.id, { hz: Math.min(30, Math.max(0.01, m.hz + delta * 0.1)) });
      }
    } else {
      modulations.update(m.id, { depth: Math.min(1, Math.max(0, m.depth + delta * 0.02)) });
    }
    return true;
  }

  // Upper button under encoder N: press resets its control to the saved default;
  // Shift + press moves the column to the next numeric control.
  function upperButton(index) {
    const state = launcher.snapshot();
    const numeric = registry.listParams().filter(p => typeof p.value === 'number');
    const current = state.targets[index];
    if (shiftHeld) {
      if (!numeric.length) return false;
      const at = numeric.findIndex(p => p.name === current);
      const next = numeric[(at + 1) % numeric.length].name;
      return launcher.assignEncoder(index, next);
    }
    const param = numeric.find(p => p.name === current);
    if (!param || !Number.isFinite(param.default)) return false;
    registry.setParam(param.name, param.default);
    return true;
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    schedule(render);
  }

  function browseStep(direction) {
    const entries = library?.list?.() ?? [];
    if (!entries.length) { diagnostics?.info?.('No saved performances to browse', 'Save one in Tools → Performance first.'); return true; }
    const currentIndex = Math.max(0, entries.findIndex(entry => entry.id === library.currentId?.()));
    const start = browse ? browse.index : currentIndex;
    const index = ((start + direction) % entries.length + entries.length) % entries.length;
    browse = { index, until: now() + BROWSE_TIMEOUT_MS };
    onBrowse?.(browseState());
    return true;
  }

  function browseLoad() {
    const entries = library?.list?.() ?? [];
    if (!browse || !entries[browse.index]) return false;
    const entry = entries[browse.index];
    browse = null;
    onBrowse?.(null);
    void library.load?.(entry.id);
    return true;
  }

  function browseState() {
    if (!browse) return null;
    const entries = library?.list?.() ?? [];
    const entry = entries[browse.index];
    if (!entry) return null;
    return { index: browse.index, count: entries.length, id: entry.id, name: entry.name, thumbnail: entry.thumbnail ?? null, sceneCount: entry.sceneCount ?? 0, isCurrent: entry.id === library.currentId?.() };
  }

  // Once per animation frame. Keeps the fixed-rate animation clock running whenever an
  // output exists (the bench's Clear/Release can stop it), refreshes the LEDs when an
  // output appears, and lets a stale browse selection expire.
  function frame() {
    if (browse && now() > browse.until) { browse = null; onBrowse?.(null); }
    const has = leds.hasOutput();
    if (has && !hadOutput) { lastFrame = new Map(); lastButtons = new Map(); lastPlay = null; scheduleRender(); }
    if (!has && hadOutput) { lastFrame = new Map(); lastButtons = new Map(); lastPlay = null; }
    if (has && !leds.clockRunning()) leds.startClock(ANIMATION_CLOCK_BPM);
    if (has && transport) {
      const color = playLed(transport.status());
      if (color !== lastPlay && leds.setButton(PUSH3_BUTTONS.play, color).ok) lastPlay = color;
    }
    hadOutput = has;
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
      if (editHeldModulation(event.encoder, event.delta)) return true;
      launcher.dispatch({ action: 'encoder', index: event.encoder, value: event.delta, relative: true, fine: shiftHeld });
      return true;
    }
    if (event.kind === 'encoder' && event.encoder === 'jog' && Number.isFinite(event.delta) && event.delta !== 0) {
      return browseStep(Math.sign(event.delta));
    }
    // Volume encoder: master output level, 2% per click, 0.5% with Shift.
    if (event.kind === 'encoder' && event.encoder === 'volume' && transport?.setVolume && Number.isFinite(event.delta)) {
      const current = transport.status()?.volume ?? 1;
      transport.setVolume(Math.min(1, Math.max(0, current + event.delta * (shiftHeld ? 0.005 : 0.02))));
      return true;
    }
    if (event.kind === 'button' && event.pressed) {
      if (event.name === 'pageLeft') { launcher.dispatch({ action: 'bankPrevious' }); return true; }
      if (event.name === 'pageRight') { launcher.dispatch({ action: 'bankNext' }); return true; }
      const upper = UPPER_BUTTONS.indexOf(event.cc);
      if (upper >= 0) { upperButton(upper); return true; }
      const lower = LOWER_BUTTONS.indexOf(event.cc);
      if (lower >= 0) { heldLower.set(lower, { moved: false }); return true; }
      if (event.name === 'play' && transport) { void transport.toggle(); return true; }
      if (event.name === 'jogPress') return browseLoad() || true;
      if (event.name === 'jogLeft') return browseStep(-1);
      if (event.name === 'jogRight') return browseStep(1);
    }
    if (event.kind === 'button' && !event.pressed && LOWER_BUTTONS.includes(event.cc)) { lowerButtonRelease(LOWER_BUTTONS.indexOf(event.cc)); return true; }
    return event.kind === 'button' && (['pageLeft', 'pageRight', 'play', 'jogPress', 'jogLeft', 'jogRight'].includes(event.name) || UPPER_BUTTONS.includes(event.cc) || LOWER_BUTTONS.includes(event.cc));
  }

  const unsubscribe = [
    launcher.subscribe(scheduleRender),
    registry.subscribe(scheduleRender),
    modulations?.subscribe?.(scheduleRender) ?? (() => {}),
    leds.subscribe(() => { if (leds.hasOutput() !== hadOutput) scheduleRender(); }),
  ];

  return {
    frame,
    handleInput,
    render,
    browseState,
    snapshot() { return { shiftHeld, lit: lastFrame.size, buttons: lastButtons.size, browsing: browseState(), heldLower: [...heldLower.keys()] }; },
    dispose() { for (const stop of unsubscribe) stop(); },
  };
}
