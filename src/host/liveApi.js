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
// strategy; a function becomes one when it is placed in a scene. Arrays describe
// layers, and .draw() selects a named array as the scene. Anonymous entries
// receive path-based identities such as `scene[1][0]`. Composition changes only by
// editing that array.

import { ShaderChain } from '../shaders/shaderChain.js';
import { StreamRoom } from '../network/streamRoom.js';
import { isLayerArray, assertPatch } from './layer.js';
import { SIGNAL_NAMES } from '../signals/signals.js';
import { createCodeViewFactory } from '../visuals/codeView.js';

export const LIVE_API_NAMES = [
  'reset',
  'control',
  'modulation',
  'ShaderChain',
  'StreamRoom',
  'codeView',
  ...SIGNAL_NAMES,
];

const LIFECYCLE_KEYS = ['state', 'enter', 'draw', 'onset', 'exit', 'dispose'];

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
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
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
export function createTransaction(source = '', { nameOf = () => null, definitionOf = () => null, signalApi = {}, codeView = createCodeViewFactory() } = {}) {
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

  function normalizeImageInputs(sceneName, path, definition, localNameOf, sceneSource, ancestors) {
    if (!(definition instanceof ShaderChain)) return [];
    assertPatch(definition, new Set(), inlineStrategyName(sceneName, path));
    return definition.imageInputs.map(({ uniform, source: image }, index) => ({
      uniform,
      layer: normalizeSceneEntry(sceneName, [...path, `input${index}`], image, localNameOf, sceneSource, ancestors),
    }));
  }

  function normalizeSceneEntry(sceneName, path, entry, localNameOf = nameOf, sceneSource = source, ancestors = new Set()) {
    if (Array.isArray(entry)) {
      return {
        muted: isLayerArray(entry) && entry.muted === true,
        sourceName: localNameOf(entry),
        group: entry.map((child, index) =>
          normalizeSceneEntry(sceneName, [...path, index], child, localNameOf, sceneSource, ancestors)),
      };
    }
    const boundName = localNameOf(entry);
    const definition = stagedStrategies.get(boundName)?.definition ?? definitionOf(boundName) ?? entry;
    const name = referenceStrategy(
      definition,
      boundName ?? inlineStrategyName(sceneName, path),
      boundName ? source : sceneSource,
    );
    if (ancestors.has(name)) throw new TypeError(`Cyclic image input involving "${name}"`);
    const next = new Set(ancestors).add(name);
    const inputs = normalizeImageInputs(name, [], definition, localNameOf, sceneSource, next);
    return inputs.length ? { strategy: name, inputs } : { strategy: name };
  }

  /** Called by the evaluator when it captures `const scene = [laserFan, plasma]`. */
  function defineScene(name, entries, localNameOf = nameOf, sceneSource = source) {
    assertName('Scene', name);
    if (!Array.isArray(entries)) throw new TypeError(`Scene "${name}" must be an array`);
    assertPatch(entries, new Set(), name);
    operations.push({
      type: 'scene',
      name,
      source: sceneSource,
      entries: (isLayerArray(entries) && Object.hasOwn(entries, 'muted') ? [entries] : entries).map((entry, index) =>
        normalizeSceneEntry(name, [index], entry, localNameOf, sceneSource)),
    });
    return name;
  }

  function refreshSceneInputs(scenes, localNameOf = nameOf) {
    // Validate even an installed shader that has not yet been placed in a scene.
    for (const [name, entry] of stagedStrategies) {
      normalizeImageInputs(name, [], entry.definition, localNameOf, entry.source, new Set([name]));
    }
    const existing = new Set(operations.filter(op => op.type === 'scene').map(op => op.name));
    for (const scene of scenes) {
      if (existing.has(scene.name)) continue;
      let changed = false;
      const visit = (entry, path, ancestors = new Set()) => {
        if (Array.isArray(entry?.group)) return {
          ...entry, group: entry.group.map((child, index) => visit(child, [...path, index], ancestors)),
        };
        const name = typeof entry === 'string' ? entry : entry.strategy;
        if (ancestors.has(name)) throw new TypeError(`Cyclic image input involving "${name}"`);
        const next = new Set(ancestors).add(name);
        const staged = stagedStrategies.get(name);
        if (staged && ((staged.definition instanceof ShaderChain && staged.definition.imageInputs.length) || entry?.inputs?.length)) {
          changed = true;
          const inputs = normalizeImageInputs(name, [], staged.definition, localNameOf, scene.source, next);
          return inputs.length ? { strategy: name, inputs } : { strategy: name };
        }
        if (!entry?.inputs?.length) return entry;
        return { ...entry, inputs: entry.inputs.map((input, index) => ({
          uniform: input.uniform, layer: visit(input.layer, [...path, `input${index}`], next),
        })) };
      };
      const entries = scene.entries.map((entry, index) => visit(entry, [index]));
      if (changed) operations.push({ type: 'scene', name: scene.name, source: scene.source, entries });
    }
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

  function declareModulation(name, options = {}) {
    assertName('Modulation', name);
    if (options !== null && typeof options !== 'object') {
      throw new TypeError(`modulation("${name}", ...) options must be an object`);
    }
    operations.push({ type: 'modulation', name, options: { ...(options ?? {}) } });
    return name;
  }

  const api = {
    ...signalApi,
    ShaderChain,
    StreamRoom,
    codeView,

    reset(strategy) {
      operations.push({ type: 'reset', target: commandTarget(strategy, 'reset') });
      return strategy;
    },

    control: declareControl,
    modulation: declareModulation,
  };

  // Invoked only by the array draw command during evaluation; never injected as
  // a second authoring interface.
  function selectScene(scene) {
    operations.push({ type: 'activate', target: scene });
    return scene;
  }

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
    source,
    api,
    selectScene,
    stagedStrategies,
    referencedStrategies,
    bindingUpdates,
    operations,
    stageStrategy,
    defineScene,
    resolveCommandTargets,
    refreshSceneInputs,
    args: () => LIVE_API_NAMES.map((key) => api[key]),
    isEmpty: () =>
      stagedStrategies.size === 0 &&
      bindingUpdates.size === 0 &&
      operations.length === 0,
  };
}
