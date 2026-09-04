import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

async function boot(page) {
  await page.goto('/live/');
  await expect(page.locator('#live-safe-status')).toHaveText('Safe state ready');
  await page.locator('#start-audio').click();
  await page.locator('#first-edit-dismiss').click();
  await page.locator('#tools-toggle').click();
}

test('task navigation, secondary settings, width and scroll survive switching', async ({ page }) => {
  await boot(page);
  await expect(page.getByRole('tab', { name: 'Library', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect((await page.locator('#side').boundingBox()).width).toBe(480);
  await page.getByRole('button', { name: 'Use compact Tools panel' }).click();
  expect((await page.locator('#side').boundingBox()).width).toBe(360);
  await page.locator('#panels').evaluate((node) => { node.scrollTop = 500; });
  const scroll = await page.locator('#panels').evaluate((node) => node.scrollTop);
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await expect(page.locator('#tools-opacity')).toBeVisible();
  await expect(page.locator('#tools-opacity')).toHaveValue('1');
  await page.getByRole('tab', { name: 'Library', exact: true }).click();
  expect(await page.locator('#panels').evaluate((node) => node.scrollTop)).toBe(scroll);
  await page.getByRole('tab', { name: 'Library', exact: true }).press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Controls', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Close Tools', exact: true }).click();
  await expect(page.locator('#tools-toggle')).toBeFocused();
  await page.reload();
  await page.locator('#start-audio').click();
  await page.locator('#tools-toggle').click();
  await expect(page.getByRole('tab', { name: 'Controls', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect((await page.locator('#side').boundingBox()).width).toBe(360);
});

test('search, categories, and pending additions preserve explicit scene evaluation', async ({ page }) => {
  await boot(page);
  await page.getByRole('searchbox', { name: 'Search patches' }).fill('waveScope');
  await expect(page.locator('#strategy-library [data-library]')).toHaveCount(1);
  await page.locator('#library-category').selectOption('shader');
  await expect(page.locator('#strategy-library [data-library]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear library search and filters' }).click();
  await page.getByRole('searchbox', { name: 'Search patches' }).fill('waveScope');
  const row = page.locator('[data-library="waveScope"]');
  await row.locator('button').click();
  await expect(page.getByRole('searchbox', { name: 'Search patches' })).toHaveValue('waveScope');
  await expect(row.locator('button')).toHaveText('Add to scene…');
  await expect(row.locator('button')).toBeFocused();
  await row.locator('button').click();
  await expect(row.locator('.patch-status')).toHaveText('Not run');
  await expect(page.locator('#library-pending')).toBeVisible();
  await expect(page.locator('#live-layer-count')).toHaveText('2 layers');
  await page.locator('#library-review-scene').click();
  await page.getByRole('button', { name: 'Run scene scene', exact: true }).click();
  await expect(page.locator('#live-layer-count')).toHaveText('3 layers');
  await expect(page.locator('#library-pending')).toBeHidden();
});

test('continuous controls keep their DOM and keyboard focus while values update', async ({ page }) => {
  await boot(page);
  await page.getByRole('tab', { name: 'Controls', exact: true }).click();
  await page.locator('#new-live-param').click();
  await page.locator('#new-param-name').fill('veryLongReadableParameterName');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const slider = page.getByRole('slider', { name: 'veryLongReadableParameterName', exact: true });
  await expect(slider).toBeVisible();
  await slider.evaluate((node) => { window.__originalSlider = node; });
  await slider.focus();
  await slider.press('ArrowRight');
  await slider.press('ArrowRight');
  await expect(slider).toHaveValue('0.52');
  await expect(slider).toBeFocused();
  expect(await slider.evaluate((node) => node === window.__originalSlider)).toBe(true);
  await expect(page.getByRole('tab', { name: 'Controls', exact: true })).toHaveAttribute('aria-selected', 'true');
  const bounds = await slider.boundingBox();
  expect(bounds.width).toBeGreaterThan(390);
});

test('audio transport and signal use the real loaded file', async ({ page }) => {
  await boot(page);
  await page.getByRole('tab', { name: 'Audio', exact: true }).click();
  await expect(page.locator('#tools-play-toggle')).toBeDisabled();
  await page.locator('#audio-file-2').setInputFiles(fileURLToPath(new URL('../fixtures/test-tone.wav', import.meta.url)));
  await expect(page.locator('#tools-play-toggle')).toBeEnabled();
  await expect(page.locator('#audio-source')).toContainText('test-tone.wav');
  await expect(page.locator('#audio-signal-state')).toHaveText('Playing');
  await expect.poll(() => page.locator('#audio-level').evaluate((node) => node.value)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause audio file', exact: true }).click();
  await expect(page.locator('#audio-signal-state')).toHaveText('Paused');
  await expect(page.locator('#play-toggle')).toHaveAttribute('aria-label', 'Play audio');
});

test('narrow Tools fills the viewport without scrolling the app and returns to source', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await expect.poll(async () => (await page.locator('#side').boundingBox()).x).toBe(0);
  const box = await page.locator('#side').boundingBox();
  expect(box.x).toBe(0); expect(box.y).toBe(0); expect(box.width).toBe(390);
  expect(await page.locator('#app').evaluate((node) => node.scrollLeft)).toBe(0);
  await page.getByRole('searchbox', { name: 'Search patches' }).fill('plasma');
  await page.locator('[data-library="plasma"] button').click();
  await expect(page.locator('#side')).toHaveAttribute('inert', '');
  await expect(page.getByRole('textbox', { name: 'Edit patch plasma', exact: true })).toBeFocused();
  expect(await page.locator('#app').evaluate((node) => node.scrollLeft)).toBe(0);
  await page.keyboard.press('Control+Alt+a');
  await expect(page.locator('#ai-api-key')).toBeFocused();
  await expect.poll(async () => (await page.locator('#side').boundingBox()).x).toBe(0);
  expect(await page.locator('#app').evaluate((node) => node.scrollLeft)).toBe(0);
});
