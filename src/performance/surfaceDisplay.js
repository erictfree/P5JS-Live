// Pixel output is independent of any future USB transport. No device I/O here.
export const SURFACE_PROFILES = Object.freeze([
  { id: 'virtual', name: 'Virtual Push', status: 'Simulator' },
  { id: 'push1', name: 'Push 1', status: 'Hardware unverified · MIDI Learn only' },
  { id: 'push2', name: 'Push 2', status: 'Hardware unverified · MIDI Learn only' },
  { id: 'push3', name: 'Push 3', status: 'Hardware unverified · MIDI Learn only' },
]);

// `tempo` is optional: { bpm, label, running, lit } as produced by describeTempo(). When
// present it takes the left-hand 190 px of the header, directly under the Push 3 Tempo
// encoder, and mirrors the toolbar BPM readout with a dot that lights on the same
// 80 ms beat window as the tap button. Title and status shift right to make room.
const TEMPO_WIDTH = 190;
export function renderSurfaceDisplay(canvas, { title, status, controls, tempo = null, transport = null, browser = null }) {
  const ctx = canvas.getContext('2d');
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
  if (transport && transport.kind === 'file' && transport.loaded) {
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
}
