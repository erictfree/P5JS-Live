// Editor view — renders and edits source, then emits evaluation intents.
// Source structure lives in ../language/sourceBlocks.js so the runtime never depends
// on a DOM view module.

import {
  findBlocks,
  blockAt,
  describeBlock,
  insertSceneMember,
  moveSceneCellsLast,
} from '../language/sourceBlocks.js';
import { tokenizeLines } from './highlight.js';
import { tidySource } from './tidy.js';
import { changedLineNumbers } from './sourceDiff.js';

const INDENT = '  ';
const PAIRS = { '{': '}', '[': ']', '(': ')' };
const PATCH_NAME = /^[A-Za-z_$][\w$]*$/;
const RESERVED_PATCH_NAMES = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false',
  'finally', 'for', 'function', 'if', 'implements', 'import', 'in', 'instanceof',
  'interface', 'let', 'new', 'null', 'package', 'private', 'protected', 'public',
  'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof',
  'var', 'void', 'while', 'with', 'yield',
  // These are evaluator-provided bindings, so declaring one in a cell would collide
  // with the live-coding API even though it is a legal JavaScript identifier.
  'activate', 'param', 'reset', 'ShaderChain', 'StreamRoom',
]);

/** VS Code-style movement of the current line or selected consecutive lines. */
export function moveLines(source, selectionStart, selectionEnd, direction) {
  const lines = source.split('\n');
  const beforeStart = source.slice(0, selectionStart);
  const startLine = beforeStart.split('\n').length - 1;
  const effectiveEnd = selectionEnd > selectionStart && source[selectionEnd - 1] === '\n'
    ? selectionEnd - 1
    : selectionEnd;
  const endLine = source.slice(0, effectiveEnd).split('\n').length - 1;
  if (direction < 0 && startLine === 0) return null;
  if (direction > 0 && endLine >= lines.length - 1) return null;

  const selected = lines.splice(startLine, endLine - startLine + 1);
  const destination = direction < 0 ? startLine - 1 : startLine + 1;
  const adjacentLength = direction < 0
    ? lines[destination].length + 1
    : lines[startLine].length + 1;
  lines.splice(destination, 0, ...selected);
  const delta = direction < 0 ? -adjacentLength : adjacentLength;
  return {
    source: lines.join('\n'),
    selectionStart: selectionStart + delta,
    selectionEnd: selectionEnd + delta,
  };
}

function patchScaffold(name) {
  return `// %% patch ${name}\n\nconst ${name} = {\n  draw({ time, audio }) {\n    \n  },\n};`;
}

function declaredName(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b(?:const|let|var|class|function)\\s+${escaped}\\b`).test(source);
}

function isPatchBlock(block, name) {
  const label = describeBlock(block.text);
  return label === `strategy ${name}` || label === `patch ${name}`;
}

/** `scene[2]` is the scene-local identity of an anonymous array entry. */
function inlineSceneName(name) {
  return /^(.*)\[(\d+)\]$/.exec(name)?.[1] ?? null;
}

/**
 * Wire a textarea up as the live-coding surface.
 * @param {HTMLTextAreaElement} textarea
 * @param {{ onEvaluate: (source: string, label: string) => {ok: boolean}, onChange?: (source: string) => void, onEscape?: () => void, mirror?: HTMLElement | null, lineNumbers?: HTMLElement | null, foldControls?: HTMLElement | null, foldedView?: HTMLElement | null, onFoldChange?: (folded: boolean) => void }} handlers
 */
export function createEditor(textarea, handlers) {
  // The element that paints the text and the box behind each line. The textarea stays
  // the source of truth; this is only ever written to. Optional, so the editor still
  // works headless and in the unit tests, which have no such element.
  const mirror = handlers.mirror ?? null;
  const lineNumbers = handlers.lineNumbers ?? null;
  const foldControls = handlers.foldControls ?? null;
  const foldedView = handlers.foldedView ?? null;
  let mirrored = null;
  let numberedLines = 0;
  let foldedSource = null;
  let folded = false;
  let staged = null;
  let suppressChangeNotifications = 0;
  const openFolds = new Set();
  let foldControlSignature = '';
  // Library buttons take focus before their click handlers run. Preserve the last
  // collapsed editor caret as a source offset so a blank line can remain an explicit
  // insertion point in either the complete or structured presentation.
  let lastSourceCaret = null;

  function rememberTextareaCaret() {
    lastSourceCaret = textarea.selectionStart === textarea.selectionEnd
      ? textarea.selectionStart
      : null;
  }
  /**
   * What each line currently in the mirror is painted as, parallel to its child nodes.
   *
   * The line's *text* is not enough to diff on: opening a block comment recolours
   * every line below it without changing a character of any of them, so the signature
   * has to be over the tokens.
   */
  let mirroredLines = [];
  const signature = (tokens) => tokens.map((t) => `${t.kind}\u0000${t.text}`).join('\u0001');
  const codeLineHeight = () => {
    const value = Number.parseFloat(getComputedStyle(textarea).lineHeight);
    return Number.isFinite(value) ? value : 22;
  };

  /** One line of the mirror: the box, and the coloured spans inside it. */
  function buildLine(tokens, lineIndex = -1) {
    const line = document.createElement('span');
    if (staged?.changedLines.has(lineIndex)) line.classList.add('ai-changed-line');
    for (const token of tokens) {
      // Uncoloured runs are text nodes, not elements. Most of a file is punctuation,
      // whitespace and ordinary names, so this is what keeps a keystroke from
      // building a thousand elements.
      if (token.kind === 'text') {
        line.append(token.text);
        continue;
      }
      const span = document.createElement('span');
      span.className = `t-${token.kind}`;
      span.textContent = token.text;
      line.append(span);
    }
    return line;
  }

  /**
   * Repaint the mirror: one block element per line, each sized to its own text.
   *
   * Only lines whose text actually changed are rebuilt. Typing changes one line, so
   * an edit costs one line's worth of tokenizing and DOM rather than the buffer's —
   * which matters because this runs on every keystroke, and a performer is typing
   * while sixty frames a second are being drawn underneath.
   */
  function syncMirror() {
    const source = textarea.value;
    syncLineNumbers(source);
    syncFoldControls(source);
    if (folded) renderFolded(source);
    if (mirror && source !== mirrored) {
      mirrored = source;
      // Tokenized whole, never line by line: a block comment or a template literal
      // spans lines, and a line scanned on its own would not know it was inside one.
      // Scanning the buffer is a string walk and cheap; the DOM below is the cost, and
      // that is what the diff avoids.
      const tokenLines = tokenizeLines(source);
      const previous = mirror.childNodes;
      const signatures = tokenLines.map((tokens, index) =>
        `${staged?.changedLines.has(index) ? 'changed' : 'same'}\u0002${signature(tokens)}`,
      );
      const next = tokenLines.map((tokens, index) =>
        signatures[index] === mirroredLines[index] && previous[index]
          ? previous[index]
          : buildLine(tokens, index),
      );
      mirror.replaceChildren(...next);
      mirroredLines = signatures;
    }
    syncScroll();
  }

  /** Rebuild only when the line count changes; edits within a line cost nothing here. */
  function syncLineNumbers(source) {
    if (!lineNumbers) return;
    const count = source.split('\n').length;
    if (count === numberedLines) return;
    numberedLines = count;
    lineNumbers.textContent = Array.from({ length: count }, (_, index) => index + 1).join('\n');
  }

  /**
   * Pick the real source line that best identifies a folded cell.
   *
   * Explicit cells stay anchored to their marker so closing and opening a cell never
   * changes the row's line number. Unmarked top-level JavaScript still follows the
   * VS Code convention of previewing its declaration line.
   */
  function foldPreview(block, firstLine) {
    const lines = block.text.replace(/\n$/, '').split('\n');
    const description = describeBlock(block.text).replace(/^strategy\s+/, 'patch ');
    // A marked cell is one source region, so its closed and open presentations must
    // anchor to the same first line. Previously the closed row borrowed a declaration
    // from deep inside the cell (line 112 for Plasma), then opening it jumped back to
    // the marker (line 9). That was source-accurate in isolation but not a valid fold.
    if (/^\/\/\s*%%\s+/.test(lines[0] ?? '')) {
      return {
        description,
        index: 0,
        line: firstLine,
        preview: `${lines[0].trim()}  …`,
      };
    }
    const named = /^(?:patch|scene|class)\s+([A-Za-z_$][\w$]*)$/.exec(description);
    const escaped = named?.[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const declaration = escaped
      ? new RegExp(`^\\s*(?:const|let|var)\\s+${escaped}\\b`)
      : null;
    let index = declaration ? lines.findIndex((line) => declaration.test(line)) : -1;

    if (index === -1 && description.startsWith('class ')) {
      index = lines.findIndex((line) => /^\s*class\s+/.test(line));
    }
    if (index === -1) {
      index = lines.findIndex((line) => {
        const text = line.trim();
        return text !== '' && !text.startsWith('//') && !text.startsWith('/*') && text !== '*/';
      });
    }
    if (index === -1) index = 0;

    const original = lines[index] ?? '';
    const code = original.trimStart().trimEnd();
    let preview = code;
    if (/\{\s*$/.test(code)) {
      const close = /\bnew\s+[A-Za-z_$][\w$]*\s*\(\{$/.test(code)
        ? '});'
        : /^(?:const|let|var)\b/.test(code)
          ? '};'
          : '}';
      preview = `${code} … ${close}`;
    } else if (lines.length > 1) {
      preview = `${code}  …`;
    }

    return {
      description,
      index,
      line: firstLine + index,
      preview,
    };
  }

  /** Stable identities and declaration lines shared by both editor presentations. */
  function foldEntries(source) {
    const occurrences = new Map();
    return findBlocks(source).map((block) => {
      const firstLine = source.slice(0, block.start).split('\n').length;
      const preview = foldPreview(block, firstLine);
      const occurrence = occurrences.get(preview.description) ?? 0;
      occurrences.set(preview.description, occurrence + 1);
      return {
        block,
        firstLine,
        preview,
        foldKey: `${preview.description}:${occurrence}`,
      };
    });
  }

  /**
   * The complete textarea stays available, but it is no longer a folding dead end.
   * Each top-level object/function/class/scene gets a gutter disclosure at the line
   * that identifies it. Folding there returns to the structured editor with every
   * other block still expanded.
   */
  function syncFoldControls(source) {
    if (!foldControls) return;
    const entries = foldEntries(source);
    const signature = `${codeLineHeight()}|${entries.map(({ foldKey, preview }) => `${foldKey}@${preview.line}`).join('|')}`;
    if (signature === foldControlSignature) return;
    foldControlSignature = signature;

    const controls = entries.map((entry) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'raw-fold-control';
      button.textContent = '▾';
      button.style.setProperty('--fold-line-top', `${10 + (entry.preview.line - 1) * codeLineHeight()}px`);
      button.setAttribute('aria-label', `Fold ${entry.preview.description}`);
      button.title = `Fold ${entry.preview.description}`;
      button.addEventListener('click', () => {
        openFolds.clear();
        for (const candidate of foldEntries(textarea.value)) openFolds.add(candidate.foldKey);
        openFolds.delete(entry.foldKey);
        foldedSource = null;
        setFolded(true);
      });
      return button;
    });
    foldControls.replaceChildren(...controls);
  }

  /** Resolve a fold after earlier cells have changed length. */
  function blockForFoldKey(source, foldKey) {
    return foldEntries(source).find((entry) => entry.foldKey === foldKey)?.block ?? null;
  }

  /** Browser-native text insertion keeps undo available inside a folded cell. */
  function replaceFoldedRange(target, from, to, text, selectionStart, selectionEnd = selectionStart) {
    target.focus();
    target.setSelectionRange(from, to);
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, text);
    } catch {
      /* falls through */
    }
    if (!inserted) {
      target.setRangeText(text, from, to, 'end');
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
    target.setSelectionRange(selectionStart, selectionEnd);
  }

  function smartNewlineIn(target) {
    const { value, selectionStart: from, selectionEnd: to } = target;
    const lineStart = value.lastIndexOf('\n', from - 1) + 1;
    const lineEndAt = value.indexOf('\n', to);
    const lineEnd = lineEndAt === -1 ? value.length : lineEndAt;
    const left = value.slice(lineStart, from);
    const right = value.slice(to, lineEnd);
    const base = left.match(/^[\t ]*/)?.[0] ?? '';
    const opener = left.trimEnd().at(-1);
    const closer = right.trimStart()[0];

    if (opener && Object.hasOwn(PAIRS, opener) && PAIRS[opener] === closer) {
      const rightPadding = right.length - right.trimStart().length;
      const inserted = `\n${base}${INDENT}\n${base}`;
      replaceFoldedRange(target, from, to + rightPadding, inserted, from + 1 + base.length + INDENT.length);
      return;
    }
    const nextIndent = opener && Object.hasOwn(PAIRS, opener) ? `${base}${INDENT}` : base;
    const inserted = `\n${nextIndent}`;
    replaceFoldedRange(target, from, to, inserted, from + inserted.length);
  }

  function indentIn(target, outdent = false) {
    const { value, selectionStart: start, selectionEnd: end } = target;
    if (start === end && !outdent) {
      replaceFoldedRange(target, start, end, INDENT, start + INDENT.length);
      return;
    }
    const from = value.lastIndexOf('\n', start - 1) + 1;
    const effectiveEnd = end > start && value[end - 1] === '\n' ? end - 1 : end;
    const newline = value.indexOf('\n', effectiveEnd);
    const to = newline === -1 ? value.length : newline;
    const original = value.slice(from, to);
    const transformed = original
      .split('\n')
      .map((line) => (outdent ? removeIndent(line) : `${INDENT}${line}`))
      .join('\n');
    replaceFoldedRange(target, from, to, transformed, from, from + transformed.length);
  }

  function toggleCommentsIn(target) {
    const { value, selectionStart: start, selectionEnd: end } = target;
    const from = value.lastIndexOf('\n', start - 1) + 1;
    const effectiveEnd = end > start && value[end - 1] === '\n' ? end - 1 : end;
    const newline = value.indexOf('\n', effectiveEnd);
    const to = newline === -1 ? value.length : newline;
    const lines = value.slice(from, to).split('\n');
    const nonblank = lines.filter((line) => line.trim() !== '');
    const uncomment = nonblank.length > 0 && nonblank.every((line) => /^\s*\/\//.test(line));
    const transformed = lines.map((line) => {
      if (line.trim() === '') return line;
      const indent = line.match(/^\s*/)?.[0] ?? '';
      const rest = line.slice(indent.length);
      if (uncomment) return `${indent}${rest.slice(rest.startsWith('// ') ? 3 : 2)}`;
      return `${indent}// ${rest}`;
    }).join('\n');
    replaceFoldedRange(target, from, to, transformed, from, from + transformed.length);
  }

  function remapOffset(before, after, offset) {
    const line = before.slice(0, offset).split('\n').length - 1;
    const beforeStart = before.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
    const beforeLine = before.slice(beforeStart, before.indexOf('\n', beforeStart) === -1
      ? before.length
      : before.indexOf('\n', beforeStart));
    const contentColumn = Math.max(
      0,
      offset - beforeStart - (beforeLine.match(/^[\t ]*/)?.[0].length ?? 0),
    );
    const afterLines = after.split('\n');
    const targetLine = Math.min(line, afterLines.length - 1);
    const afterStart = afterLines.slice(0, targetLine).reduce((sum, value) => sum + value.length + 1, 0);
    const afterLine = afterLines[targetLine] ?? '';
    const afterIndent = afterLine.match(/^[\t ]*/)?.[0].length ?? 0;
    return afterStart + Math.min(afterLine.length, afterIndent + contentColumn);
  }

  function tidyIn(target) {
    const before = target.value;
    const after = tidySource(before);
    if (after === before) return false;
    const start = remapOffset(before, after, target.selectionStart);
    const end = remapOffset(before, after, target.selectionEnd);
    replaceFoldedRange(target, 0, before.length, after, start, end);
    return true;
  }

  function patchNameProblem(name) {
    if (!name) return 'Enter a patch name.';
    if (!PATCH_NAME.test(name)) return 'Use a JavaScript name such as ripple or myPatch.';
    if (RESERVED_PATCH_NAMES.has(name)) return `${name} is reserved. Choose another name.`;
    if (declaredName(textarea.value, name)) return `${name} is already defined in this project.`;
    return '';
  }

  /** Insert a complete object patch at one folded-cell boundary and focus draw(). */
  function createPatchAt(name, at) {
    const problem = patchNameProblem(name);
    if (problem) return { ok: false, problem };

    const source = textarea.value;
    const safeAt = Math.max(0, Math.min(source.length, at));
    const before = source.slice(0, safeAt);
    const after = source.slice(safeAt);
    const leading = before === '' || before.endsWith('\n\n')
      ? ''
      : before.endsWith('\n') ? '\n' : '\n\n';
    const scaffold = patchScaffold(name);
    const candidate = `${before}${leading}${scaffold}\n\n${after}`;
    const next = moveSceneCellsLast(candidate);

    // The name is unique, so its first fold identity is deterministic even if moving
    // scene cells changes its line number during insertion.
    openFolds.add(`patch ${name}:0`);
    foldedSource = null;
    write(next, true);
    changed();

    const target = findBlocks(textarea.value).find((block) => isPatchBlock(block, name));
    if (!target) return { ok: false, problem: 'The new patch could not be located.' };
    const drawBody = '  draw({ time, audio }) {\n    ';
    const localCaret = target.text.indexOf(drawBody) + drawBody.length;
    const caret = target.start + Math.max(0, localCaret);
    revealRange(caret);
    return { ok: true, name, caret };
  }

  /** A keyboard-accessible inline composer used before, between, and after cells. */
  function newPatchControl(at, position) {
    const row = document.createElement('div');
    row.className = 'folded-new-patch';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'folded-new-patch-button';
    button.textContent = '＋';
    button.setAttribute('aria-label', `New patch ${position}`);
    button.title = `Create a new object patch ${position}`;

    const begin = () => {
      row.classList.add('is-editing');
      const form = document.createElement('form');
      form.className = 'folded-new-patch-form';
      const input = document.createElement('input');
      input.className = 'folded-new-patch-name';
      input.type = 'text';
      input.placeholder = 'patchName';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.setAttribute('aria-label', 'New patch name');
      const create = document.createElement('button');
      create.type = 'submit';
      create.textContent = 'Create';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      const error = document.createElement('span');
      error.className = 'folded-new-patch-error';
      error.setAttribute('role', 'alert');

      const restore = () => {
        row.classList.remove('is-editing');
        row.replaceChildren(button);
        button.focus();
      };
      cancel.addEventListener('click', restore);
      input.addEventListener('input', () => {
        error.textContent = '';
        input.removeAttribute('aria-invalid');
      });
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        restore();
      });
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const result = createPatchAt(input.value.trim(), at);
        if (result.ok) return;
        error.textContent = result.problem;
        input.setAttribute('aria-invalid', 'true');
        input.focus();
      });

      form.append(input, create, cancel, error);
      row.replaceChildren(form);
      input.focus();
    };

    button.addEventListener('click', begin);
    row.append(button);
    return row;
  }

  /** A source-safe VS Code-like editor; the complete textarea remains the source of truth. */
  function renderFolded(source) {
    if (!foldedView || source === foldedSource) return;
    foldedSource = source;
    const entries = foldEntries(source);
    const blocks = entries.map(({ block, firstLine, preview, foldKey }) => {

      const details = document.createElement('details');
      details.className = 'folded-block';
      details.dataset.blockDescription = preview.description;
      details.dataset.foldKey = foldKey;
      const lastLine = firstLine - 1 + Math.max(0, block.text.split('\n').length - 1);
      details.classList.toggle(
        'ai-staged-block',
        Boolean(staged && [...staged.changedLines].some(
          (line) => line >= firstLine - 1 && line <= lastLine,
        )),
      );
      details.open = openFolds.has(foldKey);
      details.addEventListener('toggle', () => {
        if (details.open) openFolds.add(foldKey);
        else openFolds.delete(foldKey);
      });

      const summary = document.createElement('summary');
      const closedNumber = document.createElement('span');
      closedNumber.className = 'folded-line folded-closed';
      closedNumber.textContent = String(preview.line);
      const openNumber = document.createElement('span');
      openNumber.className = 'folded-line folded-open';
      openNumber.textContent = String(firstLine);

      const [beforeEllipsis, afterEllipsis = ''] = preview.preview.split('…');
      const closedCode = buildLine(tokenizeLines(beforeEllipsis)[0] ?? []);
      closedCode.className = 'folded-preview folded-closed';
      if (preview.preview.includes('…')) {
        const ellipsis = document.createElement('span');
        ellipsis.className = 'folded-ellipsis';
        ellipsis.textContent = '…';
        closedCode.append(ellipsis);
        const after = buildLine(tokenizeLines(afterEllipsis)[0] ?? []);
        closedCode.append(...after.childNodes);
      }
      const blockTokenLines = tokenizeLines(block.text);
      const openCode = buildLine(blockTokenLines[0] ?? []);
      openCode.className = 'folded-preview folded-open';
      const accessibleName = document.createElement('span');
      accessibleName.className = 'visually-hidden';
      accessibleName.textContent = preview.description;
      summary.append(closedNumber, openNumber, closedCode, openCode, accessibleName);

      const rawLines = block.text.split('\n');
      const terminalNewline = rawLines.at(-1) === '';
      if (rawLines.at(-1) === '') rawLines.pop();
      const expanded = document.createElement('div');
      expanded.className = 'folded-source';
      const bodyMirror = document.createElement('pre');
      bodyMirror.className = 'folded-source-mirror';
      const bodyNumbers = document.createElement('pre');
      bodyNumbers.className = 'folded-source-numbers';
      const bodyEditor = document.createElement('textarea');
      bodyEditor.className = 'folded-source-editor';
      bodyEditor.value = rawLines.slice(1).join('\n');
      bodyEditor.spellcheck = false;
      bodyEditor.wrap = 'off';
      bodyEditor.readOnly = Boolean(staged);
      bodyEditor.setAttribute('aria-label', `Edit ${preview.description}`);

      const rememberBodyCaret = () => {
        const current = blockForFoldKey(textarea.value, foldKey);
        if (!current || bodyEditor.selectionStart !== bodyEditor.selectionEnd) {
          lastSourceCaret = null;
          return;
        }
        const markerEnd = current.text.indexOf('\n');
        const bodyStart = markerEnd === -1 ? current.text.length : markerEnd + 1;
        lastSourceCaret = current.start + bodyStart + bodyEditor.selectionStart;
      };

      const syncBodyScroll = () => {
        if (bodyMirror.scrollLeft !== bodyEditor.scrollLeft) {
          bodyMirror.scrollLeft = bodyEditor.scrollLeft;
        }
        if (bodyMirror.scrollTop !== bodyEditor.scrollTop) bodyMirror.scrollTop = bodyEditor.scrollTop;
        if (bodyNumbers.scrollTop !== bodyEditor.scrollTop) bodyNumbers.scrollTop = bodyEditor.scrollTop;
      };

      const paintBody = () => {
        const tokenLines = tokenizeLines(bodyEditor.value);
        const sourceLines = bodyEditor.value.split('\n');
        const paintedLines = tokenLines.map((tokens, index) => {
          const line = buildLine(tokens, firstLine + index);
          const indent = (sourceLines[index]?.match(/^[\t ]*/)?.[0] ?? '')
            .replaceAll('\t', INDENT).length;
          for (let level = 0; level < Math.floor(indent / INDENT.length); level++) {
            const guide = document.createElement('span');
            guide.className = 'folded-indent-guide';
            guide.style.setProperty('--guide-level', String(level));
            line.prepend(guide);
          }
          return line;
        });
        bodyMirror.replaceChildren(...paintedLines);
        const count = Math.max(1, tokenLines.length);
        const current = blockForFoldKey(textarea.value, foldKey);
        const startLine = current
          ? textarea.value.slice(0, current.start).split('\n').length + 1
          : firstLine + 1;
        bodyNumbers.textContent = Array.from({ length: count }, (_, index) => startLine + index).join('\n');
        const height = `${count * codeLineHeight()}px`;
        expanded.style.height = height;
        bodyMirror.style.height = height;
        bodyNumbers.style.height = height;
        bodyEditor.style.height = height;
        syncBodyScroll();
      };

      bodyEditor.addEventListener('scroll', syncBodyScroll);

      bodyEditor.addEventListener('input', () => {
        const current = blockForFoldKey(textarea.value, foldKey);
        if (!current) return;
        const markerEnd = current.text.indexOf('\n');
        const marker = markerEnd === -1 ? `${current.text}\n` : current.text.slice(0, markerEnd + 1);
        const nextBlock = `${marker}${bodyEditor.value}${terminalNewline ? '\n' : ''}`;
        textarea.value = `${textarea.value.slice(0, current.start)}${nextBlock}${textarea.value.slice(current.end)}`;
        // Keep this DOM alive while the performer types. The hidden complete editor
        // and syntax mirror still update, but rebuilding the folded view would throw
        // away the caret on every keystroke.
        foldedSource = textarea.value;
        syncMirror();
        handlers.onChange?.(textarea.value);
        paintBody();
        rememberBodyCaret();
      });

      for (const eventName of ['focus', 'click', 'keyup', 'mouseup', 'select']) {
        bodyEditor.addEventListener(eventName, rememberBodyCaret);
      }

      bodyEditor.addEventListener('keydown', (event) => {
        const accel = event.metaKey || event.ctrlKey;
        if (event.altKey && !accel && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
          event.preventDefault();
          const moved = moveLines(
            bodyEditor.value,
            bodyEditor.selectionStart,
            bodyEditor.selectionEnd,
            event.key === 'ArrowUp' ? -1 : 1,
          );
          if (moved) {
            replaceFoldedRange(
              bodyEditor,
              0,
              bodyEditor.value.length,
              moved.source,
              moved.selectionStart,
              moved.selectionEnd,
            );
          }
          return;
        }
        if (
          (event.key === 'Backspace' || event.key === 'Delete') &&
          bodyEditor.selectionStart !== bodyEditor.selectionEnd
        ) {
          event.preventDefault();
          const from = bodyEditor.selectionStart;
          replaceFoldedRange(bodyEditor, from, bodyEditor.selectionEnd, '', from);
          return;
        }
        if (event.key === 'Enter' && accel) {
          event.preventDefault();
          const current = blockForFoldKey(textarea.value, foldKey);
          const result = event.shiftKey
            ? handlers.onEvaluate(textarea.value, 'buffer')
            : handlers.onEvaluate(current?.text ?? bodyEditor.value, current ? describeBlock(current.text) : preview.description);
          // In the structured editor the complete mirror is intentionally hidden.
          // Flash the source the performer can actually see, or Cmd/Ctrl+Enter feels
          // as though it did nothing even though the evaluation succeeded.
          flash(result.ok, [bodyMirror]);
          return;
        }
        if ((event.key === '/' || event.code === 'Slash') && accel) {
          event.preventDefault();
          toggleCommentsIn(bodyEditor);
          return;
        }
        if (accel && event.altKey && (event.code === 'KeyT' || event.key.toLowerCase() === 't')) {
          event.preventDefault();
          tidyIn(bodyEditor);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          bodyEditor.blur();
          handlers.onEscape?.();
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          smartNewlineIn(bodyEditor);
          return;
        }
        if (Object.values(PAIRS).includes(event.key) && bodyEditor.selectionStart === bodyEditor.selectionEnd) {
          const at = bodyEditor.selectionStart;
          const lineStart = bodyEditor.value.lastIndexOf('\n', at - 1) + 1;
          const prefix = bodyEditor.value.slice(lineStart, at);
          if (/^[\t ]+$/.test(prefix)) {
            event.preventDefault();
            const inserted = `${removeIndent(prefix)}${event.key}`;
            replaceFoldedRange(bodyEditor, lineStart, at, inserted, lineStart + inserted.length);
            return;
          }
        }
        if (event.key === 'Tab') {
          event.preventDefault();
          indentIn(bodyEditor, event.shiftKey);
        }
      });

      // When focus leaves all folded cell editors, repaint from the authoritative
      // source so declaration previews and later line numbers reflect the edit.
      bodyEditor.addEventListener('blur', () => {
        rememberBodyCaret();
        setTimeout(() => {
          if (!folded || foldedView.querySelector('.folded-source-editor:focus')) return;
          foldedSource = null;
          renderFolded(textarea.value);
        }, 0);
      });

      expanded.append(bodyNumbers, bodyMirror, bodyEditor);
      paintBody();

      details.append(summary, expanded);
      return details;
    });

    const rows = [];
    entries.forEach((entry, index) => {
      const position = index === 0
        ? `before ${entry.preview.description}`
        : `between ${entries[index - 1].preview.description} and ${entry.preview.description}`;
      rows.push(newPatchControl(entry.block.start, position), blocks[index]);
    });
    if (entries.length > 0) {
      rows.push(newPatchControl(source.length, `after ${entries.at(-1).preview.description}`));
    } else {
      const empty = document.createElement('div');
      empty.className = 'folded-empty-project';
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = 'No code cells yet.';
      empty.append(hint, newPatchControl(0, 'in the empty project'));
      rows.push(empty);
    }
    foldedView.replaceChildren(...rows);
  }

  function setFolded(next) {
    const wasFolded = folded;
    folded = Boolean(next && foldedView);
    textarea.parentElement?.classList.toggle('is-folded', folded);
    // The inline cell editor may have changed a declaration preview. Force a fresh
    // projection when the performer next returns from the complete buffer.
    if (wasFolded && !folded) foldedSource = null;
    if (folded) renderFolded(textarea.value);
    handlers.onFoldChange?.(folded);
    return folded;
  }

  function foldAll() {
    openFolds.clear();
    foldedSource = null;
    setFolded(true);
  }

  function unfoldAll() {
    openFolds.clear();
    for (const entry of foldEntries(textarea.value)) openFolds.add(entry.foldKey);
    foldedSource = null;
    setFolded(true);
  }

  // A structured project is several independent textareas, one per open cell. Native
  // selection cannot cross those fields, so Cmd/Ctrl+A inside one of them used to
  // paint a convincing selection that was only the current cell. Move to the single
  // authoritative textarea before selecting all; Delete, Cut, paste-over-selection,
  // and undo then retain their ordinary browser behavior over the complete project.
  foldedView?.addEventListener('keydown', (event) => {
    const accel = event.metaKey || event.ctrlKey;
    if (!accel || event.altKey || event.key.toLowerCase() !== 'a') return;
    event.preventDefault();
    setFolded(false);
    textarea.focus();
    textarea.select();
  });

  function revealRange(start, end = start) {
    // Navigation should respect the presentation the performer chose. In structured
    // mode, open only the containing cell and put the caret in its inline editor;
    // switching to the complete textarea here used to make Add to scene unfold the
    // entire project.
    if (folded && foldedView) {
      const entry = foldEntries(textarea.value).find(
        ({ block }) => start >= block.start && start < block.end,
      );
      if (entry) {
        openFolds.add(entry.foldKey);
        foldedSource = null;
        renderFolded(textarea.value);

        const details = [...foldedView.querySelectorAll('.folded-block')].find(
          (candidate) => candidate.dataset.foldKey === entry.foldKey,
        );
        const inlineEditor = details?.querySelector('.folded-source-editor');
        if (details && inlineEditor) {
          const firstLineEnd = entry.block.text.indexOf('\n');
          const bodyStart = firstLineEnd === -1 ? entry.block.text.length : firstLineEnd + 1;
          const relativeStart = Math.max(
            0,
            Math.min(inlineEditor.value.length, start - entry.block.start - bodyStart),
          );
          const relativeEnd = Math.max(
            relativeStart,
            Math.min(inlineEditor.value.length, end - entry.block.start - bodyStart),
          );
          details.scrollIntoView({ block: 'center', inline: 'nearest' });
          inlineEditor.focus({ preventScroll: true });
          inlineEditor.setSelectionRange(relativeStart, relativeEnd);
          lastSourceCaret = start === end ? start : null;
          return;
        }
      }
    }

    setFolded(false);
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(start, end);
    lastSourceCaret = start === end ? start : null;
    const line = textarea.value.slice(0, start).split('\n').length - 1;
    const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 22;
    textarea.scrollTop = Math.max(0, line * lineHeight - textarea.clientHeight * 0.25);
    syncScroll();
  }

  /**
   * Drag the mirror to wherever the textarea has scrolled to.
   *
   * The mirror does not scroll itself; the textarea is the element the browser
   * actually scrolls, and this copies that across. Cheap enough to call on a frame:
   * two comparisons, and it only writes when something moved.
   */
  function syncScroll() {
    if (mirror) {
      if (mirror.scrollTop !== textarea.scrollTop) mirror.scrollTop = textarea.scrollTop;
      if (mirror.scrollLeft !== textarea.scrollLeft) mirror.scrollLeft = textarea.scrollLeft;
    }
    if (lineNumbers && lineNumbers.scrollTop !== textarea.scrollTop) {
      lineNumbers.scrollTop = textarea.scrollTop;
    }
    foldControls?.style.setProperty('--fold-scroll-y', `${textarea.scrollTop}px`);
  }

  /** A replacement project has no meaningful caret, scroll, or open-cell position. */
  function resetNavigation() {
    openFolds.clear();
    lastSourceCaret = 0;
    textarea.setSelectionRange(0, 0);
    textarea.scrollTop = 0;
    textarea.scrollLeft = 0;

    const foldedScroller = foldedView?.parentElement;
    if (foldedScroller) {
      foldedScroller.scrollTop = 0;
      foldedScroller.scrollLeft = 0;
    }

    foldControlSignature = '';
    foldedSource = null;
    syncMirror();

    // Repainting a structured project replaces its rows. Reassert the origin after
    // that layout so a large preceding project cannot leave the new one off-screen.
    if (foldedScroller) {
      foldedScroller.scrollTop = 0;
      foldedScroller.scrollLeft = 0;
    }
  }

  /**
   * Replace the complete project outside the browser's active text-edit transaction.
   *
   * A performance recall can originate in an inline folded-cell textarea. Running
   * execCommand while that textarea is still dispatching the shortcut, then replacing
   * its DOM and attempting to refocus it, can stall Safari's rendering process while
   * media audio continues. Whole-project changes deliberately start a new undo history,
   * so a direct authoritative assignment is both safer and semantically correct.
   */
  function replaceProjectSource(next) {
    const active = document.activeElement;
    if (active === textarea || foldedView?.contains(active)) active.blur();
    textarea.value = String(next);
    changed();
    resetNavigation();
  }

  function flash(ok, visibleTargets = []) {
    const targets = mirror ? [textarea, mirror, ...visibleTargets] : [textarea, ...visibleTargets];
    for (const node of targets) node.classList.remove('flash-ok', 'flash-bad');
    // Force a reflow so the class re-applies when evaluating twice in quick succession.
    void textarea.offsetWidth;
    for (const node of targets) node.classList.add(ok ? 'flash-ok' : 'flash-bad');
    setTimeout(() => {
      for (const node of targets) node.classList.remove('flash-ok', 'flash-bad');
    }, 160);
  }

  function evaluateCursorBlock() {
    const source = textarea.value;
    const block = blockAt(source, textarea.selectionStart);
    const text = block ? block.text : source;
    const label = block ? describeBlock(block.text) : 'buffer';
    const result = handlers.onEvaluate(text, label);
    flash(result.ok);
    return result;
  }

  function evaluateBuffer() {
    const result = handlers.onEvaluate(textarea.value, 'buffer');
    flash(result.ok);
    return result;
  }

  /** A patch can compile successfully and still throw when the next frame calls it. */
  function flashCodeError(name) {
    if (folded && foldedView) {
      const sceneName = inlineSceneName(name);
      const description = sceneName ? `scene ${sceneName}` : `patch ${name}`;
      const block = [...foldedView.querySelectorAll('.folded-block')].find(
        (candidate) => candidate.dataset.blockDescription === description,
      );
      if (block) {
        flash(false, [block]);
        return;
      }
    }
    flash(false);
  }

  function replaceRange(from, to, text, selectionStart, selectionEnd = selectionStart) {
    textarea.setSelectionRange(from, to);
    write(text);
    textarea.setSelectionRange(selectionStart, selectionEnd);
  }

  /** Preserve the current indentation and add one level after an opening delimiter. */
  function smartNewline() {
    const { value, selectionStart: from, selectionEnd: to } = textarea;
    const lineStart = value.lastIndexOf('\n', from - 1) + 1;
    const lineEndAt = value.indexOf('\n', to);
    const lineEnd = lineEndAt === -1 ? value.length : lineEndAt;
    const left = value.slice(lineStart, from);
    const right = value.slice(to, lineEnd);
    const base = left.match(/^[\t ]*/)?.[0] ?? '';
    const opener = left.trimEnd().at(-1);
    const closer = right.trimStart()[0];

    if (opener && Object.hasOwn(PAIRS, opener) && PAIRS[opener] === closer) {
      // Consume whitespace before the closer so it lands at the original level.
      const rightPadding = right.length - right.trimStart().length;
      const inserted = `\n${base}${INDENT}\n${base}`;
      replaceRange(from, to + rightPadding, inserted, from + 1 + base.length + INDENT.length);
      return;
    }

    const nextIndent = opener && Object.hasOwn(PAIRS, opener) ? `${base}${INDENT}` : base;
    const inserted = `\n${nextIndent}`;
    replaceRange(from, to, inserted, from + inserted.length);
  }

  function removeIndent(prefix) {
    if (prefix.startsWith('\t')) return prefix.slice(1);
    const spaces = Math.min(INDENT.length, prefix.match(/^ */)?.[0].length ?? 0);
    return prefix.slice(spaces);
  }

  /** Shift+Tab outdents lines; Tab indents a selection or inserts one level. */
  function indentSelection(outdent = false) {
    const { value, selectionStart: start, selectionEnd: end } = textarea;
    if (start === end && !outdent) {
      write(INDENT);
      return;
    }

    const from = value.lastIndexOf('\n', start - 1) + 1;
    const effectiveEnd = end > start && value[end - 1] === '\n' ? end - 1 : end;
    const newline = value.indexOf('\n', effectiveEnd);
    const to = newline === -1 ? value.length : newline;
    const original = value.slice(from, to);
    const lines = original.split('\n');
    const transformed = lines
      .map((line) => (outdent ? removeIndent(line) : `${INDENT}${line}`))
      .join('\n');

    if (start === end) {
      const removed = original.length - transformed.length;
      replaceRange(from, to, transformed, Math.max(from, start - removed));
    } else {
      replaceRange(from, to, transformed, from, from + transformed.length);
    }
  }

  /** Cmd/Ctrl+/ toggles `// ` on every selected line, preserving each line's indent. */
  function toggleLineComments() {
    const { value, selectionStart: start, selectionEnd: end } = textarea;
    const from = value.lastIndexOf('\n', start - 1) + 1;
    const effectiveEnd = end > start && value[end - 1] === '\n' ? end - 1 : end;
    const newline = value.indexOf('\n', effectiveEnd);
    const to = newline === -1 ? value.length : newline;
    const lines = value.slice(from, to).split('\n');
    const nonblank = lines.filter((line) => line.trim() !== '');
    const uncomment = nonblank.length > 0 && nonblank.every((line) => /^\s*\/\//.test(line));

    const changes = [];
    const transformed = lines
      .map((line) => {
        if (line.trim() === '') {
          changes.push({ at: 0, delta: 0 });
          return line;
        }
        const indent = line.match(/^\s*/)?.[0] ?? '';
        if (uncomment) {
          const rest = line.slice(indent.length);
          const markerLength = rest.startsWith('// ') ? 3 : 2;
          changes.push({ at: indent.length, delta: -markerLength });
          return `${indent}${rest.slice(markerLength)}`;
        }
        changes.push({ at: indent.length, delta: 3 });
        return `${indent}// ${line.slice(indent.length)}`;
      })
      .join('\n');

    if (start === end) {
      const lineIndex = value.slice(from, start).split('\n').length - 1;
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const column = start - lineStart;
      const change = changes[lineIndex];
      const shift = change && column >= change.at ? change.delta : 0;
      replaceRange(from, to, transformed, Math.max(lineStart, start + shift));
    } else {
      replaceRange(from, to, transformed, from, from + transformed.length);
    }
  }

  /** Tidy the cell or top-level statement under the cursor without evaluating it. */
  function tidyCursorBlock() {
    const target = blockAt(textarea.value, textarea.selectionStart) ?? {
      start: 0,
      end: textarea.value.length,
      text: textarea.value,
    };
    const after = tidySource(target.text);
    if (after === target.text) return false;
    const localStart = textarea.selectionStart - target.start;
    const localEnd = textarea.selectionEnd - target.start;
    const nextStart = target.start + remapOffset(target.text, after, localStart);
    const nextEnd = target.start + remapOffset(target.text, after, localEnd);
    textarea.setSelectionRange(target.start, target.end);
    write(after);
    textarea.setSelectionRange(nextStart, nextEnd);
    return true;
  }

  textarea.addEventListener('keydown', (event) => {
    const accel = event.metaKey || event.ctrlKey;

    if (event.altKey && !accel && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      const moved = moveLines(
        textarea.value,
        textarea.selectionStart,
        textarea.selectionEnd,
        event.key === 'ArrowUp' ? -1 : 1,
      );
      if (moved) {
        replaceRange(
          0,
          textarea.value.length,
          moved.source,
          moved.selectionStart,
          moved.selectionEnd,
        );
      }
      return;
    }

    // Chromium normally deletes a selected textarea range itself. Handle it here as
    // well because this transparent textarea sits over a separate syntax mirror, and
    // some Chrome/macOS paths leave the painted selection intact without performing
    // the native edit. `write()` still takes the browser insertion path when possible,
    // preserving undo and emitting the ordinary input notification.
    if (
      (event.key === 'Backspace' || event.key === 'Delete') &&
      textarea.selectionStart !== textarea.selectionEnd
    ) {
      event.preventDefault();
      const from = textarea.selectionStart;
      replaceRange(from, textarea.selectionEnd, '', from);
      return;
    }

    if (event.key === 'Enter' && accel) {
      event.preventDefault();
      // Focus stays exactly where it was.
      if (event.shiftKey) evaluateBuffer();
      else evaluateCursorBlock();
      return;
    }

    if ((event.key === '/' || event.code === 'Slash') && accel) {
      event.preventDefault();
      toggleLineComments();
      return;
    }

    if (accel && event.altKey && (event.code === 'KeyT' || event.key.toLowerCase() === 't')) {
      event.preventDefault();
      tidyCursorBlock();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      textarea.blur();
      handlers.onEscape?.();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      smartNewline();
      return;
    }

    // Outdent a closing delimiter typed on an otherwise blank indented line.
    if (Object.values(PAIRS).includes(event.key) && textarea.selectionStart === textarea.selectionEnd) {
      const { value, selectionStart: at } = textarea;
      const lineStart = value.lastIndexOf('\n', at - 1) + 1;
      const prefix = value.slice(lineStart, at);
      if (/^[\t ]+$/.test(prefix)) {
        event.preventDefault();
        const inserted = `${removeIndent(prefix)}${event.key}`;
        replaceRange(lineStart, at, inserted, lineStart + inserted.length);
        return;
      }
    }

    // A code surface where Tab moves focus is unusable; indent instead.
    if (event.key === 'Tab') {
      event.preventDefault();
      indentSelection(event.shiftKey);
    }
  });

  /**
   * Put text into the textarea without throwing away the browser's undo stack.
   *
   * Assigning `textarea.value` clears that stack outright in Chrome, so a single Tab
   * used to cost the performer every undo step they had built up — Cmd/Ctrl+Z after
   * an indent did nothing at all. `insertText` goes through the same path typing does,
   * so the edit joins the undo history instead of erasing it, and it raises `input`
   * itself, which is what keeps the mirror in step.
   *
   * It is a deprecated API with no replacement that preserves undo; when it is not
   * available the assignment is the fallback, because a correct buffer with no undo
   * beats an undo stack over the wrong text.
   *
   * @param {string} text replaces the selection, or the whole buffer when `all`
   * @param {boolean} all
   */
  function write(text, all = false, { notify = true } = {}) {
    if (!notify) suppressChangeNotifications++;
    const active = document.activeElement;
    const restore = active !== textarea ? active : null;
    const original = textarea.value;
    const originalFrom = textarea.selectionStart;
    const originalTo = textarea.selectionEnd;
    const expected = all
      ? text
      : `${original.slice(0, originalFrom)}${text}${original.slice(originalTo)}`;
    if (restore) textarea.focus();

    const { scrollTop } = textarea;
    if (all) textarea.select();

    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, text);
    } catch {
      /* falls through to the assignment below */
    }
    // A hidden textarea cannot always take focus from an inline folded-cell input.
    // Chromium can then return true after inserting into that input instead. Trust
    // the native path only when the authoritative source has the expected value.
    const usedNativeInsertion = inserted && textarea.value === expected;
    if (!usedNativeInsertion) {
      textarea.value = expected;
      if (!all) {
        textarea.selectionStart = textarea.selectionEnd = originalFrom + text.length;
      }
      changed();
    }

    // `insertText` leaves the caret after what it inserted, which for a whole-buffer
    // write is the very end — so the editor would open showing the last line of the
    // starter, and the next focus would jump there. Put it back at the top, which is
    // where replacing the buffer outright has always left it.
    if (all) {
      textarea.setSelectionRange(0, 0);
      textarea.scrollTop = scrollTop;
    }
    if (restore?.focus) restore.focus();
    if (!notify) suppressChangeNotifications--;
    return usedNativeInsertion;
  }

  /** Every path that alters the text goes through here, so the mirror cannot drift. */
  function changed() {
    syncMirror();
    if (suppressChangeNotifications === 0) handlers.onChange?.(textarea.value);
  }

  textarea.addEventListener('input', () => {
    rememberTextareaCaret();
    changed();
  });
  for (const eventName of ['focus', 'click', 'keyup', 'mouseup', 'select', 'blur']) {
    textarea.addEventListener(eventName, rememberTextareaCaret);
  }
  textarea.addEventListener('scroll', syncScroll);
  window.addEventListener('resize', syncMirror);

  /**
   * Follow the textarea's scroll on every frame, unconditionally.
   *
   * Listening for `scroll` is not enough, and the way it fails is specific: the
   * textarea scrolls the caret back into view on paths that do not always announce
   * themselves — a held arrow key repeating, a selection dragged past the edge, the
   * caret pushed off the bottom by typing. Miss one and the mirror stays parked while
   * the textarea has moved. The misses accumulate, so the further down the buffer the
   * performer has worked, the further the text is painted below where the caret is:
   * near the top it looks close to right, and by the bottom the caret is sitting
   * lines above the code it is actually in.
   *
   * A frame callback makes the worst case one frame of lag that then corrects itself,
   * rather than a desync that persists until some later event happens to fire. It
   * deliberately does not depend on focus: the wheel scrolls this without focusing it,
   * and a condition on when the alignment is maintained is a condition on when this
   * bug comes back. Two integer comparisons a frame is not a cost worth that risk.
   */
  if (mirror || lineNumbers) {
    const follow = () => {
      syncScroll();
      requestAnimationFrame(follow);
    };
    requestAnimationFrame(follow);
  }

  syncMirror();

  function refreshStagedPresentation() {
    textarea.readOnly = Boolean(staged);
    textarea.parentElement?.classList.toggle('is-ai-staged', Boolean(staged));
    mirrored = null;
    foldedSource = null;
    syncMirror();
  }

  /**
   * Put an AI proposal in the real source buffer without evaluating or saving it.
   * Follow-up proposals keep the same original base so Cancel is one transaction.
   */
  function stageSource(next) {
    const source = String(next ?? '');
    const current = textarea.value;
    if (!source.trim()) return { ok: false, reason: 'empty' };
    if (source === current) return { ok: true, changed: 0, unchanged: true };

    const base = staged?.base ?? current;
    const writes = (staged?.writes ?? 0) + 1;
    const nativeWrites = staged?.nativeWrites ?? 0;
    staged = {
      base,
      writes,
      nativeWrites,
      changedLines: changedLineNumbers(base, source),
    };

    textarea.readOnly = false;
    const native = write(source, true, { notify: false });
    if (native) staged.nativeWrites++;
    refreshStagedPresentation();
    return { ok: true, changed: staged.changedLines.size, source };
  }

  function cancelStagedSource() {
    if (!staged) return { ok: false, reason: 'not-staged' };
    const transaction = staged;
    const active = document.activeElement;
    textarea.readOnly = false;
    suppressChangeNotifications++;
    textarea.focus();
    for (let index = 0; index < transaction.nativeWrites; index++) {
      try {
        document.execCommand('undo');
      } catch {
        break;
      }
    }
    if (textarea.value !== transaction.base) textarea.value = transaction.base;
    suppressChangeNotifications--;
    staged = null;
    refreshStagedPresentation();
    active?.focus?.();
    return { ok: true, source: transaction.base };
  }

  function acceptStagedSource() {
    if (!staged) return { ok: false, phase: 'empty', error: new Error('No AI edit is staged') };
    const result = handlers.onEvaluate(textarea.value, 'AI proposal');
    flash(result.ok);
    if (!result.ok) return result;
    staged = null;
    refreshStagedPresentation();
    handlers.onChange?.(textarea.value);
    return result;
  }

  function appendSource(source) {
    const next = `${textarea.value.trimEnd()}\n\n${source.trim()}\n`;
    write(next, true);
    changed();
    return next;
  }

  /** Insert at a remembered blank line immediately between explicit top-level cells. */
  function insertPatchAtBlankLine(source, patchSource, at) {
    if (!Number.isInteger(at) || at < 0 || at > source.length) return null;
    const lineStart = source.lastIndexOf('\n', at - 1) + 1;
    const nextNewline = source.indexOf('\n', at);
    const lineEnd = nextNewline === -1 ? source.length : nextNewline;
    if (source.slice(lineStart, lineEnd).trim() !== '') return null;

    const afterLine = nextNewline === -1 ? lineEnd : lineEnd + 1;
    const remainder = source.slice(afterLine);
    const nextContent = remainder.search(/\S/);
    if (nextContent === -1 || !/^\/\/\s*%%\s+/.test(remainder.slice(nextContent))) return null;

    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    const patch = patchSource.trim();
    const prefix = source.slice(0, lineStart);
    const leading = prefix.trim() === '' ? '' : eol;
    const insertion = `${leading}${patch}${eol}${eol}`;
    return {
      source: prefix + insertion + source.slice(afterLine),
      caret: prefix.length + leading.length + patch.length + eol.length,
    };
  }

  /** Install at an explicit blank cell boundary, otherwise safely before scene cells. */
  function insertPatchSource(source) {
    const directed = insertPatchAtBlankLine(textarea.value, source, lastSourceCaret);
    const appended = directed?.source ?? `${textarea.value.trimEnd()}\n\n${source.trim()}\n`;
    const next = moveSceneCellsLast(appended);
    write(next, true);
    const caret = directed && next === directed.source ? directed.caret : 0;
    textarea.setSelectionRange(caret, caret);
    lastSourceCaret = caret;
    changed();
    return next;
  }

  function replaceNamedBlock(description, source) {
    const target = findBlocks(textarea.value).find((block) => {
      const label = describeBlock(block.text).replace(/^strategy\s+/, 'patch ');
      return label === description.replace(/^strategy\s+/, 'patch ');
    });
    if (!target) {
      if (/^(?:strategy|patch)\s+/.test(description)) insertPatchSource(source);
      else appendSource(source);
      return { replaced: false, source };
    }
    write(
      textarea.value.slice(0, target.start) + source + textarea.value.slice(target.end),
      true,
    );
    changed();
    return { replaced: true, source };
  }

  /** Update source composition only; evaluation remains an explicit live-coding step. */
  function addStrategyToScene(sceneName, strategyName, currentOrder = [], { before = null } = {}) {
    const insertion = before ? currentOrder.indexOf(before) : -1;
    const nextOrder = insertion === -1
      ? [...currentOrder, strategyName]
      : [...currentOrder.slice(0, insertion), strategyName, ...currentOrder.slice(insertion)];
    const declaration = `const ${sceneName} = [\n${nextOrder.map((name) => `  ${name},`).join('\n')}\n];`;
    const target = findBlocks(textarea.value).find(
      (block) => describeBlock(block.text) === `scene ${sceneName}`,
    );

    if (!target) {
      const source = `// %% scene ${sceneName}\n${declaration}\nactivate(${sceneName});`;
      appendSource(source);
    } else {
      const caret = Number.isInteger(lastSourceCaret) &&
        lastSourceCaret >= target.start &&
        lastSourceCaret < target.end
        ? lastSourceCaret - target.start
        : null;
      const updated = insertSceneMember(target.text, sceneName, strategyName, {
        before,
        at: caret,
      });
      if (updated === null) return { ok: false, reason: 'scene-declaration-not-found' };
      write(
        textarea.value.slice(0, target.start) + updated + textarea.value.slice(target.end),
        true,
      );
      changed();
    }

    const updatedTarget = findBlocks(textarea.value).find(
      (block) => describeBlock(block.text) === `scene ${sceneName}`,
    );
    if (updatedTarget) {
      const escaped = strategyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const inserted = new RegExp(`^[ \\t]*(${escaped})\\b`, 'm').exec(updatedTarget.text);
      const local = inserted
        ? inserted.index + inserted[0].lastIndexOf(strategyName)
        : updatedTarget.text.indexOf(`const ${sceneName}`);
      const start = updatedTarget.start + Math.max(0, local);
      revealRange(start, start + (inserted ? strategyName.length : 0));
    }
    return { ok: true, sceneName, order: nextOrder, source: updatedTarget?.text ?? declaration };
  }

  return {
    get value() {
      return textarea.value;
    },
    set value(next) {
      replaceProjectSource(next);
    },
    replaceProjectSource,
    focus: () => textarea.focus(),
    setFolded,
    foldAll,
    unfoldAll,
    toggleFolded: () => setFolded(!folded),
    isFolded: () => folded,
    hasStagedSource: () => Boolean(staged),
    stageSource,
    cancelStagedSource,
    acceptStagedSource,
    evaluateCursorBlock,
    evaluateBuffer,
    tidyCursorBlock,
    refreshLayout() {
      foldControlSignature = '';
      foldedSource = null;
      syncMirror();
    },
    flashCodeError,
    appendSource,
    insertPatchSource,
    replaceNamedBlock,
    addStrategyToScene,
    patchSource(name) {
      return findBlocks(textarea.value).find((block) => isPatchBlock(block, name))?.text ?? null;
    },
    currentPatchSource() {
      const at = folded && lastSourceCaret !== null ? lastSourceCaret : textarea.selectionStart;
      const block = blockAt(textarea.value, at);
      const description = block ? describeBlock(block.text) : '';
      const match = /^(?:strategy|patch)\s+([A-Za-z_$][\w$]*)$/.exec(description);
      return match ? { name: match[1], source: block.text.trimEnd() } : null;
    },
    /** Focus the binding that defines a strategy without changing source. */
    revealStrategy(name) {
      const sceneName = inlineSceneName(name);
      if (sceneName) return this.revealScene(sceneName);

      const target = findBlocks(textarea.value).find((block) => isPatchBlock(block, name));
      if (!target) return false;

      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const declaration = target.text.match(
        new RegExp(`\\b(?:const|let|var|function)\\s+(${escaped})\\b`),
      );
      const localStart = declaration
        ? declaration.index + declaration[0].lastIndexOf(name)
        : 0;
      const start = target.start + localStart;
      revealRange(start, start + (declaration ? name.length : 0));
      return true;
    },
    revealScene(name) {
      const target = findBlocks(textarea.value).find(
        (block) => describeBlock(block.text) === `scene ${name}`,
      );
      if (!target) return false;
      const localStart = Math.max(0, target.text.indexOf(`const ${name}`));
      revealRange(target.start + localStart, target.start + localStart + name.length + 6);
      return true;
    },
    /** Put a stored version back in the editor when the performer reverts. */
    replaceBlockFor(name, source) {
      const blocks = findBlocks(textarea.value);
      const sceneName = inlineSceneName(name);
      const target = blocks.find((block) =>
        sceneName
          ? describeBlock(block.text) === `scene ${sceneName}`
          : isPatchBlock(block, name));
      // Through `write` so a revert is itself undoable — putting an old version back
      // is exactly the kind of move a performer takes back a second later.
      write(
        target
          ? textarea.value.slice(0, target.start) + source + textarea.value.slice(target.end)
          : `${textarea.value.trimEnd()}\n\n${source}\n`,
        true,
      );
      changed();
    },
  };
}
