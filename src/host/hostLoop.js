// Host loop — the part that stays alive.
//
// p5js live, not evaluated patch code, owns setup() and draw(). This module is the
// body of that draw(); live code contributes named behaviors that this loop calls.
//
// It also owns the frame-boundary steps of the evaluation transaction: a candidate strategy
// is invoked inside an error boundary, and either survives its first frame (commit) or
// is replaced by its predecessor along with the state snapshot taken before it ran.
//
// Drawing is injected through `drawing` so this file can be unit-tested without p5.

const MAX_DT = 1 / 10; // after a stall, resumed state must not leap
const FPS_WINDOW = 60;
const ERROR_REPEAT_FRAMES = 120; // Throttle a strategy that throws every frame.
const SLOW_SECONDS = 5; // sustained, not a single bad frame

export function createHostLoop({
  registry,
  stateStore,
  evaluator,
  diagnostics,
  drawing,
  keyboard = {},
  fpsThreshold = 30, // configurable from the Project panel
  now = () => performance.now() / 1000,
  onCodeError = () => {},
}) {
  const performance_ = { fpsThreshold, slowSince: null, warned: false };
  const startTime = now();
  let lastFrameAt = startTime;
  let sceneEnteredAt = startTime;
  let lastSceneName = null;
  /** Strategies that were on stage last frame, retained so exit() can still run. */
  let lastStrategies = new Map();

  const fpsSamples = new Float32Array(FPS_WINDOW);
  let fpsIndex = 0;
  let fpsFilled = 0;

  // One draw-input object, reused every frame for every strategy. Avoid
  // unbounded per-frame allocation, and a performance can run for half an hour.
  // `state` is swapped per instance immediately before the call.
  const liveControls = {};
  const drawInputs = {
    audio: null,
    canvas: null,
    state: null,
    dt: 0,
    time: 0,
    sceneTime: 0,
    controls: liveControls,
    // Temporary source-compatibility alias. New code and all teaching material use
    // `controls`; old saved performances can still open while students migrate them.
    params: liveControls,
    keyboard,
  };

  /**
   * Instance ids that have run `enter` and not yet run `exit`.
   *
   * Lifecycle is per instance: three ribbons each get their own enter
   * and exit. Kept here rather than on the registry record because it is a property of
   * being on stage, not of being registered.
   */
  const entered = new Set();
  /** Start a frame: advance clocks, refresh live controls, handle scene transitions. */
  function beginFrame(audio, canvas = null) {
    const t = now();
    const dt = Math.min(t - lastFrameAt, MAX_DT);
    lastFrameAt = t;

    fpsSamples[fpsIndex] = dt > 0 ? 1 / dt : 0;
    fpsIndex = (fpsIndex + 1) % FPS_WINDOW;
    if (fpsFilled < FPS_WINDOW) fpsFilled += 1;

    const sceneName = registry.activeSceneName();
    if (sceneName !== lastSceneName) {
      lastSceneName = sceneName;
      sceneEnteredAt = t;
    }

    runExitsForDepartedStrategies();
    checkFrameRate(t);

    drawInputs.audio = audio;
    drawInputs.canvas = canvas;
    drawInputs.dt = dt;
    drawInputs.time = t - startTime;
    drawInputs.sceneTime = t - sceneEnteredAt;
    registry.paramValues(drawInputs.controls);
    drawing.syncGroups?.(activeGroupIds());
    return drawInputs;
  }

  function activeGroupIds() {
    const ids = [];
    const visit = (nodes) => {
      for (const node of nodes ?? []) {
        if (node?.kind !== 'group') continue;
        ids.push(node.id);
        visit(node.children);
      }
    };
    visit(registry.activeTree?.());
    return ids;
  }

  /** `exit` runs when an instance leaves the active scene. */
  function runExitsForDepartedStrategies() {
    const current = registry.activeStrategies();
    const currentIds = new Set(current.map((strategy) => strategy.id));
    if (lastStrategies.size) {
      for (const [id, strategy] of lastStrategies) {
        if (currentIds.has(id)) continue;
        entered.delete(id);
        const record = registry.getStrategy(strategy.strategy);
        if (!record || typeof strategy.exit !== 'function') continue;
        drawInputs.state = stateStore.ensure(id, strategy.state);
        guard(record, 'exit', () => strategy.exit(drawInputs));
      }
    }
    lastStrategies = new Map(current.map((strategy) => [strategy.id, strategy]));
  }

  /**
   * Draw one strategy inside its own error boundary.
   *
   * Two failure paths, and the difference matters:
   *   - a candidate version throws  -> automatic rollback to the previous version
   *   - an already-committed version throws -> it is marked failed, but the loop and
   *     every other strategy keeps running
   */
  function drawStrategy(strategy, inputs) {
    const id = strategy.id;
    const name = strategy.strategy;
    const record = registry.getStrategy(name);
    if (!record?.definition) return;

    // Persistent state is per instance; the implementation is shared by all copies.
    drawInputs.state = stateStore.ensure(id, strategy.state);

    let threw = null;
    drawing.push();
    drawing.resetDefaults();
    try {
      if (!entered.has(id)) {
        entered.add(id);
        strategy.enter?.(drawInputs);
      }
      if (inputs.audio?.beat) strategy.beat?.(drawInputs);
      strategy.draw(drawInputs);
    } catch (error) {
      threw = error;
    } finally {
      drawing.pop();
    }

    if (threw === null) {
      registry.markRendered(name);
      return;
    }

    if (record.candidate) {
      const result = registry.rollbackStrategy(name, threw);
      // Replacing a strategy replaced the behavior of every instance of it, so the
      // rollback has to put every instance's state back, not just this one's.
      stateStore.restoreStrategy(name, result.stateSnapshot);
      // A candidate may have arrived with a new scene array. If its first frame
      // fails, put the last successfully running composition back as well as its code.
      if (result.configurationSnapshot?.activeSceneName !== null) {
        registry.restoreConfiguration(result.configurationSnapshot);
      }

      // Anonymous scene entries have registry identities like `scene[1]`, but no
      // hidden JavaScript variable. Rebuild the visible scene-array binding from the
      // restored registry configuration so a later `activate(scene)` cannot accidentally
      // resurrect the failed function object. Named strategies restore normally.
      const inline = /^([A-Za-z_$][\w$]*)((?:\[\d+\])+)$/.exec(name);
      if (inline && evaluator.hasBinding(inline[1])) {
        const previousScene = result.configurationSnapshot?.scenes
          ?.find((scene) => scene.name === inline[1]);
        if (previousScene) {
          evaluator.restoreBinding(
            inline[1],
            materializeScene(previousScene.entries),
          );
        }
      } else if (evaluator.hasBinding(name)) {
        evaluator.restoreBinding(name, result.record.definition);
      }
      disposeDefinition(result.failedDefinition, name);
      diagnostics?.error(
        `${name} v${result.failedVersion} threw on its first frame — rolled back to v${result.restoredVersion}`,
        `${threw.name}: ${threw.message}`,
      );
      notifyCodeError(name, threw);
    } else {
      reportRepeatingError(record, threw);
    }
  }

  function materializeScene(entries) {
    return (entries ?? []).map((entry) =>
      Array.isArray(entry)
        ? materializeScene(entry)
        : registry.getStrategy(entry)?.definition);
  }

  /** Draw the recursive scene tree. Nested arrays receive transparent offscreen targets. */
  function drawScene(inputs = drawInputs) {
    const visit = (nodes) => {
      for (const node of nodes ?? []) {
        if (node?.kind !== 'group') {
          drawStrategy(node, inputs);
          continue;
        }

        const parentCanvas = drawInputs.canvas;
        const scope = drawing.beginGroup?.(node.id);
        if (!scope) {
          visit(node.children);
          continue;
        }
        try {
          drawInputs.canvas = drawing.groupCanvas?.(scope) ?? parentCanvas;
          visit(node.children);
        } finally {
          drawInputs.canvas = parentCanvas;
          drawing.endGroup(scope);
        }
      }
    };
    visit(registry.activeTree?.() ?? registry.activeStrategies());
  }

  /** A committed strategy that throws every frame must not flood history or memory. */
  function reportRepeatingError(record, error) {
    const signature = `${error.name}: ${error.message}`;
    record.status = 'failed';
    record.lastError = { message: signature, version: record.version };
    if (record.errorSignature === signature && record.errorFrames++ < ERROR_REPEAT_FRAMES) return;
    record.errorSignature = signature;
    record.errorFrames = 0;
    diagnostics?.error(`${record.name} is throwing every frame`, signature);
    notifyCodeError(record.name, error);
  }

  /** Wrap a lifecycle handler that is not `draw` — never allowed to stop the loop. */
  function guard(record, hook, fn) {
    drawing.push();
    try {
      fn();
    } catch (error) {
      diagnostics?.error(`${record.name}.${hook}() threw`, `${error.name}: ${error.message}`);
      notifyCodeError(record.name, error);
    } finally {
      drawing.pop();
    }
  }

  /** Release resources owned by an implementation that is no longer live. */
  function disposeDefinition(definition, name) {
    if (!definition || typeof definition.dispose !== 'function') return;
    try {
      definition.dispose.call(definition, drawInputs);
    } catch (error) {
      diagnostics?.error(`${name}.dispose() threw`, `${error.name}: ${error.message}`);
      notifyCodeError(name, error);
    }
  }

  /** UI feedback is optional and must never become another way to stop the host. */
  function notifyCodeError(name, error) {
    try {
      onCodeError(name, error);
    } catch {
      /* the drawing loop remains the final error boundary */
    }
  }

  /**
   * End of frame. Confirm candidates only after every active instance has had its
   * turn, then splice in queued transactions for the next frame boundary.
   * A shared definition is not good merely because its first copy survived: another
   * copy can take a different path through the same code because state is per copy.
   */
  function commitPendingChanges() {
    for (const record of registry.listStrategies()) {
      if (!record.candidate) continue;

      const isActive = registry.activeInstancesOf(record.name).length > 0;
      // An active candidate reached the frame boundary without rolling back, which
      // means every one of its copies completed. An inactive candidate had no frame
      // to survive, so nothing on stage is at risk from accepting it immediately.
      const version = record.version;
      const previousDefinition = record.candidate.previousDefinition;
      registry.confirmStrategy(record.name, { running: isActive });
      if (previousDefinition !== record.definition) {
        disposeDefinition(previousDefinition, record.name);
      }
      record.errorSignature = null;
      diagnostics?.success(
        isActive
          ? `${record.name} v${version} active`
          : `${record.name} v${version} installed (not active)`,
      );
    }
    evaluator.applyPending();
  }

  function fps() {
    if (fpsFilled === 0) return 0;
    let total = 0;
    for (let i = 0; i < fpsFilled; i++) total += fpsSamples[i];
    return total / fpsFilled;
  }

  /**
   * Warn when average FPS stays below the threshold for five seconds.
   *
   * The five seconds matter. A single slow frame is a garbage collection or a window
   * resize; five seconds of them is a strategy that is too expensive, and that is worth
   * interrupting a performer to say. Warn once per episode, not once per frame.
   */
  function checkFrameRate(t) {
    if (fpsFilled < FPS_WINDOW) return; // not enough history to judge
    const current = fps();

    if (current >= performance_.fpsThreshold) {
      if (performance_.warned) {
        diagnostics?.success(`Frame rate recovered — ${current.toFixed(0)} FPS`);
      }
      performance_.slowSince = null;
      performance_.warned = false;
      return;
    }

    if (performance_.slowSince === null) {
      performance_.slowSince = t;
      return;
    }
    if (!performance_.warned && t - performance_.slowSince >= SLOW_SECONDS) {
      performance_.warned = true;
      diagnostics?.warn(
        `Frame rate below ${performance_.fpsThreshold} FPS for ${SLOW_SECONDS}s`,
        `Currently ${current.toFixed(0)} FPS. Check for an unbounded array, a large ` +
          `loop, or too many active strategies.`,
      );
    }
  }

  /**
   * Forget which instances are on stage.
   *
   * Needed after a project reset: the starter re-registers its patches, and if an old
   * instance were still in `entered`, its enter() would never run again. Clocks are
   * left alone on purpose — resetting the project is not a reload, so host time and
   * the audio keep going.
   */
  function reset({ preserveDefinitions = new Set() } = {}) {
    for (const record of registry.listStrategies()) {
      if (!preserveDefinitions.has(record.definition)) disposeDefinition(record.definition, record.name);
      const previous = record.candidate?.previousDefinition;
      if (
        previous &&
        previous !== record.definition &&
        !preserveDefinitions.has(previous)
      ) {
        disposeDefinition(previous, record.name);
      }
    }
    entered.clear();
    lastStrategies.clear();
    drawing.syncGroups?.([]);
  }

  return {
    beginFrame,
    drawScene,
    drawStrategy,
    commitPendingChanges,
    reset,
    fps,
    time: () => now() - startTime,
    fpsThreshold: () => performance_.fpsThreshold,
    setFpsThreshold(value) {
      performance_.fpsThreshold = value;
      performance_.slowSince = null;
      performance_.warned = false;
    },
  };
}
