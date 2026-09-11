// Bring the Push up without clicks when the browser already remembers it. WebUSB needs a
// user gesture only for the chooser; a previously authorised device can be opened,
// claimed and streamed from page load. Web MIDI likewise re-grants silently once allowed.
// Nothing here opens a chooser or prompt that was not already granted.

import { PUSH3_PRODUCT_ID, PUSH3_VENDOR_ID } from './push3DisplayTransport.js';

export function createPush3AutoConnect({
  usb = globalThis.navigator?.usb,
  display,
  leds,
  showController,
  diagnostics,
  addUnloadHook = handler => globalThis.addEventListener?.('pagehide', handler),
} = {}) {
  let started = false;

  async function authorised() {
    if (typeof usb?.getDevices !== 'function') return false;
    try {
      const devices = await usb.getDevices();
      return devices.some(device => device.vendorId === PUSH3_VENDOR_ID && device.productId === PUSH3_PRODUCT_ID);
    } catch { return false; }
  }

  async function startDisplay() {
    if (!(await authorised())) return { ok: false, reason: 'not authorised' };
    const connected = await display.connect();
    if (!connected.ok) return connected;
    const claimed = await display.claim();
    if (!claimed.ok) return claimed;
    const shown = await showController();
    return shown?.ok === false ? shown : { ok: true };
  }

  async function startLeds() {
    if (!leds) return { ok: false, reason: 'no transport' };
    const result = await leds.connect();
    return result.ok && leds.hasOutput() ? { ok: true } : { ok: false, reason: result.reason ?? 'no output' };
  }

  // Idempotent. Returns what came up so callers can report it.
  async function start() {
    if (started) return { ok: false, reason: 'already started' };
    started = true;
    const [screen, midi] = await Promise.all([startDisplay().catch(error => ({ ok: false, reason: error?.message })), startLeds().catch(error => ({ ok: false, reason: error?.message }))]);
    if (screen.ok || midi.ok) {
      diagnostics?.success?.('Push 3 ready', [screen.ok ? 'display streaming' : null, midi.ok ? 'pads and LEDs live' : null].filter(Boolean).join(' · '));
    }
    return { ok: screen.ok || midi.ok, display: screen, leds: midi };
  }

  // Leave the hardware clean when the page goes away: LEDs off, interface released.
  function release() {
    try { leds?.disconnect(); } catch { /* best effort on unload */ }
    try { display.stopStream(); void display.release(); } catch { /* best effort on unload */ }
  }

  addUnloadHook(release);
  return { start, release };
}
