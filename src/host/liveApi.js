// The live authoring API — the small set of commands around first-class strategies.
//
// Patch authors do not register callbacks. They define ordinary named functions, objects,
// or class instances:
//
//   const waveScope = ({ audio }) => { ... };
//   const laserFan = { draw({ audio }) { ... } };
//   const scene = [waveScope, [laserFan, plasma]];
//
// The evaluator captures those bindings. An object with draw() is immediately a
// strategy; a function becomes one when it is placed in a scene. A top-level array is
// a scene and a nested array is a transparent isolated render group. Anonymous entries
// receive path-based identities such as `scene[1][0]`. Composition changes only by
// editing that array.

import { ShaderChain } from '../shaders/shaderChain.js';
import { StreamRoom } from '../network/streamRoom.js';

export const LIVE_API_NAMES = [
  'activate',
  'reset',
  'control',
  // Compatibility only for saved projects created before the student-facing rename.
  'param',
  'ShaderChain',
  'StreamRoom',
];

const LIFECYCLE_KEYS = ['state', 'enter', 'draw', 'beat', 'exit', 'dispose'];

function assertName(kind, name) {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new TypeError(`${kind} needs a non-empty name`);
  }
  if (name.includes('#')) {
    throw new TypeError(`${kind} "${name}" may not contain "#"`);
  }
  return name;
}

/** Stable identity for an anonymous value occupying one scene-array slot. */
export function inlineStrategyName(sceneName, path) {
  const indexes = Array.isArray(path) ? path : [path];
  return `${sceneName}${indexes.map((index) => `[${index}]`).join('')}`;
}

/** Validate and return the exact function or object supplied by the patch author. */
export function validateStrategy(value, suggestedName) {
  const name = suggestedName;
  if (typeof value === 'function') {
    assertName('Strategy', name);
    return { name, implementation: value };
  }
  if (value === null || typeof value !== 'object') {
    throw new TypeError('A strategy must be a function or an object with draw()');
  }
  if (typeof value.draw !== 'function') {
    throw new TypeError(`Strategy${name ? ` "${name}"` : ''} is missing a draw() method`);
  }
  assertName('Strategy', name);
  for (const key of LIFECYCLE_KEYS) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'function') {
      throw new TypeError(`Strategy "${name}": ${key} must be a method`);
    }
  }
  return { name, implementation: value };
}

/**
 * Create one atomic staging transaction.
 *
 * `nameOf` resolves an already-captured binding (`laserFan` -> "laserFan"). Values
 * without a binding receive a scene-local identity when `defineScene()` visits them.
 * Objects do not carry a second name property.
 */
export function createTransaction(source = '', { nameOf = () => null } = {}) {
  /** @type {Map<string, {definition: Function | object, source: string}>} */
  const stagedStrategies = new Map();
  /** Objects mentioned by scenes/commands; the evaluator stages them only if needed. */
  const referencedStrategies = new Map();
  /** Captured JavaScript bindings committed with the transaction. */
  const bindingUpdates = new Map();
  /** @type {Array<{type: string, [k: string]: any}>} */
  const operations = [];

  const resolve = (value, suggestedName) =>
    validateStrategy(value, suggestedName ?? nameOf(value));

  function stageStrategy(value, strategySource = source, suggestedName) {
    const { name, implementation } = resolve(value, suggestedName);
    stagedStrategies.set(name, { definition: implementation, source: strategySource });
    return name;
  }

  function referenceStrategy(value, suggestedName, strategySource = source) {
    const { name, implementation } = resolve(value, suggestedName);
    referencedStrategies.set(name, { definition: implementation, source: strategySource });
    return name;
  }

  function normalizeSceneEntry(sceneName, path, entry, localNameOf = nameOf, sceneSource = source) {
    if (Array.isArray(entry)) {
      return {
        group: entry.map((child, index) =>
          normalizeSceneEntry(sceneName, [...path, index], child, localNameOf, sceneSource)),
      };
    }
    const boundName = localNameOf(entry);
    const name = referenceStrategy(
      entry,
      boundName ?? inlineStrategyName(sceneName, path),
      boundName ? source : sceneSource,
    );
    return { strategy: name };
  }

  /** Called by the evaluator when it captures `const scene = [laserFan, plasma]`. */
  function defineScene(name, entries, localNameOf = nameOf, sceneSource = source) {
    assertName('Scene', name);
    if (!Array.isArray(entries)) throw new TypeError(`Scene "${name}" must be an array`);
    operations.push({
      type: 'scene',
      name,
      entries: entries.map((entry, index) =>
        normalizeSceneEntry(name, [index], entry, localNameOf, sceneSource)),
    });
    return name;
  }

  function commandTarget(value, command) {
    if (typeof value === 'string') {
      throw new TypeError(`${command}() takes a strategy value, not a strategy name`);
    }
    return value;
  }

  function declareControl(name, value, options = {}) {
    assertName('Control', name);
    if (typeof value !== 'number' && typeof value !== 'boolean' && typeof value !== 'string') {
      throw new TypeError(`control("${name}", ...) value must be a number, boolean, or string`);
    }
    operations.push({ type: 'control', name, value, options });
    return name;
  }

  const api = {
    ShaderChain,
    StreamRoom,

    activate(scene) {
      if (typeof scene === 'string') {
        throw new TypeError('activate() takes a scene array, not a scene name');
      }
      if (!Array.isArray(scene)) throw new TypeError('activate() needs a scene array');
      operations.push({ type: 'activate', target: scene });
      return scene;
    },

    reset(strategy) {
      operations.push({ type: 'reset', target: commandTarget(strategy, 'reset') });
      return strategy;
    },

    control: declareControl,
    // Do not advertise this alias in the editor or documentation; it only keeps
    // already-saved performances recoverable.
    param: declareControl,
  };

  /** Resolve command objects after the evaluator has captured same-buffer bindings. */
  function resolveCommandTargets(localNameOf = nameOf) {
    for (const op of operations) {
      if (!Object.hasOwn(op, 'target')) continue;
      if (op.type === 'activate') {
        op.name = localNameOf(op.target);
        assertName('Scene', op.name);
        delete op.target;
        continue;
      }
      op.name = referenceStrategy(op.target, localNameOf(op.target));
      delete op.target;
    }
  }

  return {
    api,
    stagedStrategies,
    referencedStrategies,
    bindingUpdates,
    operations,
    stageStrategy,
    defineScene,
    resolveCommandTargets,
    args: () => LIVE_API_NAMES.map((key) => api[key]),
    isEmpty: () =>
      stagedStrategies.size === 0 &&
      bindingUpdates.size === 0 &&
      operations.length === 0,
  };
}
