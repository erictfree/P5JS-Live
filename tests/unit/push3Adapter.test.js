import { describe, expect, it, vi } from 'vitest';
import { PUSH3_COLORS, animationChannel } from '../../src/performance/push3Map.js';
import { PADS_PER_BANK } from '../../src/performance/launcher.js';
import { BROWSE_TIMEOUT_MS, LOWER_BUTTONS, LOWER_LED, PERFORMANCE_HUES, PLAY_LED, UPPER_BUTTONS, UPPER_LED, createPush3Adapter, padLed, playLed, renderLowerButtons, renderPadFrame, renderUpperButtons, slotStatus } from '../../src/performance/push3Adapter.js';
import { PUSH3_BUTTONS } from '../../src/performance/push3Map.js';

const entries = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
const baseState = { bank: 0, slots: ['a', 'b', null, 'ghost'], active: null, queued: null, loading: null, error: null, targets: ['size', 'speed', null, null, null, null, null, null] };
const baseParams = [{ name: 'size', value: 50, default: 50, min: 10, max: 110 }, { name: 'speed', value: 0.4, default: 0.3, min: 0, max: 1 }, { name: 'hue', value: 0, default: 0 }];

function fakeLeds({ output = true } = {}) {
  const listeners = new Set();
  return {
    hasOutput: vi.fn(() => output),
    setPad: vi.fn(() => ({ ok: true })),
    setButton: vi.fn(() => ({ ok: true })),
    animatePad: vi.fn(() => ({ ok: true })),
    clockRunning: vi.fn(() => false),
    startClock: vi.fn(() => ({ ok: true })),
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    _notify: () => listeners.forEach(fn => fn()),
  };
}

function harness({ state = baseState, effects = [], output = true, audio = { kind: 'none', loaded: false, playing: false, volume: 1 }, performances = null, currentId = null, time = { now: 0 }, mods = null } = {}) {
  const launcherListeners = new Set();
  const launcher = {
    snapshot: vi.fn(() => ({ ...state })),
    dispatch: vi.fn(() => true),
    assignEncoder: vi.fn(() => true),
    subscribe: fn => { launcherListeners.add(fn); return () => launcherListeners.delete(fn); },
    _notify: () => launcherListeners.forEach(fn => fn()),
  };
  const registry = { subscribe: vi.fn(() => () => {}), listParams: vi.fn(() => baseParams.map(p => ({ ...p }))), setParam: vi.fn() };
  const store = { list: () => entries };
  const board = { list: vi.fn(() => effects), toggle: vi.fn(index => (effects[index] ? { name: effects[index].name, value: !effects[index].value } : null)) };
  const leds = fakeLeds({ output });
  const queue = [];
  const transport = { toggle: vi.fn(async () => true), status: vi.fn(() => audio), setVolume: vi.fn(level => { audio.volume = level; return level; }) };
  const library = performances ? { list: vi.fn(() => performances), currentId: vi.fn(() => currentId), load: vi.fn(async () => ({ ok: true })) } : null;
  const onBrowse = vi.fn();
  const modulations = mods ? { forTarget: vi.fn(t => mods.filter(m => m.target === t)), toggleForTarget: vi.fn(() => ({ ok: true })), cycleWave: vi.fn(() => ({ ok: true })), subscribe: vi.fn(() => () => {}) } : null;
  const adapter = createPush3Adapter({ launcher, leds, store, registry, effects: board, transport, library, onBrowse, modulations, now: () => time.now, schedule: fn => queue.push(fn) });
  const flush = () => { while (queue.length) queue.shift()(); };
  return { adapter, launcher, leds, board, registry, transport, audio, library, onBrowse, modulations, time, flush };
}

describe('Push 3 adapter', () => {
  it('derives pad status the same way as the virtual surface', () => {
    expect(slotStatus(baseState, entries, 0)).toBe('ready');
    expect(slotStatus(baseState, entries, 2)).toBe('empty');
    expect(slotStatus(baseState, entries, 3)).toBe('empty'); // unknown id
    expect(slotStatus({ ...baseState, active: 'a' }, entries, 0)).toBe('playing');
    expect(slotStatus({ ...baseState, queued: { id: 'b' } }, entries, 1)).toBe('queued');
    expect(slotStatus({ ...baseState, loading: 'a' }, entries, 0)).toBe('loading');
    expect(slotStatus({ ...baseState, error: { id: 'a' } }, entries, 0)).toBe('failed');
  });

  it('lights a ready pad steadily in its hue and pulses the playing one slowly', () => {
    expect(padLed('ready', 0)).toEqual({ base: PERFORMANCE_HUES[0], channel: 0 });
    expect(padLed('playing', 1)).toEqual({ base: PERFORMANCE_HUES[1], target: PUSH3_COLORS.off, channel: animationChannel('pulse', '1/2') });
    expect(padLed('queued', 0)).toMatchObject({ base: PUSH3_COLORS.amber, channel: animationChannel('pulse', '1/8') });
    expect(padLed('loading', 0)).toMatchObject({ base: PUSH3_COLORS.litWhite, channel: animationChannel('blink', '1/8') });
    expect(padLed('failed', 0)).toEqual({ base: PUSH3_COLORS.warmRed, channel: 0 });
    expect(padLed('empty', 0)).toEqual({ base: 0, channel: 0 });
    expect(padLed('on', 0)).toEqual({ base: PUSH3_COLORS.green, channel: 0 });
    expect(padLed('off', 0)).toEqual({ base: PUSH3_COLORS.darkGray, channel: 0 });
  });

  it('renders 32 performance pads from the current bank and 32 effect pads', () => {
    const frame = renderPadFrame({ state: { ...baseState, bank: 1, slots: [...Array(32).fill(null), 'a'] }, entries, effects: [{ name: 'glow', value: true }, { name: 'freeze', value: false }] });
    expect(frame.size).toBe(64);
    expect(frame.get(0)).toEqual({ base: PERFORMANCE_HUES[0], channel: 0 });
    expect(frame.get(1)).toEqual({ base: 0, channel: 0 });
    expect(frame.get(32)).toEqual({ base: PUSH3_COLORS.green, channel: 0 });
    expect(frame.get(33)).toEqual({ base: PUSH3_COLORS.darkGray, channel: 0 });
    expect(frame.get(34)).toEqual({ base: 0, channel: 0 });
  });

  it('sends the full frame once, then only changes', () => {
    let state = { ...baseState };
    const h = harness({ state, effects: [{ name: 'glow', value: false }] });
    h.launcher.snapshot.mockImplementation(() => ({ ...state }));
    expect(h.adapter.render()).toBe(80);
    expect(h.leds.setPad).toHaveBeenCalledWith(0, PERFORMANCE_HUES[0]);
    expect(h.leds.setPad).toHaveBeenCalledWith(32, PUSH3_COLORS.darkGray);
    h.leds.setPad.mockClear(); h.leds.animatePad.mockClear();

    state = { ...state, active: 'a' };
    h.launcher._notify(); h.flush();
    expect(h.leds.animatePad).toHaveBeenCalledTimes(1);
    expect(h.leds.animatePad).toHaveBeenCalledWith(0, PERFORMANCE_HUES[0], PUSH3_COLORS.off, animationChannel('pulse', '1/2'));
    expect(h.leds.setPad).not.toHaveBeenCalled();

    h.launcher._notify(); h.flush();
    expect(h.leds.animatePad).toHaveBeenCalledTimes(1);
  });

  it('routes pads, encoders, page buttons and Shift into launcher actions and effects', () => {
    const h = harness({ effects: [{ name: 'glow', value: false }] });
    expect(h.adapter.handleInput({ kind: 'pad', index: 3, pressed: true, pressure: 90 })).toBe(true);
    expect(h.launcher.dispatch).toHaveBeenLastCalledWith({ action: 'pad', index: 3 });
    expect(h.adapter.handleInput({ kind: 'pad', index: 3, pressed: false, pressure: 0 })).toBe(true);
    expect(h.launcher.dispatch).toHaveBeenCalledTimes(1);

    h.adapter.handleInput({ kind: 'button', name: 'shift', pressed: true });
    h.adapter.handleInput({ kind: 'pad', index: 5, pressed: true, pressure: 10 });
    expect(h.launcher.dispatch).toHaveBeenLastCalledWith({ action: 'pad', index: 5, timing: 'immediate' });
    h.adapter.handleInput({ kind: 'encoder', encoder: 2, delta: -1 });
    expect(h.launcher.dispatch).toHaveBeenLastCalledWith({ action: 'encoder', index: 2, value: -1, relative: true, fine: true });
    h.adapter.handleInput({ kind: 'button', name: 'shift', pressed: false });

    expect(h.adapter.handleInput({ kind: 'pad', index: PADS_PER_BANK, pressed: true, pressure: 50 })).toBe(true);
    expect(h.board.toggle).toHaveBeenCalledWith(0);
    expect(h.adapter.handleInput({ kind: 'pad', index: PADS_PER_BANK + 9, pressed: true, pressure: 50 })).toBe(true);
    expect(h.board.toggle).toHaveBeenCalledWith(9);

    expect(h.adapter.handleInput({ kind: 'button', name: 'pageRight', pressed: true })).toBe(true);
    expect(h.launcher.dispatch).toHaveBeenLastCalledWith({ action: 'bankNext' });
    expect(h.adapter.handleInput({ kind: 'button', name: 'pageLeft', pressed: true })).toBe(true);
    expect(h.launcher.dispatch).toHaveBeenLastCalledWith({ action: 'bankPrevious' });
    expect(h.adapter.handleInput({ kind: 'encoder', encoder: 'tempo', delta: 1 })).toBe(false);
    expect(h.adapter.handleInput({ kind: 'encoder', encoder: 'volume', delta: -5 })).toBe(true);
    expect(h.transport.setVolume).toHaveBeenLastCalledWith(0.9);
    h.adapter.handleInput({ kind: 'button', name: 'shift', pressed: true });
    h.adapter.handleInput({ kind: 'encoder', encoder: 'volume', delta: 2 });
    expect(h.transport.setVolume).toHaveBeenLastCalledWith(0.91);
    h.adapter.handleInput({ kind: 'button', name: 'shift', pressed: false });
    h.adapter.handleInput({ kind: 'encoder', encoder: 'volume', delta: 50 });
    expect(h.transport.setVolume).toHaveBeenLastCalledWith(1);
    expect(h.adapter.handleInput({ kind: 'button', name: 'record', pressed: true })).toBe(false);
  });

  it('keeps a fixed 120 BPM animation clock running, independent of the app tempo', () => {
    const h = harness();
    let running = false;
    h.leds.clockRunning.mockImplementation(() => running);
    h.leds.startClock.mockImplementation(() => { running = true; return { ok: true }; });
    h.adapter.frame({ running: true, bpm: 141 });
    h.adapter.frame({ running: true, bpm: 90 });
    expect(h.leds.startClock).toHaveBeenCalledTimes(1);
    expect(h.leds.startClock).toHaveBeenCalledWith(120);
    running = false; // e.g. the bench's Clear LEDs stopped it
    h.adapter.frame({ running: false, bpm: null });
    expect(h.leds.startClock).toHaveBeenCalledTimes(2);
  });

  it('does nothing without an output and refreshes fully when one appears', () => {
    let output = false;
    const h = harness();
    h.leds.hasOutput.mockImplementation(() => output);
    h.adapter.frame({ running: false });
    h.flush();
    expect(h.leds.setPad).not.toHaveBeenCalled();
    output = true;
    h.adapter.frame({ running: false });
    h.flush();
    expect(h.leds.setPad).toHaveBeenCalledTimes(64);
  });

  it('lights the upper button under each assigned encoder, bright when the value has moved', () => {
    const frame = renderUpperButtons({ targets: baseState.targets, params: baseParams });
    expect(frame.get(UPPER_BUTTONS[0])).toEqual({ base: UPPER_LED.atDefault, channel: 0 });
    expect(frame.get(UPPER_BUTTONS[1])).toEqual({ base: UPPER_LED.moved, channel: 0 });
    expect(frame.get(UPPER_BUTTONS[2])).toEqual({ base: UPPER_LED.unassigned, channel: 0 });
    const h = harness();
    h.adapter.render();
    expect(h.leds.setButton).toHaveBeenCalledWith(UPPER_BUTTONS[1], UPPER_LED.moved);
    expect(h.leds.setButton).toHaveBeenCalledTimes(16); // 8 upper + 8 lower
  });

  it('upper button press resets the control; Shift + press moves the column to the next control', () => {
    const h = harness();
    expect(h.adapter.handleInput({ kind: 'button', name: 'upper2', cc: UPPER_BUTTONS[1], pressed: true, value: 127 })).toBe(true);
    expect(h.registry.setParam).toHaveBeenCalledWith('speed', 0.3);
    expect(h.adapter.handleInput({ kind: 'button', name: 'upper3', cc: UPPER_BUTTONS[2], pressed: true, value: 127 })).toBe(true);
    expect(h.registry.setParam).toHaveBeenCalledTimes(1); // unassigned column: nothing to reset
    h.adapter.handleInput({ kind: 'button', name: 'shift', cc: 49, pressed: true, value: 127 });
    h.adapter.handleInput({ kind: 'button', name: 'upper1', cc: UPPER_BUTTONS[0], pressed: true, value: 127 });
    expect(h.launcher.assignEncoder).toHaveBeenCalledWith(0, 'speed');
    h.adapter.handleInput({ kind: 'button', name: 'upper3', cc: UPPER_BUTTONS[2], pressed: true, value: 127 });
    expect(h.launcher.assignEncoder).toHaveBeenCalledWith(2, 'size'); // unassigned wraps to the first control
  });

  it('Play mirrors the audio transport and toggles it', () => {
    expect(playLed({ kind: 'none', loaded: false, playing: false })).toBe(PLAY_LED.none);
    expect(playLed({ kind: 'file', loaded: true, playing: false })).toBe(PLAY_LED.paused);
    expect(playLed({ kind: 'file', loaded: true, playing: true })).toBe(PLAY_LED.playing);
    expect(playLed({ kind: 'mic', loaded: true, playing: true })).toBe(PLAY_LED.none);

    const h = harness({ audio: { kind: 'file', loaded: true, playing: false } });
    h.adapter.frame({});
    h.adapter.frame({});
    expect(h.leds.setButton.mock.calls.filter(([cc]) => cc === PUSH3_BUTTONS.play)).toEqual([[PUSH3_BUTTONS.play, PLAY_LED.paused]]);
    h.audio.playing = true;
    h.adapter.frame({});
    expect(h.leds.setButton).toHaveBeenLastCalledWith(PUSH3_BUTTONS.play, PLAY_LED.playing);
    expect(h.adapter.handleInput({ kind: 'button', name: 'play', cc: PUSH3_BUTTONS.play, pressed: true, value: 127 })).toBe(true);
    expect(h.transport.toggle).toHaveBeenCalledOnce();
    expect(h.adapter.handleInput({ kind: 'button', name: 'play', cc: PUSH3_BUTTONS.play, pressed: false, value: 0 })).toBe(true);
    expect(h.transport.toggle).toHaveBeenCalledOnce();
  });

  it('jog wheel browses performances from the current one, wraps, and press loads the highlighted one', () => {
    const performances = [{ id: 'p1', name: 'One', sceneCount: 2 }, { id: 'p2', name: 'Two', sceneCount: 0, thumbnail: 'data:image/png;base64,AA' }, { id: 'p3', name: 'Three', sceneCount: 5 }];
    const h = harness({ performances, currentId: 'p2' });
    expect(h.adapter.browseState()).toBeNull();
    expect(h.adapter.handleInput({ kind: 'encoder', encoder: 'jog', delta: 1 })).toBe(true);
    expect(h.adapter.browseState()).toMatchObject({ index: 2, count: 3, id: 'p3', name: 'Three', sceneCount: 5, isCurrent: false });
    h.adapter.handleInput({ kind: 'encoder', encoder: 'jog', delta: 3 }); // wraps to the first
    expect(h.adapter.browseState()).toMatchObject({ index: 0, id: 'p1' });
    h.adapter.handleInput({ kind: 'button', name: 'jogLeft', cc: 93, pressed: true, value: 127 }); // back to the last
    expect(h.adapter.browseState()).toMatchObject({ index: 2, id: 'p3' });
    h.adapter.handleInput({ kind: 'button', name: 'jogRight', cc: 95, pressed: true, value: 127 });
    h.adapter.handleInput({ kind: 'button', name: 'jogRight', cc: 95, pressed: true, value: 127 });
    expect(h.adapter.browseState()).toMatchObject({ index: 1, id: 'p2', isCurrent: true, thumbnail: 'data:image/png;base64,AA' });
    expect(h.onBrowse).toHaveBeenCalled();

    expect(h.adapter.handleInput({ kind: 'button', name: 'jogPress', cc: 94, pressed: true, value: 127 })).toBe(true);
    expect(h.library.load).toHaveBeenCalledWith('p2');
    expect(h.adapter.browseState()).toBeNull();
    expect(h.onBrowse).toHaveBeenLastCalledWith(null);
  });

  it('browse selection expires after the timeout and a press with nothing highlighted does nothing', () => {
    const h = harness({ performances: [{ id: 'p1', name: 'One', sceneCount: 1 }], currentId: null });
    h.adapter.handleInput({ kind: 'button', name: 'jogPress', cc: 94, pressed: true, value: 127 });
    expect(h.library.load).not.toHaveBeenCalled();
    h.adapter.handleInput({ kind: 'encoder', encoder: 'jog', delta: -1 });
    expect(h.adapter.browseState()).toMatchObject({ index: 0 });
    h.time.now = BROWSE_TIMEOUT_MS - 1; h.adapter.frame({});
    expect(h.adapter.browseState()).not.toBeNull();
    h.time.now = BROWSE_TIMEOUT_MS + 1; h.adapter.frame({});
    expect(h.adapter.browseState()).toBeNull();
    h.adapter.handleInput({ kind: 'button', name: 'jogPress', cc: 94, pressed: true, value: 127 });
    expect(h.library.load).not.toHaveBeenCalled();
  });

  it('jog input is consumed but harmless without a library or with an empty one', () => {
    const none = harness();
    expect(none.adapter.handleInput({ kind: 'encoder', encoder: 'jog', delta: 1 })).toBe(true);
    expect(none.adapter.browseState()).toBeNull();
    const empty = harness({ performances: [] });
    expect(empty.adapter.handleInput({ kind: 'encoder', encoder: 'jog', delta: 1 })).toBe(true);
    expect(empty.adapter.browseState()).toBeNull();
  });

  it('lower buttons show and toggle the modulation on each column, Shift steps the wave', () => {
    const mods = [{ id: 'a', target: 'speed', on: true, wave: 'sine' }, { id: 'b', target: 'size', on: false, wave: 'square' }];
    const frame = renderLowerButtons({ targets: baseState.targets, modulations: { forTarget: t => mods.filter(m => m.target === t) } });
    expect(frame.get(LOWER_BUTTONS[0])).toEqual({ base: LOWER_LED.defined, channel: 0 }); // size: defined, off
    expect(frame.get(LOWER_BUTTONS[1])).toEqual({ base: LOWER_LED.running, channel: 0 }); // speed: running
    expect(frame.get(LOWER_BUTTONS[2])).toEqual({ base: LOWER_LED.none, channel: 0 });

    const h = harness({ mods });
    expect(h.adapter.handleInput({ kind: 'button', name: 'lower1', cc: LOWER_BUTTONS[0], pressed: true, value: 127 })).toBe(true);
    expect(h.modulations.toggleForTarget).toHaveBeenCalledWith('size');
    expect(h.adapter.handleInput({ kind: 'button', name: 'lower3', cc: LOWER_BUTTONS[2], pressed: true, value: 127 })).toBe(true);
    expect(h.modulations.toggleForTarget).toHaveBeenCalledTimes(1); // unassigned column
    h.adapter.handleInput({ kind: 'button', name: 'shift', cc: 49, pressed: true, value: 127 });
    h.adapter.handleInput({ kind: 'button', name: 'lower2', cc: LOWER_BUTTONS[1], pressed: true, value: 127 });
    expect(h.modulations.cycleWave).toHaveBeenCalledWith('a');
  });
});
