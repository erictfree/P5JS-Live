import { test, expect } from '@playwright/test';

const source = (color, size = 50) => `const size = control('size', ${size}, {min: 10, max: 110, step: 1});
const colorPatch = { draw() { background('${color}'); } };
const scene = [colorPatch]; scene.draw();`;

async function boot(page) {
  await page.goto('/live/');
  await page.waitForFunction(() => window.p5jsLive?.launcher);
  await page.evaluate(() => { document.getElementById('start-overlay').hidden = true; });
  await page.evaluate(({ red, blue }) => {
    const app = window.p5jsLive;
    const a = app.performanceStore.save({ name: 'Red', source: red, params: [{ name: 'size', value: 50 }], rhythm: { source: 'manual', bpm: 80 } }).performance;
    const b = app.performanceStore.save({ name: 'Blue', source: blue, params: [{ name: 'size', value: 75 }], rhythm: { source: 'off' } }).performance;
    app.launcher.sync(); app.launcher.assign(0, a.id); app.launcher.assign(1, b.id);
    app.rhythm.configure({ source: 'manual', bpm: 137 });
    app.controlManager.restoreMappings([{ param: 'size', transport: 'midi', device: 'Test', type: 'cc', channel: 1, number: 10 }]);
    app.editor.setFolded(false);
  }, { red: source('#ff0000'), blue: source('#0000ff') });
  if (await page.locator('#side').evaluate(el => el.classList.contains('is-hidden'))) await page.locator('#tools-toggle').click();
  await page.getByRole('tab', { name: /^Performances/ }).click();
  await page.getByRole('button', { name: 'Open controller', exact: true }).click();
}
const pad = (page, index) => page.locator(`[data-pad="${index}"]`);
async function pixel(page) {
  return page.evaluate(() => Array.from(document.querySelector('#stage canvas').getContext('2d').getImageData(5, 5, 1, 1).data).slice(0, 3));
}

test('virtual pads launch real visuals, preserve session settings and drive live controls', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await boot(page);
  await pad(page, 0).click(); await expect(pad(page, 0)).toHaveAttribute('data-status', 'playing');
  await expect.poll(() => pixel(page)).toEqual([255, 0, 0]);
  await page.getByLabel('Increase encoder 1', { exact: true }).click();
  await expect(page.getByLabel('Encoder 1 value', { exact: true })).toHaveText('51');
  await pad(page, 1).click(); await expect(pad(page, 1)).toHaveAttribute('data-status', 'playing');
  await expect.poll(() => pixel(page)).toEqual([0, 0, 255]);
  expect(await page.evaluate(() => ({ rhythm: window.p5jsLive.rhythm.settings().bpm, mappings: window.p5jsLive.controlManager.snapshotMappings().length, folded: window.p5jsLive.editor.isFolded() }))).toEqual({ rhythm: 137, mappings: 1, folded: false });
  await expect(page.getByLabel('Encoder 1 value', { exact: true })).toHaveText('75');
  await page.screenshot({ path: '/tmp/astra-performance-controller.png' });
  await page.getByRole('button', { name: 'Close performance controller' }).click();
  expect(errors).toEqual([]);
});

test('syntax and first-frame failures retain the previous scene; previous edits can be recovered', async ({ page }) => {
  await boot(page); await pad(page, 0).click(); await expect(pad(page, 0)).toHaveAttribute('data-status', 'playing');
  await page.evaluate(() => {
    const app = window.p5jsLive;
    app.editor.value += '\n// precious unrun edit';
    const bad = app.performanceStore.save({ name: 'Broken', source: 'const scene = = [];' }).performance;
    app.launcher.sync(); app.launcher.assign(2, bad.id);
  });
  await pad(page, 2).click(); await expect(pad(page, 2)).toHaveAttribute('data-status', 'failed');
  expect(await page.evaluate(() => window.p5jsLive.editor.value)).toContain('precious unrun edit');
  await expect.poll(() => pixel(page)).toEqual([255, 0, 0]);
  await page.evaluate(() => {
    const app = window.p5jsLive;
    const bad = app.performanceStore.save({ name: 'Draw fails', source: 'const broken = { draw() { throw new Error("oops"); } }; const scene = [broken]; scene.draw();' }).performance;
    app.launcher.sync(); app.launcher.assign(3, bad.id);
  });
  await pad(page, 3).click(); await expect(pad(page, 3)).toHaveAttribute('data-status', 'failed');
  await expect.poll(() => pixel(page)).toEqual([255, 0, 0]);
  await pad(page, 1).click(); await expect(pad(page, 1)).toHaveAttribute('data-status', 'playing');
  await page.getByRole('button', { name: 'Recover previous edits' }).click();
  expect(await page.evaluate(() => window.p5jsLive.editor.value)).toContain('precious unrun edit');
  await expect.poll(() => pixel(page)).toEqual([0, 0, 255]);
});

test('next-beat queue and learned MIDI pad use the same launcher', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { window.p5jsLive.rhythm.configure({ source: 'manual', bpm: 30 }); window.p5jsLive.rhythm.align(); });
  await page.getByLabel('Launch timing').selectOption('beat');
  await pad(page, 1).click(); await expect(pad(page, 1)).toHaveAttribute('data-status', 'queued');
  await expect(pad(page, 1)).toHaveAttribute('data-status', 'playing', { timeout: 5000 });
  await page.evaluate(() => {
    const app = window.p5jsLive; app.launcher.setTiming('immediate'); app.launcher.learn('pad', 0);
    app.controlManager.receive({ name: 'Test pads' }, [0x90, 36, 100]);
    app.controlManager.receive({ name: 'Test pads' }, [0x80, 36, 0]);
    app.controlManager.receive({ name: 'Test pads' }, [0x90, 36, 100]);
  });
  await expect(pad(page, 0)).toHaveAttribute('data-status', 'playing');
  await expect.poll(() => pixel(page)).toEqual([255, 0, 0]);
});

test('demo performances expose eight useful encoders and remain deduplicated', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Add two demo performances' }).click();
  await page.getByRole('button', { name: 'Add two demo performances' }).click();
  expect(await page.evaluate(() => window.p5jsLive.performanceStore.list().filter(p => p.id.startsWith('controller-demo')).length)).toBe(2);
  await page.getByRole('button', { name: /Pad \d+: Controller demo · Orbits/ }).click();
  await expect(page.getByRole('button', { name: /Controller demo · Orbits · playing/ })).toBeVisible();
  await expect(page.getByLabel('Encoder 8 value', { exact: true })).toHaveText('0.85');
  await page.getByLabel('Increase encoder 1', { exact: true }).click();
  await expect(page.getByLabel('Encoder 1 value', { exact: true })).toHaveText('72');
  expect(await page.evaluate(() => window.p5jsLive.registry.listStrategies().some(p => p.lastError))).toBe(false);
  await page.screenshot({ path: '/tmp/astra-performance-controller.png' });
});
