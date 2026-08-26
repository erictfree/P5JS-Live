// Source structure — pure, DOM-free scanning for evaluation cells and statements.
//
// This is language/application infrastructure rather than editor rendering. Both the
// evaluator and the textarea view consume it without depending on one another.

/**
 * @typedef {{ start: number, end: number, text: string }} Block
 */

/**
 * Split source into top-level statements.
 * @param {string} source
 * @returns {Block[]}
 */
export function findStatements(source) {
  /** @type {Block[]} */
  const blocks = [];
  let depth = 0;
  let start = -1;
  let i = 0;
  const n = source.length;

  /** Last significant character, used to tell division from a regex literal. */
  let prev = '';

  const push = (end) => {
    if (start === -1) return;
    const text = source.slice(start, end);
    if (text.trim() !== '') blocks.push({ start, end, text });
    start = -1;
  };

  while (i < n) {
    const ch = source[i];

    // --- comments -------------------------------------------------------------
    if (ch === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? n : end;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }

    // --- strings and template literals ----------------------------------------
    if (ch === '"' || ch === "'") {
      if (start === -1) start = i;
      i = skipString(source, i, ch);
      prev = ch;
      continue;
    }
    if (ch === '`') {
      if (start === -1) start = i;
      i = skipTemplate(source, i);
      prev = ch;
      continue;
    }

    // --- regex literals -------------------------------------------------------
    if (ch === '/' && regexCanStartAfter(prev)) {
      if (start === -1) start = i;
      const after = skipRegex(source, i);
      if (after !== -1) {
        i = after;
        prev = '/';
        continue;
      }
    }

    // --- structure ------------------------------------------------------------
    if (ch === '{' || ch === '(' || ch === '[') {
      if (start === -1) start = i;
      depth++;
      prev = ch;
      i++;
      continue;
    }
    if (ch === '}' || ch === ')' || ch === ']') {
      if (depth > 0) depth--;
      prev = ch;
      i++;
      continue;
    }

    if (ch === ';' && depth === 0) {
      if (start === -1) start = i;
      push(i + 1);
      prev = ';';
      i++;
      continue;
    }

    if (ch === '\n') {
      // Newline ends a top-level statement only when everything is balanced —
      // the "automatic semicolon" case: `activate(scene)` on its own line.
      if (depth === 0 && start !== -1 && endsStatement(prev)) push(i + 1);
      i++;
      continue;
    }

    if (!/\s/.test(ch)) {
      if (start === -1) start = i;
      prev = ch;
    }
    i++;
  }

  push(n);
  return blocks;
}

/**
 * Explicit multi-statement live-coding cells. A marker labels everything through the
 * next marker, so a class/factory and the instance it constructs refresh together.
 * Markers intentionally begin at column zero: that keeps `// %%` text inside an
 * indented example or shader string from unexpectedly splitting the program.
 *
 * @param {string} source
 * @returns {Array<Block & {label: string}>}
 */
export function findCells(source) {
  const markers = [...source.matchAll(/^\/\/\s*%%\s*([^\n]*)$/gm)];
  return markers.map((marker, index) => {
    const start = marker.index;
    const end = markers[index + 1]?.index ?? source.length;
    return {
      start,
      end,
      text: source.slice(start, end),
      label: marker[1].trim(),
    };
  });
}

/**
 * Upgrade the retired scene command in persisted source without exposing it as a
 * runtime alias. Comments and strings remain untouched so project notes and example
 * text retain exactly what the author wrote.
 *
 * @param {string} source
 * @returns {string}
 */
export function upgradeLegacyActivation(source) {
  const masked = maskCommentsAndStrings(source);
  const matches = [...masked.matchAll(/\bgo(?=\s*\()/g)]
    .filter((match) => masked[match.index - 1] !== '.');
  let upgraded = source;
  for (let i = matches.length - 1; i >= 0; i--) {
    const at = matches[i].index;
    upgraded = `${upgraded.slice(0, at)}activate${upgraded.slice(at + 2)}`;
  }
  return upgraded;
}

/**
 * Rename the original demo's default `tunnel` scene without touching patches or a
 * deliberately named scene in another project. The exact marked cell makes this a
 * narrow source migration rather than a global identifier replacement.
 *
 * @param {string} source
 * @returns {string}
 */
export function renameLegacyStarterScene(source) {
  if (/\b(?:const|let|var)\s+scene\b/.test(source)) return source;
  const legacy = findCells(source).find((cell) => cell.label === 'scene tunnel');
  if (!legacy || !/\b(?:const|let|var)\s+tunnel\s*=\s*\[/.test(legacy.text)) return source;

  const renamed = legacy.text
    .replace(/^\/\/\s*%%\s*scene\s+tunnel\s*$/m, '// %% scene scene')
    .replace(/\b(const|let|var)\s+tunnel\s*=/, '$1 scene =')
    .replace(
      /\b(const|let|var)\s+scene\s*=\s*\[\s*plasma\s*,?\s*\]\s*;?/,
      '$1 scene = [\n  plasma,\n];',
    )
    .replace(/\b(?:go|activate)\s*\(\s*tunnel\s*\)/, 'activate(scene)');
  return `${source.slice(0, legacy.start)}${renamed}${source.slice(legacy.end)}`;
}

/**
 * Add one identifier to a named scene array without regenerating the declaration.
 *
 * Source is the composition model, so comments are meaningful live-coding edits.
 * Rebuilding an array from the running registry would turn an unevaluated
 * `// plasma,` back into active code and discard the performer's formatting. This
 * helper changes only the array body and leaves every existing line intact.
 *
 * @param {string} source
 * @param {string} sceneName
 * @param {string} memberName
 * @param {{before?: string | null, at?: number | null}} options
 * @returns {string | null} updated source, or null when the declaration is absent
 */
export function insertSceneMember(source, sceneName, memberName, { before = null, at = null } = {}) {
  if (![sceneName, memberName, before].filter(Boolean).every(isIdentifier)) return null;

  const escapedScene = escapeRegExp(sceneName);
  const declaration = new RegExp(
    `\\b(?:const|let|var)\\s+${escapedScene}\\s*=\\s*\\[`,
  ).exec(source);
  if (!declaration) return null;

  const open = declaration.index + declaration[0].lastIndexOf('[');
  const close = matchingSquareBracket(source, open);
  if (close === -1) return null;

  const body = source.slice(open + 1, close);
  const masked = maskCommentsAndStrings(body);
  const eol = body.includes('\r\n') ? '\r\n' : '\n';

  if (body.includes('\n')) {
    const escapedBefore = before ? escapeRegExp(before) : null;
    const anchor = escapedBefore
      ? new RegExp(`^([ \\t]*)${escapedBefore}\\b`, 'm').exec(masked)
      : null;
    const contentLine = body.split(/\r?\n/).find((line) => line.trim() !== '');
    const trailing = /(\r?\n)([ \t]*)$/.exec(body);
    const indent = anchor?.[1]
      ?? contentLine?.match(/^[ \t]*/)?.[0]
      ?? `${trailing?.[2] ?? ''}  `;

    // The caret can explicitly choose layer order without rebuilding the array.
    // A blank line is replaced in place. Anywhere on a top-level entry selects that
    // line as the insertion point: the new member is inserted before it and the
    // existing source moves down. Nested lines inside a function, object, or
    // ShaderChain are ignored so insertion cannot split a valid expression.
    if (Number.isInteger(at) && at > open && at <= close) {
      const lineStart = source.lastIndexOf('\n', at - 1) + 1;
      const nextNewline = source.indexOf('\n', at);
      const lineEnd = nextNewline === -1 ? source.length : nextNewline;
      const line = source.slice(lineStart, lineEnd).replace(/\r$/, '');
      if (
        lineStart > open &&
        lineEnd <= close &&
        line.trim() === ''
      ) {
        const blankIndent = line;
        const memberIndent = blankIndent || indent;
        return source.slice(0, lineStart) +
          `${memberIndent}${memberName},` +
          source.slice(lineEnd);
      }

      const leading = line.match(/^[ \t]*/)?.[0] ?? '';
      const bodyLineStart = lineStart - (open + 1);
      const isTopLevelLine =
        lineStart > open &&
        lineStart <= close &&
        structureDepth(masked, bodyLineStart) === 0;
      if (isTopLevelLine) {
        const isClosingLine = close >= lineStart && close <= lineEnd;
        const memberIndent = isClosingLine ? indent : (leading || indent);
        return source.slice(0, lineStart) +
          `${memberIndent}${memberName},${eol}` +
          source.slice(lineStart);
      }
    }

    let insertAt;
    let insertion;
    if (anchor) {
      insertAt = anchor.index;
      insertion = `${indent}${memberName},${eol}`;
    } else if (trailing) {
      insertAt = trailing.index;
      insertion = `${eol}${indent}${memberName},`;
    } else {
      insertAt = body.length;
      insertion = `${body.endsWith(eol) ? '' : eol}${indent}${memberName},`;
    }

    const updatedBody = body.slice(0, insertAt) + insertion + body.slice(insertAt);
    return source.slice(0, open + 1) + updatedBody + source.slice(close);
  }

  // Compact arrays stay compact. The mask has the same length as the source, so an
  // active `before` identifier can be located without matching one inside a comment.
  const escapedBefore = before ? escapeRegExp(before) : null;
  const anchor = escapedBefore ? new RegExp(`\\b${escapedBefore}\\b`).exec(masked) : null;
  let updatedBody;
  if (anchor) {
    updatedBody = body.slice(0, anchor.index) + `${memberName}, ` + body.slice(anchor.index);
  } else {
    const contentEnd = body.search(/\s*$/);
    const prefix = body.slice(0, contentEnd);
    const suffix = body.slice(contentEnd);
    const activePrefix = masked.slice(0, contentEnd).trim();
    const separator = activePrefix
      ? (activePrefix.endsWith(',') ? ' ' : ', ')
      : (prefix.trim() ? ' ' : '');
    updatedBody = `${prefix}${separator}${memberName}${suffix}`;
  }
  return source.slice(0, open + 1) + updatedBody + source.slice(close);
}

/**
 * Read named patch leaves from a scene array, including recursive nested groups.
 * Inline expressions and factory calls intentionally have no source-level leaf name.
 */
export function sceneMemberNames(source, sceneName) {
  if (!isIdentifier(sceneName)) return [];
  const declaration = new RegExp(
    `\\b(?:const|let|var)\\s+${escapeRegExp(sceneName)}\\s*=\\s*\\[`,
  ).exec(source);
  if (!declaration) return [];
  const open = declaration.index + declaration[0].lastIndexOf('[');
  const close = matchingSquareBracket(source, open);
  if (close === -1) return [];

  const collect = (body) => {
    const names = [];
    const masked = maskCommentsAndStrings(body);
    const entries = [];
    let start = 0;
    let square = 0;
    let round = 0;
    let curly = 0;
    for (let index = 0; index <= masked.length; index++) {
      const ch = masked[index];
      if (ch === '[') square += 1;
      else if (ch === ']') square -= 1;
      else if (ch === '(') round += 1;
      else if (ch === ')') round -= 1;
      else if (ch === '{') curly += 1;
      else if (ch === '}') curly -= 1;
      if ((ch === ',' || index === masked.length) && square === 0 && round === 0 && curly === 0) {
        entries.push(masked.slice(start, index));
        start = index + 1;
      }
    }

    for (const entry of entries) {
      const trimmed = entry.trim();
      if (isIdentifier(trimmed)) {
        names.push(trimmed);
        continue;
      }
      if (!trimmed.startsWith('[')) continue;
      const nestedClose = matchingSquareBracket(trimmed, 0);
      if (nestedClose === trimmed.length - 1) {
        names.push(...collect(trimmed.slice(1, nestedClose)));
      }
    }
    return names;
  };

  return collect(source.slice(open + 1, close));
}

function isIdentifier(value) {
  return typeof value === 'string' && /^[A-Za-z_$][\w$]*$/.test(value);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Structural nesting depth immediately before an offset in masked source. */
function structureDepth(source, end) {
  let depth = 0;
  for (let i = 0; i < Math.max(0, end); i++) {
    if (source[i] === '(' || source[i] === '[' || source[i] === '{') depth++;
    else if (source[i] === ')' || source[i] === ']' || source[i] === '}') {
      depth = Math.max(0, depth - 1);
    }
  }
  return depth;
}

/** Find the closing bracket while ignoring brackets inside comments and strings. */
function matchingSquareBracket(source, open) {
  let depth = 0;
  let i = open;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i + 2);
      i = end === -1 ? source.length : end + 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = skipString(source, i, ch);
      continue;
    }
    if (ch === '`') {
      i = skipTemplate(source, i);
      continue;
    }
    if (ch === '[') depth++;
    if (ch === ']' && --depth === 0) return i;
    i++;
  }
  return -1;
}

/** Replace comments and strings with spaces while retaining offsets and newlines. */
function maskCommentsAndStrings(source) {
  const chars = [...source];
  const blank = (start, end) => {
    for (let i = start; i < end; i++) if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
  };
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i + 2);
      const after = end === -1 ? source.length : end;
      blank(i, after);
      i = after;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const after = end === -1 ? source.length : end + 2;
      blank(i, after);
      i = after;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const after = skipString(source, i, ch);
      blank(i, after);
      i = after;
      continue;
    }
    if (ch === '`') {
      const after = skipTemplate(source, i);
      blank(i, after);
      i = after;
      continue;
    }
    i++;
  }
  return chars.join('');
}

/**
 * Put explicit scene cells after every patch cell.
 *
 * Library patches can be installed after a project already has a scene. Ordinary
 * JavaScript still evaluates top to bottom, so a scene such as `[checkerZoom, plasma]`
 * cannot appear before the cell that declares `laserFan`. Only marked cells move;
 * their contents and relative order within the patch/scene groups stay unchanged.
 *
 * @param {string} source
 * @returns {string}
 */
export function moveSceneCellsLast(source) {
  const cells = findCells(source);
  if (cells.length === 0) return source;
  const isScene = (cell) => /^scene\s+/.test(cell.label);
  const firstScene = cells.findIndex(isScene);
  const prefix = source.slice(0, cells[0].start).trimEnd();
  const sceneNeedsMoving = firstScene !== -1 && cells.slice(firstScene + 1).some((cell) => !isScene(cell));
  if (!prefix && !sceneNeedsMoving) return source;

  const ordered = sceneNeedsMoving
    ? [...cells.filter((cell) => !isScene(cell)), ...cells.filter(isScene)]
    : cells;
  const texts = ordered.map((cell) => cell.text.trim());

  // Comments before the first marker were invisible in structured mode, so a saved
  // project could appear to begin at line 9 or 18. A marker is only a comment; moving
  // that first marker above the preamble preserves JavaScript behavior while making
  // the first visible/editable cell honestly begin on line 1.
  if (prefix) {
    const first = texts[0];
    const markerEnd = first.indexOf('\n');
    const marker = markerEnd === -1 ? first : first.slice(0, markerEnd);
    const body = markerEnd === -1 ? '' : first.slice(markerEnd + 1).trimStart();
    texts[0] = [marker, prefix, body].filter(Boolean).join('\n');
  }

  const chunks = texts.filter(Boolean);
  return `${chunks.join('\n\n')}\n`;
}

/**
 * Evaluation blocks are explicit cells plus ordinary statements outside those cells.
 * @param {string} source
 * @returns {Block[]}
 */
export function findBlocks(source) {
  const cells = findCells(source);
  if (cells.length === 0) return findStatements(source);

  const outside = findStatements(source).filter(
    (statement) =>
      !cells.some((cell) => statement.start >= cell.start && statement.end <= cell.end),
  );
  return [...outside, ...cells]
    .filter((block) => block.text.trim() !== '')
    .sort((a, b) => a.start - b.start);
}

/** A statement can end on a newline after these; not after an operator or a comma. */
function endsStatement(prev) {
  return prev !== '' && !'+-*/%<>=&|^,.?:!~('.includes(prev);
}

function regexCanStartAfter(prev) {
  return prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev);
}

function skipString(source, i, quote) {
  i++;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote || ch === '\n') return i + 1;
    i++;
  }
  return i;
}

function skipTemplate(source, i) {
  i++;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '`') return i + 1;
    if (ch === '$' && source[i + 1] === '{') {
      let depth = 1;
      i += 2;
      while (i < source.length && depth > 0) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') depth--;
        else if (source[i] === '`') i = skipTemplate(source, i) - 1;
        i++;
      }
      continue;
    }
    i++;
  }
  return i;
}

/** Returns the index after the regex literal, or -1 if this `/` was division. */
function skipRegex(source, i) {
  let j = i + 1;
  let inClass = false;
  while (j < source.length) {
    const ch = source[j];
    if (ch === '\\') {
      j += 2;
      continue;
    }
    if (ch === '\n') return -1;
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) {
      j++;
      while (j < source.length && /[a-z]/i.test(source[j])) j++;
      return j;
    }
    j++;
  }
  return -1;
}

/**
 * The block containing `cursor`, or null if the cursor sits outside every block
 * (in which case the caller evaluates the whole buffer — the "smallest complete
 * program" fallback).
 * @param {string} source
 * @param {number} cursor
 */
export function blockAt(source, cursor) {
  const blocks = findBlocks(source);
  for (const block of blocks) {
    if (cursor >= block.start && cursor <= block.end) return block;
  }
  // Cursor past the last character, or in trailing whitespace: use the last block.
  if (blocks.length && cursor >= blocks[blocks.length - 1].end) return blocks[blocks.length - 1];
  return null;
}

/** Readable name for a declaration or command block. */
export function describeBlock(text) {
  const cell = /^\/\/\s*%%\s*([^\n]*)/m.exec(text);
  if (cell?.[1].trim()) return cell[1].trim();

  const declaration = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(\[|\{|new\b)/.exec(text);
  if (declaration) return `${declaration[2] === '[' ? 'scene' : 'strategy'} ${declaration[1]}`;

  const classDeclaration = /\bclass\s+([A-Za-z_$][\w$]*)/.exec(text);
  if (classDeclaration) return `class ${classDeclaration[1]}`;

  const activateCommand = /\bactivate\s*\(\s*([A-Za-z_$][\w$]*)/.exec(text);
  if (activateCommand) return `activate ${activateCommand[1]}`;

  const namedCommand = /\b(?:control|param)\s*\(\s*["'`]([^"'`]+)["'`]/.exec(text);
  if (namedCommand) return `control ${namedCommand[1]}`;

  const objectCommand = /\breset\s*\(\s*([A-Za-z_$][\w$]*)/.exec(text);
  if (objectCommand) return `reset ${objectCommand[1]}`;
  return 'block';
}
