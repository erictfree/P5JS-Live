// Push 3 LED and input transport over Web MIDI. Standard three-byte messages only:
// Note On for pads, Control Change for buttons, plus MIDI real-time clock bytes for
// hardware animations. No sysex is ever emitted. Independent of the WebUSB display.

import {
  PUSH3_COLORS,
  decodePushMessage,
  padNoteFromIndex,
  padNoteFromRowColumn,
} from './push3Map.js';

const NOTE_ON = 0x90;
const CONTROL_CHANGE = 0xb0;
const CLOCK_TICK = 0xf8;
const CLOCK_START = 0xfa;
const CLOCK_STOP = 0xfc;
const TICKS_PER_BEAT = 24;
const USER_PORT = /push\s*3.*user/i;
const ANY_PUSH_PORT = /push\s*3/i;

function assertInteger(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be an integer from ${min} to ${max}.`);
  }
}

function portName(port) {
  return [port.manufacturer, port.name].filter(Boolean).join(' · ') || port.name || 'MIDI port';
}

function describePort(port) {
  return { id: port.id, name: portName(port), state: port.state ?? 'connected', connection: port.connection ?? 'open' };
}

export function createPush3MidiTransport({
  requestAccess = typeof globalThis.navigator?.requestMIDIAccess === 'function'
    ? (options) => globalThis.navigator.requestMIDIAccess(options)
    : null,
  diagnostics,
  setInterval: schedule = globalThis.setInterval.bind(globalThis),
  clearInterval: cancel = globalThis.clearInterval.bind(globalThis),
} = {}) {
  let status = requestAccess ? 'disconnected' : 'unsupported';
  let access = null;
  let output = null;
  let input = null;
  let lastInput = null;
  let clockTimer = null;
  let clockBpm = null;
  let sent = 0;
  const owned = new Map(); // key → { status, address }
  const listeners = new Set();
  const inputListeners = new Set();
  const notify = () => listeners.forEach(listener => listener());

  const live = port => port.state !== 'disconnected';
  const outputs = () => (access ? [...access.outputs.values()].filter(live) : []);
  const inputs = () => (access ? [...access.inputs.values()].filter(live) : []);

  function attachInput(port) {
    if (input) input.onmidimessage = null;
    input = port ?? null;
    if (!input) return;
    input.onmidimessage = (event) => {
      const decoded = decodePushMessage(event.data);
      lastInput = { raw: [...event.data], decoded, at: Date.now() };
      inputListeners.forEach(listener => listener(lastInput));
      notify();
    };
  }

  function refreshPorts() {
    let dropped = false;
    if (output && !outputs().some(port => port.id === output.id)) {
      stopClock({ send: false });
      owned.clear();
      output = null;
      dropped = true;
      status = 'output disconnected';
      diagnostics?.warn('Push 3 MIDI output disconnected', 'LED state was dropped. Reconnect to resume.');
    }
    if (input && !inputs().some(port => port.id === input.id)) attachInput(null);
    // After a drop, keep the disconnected status unless the same kind of port came back.
    if (!output && access) autoSelect({ keepStatus: dropped });
    notify();
  }

  function autoSelect({ keepStatus = false } = {}) {
    const candidates = outputs().filter(port => USER_PORT.test(portName(port)));
    if (candidates.length === 1) selectOutput(candidates[0].id);
    else if (keepStatus) return;
    else if (candidates.length > 1) status = 'choose a Push output';
    else if (outputs().some(port => ANY_PUSH_PORT.test(portName(port)))) status = 'choose the Push User Port';
    else status = 'no Push output found';
  }

  async function connect() {
    if (!requestAccess) {
      status = 'unsupported';
      notify();
      return { ok: false, reason: 'unsupported' };
    }
    if (access) {
      refreshPorts();
      return { ok: true, ports: listPorts() };
    }
    status = 'connecting';
    notify();
    try {
      access = await requestAccess({ sysex: false });
      access.onstatechange = refreshPorts;
      autoSelect();
      notify();
      diagnostics?.success('Push 3 MIDI access ready', `${outputs().length} output${outputs().length === 1 ? '' : 's'} available.`);
      return { ok: true, ports: listPorts() };
    } catch (error) {
      status = 'denied';
      diagnostics?.warn('Could not open Web MIDI for Push 3', error?.message || status);
      notify();
      return { ok: false, reason: 'denied', error };
    }
  }

  function listPorts() {
    return { inputs: inputs().map(describePort), outputs: outputs().map(describePort) };
  }

  function selectOutput(id) {
    const port = outputs().find(candidate => candidate.id === id);
    if (!port) return { ok: false, reason: 'output not found' };
    if (output && output.id !== port.id) {
      clearOwnedLeds();
      stopClock();
    }
    output = port;
    const name = portName(port);
    const pairedInput = inputs().find(candidate => portName(candidate) === name)
      ?? inputs().find(candidate => USER_PORT.test(portName(candidate)));
    attachInput(pairedInput);
    status = `output: ${name}`;
    notify();
    return { ok: true, output: describePort(port), input: pairedInput ? describePort(pairedInput) : null };
  }

  function send(bytes) {
    if (!output) return { ok: false, reason: 'no output selected' };
    const statusByte = bytes[0];
    const command = statusByte & 0xf0;
    const realtime = statusByte >= 0xf8;
    if (!realtime && command !== NOTE_ON && command !== CONTROL_CHANGE) {
      throw new RangeError('Push 3 LED transport sends only Note On, Control Change and real-time bytes.');
    }
    try {
      output.send(bytes);
      sent += 1;
      return { ok: true };
    } catch (error) {
      status = 'send failed';
      diagnostics?.warn('Push 3 MIDI send failed', error?.message || status);
      notify();
      return { ok: false, reason: status, error };
    }
  }

  function led(command, address, color, channel, key) {
    assertInteger(color, 0, 127, 'Push palette index');
    assertInteger(channel, 0, 15, 'Push animation channel');
    const result = send([command | channel, address, color]);
    if (result.ok) {
      if (color === PUSH3_COLORS.off && channel === 0) owned.delete(key);
      else owned.set(key, { status: command, address });
      notify();
    }
    return result;
  }

  function setPad(index, color, { channel = 0 } = {}) {
    const note = padNoteFromIndex(index);
    return led(NOTE_ON, note, color, channel, `note:${note}`);
  }

  function setPadAt(row, column, color, { channel = 0 } = {}) {
    const note = padNoteFromRowColumn(row, column);
    return led(NOTE_ON, note, color, channel, `note:${note}`);
  }

  function setButton(cc, color, { channel = 0 } = {}) {
    assertInteger(cc, 0, 127, 'Push button CC');
    return led(CONTROL_CHANGE, cc, color, channel, `cc:${cc}`);
  }

  // Hardware animation: base color static on channel 0, then target on an animation channel.
  function animatePad(index, base, target, channel) {
    assertInteger(channel, 1, 15, 'Push animation channel');
    const first = setPad(index, base);
    return first.ok ? setPad(index, target, { channel }) : first;
  }

  function animateButton(cc, base, target, channel) {
    assertInteger(channel, 1, 15, 'Push animation channel');
    const first = setButton(cc, base);
    return first.ok ? setButton(cc, target, { channel }) : first;
  }

  function startClock(bpm = 120) {
    if (!Number.isFinite(bpm) || bpm < 30 || bpm > 300) return { ok: false, reason: 'bpm must be between 30 and 300' };
    if (!output) return { ok: false, reason: 'no output selected' };
    stopClock({ send: false });
    const start = send([CLOCK_START]);
    if (!start.ok) return start;
    clockBpm = bpm;
    clockTimer = schedule(() => { send([CLOCK_TICK]); }, 60_000 / (bpm * TICKS_PER_BEAT));
    notify();
    return { ok: true, bpm };
  }

  // Start without clock ticks: Push then runs LED animations at its built-in fallback
  // tempo (about 120 BPM), independent of the app's beat. Used for steady pulses.
  function startAnimations() {
    if (!output) return { ok: false, reason: 'no output selected' };
    stopClock({ send: false });
    return send([CLOCK_START]);
  }

  function stopClock({ send: sendStop = true } = {}) {
    if (clockTimer !== null) cancel(clockTimer);
    const wasRunning = clockTimer !== null;
    clockTimer = null;
    clockBpm = null;
    if (wasRunning && sendStop && output) send([CLOCK_STOP]);
    notify();
    return { ok: true };
  }

  function clearOwnedLeds() {
    if (!output) { owned.clear(); return { ok: true, cleared: 0 }; }
    const entries = [...owned.values()];
    for (const entry of entries) send([entry.status, entry.address, PUSH3_COLORS.off]);
    owned.clear();
    notify();
    return { ok: true, cleared: entries.length };
  }

  function disconnect() {
    clearOwnedLeds();
    stopClock();
    attachInput(null);
    output = null;
    status = access ? 'access ready · no output' : 'disconnected';
    notify();
    return { ok: true };
  }

  function snapshot() {
    return {
      supported: Boolean(requestAccess),
      status,
      hasAccess: Boolean(access),
      output: output ? describePort(output) : null,
      input: input ? describePort(input) : null,
      ports: listPorts(),
      owned: owned.size,
      sent,
      clockBpm,
      lastInput: lastInput ? { ...lastInput, raw: [...lastInput.raw] } : null,
    };
  }

  return {
    connect,
    hasOutput: () => Boolean(output),
    listPorts,
    selectOutput,
    setPad,
    setPadAt,
    setButton,
    animatePad,
    animateButton,
    startClock,
    startAnimations,
    stopClock,
    clearOwnedLeds,
    disconnect,
    snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    onInput(listener) { inputListeners.add(listener); return () => inputListeners.delete(listener); },
  };
}

export { CLOCK_START, CLOCK_STOP, CLOCK_TICK, TICKS_PER_BEAT };
