import { test, expect } from '@playwright/test';

test('errors stay compact and old failures are clearly a clearable history', async ({ page }) => {
  await page.goto('/live/');
  await page.waitForFunction(() => window.p5jsLive);
  await page.evaluate(() => {
    document.getElementById('start-overlay').hidden = true;
    const d = window.p5jsLive.diagnostics;
    d.clear();
    for (let i = 0; i < 4; i++) d.error('Evaluation error — scene not applied', 'ReferenceError: glitchaSlices is not defined (line 10)');
    d.success('Scene applied');
  });
  if (await page.locator('#side').evaluate(el => el.classList.contains('is-hidden'))) await page.locator('#tools-toggle').click();
  await page.getByRole('tab', { name: /^Messages/ }).click();
  await expect(page.locator('#diagnostics-list .diagnostic').first()).toContainText('Scene applied');
  await expect(page.getByText('Earlier errors remain here after a successful edit.', { exact: false })).toBeVisible();
  const rows = page.locator('#diagnostics-list .diagnostic.error');
  await expect(rows).toHaveCount(4);
  const sizes = await rows.evaluateAll(elements => elements.map(el => ({
    height: el.getBoundingClientRect().height,
    width: el.querySelector('.name').clientWidth,
  })));
  for (const size of sizes) {
    expect(size.height).toBeGreaterThan(0);
    expect(size.height).toBeLessThan(120);
    expect(size.width).toBeGreaterThan(150);
  }
  await page.screenshot({ path: '/tmp/astra-message-layout.png' });
  await page.getByRole('button', { name: 'Clear message history' }).click();
  await expect(page.locator('#diagnostics-list')).toHaveText('Nothing to report.');
  await expect(page.locator('#messages-tab-count')).toBeHidden();
});
