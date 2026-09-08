import { test, expect } from '@playwright/test';

const patches = `// %% patch blue
const blue = { draw() { background(0, 0, 255); } };
// %% patch red
const red = { draw() { background(255, 0, 0); } };
`;

async function boot(page, scene) {
  await page.addInitScript(source => {
    if (!localStorage.getItem('p5js-live.project.v5')) {
      localStorage.setItem('p5js-live.project.v5', JSON.stringify({ schema: 7, savedAt: Date.now(), source, params: [] }));
    }
  }, `${patches}\n// %% scene scene\n${scene}`);
  await page.goto('/live/');
  await page.getByRole('button', { name: 'Start silent' }).click();
  await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.activeSceneName())).toBe('scene');
  await settled(page);
}

async function settled(page) {
  await expect.poll(() => page.evaluate(() => window.p5jsLive.evaluator.pendingCount())).toBe(0);
  await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.listStrategies().some(record => record.candidate))).toBe(false);
}
async function evaluate(page, source) {
  const result = await page.evaluate(source => window.p5jsLive.evaluator.evaluate(source), source);
  expect(result.ok).toBe(true);
  await settled(page);
}
async function pixel(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#stage canvas');
    return [...canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data];
  });
}

test('native arrays preserve nested opacity and leave p5 draw running', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await boot(page, 'const scene = [blue, [red].opacity(0.5)]; scene.draw();');
  await expect.poll(() => pixel(page)).toEqual([expect.closeTo(128, 0), 0, expect.closeTo(127, 0), 255]);
  await page.evaluate(() => { window.__arrayApiP5Draw = window.draw; window.__arrayApiFrame = frameCount; });
  await evaluate(page, 'const scene = [blue, [red].opacity(0.5)].opacity(0.6); scene.draw();');
  await expect.poll(() => pixel(page)).toEqual([expect.closeTo(128, 0), 0, expect.closeTo(127, 0), 153]);
  expect(await page.evaluate(() => window.draw === window.__arrayApiP5Draw && frameCount > window.__arrayApiFrame)).toBe(true);
  await evaluate(page, 'const scene = [blue, [red].mute()]; scene.draw();');
  await expect.poll(() => pixel(page)).toEqual([0, 0, 255, 255]);
  await evaluate(page, 'const scene = [blue, [red].mute(false)]; scene.draw();');
  await expect.poll(() => pixel(page)).toEqual([255, 0, 0, 255]);
  expect(errors).toEqual([]);
});

test('native effect order, computed methods and factory results use the real shader pipeline', async ({ page }) => {
  await boot(page, 'const scene = [red].hue(1/3).blur(3).draw();');
  await expect.poll(() => pixel(page)).toEqual([0, 255, 0, 255]);
  await evaluate(page, 'const scene = [red].hue(1/3).add(blue).draw();');
  await expect.poll(() => pixel(page)).toEqual([0, 0, 255, 255]);
  await evaluate(page, 'const scene = [red].add(blue).hue(1/3).draw();');
  await expect.poll(() => pixel(page)).toEqual([255, 0, 0, 255]);
  await evaluate(page, 'const make = () => [red]; const hue = make().hue; const scene = hue.call(make(), 1/3)["blur"](2); scene.draw();');
  await expect.poll(() => pixel(page)).toEqual([0, 255, 0, 255]);
  await evaluate(page, 'const scene = [red].colorShift(0, 0.2, 0, 0); scene.draw();');
  const shifted = await pixel(page);
  await evaluate(page, 'const scene = [red, new ShaderChain().shift(0, 0.2, 0, 0)]; scene.draw();');
  await expect.poll(() => pixel(page)).toEqual(shifted);
  await evaluate(page, 'const prepared = [blue].opacity(0.5);');
  await evaluate(page, 'prepared.draw();');
  await expect.poll(() => pixel(page)).toEqual([0, 0, 255, 128]);
});

test('protection errors leave the running scene intact and native methods unchanged', async ({ page }) => {
  await boot(page, 'const scene = [blue]; scene.draw();');
  for (const source of [
    'Array.prototype.opacity = () => {};',
    'Array.prototype.draw = () => {};',
    'Object.defineProperty(Array.prototype, "rotate", { value() {} });',
    'const bad = [1, 2]; bad.draw();',
  ]) {
    const result = await page.evaluate(source => {
      const result = window.p5jsLive.evaluator.evaluate(source);
      return { ok: result.ok, message: result.error?.message };
    }, source);
    expect(result.ok).toBe(false);
    expect(result.message).toBeTruthy();
  }
  await expect.poll(() => pixel(page)).toEqual([0, 0, 255, 255]);
  expect(await page.evaluate(() => {
    const values = [1, 2];
    const first = values.shift();
    return { first, values: values.map(n => n * 2), enumerable: Object.keys(Array.prototype) };
  })).toEqual({ first: 1, values: [4], enumerable: [] });
});

test('array effects remain editable, reloadable and inspectable', async ({ page }, testInfo) => {
  await boot(page, 'const scene = [blue, [red].hue(1/3).blur(3)]; scene.draw();');
  await expect.poll(() => pixel(page)).toEqual([0, 255, 0, 255]);
  await page.locator('#tools-toggle').click();
  await page.getByRole('tab', { name: 'Scene', exact: true }).click();
  await expect(page.locator('#scene-tree')).toContainText('hue(0.333');
  await expect(page.locator('#scene-tree')).toContainText('2 shader passes');
  await page.getByRole('button', { name: 'Move blue down', exact: true }).click();
  await expect(page.locator('#scene-pending')).toBeVisible();
  await page.locator('#scene-review-source').click();
  await page.getByRole('textbox', { name: 'Edit scene scene', exact: true }).press('Control+Enter');
  await expect(page.locator('#scene-pending')).toBeHidden();
  await expect.poll(() => pixel(page)).toEqual([0, 0, 255, 255]);
  expect(await page.evaluate(() => window.p5jsLive.editor.value)).toContain('scene.draw()');
  await page.reload();
  const start = page.getByRole('button', { name: 'Start silent' });
  if (await start.isVisible()) await start.click();
  await settled(page);
  await expect.poll(() => pixel(page)).toEqual([0, 0, 255, 255]);
  await page.screenshot({ path: testInfo.outputPath('array-layers.png') });
});
