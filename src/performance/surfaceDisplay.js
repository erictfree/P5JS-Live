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
  // Labels for the lower display buttons: one modulation slot per column.
  const firstEmpty = lowerLabels.findIndex(s => !s);
  lowerLabels.forEach((slot, i) => {
    const x = i * 120;
    ctx.fillStyle = slot?.on ? '#3a2f0c' : '#1d2122'; ctx.fillRect(x + 3, 144, 114, 14);
    ctx.fillStyle = slot ? (slot.on ? '#f2c14e' : '#8a8f8d') : '#3c4143'; ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(slot ? `${slot.glyph} ${slot.name} ${slot.rate} ${slot.depth}`.slice(0, 17) : (i === firstEmpty ? '+ new' : ''), x + 7, 155);
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
    ctx.fillStyle = label ? '#3a2f0c' : '#1d2122'; ctx.fillRect(x + 4, 72, 112, 68);
    ctx.fillStyle = '#b9bdc1'; ctx.font = '12px monospace'; ctx.fillText(label, x + 10, 90);
    ctx.fillStyle = label ? '#f2c14e' : '#2b3234'; ctx.font = 'bold 22px monospace'; ctx.fillText(String(value).slice(0, 9), x + 10, 124);
  });
  drawLowerStrip(ctx, lowerLabels);
}

// `tempo` is optional: { bpm, label, running, lit } as produced by describeTempo(). When
// present it takes the left-hand 190 px of the header, directly under the Push 3 Tempo
// encoder, and mirrors the toolbar BPM readout with a dot that lights on the same
// 80 ms beat window as the tap button. Title and status shift right to make room.
const TEMPO_WIDTH = 190;
export function renderSurfaceDisplay(canvas, { title, status, controls, tempo = null, transport = null, browser = null, lowerLabels = null, volume = null, edit = null }) {
  const ctx = canvas.getContext('2d');
  if (edit) { renderEditScreen(ctx, edit, lowerLabels); return; }
  ctx.fillStyle = '#171a1c'; ctx.fillRect(0, 0, 960, 160);
  const left = tempo ? 15 + TEMPO_WIDTH + 10 : 15;
  const titleChars = tempo ? 55 : 65;
  const statusChars = tempo ? 76 : 92;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#62d7b1'; ctx.font = '22px monospace'; ctx.fillText(title.slice(0, titleChars), left, 30);
  ctx.fillStyle = '#b9bdc1'; ctx.font = '16px monospace'; ctx.fillText((status.startsWith(title + ' · ') ? status.slice(title.length + 3) : status).slice(0, statusChars), left, 57);
  if (tempo) {
    // Beat dot, then the number, then a small mode line beneath it.
    ctx.beginPath(); ctx.arc(26, 26, 8, 0, Math.PI * 2);
    ctx.fillStyle = tempo.lit ? '#ffffff' : tempo.running ? '#42474b' : '#25292c'; ctx.fill();
    if (tempo.lit) { ctx.beginPath(); ctx.arc(26, 26, 13, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2; ctx.stroke(); }
    ctx.fillStyle = tempo.running ? '#ffb65d' : '#6b7075'; ctx.font = 'bold 30px monospace';
    ctx.fillText(tempo.bpm ? tempo.bpm.toFixed(1) : tempo.label, 44, 36);
    ctx.fillStyle = '#b9bdc1'; ctx.font = '14px monospace';
    ctx.fillText(tempo.bpm ? `BPM · ${tempo.label}` : 'Tempo', 44, 58);
    ctx.fillStyle = '#42474b'; ctx.fillRect(15 + TEMPO_WIDTH, 12, 2, 50);
  }
  if (volume?.active) {
    // The Volume encoder just moved: show the level under it, whatever the source.
    const level = Math.max(0, Math.min(1, volume.level ?? 1));
    ctx.textAlign = 'right';
    ctx.fillStyle = '#62d7b1'; ctx.font = 'bold 26px monospace';
    ctx.fillText(`${Math.round(level * 100)}%`, 945, 34);
    ctx.fillStyle = '#b9bdc1'; ctx.font = '12px monospace';
    ctx.fillText('VOLUME', 945, 50);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#2b3234'; ctx.fillRect(805, 55, 140, 6);
    ctx.fillStyle = '#62d7b1'; ctx.fillRect(805, 55, 140 * level, 6);
  } else if (transport && transport.kind === 'file' && transport.loaded) {
    // Under the Volume encoder at the far right: level and play state.
    ctx.textAlign = 'right';
    ctx.fillStyle = transport.playing ? '#62d7b1' : '#8a9390'; ctx.font = 'bold 22px monospace';
    ctx.fillText(`${Math.round((transport.volume ?? 1) * 100)}%`, 945, 32);
    ctx.fillStyle = '#b9bdc1'; ctx.font = '13px monospace';
    ctx.fillText(transport.playing ? 'VOL · playing' : 'VOL · paused', 945, 54);
    ctx.textAlign = 'left';
  }
  if (browser) {
    // Jog-wheel browser replaces the encoder row while active: thumbnail, name, position.
    ctx.fillStyle = '#0f1213'; ctx.fillRect(0, 68, 960, 92);
    ctx.fillStyle = '#42474b'; ctx.fillRect(0, 68, 960, 2);
    const box = 80, bx = 20, by = 74;
    ctx.fillStyle = '#000'; ctx.fillRect(bx, by, box, box);
    if (browser.image && browser.image.complete && browser.image.naturalWidth > 0) ctx.drawImage(browser.image, bx, by, box, box);
    else { ctx.fillStyle = '#25292c'; ctx.fillRect(bx + 1, by + 1, box - 2, box - 2); }
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffb65d'; ctx.font = '13px monospace';
    ctx.fillText(`PERFORMANCE ${browser.index + 1} / ${browser.count}${browser.isCurrent ? ' · CURRENT' : ''}`, 120, 92);
    ctx.fillStyle = '#e2e4e5'; ctx.font = 'bold 30px monospace';
    ctx.fillText(String(browser.name).slice(0, 34), 120, 126);
    ctx.fillStyle = '#b9bdc1'; ctx.font = '14px monospace';
    ctx.fillText(`${browser.sceneCount} scene${browser.sceneCount === 1 ? '' : 's'} · turn jog to browse · press to load`, 120, 150);
    return;
  }
  controls.forEach((control, i) => {
    const x = i * 120;
    ctx.fillStyle = '#42474b'; ctx.fillRect(x + 5, 75, 110, 2);
    ctx.fillStyle = '#e2e4e5'; ctx.font = '14px monospace'; ctx.fillText((control?.name ?? 'Unassigned').slice(0, 12), x + 8, 103);
    // A modulation shows its waveform glyph and rate; the readout follows the live value.
    const mod = control?.modulation ?? null;
    const shown = mod && Number.isFinite(mod.value) ? mod.value : control?.value;
    ctx.fillStyle = mod?.running ? '#f2c14e' : '#ffb65d'; ctx.font = '20px monospace';
    ctx.fillText(typeof shown === 'number' ? String(Number(shown.toFixed(3))).slice(0, 9) : '—', x + 8, 137);
    if (mod) {
      ctx.textAlign = 'right';
      ctx.fillStyle = mod.running ? '#f2c14e' : '#7c8886'; ctx.font = '13px monospace';
      ctx.fillText(`${mod.glyph} ${mod.rate}`, x + 114, 120);
      ctx.textAlign = 'left';
    }
  });
  drawLowerStrip(ctx, lowerLabels);
}
