// Local project persistence.
//
// The current editor source and performer settings persist locally after refresh.
//
// What is saved is source (including composition arrays), never compiled functions. On reload the
// host replays the source through the ordinary evaluator, so a restored project goes
// through exactly the same validation path as a live edit — including rollback if a
// saved strategy turns out to throw.
//
// The stored shape is versioned. A format change degrades to "start fresh" rather
// than throwing during startup, because a performer should never be met with a
// broken page.

// v5 intentionally starts from the compact, self-sufficient starter. Previous local
// project keys contained the retired built-in patches, so reading them would immediately
// repopulate a library the product has deliberately removed. Exported v6 projects are
// still readable and can be imported explicitly.
const KEY = 'p5js-live.project.v5';
const PREVIOUS_KEY = 'algolab.project.v5';
const OBSOLETE_KEYS = [
  'algolab.project.v1',
  'algolab.project.v2',
  'algolab.project.v3',
  'algolab.project.v4',
];
const LEGACY_KEYS = [
  'livecode-lab.project.v1',
  'patchlab.project.v1',
  'patchbay.project.v1',
  'response.project.v1',
];
const PROJECT_FORMAT = 'p5js-live-project';
const READABLE_FORMATS = new Set([
  PROJECT_FORMAT,
  'algolab-project',
  'livecode-lab-project',
  'patchlab-project',
  'patchbay-project',
  'response-project',
]);
// v6 makes source the sole scene-composition authority. Persistence stores source and
// performer settings, never a second mutable copy of scene membership or order.
const SCHEMA = 6;
const READABLE_SCHEMAS = new Set([6]);

export function createProjectStore({ registry, diagnostics, storage = globalThis.localStorage } = {}) {
  let timer = null;

  function snapshot(editorSource) {
    return {
      schema: SCHEMA,
      savedAt: Date.now(),
      source: editorSource,
      safeScene: registry.safeSceneName(),
      params: registry.listParams().map(({ name, value, min, max, step }) => ({
        name,
        value,
        min,
        max,
        step,
      })),
    };
  }

  function save(editorSource) {
    try {
      storage?.setItem(KEY, JSON.stringify(snapshot(editorSource)));
      return true;
    } catch (error) {
      diagnostics?.warn('Could not save project locally', error.message);
      return false;
    }
  }

  /** Debounced so typing does not write to localStorage on every keystroke. */
  function saveSoon(editorSource, delay = 600) {
    clearTimeout(timer);
    timer = setTimeout(() => save(editorSource), delay);
  }

  function load() {
    let raw;
    let sourceKey = KEY;
    try {
      raw = storage?.getItem(KEY);
      if (!raw) {
        raw = storage?.getItem(PREVIOUS_KEY);
        sourceKey = PREVIOUS_KEY;
      }
    } catch (error) {
      diagnostics?.warn('Could not read saved project', error.message);
      return null;
    }
    if (!raw) return null;

    try {
      const data = JSON.parse(raw);
      if (!READABLE_SCHEMAS.has(data?.schema) || typeof data.source !== 'string') {
        diagnostics?.warn('Saved project is from an older format — starting fresh');
        return null;
      }
      if (sourceKey !== KEY) {
        storage?.setItem(KEY, raw);
        storage?.removeItem(sourceKey);
      }
      return data;
    } catch (error) {
      diagnostics?.warn('Saved project was unreadable — starting fresh', error.message);
      return null;
    }
  }

  /**
   * Put back performer settings that replaying source intentionally does not own.
   * This runs after source evaluation so the referenced safe scene and parameters exist.
   */
  function restoreSettings(data) {
    if (!data) return;
    if (data.safeScene) registry.setSafeScene(data.safeScene);
    for (const param of data.params ?? []) {
      registry.declareParam(param.name, param.value, param);
      // declareParam deliberately keeps an existing value, so set the saved one
      // explicitly — the performer's tuning outranks the source's default.
      registry.setParam(param.name, param.value);
    }
  }

  function clear() {
    try {
      storage?.removeItem(KEY);
      storage?.removeItem(PREVIOUS_KEY);
      for (const obsoleteKey of OBSOLETE_KEYS) storage?.removeItem(obsoleteKey);
      for (const legacyKey of LEGACY_KEYS) storage?.removeItem(legacyKey);
    } catch {
      /* nothing useful to do */
    }
  }

  // --- export / import -----------------------------------------------------------

  /**
   * A human-readable project containing source and live parameter values.
   *
   * Pretty-printed JSON, with the source split into lines. A single escaped string
   * with `\n` in it is technically readable and practically not — a collaborator
   * reviewing or diffing two projects needs to see the code as code.
   */
  function exportProject(editorSource, extra = {}) {
    const data = snapshot(editorSource);
    return JSON.stringify(
      {
        format: PROJECT_FORMAT,
        schema: SCHEMA,
        exportedAt: new Date(data.savedAt).toISOString(),
        source: data.source.split('\n'),
        safeScene: data.safeScene,
        params: data.params,
        ...extra,
      },
      null,
      2,
    );
  }

  function download(editorSource, extra = {}) {
    const blob = new Blob([exportProject(editorSource, extra)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `p5js-live-project-${new Date().toISOString().slice(0, 10)}.json`;
    // Chromium ignores a synthetic click on an anchor that is not in the document, so
    // attach it for the duration of the click.
    link.style.display = 'none';
    document.body.append(link);
    link.click();
    link.remove();
    // Revoke on the next task so the click has actually been dispatched.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return link.download;
  }

  /**
   * Parse an exported project. Returns `{ ok, data }` or `{ ok: false, error }`.
   *
   * Parsing is separate from applying on purpose: imported code requires an explicit
   * trusted-code confirmation, and the performer cannot meaningfully confirm anything
   * until they can be shown what is in the file. So this validates and hands back the
   * contents; running it is a second, deliberate step.
   */
  function parseProject(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      return { ok: false, error: `Not a valid project file — ${error.message}` };
    }
    if (!READABLE_FORMATS.has(data?.format)) {
      return { ok: false, error: 'Not a p5js live project file' };
    }
    if (!READABLE_SCHEMAS.has(data.schema)) {
      return {
        ok: false,
        error: `Project uses format version ${data.schema}, this build reads ${[...READABLE_SCHEMAS].join(' and ')}`,
      };
    }
    const source = Array.isArray(data.source) ? data.source.join('\n') : data.source;
    if (typeof source !== 'string') {
      return { ok: false, error: 'Project file has no source' };
    }
    if (data.performances !== undefined && !Array.isArray(data.performances)) {
      return { ok: false, error: 'Project file performances are unreadable' };
    }
    return {
      ok: true,
      data: {
        source,
        safeScene: data.safeScene ?? null,
        params: Array.isArray(data.params) ? data.params : [],
        performances: data.performances ?? [],
      },
    };
  }

  return {
    save,
    saveSoon,
    load,
    restoreSettings,
    clear,
    exportProject,
    download,
    parseProject,
  };
}
