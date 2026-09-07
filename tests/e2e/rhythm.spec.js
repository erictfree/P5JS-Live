import { test, expect } from '@playwright/test';
import { rhythmSamples, waveFile } from '../fixtures/rhythm-audio.js';
async function openAudio(page) {
  await page.goto('/live/?tempoPreview=1');
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

test('timing menu applies a changed Auto gate after focus leaves', async ({ page }) => {
  await page.goto('/live/');
  await page.getByRole('button', { name: 'Start silent' }).click();
  await page.keyboard.press('Control+Backslash'); await page.locator('#tools-tab-audio').click();
  // Model recalling a previously saved Auto performance, then Manual, while
  // timing has focus. Deferred rendering must not leave the old choice behind.
  await page.evaluate(() => p5jsLive.rhythm.configure({ source: 'auto' }));
  const source = page.locator('#rhythm-source');
  const auto = source.locator('option[value="auto"]');
  await expect(source).toHaveValue('auto');
  await expect(auto).toHaveJSProperty('disabled', false);
  await source.focus();
  await page.evaluate(() => p5jsLive.rhythm.configure({ source: 'manual' }));
  await expect(page.locator('#rhythm-status')).toHaveText('Manual');
  await expect(auto).toHaveJSProperty('disabled', false);
  await source.press('Tab');
  await expect(source).toHaveValue('manual');
  await expect(auto).toHaveJSProperty('disabled', true);
  await expect(auto).toHaveText('Auto · in validation');
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

test('automatic tracking uses actual audio samples and releases the source cleanly', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await openAudio(page);
  await page.locator('#audio-file-2').setInputFiles({ name: 'pulse-123.wav', mimeType: 'audio/wav', buffer: waveFile(rhythmSamples({ bpm: 123, seconds: 20 })) });
  await expect.poll(() => page.evaluate(() => p5jsLive.audio.status().playing)).toBe(true);
  await page.locator('#rhythm-source').selectOption('auto');
  await expect.poll(() => page.evaluate(() => p5jsLive.rhythm.snapshot().status), { timeout: 14000 }).toBe('running');
  expect(await page.evaluate(() => Math.abs(p5jsLive.rhythm.snapshot().bpm - 123))).toBeLessThan(2.46);
  await page.evaluate(() => p5jsLive.audio.useSilence());
  await expect.poll(() => page.evaluate(() => p5jsLive.rhythm.snapshot().running)).toBe(false);
  await page.locator('#rhythm-source').selectOption('manual');
  await expect.poll(() => page.evaluate(() => p5jsLive.rhythm.snapshot().running)).toBe(true);
  expect(errors).toEqual([]);
});

test('tap shortcut leaves typing alone, button Space does not toggle audio, and normal Auto is gated', async ({ page }) => {
  await page.goto('/live/');
  await page.getByRole('button', { name: 'Start silent' }).click();
  await page.keyboard.press('Control+Backslash'); await page.locator('#tools-tab-audio').click();
  await expect(page.locator('#rhythm-source option[value="auto"]')).toHaveJSProperty('disabled', true);
  await page.locator('#rhythm-bpm').focus(); await page.keyboard.press('t');
  expect(await page.evaluate(() => p5jsLive.rhythm.settings().source)).toBe('off');
  await page.locator('#rhythm-tap').focus();
  await page.evaluate(() => { window.__toggleCalls = 0; p5jsLive.audio.toggle = () => { window.__toggleCalls++; }; });
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => p5jsLive.rhythm.settings().source)).toBe('manual');
  expect(await page.evaluate(() => window.__toggleCalls)).toBe(0);
  expect(await page.evaluate(() => ['lfo', 'envelope', 'ramp', 'sequence', 'remap', 'variation'].filter(name => name in p5.prototype))).toEqual([]);
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

test('preview analysis keeps the same scene within the frame-time budget', async ({ page }) => {
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
  console.log(`Tempo preview frame time: Off ${off.toFixed(2)} ms; Auto ${auto.toFixed(2)} ms`);
});

test('Rhythm controls fit compact Tools without horizontal page scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAudio(page);
  await page.locator('#rhythm-tap').scrollIntoViewIfNeeded();
  const bounds = await page.locator('.rhythm-controls').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => window.scrollX)).toBe(0);
  await page.screenshot({ path: '/tmp/astra-rhythm-panel.png' });
});
