// Native array methods for the live-coding language. User source is never rewritten.
import { appendToLayer, muteLayer, processLayer } from './layer.js';

// Explicit allowlist: never copy lifecycle methods or native Array names from a
// shader prototype. In particular, Array.shift must retain its normal behavior.
export const ARRAY_SHADER_METHODS = Object.freeze([
  'transform', 'mirror', 'crop', 'noiseWarp', 'rotate', 'scale', 'pixelate',
  'repeat', 'repeatX', 'repeatY', 'kaleid', 'scroll', 'scrollX', 'scrollY',
  'blur', 'sharpen', 'edgeDetect', 'bloom', 'vignette', 'rgbSplit', 'feedback',
  'lumaMask', 'posterize', 'invert', 'contrast', 'brightness', 'luma', 'thresh',
  'color', 'saturate', 'hue', 'colorama', 'sum', 'rgba',
]);

let selectScene = null;

/** Commands belong to the current synchronous evaluation transaction, not window. */
export function withArrayDrawing(select, evaluate) {
  const previous = selectScene;
  selectScene = select;
  try { return evaluate(); }
  finally { selectScene = previous; }
}

const methods = Object.fromEntries(ARRAY_SHADER_METHODS.map(name => [name, function (...args) {
  return processLayer(this, name, args);
}]));
Object.assign(methods, {
  colorShift(...args) { return processLayer(this, 'shift', args); },
  rotate(angle = 0, speed = 0) { return processLayer(this, 'rotate', [angle, speed]); },
  scale(amount = 1, ...args) { return processLayer(this, 'scale', [amount, ...args]); },
  translate(x = 0, y = 0) { return processLayer(this, 'transform', [x, y]); },
  opacity(amount = 1) { return processLayer(this, 'color', [1, 1, 1, amount]); },
  add(...patches) { return appendToLayer(this, patches); },
  fx(...effects) { return appendToLayer(this, effects); },
  mute(enabled = true) { return muteLayer(this, enabled); },
  draw() {
    if (!Array.isArray(this)) throw new TypeError('scene.draw() needs a scene array');
    if (!selectScene) throw new Error('Call scene.draw() while evaluating live code; the host owns the frame loop');
    return selectScene(this);
  },
});
export const ARRAY_METHOD_NAMES = Object.freeze(Object.keys(methods));

const installations = new WeakMap();

/** Preflight the entire API, then install protected, non-enumerable methods. */
export function installArrayMethods(prototype = Array.prototype) {
  const installed = installations.get(prototype) ?? new Map();
  const pending = [];
  for (const name of ARRAY_METHOD_NAMES) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    if (installed.has(name) && descriptor?.get === installed.get(name).get &&
        descriptor?.set === installed.get(name).set && descriptor.configurable === false) continue;
    if (name in prototype) throw new TypeError(`Cannot install array API: Array.${name} already exists`);
    pending.push(name);
  }
  if (pending.length && !Object.isExtensible(prototype)) {
    throw new TypeError('Cannot install array API: Array.prototype is not extensible');
  }
  for (const name of pending) {
    const descriptor = {
      get() { return methods[name]; },
      set() { throw new TypeError(`Array.${name} is protected and cannot be redefined`); },
      enumerable: false,
      configurable: false,
    };
    Object.defineProperty(prototype, name, descriptor);
    installed.set(name, descriptor);
  }
  installations.set(prototype, installed);
}
