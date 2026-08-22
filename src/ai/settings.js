export const AI_MODELS = Object.freeze([
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra — balanced' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna — fast' },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol — strongest' },
]);

export const DEFAULT_AI_MODEL = AI_MODELS[0].id;

const MODEL_KEY = 'p5js-live.ai.model';
const REMEMBER_KEY = 'p5js-live.ai.remember';
const API_KEY = 'p5js-live.ai.openai-key';

function read(storage, key) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(storage, key, value) {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    /* Storage is optional in private or locked-down browser contexts. */
  }
}

/** Local settings only. Keys never enter projects, exports, diagnostics, or URLs. */
export function createAISettings({
  local = globalThis.localStorage,
  session = globalThis.sessionStorage,
} = {}) {
  const allowedModels = new Set(AI_MODELS.map(({ id }) => id));

  function model() {
    const saved = read(local, MODEL_KEY);
    return allowedModels.has(saved) ? saved : DEFAULT_AI_MODEL;
  }

  function remember() {
    return read(local, REMEMBER_KEY) === 'true';
  }

  function key() {
    return remember()
      ? read(local, API_KEY) ?? ''
      : read(session, API_KEY) ?? '';
  }

  return {
    load() {
      return { model: model(), key: key(), remember: remember() };
    },
    setModel(next) {
      const value = allowedModels.has(next) ? next : DEFAULT_AI_MODEL;
      write(local, MODEL_KEY, value);
      return value;
    },
    saveKey(next, { remember: persist = false } = {}) {
      const value = String(next ?? '').trim();
      write(local, REMEMBER_KEY, persist ? 'true' : 'false');
      write(persist ? local : session, API_KEY, value || null);
      write(persist ? session : local, API_KEY, null);
      return value;
    },
    forgetKey() {
      write(local, API_KEY, null);
      write(session, API_KEY, null);
      write(local, REMEMBER_KEY, 'false');
    },
  };
}
