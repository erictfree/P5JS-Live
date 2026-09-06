import { test, expect } from '@playwright/test';

const PATCHES = `// %% patch red
const red = { draw() { background(255, 0, 0); } };
// %% patch blue
const blue = { draw() { background(0, 0, 255); } };
// %% patch shape
const shape = { draw() {
  clear(); noStroke(); fill(255, 100, 40);
  rect(width * .1, height * .15, width * .3, height * .25);
  fill(20, 220, 130); rect(width * .6, height * .5, width * .2, height * .35);
} };`;

async function boot(page, entries) {
  const source = `${PATCHES}\n// %% scene show\nconst show = [${entries}];\nactivate(show);`;
  await page.addInitScript((source) => {
    localStorage.setItem('p5js-live.project.v5', JSON.stringify({ schema: 6, savedAt: Date.now(), source, params: [] }));
  }, source);
  await page.goto('/live/');
  await page.getByRole('button', { name: 'Start silent' }).click();
  await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.activeSceneName())).toBe('show');
  await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.listStrategies().some((record) => record.candidate))).toBe(false);
}

async function pixel(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#stage canvas');
    return [...canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data];
  });
}

async function evaluate(page, source) {
  const result = await page.evaluate((source) => window.p5jsLive.evaluator.evaluate(source), source);
  expect(result.ok).toBe(true);
  await expect.poll(() => page.evaluate(() => window.p5jsLive.evaluator.pendingCount())).toBe(0);
  await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.listStrategies().some((record) => record.candidate))).toBe(false);
}

test('hue survives blur and wet/dry uses the original scene across passes', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await boot(page, 'red, new ShaderChain().hue(1/3).blur(3)');
  await expect.poll(() => pixel(page)).toEqual([0, 255, 0, 255]);
  await evaluate(page, 'const show = [red, new ShaderChain().hue(1/3).blur(3).mix(0)]; activate(show);');
  await expect.poll(() => pixel(page)).toEqual([255, 0, 0, 255]);
  await evaluate(page, 'const show = [red, new ShaderChain().hue(1/3).blur(3).invert().blur(3)]; activate(show);');
  await expect.poll(() => pixel(page)).toEqual([255, 0, 255, 255]);
  expect(errors).toEqual([]);
});

test('layer opacity composites over its parent and mute retains the parent image', async ({ page }) => {
  await boot(page, 'blue, layer(red).opacity(0.5)');
  await expect.poll(async () => {
    const [r, g, b, a] = await pixel(page);
    return Math.abs(r - 128) <= 2 && g === 0 && Math.abs(b - 127) <= 2 && a === 255;
  }).toBe(true);
  await evaluate(page, 'const show = [blue, layer(red).opacity(0.5).mute()]; activate(show);');
  await expect.poll(() => pixel(page)).toEqual([0, 0, 255, 255]);
});

test('blur and bloom carry visible color into transparent layer edges', async ({ page }) => {
  const whiteBlock = '() => { noStroke(); fill(255); rect(100, 100, 100, 100); }';
  await boot(page, `blue, layer(${whiteBlock}).fx(new ShaderChain().blur(8))`);
  const edge = () => page.evaluate(() => [...document.querySelector('#stage canvas').getContext('2d').getImageData(205, 150, 1, 1).data]);
  await expect.poll(edge).toEqual([expect.closeTo(71, -1), expect.closeTo(71, -1), 255, 255]);
  await evaluate(page, `const show = [blue, layer(${whiteBlock}).fx(new ShaderChain().bloom(1, 8, .5))]; activate(show);`);
  await expect.poll(edge).toEqual([expect.closeTo(64, -1), expect.closeTo(64, -1), 255, 255]);
});

test('fused transformations and repeated operators match separate ordered patches', async ({ page }) => {
  await boot(page, 'layer(shape).fx(new ShaderChain().crop(0, .5, 0, 1).rotate(.7).rotate(-.2).hue(.2))');
  const samples = () => page.evaluate(() => {
    const canvas = document.querySelector('#stage canvas');
    const context = canvas.getContext('2d');
    const colors = [];
    for (let y = 25; y < canvas.height; y += 50) for (let x = 25; x < canvas.width; x += 50) {
      colors.push([...context.getImageData(x, y, 1, 1).data]);
    }
    return colors;
  });
  const combined = await samples();
  expect(combined.some(([r, g, b]) => r + g + b > 100)).toBe(true);
  await evaluate(page, `const show = [layer(shape).fx(
    new ShaderChain().crop(0, .5, 0, 1), new ShaderChain().rotate(.7),
    new ShaderChain().rotate(-.2), new ShaderChain().hue(.2))]; activate(show);`);
  const separate = await samples();
  // Intermediate rasterization changes edge antialiasing, but interiors agree.
  const matches = combined.filter((color, i) => color.every((value, channel) => Math.abs(value - separate[i][channel]) < 8));
  expect(matches.length / combined.length).toBeGreaterThan(.95);
});

test('Scene inspector shows scopes, preserves live order until Run, and links to source', async ({ page }, testInfo) => {
  await boot(page, 'blue, layer(red).fx(new ShaderChain().hue(.2).blur(3))');
  await page.locator('#tools-toggle').click();
  await page.getByRole('tab', { name: 'Scene', exact: true }).click();
  await expect(page.locator('#scene-tree')).toContainText('Isolated');
  await expect(page.locator('#scene-tree')).toContainText('hue(0.2)');
  await expect(page.locator('#scene-tree')).toContainText('2 shader passes');
  await expect(page.locator('#scene-pending')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('scene-inspector.png') });
  await page.getByRole('button', { name: 'Move blue down', exact: true }).click();
  await expect(page.locator('#scene-pending')).toBeVisible();
  expect((await page.evaluate(() => window.p5jsLive.registry.activeTree()))[0].strategy).toBe('blue');
  await page.locator('#scene-review-source').click();
  await page.getByRole('button', { name: 'Run scene show', exact: true }).click();
  await expect(page.locator('#scene-pending')).toBeHidden();
  expect((await page.evaluate(() => window.p5jsLive.registry.activeTree()))[0].kind).toBe('group');
  await page.getByRole('button', { name: 'Edit source for red', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run patch red', exact: true })).toBeVisible();
});

test('Scene inspector fits a narrow screen and keeps keyboard tab navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page, 'blue, layer(red).fx(new ShaderChain().hue(.2))');
  await page.locator('#tools-toggle').click();
  await page.getByRole('tab', { name: 'Scene', exact: true }).click();
  expect(await page.locator('#scene-panel').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.getByRole('tab', { name: 'Scene', exact: true }).press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Library', exact: true })).toBeFocused();
});
