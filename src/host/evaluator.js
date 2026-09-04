// Evaluator — atomic live replacement for ordinary strategy functions and objects.
//
// A patch author writes normal JavaScript bindings, not registration calls:
//
//   class NeonTunnel { draw({ audio }) { ... } }
//   const neonTunnel = new NeonTunnel();
//   const scene = [checkerZoom, neonTunnel, plasma];
//
// Top-level class/function/value bindings are retained between block evaluations.
// Objects with draw() become replaceable strategies immediately. Functions become
// strategies contextually when a scene uses them. Arrays made from
// strategies become scenes. All registry changes still land only at a frame boundary.

import { createTransaction, LIVE_API_NAMES } from './liveApi.js';
import { strategyOf } from './stateStore.js';
import { findCells, findStatements } from '../language/sourceBlocks.js';

const TARGETED_OPS = new Set(['reset']);
const DECLARATION = /^\s*(?:const|let|var|class|function)\s+([A-Za-z_$][\w$]*)\b/;

export function createEvaluator({ registry, stateStore, diagnostics }) {
  /** @type {Array<{transaction: object, label: string}>} */
  const queue = [];
  /** Successful top-level declarations available to later block evaluations. */
  const bindings = new Map();
  /** Reverse lookup from first-class values to their JavaScript binding names. */
  let namesByObject = new WeakMap();

  function knownNameOf(value) {
    if ((typeof value === 'object' && value !== null) || typeof value === 'function') {
      const bound = namesByObject.get(value);
      if (bound) return bound;
    }
    for (const record of registry.listStrategies()) {
      if (record.definition === value) return record.name;
    }
    return null;
  }

  /** Compile and stage one block or the entire editor buffer. */
  function evaluate(source, { label = 'block' } = {}) {
    if (typeof source !== 'string' || source.trim() === '') {
      return { ok: false, phase: 'empty', error: new Error('Nothing to evaluate') };
    }

    // Older builds could append the same library cell twice before the first install
    // reached the frame boundary. Keep the newest copy at the original cell position:
    // this removes duplicate class/const declarations without changing scene ordering.
    const normalized = collapseDuplicatePatchCells(source);
    const executableSource = normalized.source;
    if (normalized.names.length) {
      diagnostics?.warn(
        `Duplicate patch source repaired: ${normalized.names.join(', ')}`,
        'The newest cell was evaluated as the replacement. Remove the older duplicate from the editor when convenient.',
      );
    }

    const declarations = declarationEntries(executableSource);
    const declaredNames = new Set(declarations.map((entry) => entry.name));
    const availableBindings = [...bindings.entries()].filter(
      ([name]) => !declaredNames.has(name) && !LIVE_API_NAMES.includes(name),
    );
    const capture = declarations.length
      ? `\n;return {${declarations.map(({ name }) => `${JSON.stringify(name)}:${name}`).join(',')}};`
      : '';

    let compiled;
    try {
      compiled = new Function(
        ...LIVE_API_NAMES,
        ...availableBindings.map(([name]) => name),
        `${executableSource}${capture}`,
      );
    } catch (error) {
      diagnostics?.error(`Syntax error — ${label} not applied`, formatError(error, executableSource));
      return { ok: false, phase: 'syntax', error };
    }

    const transaction = createTransaction(executableSource, { nameOf: knownNameOf });
    let captured = {};
    try {
      captured =
        compiled(
          ...transaction.args(),
          ...availableBindings.map(([, value]) => value),
        ) ?? {};
      const localNameOf = captureDeclarations(transaction, declarations, captured);
      transaction.resolveCommandTargets(localNameOf);
      promoteNewReferences(transaction);
    } catch (error) {
      diagnostics?.error(`Evaluation error — ${label} not applied`, formatError(error, executableSource));
      return { ok: false, phase: 'evaluation', error };
    }

    if (transaction.isEmpty()) {
      // Ordinary JavaScript calls such as `laserFan.addBeams(2)` may intentionally mutate
      // a live object without producing a registry operation. We cannot distinguish
      // that useful side effect from a pure helper expression, so report successful
      // execution without pretending the registry had to change.
      diagnostics?.success(`${label} evaluated`);
      return { ok: true, phase: 'executed', staged: [], operations: 0 };
    }

    const validationError = validateTargets(transaction);
    if (validationError) {
      diagnostics?.error(`Evaluation error — ${label} not applied`, validationError.message);
      return { ok: false, phase: 'evaluation', error: validationError };
    }

    for (const [name, staged] of transaction.stagedStrategies) {
      staged.stateSnapshot = stateStore.snapshotStrategy(name);
    }
    // A data-only receipt lets the performer UI distinguish queued, applied and
    // discarded work without treating successful compilation as a live change.
    const completion = { status: 'queued', versions: {} };
    queue.push({ transaction, label, completion });

    return {
      ok: true,
      phase: 'queued',
      staged: [...transaction.stagedStrategies.keys()],
      operations: transaction.operations.length,
      completion,
    };
  }

  /** Capture normal JavaScript declarations as environment, strategies, or scenes. */
  function captureDeclarations(transaction, declarations, captured) {
    const localNames = new WeakMap();

    for (const { name } of declarations) {
      const value = captured[name];
      transaction.bindingUpdates.set(name, value);
      if ((typeof value === 'object' && value !== null) || typeof value === 'function') {
        localNames.set(value, name);
      }
    }

    const localNameOf = (value) =>
      ((typeof value === 'object' && value !== null) || typeof value === 'function'
        ? localNames.get(value)
        : null) ?? knownNameOf(value);

    // Objects are staged before arrays are interpreted, so the scene validation sees
    // everything declared in the same buffer as already on its way into the registry.
    for (const declaration of declarations) {
      const value = captured[declaration.name];
      const explicitStrategyName = /^(?:strategy|patch)\s+([A-Za-z_$][\w$]*)$/.exec(
        declaration.cellLabel ?? '',
      )?.[1];
      if (
        isObjectStrategy(value) ||
        registry.hasStrategy(declaration.name) ||
        (typeof value === 'function' && explicitStrategyName === declaration.name)
      ) {
        transaction.stageStrategy(value, declaration.source, declaration.name);
      }
    }

    for (const declaration of declarations) {
      const value = captured[declaration.name];
      const isActivationTarget = transaction.operations.some(
        (op) => op.type === 'activate' && op.target === value,
      );
      const isExistingScene = registry.listScenes().some((scene) => scene.name === declaration.name);
      if (
        isStrategyArray(value) ||
        (Array.isArray(value) && (isActivationTarget || isExistingScene))
      ) {
        transaction.defineScene(declaration.name, value, localNameOf, declaration.source);
      }
    }

    // A function mentioned by a scene becomes a strategy at that point.
    // When it was declared in this evaluation, keep its cell as its history source.
    const declarationsByName = new Map(declarations.map((entry) => [entry.name, entry]));
    for (const [name, entry] of transaction.referencedStrategies) {
      const declaration = declarationsByName.get(name);
      if (declaration) entry.source = declaration.source;
    }
    return localNameOf;
  }

  /** References only stage a version when they are not already the live object. */
  function promoteNewReferences(transaction) {
    for (const [name, entry] of transaction.referencedStrategies) {
      if (transaction.stagedStrategies.has(name)) continue;
      if (registry.getStrategy(name)?.definition === entry.definition) continue;
      transaction.stagedStrategies.set(name, entry);
    }
  }

  function validateTargets(transaction) {
    const strategyNames = new Set([
      ...registry.strategyNames(),
      ...transaction.stagedStrategies.keys(),
    ]);
    const sceneNames = new Set([
      ...registry.listScenes().map((scene) => scene.name),
      ...transaction.operations.filter((op) => op.type === 'scene').map((op) => op.name),
    ]);

    for (const op of transaction.operations) {
      if (op.type === 'scene') {
        const missing = flattenSceneEntries(op.entries)
          .map((entry) => entry.strategy)
          .filter((name) => !strategyNames.has(name));
        if (missing.length) {
          return new Error(`Scene "${op.name}" contains an undefined strategy: ${missing.join(', ')}`);
        }
      } else if (op.type === 'activate') {
        if (!sceneNames.has(op.name)) return new Error(`No scene named "${op.name}"`);
      } else if (TARGETED_OPS.has(op.type)) {
        const base = strategyOf(op.name);
        if (!strategyNames.has(base)) return new Error(`No strategy named "${base}"`);
      }
    }
    return null;
  }

  /** Apply queued object/binding/scene changes at the frame boundary. */
  function applyPending() {
    if (queue.length === 0) return [];
    const staged = [];

    for (const { transaction, label, completion } of queue) {
      const configurationSnapshot = registry.snapshotConfiguration();
      applyBindingUpdates(transaction.bindingUpdates);
      for (const [name, entry] of transaction.stagedStrategies) {
        const record = registry.stageStrategy(
          name,
          entry.definition,
          entry.source,
          entry.stateSnapshot,
          configurationSnapshot,
        );
        completion.versions[name] = record.version;
        const ids = registry.activeInstancesOf(name).map((instance) => instance.id);
        for (const id of ids.length ? ids : [name]) {
          stateStore.ensure(id, registry.boundMethod(name, 'state'));
        }
        staged.push(name);
      }

      // Scene arrays may be captured after activate() ran inside the JavaScript function.
      // Definitions therefore apply first, then commands run in their written order.
      for (const op of transaction.operations.filter((op) => op.type === 'scene')) {
        applyOperation(op, label);
      }
      for (const op of transaction.operations.filter((op) => op.type !== 'scene')) {
        applyOperation(op, label);
      }
      completion.status = 'applied';
    }

    queue.length = 0;
    return staged;
  }

  function applyBindingUpdates(updates) {
    for (const [name, value] of updates) {
      const previous = bindings.get(name);
      if ((typeof previous === 'object' && previous !== null) || typeof previous === 'function') {
        namesByObject.delete(previous);
      }
      bindings.set(name, value);
      if ((typeof value === 'object' && value !== null) || typeof value === 'function') {
        namesByObject.set(value, name);
      }
    }
  }

  function applyOperation(op, label) {
    switch (op.type) {
      case 'scene':
        registry.defineScene(op.name, op.entries);
        for (const instance of registry.activeInstances()) {
          stateStore.ensure(instance.id, registry.boundMethod(instance.strategy, 'state'));
        }
        break;
      case 'activate':
        registry.activate(op.name);
        break;
      case 'reset': {
        const count = stateStore.resetStrategy(op.name, registry.boundMethod(op.name, 'state'));
        diagnostics?.info(`${op.name} state reset${count > 1 ? ` (${count} copies)` : ''}`);
        break;
      }
      case 'control':
        registry.declareParam(op.name, op.value, op.options);
        break;
      default:
        diagnostics?.warn(`Unknown operation "${op.type}" in ${label}`);
    }
  }

  /** Reversion swaps the exact historical object back in as a new candidate. */
  function revert(name, version) {
    const entry = registry.historyEntry(name, version);
    if (!entry) {
      diagnostics?.warn(`No stored version ${version} of ${name}`);
      return { ok: false, phase: 'history' };
    }
    const transaction = createTransaction(entry.source, { nameOf: knownNameOf });
    transaction.stagedStrategies.set(name, {
      definition: entry.definition,
      source: entry.source,
      stateSnapshot: stateStore.snapshotStrategy(name),
    });
    // Scene-local identities such as `scene[1]` are registry identities, not hidden
    // JavaScript variables. Their stored source is the scene cell, which the editor
    // restores; only an actual captured binding should be changed here.
    if (bindings.has(name)) transaction.bindingUpdates.set(name, entry.definition);
    const completion = { status: 'queued', versions: {} };
    queue.push({ transaction, label: `${name} v${version}`, completion });
    return { ok: true, phase: 'queued', staged: [name], completion };
  }

  function discardPending() {
    const dropped = queue.length;
    for (const { completion } of queue) completion.status = 'discarded';
    queue.length = 0;
    return dropped;
  }

  function clearBindings() {
    bindings.clear();
    namesByObject = new WeakMap();
  }

  function snapshotBindings() {
    return new Map(bindings);
  }

  function restoreBindings(snapshot) {
    clearBindings();
    for (const [name, value] of snapshot ?? []) restoreBinding(name, value);
  }

  /** Keep the live JavaScript binding aligned when a candidate object rolls back. */
  function restoreBinding(name, value) {
    const current = bindings.get(name);
    if ((typeof current === 'object' && current !== null) || typeof current === 'function') {
      namesByObject.delete(current);
    }
    if (value === null || value === undefined) bindings.delete(name);
    else {
      bindings.set(name, value);
      if ((typeof value === 'object' && value !== null) || typeof value === 'function') {
        namesByObject.set(value, name);
      }
    }
  }

  return {
    evaluate,
    applyPending,
    discardPending,
    clearBindings,
    restoreBinding,
    snapshotBindings,
    restoreBindings,
    revert,
    hasBinding: (name) => bindings.has(name),
    pendingCount: () => queue.length,
    binding: (name) => bindings.get(name),
  };
}

/**
 * Collapse duplicate explicit patch cells before JavaScript compilation.
 *
 * Re-evaluating one class cell is already safe because the previous class binding is
 * excluded from the generated function parameters. The observed `Cannot declare a
 * class twice` error came from two copies of the entire installed cell in the buffer.
 * This repair makes that legacy source mean what the user intended: the newest cell
 * replaces the earlier definition.
 */
function collapseDuplicatePatchCells(source) {
  const groups = new Map();
  for (const cell of findCells(source)) {
    const match = /^(?:strategy|patch)\s+([A-Za-z_$][\w$]*)$/.exec(cell.label);
    if (!match) continue;
    const group = groups.get(match[1]) ?? [];
    group.push(cell);
    groups.set(match[1], group);
  }

  const replacements = new Map();
  const names = [];
  for (const [name, cells] of groups) {
    if (cells.length < 2) continue;
    names.push(name);
    const newest = cells.at(-1).text;
    replacements.set(cells[0].start, newest);
    for (const cell of cells.slice(1)) {
      replacements.set(cell.start, '\n'.repeat(Math.max(1, cell.text.split('\n').length - 1)));
    }
  }
  if (replacements.size === 0) return { source, names };

  let result = '';
  let cursor = 0;
  for (const cell of findCells(source)) {
    if (!replacements.has(cell.start)) continue;
    result += source.slice(cursor, cell.start);
    result += replacements.get(cell.start);
    cursor = cell.end;
  }
  result += source.slice(cursor);
  return { source: result, names };
}

function isObjectStrategy(value) {
  return value !== null && typeof value === 'object' && typeof value.draw === 'function';
}

function canBeStrategy(value) {
  return typeof value === 'function' || isObjectStrategy(value);
}

function isStrategyArray(value) {
  const isSceneEntry = (entry) =>
    canBeStrategy(entry) || (Array.isArray(entry) && entry.every(isSceneEntry));
  return Array.isArray(value) && value.length > 0 && value.every(isSceneEntry);
}

function flattenSceneEntries(entries, result = []) {
  for (const entry of entries ?? []) {
    if (Array.isArray(entry?.group)) flattenSceneEntries(entry.group, result);
    else result.push(entry);
  }
  return result;
}

function declarationEntries(source) {
  const seen = new Set();
  const entries = [];
  const cells = findCells(source);
  for (const block of findStatements(source)) {
    const match = DECLARATION.exec(block.text);
    if (!match || seen.has(match[1])) continue;
    seen.add(match[1]);
    const cell = cells.find((candidate) => block.start >= candidate.start && block.end <= candidate.end);
    entries.push({
      name: match[1],
      text: block.text,
      source: cell?.text ?? block.text,
      cellLabel: cell?.label ?? null,
    });
  }
  return entries;
}

function formatError(error, source) {
  const line = lineFromStack(error, source);
  const where = line ? ` (line ${line})` : '';
  return `${error.name}: ${error.message}${where}`;
}

function lineFromStack(error, source) {
  const match = /<anonymous>:(\d+):\d+/.exec(error.stack ?? '');
  if (!match) return null;
  const line = Number(match[1]) - 2;
  const total = source.split('\n').length;
  return line >= 1 && line <= total ? line : null;
}
