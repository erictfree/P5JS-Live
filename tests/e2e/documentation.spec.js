import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

// Read the actual copy-and-paste programs, so docs cannot silently diverge from tests.
function example(file, name) {
  const markdown = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
  const marker = `<!-- example: ${name} -->`;
  const section = markdown.split(marker);
  if (section.length !== 2) throw new Error(`Expected one ${marker} in ${file}`);
  const match = section[1].match(/^\s*```js\n([\s\S]*?)\n```/);
  if (!match) throw new Error(`Missing JavaScript after ${marker} in ${file}`);
  return match[1];
}

async function settled(page) {
  await expect.poll(() => page.evaluate(() => {
    const { evaluator, registry } = window.p5jsLive;
    return evaluator.pendingCount() === 0 &&
      !registry.listStrategies().some(record => record.candidate);
  })).toBe(true);
  expect(await page.evaluate(() => window.p5jsLive.diagnostics.list()
    .filter(entry => entry.level === 'error').map(entry => entry.message))).toEqual([]);
}

async function boot(page, source, url = '/live/') {
  await page.addInitScript(source => {
    localStorage.setItem('p5js-live.project.v5', JSON.stringify({
      schema: 7, source, savedAt: Date.now(), params: [],
    }));
  }, source);
  await page.goto(url);
  await page.getByRole('button', { name: 'Start silent' }).click();
  await expect.poll(() => page.evaluate(() =>
    window.p5jsLive.registry.activeSceneName())).toBe('scene');
  await settled(page);
}

async function run(page, source) {
  const result = await page.evaluate(source => {
    const result = window.p5jsLive.evaluator.evaluate(source);
    return { ok: result.ok, error: result.error?.message };
  }, source);
  expect(result).toEqual({ ok: true, error: undefined });
  await settled(page);
}

async function imageStats(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#stage canvas');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let colored = 0;
    let hash = 0;
    // Sample actual canvas output; a running-but-empty scene must fail this check.
    for (let i = 0; i < data.length; i += 4 * 7) {
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      if (Math.max(r, g, b) - Math.min(r, g, b) > 40 && data[i + 3] > 100) colored++;
      hash = (Math.imul(hash, 31) + r + g * 3 + b * 7) | 0;
    }
    return { colored, hash };
  });
}

async function visiblyAnimating(page) {
  await expect.poll(async () => (await imageStats(page)).colored).toBeGreaterThan(25);
  const first = await imageStats(page);
  await expect.poll(async () => (await imageStats(page)).hash).not.toBe(first.hash);
  await settled(page);
}

for (const file of ['README.md', 'docs/USER-MANUAL.md']) {
  test(`${file}: first scene renders in silence without Library installs`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await boot(page, example(file, 'first-scene'));
    await visiblyAnimating(page);
    expect(errors).toEqual([]);
  });
}

test('quickstart: starter, second patch, shared and separate effects', async ({ page }) => {
  const file = 'docs/GUIDE.md';
  await boot(page, example(file, 'starter'));
  await visiblyAnimating(page);
  await run(page, example(file, 'rings'));
  for (const name of ['pair', 'separate']) {
    await run(page, example(file, name));
    await visiblyAnimating(page);
    expect(await page.evaluate(() => window.p5jsLive.registry.activeOrder())).toContain('rings');
  }
});

test('cookbook: nested groups, explicit shaders and configured patch factories', async ({ page }, testInfo) => {
  const file = 'docs/COMPOSITION.md';
  await boot(page, example(file, 'together'));
  await visiblyAnimating(page);
  for (const name of ['separate', 'nested', 'explicit-shader', 'configured']) {
    await run(page, example(file, name));
    await visiblyAnimating(page);
  }
  await page.screenshot({ path: testInfo.outputPath('configured-patches.png') });
});

test('network docs: complete source-only example publishes and receives', async ({ page, context, baseURL }) => {
  const file = 'docs/NETWORKING.md';
  const receiver = await context.newPage();
  try {
    await boot(page, example(file, 'publisher'));
    await visiblyAnimating(page);
    const receiverURL = new URL('/live/', baseURL);
    receiverURL.hostname = '127.0.0.1';
    await boot(receiver, example(file, 'receiver'), receiverURL.href);
    await expect.poll(() => receiver.evaluate(() =>
      window.p5jsLive.evaluator.binding('networkReceiver')?.status),
    { timeout: 15_000 }).toBe('live');
    await visiblyAnimating(receiver);

    // The reference promises capture of the current target, including a nested
    // group. Recreate the publisher as documented when changing capture scope.
    await run(page, `
      const publishMain = room.publish({ name: "main-output", fps: 30 });
      const scene = [
        () => background(0, 0, 255),
        [() => background(255, 0, 0), publishMain].opacity(0.5),
      ];
      scene.draw();
    `);
    await expect.poll(() => receiver.evaluate(() => {
      const canvas = document.querySelector('#stage canvas');
      const [r, g, b] = canvas.getContext('2d').getImageData(
        Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1,
      ).data;
      // The received group is red. Capturing the main scene would be purple.
      return r > 220 && g < 30 && b < 30;
    }), { timeout: 15_000 }).toBe(true);
  } finally {
    await receiver.close();
  }
});
