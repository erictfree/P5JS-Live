import { moveSceneCellsLast } from '../language/sourceBlocks.js';
import { AI_MODELS } from '../ai/settings.js';
import { requestSourceEdit } from '../ai/openaiClient.js';

function declared(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b(?:const|let|var|class|function)\\s+${escaped}\\b`).test(source);
}

export function installLibrarySources(source, names, library) {
  if (names.length === 0) return source;
  const entries = new Map(library.map((entry) => [entry.name, entry]));
  let next = source.trimEnd();
  for (const name of names) {
    const entry = entries.get(name);
    if (!entry?.source || declared(next, name)) continue;
    next = `${next}\n\n${entry.source.trim()}\n`;
  }
  return moveSceneCellsLast(next);
}

/** Chat-like AI source editor with one explicit staged transaction. */
export function createAIAssistant({
  editor,
  settings,
  library = [],
  onConfigure,
  client = requestSourceEdit,
}) {
  const byId = (id) => document.getElementById(id);
  const nodes = {
    window: byId('ai-assistant'),
    close: byId('ai-close'),
    conversation: byId('ai-conversation'),
    composer: byId('ai-prompt'),
    send: byId('ai-send'),
    stop: byId('ai-stop'),
    status: byId('ai-status'),
    stageActions: byId('ai-stage-actions'),
    accept: byId('ai-accept'),
    cancel: byId('ai-cancel'),
    configure: byId('ai-configure'),
    panelOpen: byId('ai-open'),
    panelModel: byId('ai-model'),
    panelKey: byId('ai-api-key'),
    panelRemember: byId('ai-remember-key'),
    panelSave: byId('ai-save-key'),
    panelForget: byId('ai-forget-key'),
    panelKeyStatus: byId('ai-key-status'),
  };

  let abortController = null;
  let conversation = [];

  for (const option of AI_MODELS) {
    const node = document.createElement('option');
    node.value = option.id;
    node.textContent = option.label;
    nodes.panelModel.append(node);
  }

  const saved = settings.load();
  nodes.panelModel.value = saved.model;
  nodes.panelKey.value = saved.key;
  nodes.panelRemember.checked = saved.remember;

  function keyStatus(message = '') {
    const hasKey = Boolean(nodes.panelKey.value.trim());
    nodes.panelKeyStatus.textContent = message || (hasKey
      ? nodes.panelRemember.checked
        ? 'Key saved on this device.'
        : 'Key saved for this browser session.'
      : 'No API key saved.');
    nodes.panelKeyStatus.dataset.ready = String(hasKey);
  }

  function persistSettings(message = '') {
    settings.setModel(nodes.panelModel.value);
    settings.saveKey(nodes.panelKey.value, { remember: nodes.panelRemember.checked });
    keyStatus(message);
    refreshComposerState();
  }

  function addMessage(role, text) {
    const row = document.createElement('div');
    row.className = `ai-message is-${role}`;
    const label = document.createElement('span');
    label.className = 'ai-message-role';
    label.textContent = role === 'user' ? 'You' : role === 'error' ? 'Error' : 'AI';
    const copy = document.createElement('div');
    copy.textContent = text;
    row.append(label, copy);
    nodes.conversation.append(row);
    nodes.conversation.scrollTop = nodes.conversation.scrollHeight;
    if (role === 'user' || role === 'assistant') {
      conversation.push({ role, text });
      conversation = conversation.slice(-12);
    }
  }

  function setStatus(text = '') {
    nodes.status.textContent = text;
  }

  function resizeComposer() {
    nodes.composer.style.height = 'auto';
    nodes.composer.style.height = `${Math.min(160, Math.max(48, nodes.composer.scrollHeight))}px`;
  }

  function setBusy(busy) {
    nodes.send.hidden = busy;
    nodes.stop.hidden = !busy;
    nodes.composer.disabled = busy;
    nodes.close.disabled = busy;
    if (!busy) nodes.composer.focus();
  }

  function refreshComposerState() {
    const configured = Boolean(settings.load().key);
    nodes.composer.disabled = !configured || Boolean(abortController);
    nodes.send.disabled = !configured;
    nodes.configure.hidden = configured;
    nodes.stageActions.hidden = !editor.hasStagedSource();
    if (!configured) setStatus('Add an OpenAI API key in the AI tab.');
    else if (!editor.hasStagedSource() && !abortController) setStatus('Changes are staged before they run.');
  }

  function open() {
    nodes.window.hidden = false;
    refreshComposerState();
    if (!settings.load().key) onConfigure?.();
    else nodes.composer.focus();
  }

  function close() {
    if (abortController) return;
    if (editor.hasStagedSource()) {
      setStatus('Accept or cancel the staged change before closing.');
      return;
    }
    nodes.window.hidden = true;
  }

  function cancel() {
    if (!editor.hasStagedSource()) return;
    editor.cancelStagedSource();
    addMessage('assistant', 'Cancelled the staged change. The previous source is restored.');
    refreshComposerState();
  }

  function accept() {
    if (!editor.hasStagedSource()) return;
    const result = editor.acceptStagedSource();
    if (result.ok) {
      addMessage('assistant', 'Accepted. The updated source is now running.');
      setStatus('Accepted and running.');
    } else {
      const reason = result.error?.message || 'The proposal could not be evaluated.';
      addMessage('error', `${reason} The previous visual is still running; ask AI to fix it or cancel.`);
      setStatus('Evaluation failed. The proposal remains staged.');
    }
    refreshComposerState();
  }

  async function submit() {
    const prompt = nodes.composer.value.trim();
    if (!prompt || abortController) return;
    persistSettings();
    const configuration = settings.load();
    if (!configuration.key) {
      onConfigure?.();
      refreshComposerState();
      return;
    }

    const requestSource = editor.value;
    nodes.composer.value = '';
    resizeComposer();
    addMessage('user', prompt);
    setStatus('Editing source…');
    abortController = new AbortController();
    setBusy(true);

    try {
      const result = await client({
        apiKey: configuration.key,
        model: configuration.model,
        prompt,
        source: requestSource,
        library,
        history: conversation.slice(0, -1),
        signal: abortController.signal,
      });
      if (editor.value !== requestSource) {
        throw new Error('The source changed while AI was working. Send the request again.');
      }
      const candidate = installLibrarySources(result.source, result.installPatches, library);
      const hadStagedSource = editor.hasStagedSource();
      const staged = editor.stageSource(candidate);
      if (staged.unchanged) {
        addMessage('assistant', hadStagedSource
          ? 'No additional source change was needed.'
          : 'No source change was needed.');
        setStatus(hadStagedSource ? 'The existing proposal remains staged.' : 'No change staged.');
      } else {
        addMessage('assistant', result.summary);
        setStatus(`${staged.changed} changed line${staged.changed === 1 ? '' : 's'} staged.`);
      }
    } catch (error) {
      if (error?.name === 'AbortError') addMessage('assistant', 'Stopped. No change was applied.');
      else addMessage('error', error?.message || 'The AI request failed.');
      setStatus('No new change was staged.');
    } finally {
      abortController = null;
      setBusy(false);
      refreshComposerState();
    }
  }

  nodes.panelSave.addEventListener('click', () => persistSettings());
  nodes.panelForget.addEventListener('click', () => {
    settings.forgetKey();
    nodes.panelKey.value = '';
    nodes.panelRemember.checked = false;
    keyStatus('API key forgotten.');
    refreshComposerState();
  });
  nodes.panelModel.addEventListener('change', () => settings.setModel(nodes.panelModel.value));
  nodes.panelRemember.addEventListener('change', () => persistSettings());
  nodes.panelOpen.addEventListener('click', open);
  nodes.configure.addEventListener('click', () => onConfigure?.());
  nodes.close.addEventListener('click', close);
  nodes.cancel.addEventListener('click', cancel);
  nodes.accept.addEventListener('click', accept);
  nodes.send.addEventListener('click', submit);
  nodes.stop.addEventListener('click', () => abortController?.abort());
  nodes.composer.addEventListener('input', resizeComposer);
  nodes.composer.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    submit();
  });

  // These shortcuts own a staged proposal before the editor's normal evaluate/undo
  // handlers see them. There is only one AI transaction, even after follow-ups.
  window.addEventListener('keydown', (event) => {
    if (!editor.hasStagedSource()) return;
    const accel = event.metaKey || event.ctrlKey;
    if (accel && !event.altKey && event.key === 'Enter') {
      event.preventDefault();
      event.stopImmediatePropagation();
      accept();
    } else if (accel && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    }
  }, true);

  keyStatus();
  resizeComposer();
  refreshComposerState();

  return { open, close, accept, cancel };
}
