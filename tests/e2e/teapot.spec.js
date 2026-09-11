import { test, expect } from '@playwright/test';

test('teapot example renders through an array effect, resizes, and survives rerun', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/live/');
  await page.waitForFunction(() => window.p5jsLive?.registry.activeOrder().length > 0);
  await page.evaluate(() => { document.getElementById('start-overlay').hidden = true; });
  if (await page.locator('#side').evaluate(el => el.classList.contains('is-hidden'))) await page.locator('#tools-toggle').click();
  await page.getByRole('tab', { name: /^Library/ }).click();
  await page.getByRole('button', { name: 'Run Teapot example' }).click();
  await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.getStrategy('teapotPoints')?.status)).toBe('ok');
  const lit = () => page.evaluate(() => {
    const c = document.querySelector('#stage canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i+1] > 80 && d[i+1] > d[i] * 1.5) n++;
    return n;
  });
  await expect.poll(lit).toBeGreaterThan(1000);
  await page.evaluate(() => { document.getElementById('code-layer').classList.add('is-hidden'); document.getElementById('side').classList.add('is-hidden'); });
  await page.screenshot({ path: '/tmp/teapot-example.png' });
  await page.setViewportSize({ width: 960, height: 640 });
  await expect.poll(lit).toBeGreaterThan(1000);
  // Exercise replacement/disposal through the same user action.
  await page.evaluate(() => document.getElementById('run-teapot').click());
  await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.getStrategy('teapotPoints')?.status)).toBe('ok');
  await expect.poll(lit).toBeGreaterThan(1000);
  expect(errors).toEqual([]);
});
