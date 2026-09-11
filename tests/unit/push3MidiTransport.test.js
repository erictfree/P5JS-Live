import { describe, expect, it, vi } from 'vitest';
import { PUSH3_BUTTONS, PUSH3_COLORS, animationChannel } from '../../src/performance/push3Map.js';
import { createPush3MidiTransport } from '../../src/performance/push3MidiTransport.js';

function makePort(id, name, manufacturer = 'Ableton') {
  return { id, name, manufacturer, state: 'connected', connection: 'open', send: vi.fn(), onmidimessage: null };
}

function makeAccess({ outputs = [], inputs = [] } = {}) {
  return {
    outputs: new Map(outputs.map(port => [port.id, port])),
    inputs: new Map(inputs.map(port => [port.id, port])),
    onstatechange: null,
  };
}

function connected(overrides = {}) {
  const user = makePort('out-user', 'Ableton Push 3 User Port');
  const userIn = makePort('in-user', 'Ableton Push 3 User Port');
  const access = makeAccess({ outputs: [user, ...(overrides.outputs ?? [])], inputs: [userIn] });
  const requestAccess = vi.fn().mockResolvedValue(access);
  const transport = createPush3MidiTransport({ requestAccess, ...overrides.options });
  return { transport, access, user, userIn, requestAccess };
}

describe('Push 3 MIDI transport', () => {
  it('requests Web MIDI without sysex and auto-selects a single User Port pair', async () => {
    const { transport, requestAccess, user } = connected();
    const result = await transport.connect();

    expect(requestAccess).toHaveBeenCalledWith({ sysex: false });
    expect(result.ok).toBe(true);
    expect(transport.snapshot()).toMatchObject({
      status: 'output: Ableton · Ableton Push 3 User Port',
      output: { id: user.id },
      input: { id: 'in-user' },
    });
  });

  it('refuses to guess between Live and User ports', async () => {
    const live = makePort('out-live', 'Ableton Push 3 Live Port');
    const access = makeAccess({ outputs: [live] });
    const transport = createPush3MidiTransport({ requestAccess: vi.fn().mockResolvedValue(access) });
    await transport.connect();

    expect(transport.snapshot().output).toBeNull();
    expect(transport.snapshot().status).toBe('choose the Push User Port');
    expect(transport.setPad(0, PUSH3_COLORS.green)).toEqual({ ok: false, reason: 'no output selected' });
    expect(transport.selectOutput('out-live').ok).toBe(true);
    expect(transport.snapshot().output.id).toBe('out-live');
  });

  it('lights pads with Note On and buttons with Control Change on channel 0', async () => {
    const { transport, user } = connected();
    await transport.connect();

    expect(transport.setPad(0, PUSH3_COLORS.green)).toEqual({ ok: true });
    expect(transport.setPadAt(0, 0, PUSH3_COLORS.skyBlue)).toEqual({ ok: true });
    expect(transport.setButton(PUSH3_BUTTONS.play, PUSH3_COLORS.litWhite)).toEqual({ ok: true });
    expect(user.send.mock.calls.map(([bytes]) => [...bytes])).toEqual([
      [0x90, 92, 11],
      [0x90, 36, 16],
      [0xb0, 85, 122],
    ]);
    expect(transport.snapshot().owned).toBe(3);
  });

  it('animates by sending the base color statically and the target on the animation channel', async () => {
    const { transport, user } = connected();
    await transport.connect();

    transport.animatePad(63, PUSH3_COLORS.blue, PUSH3_COLORS.skyBlue, animationChannel('pulse', '1/4'));
    transport.animateButton(PUSH3_BUTTONS.upper1, PUSH3_COLORS.off, PUSH3_COLORS.pink, animationChannel('oneShot', '1/4'));

    expect(user.send.mock.calls.map(([bytes]) => [...bytes])).toEqual([
      [0x90, 43, 17],
      [0x99, 43, 16],
      [0xb0, 102, 0],
      [0xb4, 102, 26],
    ]);
    expect(() => transport.animatePad(0, 0, 1, 0)).toThrow(RangeError);
  });

  it('validates addresses, palette indices and channels before sending anything', async () => {
    const { transport, user } = connected();
    await transport.connect();

    expect(() => transport.setPad(64, 1)).toThrow(RangeError);
    expect(() => transport.setPad(0, 128)).toThrow(RangeError);
    expect(() => transport.setPad(0, 1, { channel: 16 })).toThrow(RangeError);
    expect(() => transport.setButton(128, 1)).toThrow(RangeError);
    expect(user.send).not.toHaveBeenCalled();
  });

  it('runs a 24 PPQN clock from Start and stops it with Stop', async () => {
    vi.useFakeTimers();
    const { transport, user } = connected({ options: { setInterval, clearInterval } });
    await transport.connect();

    expect(transport.clockRunning()).toBe(false);
    expect(transport.startClock(120)).toEqual({ ok: true, bpm: 120 });
    expect(transport.clockRunning()).toBe(true);
    expect([...user.send.mock.calls.at(-1)[0]]).toEqual([0xfa]);
    await vi.advanceTimersByTimeAsync(1000);
    const ticks = user.send.mock.calls.filter(([bytes]) => bytes[0] === 0xf8).length;
    // 48 ticks per second at 120 BPM; fake timers round the 20.83 ms interval to whole ms.
    expect(ticks).toBeGreaterThanOrEqual(46);
    expect(ticks).toBeLessThanOrEqual(50);

    transport.stopClock();
    const count = user.send.mock.calls.length;
    expect([...user.send.mock.calls.at(-1)[0]]).toEqual([0xfc]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(user.send.mock.calls.length).toBe(count);
    expect(transport.startClock(20)).toEqual({ ok: false, reason: 'bpm must be between 30 and 300' });
    vi.useRealTimers();
  });

  it('clears only the LEDs it lit and forgets ones already turned off', async () => {
    const { transport, user } = connected();
    await transport.connect();
    transport.setPad(0, PUSH3_COLORS.green);
    transport.setPad(1, PUSH3_COLORS.green);
    transport.setButton(PUSH3_BUTTONS.tapTempo, PUSH3_COLORS.litWhite);
    transport.setPad(1, PUSH3_COLORS.off);
    user.send.mockClear();

    expect(transport.clearOwnedLeds()).toEqual({ ok: true, cleared: 2 });
    expect(user.send.mock.calls.map(([bytes]) => [...bytes])).toEqual([
      [0x90, 92, 0],
      [0xb0, 3, 0],
    ]);
    expect(transport.snapshot().owned).toBe(0);
  });

  it('never emits sysex or other non-LED status bytes', async () => {
    const { transport, user } = connected();
    await transport.connect();
    transport.setPad(0, 5);
    transport.setButton(3, 5);
    transport.startClock(120);
    transport.stopClock();
    transport.clearOwnedLeds();

    for (const [bytes] of user.send.mock.calls) {
      const status = bytes[0];
      expect(status === 0xfa || status === 0xfc || status === 0xf8 || (status & 0xf0) === 0x90 || (status & 0xf0) === 0xb0).toBe(true);
      expect(status).not.toBe(0xf0);
    }
  });

  it('decodes incoming Push messages from the paired input', async () => {
    const { transport, userIn } = connected();
    const seen = [];
    transport.onInput(event => seen.push(event.decoded));
    await transport.connect();

    userIn.onmidimessage({ data: Uint8Array.from([0x90, 92, 77]) });
    userIn.onmidimessage({ data: Uint8Array.from([0xb0, 85, 127]) });

    expect(seen).toEqual([
      { kind: 'pad', index: 0, note: 92, pressed: true, pressure: 77 },
      { kind: 'button', name: 'play', cc: 85, pressed: true, value: 127 },
    ]);
    expect(transport.snapshot().lastInput.raw).toEqual([0xb0, 85, 127]);
  });

  it('drops owned LED state and stops the clock when the output disappears', async () => {
    vi.useFakeTimers();
    const { transport, access, user } = connected({ options: { setInterval, clearInterval } });
    await transport.connect();
    transport.setPad(0, PUSH3_COLORS.green);
    transport.startClock(120);

    user.state = 'disconnected';
    access.onstatechange();

    expect(transport.snapshot()).toMatchObject({ output: null, owned: 0, clockBpm: null, status: 'output disconnected' });
    const count = user.send.mock.calls.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(user.send.mock.calls.length).toBe(count);
    vi.useRealTimers();
  });

  it('releases cleanly: clears, stops and keeps access for reconnecting', async () => {
    const { transport, user } = connected();
    await transport.connect();
    transport.setButton(PUSH3_BUTTONS.play, PUSH3_COLORS.green);

    expect(transport.disconnect()).toEqual({ ok: true });
    expect([...user.send.mock.calls.at(-1)[0]]).toEqual([0xb0, 85, 0]);
    expect(transport.snapshot()).toMatchObject({ output: null, hasAccess: true, status: 'access ready · no output' });
  });

  it('reports unsupported browsers without requesting access', async () => {
    const transport = createPush3MidiTransport({ requestAccess: null });
    expect(await transport.connect()).toEqual({ ok: false, reason: 'unsupported' });
    expect(transport.snapshot()).toMatchObject({ supported: false, status: 'unsupported' });
  });
});
