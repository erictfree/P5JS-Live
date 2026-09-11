// Recently loaded audio files, cached as blobs in IndexedDB so the start dialog can
// offer them again. Browsers cannot reopen a local file by path, so the bytes are kept
// (a few files at most). Falls back to an in-memory list when IndexedDB is missing.

const DB_NAME = 'p5js-live-recent-audio';
const STORE = 'files';

export function createRecentAudio({ indexedDB = globalThis.indexedDB, limit = 5, now = () => Date.now() } = {}) {
  const memory = new Map(); // name → { name, type, size, at, blob }
  let dbPromise = null;

  function open() {
    if (!indexedDB) return Promise.resolve(null);
    if (!dbPromise) {
      dbPromise = new Promise((resolve) => {
        try {
          const request = indexedDB.open(DB_NAME, 1);
          request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: 'name' }); };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
        } catch { resolve(null); }
      });
    }
    return dbPromise;
  }

  function tx(db, mode, run) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const store = transaction.objectStore(STORE);
      let result;
      try { result = run(store); } catch (error) { reject(error); return; }
      transaction.oncomplete = () => resolve(result?.result ?? result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async function readAll() {
    const db = await open();
    if (!db) return [...memory.values()];
    try {
      const rows = await tx(db, 'readonly', store => store.getAll());
      return Array.isArray(rows) ? rows : [];
    } catch { return []; }
  }

  async function list() {
    const rows = await readAll();
    return rows
      .sort((a, b) => b.at - a.at)
      .slice(0, limit)
      .map(({ name, type, size, at }) => ({ name, type, size, at }));
  }

  async function remember(file) {
    if (!file || typeof file.name !== 'string') return false;
    const entry = { name: file.name, type: file.type || 'audio/*', size: file.size ?? 0, at: now(), blob: file };
    const db = await open();
    if (!db) {
      memory.set(entry.name, entry);
      trimMemory();
      return true;
    }
    try {
      await tx(db, 'readwrite', store => { store.put(entry); });
      const rows = await readAll();
      const stale = rows.sort((a, b) => b.at - a.at).slice(limit);
      if (stale.length) await tx(db, 'readwrite', store => { for (const row of stale) store.delete(row.name); });
      return true;
    } catch { return false; }
  }

  function trimMemory() {
    const rows = [...memory.values()].sort((a, b) => b.at - a.at);
    for (const row of rows.slice(limit)) memory.delete(row.name);
  }

  async function get(name) {
    const db = await open();
    if (!db) {
      const entry = memory.get(name);
      return entry ? new File([entry.blob], entry.name, { type: entry.type }) : null;
    }
    try {
      const entry = await tx(db, 'readonly', store => store.get(name));
      return entry?.blob ? new File([entry.blob], entry.name, { type: entry.type }) : null;
    } catch { return null; }
  }

  async function forget(name) {
    const db = await open();
    if (!db) return memory.delete(name);
    try { await tx(db, 'readwrite', store => { store.delete(name); }); return true; } catch { return false; }
  }

  return { list, remember, get, forget };
}
