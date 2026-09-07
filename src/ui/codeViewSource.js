import { tokenizeLines } from './highlight.js';
import { findBlocks, describeBlock, findStatements } from '../language/sourceBlocks.js';

const KINDS = ['text', 'comment', 'string', 'number', 'keyword', 'call', 'host'];

// Read glyphs and their layout, not a screenshot. Editor chrome, backing boxes,
// selection fills and indentation guides never enter the scene image.
export function createEditorCodeSource({ textarea, mirror, foldedView, isFolded, lastRunSource }) {
  let documentSource = null;
  let blocks = [], statements = [];
  const textCache = new Map();
  const tokensFor = (key, source) => {
    let entry = textCache.get(key);
    if (entry?.source !== source) { entry = { source, tokens: tokenizeLines(source) }; textCache.set(key, entry); }
    return entry.tokens;
  };
  const domTokens = new WeakMap();
  function readTokens(element) {
    if (domTokens.has(element)) return domTokens.get(element);
    const tokens = [];
    const visit = (node, kind = 'text') => {
      if (node.nodeType === 3) { tokens.push({ kind, text: node.textContent }); return; }
      if (node.classList?.contains('folded-indent-guide')) return;
      const tokenKind = KINDS.find(key => node.classList?.contains(`t-${key}`)) ?? kind;
      for (const child of node.childNodes) visit(child, tokenKind);
    };
    visit(element);
    domTokens.set(element, tokens);
    return tokens;
  }

  return function readView(options) {
    const style = getComputedStyle(textarea);
    const fontSize = parseFloat(style.fontSize) || 15;
    const lineHeight = parseFloat(style.lineHeight) || 22;
    const viewport = textarea.parentElement.getBoundingClientRect();
    const colors = Object.fromEntries(KINDS.map(key => [key, style.getPropertyValue(`--code-${key}`).trim() || '#f2efff']));
    const view = { fontFamily: style.fontFamily || 'monospace', fontSize, lineHeight, colors, lines: [], cursor: null };

    if (options.patch !== undefined || options.source === 'lastRun') {
      let source = lastRunSource();
      if (options.patch !== undefined) {
        if (documentSource !== textarea.value) {
          documentSource = textarea.value;
          blocks = findBlocks(documentSource);
          statements = findStatements(documentSource);
          textCache.clear();
        }
        const name = options.patch;
        const declaration = new RegExp(`^\\s*(?:const|let|var|class|function)\\s+${name.replace(/\$/g, '\\$')}(?![\\w$])`);
        source = blocks.find(block => describeBlock(block.text) === `patch ${name}`)?.text
          ?? statements.find(block => declaration.test(block.text))?.text ?? '';
      }
      const scale = options.fontSize ? options.fontSize / fontSize : 1;
      const count = Math.ceil(viewport.height / scale / lineHeight);
      view.lines = tokensFor(options.patch ?? 'lastRun', source).slice(0, count).map((tokens, index) => ({ tokens, x: 24, y: 24 + index * lineHeight }));
      return view;
    }

    const intersects = (y, clip) => y + lineHeight > clip[1] && y < clip[1] + clip[3];
    function readMirror(pre, input, outerClip) {
      const rect = pre.getBoundingClientRect();
      const metrics = getComputedStyle(pre);
      const x = rect.left - viewport.left + parseFloat(metrics.paddingLeft) - input.scrollLeft;
      const y = rect.top - viewport.top + parseFloat(metrics.paddingTop) - input.scrollTop;
      const clip = [Math.max(outerClip[0], rect.left - viewport.left), Math.max(outerClip[1], rect.top - viewport.top), 0, 0];
      clip[2] = Math.min(outerClip[0] + outerClip[2], rect.right - viewport.left) - clip[0];
      clip[3] = Math.min(outerClip[1] + outerClip[3], rect.bottom - viewport.top) - clip[1];
      if (clip[2] <= 0 || clip[3] <= 0) return;
      const start = Math.max(0, Math.floor((clip[1] - y) / lineHeight));
      const end = Math.min(pre.children.length, Math.ceil((clip[1] + clip[3] - y) / lineHeight));
      for (let i = start; i < end; i++) view.lines.push({ tokens: readTokens(pre.children[i]), x, y: y + i * lineHeight, clip });
      if (options.cursor && document.activeElement === input && input.selectionStart === input.selectionEnd) {
        const before = input.value.slice(0, input.selectionStart);
        const row = before.split('\n').length - 1;
        if (intersects(y + row * lineHeight, clip)) view.cursor = { x, y: y + row * lineHeight, prefix: before.slice(before.lastIndexOf('\n') + 1), clip };
      }
    }
    const clip = [0, 0, viewport.width, viewport.height];
    if (!isFolded() || !foldedView) {
      if (mirror) readMirror(mirror, textarea, clip);
    } else {
      for (const block of foldedView.querySelectorAll('.folded-block')) {
        const preview = block.querySelector(block.open ? '.folded-preview.folded-open' : '.folded-preview.folded-closed');
        const rect = preview.getBoundingClientRect();
        const y = rect.top - viewport.top;
        if (intersects(y, clip)) view.lines.push({ tokens: readTokens(preview), x: rect.left - viewport.left, y, clip });
        if (block.open) readMirror(block.querySelector('.folded-source-mirror'), block.querySelector('.folded-source-editor'), clip);
      }
    }
    return view;
  };
}
