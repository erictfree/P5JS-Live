// The controller surface owns assignments; a performance snapshot never owns it.
export const LAUNCHER_KEY = 'p5js-live.launcher.v1';
// Rows 1–4 of the surface launch performances; rows 5–8 are effect toggles (effectsBoard.js).
export const PADS_PER_BANK = 32;
export const MAX_SLOTS = 4096;
export const BANK_COUNT = MAX_SLOTS / PADS_PER_BANK;
const copy = value => JSON.parse(JSON.stringify(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const validIndex = (value, limit) => Number.isInteger(value) && value >= 0 && value < limit;

export function validateLauncher(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.slots) || value.slots.length > 4096 ||
      !value.slots.every(id => id === null || typeof id === 'string') ||
      !Array.isArray(value.known) || !value.known.every(id => typeof id === 'string') ||
      !Array.isArray(value.assignments) || !Array.isArray(value.routes)) throw new Error('Invalid controller assignments');
  for (const entry of value.assignments) {
    if (typeof entry.id !== 'string' || !Array.isArray(entry.targets) || entry.targets.length !== 8 ||
        !entry.targets.every(name => name === null || typeof name === 'string')) throw new Error('Invalid encoder assignments');
  }
  for (const route of value.routes) {
    if (typeof route.device !== 'string' || !['note', 'cc'].includes(route.type) ||
        !validIndex(route.number, 128) || !validIndex(route.channel - 1, 16) ||
        !['pad', 'encoder', 'tap', 'safe', 'bankNext', 'bankPrevious'].includes(route.action) ||
        (route.action === 'pad' && !validIndex(route.index, 64)) ||
        (route.action === 'encoder' && (!validIndex(route.index, 8) || route.type !== 'cc')) ||
        !['absolute', 'relative'].includes(route.mode)) throw new Error('Invalid MIDI surface route');
  }
  return copy({ version: 1, slots: value.slots, known: value.known,
    assignments: value.assignments, routes: value.routes });
}

export function createPerformanceLauncher({ store, registry, launch, clock, tap, safe,
  storage = globalThis.localStorage, warn = () => {} }) {
  let saved = { version: 1, slots: [], known: [], assignments: [], routes: [] };
  try { const raw = storage?.getItem(LAUNCHER_KEY); if (raw) saved = validateLauncher(JSON.parse(raw)); }
  catch (error) { warn(error.message); }
  let bank = 0, selected = null, active = null, queued = null, loading = null, error = null, learning = null;
  let generation = 0;
  const listeners = new Set(), pickup = new Map(), pressed = new Set();
  const notify = () => { for (const listener of listeners) listener(); };
  const persist = () => { try { storage?.setItem(LAUNCHER_KEY, JSON.stringify(saved)); } catch (e) { warn(e.message); } notify(); };
  const assignmentId = () => active ?? '__working__';
  function targets() {
    const id = assignmentId();
    let entry = saved.assignments.find(item => item.id === id);
    let changed = false;
    if (!entry) { entry = { id, targets: Array(8).fill(null) }; saved.assignments.push(entry); changed = true; }
    // Empty knobs pick up numeric controls that are not yet targeted, in declaration
    // order, so a control added to a running scene lands on the next free knob. A knob
    // whose control no longer exists counts as free too; otherwise a stale name from an
    // earlier scene would push a new control past it to a later column.
    const numeric = registry.listParams().filter(p => typeof p.value === 'number').map(p => p.name);
    const present = new Set(numeric);
    const used = new Set(entry.targets.filter(name => present.has(name)));
    const free = numeric.filter(name => !used.has(name));
    for (let i = 0; i < 8 && free.length; i += 1) {
      if (entry.targets[i] === null || !present.has(entry.targets[i])) { entry.targets[i] = free.shift(); changed = true; }
    }
    // Persist lazily without notifying: this may be called during a UI render.
    if (changed) { try { storage?.setItem(LAUNCHER_KEY, JSON.stringify(saved)); } catch (e) { warn(e.message); } }
    return entry.targets;
  }
  function sync() {
    const entries = store.list(), ids = new Set(entries.map(p => p.id));
    saved.slots = saved.slots.map(id => ids.has(id) ? id : null);
    for (const entry of entries) if (!saved.known.includes(entry.id)) {
      if (saved.slots.length >= MAX_SLOTS) { warn(`All ${BANK_COUNT} controller banks are full`); break; }
      saved.slots.push(entry.id); saved.known.push(entry.id);
    }
    if (queued && !ids.has(queued.id)) queued = null;
    persist();
  }
  async function start(id) {
    if (loading) return false;
    const performance = store.get(id);
    if (!performance) return false;
    const token = ++generation;
    loading = id; queued = null; error = null; notify();
    try {
      const result = await launch(performance);
      if (token !== generation) return false;
      if (!result?.ok) throw new Error(result?.error?.message ?? result?.reason ?? 'Launch failed; previous scene restored');
      active = id; pickup.clear();
      return true;
    } catch (e) {
      if (token === generation) { error = { id, message: e.message }; warn(e.message); }
      return false;
    } finally { if (token === generation) { loading = null; notify(); } }
  }
  function request(index, timing = 'immediate') {
    if (!validIndex(index, 4096) || loading) return false;
    selected = index;
    const id = saved.slots[index];
    if (!id || !store.get(id)) { notify(); return false; }
    const now = clock();
    if (timing === 'beat' && now.running && Number.isFinite(now.beat)) {
      queued = { id, beat: Math.floor(now.beat) + 1 }; error = null; notify(); return true;
    }
    if (timing === 'beat') warn('Clock is off — launching immediately');
    void start(id); return true;
  }
  function tick(now = clock()) {
    if (queued && (!now.running || now.beat >= queued.beat)) void start(queued.id);
  }
  function encoder(index, value, relative = true, fine = false) {
    if (!validIndex(index, 8) || !Number.isFinite(value) || loading) return false;
    const name = targets()[index], param = registry.listParams().find(p => p.name === name);
    if (!param || typeof param.value !== 'number') return false;
    const min = Number.isFinite(param.min) ? param.min : 0, max = Number.isFinite(param.max) ? param.max : 1;
    if (max <= min) return false;
    const current = clamp((param.value - min) / (max - min), 0, 1);
    let normalized;
    if (relative) normalized = current + value * (fine ? .001 : .01);
    else {
      normalized = clamp(value, 0, 1);
      const prior = pickup.get(index);
      const caught = prior?.caught || Math.abs(normalized - current) <= .025 ||
        (prior && (prior.value - current) * (normalized - current) <= 0);
      pickup.set(index, { value: normalized, caught });
      if (!caught) return false;
    }
    let next = min + clamp(normalized, 0, 1) * (max - min);
    if (param.step > 0) next = min + Math.round((next - min) / param.step) * param.step;
    registry.setParam(name, clamp(next, min, max)); notify(); return true;
  }
  function dispatch(event) {
    switch (event.action) {
      case 'pad': return request(bank * PADS_PER_BANK + event.index, event.timing ?? timing);
      case 'encoder': return encoder(event.index, event.value, event.relative !== false, event.fine);
      case 'tap': tap(); return true;
      case 'safe': { const result = safe(); if (result?.ok === false) return false; reset(); return true; }
      case 'bankNext': setBank(bank + 1); return true;
      case 'bankPrevious': setBank(bank - 1); return true;
      default: return false;
    }
  }
  let timing = 'immediate';
  function setBank(value) { bank = clamp(Math.trunc(value) || 0, 0, BANK_COUNT - 1); notify(); }
  function reset() { generation++; active = null; queued = null; loading = null; error = null; learning = null; pickup.clear(); pressed.clear(); notify(); }
  function receive(message) {
    const key = `${message.device}/${message.type}/${message.channel}/${message.number}`;
    if (learning) {
      if ((learning.action === 'encoder' && message.type !== 'cc') || message.normalized === 0) return true;
      const route = { ...learning, device: message.device, type: message.type, channel: message.channel, number: message.number };
      saved.routes = saved.routes.filter(r => !(r.device === route.device && r.type === route.type && r.channel === route.channel && r.number === route.number));
      saved.routes.push(route); learning = null; pressed.add(key); persist(); return true;
    }
    const route = saved.routes.find(r => r.device === message.device && r.type === message.type && r.channel === message.channel && r.number === message.number);
    if (!route) return false;
    if (route.action === 'encoder') {
      const raw = Math.round(message.normalized * 127);
      dispatch({ ...route, relative: route.mode === 'relative', value: route.mode === 'relative' ? (raw < 64 ? raw : raw - 128) : message.normalized });
    } else {
      if (message.normalized > 0 && !pressed.has(key)) dispatch(route);
      if (message.normalized > 0) pressed.add(key); else pressed.delete(key);
    }
    return true;
  }
  return {
    sync, request, tick, dispatch, receive, setBank, reset,
    setTiming(value) { timing = value === 'beat' ? 'beat' : 'immediate'; notify(); },
    // A performance recalled outside the pads (panel, number keys) is still the active
    // one: its pad pulses, its encoder targets load, and the Push display names it.
    setActive(id) {
      if (id !== null && !store.get(id)) return false;
      generation++; active = id; queued = null; loading = null; error = null; pickup.clear();
      const slot = saved.slots.indexOf(id);
      if (slot >= 0) { selected = slot; bank = Math.floor(slot / PADS_PER_BANK); }
      notify(); return true;
    },
    cancelLearn() { learning = null; notify(); },
    cancel() { queued = null; learning = null; notify(); },
    disconnect() { pickup.clear(); pressed.clear(); },
    learn(action, index = 0, mode = 'absolute') {
      const candidate = { ...saved, routes: [{ device: '', type: 'cc', channel: 1, number: 0, action, index, mode }] };
      validateLauncher(candidate); learning = { action, index, mode }; notify();
    },
    clearRoutes() { saved.routes = []; learning = null; pickup.clear(); pressed.clear(); persist(); },
    assign(index, id) {
      if (!validIndex(index, 4096) || (id !== null && !store.get(id))) return false;
      while (saved.slots.length <= index) saved.slots.push(null);
      saved.slots[index] = id; selected = index; persist(); return true;
    },
    assignEncoder(index, name) {
      if (!validIndex(index, 8) || (name !== null && !registry.listParams().some(p => p.name === name && typeof p.value === 'number'))) return false;
      targets()[index] = name; pickup.delete(index); persist(); return true;
    },
    snapshot() { return { bank, selected, active, queued, loading, error, learning, timing,
      slots: [...saved.slots], targets: [...targets()], routes: copy(saved.routes) }; },
    export() { return copy(saved); },
    import(value) { const next = validateLauncher(value); reset(); saved = next; bank = 0; selected = null; sync(); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
