// State store — state belongs to the strategy INSTANCE, not to a function body.
//
// State has an identity. When a
// performer re-evaluates `const pixelRain = ...`, the implementation object is
// replaced. The trail array is not. It is found again by identity.
//
// Identity is the instance id, because a scene may hold the same strategy more than once.
// The first named instance uses its binding name; an anonymous entry uses a scene slot
// such as `scene[1]`. Thus ordinary named code still follows the "state belongs to the
// name" model while inline code follows "state belongs to this array position."
// Extra copies are `pixelRain#2`, `pixelRain#3`, and each gets its own state, because
// two rain fields sharing one drop array would be one field drawn twice.
//
// Strategy state should be numbers, strings, booleans, arrays,
// plain objects — structured-clone-compatible values. p5.Image, media elements, and
// analyzers are host resources and do not belong here. We enforce nothing, but a value
// that cannot be cloned loses its rollback snapshot, and we say so out loud.

/** `pixelRain#2` -> `pixelRain`. Strategy names may not contain "#". */
export const strategyOf = (instanceId) => instanceId.split('#')[0];

/** The id of the nth instance; the first is the bare strategy name. */
export const instanceId = (strategy, n) => (n <= 1 ? strategy : `${strategy}#${n}`);

export function createStateStore({ diagnostics } = {}) {
  /** @type {Map<string, object>} keyed by instance id */
  const states = new Map();

  /**
   * Get the state for a name, creating it once from the strategy's `state()` factory.
   * Re-evaluating a strategy does NOT re-run the factory — that is what makes state
   * survive a code replacement.
   */
  function ensure(name, factory) {
    if (!states.has(name)) {
      states.set(name, buildInitialState(name, factory));
    }
    return states.get(name);
  }

  function buildInitialState(name, factory) {
    if (typeof factory !== 'function') return {};
    try {
      const value = factory();
      if (value === null || typeof value !== 'object') {
        diagnostics?.warn(
          `${name}: state() should return an object`,
          `Got ${value === null ? 'null' : typeof value}. Using an empty object instead.`,
        );
        return {};
      }
      return value;
    } catch (err) {
      diagnostics?.warn(`${name}: state() threw`, err.message);
      return {};
    }
  }

  /**
   * Copy the current state so it can be put back if a candidate version fails on its
   * first frame. Returns `null` when the state cannot be cloned — the caller
   * treats that as "code can roll back, state cannot".
   */
  function snapshot(name) {
    const current = states.get(name);
    if (current === undefined) return undefined;
    try {
      return structuredClone(current);
    } catch (err) {
      diagnostics?.warn(
        `${name}: state could not be snapshotted`,
        `${err.message} — strategy state should be JSON-compatible. ` +
          `Code will still roll back, but this strategy's state will not.`,
      );
      return null;
    }
  }

  /** Put back a snapshot taken by `snapshot()`. A null snapshot means "leave it". */
  function restore(name, snap) {
    if (snap === null) return false;
    if (snap === undefined) {
      states.delete(name);
      return true;
    }
    states.set(name, snap);
    return true;
  }

  /** Explicit performer-initiated reset — `reset(pixelRain)`. */
  function reset(id, factory) {
    states.set(id, buildInitialState(id, factory));
    return states.get(id);
  }

  /** Every instance id of a strategy that currently holds state. */
  function instancesOf(strategy) {
    return [...states.keys()].filter((id) => strategyOf(id) === strategy);
  }

  // --- whole-strategy operations --------------------------------------------------
  //
  // Replacing a strategy replaces every one of its instances at once, so
  // rollback and reset have to cover all of them. A rollback that restored only the
  // first copy would leave the other two running the failed version's state.

  /** @returns {Record<string, any>} snapshots keyed by instance id */
  function snapshotStrategy(strategy) {
    const snapshots = {};
    for (const id of instancesOf(strategy)) snapshots[id] = snapshot(id);
    return snapshots;
  }

  function restoreStrategy(strategy, snapshots) {
    if (!snapshots) return false;
    let restored = false;
    for (const [id, snap] of Object.entries(snapshots)) {
      if (restore(id, snap)) restored = true;
    }
    return restored;
  }

  function resetStrategy(strategy, factory) {
    const ids = instancesOf(strategy);
    // A strategy with no state yet still deserves its bare instance created.
    for (const id of ids.length ? ids : [strategy]) reset(id, factory);
    return ids.length || 1;
  }

  /** Capture every instance independently so one unusual value cannot block recovery. */
  function snapshotAll() {
    const values = {};
    const skipped = [];
    for (const id of states.keys()) {
      const value = snapshot(id);
      if (value === null) skipped.push(id);
      else values[id] = value;
    }
    return { values, skipped };
  }

  /** Restore fresh clones so repeatedly using the same safe snapshot remains dependable. */
  function restoreAll(bundle) {
    states.clear();
    const restored = [];
    const skipped = [...(bundle?.skipped ?? [])];
    for (const [id, value] of Object.entries(bundle?.values ?? {})) {
      try {
        states.set(id, structuredClone(value));
        restored.push(id);
      } catch {
        skipped.push(id);
      }
    }
    return { restored, skipped: [...new Set(skipped)] };
  }

  return {
    ensure,
    reset,
    snapshot,
    restore,
    snapshotStrategy,
    restoreStrategy,
    resetStrategy,
    snapshotAll,
    restoreAll,
    get: (id) => states.get(id),
    clear: () => states.clear(),
    names: () => [...states.keys()],
  };
}
