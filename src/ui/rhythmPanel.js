// Rhythm UI only receives controller snapshots and actions.
export function createRhythmPanel(controller) {
  const el = id => document.getElementById(id);
  const preview = new URLSearchParams(location.search).get('tempoPreview') === '1';
  let localError = '';
  function action(fn) {
    try { fn(); localError = ''; }
    catch (error) { localError = error.message; }
    render(controller.performanceSnapshot());
  }
  el('rhythm-source').addEventListener('change', event => action(() => controller.actions.setRhythm({ source: event.target.value })));
  el('rhythm-bpm').addEventListener('change', event => action(() => controller.actions.setRhythm({ source: 'manual', bpm: Number(event.target.value) })));
  for (const id of ['rhythm-tap', 'toolbar-tap']) el(id).addEventListener('click', () => action(() => controller.actions.tapTempo()));
  el('rhythm-half').addEventListener('click', () => action(() => controller.actions.multiplyTempo(0.5)));
  el('rhythm-double').addEventListener('click', () => action(() => controller.actions.multiplyTempo(2)));
  el('rhythm-align').addEventListener('click', () => action(() => controller.actions.alignBeat()));
  let lastHitAt = 0;
  function render(live) {
    if (!live.clock || !live.rhythmSettings) return;
    const clock = live.clock, settings = live.rhythmSettings;
    const autoOption = el('rhythm-source').querySelector('[value="auto"]');
    autoOption.disabled = !preview && settings.source !== 'auto';
    autoOption.textContent = preview || settings.source === 'auto' ? 'Auto · experimental' : 'Auto · in validation';
    if (document.activeElement !== el('rhythm-source')) el('rhythm-source').value = settings.source;
    if (document.activeElement !== el('rhythm-bpm')) el('rhythm-bpm').value = settings.source === 'auto' ? (clock.bpm?.toFixed(1) ?? '') : settings.bpm.toFixed(1);
    el('rhythm-bpm').placeholder = 'Listening';
    const labels = { off: 'Off', listening: 'Listening', running: settings.source === 'auto' ? 'Tracking' : 'Manual', holding: 'Holding', lost: 'Lost' };
    const label = labels[clock.status];
    if (el('rhythm-status').textContent !== label) el('rhythm-status').textContent = label;
    el('rhythm-quality').hidden = settings.source !== 'auto';
    el('rhythm-quality').value = clock.confidence ?? 0;
    el('rhythm-clock-dot').classList.toggle('lit', clock.running && clock.phase < 0.18);
    if (live.audio?.onset) lastHitAt = performance.now();
    el('rhythm-onset-dot').classList.toggle('lit', performance.now() - lastHitAt < 110);
    el('rhythm-phase').value = clock.phase;
    el('rhythm-align').disabled = !clock.running;
    el('rhythm-error').textContent = localError || live.rhythmError || (settings.source === 'auto' ? 'Experimental tracking: may lose the pulse or choose a different tempo. Tap to take over.' : '');
    el('rhythm-error').hidden = !el('rhythm-error').textContent;
    el('toolbar-rhythm').hidden = settings.source === 'off';
    el('toolbar-bpm').textContent = clock.bpm ? `${clock.bpm.toFixed(1)} BPM` : label;
    el('rhythm-multiplier').textContent = settings.source === 'auto' && settings.multiplier !== 1 ? `×${settings.multiplier}` : '';
  }
  return { render };
}
