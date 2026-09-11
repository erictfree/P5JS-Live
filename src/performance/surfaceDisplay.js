// Pixel output is independent of any future USB transport. No device I/O here.
import { waveValue } from './modulations.js';
import { COLORS, FONTS, STROKES, TYPE, font, reverseTab } from './displayTheme.js';

const WAVE_NAMES = { sine: 'sine', triangle: 'triangle', rampUp: 'ramp up', rampDown: 'ramp down', square: 'square', random: 'random' };

// One cycle of a modulation's wave (scaled by depth and offset) in a box, with a dot at
// the current phase. Shared by the Push edit view; the browser row draws its own.
function drawWaveBox(ctx, edit, x, y, w, h, { background = '#101314', lineWidth = 2, dot = 3.5 } = {}) {
  const mid = y + h / 2;
  ctx.fillStyle = background; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#343c3e'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, mid + 0.5); ctx.lineTo(x + w, mid + 0.5); ctx.stroke();
  const yOf = v => mid - Math.max(-1, Math.min(1, v)) * (h / 2 - 3);
  ctx.strokeStyle = edit.on ? AMBER : '#7a6a30'; ctx.lineWidth = Math.max(1.5, lineWidth - 1);
  ctx.beginPath();
  const steps = 96;
  const state = { cycle: -1, value: 0 };
  for (let i = 0; i <= steps; i += 1) {
    const p = i / steps;
    const v = edit.wave === 'random' ? (Number.isFinite(edit.signal) ? edit.signal : 0) : edit.offset + waveValue(edit.wave, p, Math.random, state) * edit.depth;
    if (i === 0) ctx.moveTo(x, yOf(v)); else ctx.lineTo(x + p * w, yOf(v));
  }
  ctx.stroke();
  if (Number.isFinite(edit.phase) && Number.isFinite(edit.signal)) {
    ctx.fillStyle = '#fff3cf';
    ctx.beginPath(); ctx.arc(x + edit.phase * w, yOf(edit.signal), dot, 0, Math.PI * 2); ctx.fill();
  }
}
export const SURFACE_PROFILES = Object.freeze([
  { id: 'virtual', name: 'Virtual Push', status: 'Simulator' },
  { id: 'push1', name: 'Push 1', status: 'Hardware unverified · MIDI Learn only' },
  { id: 'push2', name: 'Push 2', status: 'Hardware unverified · MIDI Learn only' },
  { id: 'push3', name: 'Push 3', status: 'Hardware unverified · MIDI Learn only' },
]);


function drawLowerStrip(ctx, lowerLabels) {
  if (!lowerLabels) return;
  // Bottom tabs: one modulation slot per lower button, amber when running.
  const firstEmpty = lowerLabels.findIndex(s => !s);
  lowerLabels.forEach((slot, i) => {
    const x = i * 120;
    ctx.textAlign = 'left';
    ctx.fillStyle = slot ? (slot.on ? AMBER : '#8a8f8d') : '#3c4143'; ctx.font = '500 13px ' + SANS;
    ctx.fillText(slot ? `${slot.glyph} ${slot.name} ${slot.rate} ${slot.depth}`.slice(0, 16) : (i === firstEmpty ? '+ new' : ''), x + 8, 155);
    ctx.fillStyle = slot ? (slot.on ? AMBER : '#4a5254') : '#22282a'; ctx.fillRect(x + 4, 142, 112, 1);
  });
}

// Modulation edit mode owns the whole screen: a full-width scope on top, the eight
// parameter columns (one per encoder) below, and the slot strip along the bottom edge.
function renderEditScreen(ctx, edit, lowerLabels) {
  ctx.fillStyle = '#171a1c'; ctx.fillRect(0, 0, 960, 160);
  // Title band, then the scope across the full width beneath it.
  ctx.textAlign = 'left';
  ctx.fillStyle = AMBER; ctx.font = 'bold 14px ' + SANS;
  ctx.fillText(`EDIT ${edit.glyph} ${edit.name}`, 12, 15);
  ctx.fillStyle = '#b9bdc1'; ctx.font = '12px ' + SANS;
  ctx.fillText(`${WAVE_NAMES[edit.wave] ?? edit.wave} · ${edit.sync ? `${edit.beats} beat${edit.beats === 1 ? '' : 's'}` : `${edit.hz} Hz`} · ${edit.on ? 'on' : 'off'}`, 190, 15);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#8a8f8d'; ctx.font = '12px ' + SANS;
  ctx.fillText('Shift + button to leave', 948, 15);
  if (Number.isFinite(edit.signal)) { ctx.fillStyle = '#fff3cf'; ctx.font = 'bold 14px ' + SANS; ctx.fillText(`${edit.signal >= 0 ? '+' : ''}${edit.signal.toFixed(2)}`, 790, 15); }
  ctx.textAlign = 'left';
  drawWaveBox(ctx, edit, 0, 20, 960, 44, { background: '#0f1213', lineWidth: 3, dot: 5 });
  ctx.fillStyle = '#5c4a14'; ctx.fillRect(0, 66, 960, 2);
  const cells = [
    ['Wave', WAVE_NAMES[edit.wave] ?? edit.wave],
    ['Rate', edit.sync ? `${edit.beats} beat${edit.beats === 1 ? '' : 's'}` : `${edit.hz} Hz`],
    ['Rate mode', edit.sync ? 'Beats' : 'Hz'],
    ['Depth', `${Math.round(edit.depth * 100)}%`],
    ['Offset', `${Math.round(edit.offset * 100)}%`],
    ['Control', edit.target || 'none'],
    ['On', edit.on ? 'On' : 'Off'],
    ['', ''],
  ];
  cells.forEach(([label, value], i) => {
    const x = i * 120;
    // Neutral dark cards: dark amber turns olive through the Push's colour depth.
    ctx.fillStyle = label ? '#1a1e20' : '#141718'; ctx.fillRect(x + 4, 72, 112, 68);
    ctx.fillStyle = label ? AMBER : '#22282a'; ctx.fillRect(x + 4, 72, 112, 2);
    ctx.fillStyle = '#b9bdc1'; ctx.font = '12px ' + SANS; ctx.fillText(label, x + 10, 92);
    ctx.fillStyle = label ? AMBER : '#2b3234'; ctx.font = '400 24px ' + SANS; ctx.fillText(String(value).slice(0, 9), x + 10, 126);
  });
  drawLowerStrip(ctx, lowerLabels);
}

// Column colours: the same eight hues the pads and upper-button LEDs use (push3Map
// PERFORMANCE_HUES order: skyBlue, violet, pink, teal, lime, amber, blue, mint).
export const COLUMN_COLORS = COLORS.columns;
const INK = COLORS.ink, DIM = COLORS.dim, FAINT = COLORS.faint, BG = COLORS.bg, AMBER = COLORS.amber;
const SANS = FONTS.sans;

function fmt(value) {
  if (typeof value !== 'number') return '—';
  const abs = Math.abs(value);
  const text = abs >= 100 ? value.toFixed(0) : abs >= 10 ? value.toFixed(1) : Number(value.toFixed(3)).toString();
  return text.slice(0, 7);
}

// Knob arc: 270° sweep, filled to `t` (0…1) in `color`, with a marker at `mark` if given.
function drawArc(ctx, cx, cy, r, t, color, { mark = null, track = FAINT } = {}) {
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  ctx.lineCap = 'round';
  ctx.strokeStyle = track; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
  if (Number.isFinite(t)) {
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, r, a0, a0 + (a1 - a0) * Math.max(0, Math.min(1, t))); ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(cx + Math.cos(a0) * (r + 7) - 2, cy + Math.sin(a0) * (r + 7) - 2, 4, 4);
  }
  if (Number.isFinite(mark)) {
    const a = a0 + (a1 - a0) * Math.max(0, Math.min(1, mark));
    ctx.fillStyle = '#fff3cf';
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.lineCap = 'butt';
}

// `tempo` ({ bpm, label, running, lit }) and `transport` ({ kind, loaded, playing, volume })
// feed one compact info line; `controls` are the eight encoder targets (registry params
// with an optional `modulation` summary); `lowerLabels` are the modulation slots.
export function renderSurfaceDisplay(canvas, { title, status, controls, tempo = null, transport = null, browser = null, lowerLabels = null, volume = null, edit = null }) {
  const ctx = canvas.getContext('2d');
  if (edit) { renderEditScreen(ctx, edit, lowerLabels); return; }
  ctx.fillStyle = BG; ctx.fillRect(0, 0, 960, 160);
  ctx.textAlign = 'left';

  // Top strip: one tab per upper button — the control under that encoder, in its colour.
  controls.forEach((control, i) => {
    const x = i * 120, color = COLUMN_COLORS[i];
    const assigned = Boolean(control);
    ctx.fillStyle = assigned ? color : DIM; ctx.font = 'bold 12px ' + SANS;
    ctx.fillText((control?.name ?? '—').slice(0, 14), x + 8, 13);
    ctx.fillStyle = assigned ? color : FAINT; ctx.fillRect(x + 4, 17, 112, 1);
    if (assigned && Number.isFinite(control.default) && Math.abs(control.value - control.default) > 1e-9) {
      ctx.fillStyle = color; ctx.font = '11px ' + SANS; ctx.textAlign = 'right'; ctx.fillText('↺', x + 114, 13); ctx.textAlign = 'left';
    }
  });

  // Info line: tempo · performance and scene · volume.
  const infoY = 33;
  if (tempo) {
    ctx.beginPath(); ctx.arc(11, infoY - 4, 4, 0, Math.PI * 2);
    ctx.fillStyle = tempo.lit ? '#ffffff' : tempo.running ? '#4a5254' : FAINT; ctx.fill();
    ctx.fillStyle = tempo.running ? AMBER : DIM; ctx.font = '500 13px ' + SANS;
    ctx.fillText(tempo.bpm ? `${tempo.bpm.toFixed(1)} BPM` : tempo.label, 20, infoY);
    ctx.fillStyle = DIM; ctx.font = '11px ' + SANS;
    if (tempo.bpm) ctx.fillText(tempo.label, 118, infoY);
  }
  ctx.fillStyle = '#62d7b1'; ctx.font = '500 13px ' + SANS;
  ctx.fillText(title.slice(0, 28), 190, infoY);
  ctx.fillStyle = DIM; ctx.font = '11px ' + SANS;
  const statusText = status.startsWith(title + ' · ') ? status.slice(title.length + 3) : status;
  ctx.fillText(statusText.slice(0, 48), 190 + Math.min(28, title.length) * 8 + 10, infoY);
  if (volume?.active || (transport && transport.kind === 'file' && transport.loaded)) {
    const level = Math.max(0, Math.min(1, (volume?.active ? volume.level : transport.volume) ?? 1));
    ctx.textAlign = 'right';
    ctx.fillStyle = volume?.active ? '#62d7b1' : DIM; ctx.font = 'bold 12px ' + SANS;
    ctx.fillText(`VOL ${Math.round(level * 100)}%${transport?.kind === 'file' ? (transport.playing ? ' ▶' : ' ❚❚') : ''}`, 948, infoY);
    ctx.textAlign = 'left';
    ctx.fillStyle = FAINT; ctx.fillRect(868, infoY + 4, 80, 3);
    ctx.fillStyle = volume?.active ? '#62d7b1' : '#4a5254'; ctx.fillRect(868, infoY + 4, 80 * level, 3);
  }
  ctx.fillStyle = '#1b1f21'; ctx.fillRect(0, 40, 960, 1);

  if (browser) {
    // Jog-wheel browser replaces the columns while active: thumbnail, name, position.
    ctx.fillStyle = BG; ctx.fillRect(0, 42, 960, 100);
    const box = 80, bx = 20, by = 50;
    ctx.fillStyle = '#000'; ctx.fillRect(bx, by, box, box);
    if (browser.image && browser.image.complete && browser.image.naturalWidth > 0) ctx.drawImage(browser.image, bx, by, box, box);
    else { ctx.fillStyle = FAINT; ctx.fillRect(bx + 1, by + 1, box - 2, box - 2); }
    ctx.fillStyle = '#ffb65d'; ctx.font = '12px ' + SANS;
    ctx.fillText(`PERFORMANCE ${browser.index + 1} / ${browser.count}${browser.isCurrent ? ' · CURRENT' : ''}`, 120, 66);
    ctx.fillStyle = INK; ctx.font = 'bold 30px ' + SANS;
    ctx.fillText(String(browser.name).slice(0, 34), 120, 102);
    ctx.fillStyle = DIM; ctx.font = '12px ' + SANS;
    ctx.fillText(`${browser.sceneCount} scene${browser.sceneCount === 1 ? '' : 's'} · turn jog to browse · press to load`, 120, 126);
    drawLowerStrip(ctx, lowerLabels);
    return;
  }

  // Columns: small caption, big value, knob arc. A modulation shows its glyph and rate in
  // the caption and drives the arc's marker with the live value.
  controls.forEach((control, i) => {
    const x = i * 120, color = COLUMN_COLORS[i];
    if (!control) {
      ctx.fillStyle = FAINT; ctx.font = '12px ' + SANS; ctx.fillText('unassigned', x + 8, 60);
      drawArc(ctx, x + 60, 108, 22, null, color);
      return;
    }
    const mod = control.modulation ?? null;
    const min = Number.isFinite(control.min) ? control.min : 0;
    const max = Number.isFinite(control.max) ? control.max : 1;
    const range = max > min ? max - min : 1;
    const shown = mod && Number.isFinite(mod.value) ? mod.value : control.value;
    ctx.fillStyle = mod ? (mod.running ? AMBER : DIM) : DIM; ctx.font = '11px ' + SANS;
    ctx.fillText(mod ? `${mod.glyph} ${mod.rate}` : `${fmt(min)} – ${fmt(max)}`, x + 8, 56);
    ctx.fillStyle = INK; ctx.font = 'bold 24px ' + SANS;
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

