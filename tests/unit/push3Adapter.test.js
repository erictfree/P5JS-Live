import { describe, expect, it, vi } from 'vitest';
import { PUSH3_COLORS, animationChannel } from '../../src/performance/push3Map.js';
import { PADS_PER_BANK } from '../../src/performance/launcher.js';
import { PERFORMANCE_HUES, createPush3Adapter, padLed, renderPadFrame, slotStatus } from '../../src/performance/push3Adapter.js';

const entries = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
const baseState = { bank: 0, slots: ['a', 'b', null, 'ghost'], active: null, queued: null, loading: null, error: null };

function fakeLeds({ output = true } = {}) {
  const listeners = new Set();
  return {
    hasOutput: vi.fn(() => output),
    setPad: vi.fn(() => ({ ok: true })),
    animatePad: vi.fn(() => ({ ok: true })),
    startClock: vi.fn(() => ({ ok: true })),
    stopClock: vi.fn(() => ({ ok: true })),
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    _notify: () => listeners.forEach(fn => fn()),
  };
}

function harness({ state = baseState, effects = [], output = true } = {}) {
  const launcherListeners = new Set();
  const launcher = {
    snapshot: vi.fn(() => ({ ...state })),
    dispatch: vi.fn(() => true),
    subscribe: fn => { launcherListeners.add(fn); return () => launcherListeners.delete(fn); },
    _notify: () => launcherListeners.forEach(fn => fn()),
  };
  const registry = { subscribe: vi.fn(() => () => {}) };
  const store = { list: () => entries };
  const board = { list: vi.fn(() => effects), toggle: vi.fn(index => (effects[index] ? { name: effects[index].name, value: !effects[index].value } : null)) };
  const leds = fakeLeds({ output });
  const queue = [];
  const adapter = createPush3Adapter({ launcher, leds, store, registry, effects: board, schedule: fn => queue.push(fn) });
  const flush = () => { while (queue.length) queue.shift()(); };
  return { adapter, launcher, leds, board, flush };
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

  it('lights a ready pad steadily in its hue and blinks the playing one on the beat', () => {
    expect(padLed('ready', 0)).toEqual({ base: PERFORMANCE_HUES[0], channel: 0 });
    expect(padLed('playing', 1)).toEqual({ base: PERFORMANCE_HUES[1], target: PUSH3_COLORS.off, channel: animationChannel('blink', '1/4') });
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
    expect(h.adapter.render()).toBe(64);
    expect(h.leds.setPad).toHaveBeenCalledWith(0, PERFORMANCE_HUES[0]);
    expect(h.leds.setPad).toHaveBeenCalledWith(32, PUSH3_COLORS.darkGray);
    h.leds.setPad.mockClear(); h.leds.animatePad.mockClear();

    state = { ...state, active: 'a' };
    h.launcher._notify(); h.flush();
    expect(h.leds.animatePad).toHaveBeenCalledTimes(1);
    expect(h.leds.animatePad).toHaveBeenCalledWith(0, PERFORMANCE_HUES[0], PUSH3_COLORS.off, animationChannel('blink', '1/4'));
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
    expect(h.adapter.handleInput({ kind: 'button', name: 'play', pressed: true })).toBe(false);
  });

  it('keeps the hardware animation clock on the app tempo', () => {
    const h = harness();
    h.adapter.frame({ running: true, bpm: 120 });
    expect(h.leds.startClock).toHaveBeenCalledWith(120);
    h.adapter.frame({ running: true, bpm: 120.2 });
    expect(h.leds.startClock).toHaveBeenCalledTimes(1);
    h.adapter.frame({ running: true, bpm: 128 });
    expect(h.leds.startClock).toHaveBeenLastCalledWith(128);
    h.adapter.frame({ running: false, bpm: null });
    expect(h.leds.stopClock).toHaveBeenCalledTimes(1);
    h.adapter.frame({ running: false, bpm: null });
    expect(h.leds.stopClock).toHaveBeenCalledTimes(1);
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
});
