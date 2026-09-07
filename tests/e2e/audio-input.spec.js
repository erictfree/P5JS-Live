import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const tone = fileURLToPath(new URL('../fixtures/test-tone.wav', import.meta.url));

test.use({
  launchOptions: {
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${tone}`,
    ],
  },
});

test('microphone analysis uses native inputs and releases them without restarting the scene', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/live/');
  await expect(page.locator('#live-safe-status')).toHaveText('Safe state ready');
  await page.evaluate(() => {
    window.__micProbe = {
      context: p5.prototype.getAudioContext(),
      draw: window.draw,
      canvas: document.querySelector('#stage canvas'),
      scene: window.p5jsLive.registry.activeSceneName(),
    };
  });

  await page.locator('#start-mic').click();
  await expect(page.locator('#start-overlay')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.p5jsLive.audio.status().kind)).toBe('mic');
  await expect.poll(() => page.evaluate(() => window.p5jsLive.audio.readFrame().raw.level)).toBeGreaterThan(0);

  await page.evaluate(() => window.p5jsLive.audio.useSilence());
  expect(await page.evaluate(() => {
    const runtime = window.p5jsLive;
    return {
      kind: runtime.audio.status().kind,
      playing: runtime.audio.status().playing,
      level: runtime.audio.readFrame().raw.level,
      sameContext: window.__micProbe.context === p5.prototype.getAudioContext(),
      sameDraw: window.__micProbe.draw === window.draw,
      sameCanvas: window.__micProbe.canvas === document.querySelector('#stage canvas'),
      sameScene: window.__micProbe.scene === runtime.registry.activeSceneName(),
    };
  })).toEqual({ kind: 'none', playing: false, level: 0, sameContext: true, sameDraw: true, sameCanvas: true, sameScene: true });
  expect(errors).toEqual([]);
});
