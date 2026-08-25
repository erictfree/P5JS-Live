// Syntax colouring for the code mirror.
//
// A scanner, not a parser — the same bargain `findBlocks` makes in editor.js and for
// the same reason: a wrong guess here costs a mis-coloured token, never a mis-run
// block, because nothing downstream reads this. The editor evaluates the textarea's
// text; this only decides what colour to paint it.
//
// It is pure and DOM-free so it can be tested in plain Node, which is where the rest
// of `tests/unit/` runs.

/** Words that are the language rather than the authored strategy. */
const KEYWORDS = new Set([
  'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default',
  'delete', 'do', 'else', 'export', 'extends', 'false', 'finally', 'for', 'function',
  'if', 'import', 'in', 'instanceof', 'let', 'new', 'null', 'of', 'return', 'super',
  'switch', 'this', 'throw', 'true', 'try', 'typeof', 'undefined', 'var', 'void',
  'while', 'yield',
]);

/**
 * p5js live's own vocabulary. Coloured apart from every other call because these
 * are the small command vocabulary around otherwise ordinary JavaScript objects.
 */
const HOST_API = new Set(['activate', 'reset', 'control', 'StreamRoom']);

/**
 * @typedef {'comment' | 'string' | 'number' | 'keyword' | 'host' | 'call' | 'text'} TokenKind
 * @typedef {{ kind: TokenKind, text: string }} Token
 */

/**
 * Split source into coloured tokens.
 *
 * Everything that is not worth a colour comes back as `text`, and adjacent `text`
 * runs are merged — the caller turns those into plain text nodes rather than
 * elements, which is most of what keeps the mirror cheap to rebuild.
 *
 * @param {string} source
 * @returns {Token[]}
 */
export function tokenize(source) {
  /** @type {Token[]} */
  const tokens = [];
  const n = source.length;
  let i = 0;
  let plain = 0; // start of the current uncoloured run

  const flushPlain = (end) => {
    if (end > plain) tokens.push({ kind: 'text', text: source.slice(plain, end) });
  };
  const push = (kind, end) => {
    flushPlain(i);
    tokens.push({ kind, text: source.slice(i, end) });
    i = end;
    plain = end;
  };

  while (i < n) {
    const ch = source[i];

    // --- comments -------------------------------------------------------------
    if (ch === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      push('comment', end === -1 ? n : end);
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      push('comment', end === -1 ? n : end + 2);
      continue;
    }

    // --- strings --------------------------------------------------------------
    if (ch === '"' || ch === "'") {
      push('string', endOfString(source, i, ch));
      continue;
    }
    if (ch === '`') {
      push('string', endOfTemplate(source, i));
      continue;
    }

    // --- numbers --------------------------------------------------------------
    if (isDigit(ch) || (ch === '.' && isDigit(source[i + 1]))) {
      let j = i;
      while (j < n && /[0-9a-fA-FxXoObB._]/.test(source[j])) j++;
      push('number', j);
      continue;
    }

    // --- words ----------------------------------------------------------------
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < n && /[\w$]/.test(source[j])) j++;
      const word = source.slice(i, j);

      if (KEYWORDS.has(word)) {
        push('keyword', j);
        continue;
      }
      if (HOST_API.has(word)) {
        push('host', j);
        continue;
      }
      // A name immediately followed by "(" is being called. That covers p5's whole
      // surface — circle, map, fill — without having to carry a list of it.
      if (source[j] === '(') {
        push('call', j);
        continue;
      }
      i = j;
      continue;
    }

    i++;
  }

  flushPlain(n);
  return tokens;
}

/**
 * The same tokens, split into one array per line.
 *
 * A comment or a template literal can span lines; those arrive here as one token and
 * are cut at each newline, so every line's tokens describe exactly that line's text
 * and the caller never has to carry state between them.
 *
 * @param {string} source
 * @returns {Token[][]}
 */
export function tokenizeLines(source) {
  /** @type {Token[][]} */
  const lines = [[]];

  for (const token of tokenize(source)) {
    const pieces = token.text.split('\n');
    pieces.forEach((piece, index) => {
      if (index > 0) lines.push([]);
      if (piece !== '') lines[lines.length - 1].push({ kind: token.kind, text: piece });
    });
  }

  return lines;
}

const isDigit = (ch) => ch >= '0' && ch <= '9';

function endOfString(source, i, quote) {
  let j = i + 1;
  while (j < source.length) {
    if (source[j] === '\\') {
      j += 2;
      continue;
    }
    // An unterminated string stops at the line end — mid-edit that is the common
    // case, and colouring the rest of the file as a string would be worse than
    // useless while you are typing the closing quote.
    if (source[j] === quote) return j + 1;
    if (source[j] === '\n') return j;
    j++;
  }
  return j;
}

function endOfTemplate(source, i) {
  let j = i + 1;
  while (j < source.length) {
    if (source[j] === '\\') {
      j += 2;
      continue;
    }
    if (source[j] === '`') return j + 1;
    j++;
  }
  return j;
}
