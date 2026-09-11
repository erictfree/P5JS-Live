import { describe, expect, it, vi } from 'vitest';
import { PUSH3_PRODUCT_ID, PUSH3_VENDOR_ID } from '../../src/performance/push3DisplayTransport.js';
import { createPush3AutoConnect } from '../../src/performance/push3AutoConnect.js';

const push = { vendorId: PUSH3_VENDOR_ID, productId: PUSH3_PRODUCT_ID };

function fakes({ devices = [push], claimOk = true, midiOk = true } = {}) {
  const display = {
    connect: vi.fn(async () => ({ ok: true })),
    claim: vi.fn(async () => (claimOk ? { ok: true } : { ok: false, reason: 'claim failed' })),
    stopStream: vi.fn(),
    release: vi.fn(async () => ({ ok: true })),
  };
  const leds = { connect: vi.fn(async () => ({ ok: midiOk, reason: midiOk ? undefined : 'denied' })), hasOutput: vi.fn(() => midiOk), disconnect: vi.fn() };
  const showController = vi.fn(async () => ({ ok: true }));
  const usb = { getDevices: vi.fn(async () => devices), requestDevice: vi.fn() };
  const diagnostics = { success: vi.fn() };
  const hooks = [];
  const auto = createPush3AutoConnect({ usb, display, leds, showController, diagnostics, addUnloadHook: fn => hooks.push(fn) });
  return { auto, display, leds, showController, usb, diagnostics, hooks };
}

describe('Push 3 auto-connect', () => {
  it('connects, claims and streams a previously authorised Push without opening a chooser', async () => {
    const f = fakes();
    const result = await f.auto.start();
    expect(result).toMatchObject({ ok: true, display: { ok: true }, leds: { ok: true } });
    expect(f.usb.requestDevice).not.toHaveBeenCalled();
    expect(f.display.connect).toHaveBeenCalledOnce();
    expect(f.display.claim).toHaveBeenCalledOnce();
    expect(f.showController).toHaveBeenCalledOnce();
    expect(f.leds.connect).toHaveBeenCalledOnce();
    expect(f.diagnostics.success).toHaveBeenCalledWith('Push 3 ready', 'display streaming · pads and LEDs live');
  });

  it('does nothing with the display when no Push has been authorised', async () => {
    const f = fakes({ devices: [], midiOk: false });
    const result = await f.auto.start();
    expect(result.ok).toBe(false);
    expect(f.display.connect).not.toHaveBeenCalled();
    expect(f.diagnostics.success).not.toHaveBeenCalled();
  });

  it('reports a failed claim (for example Live holding the interface) and still brings up MIDI', async () => {
    const f = fakes({ claimOk: false });
    const result = await f.auto.start();
    expect(result.display).toEqual({ ok: false, reason: 'claim failed' });
    expect(result.leds.ok).toBe(true);
    expect(f.showController).not.toHaveBeenCalled();
    expect(f.diagnostics.success).toHaveBeenCalledWith('Push 3 ready', 'pads and LEDs live');
  });

  it('runs only once and releases everything on unload', async () => {
    const f = fakes();
    await f.auto.start();
    expect(await f.auto.start()).toEqual({ ok: false, reason: 'already started' });
    expect(f.hooks).toHaveLength(1);
    f.hooks[0]();
    expect(f.leds.disconnect).toHaveBeenCalledOnce();
    expect(f.display.stopStream).toHaveBeenCalledOnce();
    expect(f.display.release).toHaveBeenCalledOnce();
  });

  it('survives a browser without WebUSB', async () => {
    const f = fakes();
    const auto = createPush3AutoConnect({ usb: undefined, display: f.display, leds: f.leds, showController: f.showController, addUnloadHook: () => {} });
    const result = await auto.start();
    expect(result.display).toEqual({ ok: false, reason: 'not authorised' });
    expect(result.leds.ok).toBe(true);
  });
});
