const PUSH3_VENDOR_ID = 0x2982;
const PUSH3_PRODUCT_ID = 0x1969;
const DISPLAY_WIDTH = 960;
const DISPLAY_HEIGHT = 160;
const DISPLAY_STRIDE = 2048;
const DISPLAY_ENDPOINT = 1;
const TRANSFER_CHUNK_SIZE = 16_384;
const FRAME_HEADER = Uint8Array.from([
  0xff, 0xcc, 0xaa, 0x88, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]);
const XOR_PATTERN = [0xe7, 0xf3, 0xe7, 0xff];

export function decodePush3Bgr565(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== DISPLAY_WIDTH * DISPLAY_HEIGHT * 2) {
    throw new RangeError(`Packed Push 3 images must contain ${DISPLAY_WIDTH * DISPLAY_HEIGHT * 2} bytes.`);
  }
  const data = new Uint8ClampedArray(DISPLAY_WIDTH * DISPLAY_HEIGHT * 4);
  for (let source = 0, target = 0; source < bytes.length; source += 2, target += 4) {
    const pixel = bytes[source] | (bytes[source + 1] << 8);
    data[target] = (pixel & 0x1f) << 3;
    data[target + 1] = ((pixel >> 5) & 0x3f) << 2;
    data[target + 2] = ((pixel >> 11) & 0x1f) << 3;
    data[target + 3] = 255;
  }
  return { width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT, data };
}

export function encodePush3Pixels({ width, height, data }) {
  if (width !== DISPLAY_WIDTH || height !== DISPLAY_HEIGHT) {
    throw new RangeError(`Push 3 frames must be ${DISPLAY_WIDTH} × ${DISPLAY_HEIGHT} pixels.`);
  }
  if (!data || data.length !== width * height * 4) {
    throw new RangeError('Push 3 frames require RGBA pixel data.');
  }
  const frame = new Uint8Array(DISPLAY_STRIDE * DISPLAY_HEIGHT);
  for (let y = 0; y < DISPLAY_HEIGHT; y += 1) {
    const rowOffset = y * DISPLAY_STRIDE;
    for (let x = 0; x < DISPLAY_WIDTH; x += 1) {
      const source = (y * DISPLAY_WIDTH + x) * 4;
      const target = rowOffset + x * 2;
      const pixel = ((data[source + 2] >> 3) << 11)
        | ((data[source + 1] >> 2) << 5)
        | (data[source] >> 3);
      frame[target] = pixel & 0xff;
      frame[target + 1] = pixel >> 8;
    }
  }
  for (let index = 0; index < frame.length; index += 1) {
    frame[index] ^= XOR_PATTERN[index % XOR_PATTERN.length];
  }
  return frame;
}

export function createPush3TestPattern() {
  const data = new Uint8ClampedArray(DISPLAY_WIDTH * DISPLAY_HEIGHT * 4);
  const colors = [
    [255, 86, 107], [255, 182, 93], [253, 224, 71], [98, 215, 177],
    [74, 198, 219], [102, 126, 234], [196, 155, 232], [238, 240, 241],
  ];
  for (let y = 0; y < DISPLAY_HEIGHT; y += 1) {
    for (let x = 0; x < DISPLAY_WIDTH; x += 1) {
      const color = colors[Math.min(colors.length - 1, Math.floor(x / 120))];
      const border = x < 5 || x >= DISPLAY_WIDTH - 5 || y < 5 || y >= DISPLAY_HEIGHT - 5;
      const divider = x % 120 < 3;
      const offset = (y * DISPLAY_WIDTH + x) * 4;
      data[offset] = border ? 255 : divider ? 18 : color[0];
      data[offset + 1] = border ? 255 : divider ? 20 : color[1];
      data[offset + 2] = border ? 255 : divider ? 22 : color[2];
      data[offset + 3] = 255;
    }
  }
  return { width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT, data };
}

function describeDevice(device) {
  return {
    productName: device.productName || 'Ableton Push 3',
    vendorId: device.vendorId,
    productId: device.productId,
    configurations: [...(device.configurations ?? [])].map(configuration => ({
      value: configuration.configurationValue,
      interfaces: configuration.interfaces.map(entry => ({
        number: entry.interfaceNumber,
        alternates: entry.alternates.map(alternate => ({
          classCode: alternate.interfaceClass,
          subclassCode: alternate.interfaceSubclass,
          protocolCode: alternate.interfaceProtocol,
          name: alternate.interfaceName || null,
          endpoints: alternate.endpoints.map(endpoint => ({
            number: endpoint.endpointNumber,
            direction: endpoint.direction,
            type: endpoint.type,
            packetSize: endpoint.packetSize,
          })),
        })),
      })),
    })),
  };
}

export function createPush3DisplayTransport({
  usb = globalThis.navigator?.usb,
  diagnostics,
} = {}) {
  let status = typeof usb?.requestDevice === 'function' ? 'disconnected' : 'unsupported';
  let device = null;
  let descriptor = null;
  let claimed = false;
  let streaming = false;
  let streamTimer = null;
  const listeners = new Set();
  const notify = () => listeners.forEach(listener => listener());

  async function connect() {
    if (typeof usb?.requestDevice !== 'function') {
      status = 'unsupported';
      notify();
      return { ok: false, reason: 'unsupported' };
    }
    status = 'requesting permission';
    notify();
    try {
      const authorized = typeof usb.getDevices === 'function' ? await usb.getDevices() : [];
      device = authorized.find(candidate => (
        candidate.vendorId === PUSH3_VENDOR_ID && candidate.productId === PUSH3_PRODUCT_ID
      )) ?? await usb.requestDevice({
          filters: [{ vendorId: PUSH3_VENDOR_ID, productId: PUSH3_PRODUCT_ID }],
        });
      descriptor = describeDevice(device);
      status = 'permission granted · descriptors read';
      diagnostics?.success(
        'Push 3 display detected',
        `${descriptor.productName}; ${descriptor.configurations.length} USB configuration. No interface was claimed and no data was sent.`,
      );
      notify();
      return { ok: true, descriptor };
    } catch (error) {
      device = null;
      descriptor = null;
      status = error?.name === 'NotFoundError' ? 'not selected' : 'permission failed';
      diagnostics?.warn('Push 3 display connection stopped', error?.message || status);
      notify();
      return { ok: false, reason: status, error };
    }
  }

  async function claim() {
    if (!device || !descriptor) return { ok: false, reason: 'not connected' };
    const displayInterface = descriptor.configurations
      .flatMap(configuration => configuration.interfaces)
      .find(entry => entry.number === 0);
    if (!displayInterface) return { ok: false, reason: 'display interface missing' };
    status = 'claiming interface 0';
    notify();
    try {
      if (!device.opened) await device.open();
      if (!device.configuration) {
        const configurationValue = descriptor.configurations[0]?.value;
        if (!configurationValue) throw new Error('Push 3 has no USB configuration.');
        await device.selectConfiguration(configurationValue);
      }
      await device.claimInterface(0);
      claimed = true;
      status = 'interface 0 claimed · no data sent';
      diagnostics?.success(
        'Push 3 display interface claimed',
        'Interface 0 is open for the next test. No USB transfer has been sent.',
      );
      notify();
      return { ok: true };
    } catch (error) {
      claimed = false;
      status = 'claim failed';
      diagnostics?.warn('Could not claim Push 3 display interface', error?.message || status);
      notify();
      return { ok: false, reason: status, error };
    }
  }

  async function transferFrame(imageData) {
    if (!device || !claimed || !device.opened) return { ok: false, reason: 'interface not claimed' };
    const outputEndpoint = descriptor.configurations
      .flatMap(configuration => configuration.interfaces)
      .find(entry => entry.number === 0)?.alternates
      .flatMap(alternate => alternate.endpoints)
      .find(endpoint => endpoint.number === DISPLAY_ENDPOINT && endpoint.direction === 'out' && endpoint.type === 'bulk');
    if (!outputEndpoint) return { ok: false, reason: 'bulk output endpoint missing' };
    try {
      const framebuffer = encodePush3Pixels(imageData);
      const headerResult = await device.transferOut(DISPLAY_ENDPOINT, FRAME_HEADER);
      if (headerResult.status !== 'ok') throw new Error(`Push 3 frame header transfer ${headerResult.status}.`);
      for (let offset = 0; offset < framebuffer.length; offset += TRANSFER_CHUNK_SIZE) {
        const result = await device.transferOut(
          DISPLAY_ENDPOINT,
          framebuffer.subarray(offset, offset + TRANSFER_CHUNK_SIZE),
        );
        if (result.status !== 'ok') throw new Error(`Push 3 pixel transfer ${result.status}.`);
      }
      return { ok: true, bytes: FRAME_HEADER.length + framebuffer.length };
    } catch (error) {
      return { ok: false, reason: 'frame transfer failed', error };
    }
  }

  async function sendFrame(imageData) {
    status = 'sending one test frame';
    notify();
    const result = await transferFrame(imageData);
    if (result.ok) {
      status = 'test frame sent · display will clear after timeout';
      diagnostics?.success(
        'Push 3 test frame sent',
        'Sent one documented display frame to bulk endpoint 1. No control or firmware messages were sent.',
      );
    } else {
      status = 'test frame failed';
      diagnostics?.warn('Could not send Push 3 test frame', result.error?.message || result.reason);
    }
    notify();
    return result.ok ? result : { ...result, reason: status };
  }

  function sendTestPattern() {
    return sendFrame(createPush3TestPattern());
  }

  function stopStream({ statusText = 'interface 0 claimed · display stopped' } = {}) {
    streaming = false;
    if (streamTimer) clearTimeout(streamTimer);
    streamTimer = null;
    if (claimed) status = statusText;
    notify();
  }

  async function startStream(getImageData, { fps = 15, label = 'controller preview' } = {}) {
    if (!claimed) return { ok: false, reason: 'interface not claimed' };
    if (typeof getImageData !== 'function') return { ok: false, reason: 'image provider missing' };
    if (!Number.isFinite(fps) || fps < 1 || fps > 30) return { ok: false, reason: 'fps must be between 1 and 30' };
    stopStream();
    streaming = true;
    status = `streaming ${label} · ${fps} fps`;
    notify();
    const delay = 1000 / fps;
    const tick = async () => {
      if (!streaming) return;
      let result;
      try {
        result = await transferFrame(getImageData());
      } catch (error) {
        result = { ok: false, reason: 'image provider failed', error };
      }
      if (!streaming) return;
      if (!result.ok) {
        streaming = false;
        status = 'display stream failed';
        diagnostics?.warn('Push 3 display stream stopped', result.error?.message || result.reason);
        notify();
        return;
      }
      streamTimer = setTimeout(tick, delay);
    };
    await tick();
    return streaming ? { ok: true } : { ok: false, reason: status };
  }

  async function release() {
    if (!device) return { ok: true };
    try {
      stopStream({ statusText: status });
      if (device.opened && claimed) await device.releaseInterface(0);
      if (device.opened) await device.close();
      claimed = false;
      status = 'permission granted · interface released';
      notify();
      return { ok: true };
    } catch (error) {
      status = 'release failed';
      diagnostics?.warn('Could not release Push 3 display interface', error?.message || status);
      notify();
      return { ok: false, reason: status, error };
    }
  }

  function snapshot() {
    return {
      supported: typeof usb?.requestDevice === 'function',
      status,
      claimed,
      streaming,
      descriptor,
    };
  }

  return {
    connect,
    claim,
    sendFrame,
    sendTestPattern,
    startStream,
    stopStream,
    release,
    snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export {
  DISPLAY_HEIGHT,
  DISPLAY_STRIDE,
  DISPLAY_WIDTH,
  FRAME_HEADER,
  PUSH3_VENDOR_ID,
  PUSH3_PRODUCT_ID,
  TRANSFER_CHUNK_SIZE,
};
