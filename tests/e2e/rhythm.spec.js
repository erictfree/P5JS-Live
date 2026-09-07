import { test, expect } from '@playwright/test';
import { rhythmSamples, waveFile } from '../fixtures/rhythm-audio.js';
async function openAudio(page) {
  await page.goto('/live/');
  await page.getByRole('button', { name: 'Start silent' }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Backslash');
  await page.locator('#tools-tab-audio').click();
}

test('timing menu stays stable during meter updates and dismisses on outside click', async ({ page }) => {
  await openAudio(page);
  await page.locator('#rhythm-tap').click();
  const source = page.locator('#rhythm-source');
  await expect(source).toHaveValue('manual');
  await source.click();
  await expect.poll(() => source.evaluate(select => select.matches(':open'))).toBe(true);
  // Observe several real meter ticks with the native menu open. Rewriting even
  // unchanged option text/attributes can keep macOS rebuilding the popup.
  const mutations = await page.evaluate(() => new Promise(resolve => {
    const select = document.getElementById('rhythm-source');
    const phase = document.getElementById('rhythm-phase');
    let ticks = 0, menuChanges = 0;
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.target === phase) ticks++;
        else menuChanges++;
      }
      if (ticks >= 8) { observer.disconnect(); resolve(menuChanges); }
    });
    observer.observe(select, { subtree: true, childList: true, attributes: true, characterData: true });
    observer.observe(phase, { attributes: true, attributeFilter: ['value'] });
  }));
  expect(mutations).toBe(0);
  await page.locator('#rhythm-bpm').click();
  await expect.poll(() => source.evaluate(select => select.matches(':open'))).toBe(false);
  await expect(page.locator('#rhythm-bpm')).toBeFocused();
  await expect(page.locator('#side')).not.toHaveClass(/is-hidden/);
  await expect(source).toHaveValue('manual');
  // macOS native menus do not receive Playwright's synthetic key events (also
  // verified on a plain select). Check that Astra leaves Escape's default action
  // intact if it reaches the page, and verify choices through selectOption.
  await source.focus();
  expect(await source.evaluate(select => select.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, cancelable: true,
  })))).toBe(true);
  await expect(page.locator('#side')).not.toHaveClass(/is-hidden/);
  await source.selectOption('off');
  await expect.poll(() => page.evaluate(() => p5jsLive.rhythm.settings().source)).toBe('off');
  await source.selectOption('manual');
  await expect.poll(() => page.evaluate(() => p5jsLive.rhythm.settings().source)).toBe('manual');
});

test('Auto is available normally and algorithm menu stays stable and applies recalled settings after blur', async ({ page }) => {
  await openAudio(page);
  const source = page.locator('#rhythm-source');
  await expect(page.locator('#rhythm-auto-options')).toBeHidden();
  await source.selectOption('auto');
  const algorithm = page.locator('#rhythm-algorithm');
  await expect(algorithm).toHaveValue('plp');
  await algorithm.click();
  await expect.poll(() => algorithm.evaluate(select => select.matches(':open'))).toBe(true);
  const changes = await page.evaluate(() => new Promise(resolve => {
    const select = document.getElementById('rhythm-algorithm');
    const phase = document.getElementById('rhythm-phase');
    let ticks = 0, changes = 0;
    const observer = new MutationObserver(records => {
      for (const record of records) record.target === phase ? ticks++ : changes++;
      if (ticks >= 8) { observer.disconnect(); resolve(changes); }
    });
    observer.observe(select, { subtree: true, childList: true, attributes: true, characterData: true });
    observer.observe(phase, { attributes: true });
  }));
  expect(changes).toBe(0);
  await page.locator('#rhythm-bpm').click();
  await expect.poll(() => algorithm.evaluate(select => select.matches(':open'))).toBe(false);
  await algorithm.focus();
  await page.evaluate(() => p5jsLive.rhythm.configure({ algorithm: 'grid' }));
  await expect(algorithm).toHaveValue('plp');
  await algorithm.press('Tab');
  await expect(algorithm).toHaveValue('grid');
  await expect(page.locator('#rhythm-algorithm-help')).toContainText('detected hits');
  await source.selectOption('manual');
  await expect(page.locator('#rhythm-auto-options')).toBeHidden();
});

test('manual timing, editor focus, Motion Lab, and settings survive reload', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await openAudio(page);
  await page.locator('#rhythm-bpm').fill('123'); await page.locator('#rhythm-bpm').press('Tab');
  await expect.poll(() => page.evaluate(() => p5jsLive.rhythm.settings().bpm)).toBe(123);
  await expect(page.locator('#rhythm-source')).toHaveValue('manual');
  await page.locator('#rhythm-half').click();
  await expect.poll(() => page.evaluate(() => p5jsLive.rhythm.settings().bpm)).toBe(61.5);
  await page.locator('#rhythm-double').click();
  await page.locator('#run-motion-lab').click();
  await expect.poll(() => page.evaluate(() => p5jsLive.registry.activeSceneName())).toBe('motionLab');
  await expect.poll(() => page.evaluate(() => p5jsLive.registry.listStrategies().filter(r => r.status === 'failed').length)).toBe(0);
  // Reading values from the console uses the latest host sample, without advancing.
  const values = await page.evaluate(() => {
    const env = p5jsLive.evaluator.binding('motionEnvelope');
    return [env(), env()];
  });
  expect(values[0]).toBe(values[1]);
  await page.keyboard.press('Escape');
  await page.keyboard.down('h');
  await expect.poll(() => page.evaluate(() => p5jsLive.evaluator.binding('motionEnvelope')())).toBeGreaterThan(0.5);
  await expect.poll(() => page.evaluate(() => p5jsLive.evaluator.binding('motionSteps')())).toBe(0.2);
  await page.keyboard.up('h');
  await page.evaluate(() => p5jsLive.projectStore.save(p5jsLive.editor.value));
  await page.reload();
  await expect.poll(() => page.evaluate(() => p5jsLive.rhythm.settings())).toMatchObject({ source: 'manual', bpm: 123 });
  await expect.poll(() => page.evaluate(() => p5jsLive.registry.activeSceneName())).toBe('motionLab');
  expect(errors).toEqual([]);
});

test('Motion Lab demonstrates lag and held ADSR on desktop and compact canvases', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await openAudio(page);
  await page.locator('#run-motion-lab').click();
  await expect.poll(() => page.evaluate(() => p5jsLive.registry.activeSceneName())).toBe('motionLab');
  if (await page.locator('#first-edit-dismiss').isVisible()) await page.locator('#first-edit-dismiss').click();
  await page.locator('#tools-close').click();
  await page.keyboard.press('Escape'); await page.keyboard.press('e');
  await expect(page.locator('#code-layer')).toHaveCSS('opacity', '0');
  for (const [width, height, label] of [[1280, 720, 'desktop'], [390, 844, 'compact']]) {
    await page.setViewportSize({ width, height });
    await page.keyboard.down('h');
    await expect.poll(() => page.evaluate(() => p5jsLive.evaluator.binding('motionHeldEnvelope')())).toBeCloseTo(0.55, 4);
    const lag = await page.evaluate(() => {
      const signal = p5jsLive.evaluator.binding('motionLag');
      return [signal(), signal()];
    });
    expect(lag[0]).toBe(lag[1]); expect(lag[0]).toBeGreaterThanOrEqual(0.25); expect(lag[0]).toBeLessThanOrEqual(1);
    await expect.poll(() => page.evaluate(() => p5jsLive.registry.listStrategies().filter(r => r.lastError).length)).toBe(0);
    await page.screenshot({ path: `/tmp/astra-motion-signals-${label}.png` });
    await page.keyboard.up('h');
    await expect.poll(() => page.evaluate(() => p5jsLive.evaluator.binding('motionHeldEnvelope')())).toBe(0);
  }
  expect(errors).toEqual([]);
});

test('both automatic algorithms track real PCM, switch live, persist selection, and release the source', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await openAudio(page);
  await page.evaluate(() => {
    const original = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when = 0, offset = 0, ...rest) {
      if (Math.abs(this.buffer?.duration - 50) < 0.01) {
        window.__fixtureStart = { at: Math.max(when, this.context.currentTime), offset };
        AudioBufferSourceNode.prototype.start = original;
      }
      return original.call(this, when, offset, ...rest);
    };
  });
  await page.locator('#audio-file-2').setInputFiles({ name: 'pulse-123.wav', mimeType: 'audio/wav', buffer: waveFile(rhythmSamples({ bpm: 123, seconds: 50 })) });
  await expect.poll(() => page.evaluate(() => p5jsLive.audio.status().playing)).toBe(true);
  await page.locator('#rhythm-source').selectOption('auto');
  for (const algorithm of ['plp', 'grid', 'plp']) {
    await page.locator('#rhythm-algorithm').selectOption(algorithm);
    await expect.poll(() => page.evaluate(() => p5jsLive.rhythm.snapshot().status), { timeout: 14000 }).toBe('running');
    expect(await page.evaluate(() => Math.abs(p5jsLive.rhythm.snapshot().bpm - 123))).toBeLessThan(2.46);
    // Check the visible beat light against known PCM beat positions after phase
    // correction settles, not just the worker's retrospective beat timestamps.
    const errors = await page.evaluate(() => new Promise(resolve => {
      const button = document.getElementById('toolbar-tap');
      const start = performance.now(), errors = [];
      const observer = new MutationObserver(() => {
        if (!button.classList.contains('is-beating') || performance.now() - start < 1500) return;
        // Use the native PCM start; p5/Tone may schedule playback ahead of the
        // UI's reported start position. Neither worker output nor UI time is ground truth.
        const position = p5.prototype.getAudioContext().currentTime - window.__fixtureStart.at + window.__fixtureStart.offset;
        const beat = (position - 0.25) * 123 / 60;
        errors.push(Math.abs(beat - Math.round(beat)) * 60 / 123);
        if (errors.length === 3) { observer.disconnect(); resolve(errors); }
      });
      observer.observe(button, { attributes: true, attributeFilter: ['class'] });
    }));
    console.log(`${algorithm} visible beat timing errors (ms): ${errors.map(e => (e * 1000).toFixed(1)).join(', ')}`);
    expect([...errors].sort((a, b) => a - b)[1]).toBeLessThan(0.09);
  }
  await page.locator('#rhythm-algorithm').selectOption('grid');
  await page.evaluate(() => p5jsLive.audio.useSilence());
  await expect.poll(() => page.evaluate(() => p5jsLive.rhythm.snapshot().running)).toBe(false);
  await page.locator('#rhythm-source').selectOption('manual');
  await expect.poll(() => page.evaluate(() => p5jsLive.rhythm.snapshot().running)).toBe(true);
  await page.evaluate(() => p5jsLive.projectStore.save(p5jsLive.editor.value));
  await page.reload();
  await expect.poll(() => page.evaluate(() => p5jsLive.rhythm.settings())).toMatchObject({ source: 'manual', algorithm: 'grid' });
  expect(errors).toEqual([]);
});

test('tap shortcut leaves typing alone and button Space does not toggle audio', async ({ page }) => {
  await page.goto('/live/');
  await page.getByRole('button', { name: 'Start silent' }).click();
  await page.keyboard.press('Control+Backslash'); await page.locator('#tools-tab-audio').click();
  await expect(page.locator('#rhythm-source option[value="auto"]')).toHaveJSProperty('disabled', false);
  await page.locator('#rhythm-bpm').focus(); await page.keyboard.press('t');
  expect(await page.evaluate(() => p5jsLive.rhythm.settings().source)).toBe('off');
  await page.locator('#rhythm-tap').focus();
  await page.evaluate(() => { window.__toggleCalls = 0; p5jsLive.audio.toggle = () => { window.__toggleCalls++; }; });
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => p5jsLive.rhythm.settings().source)).toBe('manual');
  expect(await page.evaluate(() => window.__toggleCalls)).toBe(0);
  expect(await page.evaluate(() => ['lfo', 'envelope', 'lag', 'ramp', 'sequence', 'remap', 'variation'].filter(name => name in p5.prototype))).toEqual([]);
});

test('Space taps on keydown, Shift+Space controls playback, and navigation keeps Tap available', async ({ page }) => {
  await page.goto('/live/');
  await page.getByRole('button', { name: 'Start silent' }).click();
  const tap = page.locator('#toolbar-tap');
  await expect(tap).toBeVisible();
  await expect(tap).toContainText('Space');
  await expect(page.locator('#toolbar-bpm')).toBeHidden();
  await expect(page.locator('#projection-open')).toHaveCount(0);
  await page.evaluate(() => {
    window.__taps = 0; window.__playbackToggles = 0;
    const original = p5jsLive.rhythm.tap;
    p5jsLive.rhythm.tap = (...args) => { window.__taps++; return original(...args); };
    p5jsLive.audio.toggle = () => { window.__playbackToggles++; };
  });
  const counts = () => page.evaluate(() => [window.__taps, window.__playbackToggles]);
  const code = page.getByRole('textbox', { name: 'Edit patch myPatch', exact: true });
  await code.press('End');
  const before = await code.inputValue();
  await code.press('Space');
  expect((await code.inputValue()).length).toBe(before.length + 1);
  expect(await counts()).toEqual([0, 0]);
  await code.press('Escape');

  await page.keyboard.down('Space');
  expect(await counts()).toEqual([1, 0]); // No keyup needed to register the beat.
  await page.keyboard.down('Space'); // An OS key repeat must not become a tap.
  await page.keyboard.up('Space');
  expect(await counts()).toEqual([1, 0]);
  await expect(page.locator('#toolbar-bpm')).toBeVisible();
  await page.keyboard.press('Shift+Space');
  expect(await counts()).toEqual([1, 1]);
  await page.keyboard.press('t');
  expect(await counts()).toEqual([2, 1]);

  await tap.focus();
  await page.keyboard.down('Space');
  expect(await counts()).toEqual([3, 1]);
  await page.keyboard.down('Space'); await page.keyboard.up('Space');
  expect(await counts()).toEqual([3, 1]); // Suppress the native keyup click too.
  await page.keyboard.down('Enter'); await page.keyboard.down('Enter'); await page.keyboard.up('Enter');
  expect(await counts()).toEqual([4, 1]);
  await tap.click();
  expect(await counts()).toEqual([5, 1]);

  await page.locator('#tools-toggle').click();
  await page.locator('#tools-tab-audio').click();
  await page.locator('#rhythm-bpm').focus();
  await page.keyboard.press('Space'); await page.keyboard.press('Shift+Space');
  expect(await counts()).toEqual([5, 1]);
  await page.locator('#rhythm-source').selectOption('off');
  await expect(page.locator('#toolbar-bpm')).toBeHidden();
  await expect(tap).toBeVisible();
  await page.locator('#tools-close').click();
  await code.press('Escape');
  await page.keyboard.press('n');
  await expect(tap).toBeHidden();
  await page.keyboard.press('Space');
  expect(await counts()).toEqual([6, 1]);
  await page.keyboard.press('n');
  await expect(tap).toBeVisible();

  // Projection is still accessible by keyboard after removing its nav button.
  const popup = page.waitForEvent('popup');
  await page.keyboard.press('p');
  const audience = await popup;
  await expect.poll(() => page.evaluate(() => p5jsLive.projection.isOpen())).toBe(true);
  await audience.close();
  await page.screenshot({ path: '/tmp/astra-tap-navigation.png' });
});

test('Tap flashes briefly on each clock beat at slow and fast tempos, then stops with timing Off', async ({ page }) => {
  await openAudio(page);
  for (const bpm of [60, 240]) {
    const pulses = await page.evaluate(bpm => new Promise(resolve => {
      const nav = document.getElementById('toolbar-tap');
      const panel = document.getElementById('rhythm-tap');
      const dot = document.getElementById('rhythm-clock-dot');
      const pulses = []; let started = null;
      const observer = new MutationObserver(() => {
        const lit = nav.classList.contains('is-beating');
        if (lit && started === null) {
          const clock = p5jsLive.rhythm.snapshot();
          started = performance.now();
          pulses.push({ start: started, phase: clock.phase,
            panelLit: panel.classList.contains('is-beating'), dotLit: dot.classList.contains('lit'),
            navColor: getComputedStyle(nav).backgroundColor, panelColor: getComputedStyle(panel).backgroundColor });
        } else if (!lit && started !== null) {
          pulses.at(-1).duration = performance.now() - started;
          started = null;
          if (pulses.length === 3) { observer.disconnect(); resolve(pulses); }
        }
      });
      observer.observe(nav, { attributes: true, attributeFilter: ['class'] });
      p5jsLive.rhythm.configure({ source: 'manual', bpm });
      p5jsLive.rhythm.align();
    }), bpm);
    for (const [index, pulse] of pulses.entries()) {
      expect(pulse.phase).toBeLessThan(0.2);
      expect(pulse.panelLit && pulse.dotLit).toBe(true);
      expect(pulse.navColor).toBe('rgb(255, 180, 94)');
      expect(pulse.panelColor).toBe(pulse.navColor);
      expect(pulse.duration).toBeGreaterThan(40);
      expect(pulse.duration).toBeLessThan(140);
      if (index) expect(Math.abs(pulse.start - pulses[index - 1].start - 60000 / bpm)).toBeLessThan(70);
    }
  }
  await page.locator('#rhythm-source').selectOption('off');
  await expect(page.locator('#rhythm-status')).toHaveText('Off');
  expect(await page.evaluate(() => new Promise(resolve => {
    const until = performance.now() + 600; let lit = false;
    function sample() {
      lit ||= Boolean(document.querySelector('#toolbar-tap.is-beating, #rhythm-tap.is-beating'));
      if (performance.now() < until) requestAnimationFrame(sample);
      else resolve(lit);
    }
    sample();
  }))).toBe(false);
});

test('discarded signal definitions can be collected after repeated live edits', async ({ page, context }) => {
  await openAudio(page);
  await page.evaluate(() => {
    for (let i = 0; i < 100; i++) {
      p5jsLive.evaluator.evaluate(`const temporarySignal = envelope({release: ${0.1 + i / 100}});`);
      p5jsLive.evaluator.applyPending();
    }
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  await expect.poll(() => page.evaluate(() => p5jsLive.evaluator.signals.count())).toBeLessThan(5);
  await cdp.detach();
});

test('Pulse analysis keeps the same scene within the frame-time budget', async ({ page }) => {
  await openAudio(page);
  await page.locator('#audio-file-2').setInputFiles({ name: 'pulse-123.wav', mimeType: 'audio/wav', buffer: waveFile(rhythmSamples({ bpm: 123, seconds: 30 })) });
  await page.locator('#run-motion-lab').click();
  await expect.poll(() => page.evaluate(() => p5jsLive.registry.activeSceneName())).toBe('motionLab');
  if (await page.locator('#first-edit-dismiss').isVisible()) await page.locator('#first-edit-dismiss').click();
  await page.locator('#tools-close').click();
  await page.keyboard.press('e');
  await expect(page.locator('#code-layer')).toHaveCSS('opacity', '0');
  expect(await page.evaluate(() => window.scrollX)).toBe(0);
  async function sample() {
    return page.evaluate(() => new Promise(resolve => {
      const times = []; let previous = null, warmup = 10;
      const original = p5jsLive.host.beginFrame;
      // Count actual p5 render frames, not every 120 Hz display refresh callback.
      p5jsLive.host.beginFrame = (...args) => {
        const now = performance.now();
        if (previous !== null && warmup-- <= 0) times.push(now - previous);
        previous = now;
        if (times.length === 120) {
          p5jsLive.host.beginFrame = original;
          times.sort((a, b) => a - b); resolve(times[60]);
        }
        return original(...args);
      };
    }));
  }
  const off = await sample();
  await page.evaluate(() => p5jsLive.rhythm.configure({ source: 'auto' }));
  await expect.poll(() => page.evaluate(() => p5jsLive.rhythm.snapshot().status), { timeout: 14000 }).toBe('running');
  const auto = await sample();
  await page.screenshot({ path: '/tmp/astra-motion-lab.png' });
  expect(auto).toBeLessThanOrEqual(off * 1.05);
  console.log(`Pulse frame time: Off ${off.toFixed(2)} ms; Auto ${auto.toFixed(2)} ms`);
});

test('Rhythm controls fit compact Tools without horizontal page scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAudio(page);
  await page.locator('#rhythm-source').selectOption('auto');
  await expect(page.locator('#rhythm-algorithm')).toBeInViewport();
  const tap = await page.locator('#toolbar-tap').boundingBox();
  expect(tap.x).toBeGreaterThanOrEqual(0);
  expect(tap.x + tap.width).toBeLessThanOrEqual(390);
  await page.locator('#rhythm-tap').scrollIntoViewIfNeeded();
  const bounds = await page.locator('.rhythm-controls').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => window.scrollX)).toBe(0);
  expect(await page.locator('#app').evaluate(app => app.scrollLeft)).toBe(0);
  await page.screenshot({ path: '/tmp/astra-rhythm-panel.png' });
  await page.locator('#tools-close').click();
  await expect(page.locator('#side')).not.toBeInViewport();
  await expect(page.locator('#toolbar-tap')).toBeInViewport();
  await page.screenshot({ path: '/tmp/astra-tap-compact.png' });
});
