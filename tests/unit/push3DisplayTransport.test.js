import { describe, expect, it, vi } from 'vitest';
import {
  createPush3DisplayTransport,
  createPush3TestPattern,
  decodePush3Bgr565,
  DISPLAY_STRIDE,
  DISPLAY_HEIGHT,
  encodePush3Pixels,
  panelColor,
  setPanelProfile,
  FRAME_HEADER,
  PUSH3_PRODUCT_ID,
  PUSH3_VENDOR_ID,
} from '../../src/performance/push3DisplayTransport.js';

function makeDevice() { return {
  productName: 'Ableton Push 3',
  vendorId: PUSH3_VENDOR_ID,
  productId: PUSH3_PRODUCT_ID,
  opened: false,
  configuration: null,
  open: vi.fn(async function open() { this.opened = true; }),
  selectConfiguration: vi.fn(async function selectConfiguration(value) {
    this.configuration = this.configurations.find(item => item.configurationValue === value);
  }),
  claimInterface: vi.fn(),
  transferOut: vi.fn().mockResolvedValue({ status: 'ok' }),
  releaseInterface: vi.fn(),
  close: vi.fn(async function close() { this.opened = false; }),
  configurations: [{
    configurationValue: 1,
    interfaces: [{
      interfaceNumber: 0,
      alternates: [{
        interfaceClass: 255,
        interfaceSubclass: 255,
        interfaceProtocol: 255,
        interfaceName: 'Ableton Push 3 Display',
        endpoints: [
          { endpointNumber: 1, direction: 'out', type: 'bulk', packetSize: 512 },
          { endpointNumber: 1, direction: 'in', type: 'bulk', packetSize: 512 },
        ],
      }],
    }],
  }],
}; }

describe('Push 3 display transport probe', () => {
  it('decodes tightly packed BGR565 pixels without changing their channel order', () => {
    const bytes = new Uint8Array(960 * 160 * 2);
    bytes.set([0x1f, 0x00, 0xe0, 0x07, 0x00, 0xf8]);
    const image = decodePush3Bgr565(bytes);

    expect([...image.data.slice(0, 12)]).toEqual([
      248, 0, 0, 255,
      0, 252, 0, 255,
      0, 0, 248, 255,
    ]);
  });

  it('requests only the observed Push 3 and reads descriptors without opening it', async () => {
    const device = makeDevice();
    const usb = { requestDevice: vi.fn().mockResolvedValue(device) };
    const transport = createPush3DisplayTransport({ usb });

    const result = await transport.connect();

    expect(usb.requestDevice).toHaveBeenCalledWith({
      filters: [{ vendorId: PUSH3_VENDOR_ID, productId: PUSH3_PRODUCT_ID }],
    });
    expect(result.descriptor.configurations[0].interfaces[0]).toMatchObject({
      number: 0,
      alternates: [{ name: 'Ableton Push 3 Display' }],
    });
    expect(device.open).not.toHaveBeenCalled();
    expect(transport.snapshot().status).toBe('permission granted · descriptors read');
  });

  it('reuses a previously authorized Push 3 without opening another chooser', async () => {
    const device = makeDevice();
    const usb = {
      getDevices: vi.fn().mockResolvedValue([device]),
      requestDevice: vi.fn(),
    };
    const transport = createPush3DisplayTransport({ usb });

    expect((await transport.connect()).ok).toBe(true);
    expect(usb.getDevices).toHaveBeenCalledOnce();
    expect(usb.requestDevice).not.toHaveBeenCalled();
  });

  it('claims and releases interface zero without transferring data', async () => {
    const device = makeDevice();
    const transport = createPush3DisplayTransport({
      usb: { requestDevice: vi.fn().mockResolvedValue(device) },
    });
    await transport.connect();

    expect(await transport.claim()).toEqual({ ok: true });
    expect(device.open).toHaveBeenCalledOnce();
    expect(device.selectConfiguration).toHaveBeenCalledWith(1);
    expect(device.claimInterface).toHaveBeenCalledWith(0);
    expect(transport.snapshot()).toMatchObject({
      claimed: true,
      status: 'interface 0 claimed · no data sent',
    });
    expect(device.transferOut).not.toHaveBeenCalled();

    expect(await transport.release()).toEqual({ ok: true });
    expect(device.releaseInterface).toHaveBeenCalledWith(0);
    expect(device.close).toHaveBeenCalledOnce();
    expect(transport.snapshot().claimed).toBe(false);
  });

  it('encodes a complete padded BGR565 frame with the display XOR mask', () => {
    const pattern = createPush3TestPattern();
    const encoded = encodePush3Pixels(pattern);

    expect(encoded).toHaveLength(DISPLAY_STRIDE * DISPLAY_HEIGHT);
    expect([...encoded.slice(0, 2)]).toEqual([0x18, 0x0c]);
    expect([...encoded.slice(1920, 1924)]).toEqual([0xe7, 0xf3, 0xe7, 0xff]);
  });

  it('sends only the fixed header and twenty full-size pixel chunks', async () => {
    const device = makeDevice();
    const transport = createPush3DisplayTransport({
      usb: { requestDevice: vi.fn().mockResolvedValue(device) },
    });
    await transport.connect();
    await transport.claim();

    expect(await transport.sendTestPattern()).toEqual({
      ok: true,
      bytes: FRAME_HEADER.length + DISPLAY_STRIDE * DISPLAY_HEIGHT,
    });
    expect(device.transferOut).toHaveBeenCalledTimes(21);
    expect(device.transferOut.mock.calls[0][0]).toBe(1);
    expect([...device.transferOut.mock.calls[0][1]]).toEqual([...FRAME_HEADER]);
    expect(device.transferOut.mock.calls.slice(1).every(([, bytes]) => bytes.length === 16_384)).toBe(true);
  });

  it('streams frames until stopped without leaving overlapping timers', async () => {
    vi.useFakeTimers();
    const device = makeDevice();
    const transport = createPush3DisplayTransport({
      usb: { requestDevice: vi.fn().mockResolvedValue(device) },
    });
    await transport.connect();
    await transport.claim();

    expect(await transport.startStream(() => createPush3TestPattern(), { fps: 10 })).toEqual({ ok: true });
    expect(transport.snapshot()).toMatchObject({ streaming: true, status: 'streaming controller preview · 10 fps' });
    expect(device.transferOut).toHaveBeenCalledTimes(21);
    await vi.advanceTimersByTimeAsync(100);
    expect(device.transferOut).toHaveBeenCalledTimes(42);

    transport.stopStream();
    await vi.advanceTimersByTimeAsync(500);
    expect(device.transferOut).toHaveBeenCalledTimes(42);
    expect(transport.snapshot().streaming).toBe(false);
    vi.useRealTimers();
  });

  it('reports unsupported browsers without requesting a device', async () => {
    const transport = createPush3DisplayTransport({ usb: null });
    expect(await transport.connect()).toEqual({ ok: false, reason: 'unsupported' });
    expect(transport.snapshot()).toMatchObject({ supported: false, status: 'unsupported' });
  });

  it('applies a panel profile to frames sent to the display but not to exact colours by default', () => {
    expect(panelColor(0, 0, 0, { gamma: 0.8, saturation: 1.25 })).toEqual([0, 0, 0]);
    expect(panelColor(255, 255, 255, { gamma: 0.8, saturation: 1.25 })).toEqual([255, 255, 255]);
    const [r, g, b] = panelColor(128, 128, 128, { gamma: 0.8, saturation: 1.25 });
    expect(r).toBe(g); expect(g).toBe(b); expect(r).toBeGreaterThan(128); // mid grey lifts, stays grey
    const lime = panelColor(0xae, 0xfc, 0x53, { gamma: 1, saturation: 1.25 });
    expect(lime[1]).toBeGreaterThanOrEqual(0xfc); expect(lime[2]).toBeLessThan(0x53); // more saturated
    expect(panelColor(10, 200, 30, { gamma: 1, saturation: 1 })).toEqual([10, 200, 30]);

    const pattern = createPush3TestPattern();
    const exact = encodePush3Pixels(pattern);
    setPanelProfile({ gamma: 0.8, saturation: 1.25 });
    const lifted = encodePush3Pixels(pattern);
    setPanelProfile();
    expect(lifted).not.toEqual(exact);
    expect(encodePush3Pixels(pattern)).toEqual(exact); // identity restored
  });
});
