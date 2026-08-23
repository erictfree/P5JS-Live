// Named, browser-local performance recall slots.
//
// A scene is deliberately still just an ordered array of patches in source. A
// performance is the larger performer-facing unit: source, the active scene name,
// tuned parameters, audio-analysis settings, and the useful parts of the stage view.
// Compiled functions and File objects never enter storage.

const KEY = 'p5js-live.performances.v1';
const PREVIOUS_KEY = 'algolab.performances.v1';
const SCHEMA = 1;

const clone = (value) => JSON.parse(JSON.stringify(value));

/** Return the zero-based performance slot requested by Cmd/Ctrl+Option/Alt+1…9. */
export function performanceShortcutIndex(event) {
  if (!(event.metaKey || event.ctrlKey) || !event.altKey || event.shiftKey) return null;
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(event.code ?? '');
  return match ? Number(match[1]) - 1 : null;
}

export function createPerformanceStore({
  storage = globalThis.localStorage,
  diagnostics,
  now = () => Date.now(),
  makeId = () => globalThis.crypto?.randomUUID?.() ?? `performance-${now()}`,
} = {}) {
  function read() {
    try {
      let raw = storage?.getItem(KEY);
      let sourceKey = KEY;
      if (!raw) {
        raw = storage?.getItem(PREVIOUS_KEY);
        sourceKey = PREVIOUS_KEY;
      }
      if (!raw) return [];
      const data = JSON.parse(raw);
      if (data?.schema !== SCHEMA || !Array.isArray(data.performances)) return [];
      if (sourceKey !== KEY) {
        storage?.setItem(KEY, raw);
        storage?.removeItem(sourceKey);
      }
      return data.performances.filter(validPerformance).map(clone);
    } catch (error) {
      diagnostics?.warn('Could not read saved performances', error.message);
      return [];
    }
  }

  function write(performances) {
    try {
      storage?.setItem(KEY, JSON.stringify({ schema: SCHEMA, performances }));
      return true;
    } catch (error) {
      diagnostics?.warn('Could not save performance', error.message);
      return false;
    }
  }

  function list() {
    return read().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function get(id) {
    return read().find((entry) => entry.id === id) ?? null;
  }

  function save(snapshot, { id = null } = {}) {
    if (typeof snapshot?.source !== 'string' || snapshot.source.trim() === '') {
      return { ok: false, reason: 'missing-source' };
    }
    const name = String(snapshot.name ?? '').trim();
    if (!name) return { ok: false, reason: 'missing-name' };

    const performances = read();
    const existing = id ? performances.find((entry) => entry.id === id) : null;
    const timestamp = now();
    const entry = {
      id: existing?.id ?? makeId(),
      name,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      source: snapshot.source,
      sceneName: snapshot.sceneName ?? null,
      safeScene: snapshot.safeScene ?? null,
      params: Array.isArray(snapshot.params) ? clone(snapshot.params) : [],
      audio: clone(snapshot.audio ?? {}),
      view: clone(snapshot.view ?? {}),
    };
    const next = existing
      ? performances.map((performance) => performance.id === existing.id ? entry : performance)
      : [...performances, entry];
    if (!write(next)) return { ok: false, reason: 'storage' };
    return { ok: true, performance: clone(entry) };
  }

  function remove(id) {
    const performances = read();
    const next = performances.filter((entry) => entry.id !== id);
    if (next.length === performances.length) return false;
    return write(next);
  }

  return { list, get, save, remove };
}

function validPerformance(entry) {
  return (
    entry &&
    typeof entry.id === 'string' &&
    typeof entry.name === 'string' &&
    typeof entry.source === 'string' &&
    Number.isFinite(entry.createdAt) &&
    Number.isFinite(entry.updatedAt)
  );
}
