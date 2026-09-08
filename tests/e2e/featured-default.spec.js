import { test, expect } from '@playwright/test';

test('basic starter renders in silence and responds to audio without errors', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/live/');
  await page.waitForFunction(() => window.p5jsLive?.registry.activeOrder().length > 0);
  await page.evaluate(() => { document.getElementById('start-overlay').hidden = true; });
  await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.getStrategy('myPatch')?.status)).toBe('ok');
  await expect.poll(() => page.evaluate(() => {
    const c = document.querySelector('#stage canvas');
    const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let lit = 0; for (let i = 0; i < data.length; i += 16) if (data[i] + data[i+1] + data[i+2] > 100) lit++;
    return lit;
  })).toBeGreaterThan(1000);
  await page.evaluate(() => {
    window.p5jsLive.rhythm.configure({ source: 'manual', bpm: 120 });
    document.getElementById('code-layer').classList.add('is-hidden');
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/basic-starter.png' });
  expect(await page.evaluate(() => window.p5jsLive.registry.listStrategies().some(p => p.lastError))).toBe(false);
  expect(errors).toEqual([]);
});
