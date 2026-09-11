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

import { validateLauncher } from '../performance/launcher.js';
import { validateRhythmSettings } from '../rhythm/clock.js';
import { validThumbnail } from './performanceLibrary.js';

const KEY = 'p5js-live.project.v5';
const PROJECT_FORMAT = 'p5js-live-project';
const SCHEMA = 7;
// A whole library in one file: every entry is itself a complete performance object.
const LIBRARY_FORMAT = 'p5js-live-performance-library';
const LIBRARY_SCHEMA = 1;

export function createProjectStore({
  registry,
  diagnostics,
  controlManager = null,
  rhythm = null,
  storage = globalThis.localStorage,
} = {}) {
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
      controls: controlManager?.snapshotMappings?.() ?? [],
      rhythm: validateRhythmSettings(rhythm?.settings()),
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
    try {
      raw = storage?.getItem(KEY);
    } catch (error) {
      diagnostics?.warn('Could not read saved project', error.message);
      return null;
    }
    if (!raw) return null;

    try {
      const data = JSON.parse(raw);
      if (data?.schema !== SCHEMA || typeof data.source !== 'string') {
        diagnostics?.warn('Saved project is from an older format — starting fresh');
        return null;
      }
      data.rhythm = validateRhythmSettings(data.rhythm);
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
    const rhythmSettings = validateRhythmSettings(data.rhythm);
    if (data.safeScene) registry.setSafeScene(data.safeScene);
    for (const param of data.params ?? []) {
      registry.declareParam(param.name, param.value, param);
      // declareParam deliberately keeps an existing value, so set the saved one
      // explicitly — the performer's tuning outranks the source's default.
      registry.setParam(param.name, param.value);
    }
    controlManager?.restoreMappings?.(data.controls ?? []);
    rhythm?.configure(rhythmSettings);
  }

  function clear() {
    try {
      storage?.removeItem(KEY);
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
        controls: data.controls,
        rhythm: data.rhythm,
        ...extra,
      },
      null,
      2,
    );
  }

  /** A parsed bundle (library entry data) back into file form, with optional extras. */
  function serializeBundle(data, extra = {}) {
    return JSON.stringify(
      {
        format: PROJECT_FORMAT,
        schema: SCHEMA,
        exportedAt: new Date().toISOString(),
        source: String(data.source ?? '').split('\n'),
        safeScene: data.safeScene ?? null,
        params: data.params ?? [],
        controls: data.controls ?? [],
        rhythm: data.rhythm,
        performances: data.performances ?? [],
        ...(data.launcher ? { launcher: data.launcher } : {}),
        ...(data.audio ? { audio: data.audio } : {}),
        ...extra,
      },
      null,
      2,
    );
  }

  /** Every saved performance in one file. `entries` are full library entries (with data). */
  function exportLibrary(entries) {
    return JSON.stringify(
      {
        format: LIBRARY_FORMAT,
        schema: LIBRARY_SCHEMA,
        exportedAt: new Date().toISOString(),
        performances: entries.map(entry => JSON.parse(serializeBundle(entry.data, {
          name: entry.name,
          ...(entry.thumbnail ? { thumbnail: entry.thumbnail } : {}),
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        }))),
      },
      null,
      2,
    );
  }

  function slug(text) {
    return String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'untitled';
  }

  function downloadText(text, filename) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return filename;
  }

  function download(editorSource, extra = {}) {
    const blob = new Blob([exportProject(editorSource, extra)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `p5js-live-performance-${slug(extra.name)}-${new Date().toISOString().slice(0, 10)}.json`;
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
    return validateBundle(data);
  }

  /**
   * Parse any file the app can import: a single performance (`kind: 'performance'`) or a
   * whole library (`kind: 'library'`, `entries: [{ name, thumbnail, data }]`).
   */
  function parseImport(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      return { ok: false, error: `Not a valid performance file — ${error.message}` };
    }
    if (data?.format === LIBRARY_FORMAT) {
      if (data.schema !== LIBRARY_SCHEMA) return { ok: false, error: `Library uses format version ${data.schema}, this build reads ${LIBRARY_SCHEMA}` };
      if (!Array.isArray(data.performances) || !data.performances.length) return { ok: false, error: 'Library file has no performances' };
      const entries = [];
      for (const [index, item] of data.performances.entries()) {
        const parsed = validateBundle(item);
        if (!parsed.ok) return { ok: false, error: `Performance ${index + 1}: ${parsed.error}` };
        entries.push({ name: parsed.data.name ?? `Performance ${index + 1}`, thumbnail: parsed.data.thumbnail ?? null, data: parsed.data });
      }
      return { ok: true, kind: 'library', entries };
    }
    const single = validateBundle(data);
    return single.ok ? { ok: true, kind: 'performance', data: single.data } : single;
  }

  function validateBundle(data) {
    if (data?.format !== PROJECT_FORMAT) {
      return { ok: false, error: 'Not a p5js live project file' };
    }
    if (data.schema !== SCHEMA) {
      return {
        ok: false,
        error: `Project uses format version ${data.schema}, this build reads ${SCHEMA}`,
      };
    }
    const source = Array.isArray(data.source) ? data.source.join('\n') : data.source;
    if (typeof source !== 'string') {
      return { ok: false, error: 'Project file has no source' };
    }
    if (data.performances !== undefined && !Array.isArray(data.performances)) {
      return { ok: false, error: 'Project file performances are unreadable' };
    }
    try { if (data.launcher !== undefined) data.launcher = validateLauncher(data.launcher); }
    catch (error) { return { ok: false, error: error.message }; }
    try { data.rhythm = validateRhythmSettings(data.rhythm); }
    catch (error) { return { ok: false, error: error.message }; }
    // Performance-level extras are optional and tolerated when malformed.
    const audio = data.audio && typeof data.audio === 'object' ? {
      analysis: data.audio.analysis && typeof data.audio.analysis === 'object' ? data.audio.analysis : {},
      loop: Boolean(data.audio.loop),
      volume: Number.isFinite(data.audio.volume) ? Math.min(1, Math.max(0, data.audio.volume)) : 1,
    } : null;
    return {
      ok: true,
      data: {
        source,
        safeScene: data.safeScene ?? null,
        params: Array.isArray(data.params) ? data.params : [],
        controls: Array.isArray(data.controls) ? data.controls : [],
        rhythm: data.rhythm,
        performances: data.performances ?? [],
        ...(data.launcher ? { launcher: data.launcher } : {}),
        ...(audio ? { audio } : {}),
        ...(typeof data.name === 'string' && data.name.trim() ? { name: data.name.trim().slice(0, 60) } : {}),
        ...(validThumbnail(data.thumbnail) ? { thumbnail: data.thumbnail } : {}),
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
    serializeBundle,
    exportLibrary,
    download,
    downloadText,
    slug,
    parseProject,
    parseImport,
  };
}
