import { test, expect } from '@playwright/test';

async function boot(page) {
  await page.goto('/live/index.html');
  await page.evaluate(() => {
    localStorage.clear();
    document.getElementById('start-overlay').hidden = true;
  });
  await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.activeOrder().length)).toBe(2);
}

test('publishes, discovers, inserts, and receives another editor canvas', async ({ page, context }) => {
  const receiverPage = await context.newPage();
  await boot(page);
  await boot(receiverPage);

  const publishResult = await page.evaluate(() => window.p5jsLive.evaluator.evaluate(`
    const networkRoom = new StreamRoom({
      name: "e2e-room",
      performer: "Eric",
    });
    const publishMain = networkRoom.publish({ name: "main-output", fps: 20 });
    const networkScene = [plasma, publishMain];
    activate(networkScene);
  `));
  expect(publishResult.ok).toBe(true);
  await expect.poll(() => page.evaluate(() =>
    window.p5jsLive.network.snapshot().rooms[0]?.status,
  )).toBe('joined');
  await expect.poll(() => page.evaluate(() =>
    window.p5jsLive.network.snapshot().rooms[0]?.publishing[0]?.status,
  )).toBe('publishing');

  await receiverPage.evaluate(() => {
    window.p5jsLive.controller.actions.joinNetworkRoom({
      name: 'e2e-room',
      performer: 'Maya',
    });
  });
  await expect.poll(() => receiverPage.evaluate(() =>
    window.p5jsLive.network.snapshot().rooms[0]?.streams.some(
      (stream) => stream.label === 'Eric/main-output',
    ),
  )).toBe(true);

  await receiverPage.locator('#tools-toggle').click();
  // Controllers now occupies the public sixth tab. Reveal this retained beta panel
  // directly so its implementation remains covered without advertising it in the UI.
  await receiverPage.locator('[data-tool-panel]').evaluateAll((panels) => {
    for (const panel of panels) panel.hidden = panel.id !== 'network-panel';
  });
  await expect(receiverPage.locator('#network-panel')).toContainText('Eric/main-output');
  await receiverPage.getByRole('button', { name: /Add Eric\/main-output as a receiver/ }).click();
  await expect.poll(() => receiverPage.evaluate(() => window.p5jsLive.editor.value))
    .toContain('const EricMainOutput = EricMainOutputRoom.receive({');
  await expect.poll(() => receiverPage.evaluate(() =>
    window.p5jsLive.registry.activeOrder().includes('EricMainOutput'),
  )).toBe(true);
  await expect.poll(() => receiverPage.evaluate(() =>
    window.p5jsLive.evaluator.binding('EricMainOutput')?.status,
  ), { timeout: 15_000 }).toBe('live');

  await receiverPage.getByRole('button', { name: /Add Eric\/main-output as a receiver/ }).click();
  expect(await receiverPage.evaluate(() =>
    (window.p5jsLive.editor.value.match(/\/\/ %% patch EricMainOutput\n/g) ?? []).length,
  )).toBe(1);

  await receiverPage.close();
});
