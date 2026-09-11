// Modulations tab: list, edit and toggle modulations on live controls.
import { WAVEFORMS, WAVE_GLYPHS, waveValue } from '../performance/modulations.js';

const WAVE_LABELS = { sine: 'Sine', triangle: 'Triangle', rampUp: 'Ramp up', rampDown: 'Ramp down', square: 'Square', random: 'Random step' };
const BEAT_OPTIONS = [[0.25, '1/4 beat'], [0.5, '1/2 beat'], [1, '1 beat'], [2, '2 beats'], [4, '1 bar'], [8, '2 bars'], [16, '4 bars']];

export function createModulationsPanel({ root, addButton, engine, registry, diagnostics }) {
  let rows = new Map(); // id → { row, value }
  const numericParams = () => registry.listParams().filter(p => typeof p.value === 'number');

  function option(select, value, label, selected) {
    const node = document.createElement('option');
    node.value = String(value); node.textContent = label; node.selected = selected;
    select.append(node);
  }

  function field(label, control) {
    const wrap = document.createElement('label');
    wrap.append(label, control);
    return wrap;
  }

  function buildRow(m, params) {
    const row = document.createElement('div');
    row.className = 'modulation-row';
    row.dataset.modulationId = m.id;

    const name = document.createElement('div');
    name.className = 'modulation-name';
    const glyph = document.createElement('span'); glyph.textContent = WAVE_GLYPHS[m.wave];
    // The name is what patch code uses, so it is shown as text and renamed on double-click.
    const nameText = document.createElement('span');
    nameText.className = 'modulation-name-text';
    nameText.textContent = m.name;
    nameText.title = 'Double-click to rename';
    nameText.tabIndex = 0;
    nameText.setAttribute('role', 'button');
    nameText.setAttribute('aria-label', `Modulation ${m.name} — double-click or press Enter to rename`);
    const startRename = () => {
      const input = document.createElement('input');
      input.value = m.name; input.maxLength = 40; input.setAttribute('aria-label', 'Modulation name');
      input.className = 'modulation-name-input';
      let done = false;
      const finish = (commit) => {
        if (done) return; done = true;
        const next = input.value.trim();
        if (commit && next && next !== m.name) engine.update(m.id, { name: next });
        else render();
      };
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); finish(true); }
        else if (event.key === 'Escape') { event.preventDefault(); finish(false); }
      });
      input.addEventListener('blur', () => finish(true));
      nameText.replaceWith(input);
      input.focus(); input.select();
    };
    nameText.addEventListener('dblclick', startRename);
    nameText.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); startRename(); } });
    const value = document.createElement('span'); value.className = 'modulation-value';
    const scope = document.createElement('canvas');
    scope.className = 'modulation-scope'; scope.width = 160; scope.height = 40;
    scope.setAttribute('aria-label', `${m.name} waveform`);
    name.append(glyph, nameText, scope, value);

    const actions = document.createElement('div');
    actions.className = 'modulation-actions';
    const onButton = document.createElement('button');
    onButton.type = 'button'; onButton.textContent = m.on ? 'On' : 'Off';
    onButton.classList.toggle('is-on', m.on);
    onButton.setAttribute('aria-pressed', String(m.on));
    onButton.setAttribute('aria-label', `${m.on ? 'Stop' : 'Start'} ${m.name}`);
    onButton.addEventListener('click', () => engine.toggle(m.id));
    const remove = document.createElement('button');
    remove.type = 'button'; remove.textContent = 'Delete'; remove.className = 'danger';
    remove.setAttribute('aria-label', `Delete ${m.name}`);
    remove.addEventListener('click', () => engine.remove(m.id));
    actions.append(onButton, remove);

    const fields = document.createElement('div');
    fields.className = 'modulation-fields';

    const target = document.createElement('select'); target.setAttribute('aria-label', 'Control this modulation moves'); target.title = 'Optionally swing a live control around its knob value';
    option(target, '', 'None — use it in code', !m.target);
    if (m.target && !params.some(p => p.name === m.target)) option(target, m.target, `${m.target} (missing)`, true);
    for (const p of params) option(target, p.name, p.name, p.name === m.target);
    target.addEventListener('change', () => engine.update(m.id, { target: target.value }));

    const wave = document.createElement('select'); wave.setAttribute('aria-label', 'Waveform');
    for (const w of WAVEFORMS) option(wave, w, `${WAVE_GLYPHS[w]} ${WAVE_LABELS[w]}`, w === m.wave);
    wave.addEventListener('change', () => engine.update(m.id, { wave: wave.value }));

    const sync = document.createElement('select'); sync.setAttribute('aria-label', 'Rate mode');
    option(sync, 'beats', 'Beats (synced)', m.sync); option(sync, 'hz', 'Hz (free)', !m.sync);
    sync.addEventListener('change', () => engine.update(m.id, { sync: sync.value === 'beats' }));

    const beats = document.createElement('select'); beats.setAttribute('aria-label', 'Rate in beats');
    for (const [v, label] of BEAT_OPTIONS) option(beats, v, label, Math.abs(v - m.beats) < 1e-9);
    if (!BEAT_OPTIONS.some(([v]) => Math.abs(v - m.beats) < 1e-9)) option(beats, m.beats, `${m.beats} beats`, true);
    beats.addEventListener('change', () => engine.update(m.id, { beats: Number(beats.value) }));
    beats.hidden = !m.sync;

    const hz = document.createElement('input'); hz.type = 'number'; hz.min = '0.01'; hz.max = '30'; hz.step = '0.01'; hz.value = String(m.hz);
    hz.setAttribute('aria-label', 'Rate in Hz');
    hz.addEventListener('change', () => engine.update(m.id, { hz: Number(hz.value) }));
    hz.hidden = m.sync;

    const depth = document.createElement('input'); depth.type = 'range'; depth.min = '0'; depth.max = '1'; depth.step = '0.01'; depth.value = String(m.depth);
    depth.setAttribute('aria-label', 'Depth');
    depth.addEventListener('input', () => engine.update(m.id, { depth: Number(depth.value) }));

    const offset = document.createElement('input'); offset.type = 'range'; offset.min = '-1'; offset.max = '1'; offset.step = '0.01'; offset.value = String(m.offset);
    offset.setAttribute('aria-label', 'Offset');
    offset.addEventListener('input', () => engine.update(m.id, { offset: Number(offset.value) }));

    const depthField = field(`Depth ${Math.round(m.depth * 100)}%`, depth);
    const offsetField = field(`Offset ${Math.round(m.offset * 100)}%`, offset);
    fields.append(
      field('Control', target), field('Wave', wave), field('Rate', sync),
      field(m.sync ? 'Beats' : 'Hz', m.sync ? beats : hz),
      depthField, offsetField,
    );

    row.classList.toggle('is-on', m.on);
    row.append(name, actions, fields);
    return { row, value, scope, depth, offset, depthField, offsetField, signature: structure(m, params) };
  }

  // Everything except depth/offset. When only those change, the row is patched in place
  // so a slider drag never rebuilds the element under the pointer.
  function structure(m, params) {
    return JSON.stringify([m.name, m.target, m.wave, m.sync, m.beats, m.hz, m.on, params.map(p => p.name)]);
  }

  function patchRow(built, m) {
    built.depthField.firstChild.textContent = `Depth ${Math.round(m.depth * 100)}%`;
    built.offsetField.firstChild.textContent = `Offset ${Math.round(m.offset * 100)}%`;
    if (document.activeElement !== built.depth) built.depth.value = String(m.depth);
    if (document.activeElement !== built.offset) built.offset.value = String(m.offset);
  }

  // One cycle of the wave, scaled by depth and offset, with a dot at the current phase.
  function drawScope(canvas, m, phase, live) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height, mid = h / 2;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#191e1f'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#343c3e'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, mid + 0.5); ctx.lineTo(w, mid + 0.5); ctx.stroke();
    const y = v => mid - Math.max(-1, Math.min(1, v)) * (mid - 3);
    ctx.strokeStyle = m.on ? '#f2c14e' : '#6b6e5a'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    const steps = 64;
    const state = { cycle: -1, value: 0 };
    for (let i = 0; i <= steps; i += 1) {
      const p = i / steps;
      const v = m.wave === 'random' ? (Number.isFinite(live) ? live : 0) : m.offset + waveValue(m.wave, p, Math.random, state) * m.depth;
      if (i === 0) ctx.moveTo(0, y(v)); else ctx.lineTo(p * w, y(v));
    }
    ctx.stroke();
    if (Number.isFinite(phase) && Number.isFinite(live)) {
      ctx.fillStyle = '#fff3cf';
      ctx.beginPath(); ctx.arc(phase * w, y(live), 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  function render() {
    const list = engine.list();
    const params = numericParams();
    if (!list.length) {
      root.replaceChildren();
      rows = new Map();
      const empty = document.createElement('div');
      empty.className = 'performance-empty';
      empty.textContent = 'No modulations yet. Add one and use its name in code — lfo1 is a live number from −1 to 1 — or point it at a live control.';
      root.append(empty);
      return;
    }
    for (const stale of root.querySelectorAll(':scope > .performance-empty')) stale.remove();
    const next = new Map();
    for (const m of list) {
      const existing = rows.get(m.id);
      let built;
      if (existing && existing.signature === structure(m, params)) {
        patchRow(existing, m);
        built = existing;
      } else {
        built = buildRow(m, params);
        if (existing) existing.row.replaceWith(built.row);
      }
      next.set(m.id, built);
    }
    for (const [id, built] of rows) if (!next.has(id)) built.row.remove();
    rows = next;
    // Keep DOM order equal to list order, but never move a node that is already in
    // place: re-inserting an element cancels an in-progress slider drag inside it.
    const wanted = [...rows.values()].map(built => built.row);
    const current = [...root.children].filter(node => node.classList.contains('modulation-row'));
    if (wanted.some((row, index) => current[index] !== row)) {
      for (const row of wanted) root.append(row);
    }
    for (const [id, built] of rows) { const m = engine.get(id); if (m) drawScope(built.scope, m, engine.phase(id), engine.signal(m.name)); }
  }

  // Cheap per-frame readout of the live modulated value while the panel is visible.
  function frame() {
    if (root.closest('[data-tool-panel]')?.hidden) return;
    for (const [id, { value, scope }] of rows) {
      const m = engine.get(id);
      if (!m) continue;
      const live = engine.value(m.target);
      const raw = engine.signal(m.name);
      value.textContent = Number.isFinite(live) ? `→ ${Number(live.toFixed(3))}` : Number.isFinite(raw) ? `${raw >= 0 ? '+' : ''}${raw.toFixed(2)}` : '';
      drawScope(scope, m, engine.phase(id), raw);
    }
  }

  addButton.addEventListener('click', () => {
    // Modulations exist on their own; a control target is optional.
    const created = engine.add({});
    if (created) diagnostics?.info?.(`Modulation ${created.name} added`, `Use ${created.name} in a patch as a live number from −1 to 1, or pick a control for it to move.`);
  });

  engine.subscribe(render);
  registry.subscribe(() => {
    // Re-render only when the set of numeric controls changes, not on value ticks.
    const names = numericParams().map(p => p.name).join('|');
    if (names !== lastNames) { lastNames = names; render(); }
  });
  let lastNames = numericParams().map(p => p.name).join('|');
  render();
  return { render, frame };
}
