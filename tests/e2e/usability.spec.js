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
  await expect(page.getByRole('textbox', { name: 'Edit patch myPatch', exact: true })).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Edit scene scene', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const canvas = document.querySelector('#stage canvas');
    const context = canvas.getContext('2d');
    return {
      hasCircle: context.getImageData(0, canvas.height / 2, canvas.width, 1).data.some(
        (value, index, pixels) => index % 4 === 0 && value === 105 &&
          pixels[index + 1] === 224 && pixels[index + 2] === 198,
      ),
      corner: [...context.getImageData(5, 5, 1, 1).data],
    };
  })).toEqual({
    hasCircle: true,
    corner: [0, 0, 0, 255],
  });
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
  await expect(page.locator('#side')).toHaveCSS('top', '0px');
  await page.keyboard.press('n');
  await expect(page.locator('#icons')).toBeVisible();
  await expect(page.locator('#icons')).not.toHaveAttribute('inert');
  await expect(page.locator('#side')).toHaveCSS('top', '46px');
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

test('whole cells can be deleted and restored, including an empty patch header', async ({ page }) => {
  await boot(page);
  const before = await page.evaluate(() => window.p5jsLive.editor.value);
  const patch = page.locator('[data-block-description="patch myPatch"]');
  const remove = patch.getByRole('button', { name: 'Delete patch myPatch', exact: true });
  await patch.locator('summary').hover();
  await expect(remove).toBeHidden();
  expect(await page.evaluate(() => window.p5jsLive.editor.value)).toBe(before);

  // Removing a draft reference alone must not delete the still-running patch.
  await page.evaluate(() => {
    const editor = window.p5jsLive.editor;
    editor.value = editor.value.replace('  myPatch,', '  // myPatch,');
  });
  await patch.locator('summary').hover();
  await expect(remove).toBeHidden();
  await page.evaluate(() => window.p5jsLive.editor.evaluateBuffer());
  await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.activeInstancesOf('myPatch').length)).toBe(0);
  const original = await page.evaluate(() => window.p5jsLive.editor.value);
  const active = await page.evaluate(() => window.p5jsLive.registry.activeOrder());
  await patch.locator('summary').hover();
  await patch.getByRole('button', { name: 'Delete patch myPatch', exact: true }).click();
  await expect(patch).toHaveCount(0);
  await expect(page.locator('[data-block-description="scene scene"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.p5jsLive.registry.activeOrder())).toEqual(active);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await page.evaluate(() => window.p5jsLive.editor.value)).toBe(original);

  await patch.locator('summary').click();
  await patch.locator('textarea').fill('');
  const emptyPatch = await page.evaluate(() => window.p5jsLive.editor.value);
  await patch.locator('summary').hover();
  await patch.getByRole('button', { name: 'Delete patch myPatch', exact: true }).click();
  await expect(patch).toHaveCount(0);
  expect(await page.evaluate(() => window.p5jsLive.editor.value)).not.toContain('// %% patch myPatch');
  await page.keyboard.press('ControlOrMeta+z');
  expect(await page.evaluate(() => window.p5jsLive.editor.value)).toBe(emptyPatch);

  await page.locator('[data-block-description="scene scene"] summary').hover();
  await page.getByRole('button', { name: 'Delete scene scene', exact: true }).click();
  await expect(page.locator('[data-block-description="scene scene"]')).toHaveCount(0);
  await expect(patch).toBeVisible();
  await page.keyboard.press('ControlOrMeta+z');
  expect(await page.evaluate(() => window.p5jsLive.editor.value)).toBe(emptyPatch);
});

test('cell shortcut preserves previous visuals on syntax and first-frame failures', async ({ page }) => {
  await boot(page);
  const cell = page.locator('[data-block-description="patch myPatch"]');
  await cell.locator('summary').click();
  const input = cell.locator('textarea');
  const before = await input.inputValue();
  await input.fill(before.replace('const size = 120', 'const size = 180'));
  await expect(cell.locator('.cell-status')).toContainText('Edited');
  await expect(cell.getByRole('button', { name: 'Run patch myPatch', exact: true })).toHaveCount(0);
  await input.press('Control+Enter');
  await expect(cell.locator('.cell-feedback')).toBeHidden();
  await expect(cell.locator('.cell-status')).toHaveText('Live');
  const version = await page.evaluate(() => window.p5jsLive.registry.getStrategy('myPatch').version);

  await input.fill('const myPatch = { draw() { throw new Error("usability rollback"); } };');
  await input.press('Control+Enter');
  await expect(cell.locator('.cell-feedback')).toContainText('usability rollback');
  await expect(cell.locator('.cell-status')).toContainText('Edited');
  expect(await page.evaluate(() => window.p5jsLive.registry.getStrategy('myPatch').version)).toBe(version);

  await input.fill('const myPatch = {');
  await input.press('Control+Enter');
  await expect(cell.locator('.cell-feedback')).toContainText('Couldn’t apply');
  expect(await page.evaluate(() => window.p5jsLive.registry.getStrategy('myPatch').version)).toBe(version);
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
  await scene.locator('.folded-source-editor').press('Control+Enter');
  await expect(page.locator('#live-layer-count')).toHaveText('3 layers');
  await expect(scene.locator('.cell-feedback')).toBeHidden();
  await expect(row.locator('button')).toHaveText('Edit source');
  await expect(row.locator('button')).toBeEnabled();
});

test('complete-editor shortcut applies the selected scene and AI remains explicitly accepted', async ({ page }) => {
  await boot(page);
  await page.locator('#fold-code').click();
  const code = page.locator('#code');
  const before = await code.inputValue();
  await code.fill(before.replace('const scene = [', 'const scene = [\n  myPatch,'));
  await expect(page.locator('#current-cell-bar .cell-status')).toContainText('Edited');
  await expect(page.locator('#current-cell-bar button')).toHaveCount(0);
  await expect(page.locator('#current-cell-bar .cell-feedback')).toHaveCount(0);
  await code.press('Control+Enter');
  await expect(page.locator('#live-layer-count')).toHaveText('3 layers');

  await page.evaluate(() => {
    const editor = window.p5jsLive.editor;
    editor.stageSource(editor.value.replace('const size = 120', 'const size = 190'));
  });
  await page.evaluate(() => window.p5jsLive.editor.acceptStagedSource());
  await expect.poll(() => page.evaluate(() => window.p5jsLive.editor.hasStagedSource())).toBe(false);
  await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.getStrategy('myPatch').source)).toContain('const size = 190');
});
