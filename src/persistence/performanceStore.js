// Named performance recall slots. They live in browser storage for instant local
// recall and are copied into portable project exports for backup and transfer.
//
// A scene is deliberately still just an ordered array of patches in source. A
// performance is the larger performer-facing unit: source, the active scene name,
// tuned parameters, audio-analysis settings, and the useful parts of the stage view.
// Compiled functions and File objects never enter storage.

import { validateRhythmSettings } from '../rhythm/clock.js';

const KEY = 'p5js-live.performances.v1';
const SCHEMA = 2;

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
      const raw = storage?.getItem(KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      if (data?.schema !== SCHEMA || !Array.isArray(data.performances)) return [];
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
    // Storage order is the visible slot order. New saves append, updates stay in
    // place, and imported additions go to the bottom so numbered shortcuts remain
    // stable throughout a performance.
    return read();
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
    let rhythm;
    try { rhythm = validateRhythmSettings(snapshot.rhythm); }
    catch { return { ok: false, reason: 'invalid-rhythm' }; }

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
      controls: Array.isArray(snapshot.controls) ? clone(snapshot.controls) : [],
      modulations: Array.isArray(snapshot.modulations) ? clone(snapshot.modulations) : [],
      audio: clone(snapshot.audio ?? {}),
      rhythm,
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

  /**
   * Merge portable recall points into this browser without deleting unrelated local
   * performances. Matching ids are restored from the backup; new ids are added.
   */
  function merge(entries) {
    if (!Array.isArray(entries) || entries.some((entry) => !validPerformance(entry))) {
      return { ok: false, reason: 'invalid-performances' };
    }

    const current = read();
    const byId = new Map(current.map((entry) => [entry.id, entry]));
    let added = 0;
    let updated = 0;
    for (const entry of entries) {
      if (byId.has(entry.id)) updated += 1;
      else added += 1;
      byId.set(entry.id, clone(entry));
    }
    if (!write([...byId.values()])) return { ok: false, reason: 'storage' };
    return { ok: true, imported: entries.length, added, updated };
  }

  /** Replace the whole scene list — used when a different performance is loaded. */
  function replace(entries) {
    if (!Array.isArray(entries) || entries.some((entry) => !validPerformance(entry))) {
      return { ok: false, reason: 'invalid-performances' };
    }
    if (!write(entries.map(clone))) return { ok: false, reason: 'storage' };
    return { ok: true, count: entries.length };
  }

  return { list, get, save, remove, merge, replace };
}

function validPerformance(entry) {
  try { validateRhythmSettings(entry?.rhythm); } catch { return false; }
  return (
    entry &&
    typeof entry.id === 'string' &&
    typeof entry.name === 'string' &&
    typeof entry.source === 'string' &&
    Number.isFinite(entry.createdAt) &&
    Number.isFinite(entry.updatedAt)
  );
}
