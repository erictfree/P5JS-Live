// The performance library: named bundles of everything a performer brings to a show —
// working source, saved scenes, pad layout and encoder assignments, control mappings,
// tempo and audio settings — plus a square thumbnail. Bundles are the same shape as a
// performance file (projectStore.parseProject output), so export/import and the
// library agree. One entry can be "current"; it is updated in place as work happens.

const KEY = 'p5js-live.performance-library.v1';
const CURRENT_KEY = 'p5js-live.current-performance.v1';
const MAX_THUMBNAIL_CHARS = 200_000; // ~150 KB of JPEG, far above the 128 px default
const clone = (value) => JSON.parse(JSON.stringify(value));

export function validBundle(data) {
  return Boolean(data) && typeof data.source === 'string'
    && (data.performances === undefined || Array.isArray(data.performances))
    && (data.controls === undefined || Array.isArray(data.controls));
}

export function validThumbnail(value) {
  return typeof value === 'string' && value.startsWith('data:image/') && value.length <= MAX_THUMBNAIL_CHARS;
}

export function createPerformanceLibrary({
  storage = globalThis.localStorage,
  now = () => Date.now(),
  makeId = () => globalThis.crypto?.randomUUID?.() ?? `performance-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  diagnostics,
} = {}) {
  const listeners = new Set();
  const notify = () => listeners.forEach(fn => fn());

  function read() {
    try {
      const raw = storage?.getItem(KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      if (data?.version !== 1 || !Array.isArray(data.performances)) return [];
      return data.performances.filter(validEntry).map(clone);
    } catch { return []; }
  }

  function write(entries) {
    try { storage?.setItem(KEY, JSON.stringify({ version: 1, performances: entries })); return true; }
    catch (error) { diagnostics?.warn?.('Could not save the performance library', error?.message); return false; }
  }

  function summary(entry) {
    const { data, ...rest } = entry;
    return { ...rest, sceneCount: data.performances?.length ?? 0 };
  }

  function list() { return read().map(summary); }
  function get(id) { return read().find(entry => entry.id === id) ?? null; }

  function save({ name, data, thumbnail = null }) {
    const title = String(name ?? '').trim();
    if (!title) return { ok: false, reason: 'missing-name' };
    if (!validBundle(data)) return { ok: false, reason: 'invalid-performance' };
    const stamp = now();
    const entry = {
      id: makeId(), name: title, createdAt: stamp, updatedAt: stamp,
      thumbnail: validThumbnail(thumbnail) ? thumbnail : null,
      data: clone(data),
    };
    if (!write([...read(), entry])) return { ok: false, reason: 'storage' };
    notify();
    return { ok: true, performance: summary(entry) };
  }

  function update(id, changes = {}) {
    const entries = read();
    const index = entries.findIndex(entry => entry.id === id);
    if (index < 0) return { ok: false, reason: 'missing' };
    const entry = { ...entries[index] };
    if (changes.name !== undefined) {
      const title = String(changes.name ?? '').trim();
      if (!title) return { ok: false, reason: 'missing-name' };
      entry.name = title;
    }
    if (changes.data !== undefined) {
      if (!validBundle(changes.data)) return { ok: false, reason: 'invalid-performance' };
      entry.data = clone(changes.data);
    }
    if (changes.thumbnail !== undefined) entry.thumbnail = validThumbnail(changes.thumbnail) ? changes.thumbnail : null;
    entry.updatedAt = now();
    entries[index] = entry;
    if (!write(entries)) return { ok: false, reason: 'storage' };
    notify();
    return { ok: true, performance: summary(entry) };
  }

  function remove(id) {
    const entries = read();
    const next = entries.filter(entry => entry.id !== id);
    if (next.length === entries.length) return false;
    const wasCurrent = currentId() === id;
    if (!write(next)) return false;
    if (wasCurrent) { try { storage?.removeItem(CURRENT_KEY); } catch { /* stale id is ignored by currentId() anyway */ } }
    notify();
    return true;
  }

  /** Reorder: move an entry by `delta` positions (negative = up). Jog browsing follows this order. */
  function move(id, delta) {
    const entries = read();
    const from = entries.findIndex(entry => entry.id === id);
    if (from < 0 || !Number.isInteger(delta) || delta === 0) return false;
    const to = Math.min(entries.length - 1, Math.max(0, from + delta));
    if (to === from) return false;
    const [entry] = entries.splice(from, 1);
    entries.splice(to, 0, entry);
    if (!write(entries)) return false;
    notify();
    return true;
  }

  function currentId() {
    try { const id = storage?.getItem(CURRENT_KEY); return id && read().some(entry => entry.id === id) ? id : null; }
    catch { return null; }
  }

  function setCurrent(id) {
    try {
      if (id === null) storage?.removeItem(CURRENT_KEY);
      else if (read().some(entry => entry.id === id)) storage?.setItem(CURRENT_KEY, id);
      else return false;
    } catch { return false; }
    notify();
    return true;
  }

  return {
    list, get, save, update, remove, move, currentId, setCurrent,
    current: () => { const id = currentId(); return id ? summary(get(id)) : null; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

function validEntry(entry) {
  return Boolean(entry) && typeof entry.id === 'string' && typeof entry.name === 'string'
    && Number.isFinite(entry.createdAt) && Number.isFinite(entry.updatedAt) && validBundle(entry.data);
}
