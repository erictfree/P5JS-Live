// Portable, source-only patch exchange. Importing a patch adds it to the local
// Available catalog; it never evaluates source or edits the active project.

const KEY = 'p5js-live.shared-patches.v1';
const CATEGORIES = new Set(['visual', 'utility', 'shader', 'community']);
const clone = (value) => JSON.parse(JSON.stringify(value));
const metadata = (source, field) =>
  new RegExp(`^//\\s*@${field}\\s+(.+)$`, 'm').exec(source)?.[1].trim() ?? null;

export function parsePatchSource(source) {
  if (typeof source !== 'string') return { ok: false, error: 'Patch file has no source' };
  const marker = /^\/\/\s*%%\s*patch\s+([A-Za-z_$][\w$]*)\s*$/m.exec(source);
  if (!marker) return { ok: false, error: 'Patch needs a "// %% patch bindingName" marker' };
  const name = marker[1];
  const category = metadata(source, 'category') ?? 'community';
  if (!CATEGORIES.has(category)) return { ok: false, error: `Unknown patch category “${category}”` };
  return {
    ok: true,
    patch: {
      name,
      title: metadata(source, 'title') ?? name,
      author: metadata(source, 'author') ?? 'Shared performer',
      blurb: metadata(source, 'description') ?? 'A patch shared from p5js live.',
      category,
      version: metadata(source, 'version') ?? '1',
      source: source.trimEnd(),
      origin: 'shared',
    },
  };
}

export function portablePatchSource(source) {
  const parsed = parsePatchSource(source);
  if (!parsed.ok) return parsed;
  const { patch } = parsed;
  const markerEnd = source.indexOf('\n', source.indexOf('// %%'));
  const bodyLines = markerEnd === -1 ? [] : source.slice(markerEnd + 1).split('\n');
  while (bodyLines.length && (/^\s*\/\/\s*@\w+\s+/.test(bodyLines[0]) || bodyLines[0].trim() === '')) {
    bodyLines.shift();
  }
  const rest = bodyLines.join('\n');
  const header = [
    `// %% patch ${patch.name}`,
    `// @title ${patch.title}`,
    `// @author ${patch.author}`,
    `// @description ${patch.blurb}`,
    `// @category ${patch.category}`,
    `// @version ${patch.version}`,
  ].join('\n');
  return { ok: true, patch: { ...patch, source: `${header}\n\n${rest}`.trimEnd() } };
}

export function patchShareHash(patch) {
  const bytes = new TextEncoder().encode(JSON.stringify({ source: patch.source }));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `#patch=${btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`;
}

export function patchFromShareHash(hash) {
  const encoded = /^#patch=([A-Za-z0-9_-]+)$/.exec(hash)?.[1];
  if (!encoded) return null;
  try {
    const padded = encoded.replaceAll('-', '+').replaceAll('_', '/')
      .padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes));
    return parsePatchSource(data.source);
  } catch {
    return { ok: false, error: 'Shared patch link is unreadable' };
  }
}

export function createPatchStore({ storage = globalThis.localStorage } = {}) {
  function list() {
    try {
      const data = JSON.parse(storage?.getItem(KEY) ?? '[]');
      return Array.isArray(data)
        ? data.filter((entry) => parsePatchSource(entry?.source).ok).map(clone)
        : [];
    } catch {
      return [];
    }
  }

  function save(patch) {
    const parsed = parsePatchSource(patch?.source);
    if (!parsed.ok) return parsed;
    const entries = list();
    const next = [parsed.patch, ...entries.filter((entry) => entry.name !== parsed.patch.name)];
    try {
      storage?.setItem(KEY, JSON.stringify(next));
      return { ok: true, patch: clone(parsed.patch), updated: entries.some((entry) => entry.name === parsed.patch.name) };
    } catch {
      return { ok: false, error: 'Could not save the shared patch in this browser' };
    }
  }

  return { list, save };
}
