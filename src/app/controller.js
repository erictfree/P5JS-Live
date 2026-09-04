// Application controller — the boundary between the runtime model and DOM views.
//
// Views receive immutable snapshots and dispatch named actions. They never receive the
// registry, state store, evaluator, audio engine, host loop, or authored objects themselves.

import { findCells, sceneMemberNames } from '../language/sourceBlocks.js';

const LIFECYCLE_METHODS = ['state', 'enter', 'draw', 'beat', 'exit', 'dispose'];
const FUNCTION_BUILT_INS = new Set(['length', 'name', 'arguments', 'caller', 'prototype']);

/** A short, bounded rendering of configuration data for the strategy reference UI. */
function formatValue(value, depth = 0) {
  if (value === null) return 'null';
  if (typeof value === 'string') {
    const result = JSON.stringify(value.length > 48 ? `${value.slice(0, 47)}…` : value);
    return result;
  }
  if (['number', 'boolean', 'bigint', 'undefined'].includes(typeof value)) return String(value);
  if (typeof value === 'symbol') return value.description ? `Symbol(${value.description})` : 'Symbol()';
  if (typeof value === 'function') return '[function]';
  if (depth >= 1) return Array.isArray(value) ? '[…]' : '{…}';

  try {
    if (Array.isArray(value)) {
      const shown = value.slice(0, 6).map((entry) => formatValue(entry, depth + 1));
      if (value.length > shown.length) shown.push('…');
      return `[${shown.join(', ')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype === Object.prototype || prototype === null) {
      const descriptors = Object.entries(Object.getOwnPropertyDescriptors(value)).slice(0, 5);
      const shown = descriptors.map(([name, descriptor]) =>
        'value' in descriptor
          ? `${name}: ${formatValue(descriptor.value, depth + 1)}`
          : `${name}: [getter]`,
      );
      if (Object.keys(value).length > descriptors.length) shown.push('…');
      return `{ ${shown.join(', ')} }`;
    }
  } catch {
    // A proxy may reject reflection. The reference is optional and must never break
    // the runtime snapshot when an authored object does something unusual.
  }
  return `[${constructorName(value)}]`;
}

function methodSignature(name, method) {
  try {
    const source = Function.prototype.toString.call(method);
    const match = source.match(/^[^(]*\(([^)]*)\)/s);
    if (match) return `${name}(${match[1].replace(/\s+/g, ' ').trim()})`;
  } catch {
    // Fall through to a useful, data-only label.
  }
  return `${name}(…)`;
}

function constructorName(value) {
  try {
    const prototype = Object.getPrototypeOf(value);
    const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
    return typeof constructor === 'function' && constructor.name ? constructor.name : 'Object';
  } catch {
    return 'Object';
  }
}

/**
 * Convert a live function/object into strings suitable for a view.
 *
 * Descriptors are inspected instead of reading `strategy[name]`: getters are authored
 * code, and merely opening a documentation panel must not run them. Private class
 * fields are correctly absent because JavaScript reflection cannot expose them.
 */
function describeStrategy(definition) {
  if (definition === null || (typeof definition !== 'function' && typeof definition !== 'object')) {
    return { kind: 'unknown', className: null, properties: [], methods: [], lifecycle: [] };
  }

  try {
    const prototype = Object.getPrototypeOf(definition);
    const isFunction = typeof definition === 'function';
    const isClassInstance =
      !isFunction && prototype !== null && prototype !== Object.prototype;
    const className = isClassInstance ? constructorName(definition) : null;
    const properties = [];
    const methods = [];
    const lifecycle = [];
    const seen = new Set();

    const inspect = (target, ownFunction = false) => {
      const descriptors = Object.getOwnPropertyDescriptors(target);
      for (const [name, descriptor] of Object.entries(descriptors)) {
        if (name === 'constructor' || seen.has(name)) continue;
        if (ownFunction && FUNCTION_BUILT_INS.has(name)) continue;
        seen.add(name);

        if ('value' in descriptor && typeof descriptor.value === 'function') {
          const signature = methodSignature(name, descriptor.value);
          (LIFECYCLE_METHODS.includes(name) ? lifecycle : methods).push(signature);
        } else if (!('value' in descriptor)) {
          properties.push({ name, value: descriptor.get ? '[getter]' : '[setter]' });
        } else {
          properties.push({ name, value: formatValue(descriptor.value) });
        }
      }
    };

    inspect(definition, isFunction);
    if (isFunction) {
      // A strategy function itself is its draw lifecycle; custom properties above are
      // still shown because functions are first-class objects in JavaScript.
      lifecycle.unshift(methodSignature('draw', definition));
    } else {
      let current = prototype;
      while (current && current !== Object.prototype) {
        inspect(current);
        current = Object.getPrototypeOf(current);
      }
    }

    const lifecycleOrder = new Map(LIFECYCLE_METHODS.map((name, index) => [name, index]));
    lifecycle.sort(
      (a, b) =>
        (lifecycleOrder.get(a.slice(0, a.indexOf('('))) ?? 99) -
        (lifecycleOrder.get(b.slice(0, b.indexOf('('))) ?? 99),
    );

    return {
      kind: isFunction ? 'function' : isClassInstance ? 'class' : 'object',
      className,
      properties,
      methods,
      lifecycle,
    };
  } catch {
    return { kind: 'unknown', className: null, properties: [], methods: [], lifecycle: [] };
  }
}

export function createAppController({
  registry,
  stateStore,
  diagnostics,
  evaluator,
  audio,
  host,
  network = null,
  controlManager = null,
}) {
  let latestAudio = null;
  let sourceProvider = () => '';
  let safeSnapshot = null;
  const listeners = new Set();

  const notify = () => {
    for (const listener of listeners) listener(snapshot());
  };
  const unsubscribeRegistry = registry.subscribe(notify);
  const unsubscribeDiagnostics = diagnostics.subscribe(notify);
  const unsubscribeNetwork = network?.subscribe?.(notify) ?? (() => {});
  const unsubscribeControls = controlManager?.subscribe?.(notify) ?? (() => {});

  function projectSignature(source = sourceProvider()) {
    return JSON.stringify({
      source,
      strategies: registry.listStrategies().map((record) => ({
        name: record.name,
        version: record.version,
        source: record.source,
        status: record.status,
      })),
      scene: {
        name: registry.activeSceneName(),
        order: registry.activeInstances().map((instance) => instance.strategy),
      },
      params: registry.listParams().map(({ name, value }) => ({ name, value })),
      controls: controlManager?.snapshotMappings?.() ?? [],
    });
  }

  /**
   * An in-memory transaction checkpoint. Unlike a persisted Performance, this keeps
   * the exact live definitions and state objects needed to roll back a failed recall.
   * It is never exposed through the read-only view snapshot or written to storage.
   */
  function captureRuntimeCheckpoint({ createdAt = Date.now() } = {}) {
    const source = sourceProvider();
    return {
      createdAt,
      source,
      registry: registry.snapshotRuntime(),
      states: stateStore.snapshotAll(),
      bindings: evaluator.snapshotBindings(),
      controls: controlManager?.snapshotMappings?.() ?? [],
      signature: projectSignature(source),
    };
  }

  function restoreRuntimeCheckpoint(checkpoint) {
    if (!checkpoint?.registry || typeof checkpoint.source !== 'string') {
      return { ok: false, reason: 'invalid-checkpoint' };
    }
    evaluator.discardPending();
    const preserved = new Set(
      checkpoint.registry.strategies.map((record) => record.definition).filter(Boolean),
    );
    host.reset({ preserveDefinitions: preserved });
    registry.restoreRuntime(checkpoint.registry);
    evaluator.restoreBindings(checkpoint.bindings);
    controlManager?.restoreMappings?.(checkpoint.controls ?? []);
    const stateResult = stateStore.restoreAll(checkpoint.states);
    const missing = [...new Set([...(checkpoint.states?.skipped ?? []), ...stateResult.skipped])];
    return {
      ok: true,
      source: checkpoint.source,
      sceneName: checkpoint.registry.configuration.activeSceneName,
      restored: {
        patches: checkpoint.registry.strategies.length,
        states: stateResult.restored.length,
        params: checkpoint.registry.configuration.params.length,
      },
      skipped: missing,
    };
  }

  function installedSourceNames(source = sourceProvider()) {
    return findCells(source).flatMap((cell) => {
      const match = /^(?:strategy|patch)\s+([A-Za-z_$][\w$]*)$/.exec(cell.label);
      return match ? [match[1]] : [];
    });
  }

  /** Read the ordinary identifier entries from the active scene's source array.
   * This is deliberately a source view, not runtime truth: it lets the UI represent
   * the live-coding interval after an edit and before Cmd/Ctrl+Enter. */
  function sceneSourceOrder(source = sourceProvider(), sceneName = registry.activeSceneName()) {
    if (!sceneName || typeof source !== 'string') return [];
    const cell = findCells(source).find((candidate) => candidate.label === `scene ${sceneName}`);
    return sceneMemberNames(cell?.text ?? source, sceneName);
  }

  function safeStateStatus() {
    if (!safeSnapshot) {
      return { exists: false, createdAt: null, sceneName: null, dirty: false, skipped: [] };
    }
    return {
      exists: true,
      createdAt: safeSnapshot.createdAt,
      sceneName: safeSnapshot.registry.configuration.activeSceneName,
      dirty: projectSignature() !== safeSnapshot.signature,
      skipped: [...safeSnapshot.states.skipped],
      patches: safeSnapshot.registry.strategies.length,
      params: safeSnapshot.registry.configuration.params.length,
    };
  }

  function captureSafeState({ automatic = false, createdAt = Date.now() } = {}) {
    const sceneName = registry.activeSceneName();
    const provisional =
      evaluator.pendingCount() > 0 || registry.listStrategies().some((record) => record.candidate);
    const failedActive = registry
      .activeInstances()
      .some((instance) => registry.getStrategy(instance.strategy)?.status !== 'ok');

    if (sceneName === null) {
      if (!automatic) diagnostics.warn('No active scene to save as a safe state');
      return { ok: false, reason: 'no-scene' };
    }
    if (provisional || failedActive) {
      if (!automatic) {
        diagnostics.warn(
          'Safe state not changed',
          'Wait for the current evaluation to finish successfully, then choose Set safe again.',
        );
      }
      return { ok: false, reason: 'not-confirmed' };
    }

    registry.setSafeScene(sceneName);
    safeSnapshot = captureRuntimeCheckpoint({ createdAt });
    const states = safeSnapshot.states;

    const detail =
      `${safeSnapshot.registry.strategies.length} installed patches, ` +
      `${safeSnapshot.registry.configuration.params.length} parameters` +
      (states.skipped.length ? `; state skipped for ${states.skipped.join(', ')}` : '');
    if (automatic) diagnostics.info(`Initial safe state ready — ${sceneName}`, detail);
    else diagnostics.success(`Safe state saved — ${sceneName}`, detail);
    notify();
    return { ok: true, ...safeStateStatus() };
  }

  function restoreSafeSnapshot() {
    if (!safeSnapshot) {
      diagnostics.warn('No safe state to restore', 'Choose Set safe while a trusted scene is running.');
      return { ok: false, reason: 'missing' };
    }

    const restored = restoreRuntimeCheckpoint(safeSnapshot);
    const missing = restored.skipped;
    const detail = missing.length
      ? `Restored source, scene, patch versions and parameters. State unavailable for: ${missing.join(', ')}.`
      : `Restored ${safeSnapshot.registry.strategies.length} patches, ` +
        `${restored.restored.states} state objects and ` +
        `${safeSnapshot.registry.configuration.params.length} parameters.`;
    diagnostics.success(
      `Safe state restored — ${safeSnapshot.registry.configuration.activeSceneName}`,
      detail,
    );
    notify();
    return {
      ok: true,
      source: safeSnapshot.source,
      sceneName: safeSnapshot.registry.configuration.activeSceneName,
      restored: restored.restored,
      skipped: missing,
    };
  }

  function snapshot() {
    const strategies = registry.listStrategies().map((record) => {
      const copies = registry.activeInstancesOf(record.name).length;
      const running =
        copies > 0 &&
        !record.candidate &&
        record.status === 'ok' &&
        record.runningVersion === record.version;
      return {
        name: record.name,
        version: record.version,
        source: record.source,
        status: record.status,
        installed: true,
        pending: Boolean(record.candidate),
        active: copies > 0,
        running,
        lifecycle: running ? 'running' : copies > 0 ? 'active' : 'installed',
        lastError: record.lastError ? { ...record.lastError } : null,
        copies,
        reference: describeStrategy(record.definition),
      };
    });
    const scene = {
      name: registry.activeSceneName(),
      order: registry.activeInstances().map(({ id, strategy }) => ({ id, strategy })),
      sourceOrder: sceneSourceOrder(),
    };
    const history = registry
      .listStrategies()
      .flatMap((record) =>
        record.history.map(({ version, source, at }) => ({
          name: record.name,
          version,
          source,
          at,
        })),
      )
      .sort((a, b) => b.at - a.at)
      .slice(0, 40);

    return Object.freeze({
      strategies,
      installedPatches: [...new Set([
        ...installedSourceNames(),
        ...strategies.map(({ name }) => name),
      ])],
      scene,
      safeScene: registry.safeSceneName(),
      safeState: safeStateStatus(),
      params: registry.listParams().map((entry) => ({ ...entry })),
      externalControl: controlManager?.snapshot?.() ?? {
        midi: { supported: false, status: 'unsupported', devices: [], lastMessage: null },
        learning: null,
        mappings: [],
      },
      history,
      network: network?.snapshot?.() ?? {
        service: null,
        status: 'offline',
        clientId: null,
        rooms: [],
      },
      diagnostics: diagnostics.list().slice(0, 30).map((entry) => ({ ...entry })),
    });
  }

  function performanceSnapshot() {
    return {
      fps: host.fps(),
      audioStatus: audio.status(),
      audio: latestAudio,
    };
  }

  const actions = Object.freeze({
    resetStrategy(name) {
      const count = stateStore.resetStrategy(name, registry.boundMethod(name, 'state'));
      diagnostics.info(`${name} state reset${count > 1 ? ` (${count} copies)` : ''}`);
      return count;
    },

    revert(name, version) {
      const entry = registry.historyEntry(name, version);
      const result = evaluator.revert(name, version);
      return { ...result, source: entry?.source ?? null };
    },

    setParam(name, value) {
      return registry.setParam(name, value);
    },

    connectMidi() {
      return controlManager?.connectMidi?.() ?? Promise.resolve({ ok: false, reason: 'unsupported' });
    },

    learnMidi(name) {
      return controlManager?.learn?.(name) ?? false;
    },

    removeControlBinding(name) {
      return controlManager?.removeBinding?.(name) ?? false;
    },

    joinNetworkRoom(config) {
      return network?.watchRoom?.(config) ?? null;
    },

    leaveNetworkRoom(name) {
      return network?.unwatchRoom?.(name) ?? false;
    },

    setSafeState() {
      return captureSafeState();
    },

    // Compatibility for code/tests that used the older scene-name-only action.
    setSafeScene() {
      const result = captureSafeState();
      return result.ok ? result.sceneName : null;
    },

    restoreSafeState() {
      return restoreSafeSnapshot();
    },

    panic() {
      const result = restoreSafeSnapshot();
      return result.ok ? result.sceneName : null;
    },
  });

  return {
    actions,
    snapshot,
    safeStateStatus,
    checkpoint() {
      return captureRuntimeCheckpoint();
    },
    restoreCheckpoint(checkpoint) {
      const result = restoreRuntimeCheckpoint(checkpoint);
      if (result.ok) notify();
      return result;
    },
    ensureSafeState() {
      return safeSnapshot ? { ok: true, ...safeStateStatus() } : captureSafeState({ automatic: true });
    },
    setSourceProvider(provider) {
      sourceProvider = typeof provider === 'function' ? provider : () => '';
      notify();
    },
    sourceChanged() {
      notify();
    },
    performanceSnapshot,
    setAudioSnapshot(value) {
      latestAudio = value;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      unsubscribeRegistry();
      unsubscribeDiagnostics();
      unsubscribeNetwork();
      unsubscribeControls();
      listeners.clear();
    },
  };
}
