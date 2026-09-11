import { test, expect } from '@playwright/test';

const tab = (page, name) => page.getByRole('tab', { name, exact: true }).click();

// Scenes are saved and listed on the Scene tab.
async function saveScene(page, name) {
  await tab(page, 'Scene');
  await page.getByLabel('Scene name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Save scene', exact: true }).click();
  await expect(page.locator('#performance-list')).toContainText(name);
}

async function boot(page) {
  await page.goto('/live/');
  await page.waitForFunction(() => window.p5jsLive?.performanceLibrary);
  await page.evaluate(() => { document.getElementById('start-overlay').hidden = true; localStorage.removeItem('p5js-live.performance-library.v1'); localStorage.removeItem('p5js-live.current-performance.v1'); });
  if (await page.locator('#side').evaluate(el => el.classList.contains('is-hidden'))) await page.locator('#tools-toggle').click();
  await page.getByRole('tab', { name: 'Performance', exact: true }).click();
}

test('a performance saves with its scenes, survives New performance, and loads back', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await boot(page);

  // Save a scene, then save the whole performance.
  await saveScene(page, 'Opening');
  await tab(page, 'Performance');
  await page.getByLabel('Performance name', { exact: true }).fill('Friday set');
  await page.getByRole('button', { name: 'Save performance', exact: true }).click();
  await expect(page.locator('#library-current-name')).toHaveText('Friday set');
  await expect(page.locator('#library-list')).toContainText('Friday set');
  await expect(page.locator('#library-list')).toContainText('1 scene');
  await expect.poll(() => page.evaluate(() => window.p5jsLive.performanceLibrary.list()[0].thumbnail?.startsWith('data:image/'))).toBe(true);

  // Autosave picks up a second scene.
  await saveScene(page, 'Second');
  await tab(page, 'Performance');
  await expect.poll(() => page.evaluate(() => window.p5jsLive.performanceLibrary.list()[0].sceneCount), { timeout: 10_000 }).toBe(2);

  // New performance empties the set but the saved one keeps its copy.
  await page.getByRole('button', { name: /Start a new performance/ }).click();
  await page.getByRole('button', { name: 'Start fresh', exact: true }).click();
  await expect(page.locator('#library-current-name')).toHaveText('Untitled');
  await tab(page, 'Scene');
  await expect(page.locator('#performance-list')).toContainText('No saved scenes yet');
  expect(await page.evaluate(() => window.p5jsLive.performanceStore.list().length)).toBe(0);
  await tab(page, 'Performance');

  // Load brings scenes, layout and current pointer back.
  await page.getByRole('button', { name: 'Load Friday set', exact: true }).click();
  await expect(page.locator('#library-current-name')).toHaveText('Friday set');
  await tab(page, 'Scene');
  await expect(page.locator('#performance-list')).toContainText('Opening');
  await expect(page.locator('#performance-list')).toContainText('Second');
  expect(await page.evaluate(() => window.p5jsLive.performanceStore.list().length)).toBe(2);
  expect(errors).toEqual([]);
});

test('rename and reorder update the list and the jog browsing order', async ({ page }) => {
  await boot(page);
  await page.getByLabel('Performance name', { exact: true }).fill('One');
  await page.getByRole('button', { name: 'Save performance', exact: true }).click();
  await expect(page.locator('#library-current-name')).toHaveText('One');
  await page.getByLabel('Performance name', { exact: true }).fill('Two');
  await page.getByRole('button', { name: 'Save performance', exact: true }).click();
  await expect(page.locator('#library-current-name')).toHaveText('Two');
  expect(await page.evaluate(() => window.p5jsLive.performanceLibrary.list().map(e => e.name))).toEqual(['One', 'Two']);

  await page.getByRole('button', { name: 'Move Two up', exact: true }).click();
  expect(await page.evaluate(() => window.p5jsLive.performanceLibrary.list().map(e => e.name))).toEqual(['Two', 'One']);

  await page.getByLabel('Performance name', { exact: true }).fill('Two renamed');
  await page.getByRole('button', { name: 'Rename the current performance', exact: true }).click();
  await expect(page.locator('#library-current-name')).toHaveText('Two renamed');
  expect(await page.evaluate(() => window.p5jsLive.performanceLibrary.list().map(e => e.name))).toEqual(['Two renamed', 'One']);
});

test('performances export one at a time or all at once, and a library file imports back', async ({ page }) => {
  await boot(page);
  await page.getByLabel('Performance name', { exact: true }).fill('Alpha');
  await page.getByRole('button', { name: 'Save performance', exact: true }).click();
  await expect(page.locator('#library-current-name')).toHaveText('Alpha');
  await page.getByLabel('Performance name', { exact: true }).fill('Beta');
  await page.getByRole('button', { name: 'Save performance', exact: true }).click();
  await expect(page.locator('#library-current-name')).toHaveText('Beta');

  const [single] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export Alpha as a file', exact: true }).click(),
  ]);
  expect(single.suggestedFilename()).toMatch(/^p5js-live-performance-alpha-\d{4}-\d{2}-\d{2}\.json$/);
  const singleFile = JSON.parse(await (await import('node:fs/promises')).readFile(await single.path(), 'utf8'));
  expect(singleFile).toMatchObject({ format: 'p5js-live-project', name: 'Alpha' });

  const [all] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export all performances', exact: true }).click(),
  ]);
  expect(all.suggestedFilename()).toMatch(/^p5js-live-performances-\d{4}-\d{2}-\d{2}\.json$/);
  const libraryText = await (await import('node:fs/promises')).readFile(await all.path(), 'utf8');
  expect(JSON.parse(libraryText)).toMatchObject({ format: 'p5js-live-performance-library', performances: [{ name: 'Alpha' }, { name: 'Beta' }] });

  await page.evaluate(() => { localStorage.removeItem('p5js-live.performance-library.v1'); localStorage.removeItem('p5js-live.current-performance.v1'); });
  await page.reload();
  await page.waitForFunction(() => window.p5jsLive?.performanceLibrary);
  await page.evaluate(() => { document.getElementById('start-overlay').hidden = true; });
  if (await page.locator('#side').evaluate(el => el.classList.contains('is-hidden'))) await page.locator('#tools-toggle').click();
  await page.getByRole('tab', { name: 'Performance', exact: true }).click();
  expect(await page.evaluate(() => window.p5jsLive.performanceLibrary.list().length)).toBe(0);
  await page.locator('#import-file').setInputFiles({ name: 'my-set.json', mimeType: 'application/json', buffer: Buffer.from(libraryText) });
  const dialog = page.locator('.dialog-backdrop');
  await expect(dialog).toContainText('Import 2 performances');
  await dialog.getByRole('button', { name: 'Add to library' }).click();
  await expect(page.locator('#library-list')).toContainText('Alpha');
  await expect(page.locator('#library-list')).toContainText('Beta');
  expect(await page.evaluate(() => window.p5jsLive.performanceLibrary.list().map(e => e.name))).toEqual(['Alpha', 'Beta']);
});
