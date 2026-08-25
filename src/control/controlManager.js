// External parameter control — persistent host infrastructure, never evaluated code.
//
// Patch authors declare control() values. This manager maps browser MIDI messages onto
// those values without exposing patch objects or allowing a controller to invoke code.

const MIDI_CC = 0xb0;
const MIDI_NOTE_OFF = 0x80;
const MIDI_NOTE_ON = 0x90;

const clone = (value) => JSON.parse(JSON.stringify(value));

export function createControlManager({
  registry,
  diagnostics,
  navigator_ = globalThis.navigator,
  schedule = (callback) => (globalThis.requestAnimationFrame ?? setTimeout)(callback),
} = {}) {
  let access = null;
  let status = typeof navigator_?.requestMIDIAccess === 'function' ? 'disconnected' : 'unsupported';
  let learning = null;
  let lastMessage = null;
  let flushScheduled = false;
  const listeners = new Set();
  const bindings = new Map();
  const pendingValues = new Map();
  const buttonPressed = new Map();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  function inputs() {
    return access ? [...access.inputs.values()] : [];
  }

  function inputName(input) {
    return [input.manufacturer, input.name].filter(Boolean).join(' · ') || 'MIDI input';
  }

  function connectInputs() {
    for (const input of inputs()) {
      input.onmidimessage = (event) => receive(input, event.data);
    }
    status = inputs().length ? 'connected' : 'waiting';
    notify();
  }

  async function connectMidi() {
    if (typeof navigator_?.requestMIDIAccess !== 'function') {
      status = 'unsupported';
      notify();
      return { ok: false, reason: 'unsupported' };
    }
    if (access) {
      connectInputs();
      return { ok: true, devices: inputs().length };
    }
    status = 'connecting';
    notify();
    try {
      access = await navigator_.requestMIDIAccess({ sysex: false });
      access.onstatechange = connectInputs;
      connectInputs();
      diagnostics?.success(
        inputs().length ? 'MIDI connected' : 'MIDI access ready',
        inputs().length
          ? `${inputs().length} input${inputs().length === 1 ? '' : 's'} available.`
          : 'Connect or power on a MIDI controller and it will appear automatically.',
      );
      return { ok: true, devices: inputs().length };
    } catch (error) {
      status = 'denied';
      diagnostics?.warn('Could not connect MIDI', error.message);
      notify();
      return { ok: false, reason: 'denied', error };
    }
  }

  function parseMessage(data) {
    if (!data || data.length < 2) return null;
    const command = data[0] & 0xf0;
    const channel = (data[0] & 0x0f) + 1;
    const number = data[1];
    if (command === MIDI_CC && data.length >= 3) {
      return { type: 'cc', channel, number, normalized: data[2] / 127 };
    }
    if (command === MIDI_NOTE_ON && data.length >= 3) {
      return {
        type: 'note',
        channel,
        number,
        normalized: data[2] === 0 ? 0 : data[2] / 127,
      };
    }
    if (command === MIDI_NOTE_OFF) {
      return { type: 'note', channel, number, normalized: 0 };
    }
    return null;
  }

  function scheduleValue(name, value) {
    pendingValues.set(name, value);
    if (flushScheduled) return;
    flushScheduled = true;
    schedule(() => {
      flushScheduled = false;
      registry.setParams(pendingValues);
      pendingValues.clear();
    });
  }

  function mappedValue(binding, normalized, param) {
    const low = Number.isFinite(binding.min) ? binding.min : Number(param.min ?? 0);
    const high = Number.isFinite(binding.max) ? binding.max : Number(param.max ?? 1);
    const position = binding.invert ? 1 - normalized : normalized;
    const raw = low + (high - low) * position;
    const step = Number(param.step);
    if (!(step > 0)) return raw;
    return Math.round(raw / step) * step;
  }

  function paramType(param) {
    return param.type
      ?? (typeof param.value === 'boolean' ? 'button' : Array.isArray(param.choices) ? 'choice' : 'continuous');
  }

  function mappedParamValue(binding, message, param) {
    const type = paramType(param);
    if (type === 'button') {
      const pressed = message.normalized > 0;
      const wasPressed = buttonPressed.get(binding.param) ?? false;
      buttonPressed.set(binding.param, pressed);
      if (param.mode === 'toggle') {
        return pressed && !wasPressed ? !Boolean(param.value) : undefined;
      }
      return pressed;
    }
    if (type === 'choice') {
      const choices = param.choices ?? [];
      if (!choices.length) return undefined;
      const position = binding.invert ? 1 - message.normalized : message.normalized;
      return choices[Math.round(position * (choices.length - 1))];
    }
    if (typeof param.value !== 'number') return undefined;
    return mappedValue(binding, message.normalized, param);
  }

  function receive(input, data) {
    const message = parseMessage(data);
    if (!message) return false;
    const device = inputName(input);
    lastMessage = { ...message, device, at: Date.now() };

    if (learning) {
      bindings.set(learning, {
        param: learning,
        transport: 'midi',
        device,
        type: message.type,
        channel: message.channel,
        number: message.number,
        invert: false,
      });
      diagnostics?.success(
        `MIDI learned — ${learning}`,
        `${device} · Ch ${message.channel} · ${message.type === 'cc' ? 'CC' : 'Note'} ${message.number}`,
      );
      learning = null;
    }

    for (const binding of bindings.values()) {
      if (
        binding.transport !== 'midi' ||
        binding.device !== device ||
        binding.type !== message.type ||
        binding.channel !== message.channel ||
        binding.number !== message.number
      ) continue;
      const param = registry.listParams().find((entry) => entry.name === binding.param);
      if (!param) continue;
      const value = mappedParamValue(binding, message, param);
      if (value !== undefined) scheduleValue(binding.param, value);
    }
    notify();
    return true;
  }

  function learn(name) {
    const param = registry.listParams().find((entry) => entry.name === name);
    if (!param || !['continuous', 'button', 'choice'].includes(paramType(param))) return false;
    learning = learning === name ? null : name;
    notify();
    return Boolean(learning);
  }

  function removeBinding(name) {
    if (learning === name) learning = null;
    buttonPressed.delete(name);
    const removed = bindings.delete(name);
    if (removed) notify();
    return removed;
  }

  function snapshotMappings() {
    return [...bindings.values()].map((binding) => clone(binding));
  }

  function restoreMappings(saved) {
    bindings.clear();
    buttonPressed.clear();
    for (const binding of saved ?? []) {
      if (
        typeof binding?.param !== 'string' ||
        binding.transport !== 'midi' ||
        typeof binding.device !== 'string' ||
        !['cc', 'note'].includes(binding.type) ||
        !Number.isInteger(binding.channel) ||
        !Number.isInteger(binding.number)
      ) continue;
      bindings.set(binding.param, clone(binding));
    }
    learning = null;
    notify();
    return bindings.size;
  }

  function snapshot() {
    return {
      midi: {
        supported: typeof navigator_?.requestMIDIAccess === 'function',
        status,
        devices: inputs().map((input) => ({
          name: inputName(input),
          state: input.state ?? 'connected',
          connection: input.connection ?? 'open',
        })),
        lastMessage: lastMessage ? { ...lastMessage } : null,
      },
      learning,
      mappings: snapshotMappings(),
    };
  }

  function dispose() {
    for (const input of inputs()) input.onmidimessage = null;
    if (access) access.onstatechange = null;
    listeners.clear();
    pendingValues.clear();
    buttonPressed.clear();
  }

  return {
    connectMidi,
    learn,
    removeBinding,
    snapshot,
    snapshotMappings,
    restoreMappings,
    receive,
    dispose,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
