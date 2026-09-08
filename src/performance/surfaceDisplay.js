// Pixel output is independent of any future USB transport. No device I/O here.
export const SURFACE_PROFILES = Object.freeze([
  { id: 'virtual', name: 'Virtual Push', status: 'Simulator' },
  { id: 'push1', name: 'Push 1', status: 'Hardware unverified · MIDI Learn only' },
  { id: 'push2', name: 'Push 2', status: 'Hardware unverified · MIDI Learn only' },
  { id: 'push3', name: 'Push 3', status: 'Hardware unverified · MIDI Learn only' },
]);

export function renderSurfaceDisplay(canvas, { title, status, controls }) {
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#171a1c'; ctx.fillRect(0, 0, 960, 160);
  ctx.fillStyle = '#62d7b1'; ctx.font = '22px monospace'; ctx.fillText(title.slice(0, 65), 15, 30);
  ctx.fillStyle = '#b9bdc1'; ctx.font = '16px monospace'; ctx.fillText((status.startsWith(title + ' · ') ? status.slice(title.length + 3) : status).slice(0, 92), 15, 57);
  controls.forEach((control, i) => {
    const x = i * 120;
    ctx.fillStyle = '#42474b'; ctx.fillRect(x + 5, 75, 110, 2);
    ctx.fillStyle = '#e2e4e5'; ctx.font = '14px monospace'; ctx.fillText((control?.name ?? 'Unassigned').slice(0, 12), x + 8, 103);
    ctx.fillStyle = '#ffb65d'; ctx.font = '20px monospace';
    ctx.fillText(typeof control?.value === 'number' ? String(Number(control.value.toFixed(3))).slice(0, 9) : '—', x + 8, 137);
  });
}
