import { test, expect } from '@playwright/test';
import { STARTER_SOURCE } from '../../starter/starter.js';
import { LIBRARY } from '../../starter/library.js';

const SOURCE = `// %% patch redBackground
const redBackground = {
  draw() {
    background(255, 0, 0);
  },
};

// %% patch greenHalf
const greenHalf = {
  draw() {
    drawingContext.fillStyle = "rgb(0, 255, 0)";
    drawingContext.fillRect(0, 0, width / 2, height);
  },
};

// %% patch groupProbe
const groupProbe = {
  draw({ canvas }) {
    globalThis.__nestedGroupCanvas = canvas.canvas;
  },
};

// %% scene scene
const scene = [
  redBackground,
  [greenHalf, [groupProbe]],
];
activate(scene);`;

test('nested scene arrays render on transparent recursive targets', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript((source) => {
    localStorage.clear();
    localStorage.setItem('p5js-live.project.v5', JSON.stringify({
      schema: 6,
      savedAt: Date.now(),
      source,
      safeScene: 'scene',
      params: [],
    }));
  }, SOURCE);

  await page.goto('/live/index.html');
  await page.getByRole('button', { name: 'Start silent' }).click();
  await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.activeOrder()))
    .toEqual(['redBackground', 'greenHalf', 'groupProbe']);

  await expect.poll(() => page.evaluate(() => {
    const root = document.querySelector('#stage canvas');
    const context = root.getContext('2d');
    const y = Math.floor(root.height / 2);
    const left = [...context.getImageData(Math.floor(root.width / 4), y, 1, 1).data];
    const right = [...context.getImageData(Math.floor(root.width * 3 / 4), y, 1, 1).data];
    return {
      left: left.slice(0, 3),
      right: right.slice(0, 3),
      isolated: globalThis.__nestedGroupCanvas !== root,
      tree: window.p5jsLive.registry.activeTree().map((node) => node.kind ?? 'patch'),
      nestedKind: window.p5jsLive.registry.activeTree()[1]?.children?.[1]?.kind,
    };
  })).toEqual({
    left: [0, 255, 0],
    right: [255, 0, 0],
    isolated: true,
    tree: ['patch', 'group'],
    nestedKind: 'group',
  });
  expect(pageErrors).toEqual([]);
});

test('Plasma inside a group preserves the parent background', async ({ page }) => {
  const source = STARTER_SOURCE.replace(
    /\/\/ %% scene scene[\s\S]*$/,
    `// %% patch solidBackground
const solidBackground = {
  colour: [6, 8, 18],
  draw() { background(...this.colour); },
};

// %% scene scene
const scene = [
  solidBackground,
  [asciiNoise, plasma],
];
activate(scene);`,
  );
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript((savedSource) => {
    localStorage.clear();
    localStorage.setItem('p5js-live.project.v5', JSON.stringify({
      schema: 6,
      savedAt: Date.now(),
      source: savedSource,
      safeScene: 'scene',
      params: [],
    }));
  }, source);

  await page.goto('/live/index.html');
  await page.getByRole('button', { name: 'Start silent' }).click();
  await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.activeOrder()))
    .toEqual(['solidBackground', 'asciiNoise', 'plasma']);

  const result = await page.evaluate(() => {
    const canvas = document.querySelector('#stage canvas');
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const total = [0, 0, 0];
    let count = 0;
    for (let y = 10; y < canvas.height; y += 40) {
      for (let x = 10; x < canvas.width; x += 40) {
        const at = (y * canvas.width + x) * 4;
        total[0] += pixels[at];
        total[1] += pixels[at + 1];
        total[2] += pixels[at + 2];
        count += 1;
      }
    }
    return total.map((value) => value / count);
  });
  expect(result[0]).toBeGreaterThanOrEqual(5);
  expect(result[1]).toBeGreaterThanOrEqual(7);
  expect(result[2]).toBeGreaterThanOrEqual(16);
  expect(pageErrors).toEqual([]);
});

test('Plasma inside a group returns the processed group pixels', async ({ page }) => {
  const source = STARTER_SOURCE.replace(
    /\/\/ %% scene scene[\s\S]*$/,
    `// %% patch solidBackground
const solidBackground = { draw() { background(24, 10, 38); } };

// %% patch groupFill
const groupFill = {
  draw() {
    noStroke();
    fill(220, 40, 20);
    rect(0, 0, width, height);
  },
};

// %% scene scene
const scene = [solidBackground, [groupFill, plasma]];
activate(scene);`,
  );
  await page.addInitScript((savedSource) => {
    localStorage.clear();
    localStorage.setItem('p5js-live.project.v5', JSON.stringify({
      schema: 6,
      savedAt: Date.now(),
      source: savedSource,
      safeScene: 'scene',
      params: [],
    }));
  }, source);

  await page.goto('/live/index.html');
  await page.getByRole('button', { name: 'Start silent' }).click();
  await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.activeOrder()))
    .toEqual(['solidBackground', 'groupFill', 'plasma']);
  await expect.poll(() => page.evaluate(() => {
    const canvas = document.querySelector('#stage canvas');
    return [...canvas.getContext('2d').getImageData(
      Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1,
    ).data].slice(0, 3);
  })).not.toEqual([24, 10, 38]);
});

test('Neon Tunnel and ASCII remain visible when Plasma scopes them as a group', async ({ page }) => {
  const neonSource = LIBRARY.find(({ name }) => name === 'neonTunnel').source;
  const solidSource = LIBRARY.find(({ name }) => name === 'solidBackground').source
    .replace('colour: [6, 8, 18]', 'colour: [24, 10, 38]');
  const source = STARTER_SOURCE.replace(
    /\/\/ %% scene scene[\s\S]*$/,
    `${solidSource}\n\n${neonSource}\n\n// %% scene scene
const scene = [solidBackground, [neonTunnel, asciiNoise, plasma]];
activate(scene);`,
  );
  await page.addInitScript((savedSource) => {
    localStorage.clear();
    localStorage.setItem('p5js-live.project.v5', JSON.stringify({
      schema: 6,
      savedAt: Date.now(),
      source: savedSource,
      safeScene: 'scene',
      params: [],
    }));
  }, source);

  await page.goto('/live/index.html');
  await page.getByRole('button', { name: 'Start silent' }).click();
  await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.activeOrder()))
    .toEqual(['solidBackground', 'neonTunnel', 'asciiNoise', 'plasma']);
  await expect.poll(() => page.evaluate(() => {
    const canvas = document.querySelector('#stage canvas');
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let changed = 0;
    for (let y = 0; y < canvas.height; y += 8) {
      for (let x = 0; x < canvas.width; x += 8) {
        const at = (y * canvas.width + x) * 4;
        const difference = Math.abs(pixels[at] - 24) + Math.abs(pixels[at + 1] - 10) + Math.abs(pixels[at + 2] - 38);
        if (difference > 18) {
          changed += 1;
        }
      }
    }
    return changed;
  })).toBeGreaterThan(100);
});
