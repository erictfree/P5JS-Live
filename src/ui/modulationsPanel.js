// Modulations tab: list, edit and toggle modulations on live controls.
import { WAVEFORMS, WAVE_GLYPHS } from '../performance/modulations.js';

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
    const nameInput = document.createElement('input');
    nameInput.value = m.name; nameInput.setAttribute('aria-label', 'Modulation name'); nameInput.maxLength = 40;
    nameInput.addEventListener('change', () => engine.update(m.id, { name: nameInput.value }));
    const value = document.createElement('span'); value.className = 'modulation-value';
    const code = document.createElement('code'); code.className = 'modulation-code'; code.textContent = `modulations.${m.name}`;
    code.title = 'Read this signal in a patch: ({ modulations }) => modulations.' + m.name;
    name.append(glyph, nameInput, code, value);

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

    const target = document.createElement('select'); target.setAttribute('aria-label', 'Modulation target');
    option(target, '', '— none (read it in code) —', !m.target);
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

    fields.append(
      field('Control', target), field('Wave', wave), field('Rate', sync),
      field(m.sync ? 'Beats' : 'Hz', m.sync ? beats : hz),
      field(`Depth ${Math.round(m.depth * 100)}%`, depth), field(`Offset ${Math.round(m.offset * 100)}%`, offset),
    );

    row.classList.toggle('is-on', m.on);
    row.append(name, actions, fields);
    return { row, value };
  }

  function render() {
    const list = engine.list();
    const params = numericParams();
    root.replaceChildren();
    rows = new Map();
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'performance-empty';
      empty.textContent = 'No modulations yet. Add one, then read it in code as modulations.<name>, or point it at a live control.';
      root.append(empty);
      return;
    }
    for (const m of list) {
      const built = buildRow(m, params);
      rows.set(m.id, built);
      root.append(built.row);
    }
  }

  // Cheap per-frame readout of the live modulated value while the panel is visible.
  function frame() {
    if (root.closest('[data-tool-panel]')?.hidden) return;
    for (const [id, { value }] of rows) {
      const m = engine.get(id);
      if (!m) continue;
      const live = engine.value(m.target);
      const raw = engine.signal(m.name);
      value.textContent = Number.isFinite(live) ? `→ ${Number(live.toFixed(3))}` : Number.isFinite(raw) ? `${raw >= 0 ? '+' : ''}${raw.toFixed(2)}` : '';
    }
  }

  addButton.addEventListener('click', () => {
    // Modulations exist on their own; a control target is optional.
    const created = engine.add({});
    if (created) diagnostics?.info?.(`Modulation ${created.name} added`, `Read it in a patch as modulations.${created.name}, or pick a control for it to move.`);
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
