// A self-contained design prototype. No instrument modules, storage, or device APIs.
const $ = (id) => document.getElementById(id);
const all = (selector) => [...document.querySelectorAll(selector)];
const patches = [
  { id: 'plasma', name: 'Plasma', category: 'Effect', description: 'Flowing color and distortion over the layers below.', symbol: '≈', state: 'active' },
  { id: 'neonTunnel', name: 'Neon tunnel', category: 'Drawing', description: 'Geometric rings receding into a luminous tunnel.', symbol: '◎', state: 'active' },
  { id: 'checkerZoom', name: 'Checker zoom', category: 'Drawing', description: 'A moving checkerboard with adjustable speed.', symbol: '▦', state: 'installed' },
  { id: 'laserFan', name: 'Laser fan', category: 'Drawing', description: 'A fan of colored beams. Adjust spread and direction.', symbol: '⋔', state: 'available' },
  { id: 'kaleido', name: 'Kaleidoscope', category: 'Effect', description: 'Turn the scene into mirrored radial patterns.', symbol: '✳', state: 'available' },
  { id: 'pixelRain', name: 'Pixel rain', category: 'Drawing', description: 'Sparse trails of falling light across the canvas.', symbol: '⋮', state: 'available' },
];
const performances = [
  { name: 'Afterglow', scene: 'afterglow', layers: 10, saved: 'Today, 15:09' },
  { name: 'Slow orbit', scene: 'slowOrbit', layers: 4, saved: 'Today, 14:42' },
  { name: 'Late-night lasers', scene: 'lateNightLasers', layers: 6, saved: 'Yesterday, 22:18' },
];
let currentPerformance = 0;
let scope = 'all';
let connected = false;
let playing = false;
let audioSource = 'file';
let safePerformance = 0;
const scrollPositions = {};
let currentArea = 'library';
const notes = {
  library: ['01 / LIBRARY', 'Find. Add. Review.', 'The collection becomes the starting point, with a clear next action on each patch.', [
    ['Search before instructions', 'Search, scope, and category filters sit above the results. Uncommon help lives below them.'],
    ['One next action', 'Available patches offer Install source. Installed patches offer Add to scene. Pending additions lead to source review.'],
    ['Show where you are', 'Separate In project, In scene, and Not run states. A pending-change summary keeps the final Run step visible.'],
  ], 'Search for “laser,” install it, add it to the scene, then review the source.'],
  controls: ['02 / CONTROLS', 'The whole control, visible.', 'Parameters lead the panel; hardware setup stays nearby without taking over.', [
    ['A label above the slider', 'Full names and exact values get their own row. The slider uses the width below.'],
    ['Readable connections', 'Source names and MIDI mappings sit underneath. A friendly display name can coexist with the code name.'],
    ['Setup when you need it', 'Device connection is collapsed below the controls. Creating a parameter opens a focused form.'],
  ], 'Adjust Checker speed, toggle Strobe, and try mapping a control to the demo MIDI device.'],
  audio: ['03 / AUDIO', 'Know what is feeding the scene.', 'Source choice, transport, and signal feedback are grouped in one place.', [
    ['File or live input', 'Changing the source reveals the controls relevant to that choice.'],
    ['Feedback beside the action', 'Playback state and signal status are visible together, so silence is easier to understand.'],
    ['Keep tuning secondary', 'Smoothing and auto-gain live under Analysis settings. They do not compete with playback.'],
  ], 'Play the demo state, scrub the track, then switch to Mic / line input. No audio is played or captured.'],
  performances: ['04 / PERFORMANCES', 'Save the moment. Find it again.', 'Recall slots and recovery share a home, with file management below.', [
    ['A name and a stable slot', 'Each saved performance has a clear identity, layer count, and dedicated recall action.'],
    ['Review before replacement', 'Recall shows what is about to replace the working window. The mockup demonstrates the transition.'],
    ['Recovery is distinct', 'Safe state is separate from saved performances. File actions and reset are in a secondary section.'],
  ], 'Save a new demo slot, recall Slow orbit, then restore the initial safe state.'],
  settings: ['05 / SETTINGS', 'A proper home for preferences.', 'Interface controls are separated from project files.', [
    ['Readable by default', 'Panel opacity begins at 100%. The tools remain legible over moving visuals.'],
    ['See the setting’s effect', 'A code sample lets you judge font size before returning to the editor.'],
    ['Keep defaults practical', 'The FPS warning threshold stays available without taking space in a live performance workflow.'],
  ], 'Change Code size and watch the sample update. Toggle Compact above the panel to compare widths.'],
  messages: ['06 / MESSAGES', 'Attention, not a wall of logs.', 'An issue count tells you when to look, without counting every successful action.', [
    ['Issues appear first', 'Warnings sit above routine evaluation history, with an explanation and a practical next step.'],
    ['Success stays readable', 'The activity list keeps scene acceptance and safe-state captures available for inspection.'],
    ['Meaningful badges', 'The footer badge represents one warning, not the total number of messages.'],
  ], 'Compare the warning at the top with the quieter successful actions below. These are sample messages.'],
  ai: ['07 / AI ASSISTANT', 'Start with the change you want.', 'The prompt leads. Connection configuration is secondary.', [
    ['Task first', 'Open the assistant to describe a change rather than encountering credentials first.'],
    ['Review stays explicit', 'Generated source changes stay staged until accepted and run in the editor.'],
    ['Configuration on demand', 'Model and key setup would live in a separate expandable section.'],
  ], 'Describe a change, then open the fixed example proposal. No AI service is called.'],
};

function feedback(message) { $('feedback').textContent = message; }
function showArea(area) {
  scrollPositions[currentArea] = $('panel-scroll').scrollTop;
  currentArea = area;
  all('[data-area]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.area === area)));
  all('.area').forEach((panel) => { panel.hidden = panel.id !== area; });
  $('panel-scroll').scrollTop = scrollPositions[area] ?? 0;
  const [number, title, intro, points, action] = notes[area];
  $('note-number').textContent = number;
  $('note-title').textContent = title;
  $('note-intro').textContent = intro;
  $('try-this').textContent = action;
  $('note-points').replaceChildren(...points.map(([heading, body]) => {
    const point = document.createElement('div'); point.className = 'note-point';
    const h = document.createElement('h3'); h.textContent = heading;
    const p = document.createElement('p'); p.textContent = body;
    point.append(h, p); return point;
  }));
}
all('[data-area]').forEach((button) => button.addEventListener('click', () => showArea(button.dataset.area)));
all('[data-width]').forEach((button) => button.addEventListener('click', () => {
  $('tools').classList.toggle('compact', button.dataset.width === 'compact');
  all('[data-width]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
}));

let confirmAction = null;
function openDialog({ title, description, content, confirm = 'Continue', action }) {
  $('dialog-title').textContent = title;
  $('dialog-description').textContent = description;
  $('dialog-content').replaceChildren();
  if (content) $('dialog-content').append(content);
  $('dialog-confirm').textContent = confirm;
  confirmAction = action;
  $('action-dialog').showModal();
  const field = $('dialog-content').querySelector('input');
  if (field) field.focus(); else $('dialog-confirm').focus();
}
$('dialog-cancel').addEventListener('click', () => $('action-dialog').close());
$('dialog-confirm').addEventListener('click', () => {
  if (confirmAction?.() !== false) $('action-dialog').close();
});
$('action-dialog').addEventListener('close', () => { confirmAction = null; });
function codeBlock(text) { const node = document.createElement('pre'); node.className = 'code-preview'; node.textContent = text; return node; }
function textField(label, placeholder, value = '') {
  const wrapper = document.createElement('label'); wrapper.className = 'dialog-field'; wrapper.textContent = label;
  const input = document.createElement('input'); input.className = 'dialog-input'; input.placeholder = placeholder; input.value = value; input.maxLength = 60;
  wrapper.append(input); return { wrapper, input };
}

function renderLibrary() {
  const search = $('library-search').value.trim().toLowerCase();
  const category = $('category').value;
  const visible = patches.filter((patch) => `${patch.name} ${patch.description} ${patch.category}`.toLowerCase().includes(search)
    && (category === 'all' || patch.category === category)
    && (scope === 'all' || (scope === 'installed' ? patch.state !== 'available' : patch.state === 'active')));
  $('count-installed').textContent = patches.filter((patch) => patch.state !== 'available').length;
  $('count-active').textContent = patches.filter((patch) => patch.state === 'active').length;
  $('library-count').textContent = `${visible.length} result${visible.length === 1 ? '' : 's'}`;
  $('library-empty').hidden = visible.length !== 0;
  $('patch-list').replaceChildren(...visible.map((patch) => {
    const row = document.createElement('article'); row.className = 'patch-card';
    const art = document.createElement('div'); art.className = `patch-art ${patch.category.toLowerCase()}`; art.textContent = patch.symbol; art.setAttribute('aria-hidden', 'true');
    const body = document.createElement('div');
    const title = document.createElement('div'); title.className = 'patch-title';
    const name = document.createElement('h3'); name.textContent = patch.name;
    const state = document.createElement('span'); state.className = `badge ${patch.state === 'active' ? 'live' : patch.state === 'pending' ? 'warning' : ''}`;
    state.textContent = { active: 'In scene', installed: 'In project', available: 'Available', pending: 'Not run' }[patch.state];
    title.append(name, state);
    const description = document.createElement('p'); description.className = 'patch-desc'; description.textContent = patch.description;
    const bottom = document.createElement('div'); bottom.className = 'patch-bottom';
    const category = document.createElement('span'); category.className = 'patch-type'; category.textContent = patch.category;
    const button = document.createElement('button'); button.className = `patch-action ${patch.state === 'available' ? 'primary' : 'secondary'}`;
    button.dataset.patchId = patch.id;
    button.textContent = { active: 'View source', installed: 'Add to scene', available: 'Install source', pending: 'Review scene' }[patch.state];
    button.setAttribute('aria-label', `${button.textContent}: ${patch.name}`);
    button.addEventListener('click', () => {
      if (patch.state === 'available') { patch.state = 'installed'; feedback(`${patch.name} source installed in the demo project.`); renderLibrary(); document.querySelector(`[data-patch-id="${patch.id}"]`)?.focus(); }
      else if (patch.state === 'installed') { patch.state = 'pending'; feedback(`${patch.name} added to scene source. Review before running.`); renderLibrary(); document.querySelector(`[data-patch-id="${patch.id}"]`)?.focus(); }
      else if (patch.state === 'pending') reviewScene();
      else openDialog({ title: `${patch.name} source`, description: 'In the app, this action would locate the patch in the editor.', content: codeBlock(`// %% patch ${patch.id}\n// Source stays editable in the working project.`), confirm: 'Back to library', action: () => feedback(`Previewed the source entry point for ${patch.name}.`) });
    });
    bottom.append(category, button); body.append(title, description, bottom); row.append(art, body); return row;
  }));
  const pending = patches.filter((patch) => patch.state === 'pending');
  $('pending-banner').hidden = pending.length === 0;
  $('pending-description').textContent = `${pending.length} addition${pending.length === 1 ? '' : 's'} not yet running.`;
}
function reviewScene() {
  const additions = patches.filter((patch) => patch.state === 'pending');
  const scene = performances[currentPerformance].scene;
  openDialog({ title: 'Review scene changes', description: `${additions.map((patch) => patch.name).join(', ')} will join the scene. This source view represents the handoff to the editor.`,
    content: codeBlock(`// Illustrative scene excerpt\nconst ${scene} = [\n  ...existingLayers,\n${additions.map((patch) => `  ${patch.id}, // added`).join('\n')}\n];\nactivate(${scene});`),
    confirm: 'Run demo scene', action: () => { additions.forEach((patch) => { patch.state = 'active'; }); renderLibrary(); feedback('Demo scene accepted. Added patches are now marked In scene.'); } });
}
$('review-scene').addEventListener('click', reviewScene);
$('library-search').addEventListener('input', renderLibrary);
$('category').addEventListener('change', renderLibrary);
all('[data-filter]').forEach((button) => button.addEventListener('click', () => { scope = button.dataset.filter; all('[data-filter]').forEach((item) => item.setAttribute('aria-pressed', String(item === button))); renderLibrary(); }));
$('clear-filters').addEventListener('click', () => { scope = 'all'; $('library-search').value = ''; $('category').value = 'all'; all('[data-filter]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.filter === scope))); renderLibrary(); });

for (const id of ['checker-speed', 'glow', 'smoothing']) $(id).addEventListener('input', () => { $(`${id}-value`).value = Number($(id).value).toFixed(2); });
$('strobe').addEventListener('click', () => { const enabled = $('strobe').getAttribute('aria-pressed') !== 'true'; $('strobe').setAttribute('aria-pressed', String(enabled)); $('strobe').querySelector('.toggle-word').textContent = enabled ? 'On' : 'Off'; feedback(`Demo strobe ${enabled ? 'on' : 'off'}.`); });
function connectMidi() { connected = true; $('midi-summary').textContent = '1 connected'; $('midi-description').textContent = 'Demo controller · 8 knobs, 8 faders'; $('connect-midi').textContent = 'Disconnect demo controller'; }
$('connect-midi').addEventListener('click', () => { if (!connected) { connectMidi(); feedback('Demo MIDI controller connected.'); } else { connected = false; $('midi-summary').textContent = 'Not connected'; $('midi-description').textContent = 'Your mappings will be available when the controller reconnects.'; $('connect-midi').textContent = 'Connect demo controller'; feedback('Demo MIDI controller disconnected.'); } });
function bindMap(button) {
  button.setAttribute('aria-label', `Map MIDI for ${button.dataset.map}`);
  button.addEventListener('click', () => openDialog({ title: `Map ${button.dataset.map}`, description: connected ? 'Move a knob or fader on your controller. For this mockup, assign an example knob below.' : 'The app would ask you to connect a MIDI controller first. This mockup uses a demo device.',
    content: codeBlock('Demo controller\nChannel 1 · CC 16 · Knob 1'), confirm: 'Assign demo knob', action: () => { connectMidi(); all('[data-map]').filter((item) => item.dataset.map !== button.dataset.map).forEach((item) => { item.textContent = 'Map MIDI'; item.setAttribute('aria-label', `Map MIDI for ${item.dataset.map}`); }); button.textContent = 'Knob 1 · CC 16'; button.setAttribute('aria-label', `Remap MIDI for ${button.dataset.map}: Knob 1, CC 16`); feedback(`Demo knob assigned to ${button.dataset.map}.`); } }));
}
all('[data-map]').forEach(bindMap);
$('new-control').addEventListener('click', () => {
  const field = textField('Parameter name', 'ringSpeed');
  field.input.pattern = '[A-Za-z_$][A-Za-z0-9_$]*'; field.input.required = true;
  openDialog({ title: 'Create a live control', description: 'This example creates a continuous control from 0 to 1, starting at 0.5. The full app would also expose type and range.', content: field.wrapper, confirm: 'Create demo control', action: () => {
    if (!field.input.reportValidity()) return false;
    const name = field.input.value;
    if (all('[data-map]').some((button) => button.dataset.map === name)) { field.input.setCustomValidity('Choose a different parameter name.'); field.input.reportValidity(); field.input.oninput = () => field.input.setCustomValidity(''); return false; }
    const id = `demo-control-${all('.control-card').length}`;
    const card = document.createElement('div'); card.className = 'control-card';
    const heading = document.createElement('div'); heading.className = 'control-heading';
    const label = document.createElement('label'); label.htmlFor = id; label.textContent = name;
    const output = document.createElement('output'); output.setAttribute('for', id); output.value = '0.50';
    const input = document.createElement('input'); input.id = id; input.type = 'range'; input.min = 0; input.max = 1; input.step = 0.01; input.value = 0.5; input.addEventListener('input', () => { output.value = Number(input.value).toFixed(2); });
    const meta = document.createElement('div'); meta.className = 'control-meta'; const code = document.createElement('code'); code.textContent = name;
    const map = document.createElement('button'); map.className = 'mapping-button'; map.dataset.map = name; map.textContent = 'Map MIDI'; bindMap(map);
    heading.append(label, output); meta.append(code, map); card.append(heading, input, meta); $('controls').querySelector('.area-heading').after(card); feedback(`Created ${name} in the mockup.`);
  } });
});

for (let i = 0; i < 50; i++) { const bar = document.createElement('i'); bar.style.height = `${10 + Math.abs(Math.sin(i * 1.8) * Math.cos(i * 0.31)) * 43}px`; $('waveform').append(bar); }
function setSignal() { const active = playing || audioSource === 'input'; $('signal-state').textContent = audioSource === 'input' ? 'Input ready · demo' : playing ? 'Playing · demo' : 'Paused'; $('signal-level').style.width = active ? '62%' : '4%'; }
all('[data-source]').forEach((button) => button.addEventListener('click', () => { audioSource = button.dataset.source; all('[data-source]').forEach((item) => item.setAttribute('aria-pressed', String(item === button))); $('file-source').hidden = audioSource !== 'file'; $('input-source').hidden = audioSource !== 'input'; setSignal(); }));
$('play-track').addEventListener('click', () => { playing = !playing; $('play-track').setAttribute('aria-pressed', String(playing)); $('play-track').textContent = playing ? 'Ⅱ Pause' : '▶ Play'; setSignal(); feedback(playing ? 'Demo playback state on. No sound is played.' : 'Demo playback paused.'); });
$('loop-track').addEventListener('click', () => { const loop = $('loop-track').getAttribute('aria-pressed') !== 'true'; $('loop-track').setAttribute('aria-pressed', String(loop)); $('loop-track').textContent = `Loop ${loop ? 'on' : 'off'}`; });
$('track-position').addEventListener('input', () => { const seconds = Number($('track-position').value); $('track-time').value = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; });
$('replace-track').addEventListener('click', () => openDialog({ title: 'Choose an audio file', description: 'The app would open your file picker here. This mockup swaps between two sample track names.', confirm: 'Use demo-loop.wav', action: () => { document.querySelector('.audio-file strong').textContent = 'demo-loop.wav'; feedback('Sample track name replaced. No file was opened.'); } }));

function renderPerformances() {
  $('performance-count').textContent = `${performances.length} saved`;
  $('scene-name').textContent = performances[currentPerformance].scene;
  $('performance-list').replaceChildren(...performances.map((performance, index) => {
    const row = document.createElement('div'); row.className = 'performance-row';
    const slot = document.createElement('span'); slot.className = 'slot'; slot.textContent = String(index + 1).padStart(2, '0');
    const body = document.createElement('div'); const name = document.createElement('h3'); name.textContent = performance.name;
    const meta = document.createElement('p'); meta.textContent = `${performance.layers} layers · ${performance.saved}`; body.append(name, meta);
    let action;
    if (currentPerformance === index) { action = document.createElement('span'); action.className = 'badge live'; action.textContent = 'Current'; }
    else { action = document.createElement('button'); action.className = 'secondary small'; action.textContent = 'Recall'; action.setAttribute('aria-label', `Recall ${performance.name}`); action.addEventListener('click', () => openDialog({ title: `Recall ${performance.name}?`, description: `This would replace the working window with slot ${index + 1}: ${performance.layers} layers and its saved source.`, confirm: 'Recall demo slot', action: () => { currentPerformance = index; renderPerformances(); feedback(`${performance.name} recalled in the mockup.`); } })); }
    row.append(slot, body, action); return row;
  }));
}
$('save-performance').addEventListener('submit', (event) => { event.preventDefault(); const name = $('performance-name').value.trim(); if (!name) { $('performance-name').setCustomValidity('Enter a performance name.'); $('performance-name').reportValidity(); return; } performances.push({ ...performances[currentPerformance], name, saved: 'Just now' }); currentPerformance = performances.length - 1; $('performance-name').value = ''; renderPerformances(); feedback(`Saved ${name} to demo slot ${performances.length}.`); });
$('performance-name').addEventListener('input', () => $('performance-name').setCustomValidity(''));
$('set-safe').addEventListener('click', () => { safePerformance = currentPerformance; $('safe-note').textContent = `${performances[safePerformance].scene} · captured just now`; feedback('Demo safe state captured.'); });
$('restore-safe').addEventListener('click', () => { currentPerformance = safePerformance; renderPerformances(); feedback(`Restored ${performances[safePerformance].name} in the mockup.`); });
$('export-demo').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([JSON.stringify({ mockup: true, performances }, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'tools-mockup-performances.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); feedback('Exported sample performance data.'); });
$('import-demo').addEventListener('click', () => openDialog({ title: 'Import a project', description: 'The real app would let you choose a project file and review its contents. This example shows a merge without opening a file.', content: codeBlock('Demo project\n1 performance to add\nExisting slots stay in place'), confirm: 'Merge example slot', action: () => { performances.push({ name: 'Imported demo', scene: 'importedDemo', layers: 3, saved: 'Imported just now' }); renderPerformances(); feedback('Example slot merged into mockup data.'); } }));
$('reset-demo').addEventListener('click', () => openDialog({ title: 'Reset this mockup?', description: 'This resets the sample interactions on this page. Your live project will not be affected.', confirm: 'Reset mockup', action: () => { location.reload(); } }));

$('panel-opacity').addEventListener('input', () => { $('panel-opacity-value').value = `${$('panel-opacity').value}%`; $('tools').style.setProperty('--panel-fill', `rgba(24,29,34,${Number($('panel-opacity').value) / 100})`); });
$('code-size').addEventListener('input', () => { $('code-size-value').value = `${$('code-size').value}px`; $('code-preview').style.fontSize = `${$('code-size').value}px`; });
$('fps-warning').addEventListener('change', () => { if ($('fps-warning').reportValidity()) feedback(`Demo warning threshold set to ${$('fps-warning').value} FPS.`); });
$('ai-proposal').addEventListener('click', () => { $('ai-result').hidden = false; feedback('Fixed example proposal shown. No AI service was called.'); });
renderLibrary(); renderPerformances(); showArea('library');
