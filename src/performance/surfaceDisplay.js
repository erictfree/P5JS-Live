// Pixel output is independent of any future USB transport. No device I/O here.
// Layout and colour rules: docs/PUSH3-DISPLAY-STYLE.md; tokens: displayTheme.js.
import { waveValue } from './modulations.js';
import { COLORS, FONTS, GRID, STROKES, font, reverseTab } from './displayTheme.js';

export const SURFACE_PROFILES = Object.freeze([
  { id: 'virtual', name: 'Virtual Push', status: 'Simulator' },
  { id: 'push1', name: 'Push 1', status: 'Hardware unverified · MIDI Learn only' },
  { id: 'push2', name: 'Push 2', status: 'Hardware unverified · MIDI Learn only' },
  { id: 'push3', name: 'Push 3', status: 'Display, LEDs and input verified' },
]);

const WAVE_NAMES = { sine: 'sine', triangle: 'triangle', rampUp: 'ramp up', rampDown: 'ramp down', square: 'square', random: 'random' };
export const COLUMN_COLORS = COLORS.columns;
const INK = COLORS.ink, DIM = COLORS.dim, FAINT = COLORS.faint, BG = COLORS.bg, AMBER = COLORS.amber, TEAL = COLORS.teal;
const SANS = FONTS.sans;
const COL = GRID.column;

function fmt(value) {
  if (typeof value !== 'number') return '—';
  const abs = Math.abs(value);
  const text = abs >= 100 ? value.toFixed(0) : abs >= 10 ? value.toFixed(1) : Number(value.toFixed(3)).toString();
  return text.slice(0, 7);
}

// Knob arc: 270° sweep filled to `t` (0…1) in `color`, a white square at the sweep's
// start (Live's idiom), and an optional live marker riding the arc at `mark`.
function drawArc(ctx, cx, cy, r, t, color, { mark = null, track = FAINT, marker = true } = {}) {
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  ctx.lineCap = 'round';
  ctx.strokeStyle = track; ctx.lineWidth = STROKES.arcTrack;
  ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
  if (Number.isFinite(t)) {
    ctx.strokeStyle = color; ctx.lineWidth = STROKES.arc;
    ctx.beginPath(); ctx.arc(cx, cy, r, a0, a0 + (a1 - a0) * Math.max(0, Math.min(1, t))); ctx.stroke();
    if (marker) { ctx.fillStyle = INK; ctx.fillRect(cx + Math.cos(a0) * (r + 7) - 2, cy + Math.sin(a0) * (r + 7) - 2, 4, 4); }
  }
  if (Number.isFinite(mark)) {
    const a = a0 + (a1 - a0) * Math.max(0, Math.min(1, mark));
    ctx.fillStyle = AMBER;
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.lineCap = 'butt';
}

// One cycle of a modulation's wave (scaled by depth and offset) with a dot at the phase.
function drawWave(ctx, m, x, y, w, h, { lineWidth = STROKES.wave, dot = 3.5, color = AMBER } = {}) {
  const mid = y + h / 2;
  const yOf = v => mid - Math.max(-1, Math.min(1, v)) * (h / 2 - 3);
  ctx.strokeStyle = COLORS.hair; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, mid + 0.5); ctx.lineTo(x + w, mid + 0.5); ctx.stroke();
  ctx.strokeStyle = m.on === false ? DIM : color; ctx.lineWidth = lineWidth; ctx.lineJoin = 'round';
  ctx.beginPath();
  const steps = Math.max(24, Math.round(w / 8));
  const state = { cycle: -1, value: 0 };
  for (let i = 0; i <= steps; i += 1) {
    const p = i / steps;
    const v = m.wave === 'random' ? (Number.isFinite(m.signal) ? m.signal : 0) : m.offset + waveValue(m.wave, p, Math.random, state) * m.depth;
    if (i === 0) ctx.moveTo(x, yOf(v)); else ctx.lineTo(x + p * w, yOf(v));
  }
  ctx.stroke();
  if (Number.isFinite(m.phase) && Number.isFinite(m.signal)) {
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.arc(x + m.phase * w, yOf(m.signal), dot, 0, Math.PI * 2); ctx.fill();
  }
}

// Bottom tabs: one modulation slot per lower button. Running = amber rule; the slot being
// edited = reverse video; the next empty slot reads "+ new".
function drawLowerStrip(ctx, lowerLabels) {
  if (!lowerLabels) return;
  const y = GRID.height - GRID.bottomStrip;
  const firstEmpty = lowerLabels.findIndex(s => !s);
  lowerLabels.forEach((slot, i) => {
    const x = i * COL;
    if (slot?.editing) {
      reverseTab(ctx, x + 4, y + 1, COL - 8, GRID.bottomStrip - 2, AMBER, `${slot.glyph} ${slot.name}`, font('strip'));
      return;
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = slot ? (slot.on ? AMBER : DIM) : '#3c4143'; ctx.font = font('strip');
    ctx.fillText(slot ? `${slot.glyph} ${slot.name} ${slot.rate} ${slot.depth}`.slice(0, 16) : (i === firstEmpty ? '+ new' : ''), x + 8, y + 13);
    ctx.fillStyle = slot ? (slot.on ? AMBER : '#4a5254') : COLORS.hair; ctx.fillRect(x + 4, y, COL - 8, STROKES.rule);
  });
}

// Modulation edit screen: title band with the editing slot in reverse video, a
// full-width scope, and eight parameter cards aligned with the encoders.
function renderEditScreen(ctx, edit, lowerLabels) {
  ctx.fillStyle = BG; ctx.fillRect(0, 0, GRID.width, GRID.height);
  ctx.textAlign = 'left';
  reverseTab(ctx, 4, 1, 140, 16, AMBER, `${edit.glyph} ${edit.name}`, font('tab'));
  ctx.fillStyle = DIM; ctx.font = font('infoSmall');
  ctx.fillText(`${WAVE_NAMES[edit.wave] ?? edit.wave} · ${edit.sync ? `${edit.beats} beat${edit.beats === 1 ? '' : 's'}` : `${edit.hz} Hz`}${edit.target ? ` · moves ${edit.target}` : ''}`, 154, 13);
  ctx.textAlign = 'right';
  ctx.fillStyle = DIM; ctx.font = font('infoSmall');
  ctx.fillText('Shift + button to leave', 948, 13);
  if (Number.isFinite(edit.signal)) { ctx.fillStyle = INK; ctx.font = font('tab'); ctx.fillText(`${edit.signal >= 0 ? '+' : ''}${edit.signal.toFixed(2)}`, 800, 13); }
  ctx.textAlign = 'left';
  drawWave(ctx, edit, 0, 20, GRID.width, 40, { lineWidth: STROKES.waveBig, dot: 5 });
  ctx.fillStyle = COLORS.hair; ctx.fillRect(0, 62, GRID.width, 1);

  const cards = [
    { label: 'Wave', kind: 'wave' },
    { label: 'Rate', value: edit.sync ? `${edit.beats} beat${edit.beats === 1 ? '' : 's'}` : `${edit.hz} Hz` },
    { label: 'Rate mode', value: edit.sync ? 'Beats' : 'Hz' },
    { label: 'Depth', value: `${Math.round(edit.depth * 100)}%`, arc: edit.depth },
    { label: 'Offset', value: `${Math.round(edit.offset * 100)}%`, arc: (edit.offset + 1) / 2 },
    { label: 'Control', value: edit.target || 'none', dim: !edit.target },
    { label: 'On', kind: 'switch', on: edit.on },
    null,
  ];
  cards.forEach((card, i) => {
    const x = i * COL;
    if (!card) return;
    ctx.fillStyle = DIM; ctx.font = font('caption'); ctx.textAlign = 'left';
    ctx.fillText(card.label, x + 8, 78);
    if (card.kind === 'wave') {
      drawWave(ctx, { ...edit, phase: null }, x + 8, 84, COL - 16, 34, { lineWidth: STROKES.wave, color: AMBER });
      ctx.fillStyle = INK; ctx.font = font('caption'); ctx.fillText(WAVE_NAMES[edit.wave] ?? edit.wave, x + 8, 134);
      return;
    }
    if (card.kind === 'switch') {
      ctx.fillStyle = card.on ? AMBER : DIM; ctx.font = font('valueSmall'); ctx.fillText(card.on ? 'On' : 'Off', x + 8, 106);
      ctx.strokeStyle = card.on ? AMBER : FAINT; ctx.lineWidth = STROKES.arc;
      ctx.beginPath(); ctx.arc(x + 60, 124, 8, 0, Math.PI * 2); ctx.stroke();
      if (card.on) { ctx.fillStyle = AMBER; ctx.beginPath(); ctx.arc(x + 60, 124, 4, 0, Math.PI * 2); ctx.fill(); }
      return;
    }
    ctx.fillStyle = card.dim ? DIM : INK; ctx.font = font('valueSmall'); ctx.fillText(String(card.value).slice(0, 10), x + 8, 106);
    if (Number.isFinite(card.arc)) drawArc(ctx, x + 60, 124, 12, card.arc, AMBER, { marker: false });
  });
  drawLowerStrip(ctx, lowerLabels);
}

// `tempo` ({ bpm, label, running, lit }) and `transport` ({ kind, loaded, playing, volume })
// feed one compact info line; `controls` are the eight encoder targets (registry params
// with an optional `modulation` summary); `lowerLabels` are the modulation slots;
// `touched` is the column index whose encoder moved most recently (reverse-video tab).
export function renderSurfaceDisplay(canvas, { title, status, controls, tempo = null, transport = null, browser = null, lowerLabels = null, volume = null, edit = null, touched = null }) {
  const ctx = canvas.getContext('2d');
  if (edit) { renderEditScreen(ctx, edit, lowerLabels); return; }
  ctx.fillStyle = BG; ctx.fillRect(0, 0, GRID.width, GRID.height);
  ctx.textAlign = 'left';

  // Top strip: one tab per upper button — the control under that encoder, in its colour.
  controls.forEach((control, i) => {
    const x = i * COL, color = COLUMN_COLORS[i];
    const assigned = Boolean(control);
    const moved = assigned && Number.isFinite(control.default) && Math.abs(control.value - control.default) > 1e-9;
    if (assigned && touched === i) {
      reverseTab(ctx, x + 4, 1, COL - 8, GRID.topStrip - 2, color, `${control.name.slice(0, 13)}${moved ? ' ↺' : ''}`, font('tab'));
      return;
    }
    ctx.fillStyle = assigned ? color : DIM; ctx.font = font('tab');
    ctx.fillText((control?.name ?? '—').slice(0, 14), x + 8, 13);
    ctx.fillStyle = assigned ? color : FAINT; ctx.fillRect(x + 4, GRID.topStrip - 1, COL - 8, STROKES.rule);
    if (moved) { ctx.fillStyle = color; ctx.font = font('caption'); ctx.textAlign = 'right'; ctx.fillText('↺', x + COL - 6, 13); ctx.textAlign = 'left'; }
  });

  // Info line: beat · BPM · mode | performance · scene · state | volume.
  const infoY = 33;
  if (tempo) {
    ctx.beginPath(); ctx.arc(11, infoY - 4, 4, 0, Math.PI * 2);
    ctx.fillStyle = tempo.lit ? INK : tempo.running ? '#4a5254' : FAINT; ctx.fill();
    ctx.fillStyle = tempo.running ? AMBER : DIM; ctx.font = font('info');
    ctx.fillText(tempo.bpm ? `${tempo.bpm.toFixed(1)} BPM` : tempo.label, 20, infoY);
    ctx.fillStyle = DIM; ctx.font = font('infoSmall');
    if (tempo.bpm) ctx.fillText(tempo.label, 118, infoY);
  }
  ctx.fillStyle = TEAL; ctx.font = font('info');
  ctx.fillText(title.slice(0, 28), 190, infoY);
  ctx.fillStyle = DIM; ctx.font = font('infoSmall');
  const statusText = status.startsWith(title + ' · ') ? status.slice(title.length + 3) : status;
  ctx.fillText(statusText.slice(0, 48), 190 + ctx.measureText(title.slice(0, 28)).width * 1.15 + 10, infoY);
  if (volume?.active || (transport && transport.kind === 'file' && transport.loaded)) {
    const level = Math.max(0, Math.min(1, (volume?.active ? volume.level : transport.volume) ?? 1));
    ctx.textAlign = 'right';
    ctx.fillStyle = volume?.active ? TEAL : DIM; ctx.font = font('info');
    ctx.fillText(`VOL ${Math.round(level * 100)}%${transport?.kind === 'file' ? (transport.playing ? ' ▶' : ' ❚❚') : ''}`, 948, infoY);
    ctx.textAlign = 'left';
    ctx.fillStyle = FAINT; ctx.fillRect(868, infoY + 4, 80, 2);
    ctx.fillStyle = volume?.active ? TEAL : '#4a5254'; ctx.fillRect(868, infoY + 4, 80 * level, 2);
  }
  ctx.fillStyle = COLORS.hair; ctx.fillRect(0, GRID.infoLine, GRID.width, 1);

  if (browser) {
    // Jog-wheel browser replaces the columns while active: thumbnail, name, position.
    const box = 80, bx = 20, by = 50;
    ctx.fillStyle = '#000'; ctx.fillRect(bx, by, box, box);
    if (browser.image && browser.image.complete && browser.image.naturalWidth > 0) ctx.drawImage(browser.image, bx, by, box, box);
    else { ctx.fillStyle = FAINT; ctx.fillRect(bx + 1, by + 1, box - 2, box - 2); }
    ctx.fillStyle = AMBER; ctx.font = font('caption');
    ctx.fillText(`PERFORMANCE ${browser.index + 1} / ${browser.count}${browser.isCurrent ? ' · CURRENT' : ''}`, 120, 66);
    ctx.fillStyle = INK; ctx.font = font('title', FONTS.display);
    ctx.fillText(String(browser.name).slice(0, 34), 120, 102);
    ctx.fillStyle = DIM; ctx.font = font('caption');
    ctx.fillText(`${browser.sceneCount} scene${browser.sceneCount === 1 ? '' : 's'} · turn jog to browse · press to load`, 120, 126);
    drawLowerStrip(ctx, lowerLabels);
    return;
  }

  // Columns: caption, big value, knob arc. A modulation shows its glyph and rate in the
  // caption and rides the arc with an amber marker at the live value.
  controls.forEach((control, i) => {
    const x = i * COL, color = COLUMN_COLORS[i];
    if (!control) { drawArc(ctx, x + 60, 108, 22, null, color); return; }
    const mod = control.modulation ?? null;
    const min = Number.isFinite(control.min) ? control.min : 0;
    const max = Number.isFinite(control.max) ? control.max : 1;
    const range = max > min ? max - min : 1;
    const shown = mod && Number.isFinite(mod.value) ? mod.value : control.value;
    ctx.fillStyle = mod ? (mod.running ? AMBER : DIM) : DIM; ctx.font = font('caption');
    ctx.fillText(mod ? `${mod.glyph} ${mod.rate}` : `${fmt(min)} – ${fmt(max)}`, x + 8, 56);
    ctx.fillStyle = INK; ctx.font = font('value');
    ctx.fillText(fmt(shown), x + 8, 82);
    drawArc(ctx, x + 60, 112, 22, (control.value - min) / range, color, { mark: mod && Number.isFinite(mod.value) ? (mod.value - min) / range : null });
  });

  drawLowerStrip(ctx, lowerLabels);
}

// A specimen screen for judging the tokens on the real panel: type at the scale sizes and
// families, the colour set as text and as strokes, reverse highlights, and stroke weights.
// Reachable from the controller dialog's display row ("Show style sheet").
export function renderStyleSheet(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = COLORS.bg; ctx.fillRect(0, 0, 960, 160);
  ctx.textAlign = 'left';

  // Row 1 (y 0–40): type specimens, one family per pair of columns.
  const specimens = [
    ['Work Sans 400', `400 22px ${FONTS.sans}`, `500 12px ${FONTS.sans}`],
    ['Space Grotesk 500', `500 22px ${FONTS.display}`, `500 12px ${FONTS.display}`],
    ['Plex Mono 500', `500 22px ${FONTS.mono}`, `500 12px ${FONTS.mono}`],
    ['System mono', '500 22px ui-monospace, Menlo, monospace', '500 12px ui-monospace, Menlo, monospace'],
  ];
  specimens.forEach(([name, big, small], i) => {
    const x = i * 240;
    ctx.fillStyle = COLORS.dim; ctx.font = small; ctx.fillText(name, x + 8, 13);
    ctx.fillStyle = COLORS.ink; ctx.font = big; ctx.fillText('Orbits 124.0 0.62', x + 8, 36);
  });
  ctx.fillStyle = COLORS.hair; ctx.fillRect(0, 42, 960, 1);

  // Row 2 (y 44–96): the eight column colours as tab text + rule, arc, and reverse block.
  COLORS.columns.forEach((color, i) => {
    const x = i * 120;
    ctx.fillStyle = color; ctx.font = font('tab'); ctx.fillText(`hue ${i + 1}`, x + 8, 58);
    ctx.fillStyle = color; ctx.fillRect(x + 4, 62, 112, STROKES.rule);
    // arc at the token weight and one heavier for comparison
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    ctx.strokeStyle = COLORS.faint; ctx.lineWidth = STROKES.arcTrack; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(x + 30, 82, 12, a0, a1); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = STROKES.arc;
    ctx.beginPath(); ctx.arc(x + 30, 82, 12, a0, a0 + (a1 - a0) * 0.65); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x + 62, 82, 12, a0, a0 + (a1 - a0) * 0.65); ctx.stroke();
    ctx.lineCap = 'butt';
    reverseTab(ctx, x + 80, 70, 36, 16, color, 'sel', font('caption'));
  });
  ctx.fillStyle = COLORS.hair; ctx.fillRect(0, 98, 960, 1);

  // Row 3 (y 100–140): greys and accents as text, plus reverse white/amber, plus hairlines.
  const inks = [['ink', COLORS.ink], ['text', COLORS.text], ['dim', COLORS.dim], ['amber', COLORS.amber], ['teal', COLORS.teal], ['danger', COLORS.danger]];
  inks.forEach(([name, color], i) => {
    const x = i * 120;
    ctx.fillStyle = color; ctx.font = font('value'); ctx.fillText('0.62', x + 8, 128);
    ctx.fillStyle = color; ctx.font = font('caption'); ctx.fillText(name, x + 8, 108);
  });
  reverseTab(ctx, 728, 106, 100, 18, COLORS.ink, 'white block', font('tab'));
  reverseTab(ctx, 728, 128, 100, 18, COLORS.amber, 'amber block', font('tab'));
  ctx.fillStyle = COLORS.dim; ctx.font = font('caption'); ctx.fillText('1px', 848, 110); ctx.fillText('2px', 848, 124); ctx.fillText('3px', 848, 138);
  ctx.fillStyle = COLORS.ink; ctx.fillRect(876, 107, 70, 1); ctx.fillRect(876, 120, 70, 2); ctx.fillRect(876, 133, 70, 3);

  // Bottom strip: a running tab, a defined tab, an empty slot — as the real strip draws them.
  drawLowerStrip(ctx, [
    { name: 'lfo1', glyph: '∿', rate: '1b', depth: '25%', on: true },
    { name: 'wobble', glyph: '⊓', rate: '2b', depth: '50%', on: false },
    null, null, null, null, null, null,
  ]);
}

