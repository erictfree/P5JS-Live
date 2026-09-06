import { ShaderChain } from '../shaders/shaderChain.js';

const layers = new WeakSet();
const generatedEffects = new WeakSet();

function assertPatch(value) {
  if (typeof value === 'function' || typeof value?.draw === 'function') return;
  if (Array.isArray(value) && value.every((entry) => { assertPatch(entry); return true; })) return;
  throw new TypeError('layer() and .fx() need a patch or a group of patches');
}

/** An immutable array builder: the host still owns every child's lifecycle. */
class SketchLayer extends Array {
  static get [Symbol.species]() { return Array; }

  constructor(entries, muted = false) {
    super(...entries);
    Object.defineProperty(this, 'muted', { value: muted });
    layers.add(this);
    Object.freeze(this);
  }

  fx(...effects) {
    effects.forEach(assertPatch);
    return new SketchLayer([...this, ...effects], this.muted);
  }

  // These operate on the rendered layer in normalized image coordinates. They do
  // not change a sketch's p5 drawing state or call its draw() outside the host.
  #process(method, args) {
    const merge = generatedEffects.has(this.at(-1));
    const effect = merge ? this.at(-1).clone() : new ShaderChain();
    effect[method](...args);
    generatedEffects.add(effect);
    return new SketchLayer([...(merge ? this.slice(0, -1) : this), effect], this.muted);
  }

  rotate(angle = 0, speed = 0) { return this.#process('rotate', [angle, speed]); }
  scale(amount = 1) { return this.#process('scale', [amount]); }
  translate(x = 0, y = 0) { return this.#process('transform', [x, y]); }
  opacity(amount = 1) { return this.#process('color', [1, 1, 1, amount]); }
  mute(enabled = true) {
    if (typeof enabled !== 'boolean') throw new TypeError('layer.mute() needs a boolean');
    return new SketchLayer([...this], enabled);
  }
}

export function isLayer(value) { return layers.has(value); }

/** Retain an ordinary sketch/group, then append effects in written order. */
export function layer(sketch) {
  assertPatch(sketch);
  return new SketchLayer([sketch]);
}
