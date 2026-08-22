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
import { createEditor } from './ui/editor.js';
import { createPanels } from './ui/panels.js';
import { createProjection } from './ui/projection.js';
import { createConfirmDialog } from './ui/confirmDialog.js';
import { createAIAssistant } from './ui/aiAssistant.js';
import { createAISettings } from './ai/settings.js';
import { createProjectStore } from './persistence/projectStore.js';
import { createPerformanceStore } from './persistence/performanceStore.js';
import { createAppController } from './app/controller.js';
import { evaluateStartupProject } from './app/startupRecovery.js';
import { getDefaultNetworkManager } from './network/networkManager.js';
import { STARTER_SOURCE, upgradeLegacyPlasma } from '../starter/starter.js';
import {
  LIBRARY,
  RAVE_PATCH_NAMES,
  libraryDemoSource,
  upgradeOpaqueDiagnostics,
} from '../starter/library.js';
import { COMMUNITY_PATCHES } from './generated/communityPatches.js';
import {
  findCells,
  moveSceneCellsLast,
  renameLegacyStarterScene,
  upgradeLegacyActivation,
} from './language/sourceBlocks.js';

const STARTER_PATCHES = findCells(STARTER_SOURCE).flatMap((cell) => {
  const match = /^(?:strategy|patch)\s+([A-Za-z_$][\w$]*)$/.exec(cell.label);
  if (!match) return [];
  return [{
    name: match[1],
    title: match[1],
    blurb: 'Included in the starter project.',
    source: cell.text.trimEnd(),
    origin: 'system',
    category: match[1] === 'plasma' ? 'shader' : 'visual',
  }];
});

const PATCH_LIBRARY = [
  ...STARTER_PATCHES,
  ...LIBRARY.map((entry) => ({ ...entry, title: entry.name, origin: 'system' })),
  ...COMMUNITY_PATCHES,
].sort((a, b) => a.title.localeCompare(b.title));

const diagnostics = createDiagnostics();
const registry = createRegistry();
const stateStore = createStateStore({ diagnostics });
const evaluator = createEvaluator({ registry, stateStore, diagnostics });
const audio = createAudioEngine({ diagnostics });
const network = getDefaultNetworkManager();

// Read-only keyboard state, handed to strategies as one of the draw inputs.
const controls = { keys: new Set(), shift: false, alt: false };

/**
 * p5 drawing isolation for one strategy invocation.
 *
 * push()/pop() already save and restore p5's style and transform stack. The reset in
 * between exists for a subtler reason: without it, an object inherits whatever the
 * *host* last set, so reordering a scene could silently change how it looks.
 * These are the defaults documented in docs/API.md.
 */
const drawing = {
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
};

let showCodeError = () => {};
const host = createHostLoop({
  registry,
  stateStore,
  evaluator,
  diagnostics,
  drawing,
  controls,
  onCodeError: (name) => showCodeError(name),
});
const controller = createAppController({
  registry,
  stateStore,
  diagnostics,
  evaluator,
  audio,
  host,
  network,
});
const projectStore = createProjectStore({ registry, diagnostics });
const performanceStore = createPerformanceStore({ diagnostics });
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

const editor = createEditor(document.getElementById('code'), {
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
  onFoldChange: (folded) => {
    foldButton.classList.toggle('is-on', folded);
    const label = folded
      ? 'Open complete editor; fold controls remain in the gutter'
      : 'Return to structured code folds';
    foldButton.title = label;
    foldButton.setAttribute('aria-label', label);
  },
});
showCodeError = (name) => editor.flashCodeError(name);
controller.setSourceProvider(() => editor.value);

foldButton.addEventListener('click', () => editor.toggleFolded());
editor.setFolded(true);

// Parameter and safety-setting changes also need to save, not only typing.
registry.subscribe(() => projectStore.saveSoon(editor.value));

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
  onLocateStrategy: (name) => {
    if (editor.revealStrategy(name)) toggleReference(true);
  },
});

const aiAssistant = createAIAssistant({
  editor,
  settings: createAISettings(),
  library: PATCH_LIBRARY,
  onConfigure: () => {
    toggleTools(false);
    panels.selectToolView('ai');
  },
});

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
    const patch = /^(?:strategy|patch)\s+([A-Za-z_$][\w$]*)$/.exec(cell.label);
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
  // One device pixel per canvas pixel. The reference budget is 60 FPS at 1280x720,
  // and a retina backing store quadruples the fill cost.
  pixelDensity(1);
  frameRate(60);
  background(8, 8, 12);

  audio.init();

  const saved = projectStore.load();
  const source = saved?.source ?? STARTER_SOURCE;
  const upgradedSource = upgradeLegacyPlasma(source);
  const diagnosticSource = upgradeOpaqueDiagnostics(upgradedSource);
  const commandSource = upgradeLegacyActivation(diagnosticSource);
  const namedSource = renameLegacyStarterScene(commandSource);
  const orderedSource = moveSceneCellsLast(namedSource);
  editor.value = orderedSource;
  if (upgradedSource !== source) {
    diagnostics.info(
      'Updated starter Plasma',
      'Its live speed, motion, intensity, and warp controls are now grouped at the top.',
    );
  }
  if (diagnosticSource !== upgradedSource) {
    diagnostics.info(
      'Updated diagnostic overlays',
      'Frequency bars and audio meters now draw solid marks with no backing tint.',
    );
  }
  if (commandSource !== diagnosticSource) {
    diagnostics.info(
      'Updated scene activation command',
      'activate(scene) now makes a scene array active.',
    );
  }
  if (namedSource !== commandSource) {
    diagnostics.info('Renamed the starter scene', 'The default scene binding is now simply scene.');
  }
  if (orderedSource !== namedSource) {
    diagnostics.info(
      'Organized project cells',
      'The first patch begins at line 1 and scene arrays load after their patch declarations.',
    );
  }
  // The starter/saved project goes through the ordinary atomic evaluation path. If
  // one saved cell is broken on reload, recover its other independent cells and keep
  // a small visible scene running instead of accepting an empty registry.
  const startup = evaluateStartupProject({
    source: orderedSource,
    label: saved ? 'saved project' : 'starter',
    starterSource: STARTER_SOURCE,
    evaluator,
    registry,
    stateStore,
    host,
  });
  if (startup.recovered) {
    diagnostics.warn(
      'Saved project recovered with errors',
      `${startup.failedBlocks.length} block${startup.failedBlocks.length === 1 ? '' : 's'} could not be evaluated. ` +
        'Their source is still in the editor. Installed source remains visible in the library; open the failed cell, fix it, and press Cmd/Ctrl+Enter.',
    );
  }
  projectStore.restoreSettings(
    saved?.safeScene === 'tunnel' && namedSource !== commandSource
      ? { ...saved, safeScene: 'scene' }
      : saved,
  );
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
  const drawInputs = host.beginFrame(snapshot, stageCanvas);

  // The live coder configures the scene as an ordered array of strategy values.
  // Each function or object exposes the current drawing behavior.
  for (const strategy of registry.activeStrategies()) {
    host.drawStrategy(strategy, drawInputs);
  }

  host.commitPendingChanges();
  // The first confirmed starter/saved scene becomes a complete recovery point.
  // Later edits never overwrite it; only the explicit Set safe action does.
  if (!controller.safeStateStatus().exists) controller.ensureSafeState();
  controller.setAudioSnapshot(snapshot);

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
    overlay.hidden = true;
    resetWelcomeLoadStatus();
    diagnostics.success(`Audio context ${state}`);
  } catch (error) {
    // An audio failure is a message, not a stopped draw loop.
    overlay.hidden = true;
    resetWelcomeLoadStatus();
    diagnostics.error('Could not start audio', `${error.message} — running on silence.`);
  }
}

async function chooseFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  try {
    // Safari must be unlocked by the file input's trusted change event. Waiting for
    // loadSound's asynchronous decode before doing this can leave a playing analyzer
    // graph whose master output is still inaudible.
    await audio.unlock();
  } catch (error) {
    diagnostics.error('Could not start audio', `${error.message} — running on silence.`);
    return;
  }
  try {
    await audio.loadFile(file, { onProgress: renderAudioLoadStatus });
    await startAudio();
  } catch (error) {
    if (error?.name === 'AbortError') return;
    // loadFile already reported the decode failure. Keep the picker open so the
    // performer can choose another source.
  }
}

async function enterWithSilence() {
  try {
    const state = await audio.unlock();
    audio.useSilence();
    overlay.hidden = true;
    resetWelcomeLoadStatus();
    diagnostics.success(`Audio context ${state}`, 'Running on silence.');
  } catch (error) {
    audio.useSilence();
    overlay.hidden = true;
    resetWelcomeLoadStatus();
    diagnostics.error('Could not start audio', `${error.message} — running on silence.`);
  }
}

for (const id of ['audio-file', 'audio-file-2']) {
  document.getElementById(id).addEventListener('change', (event) => chooseFile(event.target));
}
welcomeFileButton.addEventListener('click', () => welcomeFileInput.click());
document.getElementById('load-audio').addEventListener('click', () => {
  document.getElementById('audio-file-2').click();
});
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
  const fromWelcome = !overlay.hidden;
  const ok = await audio.useMicrophone(deviceId);
  if (!ok) return false;
  overlay.hidden = true;
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
document.getElementById('start-mic').addEventListener('click', () => startMicrophone());
deviceSelect.addEventListener('change', (event) => {
  if (event.target.value) startMicrophone(event.target.value);
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

const projectionButton = document.getElementById('projection-open');
const layoutSelect = document.getElementById('projection-layout');

function toggleProjection() {
  if (projection.isOpen()) {
    projection.close();
  } else {
    projection.open();
    projection.setLayout(layoutSelect.value);
  }
  projectionButton.classList.toggle('is-on', projection.isOpen());
}
projectionButton.addEventListener('click', toggleProjection);
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
const LEGACY_OPACITY_KEYS = [
  'algolab.toolsAlpha',
  'livecode-lab.toolsAlpha',
  'patchlab.toolsAlpha',
  'patchbay.toolsAlpha',
  'response.toolsAlpha',
];

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
  const value = Math.min(1, Math.max(0.15, Number(alpha) || 0.55));
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
    for (const legacyKey of LEGACY_OPACITY_KEYS) saved ??= localStorage.getItem(legacyKey);
  } catch {
    /* ignore */
  }
  opacityInput.value = setToolsOpacity(saved ?? opacityInput.value);
}

const CODE_FONT_SIZE_KEY = 'p5js-live.codeFontSize';
const LEGACY_CODE_FONT_SIZE_KEYS = [
  'algolab.codeFontSize',
  'livecode-lab.codeFontSize',
  'patchlab.codeFontSize',
  'patchbay.codeFontSize',
  'response.codeFontSize',
];
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
    for (const legacyKey of LEGACY_CODE_FONT_SIZE_KEYS) saved ??= localStorage.getItem(legacyKey);
  } catch {
    /* ignore */
  }
  setCodeFontSize(saved ?? codeSizeInput.value);
}

function toggleTools(force) {
  const hidden = force ?? !side.classList.contains('is-hidden');
  side.classList.toggle('is-hidden', hidden);
  document.getElementById('tools-toggle').classList.toggle('is-on', !hidden);
  if (!hidden) {
    referenceSide.classList.add('is-hidden');
    document.getElementById('reference-toggle').classList.remove('is-on');
  }
  // The canvas already fills the window, so nothing needs resizing — the panel is
  // over the top of it, not beside it. That is the point of the overlay.
  return hidden;
}
// Closed on arrival. Everything in the drawer is a setting; nothing in it is a move
// you make mid-set, and the ones that were — play, panic, projection — are glyphs and
// key commands now. So the default state of the window is the visuals and the code.
toggleTools(true);

document.getElementById('tools-toggle').addEventListener('click', () => toggleTools());

function toggleReference(force) {
  const hidden = force ?? !referenceSide.classList.contains('is-hidden');
  referenceSide.classList.toggle('is-hidden', hidden);
  document.getElementById('reference-toggle').classList.toggle('is-on', !hidden);
  if (!hidden) {
    side.classList.add('is-hidden');
    document.getElementById('tools-toggle').classList.remove('is-on');
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

// --- named performance recall ---------------------------------------------------

const performanceNameInput = document.getElementById('performance-name');
const performanceList = document.getElementById('performance-list');
let performanceRecallSequence = 0;

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
  const performances = performanceStore.list();
  performanceList.replaceChildren();
  if (performances.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'performance-empty';
    empty.textContent = 'No saved performances yet.';
    performanceList.append(empty);
    return;
  }

  for (const performance of performances) {
    const row = document.createElement('div');
    row.className = 'performance-row';
    row.dataset.performanceId = performance.id;

    const copy = document.createElement('div');
    copy.className = 'performance-copy';
    const title = document.createElement('div');
    title.className = 'performance-title';
    title.textContent = performance.name;
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
    `Could not recall ${performance.name} — previous performance restored`,
    detail,
  );
}

function recallPerformance(performance) {
  const checkpoint = controller.checkpoint();
  const sequence = ++performanceRecallSequence;
  const performanceSource = upgradeLegacyActivation(performance.source);

  evaluator.discardPending();
  evaluator.clearBindings();
  host.reset();
  registry.reset();
  stateStore.clear();
  editor.value = performanceSource;
  const result = evaluator.evaluate(performanceSource, { label: `performance ${performance.name}` });
  if (!result.ok) {
    restoreBeforePerformance(checkpoint, performance, result.error?.message ?? result.phase);
    return result;
  }
  evaluator.applyPending();
  applyPerformanceSettings(performance);
  projection.setActiveCode(performanceSource);
  projectStore.saveSoon(performanceSource, 0);
  controller.sourceChanged();
  diagnostics.success(
    `Performance recalled — ${performance.name}`,
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

document.getElementById('save-performance-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = performanceNameInput.value.trim();
  if (!name) {
    diagnostics.warn('Name the performance before saving it');
    performanceNameInput.focus();
    return;
  }
  const result = performanceStore.save(performanceSnapshot(name));
  if (!result.ok) {
    diagnostics.error('Could not save performance', result.reason);
    return;
  }
  performanceNameInput.value = '';
  renderPerformances();
  diagnostics.success(`Performance saved — ${name}`);
});

performanceList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-performance-action]');
  const row = button?.closest('[data-performance-id]');
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
    if (result.ok) diagnostics.success(`Performance updated — ${performance.name}`);
    else diagnostics.error(`Could not update ${performance.name}`, result.reason);
    renderPerformances();
  } else if (button.dataset.performanceAction === 'delete') {
    const confirmed = await dialog.ask({
      title: `Delete “${performance.name}”?`,
      body: 'This removes the local recall point. It does not change the performance currently running.',
      warning: 'There is no undo, though exported project files are unaffected.',
      confirmLabel: 'Delete performance',
    });
    if (confirmed && performanceStore.remove(performance.id)) {
      diagnostics.info(`Performance deleted — ${performance.name}`);
      renderPerformances();
    }
  }
});

renderPerformances();

function setSafeScene() {
  return controller.actions.setSafeState();
}

function restoreSafeState() {
  const result = controller.actions.restoreSafeState();
  if (!result.ok) return result;
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
  const result = editor.addStrategyToScene(sceneName, entry.name, currentOrder, {
    // Plasma samples everything drawn before it, so ordinary additions belong before
    // it even when the performer presses Add to scene after Plasma is already active.
    before: entry.name === 'plasma' ? null : 'plasma',
  });
  if (!result.ok) {
    diagnostics.error(
      `Could not add ${entry.name} to ${sceneName}`,
      'Edit the scene array directly, then evaluate that scene cell.',
    );
    return result;
  }
  diagnostics.info(
    `${entry.title ?? entry.name} added to ${sceneName} source`,
    'It is not active yet. Press Cmd/Ctrl+Enter in the selected scene cell to evaluate it.',
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

// --- project export / import -----------------------------------------------------

document.getElementById('export-project').addEventListener('click', () => {
  const name = projectStore.download(editor.value);
  diagnostics.success(`Exported ${name}`);
});

document.getElementById('import-project').addEventListener('click', () => {
  document.getElementById('import-file').click();
});

/** Replace the working project in place while the canvas, clock, audio, and named
 * performances continue uninterrupted. */
function loadStarterProject(message) {
  evaluator.discardPending();
  evaluator.clearBindings();
  projectStore.clear();
  host.reset();
  registry.reset();
  stateStore.clear();

  editor.value = STARTER_SOURCE;
  evaluator.evaluate(STARTER_SOURCE, { label: 'starter' });
  evaluator.applyPending();
  registry.setSafeScene();
  // The new Plasma is still a candidate until it renders successfully. Capture the
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
      `their history, scenes, and state with the default starter. Your named ` +
      `performances stay saved, and the music and canvas keep running.`,
    warning: 'Unsaved working edits cannot be recovered. Save, update, or export them first if needed.',
    confirmLabel: 'Start fresh',
    message: 'New performance ready — ASCII Noise + Plasma',
  });
  if (!started) return;
  performanceNameInput.value = '';
  performanceNameInput.focus();
}

document.getElementById('new-performance').addEventListener('click', startNewPerformance);

/** Start over — the destructive project-file counterpart to the clearer New
 * performance action above. */
document.getElementById('reset-project').addEventListener('click', () => {
  confirmStarterProject({
    title: 'Reset this project?',
    body: (strategyCount) =>
      `This discards your editor contents, all ${strategyCount} installed patches, ` +
      `their versions and history, every scene, and all patch state, and goes back to ` +
      `the starter project. The music and the canvas keep running.`,
    warning: 'There is no undo for this. Export first if you might want it back.',
    confirmLabel: 'Reset to starter',
    message: 'Project reset to the starter',
  });
});

document.getElementById('import-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = ''; // so importing the same file twice still fires
  if (!file) return;

  const parsed = projectStore.parseProject(await file.text());
  if (!parsed.ok) {
    diagnostics.error(`Could not import ${file.name}`, parsed.error);
    return;
  }
  const importedSource = upgradeLegacyActivation(parsed.data.source);

  // Importing runs someone else's JavaScript on this machine. Error boundaries are
  // not a sandbox, so confirmation shows the actual source and defaults to Cancel.
  const confirmed = await dialog.ask({
    title: `Import "${file.name}"?`,
    body:
      `This project contains ${importedSource.split('\n').length} lines of JavaScript ` +
      `including its scene arrays. Importing replaces your current editor contents ` +
      `and runs this code immediately.`,
    preview: importedSource.slice(0, 1200),
    warning:
      'p5js live runs imported code with the same privileges as your own. It is not a ' +
      'sandbox — imported code can freeze this tab. Only import projects from someone you trust.',
    confirmLabel: 'Import and run',
  });
  if (!confirmed) {
    diagnostics.info('Import cancelled');
    return;
  }

  evaluator.discardPending();
  evaluator.clearBindings();
  host.reset();
  registry.reset();
  stateStore.clear();
  editor.value = importedSource;
  const result = evaluator.evaluate(importedSource, { label: file.name });
  evaluator.applyPending();
  if (!result.ok) {
    diagnostics.error(`Could not run ${file.name}`, result.error?.message);
    return;
  }
  projectStore.restoreSettings(parsed.data);
  projection.setActiveCode(importedSource);
  diagnostics.success(`Imported ${file.name}`);
});

// Drop an audio file anywhere on the stage.
stage.addEventListener('dragover', (event) => event.preventDefault());
stage.addEventListener('drop', async (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  try {
    await audio.unlock();
  } catch (error) {
    diagnostics.error('Could not start audio', `${error.message} — running on silence.`);
    return;
  }
  try {
    await audio.loadFile(file, { onProgress: renderAudioLoadStatus });
    await startAudio();
  } catch {
    /* loadFile already reported the decode failure */
  }
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
  ' ': () => toggleAudio(),
  0: () => panic(), // one action back to a scene the performer trusts
  s: () => setSafeScene(),
  r: () => toggleReference(), // project patches and their public interfaces
  e: () => toggleCode(), // the code itself — see the composition with nothing on it
  f: () => toggleFullscreen(),
  p: () => toggleProjection(),
  l: () => toggleLoop(),
  a: () => document.getElementById('audio-file-2').click(),
  m: () => startMicrophone(),
  '?': () => toggleKeys(),
  Escape: () => toggleKeys(true),
};

window.addEventListener('keydown', (event) => {
  controls.keys.add(event.key);
  controls.shift = event.shiftKey;
  controls.alt = event.altKey;

  // Structural editor commands deliberately work with the caret still in code.
  // `event.code` keeps the brackets stable on keyboard layouts where Alt changes
  // the character reported by `event.key`.
  const accel = event.metaKey || event.ctrlKey;
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
  if (inField || event.metaKey || event.ctrlKey || event.altKey) return;

  const command = COMMANDS[event.key];
  if (!command) return;
  event.preventDefault();
  command();
});
window.addEventListener('keyup', (event) => {
  controls.keys.delete(event.key);
  controls.shift = event.shiftKey;
  controls.alt = event.altKey;
});

// Save on the way out, so a mid-set refresh does not lose the last edit.
window.addEventListener('beforeunload', () => {
  projectStore.save(editor.value);
  network.dispose();
});

// Exposed for automated browser tests and for patch authors who want to inspect the
// running system from the browser console.
window.p5jsLive = {
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
  aiAssistant,
};
