// Startup recovery for a locally saved source buffer.
//
// A normal full-buffer evaluation is atomic. That is ideal during a performance, but
// on page load there is no previous runtime to preserve. If one saved cell is broken,
// recover the other independent cells and guarantee a small visible scene instead of
// leaving the registry empty while audio continues on its own.

import { findBlocks } from '../language/sourceBlocks.js';

export function evaluateStartupProject({
  source,
  label,
  starterSource,
  evaluator,
  registry,
  stateStore,
  host,
}) {
  const result = evaluator.evaluate(source, { label });
  if (result.ok) {
    evaluator.applyPending();
    return { ok: true, recovered: false, failedBlocks: [], fallback: null };
  }

  evaluator.discardPending();
  evaluator.clearBindings();
  host.reset();
  registry.reset();
  stateStore.clear();

  const failedBlocks = [];
  for (const [index, block] of findBlocks(source).entries()) {
    const blockLabel = block.label || `saved block ${index + 1}`;
    const blockResult = evaluator.evaluate(block.text, { label: blockLabel });
    if (blockResult.ok) evaluator.applyPending();
    else failedBlocks.push(blockLabel);
  }

  let fallback = null;
  if (registry.activeSceneName() === null) {
    if (registry.hasStrategy('plasma')) {
      fallback = 'recovery';
      const recoveryScene = `// %% scene recovery
const recovery = [plasma];
recovery.draw();`;
      const recoveryResult = evaluator.evaluate(recoveryScene, { label: 'recovery scene' });
      if (recoveryResult.ok) evaluator.applyPending();
    } else {
      fallback = 'starter';
      const starterResult = evaluator.evaluate(starterSource, { label: 'recovery starter' });
      if (starterResult.ok) evaluator.applyPending();
    }
  }

  return {
    ok: registry.activeSceneName() !== null,
    recovered: true,
    failedBlocks,
    fallback,
  };
}
