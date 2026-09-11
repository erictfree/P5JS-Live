import { SURFACE_PROFILES, renderSurfaceDisplay } from '../performance/surfaceDisplay.js';
import { decodePush3Bgr565 } from '../performance/push3DisplayTransport.js';
import { PUSH3_BUTTONS, PUSH3_COLORS, animationChannel } from '../performance/push3Map.js';
import { PADS_PER_BANK } from '../performance/launcher.js';

const startupImageUrl = new URL('../../assets/brand/startup.bgr565', import.meta.url).href;

export function createPerformanceSurface({ root, launcher, store, registry, controlManager, push3Display, push3Leds, effects, tempo = null, recover, addDemos }) {
  root.innerHTML = `
    <div class="surface-heading"><h3>Live launcher</h3><button type="button" data-open>Open controller</button></div>
    <p class="hint">Pads launch visuals and saved values. Your audio, clock and MIDI setup keep running. Recall below restores the whole snapshot.</p>
    <dialog class="performance-surface" aria-label="Virtual performance controller">
      <header><div><span class="surface-eyebrow">LIVE / CONTROL SURFACE</span><h2>Performance controller</h2></div><button type="button" data-close aria-label="Close performance controller">Close</button></header>
      <div class="surface-toolbar">
        <label>Profile <select data-profile aria-label="Controller profile"></select></label>
        <span data-profile-status></span>
        <button type="button" data-connect>Connect MIDI</button><span data-midi-status></span>
      </div>
      <canvas width="960" height="160" role="img" aria-label="Controller display preview"></canvas>
      <div data-display-controls>
        <div class="surface-toolbar"><button type="button" data-connect-display>Connect Push display</button><button type="button" data-claim-display>Claim interface 0</button><button type="button" data-test-display>Test once</button><button type="button" data-startup-display>Show startup</button><button type="button" data-start-display>Show controller</button><button type="button" data-stop-display>Stop</button><button type="button" data-release-display>Release</button><span data-display-status role="status"></span></div>
        <p class="hint">Test shows color bars briefly. Startup and controller modes remain visible until stopped.</p>
      </div>
      <div data-led-controls>
        <div class="surface-toolbar"><button type="button" data-connect-leds>Connect Push MIDI</button><label>Output <select data-led-output aria-label="Push MIDI output"></select></label><button type="button" data-led-pad>Light pad 1</button><button type="button" data-led-pad-off>Pad 1 off</button><button type="button" data-led-buttons>Light Play + Tap</button><button type="button" data-led-fade>Fade upper 1</button><button type="button" data-led-pulse>Pulse pad 64</button><button type="button" data-led-clear>Clear LEDs</button><button type="button" data-led-release>Release</button><span data-led-status role="status"></span></div>
        <p class="hint">LED bench uses three-byte MIDI on the Push User Port; no sysex. Pulse starts a 120 BPM clock. Last input: <span data-led-input>—</span></p>
      </div>
      <div class="surface-encoders"></div>
      <p><button type="button" data-demos>Add two demo performances</button> <span class="hint">Eight controls each. Plays when you select a pad.</span></p>
      <div class="surface-toolbar">
        <button type="button" data-action="bankPrevious" aria-label="Previous pad bank">←</button>
        <strong data-bank></strong><button type="button" data-action="bankNext" aria-label="Next pad bank">→</button>
        <label>Launch <select data-timing aria-label="Launch timing"><option value="immediate">Immediately</option><option value="beat">Next beat</option></select></label>
        <button type="button" data-cancel title="Cancel queued launch or MIDI Learn">Cancel</button>
        <button type="button" data-action="tap">Tap</button><button type="button" data-action="safe">Restore safe</button>
      </div>
      <div class="surface-pads" aria-label="Performance and effect pads"></div>
      <p class="surface-status" role="status"></p>
      <div class="surface-toolbar"><label>Pad <input data-slot type="number" min="1" max="32" value="1" aria-label="Pad to assign"></label>
        <label>Performance <select data-assignment aria-label="Pad performance"></select></label>
        <button type="button" data-assign>Assign pad</button>
        <button type="button" data-recover>Recover previous edits</button></div>
      <details><summary>MIDI Learn and hardware status</summary>
        <p>Push 1, 2 and 3 are target profiles. MIDI maps, LEDs and display transfer remain unverified. The preview uses a virtual 960 × 160 display.</p>
        <div class="surface-toolbar"><label>Action <select data-learn-action aria-label="MIDI action"><option value="pad">Pad</option><option value="encoder">Encoder</option><option value="tap">Tap</option><option value="safe">Restore safe</option><option value="bankNext">Next bank</option><option value="bankPrevious">Previous bank</option></select></label>
          <label>Number <input data-learn-index type="number" min="1" max="64" value="1" aria-label="MIDI action number"></label>
          <label>Encoder <select data-learn-mode aria-label="Encoder MIDI mode"><option value="absolute">Absolute · pickup</option><option value="relative">Relative · two’s complement</option></select></label>
          <button type="button" data-learn>Learn</button><button type="button" data-clear>Clear surface routes</button></div>
        <p data-learn-status></p><ul data-routes></ul>
        <p class="hint">Pads 1–32 launch performances in the current bank; pads 33–64 switch the scene's toggle controls (<code>control(name, false, { mode: 'toggle' })</code>) on and off. Pad numbers are relative to the current bank. For encoders, turn the knob; touch messages are ignored. Surface routes take priority over parameter mappings. Select an encoder’s target above; use − / + or arrow keys to adjust it (Shift for fine steps).</p>
      </details>
    </dialog>`;
  // Keep all 64 pads visible beside the encoders on a laptop-sized display.
  const playArea = document.createElement('div'); playArea.className = 'surface-play';
  const padArea = document.createElement('div'); padArea.className = 'surface-pad-area';
  const encoderArea = document.createElement('aside');
  const grid = root.querySelector('.surface-pads');
  padArea.append(grid.previousElementSibling, grid);
  const controlTitle = document.createElement('h3'); controlTitle.className = 'surface-section-label'; controlTitle.textContent = 'Live controls';
  encoderArea.append(controlTitle, root.querySelector('.surface-encoders'), root.querySelector('.surface-status'), root.querySelector('[data-slot]').closest('.surface-toolbar'));
  playArea.append(padArea, encoderArea);
  root.querySelector('canvas').after(root.querySelector('[data-display-controls]'), root.querySelector('[data-led-controls]'), playArea);
  const demoRow = root.querySelector('[data-demos]').closest('p');
  const setup = root.querySelector('details');
  setup.querySelector('summary').after(root.querySelector('[data-profile]').closest('.surface-toolbar'));
  const demoButton = root.querySelector('[data-demos]');
  demoButton.textContent = 'Add demos';
  demoButton.setAttribute('aria-label', 'Add two demo performances');
  root.querySelector('[data-close]').before(demoButton);
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
  $('[data-connect-display]').onclick = () => push3Display.connect();
  $('[data-claim-display]').onclick = () => push3Display.claim();
  $('[data-test-display]').onclick = () => push3Display.sendTestPattern();
  let startupFramePromise;
  const getStartupFrame = () => {
    startupFramePromise ??= fetch(startupImageUrl)
      .then(response => {
        if (!response.ok) throw new Error(`Could not load the Push startup image (${response.status}).`);
        return response.arrayBuffer();
      })
      .then(buffer => decodePush3Bgr565(new Uint8Array(buffer)));
    return startupFramePromise;
  };
  $('[data-startup-display]').onclick = async () => {
    const frame = await getStartupFrame();
    return push3Display.startStream(() => frame, { fps: 5, label: 'startup' });
  };
  // The hardware stream pulls at 15 fps; redraw the surface on each pull so the BPM
  // readout and beat dot stay live on the Push even while the modal is closed.
  const showController = () => push3Display.startStream(() => {
    const canvas = $('canvas');
    drawSurface(canvas);
    return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  });
  $('[data-start-display]').onclick = showController;
  $('[data-stop-display]').onclick = () => push3Display.stopStream();
  $('[data-release-display]').onclick = () => push3Display.release();
  $('[data-timing]').onchange = event => launcher.setTiming(event.target.value);
  $('[data-cancel]').onclick = () => launcher.cancel();
  $('[data-demos]').onclick = () => addDemos();
  $('[data-recover]').onclick = () => recover();
  for (const button of modal.querySelectorAll('[data-action]')) button.onclick = () => launcher.dispatch({ action: button.dataset.action });
  const pads = Array.from({ length: 64 }, (_, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.pad = index;
    if (index < PADS_PER_BANK) {
      button.onclick = () => { $('[data-slot]').value = index + 1; launcher.dispatch({ action: 'pad', index }); };
    } else {
      button.dataset.effect = index - PADS_PER_BANK;
      button.onclick = () => { effects?.toggle(index - PADS_PER_BANK); render(); };
    }
    $('.surface-pads').append(button); return button;
  });
  const encoders = Array.from({ length: 8 }, (_, index) => {
    const wrapper = document.createElement('div'); wrapper.className = 'surface-encoder';
    const number = document.createElement('span'); number.className = 'surface-encoder-number'; number.textContent = String(index + 1).padStart(2, '0');
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
    wrapper.append(number, select, value, buttons); $('.surface-encoders').append(wrapper); return { select, value };
  });
  $('[data-assign]').onclick = () => {
    const state = launcher.snapshot();
    const slot = Number($('[data-slot]').value) - 1;
    if (Number.isInteger(slot) && slot >= 0 && slot < PADS_PER_BANK) launcher.assign(state.bank * PADS_PER_BANK + slot, $('[data-assignment]').value || null);
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
  let lastSurface = { title: 'No scene', status: 'No scene · live', controls: [] };
  function drawSurface(canvas) {
    renderSurfaceDisplay(canvas, { ...lastSurface, tempo: tempo?.() ?? null });
  }
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
      select.parentElement.dataset.assigned = String(Boolean(param));
    });
    const effectList = effects?.list() ?? [];
    pads.forEach((pad, i) => {
      if (i >= PADS_PER_BANK) {
        const effect = effectList[i - PADS_PER_BANK];
        const status = effect ? (effect.value ? 'on' : 'off') : 'unbound';
        pad.textContent = `${i + 1} ${effect?.name ?? '—'}`;
        pad.title = effect ? `Effect ${effect.name}: ${effect.value ? 'on' : 'off'}` : 'No toggle control bound';
        pad.dataset.status = status; pad.setAttribute('aria-label', `Effect pad ${i + 1}: ${effect?.name ?? 'unbound'} · ${status}`);
        pad.setAttribute('aria-pressed', String(Boolean(effect?.value))); pad.disabled = !effect;
        return;
      }
      const slot = state.bank * PADS_PER_BANK + i, id = state.slots[slot], entry = entries.find(p => p.id === id);
      const status = id && state.loading === id ? 'loading' : id && state.queued?.id === id ? 'queued' : id && state.error?.id === id ? 'failed' : id && state.active === id ? 'playing' : entry ? 'ready' : 'empty';
      pad.textContent = `${i + 1} ${entry?.name.replace(/^Controller demo · /, '') ?? '—'}`;
      pad.title = entry?.name ?? 'Empty pad';
      pad.dataset.status = status; pad.setAttribute('aria-label', `Pad ${i + 1}: ${entry?.name ?? 'Empty'} · ${status}`);
      pad.setAttribute('aria-pressed', String(state.selected === slot)); pad.disabled = Boolean(state.loading);
    });
    // Name the running thing the way the toolbar's LIVE label does: the performance if one
    // is active, otherwise the live scene's own name.
    const active = entries.find(p => p.id === state.active)?.name ?? registry.activeSceneName?.() ?? 'No scene';
    const status = state.loading ? 'Loading…' : state.error ? state.error.message : state.queued ? `Queued: ${entries.find(p => p.id === state.queued.id)?.name} · next beat` : `${active} · ${state.active ? 'playing' : 'live'}`;
    $('.surface-status').textContent = status;
    $('[data-bank]').textContent = `Bank ${state.bank + 1}`;
    $('[data-timing]').value = state.timing;
    $('[data-learn-status]').textContent = state.learning ? `Learning ${state.learning.action} ${state.learning.index + 1} — send a MIDI message; Cancel to stop.` : `${state.routes.length} surface routes`;
    $('[data-routes]').replaceChildren(...state.routes.map(route => {
      const li = document.createElement('li'); li.textContent = `${route.device} · Ch ${route.channel} ${route.type} ${route.number} → ${route.action} ${route.index + 1}`; return li;
    }));
    const canvas = $('canvas'); canvas.setAttribute('aria-label', `${active}. ${status}`);
    lastSurface = { title: active, status, controls: state.targets.map(name => params.find(p => p.name === name)) };
    drawSurface(canvas);
  }
  // Per-frame hook: keeps the modal's preview beat dot moving. Hardware streaming
  // redraws on its own pull, so nothing happens here unless the modal is open.
  function frame() {
    if (modal.open && tempo) drawSurface($('canvas'));
  }
  launcher.subscribe(render);
  registry.subscribe(render);
  controlManager.subscribe(() => { const state = controlManager.snapshot(); $('[data-midi-status]').textContent = state.midi.status; });
  const renderDisplayStatus = () => {
    const state = push3Display.snapshot();
    $('[data-display-status]').textContent = state.status;
    $('[data-connect-display]').disabled = !state.supported || state.status === 'requesting permission';
    $('[data-claim-display]').disabled = !state.descriptor || state.claimed || state.status === 'claiming interface 0';
    $('[data-test-display]').disabled = !state.claimed || state.status === 'sending one test frame';
    $('[data-startup-display]').disabled = !state.claimed || state.status.startsWith('streaming startup');
    $('[data-start-display]').disabled = !state.claimed || state.status.startsWith('streaming controller preview');
    $('[data-stop-display]').disabled = !state.streaming;
    $('[data-release-display]').disabled = !state.claimed;
  };
  push3Display.subscribe(renderDisplayStatus);
  renderDisplayStatus();
  const ledControls = $('[data-led-controls]');
  if (!push3Leds) ledControls.hidden = true;
  else {
    const ledOutput = $('[data-led-output]');
    $('[data-connect-leds]').onclick = () => push3Leds.connect();
    ledOutput.onchange = () => { if (ledOutput.value) push3Leds.selectOutput(ledOutput.value); };
    $('[data-led-pad]').onclick = () => push3Leds.setPad(0, PUSH3_COLORS.green);
    $('[data-led-pad-off]').onclick = () => push3Leds.setPad(0, PUSH3_COLORS.off);
    $('[data-led-buttons]').onclick = () => { push3Leds.setButton(PUSH3_BUTTONS.play, PUSH3_COLORS.green); push3Leds.setButton(PUSH3_BUTTONS.tapTempo, PUSH3_COLORS.litWhite); };
    $('[data-led-fade]').onclick = () => push3Leds.animateButton(PUSH3_BUTTONS.upper1, PUSH3_COLORS.off, PUSH3_COLORS.pink, animationChannel('oneShot', '1/2'));
    $('[data-led-pulse]').onclick = () => { push3Leds.startClock(120); push3Leds.animatePad(63, PUSH3_COLORS.blue, PUSH3_COLORS.skyBlue, animationChannel('pulse', '1/4')); };
    $('[data-led-clear]').onclick = () => { push3Leds.clearOwnedLeds(); push3Leds.stopClock(); };
    $('[data-led-release]').onclick = () => push3Leds.disconnect();
    let ledPortSignature = '';
    const renderLedStatus = () => {
      const state = push3Leds.snapshot();
      $('[data-led-status]').textContent = state.status + (state.owned ? ` · ${state.owned} lit` : '') + (state.clockBpm ? ` · clock ${state.clockBpm}` : '');
      const signature = JSON.stringify(state.ports.outputs.map(p => [p.id, p.name, p.state]));
      if (signature !== ledPortSignature) {
        ledPortSignature = signature;
        ledOutput.replaceChildren(new Option(state.ports.outputs.length ? 'Choose output' : 'No outputs', ''));
        state.ports.outputs.forEach(p => ledOutput.add(new Option(p.name, p.id)));
      }
      ledOutput.value = state.output?.id ?? '';
      const ready = Boolean(state.output);
      $('[data-connect-leds]').disabled = !state.supported || state.status === 'connecting';
      ledOutput.disabled = !state.hasAccess;
      for (const selector of ['[data-led-pad]', '[data-led-pad-off]', '[data-led-buttons]', '[data-led-fade]', '[data-led-pulse]']) $(selector).disabled = !ready;
      $('[data-led-clear]').disabled = !ready || (!state.owned && !state.clockBpm);
      $('[data-led-release]').disabled = !ready;
      const last = state.lastInput;
      $('[data-led-input]').textContent = last
        ? `${last.raw.map(b => b.toString(16).padStart(2, '0')).join(' ')} → ${last.decoded ? Object.entries(last.decoded).map(([k, v]) => `${k}=${v}`).join(' ') : 'unknown'}`
        : '—';
    };
    push3Leds.subscribe(renderLedStatus);
    renderLedStatus();
  }
  return { render, frame, showController };
}
