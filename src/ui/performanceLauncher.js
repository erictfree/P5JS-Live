import { SURFACE_PROFILES, renderSurfaceDisplay } from '../performance/surfaceDisplay.js';

export function createPerformanceSurface({ root, launcher, store, registry, controlManager, recover, addDemos }) {
  root.innerHTML = `
    <div class="surface-heading"><h3>Live launcher</h3><button type="button" data-open>Open controller</button></div>
    <p class="hint">Pads launch visuals and saved values. Your audio, clock and MIDI setup keep running. Recall below restores the whole snapshot.</p>
    <dialog class="performance-surface" aria-label="Virtual performance controller">
      <header><h2>Performance controller</h2><button type="button" data-close aria-label="Close performance controller">Close</button></header>
      <div class="surface-toolbar">
        <label>Profile <select data-profile aria-label="Controller profile"></select></label>
        <span data-profile-status></span>
        <button type="button" data-connect>Connect MIDI</button><span data-midi-status></span>
      </div>
      <canvas width="960" height="160" role="img" aria-label="Controller display preview"></canvas>
      <div class="surface-encoders"></div>
      <p><button type="button" data-demos>Add two demo performances</button> <span class="hint">Eight controls each. Plays when you select a pad.</span></p>
      <div class="surface-toolbar">
        <button type="button" data-action="bankPrevious" aria-label="Previous pad bank">←</button>
        <strong data-bank></strong><button type="button" data-action="bankNext" aria-label="Next pad bank">→</button>
        <label>Launch <select data-timing aria-label="Launch timing"><option value="immediate">Immediately</option><option value="beat">Next beat</option></select></label>
        <button type="button" data-cancel>Cancel queue / Learn</button>
        <button type="button" data-action="tap">Tap</button><button type="button" data-action="safe">Restore safe</button>
      </div>
      <div class="surface-pads" aria-label="Performance pads"></div>
      <p class="surface-status" role="status"></p>
      <div class="surface-toolbar"><label>Pad <input data-slot type="number" min="1" max="64" value="1" aria-label="Pad to assign"></label>
        <label>Performance <select data-assignment aria-label="Pad performance"></select></label>
        <button type="button" data-assign>Assign pad</button>
        <button type="button" data-recover>Recover previous edits</button></div>
      <details><summary>MIDI Learn and hardware status</summary>
        <p>Push 1, 2 and 3 are target profiles, unverified on hardware. No automatic maps, LED output or USB display transfer yet. The preview uses a virtual 960 × 160 display.</p>
        <div class="surface-toolbar"><label>Action <select data-learn-action aria-label="MIDI action"><option value="pad">Pad</option><option value="encoder">Encoder</option><option value="tap">Tap</option><option value="safe">Restore safe</option><option value="bankNext">Next bank</option><option value="bankPrevious">Previous bank</option></select></label>
          <label>Number <input data-learn-index type="number" min="1" max="64" value="1" aria-label="MIDI action number"></label>
          <label>Encoder <select data-learn-mode aria-label="Encoder MIDI mode"><option value="absolute">Absolute · pickup</option><option value="relative">Relative · two’s complement</option></select></label>
          <button type="button" data-learn>Learn</button><button type="button" data-clear>Clear surface routes</button></div>
        <p data-learn-status></p><ul data-routes></ul>
        <p class="hint">Pad numbers are relative to the current bank. For encoders, turn the knob; touch messages are ignored. Surface routes take priority over parameter mappings. Select an encoder’s target above; use − / + or arrow keys to adjust it (Shift for fine steps).</p>
      </details>
    </dialog>`;
  // Keep all 64 pads visible beside the encoders on a laptop-sized display.
  const playArea = document.createElement('div'); playArea.className = 'surface-play';
  const padArea = document.createElement('div');
  const encoderArea = document.createElement('aside');
  const grid = root.querySelector('.surface-pads');
  padArea.append(grid.previousElementSibling, grid);
  encoderArea.append(root.querySelector('.surface-encoders'), root.querySelector('.surface-status'), root.querySelector('[data-slot]').closest('.surface-toolbar'));
  playArea.append(padArea, encoderArea);
  root.querySelector('canvas').after(playArea);
  const demoRow = root.querySelector('[data-demos]').closest('p');
  root.querySelector('[data-profile]').closest('.surface-toolbar').append(root.querySelector('[data-demos]'));
  demoRow.remove();
  const modal = root.querySelector('dialog');
  const $ = selector => root.querySelector(selector) ?? modal.querySelector(selector);
  const profile = $('[data-profile]');
  // Diagnostics can switch the drawer tab during recovery. Keep this modal outside it.
  document.body.append(modal);
  for (const item of SURFACE_PROFILES) profile.add(new Option(item.name, item.id));
  profile.onchange = () => { $('[data-profile-status]').textContent = SURFACE_PROFILES.find(p => p.id === profile.value).status; };
  profile.onchange();
  $('[data-open]').onclick = () => { modal.showModal(); render(); };
  $('[data-close]').onclick = () => modal.close();
  modal.addEventListener('close', () => launcher.cancelLearn());
  $('[data-connect]').onclick = () => controlManager.connectMidi();
  $('[data-timing]').onchange = event => launcher.setTiming(event.target.value);
  $('[data-cancel]').onclick = () => launcher.cancel();
  $('[data-demos]').onclick = () => addDemos();
  $('[data-recover]').onclick = () => recover();
  for (const button of modal.querySelectorAll('[data-action]')) button.onclick = () => launcher.dispatch({ action: button.dataset.action });
  const pads = Array.from({ length: 64 }, (_, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.pad = index;
    button.onclick = () => { $('[data-slot]').value = index + 1; launcher.dispatch({ action: 'pad', index }); };
    $('.surface-pads').append(button); return button;
  });
  const encoders = Array.from({ length: 8 }, (_, index) => {
    const wrapper = document.createElement('div'); wrapper.className = 'surface-encoder';
    const select = document.createElement('select'); select.setAttribute('aria-label', `Encoder ${index + 1} target`);
    select.onchange = () => launcher.assignEncoder(index, select.value || null);
    const value = document.createElement('output'); value.setAttribute('aria-label', `Encoder ${index + 1} value`);
    const buttons = document.createElement('div');
    for (const [label, delta] of [['−', -1], ['+', 1]]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.setAttribute('aria-label', `${delta < 0 ? 'Decrease' : 'Increase'} encoder ${index + 1}`);
      button.onclick = event => launcher.dispatch({ action: 'encoder', index, value: delta, fine: event.shiftKey });
      buttons.append(button);
    }
    wrapper.onkeydown = event => {
      if (event.target === select || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault(); launcher.dispatch({ action: 'encoder', index, value: event.key === 'ArrowLeft' ? -1 : 1, fine: event.shiftKey });
    };
    wrapper.append(select, value, buttons); $('.surface-encoders').append(wrapper); return { select, value };
  });
  $('[data-assign]').onclick = () => {
    const state = launcher.snapshot();
    const slot = Number($('[data-slot]').value) - 1;
    if (Number.isInteger(slot) && slot >= 0 && slot < 64) launcher.assign(state.bank * 64 + slot, $('[data-assignment]').value || null);
  };
  $('[data-learn]').onclick = () => {
    const action = $('[data-learn-action]').value, index = Number($('[data-learn-index]').value) - 1;
    if ((action === 'pad' && (index < 0 || index > 63)) || (action === 'encoder' && (index < 0 || index > 7)) || !Number.isInteger(index)) {
      $('[data-learn-status]').textContent = 'Choose pad 1–64 or encoder 1–8.'; return;
    }
    launcher.learn(action, index, $('[data-learn-mode]').value);
  };
  $('[data-clear]').onclick = () => launcher.clearRoutes();
  let optionSignature = '', paramSignature = '';
  function render() {
    if (!modal.open) return;
    const state = launcher.snapshot(), entries = store.list(), params = registry.listParams().filter(p => typeof p.value === 'number');
    const signature = JSON.stringify(entries.map(p => [p.id, p.name]));
    if (signature !== optionSignature) {
      optionSignature = signature; const select = $('[data-assignment]'), previous = select.value;
      select.replaceChildren(new Option('Empty', ''));
      entries.forEach(p => select.add(new Option(p.name, p.id))); select.value = previous;
    }
    const names = JSON.stringify(params.map(p => p.name));
    if (names !== paramSignature) {
      paramSignature = names;
      encoders.forEach(({ select }) => { select.replaceChildren(new Option('Unassigned', '')); params.forEach(p => select.add(new Option(p.name, p.name))); });
    }
    encoders.forEach(({ select, value }, i) => {
      select.value = state.targets[i] ?? ''; const param = params.find(p => p.name === state.targets[i]);
      value.textContent = param ? String(Number(param.value.toFixed(3))) : '—';
    });
    pads.forEach((pad, i) => {
      const slot = state.bank * 64 + i, id = state.slots[slot], entry = entries.find(p => p.id === id);
      const status = id && state.loading === id ? 'loading' : id && state.queued?.id === id ? 'queued' : id && state.error?.id === id ? 'failed' : id && state.active === id ? 'playing' : entry ? 'ready' : 'empty';
      pad.textContent = `${i + 1} ${entry?.name.replace(/^Controller demo · /, '') ?? '—'}`;
      pad.title = entry?.name ?? 'Empty pad';
      pad.dataset.status = status; pad.setAttribute('aria-label', `Pad ${i + 1}: ${entry?.name ?? 'Empty'} · ${status}`);
      pad.setAttribute('aria-pressed', String(state.selected === slot)); pad.disabled = Boolean(state.loading);
    });
    const active = entries.find(p => p.id === state.active)?.name ?? 'Working scene';
    const status = state.loading ? 'Loading…' : state.error ? state.error.message : state.queued ? `Queued: ${entries.find(p => p.id === state.queued.id)?.name} · next beat` : `${active} · ${state.active ? 'playing' : 'live'}`;
    $('.surface-status').textContent = status;
    $('[data-bank]').textContent = `Bank ${state.bank + 1}`;
    $('[data-timing]').value = state.timing;
    $('[data-learn-status]').textContent = state.learning ? `Learning ${state.learning.action} ${state.learning.index + 1} — send a MIDI message; Cancel to stop.` : `${state.routes.length} surface routes`;
    $('[data-routes]').replaceChildren(...state.routes.map(route => {
      const li = document.createElement('li'); li.textContent = `${route.device} · Ch ${route.channel} ${route.type} ${route.number} → ${route.action} ${route.index + 1}`; return li;
    }));
    const canvas = $('canvas'); canvas.setAttribute('aria-label', `${active}. ${status}`);
    renderSurfaceDisplay(canvas, { title: active, status, controls: state.targets.map(name => params.find(p => p.name === name)) });
  }
  launcher.subscribe(render);
  registry.subscribe(render);
  controlManager.subscribe(() => { const state = controlManager.snapshot(); $('[data-midi-status]').textContent = state.midi.status; });
  return { render };
}
