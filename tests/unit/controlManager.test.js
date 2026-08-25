import { describe, expect, it, vi } from 'vitest';
import { createControlManager } from '../../src/control/controlManager.js';
import { createRegistry } from '../../src/host/registry.js';

function midiHarness({ supported = true } = {}) {
  const registry = createRegistry();
  registry.declareParam('speed', 0.5, { min: 0, max: 2, step: 0.01 });
  const input = {
    manufacturer: 'Test',
    name: 'Knobs',
    state: 'connected',
    connection: 'open',
    onmidimessage: null,
  };
  const access = { inputs: new Map([['input-1', input]]), onstatechange: null };
  const requestMIDIAccess = vi.fn(async () => access);
  const scheduled = [];
  const manager = createControlManager({
    registry,
    navigator_: supported ? { requestMIDIAccess } : {},
    schedule: (callback) => scheduled.push(callback),
  });
  return {
    registry,
    input,
    manager,
    requestMIDIAccess,
    flush: () => scheduled.splice(0).forEach((callback) => callback()),
  };
}

describe('external parameter control', () => {
  it('reports unsupported browsers without disturbing parameters', async () => {
    const h = midiHarness({ supported: false });
    expect(h.manager.snapshot().midi).toMatchObject({ supported: false, status: 'unsupported' });
    expect(await h.manager.connectMidi()).toMatchObject({ ok: false, reason: 'unsupported' });
    expect(h.registry.listParams()[0].value).toBe(0.5);
  });

  it('learns a MIDI CC and maps its normalized value into the parameter range', async () => {
    const h = midiHarness();
    expect(await h.manager.connectMidi()).toMatchObject({ ok: true, devices: 1 });
    expect(h.requestMIDIAccess).toHaveBeenCalledWith({ sysex: false });

    expect(h.manager.learn('speed')).toBe(true);
    h.input.onmidimessage({ data: Uint8Array.from([0xb0, 21, 64]) });
    h.flush();

    expect(h.manager.snapshot()).toMatchObject({
      learning: null,
      mappings: [{
        param: 'speed',
        device: 'Test · Knobs',
        type: 'cc',
        channel: 1,
        number: 21,
      }],
    });
    expect(h.registry.listParams()[0].value).toBeCloseTo(1.01, 2);
  });

  it('restores portable mappings and batches repeated controller messages', () => {
    const h = midiHarness();
    expect(h.manager.restoreMappings([{
      param: 'speed',
      transport: 'midi',
      device: 'Test · Knobs',
      type: 'cc',
      channel: 1,
      number: 7,
      invert: true,
    }])).toBe(1);

    h.manager.receive(h.input, Uint8Array.from([0xb0, 7, 0]));
    h.manager.receive(h.input, Uint8Array.from([0xb0, 7, 32]));
    expect(h.registry.listParams()[0].value).toBe(0.5);
    h.flush();
    expect(h.registry.listParams()[0].value).toBeCloseTo(1.5, 1);
  });

  it('maps a drum-pad note to a momentary button parameter', async () => {
    const h = midiHarness();
    h.registry.declareParam('flash', false, { type: 'button', mode: 'momentary' });
    await h.manager.connectMidi();
    expect(h.manager.learn('flash')).toBe(true);

    h.input.onmidimessage({ data: Uint8Array.from([0x90, 36, 110]) });
    h.flush();
    expect(h.registry.listParams().find(({ name }) => name === 'flash').value).toBe(true);

    h.input.onmidimessage({ data: Uint8Array.from([0x80, 36, 0]) });
    h.flush();
    expect(h.registry.listParams().find(({ name }) => name === 'flash').value).toBe(false);
  });

  it('toggles a button only on note press and maps continuous input to choices', async () => {
    const h = midiHarness();
    h.registry.declareParam('freeze', false, { type: 'button', mode: 'toggle' });
    h.registry.declareParam('shape', 'circle', {
      type: 'choice',
      choices: ['circle', 'square', 'triangle'],
    });
    await h.manager.connectMidi();

    h.manager.restoreMappings([
      {
        param: 'freeze', transport: 'midi', device: 'Test · Knobs',
        type: 'note', channel: 1, number: 40, invert: false,
      },
      {
        param: 'shape', transport: 'midi', device: 'Test · Knobs',
        type: 'cc', channel: 1, number: 8, invert: false,
      },
    ]);
    h.input.onmidimessage({ data: Uint8Array.from([0x90, 40, 127]) });
    h.flush();
    expect(h.registry.listParams().find(({ name }) => name === 'freeze').value).toBe(true);
    h.input.onmidimessage({ data: Uint8Array.from([0x80, 40, 0]) });
    h.flush();
    expect(h.registry.listParams().find(({ name }) => name === 'freeze').value).toBe(true);
    h.input.onmidimessage({ data: Uint8Array.from([0x90, 40, 127]) });
    h.flush();
    expect(h.registry.listParams().find(({ name }) => name === 'freeze').value).toBe(false);

    h.input.onmidimessage({ data: Uint8Array.from([0xb0, 8, 127]) });
    h.flush();
    expect(h.registry.listParams().find(({ name }) => name === 'shape').value).toBe('triangle');
  });
});
