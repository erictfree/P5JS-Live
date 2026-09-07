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
  if (value instanceof ShaderChain) {
    if (ancestors.has(value)) throw new TypeError(`${location}: cyclic image input`);
    ancestors.add(value);
    for (const [index, input] of value.imageInputs.entries()) {
      assertPatch(input.source, ancestors, `${location}.modulate[${index}]`);
    }
    ancestors.delete(value);
    return;
  }
  if (typeof value === 'function' || typeof value?.draw === 'function') return;
  throw new TypeError(`${location}: layer entries need a patch (a function or object with draw()) or a group of patches`);
}

/** Build a normal frozen array; all methods come from the single native array API. */
export function createLayerArray(entries, muted) {
  if (!Array.isArray(entries)) throw new TypeError('Layer methods need an array of patches');
  assertPatch(entries);
  const result = [...entries];
  // An explicit mute setting retains a root group across mute/unmute, keeping
  // occurrence paths and state stable. Effect-only arrays need no extra group.
  if (muted !== undefined) Object.defineProperty(result, 'muted', { value: muted });
  layers.add(result);
  return Object.freeze(result);
}

export function isLayerArray(value) { return layers.has(value); }

const muteSetting = entries => isLayerArray(entries) ? entries.muted : undefined;

export function appendToLayer(entries, additions) {
  if (!Array.isArray(entries)) throw new TypeError('Layer methods need an array of patches');
  assertPatch(entries);
  assertPatch(additions);
  return createLayerArray([...entries, ...additions], muteSetting(entries));
}

export function muteLayer(entries, enabled = true) {
  if (typeof enabled !== 'boolean') throw new TypeError('Array.mute() needs a boolean');
  return createLayerArray(entries, enabled);
}

/** Immutable effect construction; the host owns all patch lifecycle calls. */
export function processLayer(entries, method, args) {
  const current = createLayerArray(entries, muteSetting(entries));
  const merge = generatedEffects.has(current.at(-1));
  const effect = merge ? current.at(-1).clone() : new ShaderChain();
  effect[method](...args);
  generatedEffects.add(effect);
  return createLayerArray(
    [...(merge ? current.slice(0, -1) : current), effect], muteSetting(current),
  );
}
