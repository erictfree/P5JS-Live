// Registry — named strategy implementations and the scenes that compose them.
//
// A scene is an ordered array of stable strategy instances. Re-evaluating a named
// function or object replaces the implementation behind every instance without
// replacing the scene slots or their state. Candidates enter history only after
// surviving a frame.

import { instanceId } from './stateStore.js';

const DEFAULT_HISTORY_LIMIT = 12;
const STRATEGY_METHODS = ['state', 'enter', 'draw', 'beat', 'exit'];

/**
 * @typedef {Function | { state?: Function, draw: Function, enter?: Function, beat?: Function, exit?: Function }} StrategyDefinition
 * @typedef {{ version: number, source: string, definition: StrategyDefinition, at: number }} HistoryEntry
 */

export function createRegistry({ historyLimit = DEFAULT_HISTORY_LIMIT, now = () => Date.now() } = {}) {
  /** @type {Map<string, any>} */
  const strategies = new Map();
  /** @type {Map<string, Array<{id: string, strategy: string}>>} */
  const scenes = new Map();
  /** @type {Map<string, {value: any, type?: 'continuous'|'button'|'choice', mode?: 'momentary'|'toggle', choices?: string[], min?: number, max?: number, step?: number}>} */
  const params = new Map();
  let activeSceneName = null;
  let safeSceneName = null;
  const listeners = new Set();

  function notify() {
    for (const listener of listeners) listener();
  }

  // --- strategies ---------------------------------------------------------------

  function createRecord(name) {
    const record = {
      name,
      version: 0,
      definition: null,
      source: '',
      /** @type {HistoryEntry[]} */
      history: [],
      candidate: null,
      status: 'empty',
      lastError: null,
      runningVersion: null,
    };
    strategies.set(name, record);
    return record;
  }

  function stageStrategy(name, definition, source, stateSnapshot, configurationSnapshot = null) {
    const record = strategies.get(name) ?? createRecord(name);
    record.candidate = {
      previousDefinition: record.definition,
      previousVersion: record.version,
      previousSource: record.source,
      previousStatus: record.status,
      previousRunningVersion: record.runningVersion,
      stateSnapshot,
      configurationSnapshot,
    };
    record.definition = definition;
    record.source = source;
    record.version += 1;
    record.status = 'ok';
    record.lastError = null;
    notify();
    return record;
  }

  function confirmStrategy(name, { running = false } = {}) {
    const record = strategies.get(name);
    if (!record?.candidate) return null;
    record.candidate = null;
    if (running) record.runningVersion = record.version;
    record.history.unshift({
      version: record.version,
      source: record.source,
      definition: record.definition,
      at: now(),
    });
    if (record.history.length > historyLimit) record.history.length = historyLimit;
    notify();
    return record;
  }

  function rollbackStrategy(name, error) {
    const record = strategies.get(name);
    if (!record?.candidate) return null;
    const {
      previousDefinition,
      previousVersion,
      previousSource,
      previousStatus,
      previousRunningVersion,
      stateSnapshot,
      configurationSnapshot,
    } = record.candidate;
    const failedVersion = record.version;
    const failedDefinition = record.definition;
    record.definition = previousDefinition;
    record.version = previousVersion;
    record.source = previousSource;
    record.status = previousDefinition ? previousStatus : 'failed';
    record.runningVersion = previousRunningVersion;
    record.lastError = { message: error?.message ?? String(error), version: failedVersion };
    record.candidate = null;
    notify();
    return {
      record,
      stateSnapshot,
      configurationSnapshot,
      failedDefinition,
      failedVersion,
      restoredVersion: previousVersion,
    };
  }

  function historyEntry(name, version) {
    return strategies.get(name)?.history.find((entry) => entry.version === version) ?? null;
  }

  /** Mark a committed active version as having completed an actual draw. */
  function markRendered(name) {
    const record = strategies.get(name);
    if (!record || record.candidate || record.status !== 'ok') return false;
    if (record.runningVersion === record.version) return false;
    record.runningVersion = record.version;
    notify();
    return true;
  }

  // --- scenes and instances -----------------------------------------------------

  function nextInstanceId(order, strategyName) {
    const taken = new Set(order.map((entry) => entry.id));
    for (let n = 1; ; n++) {
      const id = instanceId(strategyName, n);
      if (!taken.has(id)) return id;
    }
  }

  /** Normalize a strategy name or scene entry into a stable runtime instance. */
  function toInstance(order, entry) {
    const strategyName = typeof entry === 'string' ? entry : entry.strategy;
    const instance = {
      id: nextInstanceId(order, strategyName),
      strategy: strategyName,
    };

    // Delegates are stable and non-enumerable. Each invocation resolves the current
    // implementation and preserves normal object/class `this` semantics.
    const delegates = {};
    for (const method of STRATEGY_METHODS) {
      delegates[method] = (...args) => {
        const implementation = strategies.get(strategyName)?.definition;
        if (method === 'draw' && typeof implementation === 'function') {
          return implementation(...args);
        }
        return implementation?.[method]?.apply(implementation, args);
      };
      Object.defineProperty(instance, method, {
        enumerable: false,
        get: () => {
          const implementation = strategies.get(strategyName)?.definition;
          const exists =
            (method === 'draw' && typeof implementation === 'function') ||
            typeof implementation?.[method] === 'function';
          return exists ? delegates[method] : undefined;
        },
      });
    }
    Object.defineProperty(instance, 'implementation', {
      enumerable: false,
      get: () => strategies.get(strategyName)?.definition,
    });
    return instance;
  }

  function boundMethod(name, method) {
    const implementation = strategies.get(name)?.definition;
    if (method === 'draw' && typeof implementation === 'function') return implementation;
    const fn = implementation?.[method];
    return typeof fn === 'function' ? fn.bind(implementation) : undefined;
  }

  function defineScene(name, entries) {
    const order = [];
    for (const entry of entries) order.push(toInstance(order, entry));
    scenes.set(name, order);
    if (activeSceneName === null) activeSceneName = name;
    notify();
    return order;
  }

  function activate(name) {
    if (!scenes.has(name)) throw new Error(`No scene named "${name}"`);
    activeSceneName = name;
    notify();
    return name;
  }

  function activeInstances() {
    return activeSceneName === null ? [] : (scenes.get(activeSceneName) ?? []);
  }

  function activeOrder() {
    return activeInstances().map((instance) => instance.id);
  }

  function activeStrategies() {
    return activeInstances();
  }

  function activeInstancesOf(strategyName) {
    return activeInstances().filter((instance) => instance.strategy === strategyName);
  }

  // --- safe scene ---------------------------------------------------------------

  function setSafeScene(name = activeSceneName) {
    if (name === null || !scenes.has(name)) return null;
    safeSceneName = name;
    notify();
    return name;
  }

  function panic() {
    return safeSceneName !== null && scenes.has(safeSceneName) ? activate(safeSceneName) : null;
  }

  // --- snapshots ---------------------------------------------------------------

  function snapshotConfiguration() {
    return {
      scenes: [...scenes.entries()].map(([name, order]) => ({
        name,
        entries: order.map((instance) => instance.strategy),
      })),
      activeSceneName,
      safeSceneName,
      params: [...params.entries()].map(([name, entry]) => ({ name, ...entry })),
    };
  }

  function restoreConfiguration(snapshot) {
    if (!snapshot) return false;
    scenes.clear();
    for (const scene of snapshot.scenes ?? []) {
      const order = [];
      for (const strategyName of scene.entries ?? []) order.push(toInstance(order, strategyName));
      scenes.set(scene.name, order);
    }
    activeSceneName =
      snapshot.activeSceneName !== null && scenes.has(snapshot.activeSceneName)
        ? snapshot.activeSceneName
        : null;
    safeSceneName =
      snapshot.safeSceneName !== null && scenes.has(snapshot.safeSceneName)
        ? snapshot.safeSceneName
        : null;
    params.clear();
    for (const entry of snapshot.params ?? []) {
      const { name, ...value } = entry;
      params.set(name, { ...value });
    }
    notify();
    return true;
  }

  /**
   * A safe-state snapshot retains the exact confirmed objects as well as their source.
   * It is intentionally in-memory: functions and class instances cannot be faithfully
   * serialized, and recovery must not re-run broken editor source first.
   */
  function snapshotRuntime() {
    return {
      strategies: [...strategies.values()].map((record) => ({
        name: record.name,
        version: record.version,
        definition: record.definition,
        source: record.source,
        history: record.history.map((entry) => ({ ...entry })),
        status: record.status,
        lastError: record.lastError ? { ...record.lastError } : null,
        runningVersion: record.runningVersion,
      })),
      configuration: snapshotConfiguration(),
    };
  }

  function restoreRuntime(snapshot) {
    if (!snapshot) return false;
    strategies.clear();
    for (const saved of snapshot.strategies ?? []) {
      strategies.set(saved.name, {
        name: saved.name,
        version: saved.version,
        definition: saved.definition,
        source: saved.source,
        history: (saved.history ?? []).map((entry) => ({ ...entry })),
        candidate: null,
        status: saved.status,
        lastError: saved.lastError ? { ...saved.lastError } : null,
        runningVersion: saved.runningVersion ?? null,
        errorSignature: null,
        errorFrames: 0,
      });
    }
    restoreConfiguration(snapshot.configuration);
    return true;
  }

  // --- params -------------------------------------------------------------------

  function declareParam(name, value, options = {}) {
    const existing = params.get(name);
    params.set(name, { ...options, value: existing ? existing.value : value, default: value });
    notify();
    return params.get(name);
  }

  function setParam(name, value) {
    const entry = params.get(name);
    if (!entry) return null;
    entry.value = value;
    notify();
    return entry;
  }

  /** Apply one input-frame of controller values with a single view notification. */
  function setParams(values) {
    let changed = 0;
    for (const [name, value] of values ?? []) {
      const entry = params.get(name);
      if (!entry || Object.is(entry.value, value)) continue;
      entry.value = value;
      changed += 1;
    }
    if (changed) notify();
    return changed;
  }

  function paramValues(target = {}) {
    for (const key of Object.keys(target)) delete target[key];
    for (const [name, entry] of params) target[name] = entry.value;
    return target;
  }

  function reset() {
    strategies.clear();
    scenes.clear();
    params.clear();
    activeSceneName = null;
    safeSceneName = null;
    notify();
  }

  return {
    reset,
    stageStrategy,
    confirmStrategy,
    rollbackStrategy,
    markRendered,
    historyEntry,
    getStrategy: (name) => strategies.get(name) ?? null,
    hasStrategy: (name) => strategies.has(name),
    listStrategies: () => [...strategies.values()],
    strategyNames: () => [...strategies.keys()],
    defineScene,
    activate,
    activeOrder,
    activeInstances,
    activeStrategies,
    activeInstancesOf,
    boundMethod,
    listScenes: () => [...scenes.entries()].map(([name, order]) => ({ name, order: [...order] })),
    activeSceneName: () => activeSceneName,
    setSafeScene,
    panic,
    safeSceneName: () => safeSceneName,
    snapshotConfiguration,
    restoreConfiguration,
    snapshotRuntime,
    restoreRuntime,
    declareParam,
    setParam,
    setParams,
    paramValues,
    listParams: () => [...params.entries()].map(([name, entry]) => ({ name, ...entry })),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
