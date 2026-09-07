import { ShaderChain } from '../shaders/shaderChain.js';

const layers = new WeakSet();
const generatedEffects = new WeakSet();

export function assertPatch(value, ancestors = new Set(), location = 'layer') {
  // Array.prototype.draw is a scene command, not a patch lifecycle method.
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError(`${location}: a layer cannot contain a cyclic array`);
    ancestors.add(value);
    for (let i = 0; i < value.length; i++) {
      if (!Object.hasOwn(value, i)) throw new TypeError(`${location}[${i}]: a layer cannot contain an empty array slot`);
      assertPatch(value[i], ancestors, `${location}[${i}]`);
    }
    ancestors.delete(value);
    return;
  }
  if (typeof value === 'function' || typeof value?.draw === 'function') return;
  throw new TypeError(`${location}: layer() and .fx() need a patch (a function or object with draw()) or a group of patches`);
}

/** An immutable array builder: the host still owns every child's lifecycle. */
class SketchLayer extends Array {
  static get [Symbol.species]() { return Array; }

  constructor(entries, muted = false, rootGroup = true) {
    super(...entries);
    Object.defineProperty(this, 'muted', { value: muted });
    Object.defineProperty(this, 'rootGroup', { value: rootGroup });
    layers.add(this);
    Object.freeze(this);
  }

  fx(...effects) {
    effects.forEach(effect => assertPatch(effect));
    return new SketchLayer([...this, ...effects], this.muted, this.rootGroup);
  }

  // These operate on the rendered layer in normalized image coordinates. They do
  // not change a sketch's p5 drawing state or call its draw() outside the host.
  #process(method, args) {
    return processLayer(this, method, args);
  }

  rotate(angle = 0, speed = 0) { return this.#process('rotate', [angle, speed]); }
  scale(amount = 1, ...args) { return this.#process('scale', [amount, ...args]); }
  translate(x = 0, y = 0) { return this.#process('transform', [x, y]); }
  opacity(amount = 1) { return this.#process('color', [1, 1, 1, amount]); }
  mute(enabled = true) {
    if (typeof enabled !== 'boolean') throw new TypeError('layer.mute() needs a boolean');
    return new SketchLayer([...this], enabled);
  }
}

export function isLayer(value) { return layers.has(value); }

/** Give an array fluent operations without adding a nested render group. */
export function arrayLayer(entries) {
  if (!Array.isArray(entries)) throw new TypeError('Layer methods need an array of patches');
  assertPatch(entries);
  return isLayer(entries) ? entries : new SketchLayer(entries, false, false);
}

/** Shared immutable effect construction for legacy layers and native array methods. */
export function processLayer(entries, method, args) {
  const current = arrayLayer(entries);
  const merge = generatedEffects.has(current.at(-1));
  const effect = merge ? current.at(-1).clone() : new ShaderChain();
  effect[method](...args);
  generatedEffects.add(effect);
  return new SketchLayer(
    [...(merge ? current.slice(0, -1) : current), effect], current.muted, current.rootGroup,
  );
}

/** Retain an ordinary sketch/group, then append effects in written order. */
export function layer(sketch) {
  assertPatch(sketch);
  return new SketchLayer([sketch]);
}
