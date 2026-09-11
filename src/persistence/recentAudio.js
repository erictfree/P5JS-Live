// Names of recently loaded audio files, kept in localStorage as a reminder for the start
// dialog. Only the name, type, size and time are stored — never the bytes. A browser
// cannot reopen a local file from its name, so choosing one again goes through the
// file picker.

const KEY = 'p5js-live.recent-audio.v1';

export function createRecentAudio({ storage = globalThis.localStorage, limit = 5, now = () => Date.now() } = {}) {
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

  function remember(file) {
    if (!file || typeof file.name !== 'string' || !file.name) return false;
    const files = read().filter(f => f.name !== file.name);
    files.unshift({ name: file.name, type: file.type || 'audio/*', size: file.size ?? 0, at: now() });
    return write(files.sort((a, b) => b.at - a.at).slice(0, limit));
  }

  function forget(name) {
    const files = read();
    const next = files.filter(f => f.name !== name);
    if (next.length === files.length) return false;
    return write(next);
  }

  return { list, remember, forget };
}
