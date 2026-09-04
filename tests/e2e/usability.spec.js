import { test, expect } from '@playwright/test';

async function boot(page) {
  // Each test receives a fresh browser context. Reloading here would create a
  // returning visit because the application saves its working project on unload.
  await page.goto('/live/');
  await expect(page.locator('#live-safe-status')).toHaveText('Safe state ready');
  await page.locator('#start-audio').click();
  await expect(page.locator('#first-edit-hint')).toBeVisible();
  await page.locator('#first-edit-dismiss').click();
}

test('first edit, scene identity, keyboard dimmer, and drawer focus', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#live-scene-name')).toHaveText('scene');
  await expect(page.locator('#live-layer-count')).toHaveText('2 layers');
  await expect(page.locator('#side')).toHaveAttribute('inert', '');
  await page.locator('#tools-toggle').click();
  await expect(page.locator('#side')).not.toHaveAttribute('inert');
  await expect(page.locator('#tools-toggle')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#tools-tab-library').click();
  await page.locator('#tools-tab-library').press('Escape');
  await expect(page.locator('#side')).toHaveAttribute('inert', '');
  await expect(page.locator('#tools-toggle')).toBeFocused();
  await page.keyboard.press('n');
  await expect(page.locator('#icons')).toBeHidden();
  await expect(page.locator('#icons')).toHaveAttribute('inert', '');
  await page.keyboard.press('n');
  await expect(page.locator('#icons')).toBeVisible();
  await expect(page.locator('#icons')).not.toHaveAttribute('inert');
  await expect(page.locator('#visual-dimmer-toggle')).toHaveCount(0);
  await page.keyboard.press('d');
  await expect(page.locator('#visual-dimmer')).toBeVisible();
  await page.keyboard.press('d');
  await expect(page.locator('#visual-dimmer')).toBeHidden();
  await page.locator('#live-scene').click();
  await expect(page.locator('[data-block-description="scene scene"]')).toHaveAttribute('open', '');
  await page.reload();
  await page.locator('#start-audio').click();
  await expect(page.locator('#first-edit-hint')).toBeHidden();
});

test('cell Run preserves previous visuals on syntax and first-frame failures', async ({ page }) => {
  await boot(page);
  const cell = page.locator('[data-block-description="patch plasma"]');
  const input = cell.locator('textarea');
  const before = await input.inputValue();
  await input.fill(before.replace('speed = 0.35', 'speed = 0.7'));
  await expect(cell.locator('.cell-status')).toContainText('Edited');
  await cell.getByRole('button', { name: 'Run patch plasma', exact: true }).click();
  await expect(cell.locator('.cell-feedback')).toHaveText('Applied');
  await expect(cell.locator('.cell-status')).toHaveText('Live');
  const version = await page.evaluate(() => window.p5jsLive.registry.getStrategy('plasma').version);

  await input.fill('const plasma = { draw() { throw new Error("usability rollback"); } };');
  await cell.getByRole('button', { name: 'Run patch plasma', exact: true }).click();
  await expect(cell.locator('.cell-feedback')).toContainText('usability rollback');
  await expect(cell.locator('.cell-status')).toContainText('Edited');
  expect(await page.evaluate(() => window.p5jsLive.registry.getStrategy('plasma').version)).toBe(version);

  await input.fill('const plasma = {');
  await cell.getByRole('button', { name: 'Run patch plasma', exact: true }).click();
  await expect(cell.locator('.cell-feedback')).toContainText('Couldn’t apply');
  expect(await page.evaluate(() => window.p5jsLive.registry.getStrategy('plasma').version)).toBe(version);
  await page.locator('#panic').click();
  await expect(page.locator('#live-scene-name')).toHaveText('scene');
});

test('library addition reviews source before activation', async ({ page }) => {
  await boot(page);
  await page.locator('#tools-toggle').click();
  await page.locator('#tools-tab-library').click();
  const row = page.locator('[data-library="waveScope"]');
  await expect(row.locator('button')).toHaveText('Install source');
  await row.locator('button').click();
  await expect(row.locator('button')).toHaveText('Add to scene…');
  await row.locator('button').click();
  await expect(page.locator('#live-layer-count')).toHaveText('2 layers');
  await expect(row.locator('button')).toHaveText('Review scene & run');
  await row.locator('button').click();
  const scene = page.locator('[data-block-description="scene scene"]');
  await expect(scene.locator('.cell-status')).toContainText('Edited');
  await scene.getByRole('button', { name: 'Run scene scene', exact: true }).click();
  await expect(page.locator('#live-layer-count')).toHaveText('3 layers');
  await expect(scene.locator('.cell-feedback')).toHaveText('Applied');
  await expect(row.locator('button')).toHaveText('Edit source');
  await expect(row.locator('button')).toBeEnabled();
});

test('cell Run in the complete editor applies the selected scene and respects AI staging', async ({ page }) => {
  await boot(page);
  await page.locator('#fold-code').click();
  const code = page.locator('#code');
  const before = await code.inputValue();
  await code.fill(before.replace('const scene = [', 'const scene = [\n  asciiNoise,'));
  await expect(page.locator('#current-cell-bar .cell-status')).toContainText('Edited');
  await page.locator('#current-cell-bar button').click();
  await expect(page.locator('#live-layer-count')).toHaveText('3 layers');
  await expect(page.locator('#current-cell-bar .cell-feedback')).toHaveText('Applied');

  await page.evaluate(() => {
    const editor = window.p5jsLive.editor;
    editor.stageSource(editor.value.replace('speed = 0.35', 'speed = 0.9'));
  });
  await expect(page.locator('#current-cell-bar button')).toHaveText('Accept & run all');
  await page.locator('#current-cell-bar button').click();
  await expect.poll(() => page.evaluate(() => window.p5jsLive.editor.hasStagedSource())).toBe(false);
  await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.getStrategy('plasma').definition.speed)).toBe(0.9);
});
