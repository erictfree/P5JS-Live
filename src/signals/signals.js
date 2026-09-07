// Numeric context callbacks shared by p5 and shader parameters. A signal owns
// its state; consumers only read the host's memoized sample for the current frame.
export const SIGNAL_NAMES = Object.freeze(['lfo', 'envelope', 'lag', 'ramp', 'sequence', 'remap', 'variation']);
const fract = value => ((value % 1) + 1) % 1;
const clamp = value => Math.max(0, Math.min(1, value));
function finite(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`);
  return value;
}
function duration(value, name, allowZero = false) {
  finite(value, name);
  if (allowZero ? value < 0 : value <= 0) throw new RangeError(`${name} must be ${allowZero ? 'nonnegative' : 'positive'}`);
  return value;
}
function input(value, context, name = 'Signal input') {
  return finite(typeof value === 'function' ? value(context) : value, name);
}
function range(options) {
  return [finite(options.min ?? 0, 'min'), finite(options.max ?? 1, 'max')];
}
function timing(options, defaultPeriod = 1, allowZero = false) {
  if (options.period !== undefined && options.beats !== undefined) throw new TypeError('Choose period (seconds) or beats, not both');
  return { unit: options.beats !== undefined ? 'beats' : 'seconds',
    length: duration(options.beats ?? options.period ?? defaultPeriod, 'Duration', allowZero) };
}
const position = (ctx, unit) => unit === 'beats' ? ctx.clock.beat : ctx.time;
function timeUnit(options) {
  const unit = options.unit ?? 'seconds';
  if (!['seconds', 'beats'].includes(unit)) throw new TypeError('Signal unit must be seconds or beats');
  return unit;
}
function gateValue(value) {
  if (typeof value !== 'boolean' && !Number.isFinite(value)) throw new TypeError('A gate must be a boolean or finite number');
  return Boolean(value);
}
function trigger(options, required = false) {
  const source = options.trigger;
  if (source === undefined) {
    if (required) throw new TypeError('A trigger is required: onset, beat, or a function');
    return null;
  }
  if (!['onset', 'beat'].includes(source) && typeof source !== 'function') throw new TypeError('Trigger must be onset, beat, or a gate function');
  return (ctx, state) => {
    if (source === 'onset') return ctx.audio?.onset ? 1 : 0;
    if (source === 'beat') return ctx.clock.crossings;
    const value = source(ctx);
    if (typeof value !== 'boolean' && !Number.isFinite(value)) throw new TypeError('A trigger function must return a boolean or finite number');
    const gate = Boolean(value);
    const count = gate && !state.gate ? 1 : 0;
    state.gate = gate;
    return count;
  };
}
function stepped(options) {
  const event = trigger(options);
  if (event && (options.period !== undefined || options.beats !== undefined)) throw new TypeError('Choose a trigger or a timed interval');
  const clock = timing(options);
  return (ctx, state) => {
    if (event) state.index = (state.index ?? 0) + event(ctx, state);
    else state.index = Math.max(0, Math.floor((position(ctx, clock.unit) - state.origin[clock.unit]) / clock.length + 1e-9));
    return state.index;
  };
}
function seedHash(seed) {
  if (typeof seed !== 'string' && !Number.isFinite(seed)) throw new TypeError('Seed must be a string or finite number');
  let hash = 2166136261;
  for (const ch of String(seed)) { hash ^= ch.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}
function noise(seed, index) {
  let x = seed ^ Math.imul(index, 0x9e3779b9);
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

const definitions = {
  lfo(options = {}) {
    const clock = timing(options, 4), [min, max] = range(options);
    const phase = finite(options.phase ?? 0, 'phase');
    const wave = options.wave ?? 'sine';
    if (!['sine', 'triangle', 'saw', 'square'].includes(wave)) throw new TypeError('Unknown LFO wave');
    return ctx => {
      const p = fract(position(ctx, clock.unit) / clock.length + phase);
      const value = wave === 'sine' ? (1 - Math.cos(p * Math.PI * 2)) / 2
        : wave === 'triangle' ? 1 - Math.abs(2 * p - 1) : wave === 'saw' ? p : p < 0.5 ? 0 : 1;
      return min + (max - min) * value;
    };
  },
  envelope(options = {}) {
    const attack = duration(options.attack ?? 0.02, 'attack', true);
    const release = duration(options.release ?? 0.4, 'release', true);
    const unit = timeUnit(options);
    const [min, max] = range(options);
    if (options.gate !== undefined) {
      if (options.trigger !== undefined) throw new TypeError('Choose gate for ADSR or trigger for attack/release');
      const source = options.gate;
      if (typeof source !== 'function') gateValue(source);
      const decay = duration(options.decay ?? 0.1, 'decay', true);
      const sustain = finite(options.sustain ?? 0.7, 'sustain');
      if (sustain < 0 || sustain > 1) throw new RangeError('Sustain must be between 0 and 1');
      const heldLevel = min + (max - min) * sustain;
      function valueAt(time, state) {
        if (state.start === undefined) return min;
        const age = Math.max(0, time - state.start);
        if (!state.held) return state.from + (min - state.from) * (release === 0 ? 1 : clamp(age / release));
        if (attack > 0 && age < attack) return state.from + (max - state.from) * age / attack;
        return max + (heldLevel - max) * (decay === 0 ? 1 : clamp((age - attack) / decay));
      }
      return (ctx, state) => {
        const held = gateValue(typeof source === 'function' ? source(ctx) : source);
        const time = position(ctx, unit), current = valueAt(time, state);
        if (held !== Boolean(state.held)) {
          state.held = held; state.start = time; state.from = current;
        }
        return valueAt(time, state);
      };
    }
    if (options.decay !== undefined || options.sustain !== undefined) throw new TypeError('ADSR decay and sustain require a gate');
    const event = trigger({ trigger: 'onset', ...options }, true);
    function valueAt(time, state) {
      if (state.start === undefined) return min;
      const age = Math.max(0, time - state.start);
      if (attack > 0 && age < attack) return state.from + (max - state.from) * age / attack;
      return max + (min - max) * (release === 0 ? 1 : clamp((age - attack) / release));
    }
    return (ctx, state) => {
      const time = position(ctx, unit);
      const current = valueAt(time, state);
      if (event(ctx, state)) { state.from = current; state.start = time; }
      return valueAt(time, state);
    };
  },
  lag(source, options = {}) {
    if (typeof source !== 'function') finite(source, 'Lag source');
    const time = duration(options.time ?? 0.15, 'time', true);
    const rise = duration(options.rise ?? time, 'rise', true);
    const fall = duration(options.fall ?? time, 'fall', true);
    const unit = timeUnit(options);
    const initial = options.initial;
    if (initial !== undefined) finite(initial, 'initial');
    return (ctx, state) => {
      const target = input(source, ctx, 'Lag source'), now = position(ctx, unit);
      if (state.value === undefined) {
        state.value = initial ?? target;
        state.at = now;
      }
      const elapsed = Math.max(0, now - state.at);
      const responseTime = target > state.value ? rise : fall;
      // Exact one-pole response to the sampled target over elapsed logical time.
      // expm1 preserves small steps; zero duration follows the input immediately.
      const amount = responseTime === 0 ? 1 : -Math.expm1(-elapsed / responseTime);
      state.value = (1 - amount) * state.value + amount * target;
      state.at = now;
      return state.value;
    };
  },
  ramp(options = {}) {
    const clock = timing(options, 1, true), event = trigger(options);
    const from = finite(options.from ?? 0, 'from'), to = finite(options.to ?? 1, 'to');
    return (ctx, state) => {
      const time = position(ctx, clock.unit);
      if (event?.(ctx, state)) state.start = time;
      if (!event && state.start === undefined) state.start = state.origin[clock.unit];
      if (state.start === undefined) return from;
      return from + (to - from) * (clock.length === 0 ? 1 : clamp((time - state.start) / clock.length));
    };
  },
  sequence(values, options = {}) {
    if (!Array.isArray(values) || !values.length) throw new TypeError('Sequence needs a nonempty numeric array');
    const copy = Array.from(values, value => finite(value, 'Sequence value'));
    const index = stepped(options);
    return (ctx, state) => copy[index(ctx, state) % copy.length];
  },
  remap(source, options = {}) {
    const from = options.from ?? [0, 1], to = options.to ?? [0, 1];
    for (const [name, values] of [['from', from], ['to', to]]) {
      if (!Array.isArray(values) || values.length !== 2) throw new TypeError(`${name} needs two numeric endpoints`);
      Array.from(values).forEach(value => finite(value, name));
    }
    const [a, b] = from, [c, d] = to;
    if (a === b) throw new RangeError('Input range cannot have zero width');
    if (typeof source !== 'function') finite(source, 'Mapping source');
    if (options.clamp !== undefined && typeof options.clamp !== 'boolean') throw new TypeError('clamp must be a boolean');
    return ctx => {
      const value = (input(source, ctx) - a) / (b - a);
      return c + (d - c) * (options.clamp === false ? value : clamp(value));
    };
  },
  variation(options = {}) {
    const seed = seedHash(options.seed ?? 1), index = stepped(options), [min, max] = range(options);
    return (ctx, state) => min + (max - min) * noise(seed, index(ctx, state));
  },
};

export function createSignalRuntime() {
  // Weak ownership follows ordinary JavaScript reachability, including signals
  // retained by old patch closures/history. Dead callbacks retain no audio/GPU
  // resources and disappear from this list when collected; no dependency parser.
  let records = [];
  let context = null, frame = 0, evaluating = false;
  function read(record) {
    if (evaluating || !context || !record.active) throw new Error('Read signals during drawing, after their code has been applied');
    if (record.frame === frame) {
      if (record.error) throw record.error;
      return record.value;
    }
    if (record.reading) throw new Error('Cyclic signal dependency');
    const previous = { ...record.state };
    record.reading = true;
    try {
      record.value = finite(record.compute(context, record.state), `${record.name} result`);
      record.error = null;
    } catch (error) {
      record.state = previous;
      record.error = error;
    } finally { record.reading = false; record.frame = frame; }
    if (record.error) throw record.error;
    return record.value;
  }
  function scope() {
    let pending = [], sealed = false;
    const api = Object.fromEntries(SIGNAL_NAMES.map(name => [name, (...args) => {
      if (sealed) throw new Error('Construct signals once in evaluated code, outside draw()');
      const record = { name, compute: definitions[name](...args), state: {}, active: false, frame: -1 };
      const signal = () => read(record);
      Object.defineProperty(signal, 'name', { value: name });
      pending.push(record);
      return signal;
    }]));
    return {
      api,
      seal() { sealed = true; },
      commit() {
        sealed = true;
        for (const record of pending) {
          record.state = { origin: { seconds: context?.time ?? 0, beats: context?.clock.beat ?? 0 } };
          record.active = true;
          records.push(new WeakRef(record));
        }
        pending = [];
      },
    };
  }
  return {
    scope,
    evaluating(value) { evaluating = value; },
    beginFrame(inputs) {
      frame++;
      context = Object.freeze({ time: inputs.time, dt: inputs.dt, frame,
        audio: inputs.audio, clock: inputs.clock,
        controls: Object.freeze({ ...inputs.controls }),
        keyboard: Object.freeze({ ...inputs.keyboard, keys: new Set(inputs.keyboard?.keys ?? []) }),
      });
      records = records.filter(ref => {
        const record = ref.deref();
        if (!record) return false;
        try { read(record); } catch { /* Report through the consuming patch's error boundary. */ }
        return true;
      });
    },
    snapshot() {
      return records.flatMap(ref => { const record = ref.deref(); return record ? [{ record, state: { ...record.state } }] : []; });
    },
    restore(snapshot = []) {
      records = snapshot.map(({ record, state }) => {
        record.state = { ...state }; record.frame = -1; record.active = true;
        return new WeakRef(record);
      });
    },
    count: () => records.filter(ref => ref.deref()).length,
  };
}
