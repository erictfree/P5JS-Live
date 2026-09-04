import { describe, it, expect } from 'vitest';
import { createCellFeedback } from '../../src/ui/cellFeedback.js';

const original = '// %% patch pulse\nconst pulse = { speed: 1, draw() {} };';
const edited = original.replace('speed: 1', 'speed: 2');
const scene = '// %% scene scene\nconst scene = [pulse];\nactivate(scene);';
const snapshot = (source = original, extra = {}) => ({
  strategies: [{ name: 'pulse', source, version: 1, running: true, pending: false, ...extra }],
  scene: { name: 'scene' },
});
const queued = { ok: true, phase: 'queued', staged: ['pulse'] };

describe('cell evaluation feedback', () => {
  it('distinguishes the running version from edited source', () => {
    const feedback = createCellFeedback();
    feedback.updateRuntime(snapshot());
    expect(feedback.status(original)).toMatchObject({ live: true, edited: false });
    expect(feedback.status(edited)).toMatchObject({ live: true, edited: true, label: 'Live · Edited' });
  });

  it('waits through installation and first draw before reporting Applied', () => {
    const feedback = createCellFeedback();
    feedback.updateRuntime(snapshot());
    feedback.start(edited, queued);
    feedback.frame(snapshot(edited, { pending: true, running: false }));
    expect(feedback.status(edited)).toMatchObject({ state: 'pending', edited: true });
    feedback.frame(snapshot(edited, { version: 2 }));
    expect(feedback.status(edited)).toMatchObject({ state: 'success', edited: false, message: 'Applied' });
    expect(feedback.hasPending()).toBe(false);
  });

  it('keeps a rejected first-frame edit unapplied after rollback', () => {
    const feedback = createCellFeedback();
    feedback.updateRuntime(snapshot());
    feedback.start(edited, queued);
    feedback.frame(snapshot(edited, { pending: true }));
    feedback.error('pulse', new Error('draw failed'));
    feedback.frame(snapshot(original, { lastError: { message: 'draw failed' } }));
    expect(feedback.status(edited)).toMatchObject({ live: true, edited: true, state: 'error' });
    expect(feedback.status(edited).message).toContain('draw failed');
  });

  it('does not mark text typed during a pending evaluation as applied', () => {
    const feedback = createCellFeedback();
    feedback.start(edited, queued);
    feedback.frame(snapshot(edited, { pending: true }));
    feedback.frame(snapshot(edited));
    expect(feedback.status(edited.replace('speed: 2', 'speed: 3'))).toMatchObject({ edited: true, state: 'edited' });
  });

  it('reports disposal warnings without falsely claiming the replacement was rejected', () => {
    const feedback = createCellFeedback();
    feedback.start(edited, queued);
    feedback.frame(snapshot(edited, { pending: true }));
    feedback.error('pulse', new Error('old resource cleanup failed'));
    feedback.frame(snapshot(edited, { version: 2 }));
    expect(feedback.status(edited)).toMatchObject({ edited: false, state: 'warning' });
    expect(feedback.status(edited).message).toContain('Applied. Lifecycle warning');
  });

  it('keeps scene errors separate from successful patch updates', () => {
    const feedback = createCellFeedback();
    feedback.remember(scene);
    const invalid = scene.replace('[pulse]', '[missing]');
    feedback.start(invalid, { ok: false, error: new Error('missing is not defined') });
    feedback.updateRuntime(snapshot(edited));
    expect(feedback.status(invalid)).toMatchObject({ live: true, edited: true, state: 'error' });
    expect(feedback.status(edited)).toMatchObject({ edited: false });
  });

  it('does not confirm a discarded evaluation', () => {
    const feedback = createCellFeedback();
    feedback.start(original, queued);
    const empty = { strategies: [], scene: { name: null } };
    feedback.frame(empty);
    feedback.frame(empty);
    expect(feedback.status(original)).toMatchObject({ state: 'error', edited: true });
  });

  it('does not confirm a discarded scene edit even if the old scene is still live', () => {
    const feedback = createCellFeedback();
    feedback.remember(scene);
    const changed = scene.replace('[pulse]', '[pulse, pulse]');
    feedback.start(changed, { ...queued, staged: [], completion: { status: 'discarded', versions: {} } });
    feedback.frame(snapshot());
    feedback.frame(snapshot());
    expect(feedback.status(changed)).toMatchObject({ live: true, edited: true, state: 'error' });
  });
});
