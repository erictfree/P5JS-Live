// Shared fixture: a complete host with drawing stubbed out.
//
// Everything under src/host and src/audio/features is deliberately free of p5 and the
// DOM, which is what lets the interesting logic — rollback, state identity, history —
// be tested in plain Node instead of a browser.

import { createDiagnostics } from '../../src/host/diagnostics.js';
import { createRegistry } from '../../src/host/registry.js';
import { createStateStore } from '../../src/host/stateStore.js';
import { createEvaluator } from '../../src/host/evaluator.js';
import { createHostLoop } from '../../src/host/hostLoop.js';

export function createTestHost({ fpsThreshold = 30, onCodeError = () => {} } = {}) {
  const diagnostics = createDiagnostics();
  const registry = createRegistry();
  const stateStore = createStateStore({ diagnostics });
  const evaluator = createEvaluator({ registry, stateStore, diagnostics });

  const drawing = {
    depth: 0,
    push() {
      this.depth++;
    },
    pop() {
      this.depth--;
    },
    resetDefaults() {},
    groups: [],
    syncGroups() {},
    beginGroup(id) {
      this.groups.push({ type: 'begin', id });
      return { id, canvas: { id } };
    },
    groupCanvas(scope) {
      return scope.canvas;
    },
    endGroup(scope) {
      this.groups.push({ type: 'end', id: scope.id });
    },
  };

  let clock = 0;
  const host = createHostLoop({
    registry,
    stateStore,
    evaluator,
    diagnostics,
    drawing,
    fpsThreshold,
    now: () => clock,
    onCodeError,
  });

  /**
   * Run whole frames, exactly as src/main.js does.
   * `step` is the simulated seconds per frame — raise it to simulate a slow machine.
   */
  function frame(count = 1, audio = { beat: false }, step = 1 / 60) {
    for (let i = 0; i < count; i++) {
      clock += step;
      const ctx = host.beginFrame(audio);
      host.drawScene(ctx);
      host.commitPendingChanges();
    }
  }

  return { diagnostics, registry, stateStore, evaluator, host, drawing, frame };
}

/** Messages the performer would see, newest first. */
export const messages = (diagnostics) => diagnostics.list().map((d) => `${d.level}: ${d.message}`);
