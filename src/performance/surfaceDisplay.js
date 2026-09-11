// Pixel output is independent of any future USB transport. No device I/O here.
export const SURFACE_PROFILES = Object.freeze([
  { id: 'virtual', name: 'Virtual Push', status: 'Simulator' },
  { id: 'push1', name: 'Push 1', status: 'Hardware unverified · MIDI Learn only' },
  { id: 'push2', name: 'Push 2', status: 'Hardware unverified · MIDI Learn only' },
  { id: 'push3', name: 'Push 3', status: 'Hardware unverified · MIDI Learn only' },
]);

// `tempo` is optional: { bpm, label, running, lit } as produced by describeTempo(). When
// present it takes the right-hand 200 px of the header and mirrors the toolbar BPM
// readout, with a dot that lights on the same 80 ms beat window as the tap button.
export function renderSurfaceDisplay(canvas, { title, status, controls, tempo = null }) {
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#171a1c'; ctx.fillRect(0, 0, 960, 160);
  const headerWidth = tempo ? 50 : 65;
  ctx.fillStyle = '#62d7b1'; ctx.font = '22px monospace'; ctx.fillText(title.slice(0, headerWidth), 15, 30);
  ctx.fillStyle = '#b9bdc1'; ctx.font = '16px monospace'; ctx.fillText((status.startsWith(title + ' · ') ? status.slice(title.length + 3) : status).slice(0, tempo ? 72 : 92), 15, 57);
  if (tempo) {
    const right = 945;
    ctx.textAlign = 'right';
    ctx.fillStyle = tempo.running ? '#ffb65d' : '#6b7075'; ctx.font = 'bold 30px monospace';
    ctx.fillText(tempo.bpm ? `${tempo.bpm.toFixed(1)} BPM` : tempo.label, right, 36);
    ctx.fillStyle = '#b9bdc1'; ctx.font = '14px monospace';
    if (tempo.bpm) ctx.fillText(tempo.label, right, 58);
    ctx.textAlign = 'left';
    ctx.beginPath(); ctx.arc(760, 28, 9, 0, Math.PI * 2);
    ctx.fillStyle = tempo.lit ? '#ffffff' : tempo.running ? '#42474b' : '#25292c'; ctx.fill();
    if (tempo.lit) { ctx.beginPath(); ctx.arc(760, 28, 14, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2; ctx.stroke(); }
  }
  controls.forEach((control, i) => {
    const x = i * 120;
    ctx.fillStyle = '#42474b'; ctx.fillRect(x + 5, 75, 110, 2);
    ctx.fillStyle = '#e2e4e5'; ctx.font = '14px monospace'; ctx.fillText((control?.name ?? 'Unassigned').slice(0, 12), x + 8, 103);
    ctx.fillStyle = '#ffb65d'; ctx.font = '20px monospace';
    ctx.fillText(typeof control?.value === 'number' ? String(Number(control.value.toFixed(3))).slice(0, 9) : '—', x + 8, 137);
  });
}
