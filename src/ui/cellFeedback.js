import { findBlocks, describeBlock } from '../language/sourceBlocks.js';

const keyOf = (text) => describeBlock(text).replace(/^strategy\s+/, 'patch ');
const clean = (text) => text.trim();

/** Source receipts belong to the editor; the runtime remains authoritative for Live. */
export function createCellFeedback() {
  const accepted = new Map();
  const receipts = new Map();
  const runtimeSources = new Map();
  let pending = [];
  let runtime = { strategies: [], scene: { name: null } };

  function remember(source) {
    for (const block of findBlocks(source)) accepted.set(keyOf(block.text), clean(block.text));
  }

  function start(source, result) {
    const cells = findBlocks(source).map((block) => ({ key: keyOf(block.text), source: clean(block.text) }));
    const receipt = {
      cells, frames: 0, staged: result.staged ?? [],
      completion: result.completion,
      state: result.ok ? 'pending' : 'error',
      message: result.ok ? 'Checking next frame…' : `Couldn’t apply: ${result.error?.message ?? 'Check this cell'}. Replacement not applied.`,
    };
    for (const cell of cells) receipts.set(cell.key, { ...cell, receipt });
    if (result.ok && result.phase === 'executed') {
      receipt.state = 'success';
      receipt.message = 'Evaluated';
      remember(source);
    } else if (result.ok) pending.push(receipt);
    return receipt;
  }

  function updateRuntime(snapshot) {
    runtime = snapshot;
    for (const patch of snapshot.strategies) {
      if (!patch.pending && patch.version > 0 && patch.source && runtimeSources.get(patch.name) !== patch.source) {
        runtimeSources.set(patch.name, patch.source);
        remember(patch.source);
      }
    }
    for (const name of runtimeSources.keys()) {
      if (!snapshot.strategies.some((patch) => patch.name === name)) runtimeSources.delete(name);
    }
  }

  function frame(snapshot) {
    updateRuntime(snapshot);
    for (const receipt of pending) {
      if (++receipt.frames < 2) continue;
      const records = receipt.staged.map((name) => snapshot.strategies.find((patch) => patch.name === name));
      const failed = records.find((patch) => patch?.lastError &&
        (!receipt.completion || patch.lastError.version === receipt.completion.versions[patch.name]));
      if (failed) {
        receipt.state = 'error';
        receipt.message = `Couldn’t apply: ${failed.lastError.message}. ` +
          (failed.version > 0 ? 'Previous working code retained.' : 'Candidate did not complete its first frame.');
      } else if ((receipt.completion && receipt.completion.status !== 'applied') || records.some((patch) =>
        !patch || patch.pending || (receipt.completion && patch.version !== receipt.completion.versions[patch.name]))) {
        // An interrupted/replaced evaluation must never be reported as applied.
        receipt.state = 'error';
        receipt.message = 'Evaluation was superseded. Review this cell and run again.';
      } else {
        receipt.state = receipt.error ? 'warning' : 'success';
        receipt.message = receipt.error ? `Applied. Lifecycle warning: ${receipt.error}` : 'Applied';
        for (const cell of receipt.cells) {
          if (receipts.get(cell.key)?.receipt === receipt) accepted.set(cell.key, cell.source);
        }
      }
    }
    pending = pending.filter((receipt) => receipt.frames < 2);
  }

  function error(name, error) {
    for (const receipt of pending) {
      if (!receipt.staged.includes(name)) continue;
      receipt.error = error?.message ?? String(error);
    }
  }

  function status(text) {
    const key = keyOf(text);
    const name = key.replace(/^(?:patch|scene)\s+/, '');
    const patch = runtime.strategies.find((entry) => entry.name === name);
    const live = key.startsWith('scene ') ? runtime.scene.name === name : Boolean(patch?.running);
    const value = clean(text);
    const saved = accepted.get(key);
    const entry = receipts.get(key);
    const receipt = entry?.source === value ? entry.receipt : null;
    const edited = saved !== undefined ? saved !== value : true;
    const runtimeError = patch?.status === 'failed' ? patch.lastError?.message : null;
    const message = runtimeError ? `Runtime error: ${runtimeError}` : receipt?.message ?? (edited ? 'Changes are not running yet' : '');
    return {
      live, edited,
      state: runtimeError ? 'error' : receipt?.state ?? (edited ? 'edited' : 'ready'),
      label: [live ? 'Live' : patch?.active ? 'Active' : patch ? 'Installed' : 'Source', edited ? 'Edited' : '', runtimeError ? 'Error' : ''].filter(Boolean).join(' · '),
      message,
    };
  }

  return {
    start, frame, error, status, remember, updateRuntime,
    hasPending: () => pending.length > 0,
  };
}
