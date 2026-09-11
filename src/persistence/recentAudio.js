// Recently loaded audio files for the start dialog. Names, sizes and times live in
// localStorage. Where the browser supports file handles (Chrome's File System Access
// API), the handle for each file is kept in IndexedDB so a recent row can reopen the
// file directly — no picker, at most an Allow prompt. No audio bytes are ever stored.

const KEY = 'p5js-live.recent-audio.v1';
const DB_NAME = 'p5js-live-recent-audio';
const STORE = 'handles';

export function createRecentAudio({ storage = globalThis.localStorage, indexedDB = globalThis.indexedDB, limit = 5, now = () => Date.now() } = {}) {
  const memoryHandles = new Map();
  let dbPromise = null;

  function read() {
    try {
      const data = JSON.parse(storage?.getItem(KEY) ?? 'null');
      return Array.isArray(data?.files) ? data.files.filter(f => f && typeof f.name === 'string') : [];
    } catch { return []; }
  }
  function write(files) {
    try { storage?.setItem(KEY, JSON.stringify({ version: 1, files })); return true; } catch { return false; }
  }

  function list() {
    return read().sort((a, b) => b.at - a.at).slice(0, limit).map(({ name, type, size, at }) => ({ name, type, size, at }));
  }

  function remember(file, handle = null) {
    if (!file || typeof file.name !== 'string' || !file.name) return false;
    const files = read().filter(f => f.name !== file.name);
    files.unshift({ name: file.name, type: file.type || 'audio/*', size: file.size ?? 0, at: now() });
    const ok = write(files.sort((a, b) => b.at - a.at).slice(0, limit));
    if (handle) void rememberHandle(file.name, handle);
    return ok;
  }

  function forget(name) {
    const files = read();
    const next = files.filter(f => f.name !== name);
    void forgetHandle(name);
    if (next.length === files.length) return false;
    return write(next);
  }

  // --- handles (Chrome) ---
  function open() {
    if (!indexedDB) return Promise.resolve(null);
    if (!dbPromise) {
      dbPromise = new Promise((resolve) => {
        try {
          const request = indexedDB.open(DB_NAME, 2);
          request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
          };
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
      let request;
      try { request = run(transaction.objectStore(STORE)); } catch (error) { reject(error); return; }
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
  async function rememberHandle(name, handle) {
    const db = await open();
    if (!db) { memoryHandles.set(name, handle); return true; }
    try { await tx(db, 'readwrite', store => store.put(handle, name)); return true; } catch { return false; }
  }
  async function handleFor(name) {
    const db = await open();
    if (!db) return memoryHandles.get(name) ?? null;
    try { return (await tx(db, 'readonly', store => store.get(name))) ?? null; } catch { return null; }
  }
  async function forgetHandle(name) {
    const db = await open();
    if (!db) return memoryHandles.delete(name);
    try { await tx(db, 'readwrite', store => store.delete(name)); return true; } catch { return false; }
  }

  return { list, remember, forget, handleFor };
}
