// p5js live — wiring.
//
// This is the only file that touches p5's globals directly, and the only file that
// assigns window.setup and window.draw. The host owns those functions, and evaluated
// patch code never redefines them. Everything authored live arrives through the
// evaluator instead.
//
// The draw loop below is short on purpose: it makes what stays alive during an edit
// easy for contributors to inspect.

import { createDiagnostics } from './host/diagnostics.js';
import { createRegistry } from './host/registry.js';
import { createStateStore } from './host/stateStore.js';
import { createEvaluator } from './host/evaluator.js';
import { createHostLoop } from './host/hostLoop.js';
import { createAudioEngine } from './audio/audioEngine.js';
import { createPerformanceLauncher } from './performance/launcher.js';
import { createPush3DisplayTransport } from './performance/push3DisplayTransport.js';
import { createPush3MidiTransport } from './performance/push3MidiTransport.js';
import { createPush3TempoLink, describeTempo } from './performance/push3Tempo.js';
import { createPush3Adapter } from './performance/push3Adapter.js';
import { createEffectsBoard } from './performance/effectsBoard.js';
import { createPush3AutoConnect } from './performance/push3AutoConnect.js';
import { createPerformanceLibrary } from './persistence/performanceLibrary.js';
import { createRecentAudio } from './persistence/recentAudio.js';
import { captureSquare, thumbnailFromFile } from './performance/thumbnail.js';
import { createGlobalBindings, createModulationEngine } from './performance/modulations.js';
import { createModulationsPanel } from './ui/modulationsPanel.js';
import { createPerformanceSurface } from './ui/performanceLauncher.js';
import { controllerDemoPerformances } from '../starter/controller-demos.js';
import { LIVE_API_NAMES } from './host/liveApi.js';
import { createControlManager } from './control/controlManager.js';
import { createEditor } from './ui/editor.js';
import { createCodeViewFactory } from './visuals/codeView.js';
import { setDrawerHidden } from './ui/drawers.js';
import { createPanels } from './ui/panels.js';
import { createProjection } from './ui/projection.js';
import { createConfirmDialog } from './ui/confirmDialog.js';
import { createAIAssistant } from './ui/aiAssistant.js';
import { createAISettings } from './ai/settings.js';
import { createProjectStore } from './persistence/projectStore.js';
import {
  createPatchStore,
  parsePatchSource,
  patchFromShareHash,
  patchShareHash,
  portablePatchSource,
} from './persistence/patchStore.js';
import {
  createPerformanceStore,
  performanceShortcutIndex,
} from './persistence/performanceStore.js';
import { createAppController } from './app/controller.js';
import { evaluateStartupProject } from './app/startupRecovery.js';
import { getDefaultNetworkManager } from './network/networkManager.js';
import { STARTER_SOURCE } from '../starter/starter.js';
import { ASCII_PLASMA_SOURCE } from '../starter/ascii-plasma.js';
import {
  LIBRARY,
  RAVE_PATCH_NAMES,
  libraryDemoSource,
} from '../starter/library.js';
import { COMMUNITY_PATCHES } from './generated/communityPatches.js';
import { findCells } from './language/sourceBlocks.js';

const STARTER_PATCHES = [STARTER_SOURCE, ASCII_PLASMA_SOURCE].flatMap((source) => findCells(source).flatMap((cell) => {
  const match = /^patch\s+([A-Za-z_$][\w$]*)$/.exec(cell.label);
  if (!match) return [];
  return [{
    name: match[1],
    title: match[1],
    blurb: source === STARTER_SOURCE ? 'Included in the starter project.' : 'From the original ASCII + Plasma example.',
    source: cell.text.trimEnd(),
    origin: 'system',
    category: match[1] === 'plasma' ? 'shader' : 'visual',
  }];
}));

const BUILT_IN_PATCH_LIBRARY = [
  ...STARTER_PATCHES,
  ...LIBRARY.map((entry) => ({
    ...entry,
    title: entry.title ?? entry.name,
    origin: 'system',
  })),
  ...COMMUNITY_PATCHES,
];
const patchStore = createPatchStore();
const PATCH_LIBRARY = [...BUILT_IN_PATCH_LIBRARY, ...patchStore.list()]
  .sort((a, b) => a.title.localeCompare(b.title));

const diagnostics = createDiagnostics();
const registry = createRegistry();
const stateStore = createStateStore({ diagnostics });
const evaluator = createEvaluator({
  registry, stateStore, diagnostics,
  codeView: createCodeViewFactory({ readView: options => editor.codeViewSnapshot(options) }),
});
const audio = createAudioEngine({ diagnostics });
const network = getDefaultNetworkManager();
const controlManager = createControlManager({ registry, diagnostics });
const push3Display = createPush3DisplayTransport({ diagnostics });
const push3Leds = createPush3MidiTransport({ diagnostics });
let push3Tempo = null; // created once the rhythm manager and panels exist
let push3Adapter = null;
let modulationsPanel = null;
let performanceSurface = null;

// Read-only keyboard state, handed to strategies as one of the draw inputs.
const keyboard = { keys: new Set(), shift: false, alt: false };

/**
 * p5 drawing isolation for one strategy invocation.
 *
 * push()/pop() already save and restore p5's style and transform stack. The reset in
 * between exists for a subtler reason: without it, an object inherits whatever the
 * *host* last set, so reordering a scene could silently change how it looks.
 * These are the defaults documented in docs/API.md.
 */
const drawing = {
  groups: new Map(),
  push: () => push(),
  pop: () => pop(),
  resetDefaults() {
    colorMode(RGB, 255);
    blendMode(BLEND);
    rectMode(CORNER);
    ellipseMode(CENTER);
    imageMode(CORNER);
    angleMode(RADIANS);
    fill(255);
    stroke(255);
    strokeWeight(1);
    strokeCap(ROUND);
    strokeJoin(MITER);
    textAlign(LEFT, BASELINE);
    textSize(12);
  },
  syncGroups(activeIds) {
    const active = new Set(activeIds);
    for (const [id, graphics] of this.groups) {
      if (active.has(id)) continue;
      graphics.remove();
      this.groups.delete(id);
    }
  },
  beginGroup(id) {
    const pInst = stageCanvas?._pInst;
    if (!pInst) return null;
    let graphics = this.groups.get(id);
    if (!graphics || graphics.width !== width || graphics.height !== height) {
      graphics?.remove();
      graphics = createGraphics(width, height);
      graphics.pixelDensity(1);
      this.groups.set(id, graphics);
    }
    graphics.clear();
    const parentRenderer = pInst._renderer;
    pInst._renderer = graphics._renderer;
    return {
      id,
      graphics,
      pInst,
      parentRenderer,
    };
  },
  groupCanvas: (scope) => scope.graphics,
  endGroup(scope, { composite = true } = {}) {
    scope.pInst._renderer = scope.parentRenderer;
    if (!composite) return;
    push();
    this.resetDefaults();
    noTint();
    image(scope.graphics, 0, 0, width, height);
    pop();
  },
};

let showCodeError = () => {};
const host = createHostLoop({
  registry,
  stateStore,
  evaluator,
  diagnostics,
  drawing,
  keyboard,
  onCodeError: (name, error) => showCodeError(name, error),
});
const controller = createAppController({
  registry,
  stateStore,
  diagnostics,
  evaluator,
  audio,
  host,
  network,
  controlManager,
});
const rhythm = host.rhythm;
audio.connectRhythm(rhythm);
const modulations = createModulationEngine({ registry });
registry.setModulator((name, base) => modulations.modulate(name, base));
host.setModulationSource(target => modulations.readSignals(target));
// Bare names in patch code: `lfo1` reads the live signal (0 while stopped or undefined).
const modulationGlobals = createGlobalBindings({ reserved: LIVE_API_NAMES, read: name => modulations.signal(name) ?? 0 });
modulations.subscribe(() => {
  const { skipped } = modulationGlobals.sync(modulations.list().map(m => m.name));
  if (skipped.length) diagnostics.warn(`Modulation name${skipped.length === 1 ? '' : 's'} already taken: ${skipped.join(', ')}`, 'Rename it in Tools → Modulations to use it as a bare name in code.');
});
const projectStore = createProjectStore({ registry, diagnostics, controlManager, rhythm, modulations });
const performanceStore = createPerformanceStore({ diagnostics });
const performanceLibrary = createPerformanceLibrary({ diagnostics });
const recentAudio = createRecentAudio();
let thumbnailRequest = null; // resolved inside the draw loop so WebGL frames are captured intact
const projection = createProjection({
  controller,
  onBlocked: () =>
    diagnostics.warn(
      'Projection window was blocked',
      'Allow pop-ups for this page, or use Fullscreen instead.',
    ),
  onOpened: () =>
    diagnostics.success('Projection window open', 'Tab cycles layout; Esc closes it.'),
});
const dialog = createConfirmDialog();

// --- editor + panels ------------------------------------------------------------

const stage = document.getElementById('stage');
const app = document.getElementById('app');
const codeLayer = document.getElementById('code-layer');
const foldButton = document.getElementById('fold-code');
let stageCanvas = null;
let startupSourceToConfirm = null;
let offerFirstEdit = false;

const editor = createEditor(document.getElementById('code'), {
  lastRunSource: () => evaluator.lastRunSource(),
  runningSceneUsingPatch: (name) => registry.activeInstancesOf(name).length
    ? registry.activeSceneName()
    : null,
  onEvaluate: (source, label) => {
    const result = evaluator.evaluate(source, { label });
    // The projection's code layout shows the block that was actually accepted,
    // never a failed candidate — the audience should not be shown a broken edit.
    if (result.ok) projection.setActiveCode(source);
    return result;
  },
  onChange: (source) => {
    projectStore.saveSoon(source);
    controller.sourceChanged();
  },
  onEscape: () => stage.focus(),
  // Paints the text and the box behind each line; see src/ui/styles.css.
  mirror: document.getElementById('code-mirror'),
  lineNumbers: document.getElementById('line-numbers'),
  foldControls: document.getElementById('fold-controls'),
  foldedView: document.getElementById('folded-blocks'),
  currentCellBar: document.getElementById('current-cell-bar'),
  onFoldChange: (folded) => {
    foldButton.classList.toggle('is-on', folded);
    const label = folded
      ? 'Open complete editor; fold controls remain in the gutter'
      : 'Return to structured code folds';
    foldButton.title = label;
    foldButton.setAttribute('aria-label', label);
  },
});
showCodeError = (name, error) => {
  editor.flashCodeError(name);
  editor.evaluationError(name, error);
};
controller.setSourceProvider(() => editor.value);
controller.subscribe((snapshot) => editor.updateRuntime(snapshot));

foldButton.addEventListener('click', () => editor.toggleFolded());
editor.setFolded(true);

// Parameter and safety-setting changes also need to save, not only typing.
registry.subscribe(() => projectStore.saveSoon(editor.value));
// Keep the Controls tab's sliders following values changed elsewhere (Push encoders,
// the controller dialog, learned MIDI), coalesced to one update per frame.
let controlsRenderQueued = false;
registry.subscribe(() => {
  if (controlsRenderQueued) return;
  controlsRenderQueued = true;
  requestAnimationFrame(() => { controlsRenderQueued = false; panels.renderControls(); });
});

document.getElementById('clear-messages').addEventListener('click', () => diagnostics.clear());

const panels = createPanels({
  controller,
  onRevert: ({ name, source }) => {
    editor.replaceBlockFor(name, source);
    projection.setActiveCode(source);
  },
  library: PATCH_LIBRARY,
  onInsertLibrary: installFromLibrary,
  onAddToScene: addPatchToScene,
  onAddNetworkStream: addNetworkStream,
  onRestoreSafe: restoreSafeState,
  onCreateParam: createLiveParam,
  onLocateStrategy: (name) => {
    if (matchMedia('(max-width: 600px)').matches) toggleTools(true);
    if (editor.revealBinding(name)) toggleReference(true);
  },
  onLocateScene: (name) => {
    if (matchMedia('(max-width: 600px)').matches) toggleTools(true);
    editor.revealScene(name);
  },
  onMoveSceneEntry: (name, index, direction) => {
    // Recheck at dispatch: a source edit may have invalidated a displayed row.
    if (!controller.snapshot().scene.canReorder) return;
    if (editor.moveSceneEntry(name, index, direction)) {
      diagnostics.info('Scene order edited', 'Review the scene and Run to apply it. The live composition is unchanged.');
    }
  },
});

function createLiveParam(spec) {
  const { name } = spec;
  if (!/^[A-Za-z_$][\w$]*$/.test(name) || ['__proto__', 'prototype', 'constructor'].includes(name)) {
    return { ok: false, error: 'Use a JavaScript-style name such as ringSpeed.' };
  }
  if (registry.listParams().some((entry) => entry.name === name)) {
    return { ok: false, error: `A live control named “${name}” already exists.` };
  }

  let declaration;
  if (spec.type === 'button') {
    const mode = spec.mode === 'toggle' ? 'toggle' : 'momentary';
    declaration = `control(${JSON.stringify(name)}, ${Boolean(spec.value)}, { type: "button", mode: "${mode}" });`;
  } else if (spec.type === 'choice') {
    const choices = [...new Set((spec.choices ?? []).map((choice) => String(choice).trim()).filter(Boolean))];
    if (choices.length < 2) return { ok: false, error: 'Enter at least two different choices.' };
    const value = String(spec.value ?? '').trim();
    if (!choices.includes(value)) return { ok: false, error: 'Initial choice must appear in the choices list.' };
    declaration = `control(${JSON.stringify(name)}, ${JSON.stringify(value)}, { type: "choice", choices: ${JSON.stringify(choices)} });`;
  } else {
    const { value, min, max, step } = spec;
    if (![value, min, max, step].every(Number.isFinite)) {
      return { ok: false, error: 'Initial, minimum, maximum, and step must be numbers.' };
    }
    if (!(max > min)) return { ok: false, error: 'Maximum must be greater than minimum.' };
    if (!(step > 0)) return { ok: false, error: 'Step must be greater than zero.' };
    if (value < min || value > max) {
      return { ok: false, error: 'Initial value must be between minimum and maximum.' };
    }
    declaration = `control(${JSON.stringify(name)}, ${value}, { type: "continuous", min: ${min}, max: ${max}, step: ${step} });`;
  }

  editor.insertControlDeclaration(declaration);
  const result = evaluator.evaluate(declaration, { label: `control ${name}` });
  if (!result.ok) return { ok: false, error: result.error?.message ?? 'Evaluation failed.' };
  projection.setActiveCode(declaration);
  diagnostics.success(
    `Live control created — ${name}`,
    `The declaration was added to // %% controls. Use controls.${name} in a patch, or choose Learn MIDI here.`,
  );
  return { ok: true, declaration };
}

const aiAssistant = createAIAssistant({
  editor,
  settings: createAISettings(),
  library: PATCH_LIBRARY,
  onConfigure: () => {
    toggleTools(false);
    panels.selectToolView('ai');
    document.getElementById('ai-connection').open = true;
    document.getElementById('panels').scrollTop = 0;
    document.getElementById('ai-api-key').focus({ preventScroll: true });
  },
  onOpen: () => { if (matchMedia('(max-width: 600px)').matches) toggleTools(true); },
});

// --- portable patch sharing ----------------------------------------------------

function refreshSharedPatch(patch) {
  if (BUILT_IN_PATCH_LIBRARY.some((entry) => entry.name === patch.name)) {
    return { ok: false, error: `“${patch.name}” already belongs to the built-in library. Rename the shared patch first.` };
  }
  const saved = patchStore.save(patch);
  if (!saved.ok) return saved;
  const previous = PATCH_LIBRARY.findIndex(
    (entry) => entry.origin === 'shared' && entry.name === saved.patch.name,
  );
  if (previous === -1) PATCH_LIBRARY.push(saved.patch);
  else PATCH_LIBRARY.splice(previous, 1, saved.patch);
  PATCH_LIBRARY.sort((a, b) => a.title.localeCompare(b.title));
  panels.renderAll();
  return saved;
}

function patchUnderCursor() {
  const current = editor.currentPatchSource();
  if (!current) {
    diagnostics.warn('Put the cursor inside a patch first', 'Scenes and loose statements are not patch files.');
    return null;
  }
  const portable = portablePatchSource(current.source);
  if (!portable.ok) {
    diagnostics.error(`Could not share ${current.name}`, portable.error);
    return null;
  }
  return portable.patch;
}

function downloadPatch(patch) {
  const blob = new Blob([`${patch.source}\n`], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${patch.name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}.p5patch.js`;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return link.download;
}

document.getElementById('export-patch').addEventListener('click', () => {
  const patch = patchUnderCursor();
  if (!patch) return;
  diagnostics.success(`Exported ${downloadPatch(patch)}`, 'Only this patch source was included.');
});

document.getElementById('share-patch-link').addEventListener('click', async () => {
  const patch = patchUnderCursor();
  if (!patch) return;
  const url = `${location.href.split('#')[0]}${patchShareHash(patch)}`;
  try {
    await navigator.clipboard.writeText(url);
    diagnostics.success(`Copied share link for ${patch.title}`, `${url.length.toLocaleString()} characters · opening it adds the patch as Available without running it.`);
  } catch (error) {
    diagnostics.error('Could not copy the patch link', error.message);
  }
});

document.getElementById('import-patch').addEventListener('click', () => {
  document.getElementById('import-patch-file').click();
});

async function confirmSharedPatch(parsed, label) {
  if (!parsed?.ok) {
    diagnostics.error(`Could not import ${label}`, parsed?.error ?? 'Unreadable patch');
    return false;
  }
  const existing = PATCH_LIBRARY.find((entry) => entry.name === parsed.patch.name);
  const confirmed = await dialog.ask({
    title: `${existing ? 'Update' : 'Import'} “${parsed.patch.title}”?`,
    body: existing
      ? `A patch named ${parsed.patch.name} is already available. This replaces that shared library entry but does not edit or evaluate the installed project source.`
      : 'This adds one patch to Shared patches as Available. It will not install, activate, or run it.',
    preview: parsed.patch.source.slice(0, 1200),
    warning: 'Inspect shared source before installing and evaluating it. p5js live does not sandbox patch code.',
    confirmLabel: existing ? 'Update shared patch' : 'Add as available',
  });
  if (!confirmed) return false;
  const result = refreshSharedPatch(parsed.patch);
  if (!result.ok) {
    diagnostics.error(`Could not import ${parsed.patch.title}`, result.error);
    return false;
  }
  diagnostics.success(
    `${parsed.patch.title} added to Shared patches`,
    'Status: Available. Choose Install source when you want it in this project.',
  );
  return true;
}

document.getElementById('import-patch-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  await confirmSharedPatch(parsePatchSource(await file.text()), file.name);
});

const linkedPatch = patchFromShareHash(location.hash);
if (linkedPatch) {
  confirmSharedPatch(linkedPatch, 'shared patch link');
}

function networkIdentifier(label) {
  const words = label
    .replace(/[^A-Za-z0-9_$]+/g, ' ')
    .trim()
    .split(/\s+/);
  let base = words
    .map((word, index) => index ? `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}` : word)
    .join('') || 'remoteStream';
  if (!/^[A-Za-z_$]/.test(base)) base = `stream${base}`;
  let name = base;
  let suffix = 2;
  while (new RegExp(`\\b(?:const|let|var|class|function)\\s+${name}\\b`).test(editor.value)) {
    name = `${base}${suffix++}`;
  }
  return name;
}

function receiverCellsFor(stream) {
  const literal = JSON.stringify(stream).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const streamProperty = new RegExp(`\\bstream\\s*:\\s*${literal}`);
  return findCells(editor.value).flatMap((cell) => {
    const patch = /^patch\s+([A-Za-z_$][\w$]*)$/.exec(cell.label);
    return patch && streamProperty.test(cell.text)
      ? [{ name: patch[1], source: cell.text.trimEnd() }]
      : [];
  });
}

function addNetworkStream({ room, performer, stream }) {
  let receivers = receiverCellsFor(stream);
  let name = receivers[0]?.name;

  // Repeated clicks should activate the receiver already in the project, not create
  // ericMainOutput2, ericMainOutput3, and another peer reference every time.
  if (!name) {
    name = networkIdentifier(stream.replace('/', ' '));
    const roomName = `${name}Room`;
    editor.insertPatchSource(`// %% patch ${name}
const ${roomName} = new StreamRoom({
  name: ${JSON.stringify(room)},
  performer: ${JSON.stringify(performer)},
});

const ${name} = ${roomName}.receive({
  stream: ${JSON.stringify(stream)},
  fit: "cover",
});`);
    receivers = receiverCellsFor(stream);
  }

  const sceneName = registry.activeSceneName() ?? 'scene';
  let sceneCell = findCells(editor.value).find((cell) => cell.label === `scene ${sceneName}`);
  const activeLine = new RegExp(`^[ \\t]*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*,?`, 'm');
  if (!sceneCell || !activeLine.test(sceneCell.text)) {
    const order = controller.snapshot().scene.sourceOrder;
    const inserted = editor.addStrategyToScene(sceneName, name, order);
    if (!inserted.ok) {
      diagnostics.error(
        `Could not add ${stream} to ${sceneName}`,
        'The receiver source is still in the project and can be added to the scene by hand.',
      );
      return inserted;
    }
    sceneCell = findCells(editor.value).find((cell) => cell.label === `scene ${sceneName}`);
  }

  // A network control is operational UI rather than a source-only library browser.
  // Evaluate the receiver definition and updated scene together so one click really
  // does add the remote canvas. Existing duplicate cells are included so projects
  // created by the earlier insert-only behavior recover without undefined names.
  receivers = receiverCellsFor(stream);
  const source = [...receivers.map((receiver) => receiver.source), sceneCell?.text]
    .filter(Boolean)
    .join('\n\n');
  const result = evaluator.evaluate(source, { label: `receiver ${stream}` });
  if (result.ok) {
    projection.setActiveCode(sceneCell?.text ?? source);
    diagnostics.success(
      `${stream} receiver added and activated`,
      receivers.length > 1
        ? `Reused the existing source. This project contains ${receivers.length} copies; keep one when you next tidy the code.`
        : 'The incoming canvas will appear when the peer connection becomes live.',
    );
  }
  return result;
}

// --- p5 lifecycle ---------------------------------------------------------------

window.setup = function setup() {
  const stage = document.getElementById('stage');
  stageCanvas = createCanvas(stage.clientWidth, stage.clientHeight);
  stageCanvas.parent(stage);

  // p5 2 appends createGraphics() canvases beside the visible sketch canvas.
  // They are render targets, not additional stage elements, so keep them usable
  // by WebGL/image() while detaching them from the document. p5 2 exposes its
  // global helpers as read-only properties, hence the DOM observer instead of a
  // createGraphics wrapper.
  const visibleCanvas = stageCanvas.elt;
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLCanvasElement && node !== visibleCanvas) node.remove();
      }
    }
  }).observe(stage, { childList: true });
  // One device pixel per canvas pixel. The reference budget is 60 FPS at 1280x720,
  // and a retina backing store quadruples the fill cost.
  pixelDensity(1);
  frameRate(60);
  background(8, 8, 12);

  audio.init();

  const saved = projectStore.load();
  try { offerFirstEdit = !saved && localStorage.getItem('p5js-live.firstEditDismissed') !== 'true'; } catch { offerFirstEdit = !saved; }
  const source = saved?.source ?? STARTER_SOURCE;
  editor.value = source;
  // The starter/saved project goes through the ordinary atomic evaluation path. If
  // one saved cell is broken on reload, recover its other independent cells and keep
  // a small visible scene running instead of accepting an empty registry.
  const startup = evaluateStartupProject({
    source,
    label: saved ? 'saved project' : 'starter',
    starterSource: STARTER_SOURCE,
    evaluator,
    registry,
    stateStore,
    host,
  });
  startupSourceToConfirm = startup.ok && !startup.recovered ? source : null;
  if (startup.recovered) {
    diagnostics.warn(
      'Saved project recovered with errors',
      `${startup.failedBlocks.length} block${startup.failedBlocks.length === 1 ? '' : 's'} could not be evaluated. ` +
        'Their source is still in the editor. Installed source remains visible in the library; open the failed cell, fix it, and press Cmd/Ctrl+Enter.',
    );
  }
  projectStore.restoreSettings(saved, { modulations: true });
  // Panic needs somewhere to go from the first minute, not only after the performer
  // has deliberately designated a safe scene.
  if (registry.safeSceneName() === null) registry.setSafeScene();

  diagnostics.info(
    saved ? 'Restored your saved project' : 'Starter project loaded',
    'Cmd/Ctrl+Enter evaluates the cell or statement under your cursor.',
  );
};

window.draw = function draw() {
  const snapshot = audio.readFrame(); // once per frame, shared by every strategy
  // Modulations use last frame's clock (one frame of lag) so the swing is ready before
  // patches read their controls inside beginFrame.
  modulations.frame(rhythm.snapshot());
  const drawInputs = host.beginFrame(snapshot, stageCanvas);
  panels.renderBeat(drawInputs.clock);
  push3Tempo?.frame(drawInputs.clock);
  push3Adapter?.frame(drawInputs.clock);
  performanceSurface?.frame();
  modulationsPanel?.frame();

  // The live coder configures the scene as an ordered array of strategy values.
  // Each function or object exposes the current drawing behavior.
  host.drawScene(drawInputs);
  if (thumbnailRequest) { const capture = thumbnailRequest; thumbnailRequest = null; capture(); }

  host.commitPendingChanges();
  if (editor.hasPendingEvaluation()) editor.evaluationFrame(controller.snapshot());
  // The first confirmed starter/saved scene becomes a complete recovery point.
  // Later edits never overwrite it; only the explicit Set safe action does.
  if (!controller.safeStateStatus().exists && controller.ensureSafeState().ok && startupSourceToConfirm) {
    // A failed startup draw must not make the corresponding source look applied.
    if (!registry.listStrategies().some((record) => record.lastError)) editor.rememberAppliedSource(startupSourceToConfirm);
    startupSourceToConfirm = null;
  }
  controller.setAudioSnapshot(snapshot);
  launcher.tick(drawInputs.clock);

  // The audience's copy of this frame. No-op unless the projection window is open.
  projection.render(drawingContext.canvas);
};

window.windowResized = function windowResized() {
  const stage = document.getElementById('stage');
  // Resizing changes the canvas, never the registrations or their state.
  resizeCanvas(stage.clientWidth, stage.clientHeight);
};

// --- transport ------------------------------------------------------------------

const overlay = document.getElementById('start-overlay');
function openFirstEdit() {
  editor.revealStrategy('myPatch');
}
function finishEntry() {
  overlay.hidden = true;
  if (!offerFirstEdit) return;
  offerFirstEdit = false;
  document.getElementById('first-edit-hint').hidden = false;
}
document.getElementById('first-edit-open').addEventListener('click', openFirstEdit);
document.getElementById('first-edit-dismiss').addEventListener('click', () => {
  document.getElementById('first-edit-hint').hidden = true;
  try { localStorage.setItem('p5js-live.firstEditDismissed', 'true'); } catch { /* optional */ }
  stage.focus();
});
const welcomeFileButton = document.getElementById('file-label');
const welcomeFileInput = document.getElementById('audio-file');
const welcomeLoadState = document.getElementById('start-load-state');
const welcomeLoadLabel = document.getElementById('start-load-label');
const welcomeLoadProgress = document.getElementById('start-load-progress');
const welcomeNote = document.getElementById('start-note');
const loadAudioButton = document.getElementById('load-audio');
const WELCOME_LOAD_DELAY_MS = 250;
const WELCOME_NOTE = welcomeNote.textContent.trim();
let welcomeLoadTimer = null;
let welcomeLoadVisible = false;

function cancelWelcomeLoadTimer() {
  if (welcomeLoadTimer !== null) clearTimeout(welcomeLoadTimer);
  welcomeLoadTimer = null;
}

function resetWelcomeLoadStatus() {
  cancelWelcomeLoadTimer();
  welcomeLoadVisible = false;
  welcomeLoadState.hidden = true;
}

function renderAudioLoadStatus(status) {
  loadAudioButton.classList.toggle('is-loading', status.loading);
  loadAudioButton.setAttribute('aria-busy', String(status.loading));

  if (status.loading) {
    welcomeNote.classList.remove('is-error');
    welcomeNote.textContent = WELCOME_NOTE;
    welcomeLoadLabel.textContent =
      status.loadPhase === 'decoding'
        ? `Decoding ${status.source}…`
        : Number.isFinite(status.loadProgress)
          ? `Loading ${status.source} — ${Math.round(status.loadProgress * 100)}%`
          : `Loading ${status.source}…`;
    if (status.loadPhase === 'loading' && Number.isFinite(status.loadProgress)) {
      welcomeLoadProgress.value = status.loadProgress;
    } else {
      welcomeLoadProgress.removeAttribute('value');
    }
    if (!overlay.hidden && !welcomeLoadVisible && welcomeLoadTimer === null) {
      // Fast local files should open directly instead of flashing a progress row.
      // Slow files still get feedback, in a reserved slot that cannot resize the card.
      welcomeLoadTimer = setTimeout(() => {
        welcomeLoadTimer = null;
        if (overlay.hidden || !loadAudioButton.classList.contains('is-loading')) return;
        welcomeLoadVisible = true;
        welcomeLoadState.hidden = false;
      }, WELCOME_LOAD_DELAY_MS);
    }
    return;
  }

  cancelWelcomeLoadTimer();
  if (status.error && !overlay.hidden) {
    resetWelcomeLoadStatus();
    welcomeNote.textContent = `${status.error}. Choose another audio file or start silent.`;
    welcomeNote.classList.add('is-error');
  } else if (!welcomeLoadVisible) {
    welcomeLoadState.hidden = true;
  }
}

async function startAudio() {
  try {
    const state = await audio.start();
    finishEntry();
    resetWelcomeLoadStatus();
    diagnostics.success(`Audio context ${state}`);
  } catch (error) {
    // An audio failure is a message, not a stopped draw loop.
    finishEntry();
    resetWelcomeLoadStatus();
    diagnostics.error('Could not start audio', `${error.message} — running on silence.`);
  }
}

async function chooseFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  return loadAudioFile(file);
}

/** Load one audio File as the source: from the pickers, a drop, or the recent list. */
async function loadAudioFile(file, handle = null) {
  try {
    // Chrome must be unlocked by the file input's trusted change event. Waiting for
    // asynchronous decoding before doing this can leave the audio graph suspended.
    await audio.unlock();
  } catch (error) {
    diagnostics.error('Could not start audio', `${error.message} — running on silence.`);
    return;
  }
  try {
    await audio.loadFile(file, { onProgress: renderAudioLoadStatus });
    recentAudio.remember(file, handle);
    renderWelcomeRecent();
    await startAudio();
  } catch (error) {
    if (error?.name === 'AbortError') return;
    // loadFile already reported the decode failure. Keep the picker open so the
    // performer can choose another source.
  }
}

const AUDIO_PICKER_TYPES = [{ description: 'Audio', accept: { 'audio/*': ['.mp3', '.wav', '.ogg', '.m4a', '.aac'] } }];

/** Choose an audio file. With the File System Access API the handle is remembered so a
 * recent row can reopen the file without a picker; otherwise fall back to the input. */
async function pickAudioFile(fallbackInput) {
  if (typeof window.showOpenFilePicker !== 'function') { fallbackInput.click(); return; }
  let handle;
  try { [handle] = await window.showOpenFilePicker({ types: AUDIO_PICKER_TYPES, multiple: false }); }
  catch (error) { if (error?.name !== 'AbortError') fallbackInput.click(); return; }
  try {
    await loadAudioFile(await handle.getFile(), handle);
  } catch (error) {
    diagnostics.error('Could not open that file', error?.message ?? String(error));
  }
}

function welcomeError(text) {
  welcomeNote.textContent = text;
  welcomeNote.classList.add('is-error');
}

/** Reopen a recent file from its stored handle. A missing or moved file is reported in
 * the start dialog and dropped from the list. */
async function openRecentAudio(name) {
  const handle = await recentAudio.handleFor(name);
  if (!handle) {
    welcomeNote.textContent = `Pick ${name} in the file dialog.`;
    welcomeNote.classList.remove('is-error');
    await pickAudioFile(welcomeFileInput);
    return false;
  }
  try {
    let permission = await handle.queryPermission?.({ mode: 'read' });
    if (permission !== 'granted') permission = await handle.requestPermission?.({ mode: 'read' });
    if (permission !== 'granted') { welcomeError(`Access to ${name} was not allowed. Choose it with Audio file instead.`); return false; }
    const file = await handle.getFile();
    await loadAudioFile(file, handle);
    return true;
  } catch (error) {
    const gone = error?.name === 'NotFoundError' || error?.name === 'NotAllowedError';
    recentAudio.forget(name);
    renderWelcomeRecent();
    welcomeError(gone
      ? `${name} is no longer where it was — it has been removed from Recent. Choose it again with Audio file.`
      : `${name} could not be opened (${error?.message ?? error}). Removed from Recent.`);
    return false;
  }
}

async function enterWithSilence() {
  try {
    const state = await audio.unlock();
    audio.useSilence();
    finishEntry();
    resetWelcomeLoadStatus();
    diagnostics.success(`Audio context ${state}`, 'Running on silence.');
  } catch (error) {
    audio.useSilence();
    finishEntry();
    resetWelcomeLoadStatus();
    diagnostics.error('Could not start audio', `${error.message} — running on silence.`);
  }
}

for (const id of ['audio-file', 'audio-file-2']) {
  document.getElementById(id).addEventListener('change', (event) => chooseFile(event.target));
}
welcomeFileButton.addEventListener('click', () => { void pickAudioFile(welcomeFileInput); });
document.getElementById('load-audio').addEventListener('click', () => {
  document.getElementById('audio-file-2').click();
});
document.getElementById('tools-load-audio').addEventListener('click', () => { void pickAudioFile(document.getElementById('audio-file-2')); });
document.getElementById('start-audio').addEventListener('click', enterWithSilence);
requestAnimationFrame(() => welcomeFileButton.focus({ preventScroll: true }));
async function toggleAudio() {
  try {
    await audio.toggle();
  } catch (error) {
    diagnostics.error('Could not resume audio', error.message);
  }
}

document.getElementById('play-toggle').addEventListener('click', toggleAudio);
document.getElementById('tools-play-toggle').addEventListener('click', toggleAudio);

function setLoop(value) {
  const looping = audio.setLoop(value);
  for (const id of ['loop-toggle', 'loop-performance-toggle']) {
    const button = document.getElementById(id);
    button.classList.toggle('is-on', looping);
    button.setAttribute('aria-pressed', String(looping));
  }
  return looping;
}

function toggleLoop() {
  const looping = setLoop(!audio.status().looping);
  diagnostics.info(`Loop ${looping ? 'on' : 'off'}`);
}
document.getElementById('loop-toggle').addEventListener('click', toggleLoop);
document.getElementById('loop-performance-toggle').addEventListener('click', toggleLoop);

// --- live input ------------------------------------------------------------------

const deviceSelect = document.getElementById('input-device');

async function startMicrophone(deviceId) {
  const ok = await audio.useMicrophone(deviceId);
  if (!ok) return false;
  finishEntry();
  resetWelcomeLoadStatus();
  // Device labels are empty until permission has been granted once, so the picker is
  // only worth populating after a successful start.
  const inputs = await audio.listInputs();
  deviceSelect.replaceChildren(
    new Option('(default input)', ''),
    ...inputs.map((d) => new Option(d.label, d.deviceId)),
  );
  if (deviceId) deviceSelect.value = deviceId;
  return true;
}

document.getElementById('use-mic').addEventListener('click', () => startMicrophone());
document.getElementById('tools-use-mic').addEventListener('click', () => startMicrophone());
document.getElementById('start-mic').addEventListener('click', () => startMicrophone());
deviceSelect.addEventListener('change', (event) => {
  startMicrophone(event.target.value);
});

// --- analysis controls -----------------------------------------------------------

const smoothingInput = document.getElementById('smoothing');
const smoothingValue = document.getElementById('smoothing-value');
smoothingInput.addEventListener('input', () => {
  const value = Number(smoothingInput.value);
  audio.configure({ smoothing: value });
  smoothingValue.textContent = value.toFixed(2);
});
document.getElementById('auto-gain').addEventListener('change', (event) => {
  audio.configure({ autoGain: event.target.checked });
  diagnostics.info(`Auto-gain ${event.target.checked ? 'on' : 'off'}`);
});

// --- projection, fullscreen, safe scene, panic -----------------------------------

const layoutSelect = document.getElementById('projection-layout');

function toggleProjection() {
  if (projection.isOpen()) {
    projection.close();
  } else {
    projection.open();
    projection.setLayout(layoutSelect.value);
  }
}
layoutSelect.addEventListener('change', () => projection.setLayout(layoutSelect.value));

async function toggleFullscreen() {
  // Fullscreen the complete performer surface, not only the canvas. The code layer,
  // runtime status, glyphs, and optional tools are siblings of #stage inside #app.
  // Targeting #stage alone makes the browser correctly hide all of those siblings.
  if (document.fullscreenElement) await document.exitFullscreen();
  else await app.requestFullscreen().catch((error) => diagnostics.warn('Fullscreen refused', error.message));
}
document.getElementById('fullscreen-toggle').addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => {
  document.getElementById('fullscreen-toggle').classList.toggle('is-on', !!document.fullscreenElement);
  // Wait a frame so the stage has been laid out at its new size before measuring it.
  requestAnimationFrame(() => resizeCanvas(stage.clientWidth, stage.clientHeight));
});

// --- tools overlay ---------------------------------------------------------------

const side = document.getElementById('side');
const referenceSide = document.getElementById('reference-side');

const OPACITY_KEY = 'p5js-live.toolsAlpha';

/**
 * How see-through the tools are.
 *
 * A live control rather than a fixed value, because the right amount depends on what
 * is playing: over a dark set you want it low to see anything behind the panel at
 * all, over a bright one you want it high to read the code. Persisted on its own key
 * — it is a property of this machine and this room, not of the project, so it should
 * not travel in an export.
 */
function setToolsOpacity(alpha) {
  const value = Math.min(1, Math.max(0.15, Number(alpha) || 1));
  document.documentElement.style.setProperty('--tools-alpha', value.toFixed(2));
  const output = document.getElementById('tools-opacity-value');
  if (output) output.textContent = `${Math.round(value * 100)}%`;
  try {
    localStorage.setItem(OPACITY_KEY, String(value));
  } catch {
    /* a private-mode browser is not a reason to stop */
  }
  return value;
}

const opacityInput = document.getElementById('tools-opacity');
opacityInput.addEventListener('input', () => setToolsOpacity(opacityInput.value));
{
  let saved = null;
  try {
    saved = localStorage.getItem(OPACITY_KEY);
  } catch {
    /* ignore */
  }
  opacityInput.value = setToolsOpacity(saved ?? opacityInput.value);
}

const CODE_FONT_SIZE_KEY = 'p5js-live.codeFontSize';
const codeSizeInput = document.getElementById('code-size');

function setCodeFontSize(size) {
  const value = Math.min(24, Math.max(12, Math.round(Number(size) || 15)));
  const lineHeight = Math.round(value * (22 / 15));
  const root = document.documentElement.style;
  root.setProperty('--code-font-size', `${value}px`);
  root.setProperty('--code-line-height', `${lineHeight}px`);
  root.setProperty('--code-gutter-font-size', `${Math.max(10, Math.round(value * 0.8))}px`);
  codeSizeInput.value = String(value);
  document.getElementById('code-size-value').textContent = `${value}px`;
  projection.setCodeFontSize(value);
  editor.refreshLayout();
  try {
    localStorage.setItem(CODE_FONT_SIZE_KEY, String(value));
  } catch {
    /* private-mode storage is optional */
  }
  return value;
}

codeSizeInput.addEventListener('input', () => setCodeFontSize(codeSizeInput.value));
{
  let saved = null;
  try {
    saved = localStorage.getItem(CODE_FONT_SIZE_KEY);
  } catch {
    /* ignore */
  }
  setCodeFontSize(saved ?? codeSizeInput.value);
}

function toggleTools(force) {
  const hidden = force ?? !side.classList.contains('is-hidden');
  setDrawerHidden(side, document.getElementById('tools-toggle'), hidden);
  if (!hidden) {
    setDrawerHidden(referenceSide, document.getElementById('reference-toggle'), true);
    if (matchMedia('(max-width: 600px)').matches) side.querySelector('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
  }
  // The canvas already fills the window, so nothing needs resizing — the panel is
  // over the top of it, not beside it. That is the point of the overlay.
  return hidden;
}
// Start with the stage and source visible. Tools preserves its last selected
// workspace and stays available from the toolbar and keyboard shortcut.
toggleTools(true);

document.getElementById('tools-toggle').addEventListener('click', () => toggleTools());
document.getElementById('tools-close').addEventListener('click', () => toggleTools(true));
const toolsWidthButton = document.getElementById('tools-width');
function setToolsCompact(compact) {
  document.documentElement.style.setProperty('--tools-width', compact ? '360px' : '480px');
  toolsWidthButton.setAttribute('aria-pressed', String(compact));
  toolsWidthButton.setAttribute('aria-label', compact ? 'Use wide Tools panel' : 'Use compact Tools panel');
  try { localStorage.setItem('p5js-live.toolsCompact', String(compact)); } catch { /* optional */ }
}
try { setToolsCompact(localStorage.getItem('p5js-live.toolsCompact') === 'true'); } catch { /* default wide */ }
toolsWidthButton.addEventListener('click', () => setToolsCompact(toolsWidthButton.getAttribute('aria-pressed') !== 'true'));
side.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab' || !matchMedia('(max-width: 600px)').matches) return;
  const focusable = [...side.querySelectorAll('button, input, select, textarea, summary, a[href]')]
    .filter((node) => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length);
  const first = focusable[0], last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
});

function toggleReference(force) {
  const hidden = force ?? !referenceSide.classList.contains('is-hidden');
  setDrawerHidden(referenceSide, document.getElementById('reference-toggle'), hidden);
  if (!hidden) {
    setDrawerHidden(side, document.getElementById('tools-toggle'), true);
  }
  return hidden;
}
toggleReference(true);

document.getElementById('reference-toggle').addEventListener('click', () => toggleReference());
document.getElementById('reference-close').addEventListener('click', () => toggleReference(true));

/**
 * Hide the code itself (`e`).
 *
 * Distinct from hiding the tools: mid-set you want to look at the composition with
 * nothing on it at all, and the code is the largest thing on it. Hiding it does not
 * pause anything — the strategies keep running exactly as they are.
 */
function toggleCode(force) {
  const hidden = force ?? !codeLayer.classList.contains('is-hidden');
  codeLayer.classList.toggle('is-hidden', hidden);
  return hidden;
}

function toggleNavigation() {
  const navigation = document.getElementById('icons');
  const hidden = !navigation.hidden;
  if (hidden && navigation.contains(document.activeElement)) document.activeElement.blur();
  navigation.hidden = hidden;
  navigation.inert = hidden;
  navigation.setAttribute('aria-hidden', String(hidden));
}

/** Temporarily lower the canvas brightness without touching the running scene. */
const visualDimmer = document.getElementById('visual-dimmer');
function toggleVisualDimmer(force) {
  const show = force ?? visualDimmer.hidden;
  visualDimmer.hidden = !show;
  return show;
}
for (const drawer of [side, referenceSide]) {
  drawer.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    // Let a native select dismiss its own popup before closing the drawer.
    if (event.target.tagName === 'SELECT') return;
    event.preventDefault();
    event.stopPropagation();
    if (drawer === side) toggleTools(true);
    else toggleReference(true);
  });
}

// --- key command help (?) --------------------------------------------------------

const keysOverlay = document.getElementById('keys-overlay');
function toggleKeys(force) {
  keysOverlay.hidden = force ?? !keysOverlay.hidden;
}
document.getElementById('keys-close').addEventListener('click', () => toggleKeys(true));
document.getElementById('keys-open').addEventListener('click', () => toggleKeys());
keysOverlay.addEventListener('click', (event) => {
  if (event.target === keysOverlay) toggleKeys(true);
});

const fpsThresholdInput = document.getElementById('fps-threshold');
fpsThresholdInput.addEventListener('change', () => {
  const value = Number(fpsThresholdInput.value);
  if (!Number.isFinite(value) || value <= 0) return;
  host.setFpsThreshold(value);
  diagnostics.info(`Frame rate warning set to ${value} FPS`);
});

// --- robot easter egg ----------------------------------------------------------

const robotEasterEgg = document.getElementById('robot-easter-egg');
const robotEasterEggVideo = document.getElementById('robot-easter-egg-video');

function toggleRobotEasterEgg(force) {
  const show = force ?? robotEasterEgg.hidden;
  robotEasterEgg.hidden = !show;
  robotEasterEgg.setAttribute('aria-hidden', String(!show));
  if (!show) {
    robotEasterEggVideo.pause();
    robotEasterEggVideo.currentTime = 0;
    return false;
  }

  robotEasterEggVideo.muted = true;
  robotEasterEggVideo.currentTime = 0;
  const playing = robotEasterEggVideo.play();
  playing?.catch((error) => {
    diagnostics.warn('Robot video is waiting for playback permission', error.message);
  });
  return true;
}

// --- named performance recall ---------------------------------------------------

const performanceNameInput = document.getElementById('performance-name');
const performanceList = document.getElementById('performance-list');
let performanceRecallSequence = 0;

const PREVIOUS_EDITS_KEY = 'p5js-live.previous-launch-edits.v1';
const launcher = createPerformanceLauncher({
  store: performanceStore, registry, launch: launchPerformance,
  clock: () => rhythm.snapshot(), tap: () => panels.tapTempo(), safe: () => restoreSafeState(),
  warn: message => diagnostics.warn('Performance controller', message),
});
controlManager.setMessageRouter(message => launcher.receive(message));
controlManager.setDisconnectHandler(() => launcher.disconnect());
const effectsBoard = createEffectsBoard({ registry });
push3Tempo = createPush3TempoLink({ leds: push3Leds, rhythm, tap: () => panels.tapTempo() });
push3Adapter = createPush3Adapter({
  launcher, leds: push3Leds, store: performanceStore, registry, effects: effectsBoard, diagnostics, modulations,
  transport: { toggle: () => toggleAudio(), status: () => audio.status(), setVolume: level => audio.setVolume(level) },
  library: { list: () => performanceLibrary.list(), currentId: () => performanceLibrary.currentId(), load: id => loadPerformance(id) },
  onBrowse: () => renderLibrary(),
});
push3Leds.onInput(event => { if (!push3Tempo.handleInput(event.decoded)) push3Adapter.handleInput(event.decoded); });
performanceSurface = createPerformanceSurface({
  root: document.getElementById('performance-launcher'), launcher, store: performanceStore,
  registry, controlManager,
  push3Display,
  push3Leds,
  effects: effectsBoard,
  tempo: () => describeTempo(rhythm.snapshot(), rhythm.settings()),
  transport: () => audio.status(),
  browser: () => push3Adapter?.browseState() ?? null,
  volume: () => push3Adapter?.volumeOverlay() ?? null,
  performanceName: () => performanceLibrary.current()?.name ?? null,
  modulations,
  addDemos() {
    for (const demo of controllerDemoPerformances()) {
      if (!performanceStore.get(demo.id)) {
        const result = performanceStore.merge([{ ...demo, createdAt: Date.now(), updatedAt: Date.now() }]);
        if (!result.ok) diagnostics.warn('Could not save controller demo', result.reason);
      }
    }
    renderPerformances();
    diagnostics.info('Controller demos added', 'Select an Orbits or Tiles pad, then turn its eight controls.');
  },
  recover() {
    try {
      const previous = JSON.parse(localStorage.getItem(PREVIOUS_EDITS_KEY));
      if (typeof previous?.source !== 'string') { diagnostics.info('No previous launch edits saved'); return; }
      editor.value = previous.source;
      controller.sourceChanged(); projectStore.saveSoon(editor.value, 0);
      diagnostics.info('Previous edits restored to the editor', 'The current visuals keep running. Run when ready.');
    } catch (error) { diagnostics.warn('Could not recover previous edits', error.message); }
  },
});
modulationsPanel = createModulationsPanel({
  root: document.getElementById('modulation-list'),
  addButton: document.getElementById('add-modulation'),
  engine: modulations, registry, diagnostics,
});

// Bring the Push up silently when Chrome already remembers it (display + MIDI). The
// chooser is still needed once per origin; after that, reloads just work.
const push3Auto = createPush3AutoConnect({
  display: push3Display, leds: push3Leds, diagnostics,
  showController: () => performanceSurface.showController(),
});
setTimeout(() => { void push3Auto.start(); }, 0);

async function launchPerformance(performance) {
  // Syntax preparation does not execute user code or replace the current runtime.
  try { new Function(...LIVE_API_NAMES, performance.source); }
  catch (error) { return { ok: false, error }; }
  const checkpoint = controller.checkpoint();
  try { localStorage.setItem(PREVIOUS_EDITS_KEY, JSON.stringify({ source: editor.value, at: Date.now() })); }
  catch (error) { diagnostics.warn('Could not save previous edits', error.message); }
  const sequence = ++performanceRecallSequence;
  const folded = editor.isFolded();
  evaluator.discardPending(); evaluator.clearBindings();
  host.reset(); registry.reset(); stateStore.clear();
  editor.value = performance.source; editor.setFolded(folded);
  let result;
  try {
    result = evaluator.evaluate(performance.source, { label: `launch ${performance.name}` });
    if (!result.ok) throw result.error ?? new Error('Evaluation failed');
    evaluator.applyPending();
    // A launch changes the instrument, not the ongoing host session.
    for (const param of performance.params ?? []) {
      if (registry.listParams().some(entry => entry.name === param.name)) registry.setParam(param.name, param.value);
    }
    projection.setActiveCode(performance.source);
    controller.sourceChanged(); projectStore.saveSoon(performance.source, 0);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (sequence !== performanceRecallSequence) return { ok: false, reason: 'Launch superseded' };
    const failed = registry.listStrategies().find(record => record.lastError || record.status === 'error');
    if (failed) throw new Error(`${failed.name} failed on its first rendered frame`);
    diagnostics.success(`Scene launched — ${performance.name}`, 'Audio, clock, MIDI mappings and view preserved.');
    return { ok: true };
  } catch (error) {
    if (sequence === performanceRecallSequence) {
      restoreBeforePerformance(checkpoint, performance, error.message);
      editor.setFolded(folded);
    }
    return { ok: false, error };
  }
}

function performanceSnapshot(name) {
  return {
    name,
    source: editor.value,
    sceneName: registry.activeSceneName(),
    safeScene: registry.safeSceneName(),
    params: registry.listParams().map(({ name: paramName, value, min, max, step }) => ({
      name: paramName,
      value,
      min,
      max,
      step,
    })),
    controls: controlManager.snapshotMappings(),
    rhythm: rhythm.settings(),
    audio: {
      analysis: audio.featureOptions(),
      loop: audio.status().looping,
    },
    view: {
      folded: editor.isFolded(),
      codeHidden: codeLayer.classList.contains('is-hidden'),
      projectionLayout: layoutSelect.value,
      fpsThreshold: Number(fpsThresholdInput.value),
      toolsOpacity: Number(opacityInput.value),
      codeFontSize: Number(codeSizeInput.value),
    },
  };
}

function renderPerformances() {
  launcher.sync();
  const performances = performanceStore.list();
  performanceList.replaceChildren();
  if (performances.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'performance-empty';
    empty.textContent = 'No saved scenes yet.';
    performanceList.append(empty);
    return;
  }

  const active = launcher.snapshot().active;
  for (const [index, performance] of performances.entries()) {
    const row = document.createElement('div');
    row.className = 'performance-row scene-row';
    row.dataset.performanceId = performance.id;
    row.classList.toggle('is-current', performance.id === active);
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    row.setAttribute('aria-label', `Switch to ${performance.name}`);
    row.setAttribute('aria-pressed', String(performance.id === active));

    const copy = document.createElement('div');
    copy.className = 'performance-copy';
    const title = document.createElement('div');
    title.className = 'performance-title';
    title.textContent = `${index + 1}. ${performance.name}`;
    if (index < 9) {
      title.title = `Recall with Cmd/Ctrl+Option/Alt+${index + 1}`;
    }
    const meta = document.createElement('div');
    meta.className = 'performance-meta';
    const saved = new Date(performance.updatedAt).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    meta.textContent = `${performance.sceneName ?? 'no active scene'} · ${saved}`;
    copy.append(title, meta);

    const actions = document.createElement('div');
    actions.className = 'performance-actions';
    for (const [action, label] of [
      ['recall', 'Recall'],
      ['update', 'Update'],
      ['delete', 'Delete'],
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.performanceAction = action;
      button.textContent = label;
      button.title = action === 'recall'
        ? `Recall ${performance.name}`
        : action === 'update'
          ? `Replace ${performance.name} with the current window`
          : `Delete ${performance.name}`;
      if (action === 'delete') button.className = 'danger';
      actions.append(button);
    }
    row.append(copy, actions);
    performanceList.append(row);
  }
}

function applyPerformanceSettings(performance) {
  projectStore.restoreSettings(performance);

  const analysis = audio.configure(performance.audio?.analysis ?? {});
  smoothingInput.value = analysis.smoothing;
  smoothingValue.textContent = Number(analysis.smoothing).toFixed(2);
  document.getElementById('auto-gain').checked = Boolean(analysis.autoGain);

  setLoop(Boolean(performance.audio?.loop));

  const view = performance.view ?? {};
  if (typeof view.folded === 'boolean') editor.setFolded(view.folded);
  if (typeof view.codeHidden === 'boolean') toggleCode(view.codeHidden);
  if ([...layoutSelect.options].some((option) => option.value === view.projectionLayout)) {
    layoutSelect.value = view.projectionLayout;
    projection.setLayout(view.projectionLayout);
  }
  if (Number.isFinite(view.fpsThreshold) && view.fpsThreshold > 0) {
    fpsThresholdInput.value = view.fpsThreshold;
    host.setFpsThreshold(view.fpsThreshold);
  }
  if (Number.isFinite(view.toolsOpacity)) {
    opacityInput.value = view.toolsOpacity;
    setToolsOpacity(view.toolsOpacity);
  }
  if (Number.isFinite(view.codeFontSize)) setCodeFontSize(view.codeFontSize);
}

function restoreBeforePerformance(checkpoint, performance, detail) {
  const restored = controller.restoreCheckpoint(checkpoint);
  if (restored.ok) {
    editor.value = restored.source;
    projection.setActiveCode(restored.source);
    projectStore.saveSoon(restored.source, 0);
    controller.sourceChanged();
  }
  diagnostics.error(
    `Could not recall ${performance.name} — previous scene restored`,
    detail,
  );
}

function recallPerformance(performance) {
  launcher.reset();
  const checkpoint = controller.checkpoint();
  const sequence = ++performanceRecallSequence;
  const performanceSource = performance.source;

  evaluator.discardPending();
  evaluator.clearBindings();
  host.reset();
  registry.reset();
  stateStore.clear();
  controlManager.restoreMappings([]);
  editor.value = performanceSource;
  const result = evaluator.evaluate(performanceSource, { label: `performance ${performance.name}` });
  if (!result.ok) {
    restoreBeforePerformance(checkpoint, performance, result.error?.message ?? result.phase);
    return result;
  }
  evaluator.applyPending();
  applyPerformanceSettings(performance);
  launcher.setActive(performance.id);
  projection.setActiveCode(performanceSource);
  projectStore.saveSoon(performanceSource, 0);
  controller.sourceChanged();
  diagnostics.success(
    `Scene recalled — ${performance.name}`,
    `${performance.sceneName ?? 'No named scene'} · source, parameters, audio analysis and view restored.`,
  );

  // First-frame patch failures happen after evaluation. Give the host two frames to
  // confirm every active candidate, then put the exact preceding runtime back if one
  // rolled back or failed. A newer recall supersedes this check.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (sequence !== performanceRecallSequence) return;
    const failed = registry.activeInstances().find(
      (instance) => registry.getStrategy(instance.strategy)?.status !== 'ok',
    );
    if (failed) {
      restoreBeforePerformance(
        checkpoint,
        performance,
        `${failed.strategy} failed on its first rendered frame.`,
      );
    }
  }));
  return result;
}

function recallPerformanceSlot(index) {
  const performance = performanceStore.list()[index];
  if (!performance) {
    diagnostics.warn(
      `No saved scene in slot ${index + 1}`,
      'Slots follow the numbered order shown under Tools → Performance.',
    );
    return null;
  }
  return recallPerformance(performance);
}

function quickSavePerformance() {
  const now = new Date();
  const name = `Quick ${now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })}`;
  const result = performanceStore.save(performanceSnapshot(name));
  if (!result.ok) {
    diagnostics.error('Could not quick-save scene', result.reason);
    return result;
  }
  const slot = performanceStore.list().findIndex(
    (performance) => performance.id === result.performance.id,
  ) + 1;
  renderPerformances();
  diagnostics.success(
    `Quick-saved scene to slot ${slot}`,
    slot <= 9
      ? `${name} · recall with Cmd/Ctrl+Option/Alt+${slot}`
      : `${name} · recall it from Tools → Performance`,
  );
  return { ...result, slot };
}

document.getElementById('save-performance-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = performanceNameInput.value.trim();
  if (!name) {
    diagnostics.warn('Name the scene before saving it');
    performanceNameInput.focus();
    return;
  }
  const result = performanceStore.save(performanceSnapshot(name));
  if (!result.ok) {
    diagnostics.error('Could not save scene', result.reason);
    return;
  }
  performanceNameInput.value = '';
  renderPerformances();
  diagnostics.success(`Scene saved — ${name}`);
});

// Clicking a scene row (anywhere but its buttons) switches to it, like pressing its pad.
performanceList.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const row = event.target.closest('.scene-row');
  if (!row || event.target !== row) return;
  event.preventDefault();
  const performance = performanceStore.get(row.dataset.performanceId);
  if (performance) recallPerformance(performance);
});
performanceList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-performance-action]');
  const row = event.target.closest('[data-performance-id]');
  if (row && !button) {
    const performance = performanceStore.get(row.dataset.performanceId);
    if (performance && performance.id !== launcher.snapshot().active) recallPerformance(performance);
    return;
  }
  if (!button || !row) return;
  const performance = performanceStore.get(row.dataset.performanceId);
  if (!performance) {
    renderPerformances();
    return;
  }
  if (button.dataset.performanceAction === 'recall') {
    recallPerformance(performance);
  } else if (button.dataset.performanceAction === 'update') {
    const result = performanceStore.save(performanceSnapshot(performance.name), {
      id: performance.id,
    });
    if (result.ok) diagnostics.success(`Scene updated — ${performance.name}`);
    else diagnostics.error(`Could not update ${performance.name}`, result.reason);
    renderPerformances();
  } else if (button.dataset.performanceAction === 'delete') {
    const confirmed = await dialog.ask({
      title: `Delete “${performance.name}”?`,
      body: 'This removes the saved scene. It does not change what is currently running.',
      warning: 'There is no undo, though exported performance files are unaffected.',
      confirmLabel: 'Delete scene',
    });
    if (confirmed && performanceStore.remove(performance.id)) {
      diagnostics.info(`Scene deleted — ${performance.name}`);
      renderPerformances();
    }
  }
});

renderPerformances();

// --- performance library: save, load, autosave, thumbnails -------------------------

const libraryList = document.getElementById('library-list');
const libraryNameInput = document.getElementById('library-name');
const libraryCurrentName = document.getElementById('library-current-name');
const libraryCurrentThumb = document.getElementById('library-current-thumb');
const EMPTY_LAUNCHER = () => ({ version: 1, slots: [], known: [], assignments: [], routes: [] });

/** The whole performance as a portable bundle — the same shape as an exported file. */
function performanceAudioSettings() {
  const status = audio.status();
  return { analysis: audio.featureOptions(), loop: status.looping, volume: status.volume };
}

function applyAudioSettings(settings) {
  if (!settings) return;
  const analysis = audio.configure(settings.analysis ?? {});
  smoothingInput.value = analysis.smoothing;
  smoothingValue.textContent = Number(analysis.smoothing).toFixed(2);
  document.getElementById('auto-gain').checked = Boolean(analysis.autoGain);
  setLoop(Boolean(settings.loop));
  if (Number.isFinite(settings.volume)) audio.setVolume(settings.volume);
}

function performanceFileExtras() {
  const current = performanceLibrary.current();
  return {
    performances: performanceStore.list(),
    launcher: launcher.export(),
    audio: performanceAudioSettings(),
    ...(current ? { name: current.name, thumbnail: current.thumbnail ?? undefined } : {}),
  };
}

function capturePerformanceData() {
  const json = projectStore.exportProject(editor.value, performanceFileExtras());
  const parsed = projectStore.parseProject(json);
  return parsed.ok ? parsed.data : null;
}

/** Square crop of the stage, taken inside the next draw so WebGL content is intact. */
function captureThumbnail() {
  return new Promise((resolve) => {
    thumbnailRequest = () => {
      try { resolve(captureSquare(document.querySelector('#stage canvas'))); }
      catch (error) { diagnostics.warn('Could not capture a thumbnail', error.message); resolve(null); }
    };
  });
}

async function savePerformanceAs(name) {
  const data = capturePerformanceData();
  if (!data) { diagnostics.error('Could not save performance', 'The working source could not be packaged.'); return null; }
  const current = performanceLibrary.current();
  const thumbnail = await captureThumbnail();
  if (current && current.name === name.trim()) {
    const updated = performanceLibrary.update(current.id, { data, thumbnail });
    if (updated.ok) diagnostics.success(`Performance updated — ${current.name}`);
    else diagnostics.error('Could not update performance', updated.reason);
    renderLibrary();
    return updated.ok ? current.id : null;
  }
  const result = performanceLibrary.save({ name, data, thumbnail });
  if (!result.ok) {
    diagnostics.error('Could not save performance', result.reason === 'missing-name' ? 'Give it a name first.' : result.reason);
    return null;
  }
  performanceLibrary.setCurrent(result.performance.id);
  diagnostics.success(`Performance saved — ${result.performance.name}`, `${result.performance.sceneCount} scene${result.performance.sceneCount === 1 ? '' : 's'}, layout, controls and settings. It now updates itself as you work.`);
  renderLibrary();
  return result.performance.id;
}

// Autosave: whenever the working project would persist, the named performance does too.
let libraryAutosaveTimer = null;
function autosavePerformanceSoon(delay = 1500) {
  if (!performanceLibrary.currentId()) return;
  clearTimeout(libraryAutosaveTimer);
  libraryAutosaveTimer = setTimeout(() => {
    const id = performanceLibrary.currentId();
    const data = id && capturePerformanceData();
    if (data) { performanceLibrary.update(id, { data }); renderLibrary(); }
  }, delay);
}
{
  const persistWorking = projectStore.saveSoon;
  projectStore.saveSoon = (...args) => { persistWorking(...args); autosavePerformanceSoon(); };
}
launcher.subscribe(() => autosavePerformanceSoon());
{
  let lastActive = null;
  launcher.subscribe(() => { const active = launcher.snapshot().active; if (active !== lastActive) { lastActive = active; renderPerformances(); } });
}

async function loadPerformance(id) {
  const entry = performanceLibrary.get(id);
  if (!entry) { diagnostics.warn('That performance is no longer in the library'); return { ok: false, reason: 'missing' }; }
  if (entry.id === performanceLibrary.currentId()) { diagnostics.info(`${entry.name} is already the current performance`); return { ok: true, current: true }; }
  const data = entry.data;
  evaluator.discardPending();
  evaluator.clearBindings();
  host.reset();
  registry.reset();
  stateStore.clear();
  controlManager.restoreMappings([]);
  launcher.reset();
  performanceRecallSequence++;
  editor.value = data.source;
  const result = evaluator.evaluate(data.source, { label: `performance ${entry.name}` });
  evaluator.applyPending();
  if (!result.ok) {
    diagnostics.error(`Could not run ${entry.name}`, result.error?.message);
    return { ok: false, reason: 'evaluation' };
  }
  projectStore.restoreSettings(data, { modulations: true });
  applyAudioSettings(data.audio);
  const scenes = performanceStore.replace(data.performances ?? []);
  launcher.import(data.launcher ?? EMPTY_LAUNCHER());
  performanceLibrary.setCurrent(entry.id);
  renderPerformances();
  renderLibrary();
  projection.setActiveCode(data.source);
  projectStore.saveSoon(data.source, 0);
  diagnostics.success(`Performance loaded — ${entry.name}`, scenes.ok ? `${scenes.count} scene${scenes.count === 1 ? '' : 's'}, layout, controls and settings restored.` : 'Source restored; its scenes could not be read.');
  return { ok: true };
}

async function deletePerformance(id) {
  const entry = performanceLibrary.get(id);
  if (!entry) return;
  const count = entry.data.performances?.length ?? 0;
  const confirmed = await dialog.ask({
    title: `Delete “${entry.name}”?`,
    body: `This removes the saved performance and its ${count} scene${count === 1 ? '' : 's'} from this browser. What is running now is not changed.`,
    warning: 'There is no undo, though exported performance files are unaffected.',
    confirmLabel: 'Delete performance',
  });
  if (!confirmed) return;
  performanceLibrary.remove(id);
  diagnostics.info(`Performance deleted — ${entry.name}`);
  renderLibrary();
}

function exportPerformanceEntry(id) {
  const entry = performanceLibrary.get(id);
  if (!entry) return null;
  const text = projectStore.serializeBundle(entry.data, { name: entry.name, ...(entry.thumbnail ? { thumbnail: entry.thumbnail } : {}) });
  const filename = projectStore.downloadText(text, `p5js-live-performance-${projectStore.slug(entry.name)}-${new Date().toISOString().slice(0, 10)}.json`);
  diagnostics.success(`Exported ${filename}`, `${entry.data.performances?.length ?? 0} scene${(entry.data.performances?.length ?? 0) === 1 ? '' : 's'}, layout, controls and settings. Audio files remain separate.`);
  return filename;
}

function exportAllPerformances() {
  const entries = performanceLibrary.list().map(summary => performanceLibrary.get(summary.id)).filter(Boolean);
  if (!entries.length) { diagnostics.warn('Nothing to export yet', 'Save a performance first.'); return null; }
  const filename = projectStore.downloadText(projectStore.exportLibrary(entries), `p5js-live-performances-${new Date().toISOString().slice(0, 10)}.json`);
  diagnostics.success(`Exported ${filename}`, `${entries.length} performance${entries.length === 1 ? '' : 's'} in one library file.`);
  return filename;
}

async function updateThumbnailFromStage() {
  const id = performanceLibrary.currentId();
  if (!id) return;
  const thumbnail = await captureThumbnail();
  if (thumbnail) { performanceLibrary.update(id, { thumbnail }); renderLibrary(); diagnostics.success('Thumbnail updated from the stage'); }
}

async function updateThumbnailFromFile(file) {
  const id = performanceLibrary.currentId();
  if (!id || !file) return;
  try {
    const thumbnail = await thumbnailFromFile(file);
    if (thumbnail) { performanceLibrary.update(id, { thumbnail }); renderLibrary(); diagnostics.success(`Thumbnail set from ${file.name}`); }
  } catch (error) {
    diagnostics.error('Could not read that image', error.message);
  }
}

function renderLibrary() {
  const entries = performanceLibrary.list();
  const current = performanceLibrary.current();
  const browsing = push3Adapter?.browseState() ?? null;
  libraryCurrentName.textContent = current?.name ?? 'Untitled';
  libraryCurrentThumb.hidden = !current?.thumbnail;
  if (current?.thumbnail) libraryCurrentThumb.src = current.thumbnail;
  document.getElementById('library-snapshot').disabled = !current;
  document.getElementById('library-upload').disabled = !current;
  document.getElementById('library-rename').disabled = !current;
  document.getElementById('library-save').textContent = current && libraryNameInput.value.trim() === current.name ? 'Update performance' : 'Save performance';
  libraryList.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'performance-empty';
    empty.textContent = 'No saved performances yet. Name this one and save it to keep its scenes, layout and settings together.';
    libraryList.append(empty);
    return;
  }
  entries.forEach((entry, index) => {
    const row = document.createElement('div');
    row.className = 'performance-row';
    row.dataset.libraryId = entry.id;
    row.classList.toggle('is-current', entry.id === current?.id);
    row.classList.toggle('is-browsing', browsing?.id === entry.id);
    const thumb = document.createElement('img');
    thumb.className = 'library-thumb'; thumb.alt = '';
    if (entry.thumbnail) thumb.src = entry.thumbnail; else thumb.style.visibility = 'hidden';
    const copy = document.createElement('div');
    copy.className = 'performance-copy';
    const title = document.createElement('div');
    title.className = 'performance-title';
    title.textContent = `${index + 1}. ${entry.name}`;
    if (entry.id === current?.id) { const badge = document.createElement('span'); badge.className = 'library-badge'; badge.textContent = 'current'; title.append(badge); }
    const meta = document.createElement('div');
    meta.className = 'performance-meta';
    meta.textContent = `${entry.sceneCount} scene${entry.sceneCount === 1 ? '' : 's'} · saved ${new Date(entry.updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`;
    copy.append(title, meta);
    const actions = document.createElement('div');
    actions.className = 'performance-actions';
    for (const [action, label, title] of [
      ['load', 'Load', `Load ${entry.name}`],
      ['export', 'Export', `Export ${entry.name} as a file`],
      ['up', '↑', `Move ${entry.name} up`],
      ['down', '↓', `Move ${entry.name} down`],
      ['delete', 'Delete', `Delete ${entry.name}`],
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.libraryAction = action;
      button.textContent = label;
      button.title = title;
      button.setAttribute('aria-label', title);
      if (action === 'delete') button.className = 'danger';
      if (action === 'load' && entry.id === current?.id) button.disabled = true;
      if (action === 'up' && index === 0) button.disabled = true;
      if (action === 'down' && index === entries.length - 1) button.disabled = true;
      actions.append(button);
    }
    row.append(thumb, copy, actions);
    libraryList.append(row);
  });
}

document.getElementById('library-save-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = libraryNameInput.value.trim();
  if (!name) { diagnostics.warn('Name the performance before saving it'); libraryNameInput.focus(); return; }
  void savePerformanceAs(name);
});
libraryNameInput.addEventListener('input', () => {
  const current = performanceLibrary.current();
  document.getElementById('library-save').textContent = current && libraryNameInput.value.trim() === current.name ? 'Update performance' : 'Save performance';
});
libraryList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-library-action]');
  const row = button?.closest('[data-library-id]');
  if (!button || !row) return;
  if (button.dataset.libraryAction === 'load') void loadPerformance(row.dataset.libraryId);
  else if (button.dataset.libraryAction === 'export') exportPerformanceEntry(row.dataset.libraryId);
  else if (button.dataset.libraryAction === 'delete') void deletePerformance(row.dataset.libraryId);
  else if (button.dataset.libraryAction === 'up' || button.dataset.libraryAction === 'down') {
    performanceLibrary.move(row.dataset.libraryId, button.dataset.libraryAction === 'up' ? -1 : 1);
    renderLibrary();
  }
});
document.getElementById('library-rename').addEventListener('click', () => {
  const current = performanceLibrary.current();
  const name = libraryNameInput.value.trim();
  if (!current) return;
  if (!name) { diagnostics.warn('Type the new name in the Performance name field first'); libraryNameInput.focus(); return; }
  if (name === current.name) { diagnostics.info('That is already its name'); return; }
  const result = performanceLibrary.update(current.id, { name });
  if (result.ok) { diagnostics.success(`Performance renamed — ${name}`); renderLibrary(); }
  else diagnostics.error('Could not rename performance', result.reason);
});
document.getElementById('library-snapshot').addEventListener('click', () => { void updateThumbnailFromStage(); });
document.getElementById('export-library').addEventListener('click', () => { exportAllPerformances(); });
document.getElementById('library-upload').addEventListener('click', () => document.getElementById('library-thumb-file').click());
document.getElementById('library-thumb-file').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  void updateThumbnailFromFile(file);
});
performanceLibrary.subscribe(() => { libraryNameInput.value = performanceLibrary.current()?.name ?? libraryNameInput.value; });
libraryNameInput.value = performanceLibrary.current()?.name ?? '';
renderLibrary();

// --- start dialog: recent performances and audio ---------------------------------

const welcomeRecent = document.getElementById('welcome-recent');
const welcomeRecentPerformances = document.getElementById('welcome-recent-performances');
const welcomeRecentAudio = document.getElementById('welcome-recent-audio');
const RECENT_LIMIT = 5;

function recentButton({ name, meta, thumbnail = null, glyph = '♪', current = false, onClick }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.classList.toggle('is-current', current);
  if (thumbnail) { const img = document.createElement('img'); img.src = thumbnail; img.alt = ''; button.append(img); }
  else { const icon = document.createElement('span'); icon.className = 'welcome-recent-glyph'; icon.textContent = glyph; button.append(icon); }
  const copy = document.createElement('span'); copy.className = 'welcome-recent-copy';
  const title = document.createElement('span'); title.className = 'welcome-recent-name'; title.textContent = name;
  const sub = document.createElement('span'); sub.className = 'welcome-recent-meta'; sub.textContent = meta;
  copy.append(title, sub); button.append(copy);
  button.setAttribute('aria-label', `${name} — ${meta}`);
  button.addEventListener('click', onClick);
  return button;
}

function renderWelcomeRecent() {
  const performances = performanceLibrary.list().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RECENT_LIMIT);
  const currentId = performanceLibrary.currentId();
  welcomeRecentPerformances.replaceChildren(...(performances.length ? performances.map(entry => recentButton({
    name: entry.name,
    meta: `${entry.sceneCount} scene${entry.sceneCount === 1 ? '' : 's'}${entry.id === currentId ? ' · current' : ''}`,
    thumbnail: entry.thumbnail, glyph: '▣', current: entry.id === currentId,
    onClick: async () => {
      const result = await loadPerformance(entry.id);
      if (result.ok) { welcomeNote.textContent = `${entry.name} is loaded — now choose a source.`; welcomeNote.classList.remove('is-error'); }
      renderWelcomeRecent();
    },
  })) : [Object.assign(document.createElement('div'), { className: 'welcome-recent-empty', textContent: 'No saved performances yet.' })]));
  const files = recentAudio.list();
  welcomeRecentAudio.replaceChildren(...(files.length ? files.map(entry => recentButton({
    name: entry.name,
    meta: entry.size ? `${(entry.size / 1_048_576).toFixed(1)} MB` : 'audio file',
    onClick: () => { void openRecentAudio(entry.name); },
  })) : [Object.assign(document.createElement('div'), { className: 'welcome-recent-empty', textContent: 'Audio files you load appear here.' })]));
  welcomeRecent.hidden = !performances.length && !files.length;
}
performanceLibrary.subscribe(renderWelcomeRecent);
renderWelcomeRecent();

function setSafeScene() {
  return controller.actions.setSafeState();
}

function restoreSafeState() {
  const result = controller.actions.restoreSafeState();
  if (!result.ok) return result;
  launcher.reset();
  performanceRecallSequence++;
  editor.value = result.source;
  projection.setActiveCode(result.source);
  projectStore.saveSoon(result.source, 0);
  controller.sourceChanged();
  return result;
}

function panic() {
  return restoreSafeState();
}

document.getElementById('set-safe').addEventListener('click', setSafeScene);
document.getElementById('panic').addEventListener('click', panic);

// --- patch library ---------------------------------------------------------------

/**
 * Insert a library patch into the editor and register it without changing a scene.
 *
 * It goes through the ordinary evaluation path — no privileged loading — so a library
 * patch is exactly as replaceable as one authored in the editor, and appears in Installed
 * Patches with a version number like any other.
 */
function installFromLibrary(entry) {
  const existing = editor.patchSource(entry.name);
  if (existing) {
    diagnostics.info(
      `${entry.title ?? entry.name} source is already in the project`,
      registry.hasStrategy(entry.name)
        ? 'Installed does not mean active. Use Add to scene to render it.'
        : 'Evaluate its patch cell to retry installation; no duplicate source was added.',
    );
    return { ok: registry.hasStrategy(entry.name), phase: 'present' };
  }

  editor.insertPatchSource(entry.source);
  const result = evaluator.evaluate(entry.source, { label: `patch ${entry.name}` });
  if (result.ok) {
    projection.setActiveCode(entry.source);
    diagnostics.info(
      `${entry.title ?? entry.name} source installed`,
      'It is installed in the project but will not render until you add it to the active scene.',
    );
  }
  return result;
}

function addPatchToScene(entry) {
  if (!registry.hasStrategy(entry.name)) {
    diagnostics.warn(`${entry.title ?? entry.name} is not installed`, 'Install its source first.');
    return { ok: false };
  }
  const sceneName = registry.activeSceneName() ?? 'liveScene';
  const currentOrder = registry.activeInstances().map((instance) => instance.strategy);
  // A scene-array caret is an explicit placement choice. Without one, append at the
  // bottom: post-processors and other order-sensitive patches should never silently
  // reorder a patch the performer just added.
  const result = editor.addStrategyToScene(sceneName, entry.name, currentOrder);
  if (!result.ok) {
    diagnostics.error(
      `Could not add ${entry.name} to ${sceneName}`,
      'Edit the scene array directly, then evaluate that scene cell.',
    );
    return result;
  }
  diagnostics.info(
    `${entry.title ?? entry.name} added to ${sceneName} source`,
    'Use Review scene & run to open the changed source, then Run or Cmd/Ctrl+Enter to evaluate it.',
  );
  return result;
}

function buildDemoScene() {
  // Add and evaluate all missing dependency cells in one editor update. Rebuilding the
  // highlighted/folded editor after every patch made a larger library needlessly slow.
  const dependencies = RAVE_PATCH_NAMES.map((name) =>
    LIBRARY.find((entry) => entry.name === name),
  ).filter(Boolean);
  const sourcesToEvaluate = [];
  const sourcesToInsert = [];

  for (const entry of dependencies) {
    if (registry.hasStrategy(entry.name)) continue;
    const projectSource = editor.patchSource(entry.name);
    sourcesToEvaluate.push(projectSource || entry.source);
    if (!projectSource) sourcesToInsert.push(entry.source);
  }

  if (sourcesToInsert.length) editor.insertPatchSource(sourcesToInsert.join('\n\n'));
  if (sourcesToEvaluate.length) {
    const installed = evaluator.evaluate(sourcesToEvaluate.join('\n\n'), {
      label: 'configured example patches',
    });
    if (!installed.ok) return installed;
    evaluator.applyPending();
  }

  const source = libraryDemoSource();
  editor.replaceNamedBlock('scene stacked', source);
  editor.revealScene('stacked');
  diagnostics.info(
    'Configured example added to the source',
    'It is not active yet. Press Cmd/Ctrl+Enter in the selected scene cell to evaluate it.',
  );
  return { ok: true, phase: 'inserted' };
}

document.getElementById('insert-demo-scene').addEventListener('click', buildDemoScene);

function connectExample(buttonId, file, sceneName, title, message) {
  document.getElementById(buttonId).addEventListener('click', async () => {
    try {
      const response = await fetch(new URL(`../starter/${file}`, import.meta.url));
      if (!response.ok) throw new Error(`Could not load ${title}`);
      const source = await response.text();
      for (const cell of findCells(source)) editor.replaceNamedBlock(cell.label, cell.text);
      const result = evaluator.evaluate(source, { label: title });
      if (!result.ok) throw result.error;
      editor.revealScene(sceneName);
      diagnostics.success(`${title} ready`, message);
    } catch (error) { diagnostics.error(`${title} could not start`, error.message); }
  });
}
connectExample('run-teapot', 'teapot.js', 'teapotScene', 'Teapot',
  'Controls has teapotSpin, teapotDots, teapotMotion, and teapotAudio. Load audio for reactive motion; save a scene to recall this later.');
connectExample('run-motion-lab', 'motion-lab.js', 'motionLab', 'Motion Lab',
  'Press Esc, then hold and release H for the ADSR; tap Space for tempo. The Lag cell compares raw steps with smooth motion. Your existing source remains in the project.');
connectExample('run-image-modulation', 'image-modulation.js', 'imageModulation', 'Image Modulation',
  'Press Esc, then hold H to compare the undistorted image. Controls has Modulation depth. The rings are a private image input; edit modRings to change the distortion. Your existing source remains in the project.');
connectExample('run-code-scene', 'code-scene.js', 'codeScene', 'Code Scene',
  'Type in an open cell to change the code image. Press Esc, then E to hide the editor; the scene keeps its code. Hold H outside the editor for the undistorted image.');

// --- project export / import -----------------------------------------------------

document.getElementById('export-project').addEventListener('click', () => {
  const performances = performanceStore.list();
  const name = projectStore.download(editor.value, performanceFileExtras());
  diagnostics.success(
    `Exported ${name}`,
    `${performances.length} scene${performances.length === 1 ? '' : 's'} included. Audio files remain separate.`,
  );
});

document.getElementById('import-project').addEventListener('click', () => {
  document.getElementById('import-file').click();
});

/** Replace the working project in place while the canvas, clock, audio, and named
 * performances continue uninterrupted. */
function loadStarterProject(message) {
  launcher.reset();
  performanceRecallSequence++;
  evaluator.discardPending();
  evaluator.clearBindings();
  projectStore.clear();
  host.reset();
  registry.reset();
  stateStore.clear();
  controlManager.restoreMappings([]);
  modulations.reset();

  editor.value = STARTER_SOURCE;
  evaluator.evaluate(STARTER_SOURCE, { label: 'starter' });
  evaluator.applyPending();
  registry.setSafeScene();
  // The new patches are still candidates until they render successfully. Capture the
  // complete safe checkpoint two frames later, but only if the performer has not
  // already moved on to another edit.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (editor.value === STARTER_SOURCE && registry.activeSceneName() === 'scene') {
      controller.actions.setSafeState();
    }
  }));
  projection.setActiveCode('');
  diagnostics.success(message);
}

async function confirmStarterProject({ title, body, warning, confirmLabel, message }) {
  const strategyCount = registry.listStrategies().length;
  const confirmed = await dialog.ask({
    title,
    body: body(strategyCount),
    warning,
    confirmLabel,
  });
  if (!confirmed) return false;
  loadStarterProject(message);
  return true;
}

async function startNewPerformance() {
  const started = await confirmStarterProject({
    title: 'Start a new performance?',
    body: (strategyCount) =>
      `This replaces the working source, all ${strategyCount} installed patches, ` +
      `their history, scenes, and state with the default starter. The scene list ` +
      `and pad layout start empty; a saved performance keeps its own copy. ` +
      `The music and canvas keep running.`,
    warning: performanceLibrary.current()
      ? `“${performanceLibrary.current().name}” is saved and up to date. Unsaved working edits cannot be recovered.`
      : 'This performance is not saved. Save it first if you want its scenes back later.',
    confirmLabel: 'Start fresh',
    message: 'New performance ready — pulsing square',
  });
  if (!started) return;
  startEmptyPerformance();
  performanceNameInput.value = '';
  const nameField = document.getElementById('library-name');
  if (nameField.offsetParent !== null) nameField.focus();
}

/** Forget the current performance and empty its scenes and pad layout. */
function startEmptyPerformance() {
  performanceStore.replace([]);
  launcher.import({ version: 1, slots: [], known: [], assignments: [], routes: [] });
  performanceLibrary.setCurrent(null);
  renderPerformances();
  renderLibrary();
}

document.getElementById('new-performance').addEventListener('click', startNewPerformance);

/** Start over — the destructive project-file counterpart to the clearer New
 * performance action above. */
document.getElementById('reset-project').addEventListener('click', () => {
  confirmStarterProject({
    title: 'Reset to the starter?',
    body: (strategyCount) =>
      `This discards your editor contents, all ${strategyCount} installed patches, ` +
      `their versions and history, every scene, and all patch state, and goes back to ` +
      `the starter. The music and the canvas keep running.`,
    warning: 'There is no undo for this. Export first if you might want it back.',
    confirmLabel: 'Reset to starter',
    message: 'Reset to the starter',
  }).then(done => { if (done) startEmptyPerformance(); });
});

document.getElementById('import-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = ''; // so importing the same file twice still fires
  if (!file) return;

  const parsed = projectStore.parseImport(await file.text());
  if (!parsed.ok) {
    diagnostics.error(`Could not import ${file.name}`, parsed.error);
    return;
  }
  if (parsed.kind === 'library') {
    const confirmed = await dialog.ask({
      title: `Import ${parsed.entries.length} performance${parsed.entries.length === 1 ? '' : 's'} from "${file.name}"?`,
      body: `They are added to your library: ${parsed.entries.map(entry => entry.name).join(', ')}. Nothing runs until you load one.`,
      warning: 'Imported performances contain code that runs with the same privileges as your own when loaded. Only import files from someone you trust.',
      confirmLabel: 'Add to library',
    });
    if (!confirmed) { diagnostics.info('Import cancelled'); return; }
    let added = 0;
    for (const entry of parsed.entries) if (performanceLibrary.save(entry).ok) added += 1;
    renderLibrary();
    diagnostics.success(`Imported ${added} performance${added === 1 ? '' : 's'}`, 'Load one from the list when you are ready.');
    return;
  }
  const importedSource = parsed.data.source;

  // Importing runs someone else's JavaScript on this machine. Error boundaries are
  // not a sandbox, so confirmation shows the actual source and defaults to Cancel.
  const importedName = parsed.data.name ?? file.name.replace(/\.json$/i, '');
  const confirmed = await dialog.ask({
    title: `Import "${parsed.data.name ?? file.name}"?`,
    body:
      `This performance contains ${importedSource.split('\n').length} lines of JavaScript ` +
      `including its scene arrays and ${parsed.data.performances.length} saved ` +
      `scene${parsed.data.performances.length === 1 ? '' : 's'}. Importing adds it to your ` +
      `performance library and loads it, replacing the current scenes, layout and settings ` +
      `(a saved current performance keeps its own copy).`,
    preview: importedSource.slice(0, 1200),
    warning:
      'p5js live runs imported code with the same privileges as your own. It is not a ' +
      'sandbox — imported code can freeze this tab. Only import performances from someone you trust.',
    confirmLabel: 'Import and run',
  });
  if (!confirmed) {
    diagnostics.info('Import cancelled');
    return;
  }

  const saved = performanceLibrary.save({ name: importedName, data: parsed.data, thumbnail: parsed.data.thumbnail ?? null });
  if (!saved.ok) {
    diagnostics.error(`Could not import ${file.name}`, saved.reason);
    return;
  }
  renderLibrary();
  const loaded = await loadPerformance(saved.performance.id);
  if (!loaded.ok) diagnostics.warn(`Imported ${importedName} into the library, but it did not run`, 'Fix the source and load it from the list.');
});

// Drop an audio file anywhere on the stage.
stage.addEventListener('dragover', (event) => event.preventDefault());
stage.addEventListener('drop', async (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  const item = event.dataTransfer?.items?.[0];
  const droppedHandle = typeof item?.getAsFileSystemHandle === 'function' ? await item.getAsFileSystemHandle().catch(() => null) : null;
  await loadAudioFile(file, droppedHandle);
});

// --- performer shortcuts (available once editor focus is released) --------------

/**
 * Every control that is not a glyph in the corner is one of these.
 *
 * That is the trade the minimal display makes: the chrome went away, so the commands
 * have to be in the hands. `?` prints this list, which is what lets it afford to be a
 * long one — and is why the list in index.html has to be kept next to this map.
 */
const COMMANDS = {
  0: () => panic(), // one action back to a scene the performer trusts
  s: () => setSafeScene(),
  r: () => toggleReference(), // project patches and their public interfaces
  e: () => toggleCode(), // the code itself — see the composition with nothing on it
  d: () => toggleVisualDimmer(), // performer-only contrast for unusually bright scenes
  n: () => toggleNavigation(), // top navigation; available again with the same key
  f: () => toggleFullscreen(),
  p: () => toggleProjection(),
  l: () => toggleLoop(),
  t: () => panels.tapTempo(),
  a: () => document.getElementById('audio-file-2').click(),
  m: () => startMicrophone(),
  '?': () => toggleKeys(),
  Escape: () => toggleKeys(true),
};

window.addEventListener('keydown', (event) => {
  keyboard.keys.add(event.key);
  keyboard.shift = event.shiftKey;
  keyboard.alt = event.altKey;

  // Structural editor commands deliberately work with the caret still in code.
  // `event.code` keeps the brackets stable on keyboard layouts where Alt changes
  // the character reported by `event.key`.
  const accel = event.metaKey || event.ctrlKey;
  const performanceIndex = performanceShortcutIndex(event);
  if (performanceIndex !== null) {
    event.preventDefault();
    if (!event.repeat) recallPerformanceSlot(performanceIndex);
    return;
  }
  if (accel && event.altKey && !event.shiftKey && event.code === 'KeyS') {
    event.preventDefault();
    if (!event.repeat) quickSavePerformance();
    return;
  }
  if (accel && event.altKey && !event.shiftKey && event.code === 'KeyR') {
    event.preventDefault();
    if (!event.repeat) toggleRobotEasterEgg();
    return;
  }
  if (accel && event.altKey && event.code === 'BracketLeft') {
    event.preventDefault();
    editor.foldAll();
    return;
  }
  if (accel && event.altKey && event.code === 'BracketRight') {
    event.preventDefault();
    editor.unfoldAll();
    return;
  }
  if (accel && event.altKey && event.code === 'Slash') {
    event.preventDefault();
    toggleKeys();
    return;
  }
  if (accel && event.altKey && event.code === 'KeyN') {
    event.preventDefault();
    startNewPerformance();
    return;
  }
  if (accel && event.altKey && event.code === 'KeyA') {
    event.preventDefault();
    aiAssistant.open();
    return;
  }
  if (accel && !event.altKey && event.code === 'Backslash') {
    event.preventDefault();
    toggleTools();
    return;
  }

  const tag = document.activeElement?.tagName;
  const inField = tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT';
  if (inField || document.activeElement?.isContentEditable || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === ' ') {
    const tapFocused = ['toolbar-tap', 'rhythm-tap'].includes(document.activeElement?.id);
    // Keep native Space activation on other controls. On Tap itself, use keydown
    // for precise timing rather than waiting for the button's keyup click.
    if (!event.shiftKey && !tapFocused && document.activeElement?.matches('button, summary, [role="button"], [role="tab"]')) return;
    event.preventDefault();
    if (!event.repeat) {
      if (event.shiftKey) toggleAudio();
      else panels.tapTempo();
    }
    return;
  }

  const command = COMMANDS[event.key];
  if (!command) return;
  event.preventDefault();
  if ((event.key === 'n' || event.key === 't') && event.repeat) return;
  command();
});
window.addEventListener('keyup', (event) => {
  keyboard.keys.delete(event.key);
  keyboard.shift = event.shiftKey;
  keyboard.alt = event.altKey;
});

rhythm.subscribe(() => projectStore.saveSoon(editor.value));

// Save on the way out, so a mid-set refresh does not lose the last edit.
window.addEventListener('beforeunload', () => {
  audio.disposeAnalysis();
  projectStore.save(editor.value);
  network.dispose();
  controlManager.dispose();
});

// Exposed for automated browser tests and for patch authors who want to inspect the
// running system from the browser console.
window.p5jsLive = {
  launcher,
  controller,
  registry,
  stateStore,
  evaluator,
  host,
  audio,
  diagnostics,
  editor,
  projection,
  projectStore,
  performanceStore,
  network,
  controlManager,
  aiAssistant,
  rhythm,
  push3Leds,
  push3Tempo: () => push3Tempo,
  push3Adapter: () => push3Adapter,
  push3Auto,
  effectsBoard,
  performanceLibrary,
  loadPerformance,
  modulations,
  recentAudio,
};
