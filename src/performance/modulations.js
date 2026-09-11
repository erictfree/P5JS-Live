// Modulations: LFOs, ramps and random steps that swing a live control around the value
// the performer set. The registry keeps the base value (what knobs, sliders and saved
// scenes see); modulation is applied when patches read their controls each frame, so
// nothing is persisted mid-swing and a knob always wins. Pure logic; no DOM.

export const WAVEFORMS = Object.freeze(['sine', 'triangle', 'rampUp', 'rampDown', 'square', 'random']);
export const WAVE_GLYPHS = Object.freeze({ sine: '∿', triangle: '⋀', rampUp: '⟋', rampDown: '⟍', square: '⊓', random: '⁂' });
export const DEFAULT_MODULATION = Object.freeze({ wave: 'sine', beats: 1, hz: 1, sync: true, depth: 0.25, offset: 0, on: true });
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
  if (!value || typeof value.target !== 'string' || !value.target) return null;
  const wave = WAVEFORMS.includes(value.wave) ? value.wave : DEFAULT_MODULATION.wave;
  const beats = Number.isFinite(value.beats) && value.beats > 0 ? clamp(value.beats, 1 / 32, 64) : DEFAULT_MODULATION.beats;
  const hz = Number.isFinite(value.hz) && value.hz > 0 ? clamp(value.hz, 0.01, 30) : DEFAULT_MODULATION.hz;
  return {
    id: typeof value.id === 'string' && value.id ? value.id : null,
    name: typeof value.name === 'string' ? value.name.slice(0, 40) : '',
    target: value.target,
    wave, beats, hz,
    sync: value.sync !== false,
    depth: Number.isFinite(value.depth) ? clamp(value.depth, 0, 1) : DEFAULT_MODULATION.depth,
    offset: Number.isFinite(value.offset) ? clamp(value.offset, -1, 1) : DEFAULT_MODULATION.offset,
    on: value.on !== false,
  };
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
  const listeners = new Set();
  const notify = () => listeners.forEach(fn => fn());

  function list() { return modulations.map(m => ({ ...m })); }
  function get(id) { return modulations.find(m => m.id === id) ?? null; }
  function forTarget(target) { return modulations.filter(m => m.target === target).map(m => ({ ...m })); }

  function add(value) {
    const entry = validateModulation({ ...DEFAULT_MODULATION, ...value });
    if (!entry) return null;
    entry.id = makeId();
    if (!entry.name) entry.name = `${entry.target} ${WAVE_GLYPHS[entry.wave]}`;
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
    const params = new Map(registry.listParams().map(p => [p.name, p]));
    for (const m of modulations) {
      if (!m.on) { runtime.delete(m.id); continue; }
      const param = params.get(m.target);
      if (!param || typeof param.value !== 'number') continue;
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
      const min = Number.isFinite(param.min) ? param.min : 0;
      const max = Number.isFinite(param.max) ? param.max : 1;
      const range = max - min;
      if (!(range > 0)) continue;
      const base = next.get(m.target) ?? param.value;
      let value = base + (m.offset + waveValue(m.wave, phase, random, state) * m.depth) * range;
      if (param.step > 0) value = min + Math.round((value - min) / param.step) * param.step;
      next.set(m.target, clamp(value, min, max));
    }
    outputs = next;
    return outputs;
  }

  // Hook for registry.paramValues: the value patches see this frame.
  function modulate(name, base) { return outputs.has(name) ? outputs.get(name) : base; }
  function value(name) { return outputs.get(name); }
  function running(target) { return modulations.some(m => m.target === target && m.on) && outputs.has(target); }

  function exportAll() { return list(); }
  function importAll(entries) {
    modulations = [];
    runtime.clear();
    outputs = new Map();
    for (const raw of Array.isArray(entries) ? entries : []) {
      const entry = validateModulation(raw);
      if (!entry) continue;
      entry.id = entry.id ?? makeId();
      if (!entry.name) entry.name = `${entry.target} ${WAVE_GLYPHS[entry.wave]}`;
      modulations.push(entry);
    }
    notify();
    return modulations.length;
  }
  function reset() { importAll([]); }

  return {
    list, get, forTarget, add, update, remove, setOn, toggle, toggleForTarget, cycleWave,
    frame, modulate, value, running,
    export: exportAll, import: importAll, reset,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
