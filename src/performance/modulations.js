// Modulations: LFOs, ramps and random steps the performer creates by name. Every
// modulation is a signal patches can read as `modulations.<name>` (−1…1 scaled by depth,
// plus offset). Optionally it also targets a live control, swinging that control around
// the value the performer set: the registry keeps the base value (what knobs, sliders
// and saved scenes see) and the swing is applied when patches read their controls, so
// nothing is persisted mid-swing and a knob always wins. Pure logic; no DOM.

export const WAVEFORMS = Object.freeze(['sine', 'triangle', 'rampUp', 'rampDown', 'square', 'random']);
export const WAVE_GLYPHS = Object.freeze({ sine: '∿', triangle: '⋀', rampUp: '⟋', rampDown: '⟍', square: '⊓', random: '⁂' });
export const DEFAULT_MODULATION = Object.freeze({ wave: 'sine', beats: 1, hz: 1, sync: true, depth: 0.25, offset: 0, on: true, target: '' });

// Names are read in code as `modulations.name`, so they must be identifiers.
export function identifierName(value, fallback = 'lfo1') {
  const cleaned = String(value ?? '').trim().replace(/[^A-Za-z0-9_$]+/g, '_').replace(/^_+|_+$/g, '');
  const name = cleaned && !/^[0-9]/.test(cleaned) ? cleaned : (cleaned ? `m_${cleaned}` : fallback);
  return name.slice(0, 40);
}
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Waveform value in [-1, 1] for a phase in [0, 1).
export function waveValue(wave, phase, random = Math.random, cycleState = null) {
  const p = ((phase % 1) + 1) % 1;
  switch (wave) {
    case 'sine': return Math.sin(p * Math.PI * 2);
    case 'triangle': return p < 0.5 ? p * 4 - 1 : 3 - p * 4;
    case 'rampUp': return p * 2 - 1;
    case 'rampDown': return 1 - p * 2;
    case 'square': return p < 0.5 ? 1 : -1;
    case 'random': {
      // One new value per cycle, held until the next cycle starts.
      if (!cycleState) return random() * 2 - 1;
      const cycle = Math.floor(phase);
      if (cycleState.cycle !== cycle) { cycleState.cycle = cycle; cycleState.value = random() * 2 - 1; }
      return cycleState.value;
    }
    default: return 0;
  }
}

export function validateModulation(value) {
  if (!value || typeof value !== 'object') return null;
  const target = typeof value.target === 'string' ? value.target : '';
  const wave = WAVEFORMS.includes(value.wave) ? value.wave : DEFAULT_MODULATION.wave;
  const beats = Number.isFinite(value.beats) && value.beats > 0 ? clamp(value.beats, 1 / 32, 64) : DEFAULT_MODULATION.beats;
  const hz = Number.isFinite(value.hz) && value.hz > 0 ? clamp(value.hz, 0.01, 30) : DEFAULT_MODULATION.hz;
  return {
    id: typeof value.id === 'string' && value.id ? value.id : null,
    name: typeof value.name === 'string' && value.name.trim() ? identifierName(value.name) : '',
    target,
    wave, beats, hz,
    sync: value.sync !== false,
    depth: Number.isFinite(value.depth) ? clamp(value.depth, 0, 1) : DEFAULT_MODULATION.depth,
    offset: Number.isFinite(value.offset) ? clamp(value.offset, -1, 1) : DEFAULT_MODULATION.offset,
    on: value.on !== false,
  };
}

// Bare-name access from patch code: each modulation name becomes a live getter on the
// global object, so `circle(x, y, 100 + 60 * lfo1)` reads the current signal. Names that
// belong to the live API, p5, or anything else already global are left alone.
export function createGlobalBindings({ globalObject = globalThis, reserved = [], read }) {
  const owned = new Set();
  const blocked = new Set(reserved);
  function sync(names) {
    for (const name of [...owned]) {
      if (!names.includes(name)) { try { delete globalObject[name]; } catch { /* non-configurable */ } owned.delete(name); }
    }
    const skipped = [];
    for (const name of names) {
      if (owned.has(name)) continue;
      if (blocked.has(name) || (name in globalObject)) { skipped.push(name); continue; }
      try {
        Object.defineProperty(globalObject, name, { configurable: true, enumerable: false, get: () => read(name) });
        owned.add(name);
      } catch { skipped.push(name); }
    }
    return { defined: [...owned], skipped };
  }
  return { sync, owned: () => [...owned] };
}

export function createModulationEngine({
  registry,
  now = () => (globalThis.performance?.now?.() ?? Date.now()) / 1000,
  random = Math.random,
  makeId = () => `mod-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
} = {}) {
  let modulations = [];
  const runtime = new Map(); // id → { phase, lastTime, cycle }
  let outputs = new Map();   // target → modulated value for this frame
  let signals = {};          // name → raw signal (−1…1) for this frame

  function uniqueName(base) {
    const wanted = identifierName(base, 'lfo1');
    const taken = new Set(modulations.map(m => m.name));
    if (!taken.has(wanted)) return wanted;
    // lfo1 → lfo2 → lfo3; wobble → wobble2 → wobble3
    const stem = wanted.replace(/\d+$/, '') || wanted;
    let n = Number(wanted.slice(stem.length)) || 1;
    let candidate = wanted;
    while (taken.has(candidate)) { n += 1; candidate = `${stem}${n}`; }
    return candidate;
  }
  const listeners = new Set();
  const notify = () => listeners.forEach(fn => fn());

  function list() { return modulations.map(m => ({ ...m })); }
  function get(id) { return modulations.find(m => m.id === id) ?? null; }
  function forTarget(target) { return modulations.filter(m => m.target === target).map(m => ({ ...m })); }

  function add(value = {}) {
    const entry = validateModulation({ ...DEFAULT_MODULATION, ...value });
    if (!entry) return null;
    entry.id = makeId();
    entry.name = uniqueName(entry.name || entry.target || 'lfo1');
    modulations.push(entry);
    notify();
    return { ...entry };
  }

  function update(id, changes) {
    const index = modulations.findIndex(m => m.id === id);
    if (index < 0) return null;
    const merged = validateModulation({ ...modulations[index], ...changes, target: changes.target ?? modulations[index].target });
    if (!merged) return null;
    merged.id = id;
    if (!merged.name) merged.name = modulations[index].name;
    if (merged.name !== modulations[index].name && modulations.some(m => m.id !== id && m.name === merged.name)) merged.name = uniqueName(merged.name);
    modulations[index] = merged;
    notify();
    return { ...merged };
  }

  function remove(id) {
    const before = modulations.length;
    modulations = modulations.filter(m => m.id !== id);
    runtime.delete(id);
    if (modulations.length === before) return false;
    notify();
    return true;
  }

  function setOn(id, on) { return update(id, { on: Boolean(on) }); }
  function toggle(id) { const m = get(id); return m ? setOn(id, !m.on) : null; }

  // Push lower button: toggle the first modulation on a control, creating a default one.
  function toggleForTarget(target) {
    const existing = modulations.find(m => m.target === target);
    if (existing) return toggle(existing.id);
    return add({ target });
  }

  function cycleWave(id) {
    const m = get(id);
    if (!m) return null;
    return update(id, { wave: WAVEFORMS[(WAVEFORMS.indexOf(m.wave) + 1) % WAVEFORMS.length] });
  }

  // Once per frame. `clock` is the rhythm snapshot ({ running, beat, bpm }).
  function frame(clock, time = now()) {
    const next = new Map();
    const nextSignals = {};
    const params = new Map(registry.listParams().map(p => [p.name, p]));
    for (const m of modulations) {
      if (!m.on) { runtime.delete(m.id); continue; }
      let state = runtime.get(m.id);
      if (!state) { state = { phase: 0, lastTime: time, cycle: -1, value: 0 }; runtime.set(m.id, state); }
      let phase;
      if (m.sync && clock?.running && Number.isFinite(clock.beat)) {
        phase = clock.beat / m.beats;
      } else {
        state.phase += Math.max(0, time - state.lastTime) * m.hz;
        phase = state.phase;
      }
      state.lastTime = time;
      const wave = waveValue(m.wave, phase, random, state);
      // The named signal every patch can read: −1…1 scaled by depth, shifted by offset.
      nextSignals[m.name] = clamp(m.offset + wave * m.depth, -1, 1);
      const param = params.get(m.target);
      if (!param || typeof param.value !== 'number') continue;
      const min = Number.isFinite(param.min) ? param.min : 0;
      const max = Number.isFinite(param.max) ? param.max : 1;
      const range = max - min;
      if (!(range > 0)) continue;
      const base = next.get(m.target) ?? param.value;
      let value = base + (m.offset + wave * m.depth) * range;
      if (param.step > 0) value = min + Math.round((value - min) / param.step) * param.step;
      next.set(m.target, clamp(value, min, max));
    }
    outputs = next;
    signals = nextSignals;
    return outputs;
  }

  // Hook for registry.paramValues: the value patches see this frame.
  function modulate(name, base) { return outputs.has(name) ? outputs.get(name) : base; }
  function value(name) { return outputs.get(name); }
  function running(target) { return modulations.some(m => m.target === target && m.on) && outputs.has(target); }
  // Fill `target` (the draw-input object) with this frame's named signals.
  function readSignals(target = {}) {
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, signals);
    return target;
  }
  function signal(name) { return signals[name]; }

  function exportAll() { return list(); }
  function importAll(entries) {
    modulations = [];
    runtime.clear();
    outputs = new Map();
    for (const raw of Array.isArray(entries) ? entries : []) {
      const entry = validateModulation(raw);
      if (!entry) continue;
      entry.id = entry.id ?? makeId();
      entry.name = uniqueName(entry.name || entry.target || 'lfo1');
      modulations.push(entry);
    }
    notify();
    return modulations.length;
  }
  function reset() { importAll([]); }

  return {
    list, get, forTarget, add, update, remove, setOn, toggle, toggleForTarget, cycleWave,
    frame, modulate, value, running, readSignals, signal,
    export: exportAll, import: importAll, reset,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
