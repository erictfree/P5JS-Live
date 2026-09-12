import { test, expect } from '@playwright/test';

const tab = (page, name) => page.getByRole('tab', { name, exact: true }).click();

async function boot(page) {
  await page.goto('/live/');
  await page.waitForFunction(() => window.p5jsLive?.modulations);
  await page.evaluate(() => { document.getElementById('start-overlay').hidden = true; });
  if (await page.locator('#side').evaluate(el => el.classList.contains('is-hidden'))) await page.locator('#tools-toggle').click();
}

test('a created modulation appears as a read-only modulations cell that follows the tools', async ({ page }) => {
  await boot(page);
  await tab(page, 'Modulations');
  await page.evaluate(() => window.p5jsLive.modulations.import([]));
  await page.locator('#add-modulation').click();
  await page.locator('.modulation-create input[name=name]').fill('wobble');
  await page.locator('.modulation-create select[name=wave]').selectOption('triangle');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const code = page.locator('#code');
  await expect(code).toHaveValue(/\/\/ %% modulations\n\/\/ Managed[^\n]*\nmodulation\("wobble", \{ wave: "triangle", beats: 1, depth: 0.25, offset: 0 \}\);/);

  // Typing into the generated cell in the complete editor is reverted with a note.
  const before = await code.inputValue();
  await page.evaluate(() => window.p5jsLive.editor.setFolded(false));
  await code.focus();
  const at = before.indexOf('depth: 0.25');
  await page.evaluate((index) => { document.getElementById('code').setSelectionRange(index, index); }, at);
  await page.keyboard.type('XX');
  await expect(code).toHaveValue(before);
  await expect(page.locator('#diagnostics-list')).toContainText(/modulations cell is read-only/i);
  // Ordinary code still edits.
  const patchAt = before.indexOf('draw(');
  await page.evaluate((index) => { document.getElementById('code').setSelectionRange(index, index); }, patchAt);
  await page.keyboard.type('/* ok */');
  await expect(code).toHaveValue(/\/\* ok \*\/draw\(/);
  // In the folded view the cell's body editor is read-only and carries a badge.
  await page.evaluate(() => window.p5jsLive.editor.setFolded(true));
  const locked = page.locator('.folded-block.is-locked', { hasText: '%% modulations' });
  await expect(locked.locator('.cell-lock')).toHaveText('read-only');
  await expect(locked.locator('.folded-delete')).toBeDisabled();
  await locked.locator('summary').click();
  await expect(locked.locator('.folded-source-editor')).toHaveAttribute('readonly', '');

  // The cell follows the engine: a depth change on the modulation rewrites it, removal drops it.
  await page.evaluate(() => { const m = window.p5jsLive.modulations.list()[0]; window.p5jsLive.modulations.update(m.id, { depth: 0.5, target: '' }); });
  await expect(code).toHaveValue(/modulation\("wobble", \{ wave: "triangle", beats: 1, depth: 0.5, offset: 0 \}\);/);
  await page.evaluate(() => { const m = window.p5jsLive.modulations.list()[0]; window.p5jsLive.modulations.remove(m.id); });
  await expect(code).not.toHaveValue(/%% modulations/);
});

test('modulation() in the source seeds a fresh performance without overriding live settings', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.p5jsLive.modulations.import([]));
  const result = await page.evaluate(() => {
    const r = window.p5jsLive.evaluator.evaluate('modulation("sweep", { wave: "square", hz: 2, depth: 0.8, target: "size" });', { label: 'test' });
    window.p5jsLive.evaluator.applyPending();
    return { ok: r.ok, list: window.p5jsLive.modulations.list().map(({ id, ...m }) => m) };
  });
  expect(result.ok).toBe(true);
  expect(result.list).toEqual([expect.objectContaining({ name: 'sweep', wave: 'square', hz: 2, sync: false, depth: 0.8, target: 'size' })]);
  await expect(page.locator('#code')).toHaveValue(/%% modulations\n[^\n]*\nmodulation\("sweep", \{ wave: "square", hz: 2, depth: 0.8, offset: 0, target: "size" \}\);/);
  const again = await page.evaluate(() => {
    const m = window.p5jsLive.modulations.list()[0];
    window.p5jsLive.modulations.update(m.id, { depth: 0.2 });
    window.p5jsLive.evaluator.evaluate('modulation("sweep", { depth: 0.9 });', { label: 'test' });
    window.p5jsLive.evaluator.applyPending();
    return window.p5jsLive.modulations.list()[0].depth;
  });
  expect(again).toBe(0.2);
});
