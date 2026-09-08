import { describe, it, expect, vi } from 'vitest';
import { createPerformanceLauncher, validateLauncher } from '../../src/performance/launcher.js';
import { createRegistry } from '../../src/host/registry.js';
import { createControlManager } from '../../src/control/controlManager.js';
import { createProjectStore } from '../../src/persistence/projectStore.js';

function harness() {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const registry = createRegistry();
  registry.declareParam('size', 50, { min: 10, max: 110, step: 1 });
  const entries = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const store = { list: () => entries, get: id => entries.find(p => p.id === id) };
  const clock = { running: true, beat: 2.25 };
  const launch = vi.fn(async () => ({ ok: true })), tap = vi.fn(), safe = vi.fn();
  const deps = { store, registry, launch, clock: () => clock, tap, safe, storage };
  const launcher = createPerformanceLauncher(deps); launcher.sync();
  return { launcher, registry, entries, clock, launch, tap, safe, deps };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('performance controller', () => {
  it('keeps pad holes stable across deletion, sync and reload, with explicit reassignment', () => {
    const h = harness(); h.entries.shift(); h.launcher.sync();
    expect(h.launcher.snapshot().slots).toEqual([null, 'b']);
    h.launcher.assign(1, null); h.launcher.sync();
    expect(h.launcher.snapshot().slots).toEqual([null, null]);
    h.entries.push({ id: 'c' }); h.launcher.sync();
    const restored = createPerformanceLauncher(h.deps); restored.sync();
    expect(restored.snapshot().slots).toEqual([null, null, 'c']);
    expect(restored.assign(64, 'c')).toBe(true);
    expect(restored.snapshot().slots[64]).toBe('c');
  });
  it('queues, replaces and cancels next-beat launches and falls back when the clock stops', async () => {
    const h = harness(); h.launcher.request(0, 'beat'); h.launcher.tick(); expect(h.launch).not.toHaveBeenCalled();
    h.launcher.request(1, 'beat'); h.clock.beat = 3; h.launcher.tick(); await flush();
    expect(h.launch).toHaveBeenCalledWith(h.entries[1]); expect(h.launcher.snapshot().active).toBe('b');
    h.launcher.request(0, 'beat'); h.launcher.cancel(); h.clock.beat = 5; h.launcher.tick(); expect(h.launch).toHaveBeenCalledTimes(1);
    h.launcher.request(0, 'beat'); h.clock.running = false; h.launcher.tick(); await flush();
    expect(h.launcher.snapshot().active).toBe('a');
  });
  it('reports failed loads without changing the playing identity and rejects overlapping launches', async () => {
    const h = harness(); h.launcher.request(0); await flush();
    let finish; h.launch.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    h.launcher.request(1); expect(h.launcher.request(0)).toBe(false);
    finish({ ok: false, error: new Error('Bad patch') }); await flush();
    expect(h.launcher.snapshot()).toMatchObject({ active: 'a', loading: null, error: { id: 'b', message: 'Bad patch' } });
  });
  it('applies relative steps and absolute pickup within source ranges; reconnect rearms pickup', async () => {
    const h = harness(); h.launcher.request(0); await flush();
    expect(h.launcher.dispatch({ action: 'encoder', index: 0, value: 0, relative: false })).toBe(false);
    expect(h.registry.listParams()[0].value).toBe(50);
    h.launcher.dispatch({ action: 'encoder', index: 0, value: .5, relative: false });
    expect(h.registry.listParams()[0].value).toBe(60);
    h.launcher.dispatch({ action: 'encoder', index: 0, value: -2 });
    expect(h.registry.listParams()[0].value).toBe(58);
    h.launcher.disconnect();
    expect(h.launcher.dispatch({ action: 'encoder', index: 0, value: 0, relative: false })).toBe(false);
    h.launcher.dispatch({ action: 'encoder', index: 0, value: 999 });
    expect(h.registry.listParams()[0].value).toBe(110);
  });
  it('remembers independent encoder targets per performance', async () => {
    const h = harness(); h.registry.declareParam('speed', .2);
    h.launcher.request(0); await flush(); h.launcher.assignEncoder(0, 'speed');
    h.launcher.request(1); await flush(); expect(h.launcher.snapshot().targets[0]).toBe('size');
    h.launcher.request(0); await flush(); expect(h.launcher.snapshot().targets[0]).toBe('speed');
  });
  it('routes real MIDI parsing through the same logical actions and suppresses repeated presses', async () => {
    const h = harness(), manager = createControlManager({ registry: h.registry, navigator_: {} });
    manager.setMessageRouter(h.launcher.receive);
    const input = { name: 'Test' };
    h.launcher.learn('pad', 1);
    manager.receive(input, [0x90, 36, 100]); expect(h.launch).not.toHaveBeenCalled();
    manager.receive(input, [0x80, 36, 0]); manager.receive(input, [0x90, 36, 100]); await flush();
    manager.receive(input, [0x90, 36, 99]); expect(h.launch).toHaveBeenCalledTimes(1);
    expect(h.launcher.snapshot().active).toBe('b');
    h.launcher.learn('encoder', 0, 'relative'); manager.receive(input, [0x90, 0, 100]);
    expect(h.launcher.snapshot().learning).not.toBeNull();
    manager.receive(input, [0xb0, 71, 1]); manager.receive(input, [0xb0, 71, 127]);
    expect(h.registry.listParams()[0].value).toBe(49);
    h.launcher.disconnect(); manager.receive(input, [0x90, 36, 100]); await flush();
    expect(h.launch).toHaveBeenCalledTimes(2);
  });
  it('uses bank-relative pad routes and keeps host actions shared', async () => {
    const h = harness(); h.launcher.assign(64, 'b'); h.launcher.dispatch({ action: 'bankNext' });
    h.launcher.dispatch({ action: 'pad', index: 0 }); await flush(); expect(h.launcher.snapshot().active).toBe('b');
    h.launcher.dispatch({ action: 'tap' }); h.launcher.dispatch({ action: 'safe' });
    expect(h.tap).toHaveBeenCalledOnce(); expect(h.safe).toHaveBeenCalledOnce(); expect(h.launcher.snapshot().active).toBeNull();
  });
  it('rejects malformed portable assignments and roundtrips them through projects', () => {
    const h = harness(); h.launcher.assignEncoder(0, 'size');
    const project = createProjectStore({ registry: h.registry, storage: h.deps.storage });
    const json = project.exportProject('const scene = [];', { launcher: h.launcher.export(), performances: [] });
    const parsed = project.parseProject(json);
    expect(parsed.ok).toBe(true); expect(parsed.data.launcher).toEqual(h.launcher.export());
    expect(() => validateLauncher({ ...h.launcher.export(), routes: [{ action: 'arbitraryCode' }] })).toThrow();
    const broken = JSON.parse(json); broken.launcher.slots = [42];
    expect(project.parseProject(JSON.stringify(broken)).ok).toBe(false);
  });
});
