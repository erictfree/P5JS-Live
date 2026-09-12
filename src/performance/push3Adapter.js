// Turns Push 3 input into the launcher's existing logical actions and renders launcher
// state back onto the 64 pad LEDs. Rows 1–4 (pad indices 0–31) are performance slots in
// the current bank; rows 5–8 (32–63) are effect toggles. The virtual surface in
// performanceLauncher.js splits the same way and remains the reference behaviour.

import { PUSH3_BUTTONS, PUSH3_COLORS, animationChannel } from './push3Map.js';
import { WAVEFORMS, WAVE_GLYPHS } from './modulations.js';
import { PADS_PER_BANK } from './launcher.js';


// One steady hue per slot position so neighbouring pads read as different performances.
// Pad/LED hues by slot position, matching displayTheme's scene accents in order:
// lime, purple, mint, cyan, blue, red, white, yellow (nearest measured entries).
// Amber is reserved for modulation on the lower buttons and the screen.
export const PERFORMANCE_HUES = Object.freeze([
  PUSH3_COLORS.lime, PUSH3_COLORS.violet, PUSH3_COLORS.mint, PUSH3_COLORS.skyBlue,
  PUSH3_COLORS.blue, PUSH3_COLORS.warmRed, PUSH3_COLORS.white, PUSH3_COLORS.yellow,
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
export const LOWER_LED = Object.freeze({ none: PUSH3_COLORS.off, defined: PUSH3_COLORS.darkGray, running: PUSH3_COLORS.amber, editing: PUSH3_COLORS.white });

// Encoder layout while editing a modulation (one parameter per column).
export const EDIT_COLUMNS = Object.freeze(['wave', 'rate', 'rateMode', 'depth', 'offset', 'moves', 'on', null]);
// Encoder layout while editing a control (Shift + upper button): which control sits in
// the column, its value, range, step, the default a press resets to, and the modulation
// that moves it. Same fields as the browser's live-control form.
export const CONTROL_EDIT_COLUMNS = Object.freeze(['control', 'value', 'min', 'max', 'step', 'default', 'mod', null]);
// Step sizes the Step column walks through; 0 = free (no quantising).
export const STEP_LADDER = Object.freeze([0, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10, 50, 100]);
const tidy = value => Number(value.toFixed(6));

export function modulationSlots(modulations) {
  const list = modulations?.list?.() ?? [];
  return Array.from({ length: LOWER_BUTTONS.length }, (_, index) => list[index] ?? null);
}

// Each modulation has a colour by slot (same order as the scene accents), shown on its
// lower button when running; dim when defined but stopped; white while being edited.
export function renderLowerButtons({ modulations, editingId = null }) {
  const frame = new Map();
  modulationSlots(modulations).forEach((m, index) => {
    const color = !m ? LOWER_LED.none : m.id === editingId ? LOWER_LED.editing : m.on ? PERFORMANCE_HUES[index % PERFORMANCE_HUES.length] : LOWER_LED.defined;
    frame.set(LOWER_BUTTONS[index], { base: color, channel: 0 });
  });
  return frame;
}

export const UPPER_LED = Object.freeze({ unassigned: PUSH3_COLORS.off, editing: PUSH3_COLORS.white });

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
// Upper button LEDs all take the screen's accent — the running scene's pad hue — when a
// control is assigned in that column (Live lights them in the selected track's colour),
// and go dark when the column is empty. With no scene running they use white.
export function sceneAccentHue(state) {
  if (!state?.active) return PUSH3_COLORS.litWhite;
  const slot = state.slots.indexOf(state.active);
  return slot >= 0 ? PERFORMANCE_HUES[(slot % PADS_PER_BANK) % PERFORMANCE_HUES.length] : PUSH3_COLORS.litWhite;
}

export function renderUpperButtons({ targets, params, accent = PUSH3_COLORS.litWhite, editingColumn = null }) {
  const frame = new Map();
  UPPER_BUTTONS.forEach((cc, index) => {
    const param = params.find(p => p.name === targets[index]);
    const assigned = Boolean(param) && typeof param.value === 'number';
    frame.set(cc, { base: index === editingColumn ? UPPER_LED.editing : assigned ? accent : UPPER_LED.unassigned, channel: 0 });
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
  let volumeShownUntil = 0; // the screen shows the level for a moment after the Volume encoder moves
  let touched = null; // { index, at } — the encoder column moved most recently
  const TOUCH_MS = 2500;
  let editingId = null; // modulation being edited with the encoders (Shift + lower button)
  let editingColumn = null; // encoder column whose control is being edited (Shift + upper button)
  const VOLUME_FLASH_MS = 2500;
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
      + sendButtons(renderUpperButtons({ targets: state.targets, params, accent: sceneAccentHue(state), editingColumn }))
      + sendButtons(renderLowerButtons({ modulations, editingId: editState() ? editingId : null }));
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
    if (shiftHeld) { editingId = editingId === m.id ? null : m.id; editingColumn = null; scheduleRender(); return true; }
    return Boolean(modulations.toggle(m.id));
  }

  // Control edit mode: the eight encoders set the chosen column's control.
  function controlEditState() {
    const state = launcher.snapshot();
    const numeric = registry.listParams().filter(p => typeof p.value === 'number');
    const param = numeric.find(p => p.name === state.targets[editingColumn]) ?? null;
    const mods = modulations?.list?.() ?? [];
    const moving = param ? mods.find(m => m.target === param.name) : null;
    const num = (value, fallback) => (Number.isFinite(value) ? value : fallback);
    return {
      kind: 'control', column: editingColumn, name: param?.name ?? '', value: param?.value ?? null,
      min: num(param?.min, 0), max: num(param?.max, 1), step: num(param?.step, 0), default: num(param?.default, null),
      controls: numeric.map(p => p.name), modulation: moving?.name ?? '', modulations: mods.map(m => m.name),
      columns: CONTROL_EDIT_COLUMNS,
    };
  }
  function editControlWithEncoder(index, delta) {
    const state = controlEditState();
    const step = Math.sign(delta);
    const wrap = (list, at) => list[((at + step) % list.length + list.length) % list.length];
    const inc = state.step > 0 ? state.step : (state.max - state.min) / 100;
    const clamp = value => Math.min(state.max, Math.max(state.min, value));
    switch (CONTROL_EDIT_COLUMNS[index]) {
      case 'control':
        if (state.controls.length) launcher.assignEncoder(editingColumn, wrap(state.controls, state.controls.indexOf(state.name)));
        break;
      case 'value':
        if (state.name) launcher.dispatch({ action: 'encoder', index: editingColumn, value: delta, relative: true, fine: shiftHeld });
        break;
      case 'min': if (state.name) registry.updateParam(state.name, { min: tidy(Math.min(state.max - inc, state.min + delta * inc)) }); break;
      case 'max': if (state.name) registry.updateParam(state.name, { max: tidy(Math.max(state.min + inc, state.max + delta * inc)) }); break;
      case 'step': {
        if (!state.name) break;
        let at = STEP_LADDER.findIndex(s => Math.abs(s - state.step) < 1e-9);
        if (at < 0) at = Math.max(0, STEP_LADDER.findIndex(s => s > state.step) - (step > 0 ? 1 : 0));
        registry.updateParam(state.name, { step: STEP_LADDER[Math.min(STEP_LADDER.length - 1, Math.max(0, at + step))] });
        break;
      }
      case 'default':
        if (state.name && Number.isFinite(state.default)) registry.updateParam(state.name, { default: tidy(clamp(state.default + delta * inc)) });
        break;
      case 'mod': {
        if (!state.name || !modulations) break;
        const options = ['', ...state.modulations];
        const next = wrap(options, options.indexOf(state.modulation));
        const mods = modulations.list();
        const current = mods.find(m => m.name === state.modulation);
        if (current && current.name !== next) modulations.update(current.id, { target: '' });
        const chosen = mods.find(m => m.name === next);
        if (chosen) modulations.update(chosen.id, { target: state.name });
        break;
      }
      default: break;
    }
    return true;
  }

  // Edit mode: the eight encoders set the chosen modulation's parameters.
  function editState() {
    if (Number.isInteger(editingColumn)) return controlEditState();
    if (!editingId || !modulations) return null;
    const m = modulations.get?.(editingId) ?? modulations.list().find(entry => entry.id === editingId);
    if (!m) { editingId = null; return null; }
    const numeric = registry.listParams().filter(p => typeof p.value === 'number').map(p => p.name);
    return {
      kind: 'modulation', id: m.id, name: m.name, wave: m.wave, glyph: WAVE_GLYPHS[m.wave], sync: m.sync, beats: m.beats, hz: m.hz,
      depth: m.depth, offset: m.offset, target: m.target || '', on: m.on, targets: numeric,
      phase: modulations.phase?.(m.id) ?? null, signal: modulations.signal?.(m.name),
      slot: modulationSlots(modulations).findIndex(entry => entry?.id === m.id),
      columns: EDIT_COLUMNS,
    };
  }
  function editWithEncoder(index, delta) {
    if (Number.isInteger(editingColumn)) return editControlWithEncoder(index, delta);
    const state = editState();
    if (!state) return false;
    const step = Math.sign(delta);
    switch (EDIT_COLUMNS[index]) {
      case 'wave': modulations.update(state.id, { wave: WAVEFORMS[((WAVEFORMS.indexOf(state.wave) + step) % WAVEFORMS.length + WAVEFORMS.length) % WAVEFORMS.length] }); break;
      case 'rate':
        if (state.sync) {
          const at = BEAT_STEPS.findIndex(b => Math.abs(b - state.beats) < 1e-9);
          modulations.update(state.id, { beats: BEAT_STEPS[Math.min(BEAT_STEPS.length - 1, Math.max(0, (at < 0 ? 2 : at) + step))] });
        } else modulations.update(state.id, { hz: Math.min(30, Math.max(0.01, Math.round((state.hz + delta * 0.1) * 100) / 100)) });
        break;
      case 'rateMode': modulations.update(state.id, { sync: step < 0 ? false : true }); break;
      case 'depth': modulations.update(state.id, { depth: Math.min(1, Math.max(0, state.depth + delta * 0.02)) }); break;
      case 'offset': modulations.update(state.id, { offset: Math.min(1, Math.max(-1, state.offset + delta * 0.02)) }); break;
      case 'moves': {
        const options = ['', ...state.targets];
        const at = Math.max(0, options.indexOf(state.target));
        modulations.update(state.id, { target: options[((at + step) % options.length + options.length) % options.length] });
        break;
      }
      case 'on': modulations.update(state.id, { on: step > 0 }); break;
      default: break;
    }
    return true;
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
  // Shift + press edits that column's control on the screen (again to leave). Choosing
  // which control sits in the column is the first encoder of that screen.
  function upperButton(index) {
    if (shiftHeld) {
      editingColumn = editingColumn === index ? null : index;
      editingId = null;
      scheduleRender();
      return true;
    }
    const state = launcher.snapshot();
    const numeric = registry.listParams().filter(p => typeof p.value === 'number');
    const param = numeric.find(p => p.name === state.targets[index]);
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
      if (editWithEncoder(event.encoder, event.delta)) return true;
      touched = { index: event.encoder, at: now() };
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
      volumeShownUntil = now() + VOLUME_FLASH_MS;
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
    editState,
    // Level readout for the screen: active for a moment after the Volume encoder moves.
    volumeOverlay() { return { level: transport?.status?.()?.volume ?? 1, active: now() < volumeShownUntil }; },
    // Column whose encoder moved within the last moment, for the reverse-video tab.
    lastTouched() { return touched && now() - touched.at < TOUCH_MS ? touched.index : null; },
    snapshot() { return { shiftHeld, lit: lastFrame.size, buttons: lastButtons.size, browsing: browseState(), heldLower: [...heldLower.keys()] }; },
    dispose() { for (const stop of unsubscribe) stop(); },
  };
}
