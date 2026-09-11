// Pixel output is independent of any future USB transport. No device I/O here.
import { waveValue } from './modulations.js';

const WAVE_NAMES = { sine: 'sine', triangle: 'triangle', rampUp: 'ramp up', rampDown: 'ramp down', square: 'square', random: 'random' };

// One cycle of a modulation's wave (scaled by depth and offset) in a box, with a dot at
// the current phase. Shared by the Push edit view; the browser row draws its own.
function drawWaveBox(ctx, edit, x, y, w, h, { background = '#101314', lineWidth = 2, dot = 3.5 } = {}) {
  const mid = y + h / 2;
  ctx.fillStyle = background; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#343c3e'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, mid + 0.5); ctx.lineTo(x + w, mid + 0.5); ctx.stroke();
  const yOf = v => mid - Math.max(-1, Math.min(1, v)) * (h / 2 - 3);
  ctx.strokeStyle = edit.on ? '#f2c14e' : '#7a6a30'; ctx.lineWidth = lineWidth;
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
    ctx.fillStyle = slot ? (slot.on ? '#f2c14e' : '#8a8f8d') : '#3c4143'; ctx.font = 'bold 12px monospace';
    ctx.fillText(slot ? `${slot.glyph} ${slot.name} ${slot.rate} ${slot.depth}`.slice(0, 16) : (i === firstEmpty ? '+ new' : ''), x + 8, 155);
    ctx.fillStyle = slot ? (slot.on ? '#f2c14e' : '#4a5254') : '#22282a'; ctx.fillRect(x + 4, 142, 112, 2);
  });
}

// Modulation edit mode owns the whole screen: a full-width scope on top, the eight
// parameter columns (one per encoder) below, and the slot strip along the bottom edge.
function renderEditScreen(ctx, edit, lowerLabels) {
  ctx.fillStyle = '#171a1c'; ctx.fillRect(0, 0, 960, 160);
  // Title band, then the scope across the full width beneath it.
  ctx.textAlign = 'left';
  ctx.fillStyle = '#f2c14e'; ctx.font = 'bold 14px monospace';
  ctx.fillText(`EDIT ${edit.glyph} ${edit.name}`, 12, 15);
  ctx.fillStyle = '#b9bdc1'; ctx.font = '12px monospace';
  ctx.fillText(`${WAVE_NAMES[edit.wave] ?? edit.wave} · ${edit.sync ? `${edit.beats} beat${edit.beats === 1 ? '' : 's'}` : `${edit.hz} Hz`} · ${edit.on ? 'on' : 'off'}`, 190, 15);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#8a8f8d'; ctx.font = '12px monospace';
  ctx.fillText('Shift + button to leave', 948, 15);
  if (Number.isFinite(edit.signal)) { ctx.fillStyle = '#fff3cf'; ctx.font = 'bold 14px monospace'; ctx.fillText(`${edit.signal >= 0 ? '+' : ''}${edit.signal.toFixed(2)}`, 790, 15); }
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
    ctx.fillStyle = label ? '#f2c14e' : '#22282a'; ctx.fillRect(x + 4, 72, 112, 2);
    ctx.fillStyle = '#b9bdc1'; ctx.font = '12px monospace'; ctx.fillText(label, x + 10, 92);
    ctx.fillStyle = label ? '#f2c14e' : '#2b3234'; ctx.font = 'bold 22px monospace'; ctx.fillText(String(value).slice(0, 9), x + 10, 126);
  });
  drawLowerStrip(ctx, lowerLabels);
}

// Column colours: the same eight hues the pads and upper-button LEDs use (push3Map
// PERFORMANCE_HUES order: skyBlue, violet, pink, teal, lime, amber, blue, mint).
export const COLUMN_COLORS = Object.freeze(['#31adff', '#972bff', '#ff2bd4', '#26b98a', '#b6ff0e', '#ffc516', '#3663fc', '#62ff55']);
const INK = '#e8eaea', DIM = '#6f7776', FAINT = '#2a3032', BG = '#0d1011';

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
  ctx.strokeStyle = track; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
  if (Number.isFinite(t)) {
    ctx.strokeStyle = color; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx, cy, r, a0, a0 + (a1 - a0) * Math.max(0, Math.min(1, t))); ctx.stroke();
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
    ctx.fillStyle = assigned ? color : DIM; ctx.font = 'bold 12px monospace';
    ctx.fillText((control?.name ?? '—').slice(0, 14), x + 8, 13);
    ctx.fillStyle = assigned ? color : FAINT; ctx.fillRect(x + 4, 16, 112, 2);
    if (assigned && Number.isFinite(control.default) && Math.abs(control.value - control.default) > 1e-9) {
      ctx.fillStyle = color; ctx.font = '11px monospace'; ctx.textAlign = 'right'; ctx.fillText('↺', x + 114, 13); ctx.textAlign = 'left';
    }
  });

  // Info line: tempo · performance and scene · volume.
  const infoY = 33;
  if (tempo) {
    ctx.beginPath(); ctx.arc(11, infoY - 4, 4, 0, Math.PI * 2);
    ctx.fillStyle = tempo.lit ? '#ffffff' : tempo.running ? '#4a5254' : FAINT; ctx.fill();
    ctx.fillStyle = tempo.running ? '#ffb65d' : DIM; ctx.font = 'bold 13px monospace';
    ctx.fillText(tempo.bpm ? `${tempo.bpm.toFixed(1)} BPM` : tempo.label, 20, infoY);
    ctx.fillStyle = DIM; ctx.font = '11px monospace';
    if (tempo.bpm) ctx.fillText(tempo.label, 118, infoY);
  }
  ctx.fillStyle = '#62d7b1'; ctx.font = 'bold 13px monospace';
  ctx.fillText(title.slice(0, 28), 190, infoY);
  ctx.fillStyle = DIM; ctx.font = '11px monospace';
  const statusText = status.startsWith(title + ' · ') ? status.slice(title.length + 3) : status;
  ctx.fillText(statusText.slice(0, 48), 190 + Math.min(28, title.length) * 8 + 10, infoY);
  if (volume?.active || (transport && transport.kind === 'file' && transport.loaded)) {
    const level = Math.max(0, Math.min(1, (volume?.active ? volume.level : transport.volume) ?? 1));
    ctx.textAlign = 'right';
    ctx.fillStyle = volume?.active ? '#62d7b1' : DIM; ctx.font = 'bold 12px monospace';
    ctx.fillText(`VOL ${Math.round(level * 100)}%${transport?.kind === 'file' ? (transport.playing ? ' ▶' : ' ❚❚') : ''}`, 948, infoY);
    ctx.textAlign = 'left';
    ctx.fillStyle = FAINT; ctx.fillRect(868, infoY + 4, 80, 3);
    ctx.fillStyle = volume?.active ? '#62d7b1' : '#4a5254'; ctx.fillRect(868, infoY + 4, 80 * level, 3);
  }
  ctx.fillStyle = FAINT; ctx.fillRect(0, 40, 960, 1);

  if (browser) {
    // Jog-wheel browser replaces the columns while active: thumbnail, name, position.
    ctx.fillStyle = BG; ctx.fillRect(0, 42, 960, 100);
    const box = 80, bx = 20, by = 50;
    ctx.fillStyle = '#000'; ctx.fillRect(bx, by, box, box);
    if (browser.image && browser.image.complete && browser.image.naturalWidth > 0) ctx.drawImage(browser.image, bx, by, box, box);
    else { ctx.fillStyle = FAINT; ctx.fillRect(bx + 1, by + 1, box - 2, box - 2); }
    ctx.fillStyle = '#ffb65d'; ctx.font = '12px monospace';
    ctx.fillText(`PERFORMANCE ${browser.index + 1} / ${browser.count}${browser.isCurrent ? ' · CURRENT' : ''}`, 120, 66);
    ctx.fillStyle = INK; ctx.font = 'bold 30px monospace';
    ctx.fillText(String(browser.name).slice(0, 34), 120, 102);
    ctx.fillStyle = DIM; ctx.font = '12px monospace';
    ctx.fillText(`${browser.sceneCount} scene${browser.sceneCount === 1 ? '' : 's'} · turn jog to browse · press to load`, 120, 126);
    drawLowerStrip(ctx, lowerLabels);
    return;
  }

  // Columns: small caption, big value, knob arc. A modulation shows its glyph and rate in
  // the caption and drives the arc's marker with the live value.
  controls.forEach((control, i) => {
    const x = i * 120, color = COLUMN_COLORS[i];
    if (!control) {
      ctx.fillStyle = FAINT; ctx.font = '12px monospace'; ctx.fillText('unassigned', x + 8, 60);
      drawArc(ctx, x + 60, 108, 22, null, color);
      return;
    }
    const mod = control.modulation ?? null;
    const min = Number.isFinite(control.min) ? control.min : 0;
    const max = Number.isFinite(control.max) ? control.max : 1;
    const range = max > min ? max - min : 1;
    const shown = mod && Number.isFinite(mod.value) ? mod.value : control.value;
    ctx.fillStyle = mod ? (mod.running ? '#f2c14e' : DIM) : DIM; ctx.font = '11px monospace';
    ctx.fillText(mod ? `${mod.glyph} ${mod.rate}` : `${fmt(min)} – ${fmt(max)}`, x + 8, 56);
    ctx.fillStyle = INK; ctx.font = 'bold 24px monospace';
    ctx.fillText(fmt(shown), x + 8, 82);
    drawArc(ctx, x + 60, 112, 22, (control.value - min) / range, color, { mark: mod && Number.isFinite(mod.value) ? (mod.value - min) / range : null });
  });

  drawLowerStrip(ctx, lowerLabels);
}
