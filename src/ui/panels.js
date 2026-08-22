// Performer view — renders application snapshots and emits controller actions.
//
// This module owns DOM construction only. It never imports or receives the registry,
// state store, evaluator, audio engine, or host loop.

const METER_HZ = 15;
const TOOL_VIEW_KEY = 'p5js-live.toolView';
const LIBRARY_GROUPS = Object.freeze([
  { key: 'utility', label: 'Utilities' },
  { key: 'visual', label: 'Visual patches' },
  { key: 'shader', label: 'Shaders' },
  { key: 'community', label: 'Community patches' },
]);

export function createPanels({
  controller,
  library = [],
  onInsertLibrary,
  onAddToScene,
  onAddNetworkStream,
  onRevert,
  onLocateStrategy,
  onRestoreSafe,
  storage = globalThis.localStorage,
}) {
  const el = (id) => document.getElementById(id);
  const nodes = {
    toolTabs: el('tool-tabs'),
    toolPanels: [...document.querySelectorAll('[data-tool-panel]')],
    references: el('strategy-reference-list'),
    library: el('strategy-library'),
    libraryFilters: el('library-filters'),
    libraryAllCount: el('library-count-all'),
    libraryInstalledCount: el('library-count-installed'),
    libraryActiveCount: el('library-count-active'),
    libraryTabCount: el('library-tab-count'),
    messagesTabCount: el('messages-tab-count'),
    history: el('history-list'),
    diagnostics: el('diagnostics-list'),
    params: el('param-list'),
    paramsPanel: el('parameters-panel'),
    paramsSummaryCount: el('parameter-summary-count'),
    fps: el('stat-fps'),
    strategyCount: el('stat-strategies'),
    status: el('stat-status'),
    audioSource: el('audio-source'),
    audioPosition: el('audio-position'),
    playToggle: el('play-toggle'),
    loopToggles: [el('loop-toggle'), el('loop-performance-toggle')],
    audioLoadState: el('audio-load-state'),
    audioLoadLabel: el('audio-load-label'),
    audioLoadProgress: el('audio-load-progress'),
    audioError: el('audio-error'),
    beatDot: el('beat-dot'),
    safeNote: el('safe-scene-note'),
    restoreSafe: el('restore-safe'),
    networkStatus: el('network-status'),
    networkRooms: el('network-rooms'),
    networkService: el('network-service'),
    networkJoinForm: el('network-join-form'),
    networkRoomName: el('network-room-name'),
    networkPerformerName: el('network-performer-name'),
    networkRoomToken: el('network-room-token'),
  };
  let libraryFilter = 'all';
  let activeToolView = 'audio';
  try {
    activeToolView = storage?.getItem(TOOL_VIEW_KEY) || activeToolView;
  } catch {
    /* private-mode storage is optional */
  }
  let diagnosticsInitialized = false;
  let latestDiagnosticKey = null;
  const libraryOpenGroups = new Set();

  function selectToolView(view, { focus = false } = {}) {
    const requested = nodes.toolTabs.querySelector(`[data-tool-view="${view}"]`);
    const selected = requested && !requested.disabled
      ? requested
      : nodes.toolTabs.querySelector('[data-tool-view="audio"]:not(:disabled)');
    if (!selected) return;
    activeToolView = selected.dataset.toolView;
    for (const tab of nodes.toolTabs.querySelectorAll('[data-tool-view]')) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    for (const panel of nodes.toolPanels) {
      panel.hidden = panel.dataset.toolPanel !== activeToolView;
    }
    try {
      storage?.setItem(TOOL_VIEW_KEY, activeToolView);
    } catch {
      /* private-mode storage is optional */
    }
    if (focus) selected.focus();
  }

  function renderStrategies(snapshot) {
    const expanded = new Set(
      [...nodes.references.querySelectorAll('[data-strategy][open]')].map(
        (row) => row.dataset.strategy,
      ),
    );
    const rows = snapshot.strategies.map((strategy) => strategyRow(strategy, expanded.has(strategy.name)));

    if (rows.length === 0) {
      rows.push(hint('No patches yet. Evaluate a patch and place it in a scene array.'));
    }
    nodes.references.replaceChildren(...rows);
    const running = snapshot.strategies.filter((strategy) => strategy.running).length;
    nodes.strategyCount.textContent =
      `${running} running · ${snapshot.scene.order.length} active · ` +
      `${snapshot.installedPatches.length} installed`;
  }

  function renderLibrary(snapshot) {
    const known = new Map(snapshot.strategies.map((strategy) => [strategy.name, strategy]));
    const installed = new Set(snapshot.installedPatches);
    const inSceneSource = new Set(snapshot.scene.sourceOrder);
    const installedCount = library.filter((entry) => installed.has(entry.name)).length;
    const activeCount = library.filter((entry) => known.get(entry.name)?.active).length;
    nodes.libraryAllCount.textContent = String(library.length);
    nodes.libraryInstalledCount.textContent = String(installedCount);
    nodes.libraryActiveCount.textContent = String(activeCount);
    nodes.libraryTabCount.textContent = String(installedCount);
    nodes.libraryTabCount.title = `${installedCount} of ${library.length} patches installed`;
    for (const button of nodes.libraryFilters.querySelectorAll('button[data-library-filter]')) {
      button.setAttribute('aria-pressed', String(button.dataset.libraryFilter === libraryFilter));
    }
    const visible = library.filter((entry) => {
      const strategy = known.get(entry.name);
      if (libraryFilter === 'installed') return installed.has(entry.name);
      if (libraryFilter === 'active') return Boolean(strategy?.active);
      return true;
    });
    if (visible.length === 0) {
      nodes.library.replaceChildren(hint(`No ${libraryFilter} patches.`));
      return;
    }

    const sections = LIBRARY_GROUPS.flatMap((group) => {
      const entries = visible.filter((entry) => entry.category === group.key);
      if (entries.length === 0) return [];
      return [librarySection(group, entries, known, installed, inSceneSource)];
    });
    nodes.library.replaceChildren(...sections);
  }

  function strategyRow(strategy, open) {
    const active = strategy.active;
    const details = document.createElement('details');
    details.className = `strategy-reference strategy ${active ? 'is-active' : 'is-idle'}`;
    details.dataset.strategy = strategy.name;
    details.open = open;

    const row = document.createElement('summary');
    row.className = 'row strategy-summary';

    const dot = document.createElement('span');
    dot.className = `dot ${strategy.status === 'failed' ? 'bad' : strategy.running ? 'ok' : 'idle'}`;
    dot.title = strategy.status === 'failed' ? (strategy.lastError?.message ?? 'failed') : strategy.lifecycle;

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = strategy.name;
    if (strategy.copies > 1) {
      const badge = document.createElement('span');
      badge.className = 'copies';
      badge.textContent = `×${strategy.copies}`;
      name.append(' ', badge);
    }

    const version = document.createElement('span');
    version.className = 'version';
    version.textContent = `v${strategy.version}`;

    const status = document.createElement('span');
    status.className = `patch-status ${strategy.status === 'failed' ? 'failed' : strategy.lifecycle}`;
    status.textContent = strategy.status === 'failed' ? 'Failed' : titleCase(strategy.lifecycle);
    status.title = lifecycleHelp(strategy.status === 'failed' ? 'failed' : strategy.lifecycle);

    const actions = document.createElement('span');
    actions.className = 'actions';
    actions.append(
      icon('⌖', `Jump to ${strategy.name} source`, (event) => {
        event.preventDefault();
        event.stopPropagation();
        onLocateStrategy?.(strategy.name);
      }),
    );

    row.append(dot, name, version, status, actions);
    details.append(row, strategyReference(strategy));
    if (strategy.status === 'failed' && strategy.lastError) {
      const error = document.createElement('div');
      error.className = 'row-error';
      error.textContent = strategy.lastError.message;
      details.append(error);
    }
    return details;
  }

  function strategyReference(strategy) {
    const reference = document.createElement('div');
    reference.className = 'strategy-api';

    const summary = document.createElement('div');
    summary.className = 'strategy-kind';
    const kind =
      strategy.reference.kind === 'class'
        ? `${strategy.reference.className} instance`
        : strategy.reference.kind === 'object'
          ? 'object literal'
          : strategy.reference.kind;
    summary.textContent =
      `${kind} · ${strategy.running ? 'running' : strategy.active ? 'active, not running' : 'installed, not active'}` +
      (strategy.copies > 1 ? ` ×${strategy.copies}` : '');
    reference.append(summary);

    appendReferenceSection(reference, 'properties', strategy.reference.properties, (property) =>
      code(`${property.name}: ${property.value}`),
    );
    appendReferenceSection(reference, 'methods', strategy.reference.methods, code);
    appendReferenceSection(reference, 'lifecycle', strategy.reference.lifecycle, code);
    return reference;
  }

  function appendReferenceSection(parent, title, entries, render) {
    if (!entries.length) return;
    const section = document.createElement('div');
    section.className = `strategy-api-section strategy-api-${title}`;
    const label = document.createElement('div');
    label.className = 'strategy-api-label';
    label.textContent = title;
    section.append(label, ...entries.map(render));
    parent.append(section);
  }

  function code(text) {
    const result = document.createElement('code');
    result.textContent = text;
    return result;
  }

  function librarySection(group, entries, known, installed, inSceneSource) {
    const section = document.createElement('details');
    section.className = 'library-group';
    section.dataset.libraryGroup = group.key;
    section.open = libraryFilter !== 'all' || libraryOpenGroups.has(group.key);

    const heading = document.createElement('summary');
    heading.className = 'library-group-heading';
    const label = document.createElement('span');
    label.textContent = group.label;
    const count = document.createElement('span');
    count.textContent = String(entries.length);
    heading.append(label, count);
    section.append(
      heading,
      ...entries.map((entry) => libraryRow(
        entry,
        known.get(entry.name),
        installed.has(entry.name),
        inSceneSource.has(entry.name),
      )),
    );
    section.addEventListener('toggle', () => {
      if (section.open) libraryOpenGroups.add(group.key);
      else libraryOpenGroups.delete(group.key);
    });
    return section;
  }

  function libraryRow(entry, strategy, sourceInstalled, inSceneSource) {
    const installed = sourceInstalled || Boolean(strategy);
    const active = Boolean(strategy?.active);
    const running = Boolean(strategy?.running);
    const lifecycle = running ? 'running' : active ? 'active' : installed ? 'installed' : 'available';
    const row = document.createElement('div');
    row.className = `row strategy is-${lifecycle}`;
    row.dataset.library = entry.name;
    row.dataset.origin = entry.origin;
    row.dataset.category = entry.category;
    row.dataset.lifecycle = lifecycle;
    if (!installed) row.dataset.available = entry.name;

    const dot = document.createElement('span');
    dot.className = `dot ${running ? 'ok' : 'idle'}`;
    dot.title = lifecycleHelp(lifecycle);

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = entry.title ?? entry.name;
    name.title = entry.author ? `${entry.name} · ${entry.blurb}` : entry.blurb;

    const origin = document.createElement('span');
    origin.className = `version library-origin ${entry.origin}`;
    origin.textContent = entry.origin === 'community' ? entry.author : 'system';

    const status = document.createElement('span');
    status.className = `patch-status ${lifecycle}`;
    status.textContent = titleCase(lifecycle);
    status.title = lifecycleHelp(lifecycle);

    const actions = document.createElement('span');
    actions.className = 'actions';
    let action;
    if (!installed) {
      const actionTitle = entry.origin === 'community'
        ? `Install ${entry.title} patch source by ${entry.author} — ${entry.blurb}`
        : `Install ${entry.title} system patch source — ${entry.blurb}`;
      action = button('Install source', actionTitle, () => onInsertLibrary?.(entry));
    } else if (!strategy) {
      action = button(
        'Open source',
        `${entry.title ?? entry.name} source is installed but did not register; open it to fix and evaluate`,
        () => onLocateStrategy?.(entry.name),
      );
    } else if (!active && inSceneSource) {
      action = button(
        'Added — activate scene',
        `${entry.title} is in the active scene source and waiting for Cmd/Ctrl+Enter`,
        () => {},
      );
      action.disabled = true;
    } else if (!active) {
      action = button(
        'Add to scene',
        `Add installed patch ${entry.title} to the active scene source`,
        () => onAddToScene?.(entry),
      );
    } else {
      action = button(
        'In active scene',
        `${entry.title} is active${running ? ' and running' : ' but has not completed a successful render'}`,
        () => {},
      );
      action.disabled = true;
    }
    actions.append(action);
    row.append(dot, name, origin, status, actions);
    return row;
  }

  function renderSafeState(snapshot) {
    const { safeState } = snapshot;
    if (!safeState.exists) {
      nodes.safeNote.textContent = 'No safe snapshot yet. Set safe captures the working source, patch versions, scene, parameters and state.';
    } else {
      const created = new Date(safeState.createdAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      nodes.safeNote.textContent =
        `Safe snapshot: ${safeState.sceneName} · ${created} · ` +
        (safeState.dirty ? 'current project differs' : 'current project matches');
    }
    nodes.restoreSafe.disabled = !safeState.exists;
  }

  function renderParams(snapshot) {
    nodes.paramsPanel.hidden = snapshot.params.length === 0;
    nodes.paramsSummaryCount.textContent = String(snapshot.params.length);
    nodes.params.replaceChildren(
      ...(snapshot.params.length ? snapshot.params.map(paramRow) : [hint('No parameters declared.')]),
    );
  }

  function paramRow(entry) {
    const row = document.createElement('label');
    row.className = 'row param';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = entry.name;
    const value = document.createElement('span');
    value.className = 'version';
    value.textContent = format(entry.value);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = entry.min ?? 0;
    input.max = entry.max ?? 1;
    input.step = entry.step ?? 0.01;
    input.value = entry.value;
    input.addEventListener('input', () => {
      const next = Number(input.value);
      controller.actions.setParam(entry.name, next);
      value.textContent = format(next);
    });

    row.append(name, value, input);
    return row;
  }

  function renderHistory(snapshot) {
    nodes.history.replaceChildren(
      ...(snapshot.history.length ? snapshot.history.map(historyRow) : [hint('No successful evaluations yet.')]),
    );
  }

  function historyRow(entry) {
    const row = document.createElement('div');
    row.className = 'row history';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = `${entry.name} v${entry.version}`;
    const time = document.createElement('span');
    time.className = 'version';
    time.textContent = new Date(entry.at).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    row.append(
      name,
      time,
      button('revert', `Make ${entry.name} v${entry.version} active again`, () => {
        const result = controller.actions.revert(entry.name, entry.version);
        if (result.ok && result.source) onRevert?.({ ...entry, source: result.source });
      }),
    );
    return row;
  }

  function renderDiagnostics(snapshot) {
    nodes.diagnostics.replaceChildren(
      ...(snapshot.diagnostics.length
        ? snapshot.diagnostics.map(diagnosticRow)
        : [hint('Nothing to report.')]),
    );
    nodes.messagesTabCount.textContent = String(snapshot.diagnostics.length);
    nodes.messagesTabCount.hidden = snapshot.diagnostics.length === 0;
    const latest = snapshot.diagnostics[0];
    if (latest) {
      nodes.status.textContent = latest.message;
      nodes.status.className = `value ${latest.level}`;
      const key = `${latest.at ?? ''}:${latest.level}:${latest.message}`;
      if (diagnosticsInitialized && key !== latestDiagnosticKey && latest.level === 'error') {
        selectToolView('messages');
      }
      latestDiagnosticKey = key;
    }
    diagnosticsInitialized = true;
  }

  function renderNetwork(snapshot) {
    const network = snapshot.network;
    nodes.networkStatus.textContent = network.status;
    nodes.networkStatus.className = `value network-${network.status}`;
    nodes.networkService.textContent = network.service ?? 'Not connected';
    const rows = network.rooms.flatMap((room) => {
      const heading = document.createElement('div');
      heading.className = 'row network-room';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = room.name;
      const status = document.createElement('span');
      status.className = 'version';
      status.textContent = `${room.performer} · ${room.status}`;
      const roomActions = document.createElement('span');
      roomActions.className = 'actions';
      if (room.watched) {
        roomActions.append(button(
          'Leave',
          `Stop watching ${room.name}; active scene objects retain their own connection`,
          () => controller.actions.leaveNetworkRoom(room.name),
        ));
      }
      heading.append(name, status, roomActions);

      const streamRows = room.streams.map((stream) => {
        const row = document.createElement('div');
        row.className = 'row network-stream';
        const dot = document.createElement('span');
        dot.className = `dot ${stream.local ? 'ok' : 'idle'}`;
        const label = document.createElement('span');
        label.className = 'name';
        label.textContent = stream.label;
        const origin = document.createElement('span');
        origin.className = 'version';
        origin.textContent = stream.local ? 'yours' : 'remote';
        const actions = document.createElement('span');
        actions.className = 'actions';
        if (!stream.local) {
          actions.append(button(
            'Add receiver',
            `Add ${stream.label} as a receiver patch and activate the updated scene`,
            () => onAddNetworkStream?.({
              room: room.name,
              performer: room.performer,
              stream: stream.label,
            }),
          ));
        }
        row.append(dot, label, origin, actions);
        return row;
      });
      const publicationRows = room.publishing.map((publication) => {
        const row = document.createElement('div');
        row.className = 'row network-publication';
        const dot = document.createElement('span');
        dot.className = 'dot ok';
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = `${room.performer}/${publication.name}`;
        const status = document.createElement('span');
        status.className = 'version';
        status.textContent = `${publication.fps} fps · ${publication.status}`;
        row.append(dot, name, status);
        return row;
      });
      return [heading, ...publicationRows, ...streamRows];
    });
    nodes.networkRooms.replaceChildren(
      ...(rows.length ? rows : [hint('No active StreamRoom objects. Add a publisher or receiver to a scene.')]),
    );
  }

  function diagnosticRow(entry) {
    const row = document.createElement('div');
    row.className = `row diagnostic ${entry.level}`;
    const message = document.createElement('div');
    message.className = 'name';
    message.textContent = entry.message;
    row.append(message);
    if (entry.detail) {
      const detail = document.createElement('div');
      detail.className = 'row-error';
      detail.textContent = entry.detail;
      row.append(detail);
    }
    return row;
  }

  function updateMeters() {
    const live = controller.performanceSnapshot();
    nodes.fps.textContent = live.fps.toFixed(0);
    nodes.fps.className = `value ${live.fps < 30 ? 'warn' : ''}`;

    const status = live.audioStatus;
    const canPlay = status.kind === 'file' && status.loaded && !status.loading;
    nodes.playToggle.disabled = !canPlay;
    nodes.playToggle.textContent = status.playing && status.kind === 'file' ? '❚❚ pause' : '▶ play';
    nodes.playToggle.setAttribute(
      'aria-label',
      status.playing && status.kind === 'file' ? 'Pause audio' : 'Play audio',
    );
    nodes.playToggle.classList.toggle('is-on', status.playing && status.kind === 'file');
    for (const button of nodes.loopToggles) {
      button.classList.toggle('is-on', status.looping);
      button.setAttribute('aria-pressed', String(status.looping));
    }
    nodes.audioSource.textContent = status.source === 'none' ? 'No audio selected' : status.source;
    nodes.audioPosition.textContent =
      status.loading
        ? loadingLabel(status)
        : status.kind === 'mic'
        ? 'live'
        : status.loaded
          ? `${formatTime(status.position)} / ${formatTime(status.duration)}${status.playing ? '' : ' (paused)'}`
          : status.contextState === 'running'
            ? 'ready'
            : 'waiting';
    renderAudioProgress(status);
    nodes.audioError.hidden = !status.error;
    nodes.audioError.textContent = status.error ?? '';
    if (live.audio) nodes.beatDot.classList.toggle('lit', live.audio.beat);
  }

  function loadingLabel(status) {
    if (status.loadPhase === 'decoding') return 'decoding…';
    return Number.isFinite(status.loadProgress)
      ? `loading ${Math.round(status.loadProgress * 100)}%`
      : 'loading…';
  }

  function renderAudioProgress(status) {
    nodes.audioLoadState.hidden = !status.loading;
    if (!status.loading) return;
    nodes.audioLoadLabel.textContent =
      status.loadPhase === 'decoding' ? 'Decoding audio…' : 'Loading audio…';
    if (status.loadPhase === 'loading' && Number.isFinite(status.loadProgress)) {
      nodes.audioLoadProgress.value = status.loadProgress;
    } else {
      nodes.audioLoadProgress.removeAttribute('value');
    }
  }

  function renderAll(snapshot = controller.snapshot()) {
    renderStrategies(snapshot);
    renderLibrary(snapshot);
    renderSafeState(snapshot);
    renderParams(snapshot);
    renderHistory(snapshot);
    renderNetwork(snapshot);
    renderDiagnostics(snapshot);
  }

  const titleCase = (value) => `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
  const lifecycleHelp = (value) => ({
    available: 'Available: this patch exists in the library but its source is not in the project.',
    installed: 'Installed: source is in the project, but no instance is in the active scene.',
    active: 'Active: an instance is in the current scene and is waiting for a successful render.',
    running: 'Running: the active patch evaluated successfully and rendered.',
    failed: 'Failed: the active patch did not render successfully; the last good scene remains available.',
  })[value] ?? value;

  function icon(glyph, title, onClick) {
    const result = button(glyph, title, onClick);
    result.className = 'icon';
    return result;
  }

  function button(label, title, onClick) {
    const result = document.createElement('button');
    result.type = 'button';
    result.textContent = label;
    result.title = title;
    result.setAttribute('aria-label', title);
    result.addEventListener('click', onClick);
    return result;
  }

  function hint(text) {
    const result = document.createElement('div');
    result.className = 'hint';
    result.textContent = text;
    return result;
  }

  const format = (value) =>
    typeof value === 'number' ? value.toFixed(3).replace(/\.?0+$/, '') : String(value);
  const formatTime = (seconds) =>
    `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

  const unsubscribe = controller.subscribe(renderAll);
  nodes.toolTabs.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-tool-view]');
    if (tab && !tab.disabled) selectToolView(tab.dataset.toolView);
  });
  nodes.toolTabs.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...nodes.toolTabs.querySelectorAll('[data-tool-view]:not(:disabled)')];
    const current = tabs.findIndex((tab) => tab.dataset.toolView === activeToolView);
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    selectToolView(tabs[next].dataset.toolView, { focus: true });
  });
  nodes.libraryFilters.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-library-filter]');
    if (!button) return;
    libraryFilter = button.dataset.libraryFilter;
    renderLibrary(controller.snapshot());
  });
  nodes.restoreSafe.addEventListener('click', () => onRestoreSafe?.());
  nodes.networkJoinForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = nodes.networkRoomName.value.trim();
    const performer = nodes.networkPerformerName.value.trim();
    if (!name || !performer) return;
    controller.actions.joinNetworkRoom({
      name,
      performer,
      token: nodes.networkRoomToken.value || null,
    });
  });
  selectToolView(activeToolView);
  renderAll();
  const timer = setInterval(updateMeters, 1000 / METER_HZ);

  return {
    renderAll,
    selectToolView,
    stop() {
      unsubscribe();
      clearInterval(timer);
    },
  };
}
