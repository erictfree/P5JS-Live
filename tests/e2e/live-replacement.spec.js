// Full-browser continuity acceptance: visual code can change while the canvas,
// audio, state, and surrounding patches stay alive.

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const TONE = fileURLToPath(new URL('../fixtures/test-tone.wav', import.meta.url));

const FIXTURE_SOURCE = `
// %% patch baseFade
const baseFade = ({ audio }) => {
  noStroke();
  fill(5, 5, 10, 18 + audio.level * 20);
  rect(0, 0, width, height);
};

// %% patch laserFan
const laserFan = {
  hue: 165,
  draw({ audio }) {
    colorMode(HSB, 360, 100, 100, 1);
    stroke(this.hue, 80, 100, 0.7);
    line(width / 2, height, width * audio.treble, 0);
  },
};

// %% patch trailDots
const trailDots = {
  state() { return { points: [] }; },
  draw({ state, time }) {
    state.points.push(time);
    if (state.points.length > 400) state.points.shift();
    circle(width / 2, height / 2, 8);
  },
};

// %% scene liveSet
const liveSet = [baseFade, laserFan, trailDots, plasma];
activate(liveSet);
`;

const LASER_EDITED = `const laserFan = {
  hue: 30,
  draw({ audio }) {
    stroke(255, 120, 0);
    strokeWeight(9);
    line(width / 2, height, width * audio.treble, 0);
  },
};`;

const LASER_SYNTAX_ERROR = `const laserFan = {
  draw({ audio }) {
    this is not javascript (((
  },
};`;

const LASER_RUNTIME_ERROR = `const laserFan = {
  draw() {
    missingThing.boom();
  },
};`;

async function setBufferAndCursor(page, buffer, cursorNeedle) {
  await page.evaluate(
    ([text, needle]) => {
      const editor = document.getElementById('code');
      editor.value = text;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      const at = text.indexOf(needle);
      editor.focus();
      editor.selectionStart = editor.selectionEnd = at + needle.length;
    },
    [buffer, cursorNeedle],
  );
}

const latestMessage = (page) =>
  page.evaluate(() => window.p5jsLive.diagnostics.latest()?.message ?? '');

const snapshot = (page) =>
  page.evaluate(() => {
    const app = window.p5jsLive;
    return {
      frameCount: window.frameCount,
      hostTime: app.host.time(),
      canvasId: document.querySelector('#stage canvas').dataset.probe,
      audioPosition: app.audio.status().position,
      audioPlaying: app.audio.status().playing,
      laserVersion: app.registry.getStrategy('laserFan')?.version ?? null,
      laserSource: app.registry.getStrategy('laserFan')?.source ?? '',
      laserStatus: app.registry.getStrategy('laserFan')?.status ?? null,
      plasmaStatus: app.registry.getStrategy('plasma')?.status ?? null,
      trailLength: app.stateStore.get('trailDots')?.points?.length ?? 0,
      sceneOrder: app.registry.activeOrder(),
      messages: app.diagnostics.list().slice(0, 4).map((entry) => `${entry.level}: ${entry.message}`),
    };
  });

test('visual logic is replaceable while everything else stays alive', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/live/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('#audio-file').setInputFiles(TONE);
  await expect(page.locator('#start-overlay')).toBeHidden({ timeout: 15_000 });
  await page.locator('#tools-toggle').click();
  await page.evaluate(() => window.p5jsLive.editor.setFolded(false));

  const starter = await page.locator('#code').inputValue();
  await setBufferAndCursor(page, `${starter.trimEnd()}\n${FIXTURE_SOURCE}`, 'const liveSet =');
  await page.locator('#code').press('Control+Shift+Enter');
  await expect
    .poll(() => page.evaluate(() => window.p5jsLive.registry.activeOrder()))
    .toEqual(['baseFade', 'laserFan', 'trailDots', 'plasma']);
  await page.evaluate(() => {
    document.querySelector('#stage canvas').dataset.probe = 'original';
    window.p5jsLive.audio.setLoop(true);
  });
  await expect.poll(() => page.evaluate(() => window.p5jsLive.audio.status().playing)).toBe(true);

  await page.waitForTimeout(2_000);
  const before = await snapshot(page);
  expect(before.trailLength).toBeGreaterThan(30);
  expect(before.audioPosition).toBeGreaterThan(0);

  const buffer = await page.locator('#code').inputValue();
  const edited = buffer.replace(/const laserFan\s*=\s*\{[\s\S]*?\n\};/, LASER_EDITED);
  await setBufferAndCursor(page, edited, 'stroke(255, 120, 0)');
  await page.locator('#code').press('Control+Enter');
  await expect.poll(() => latestMessage(page)).toBe('laserFan v2 active');

  const afterEdit = await snapshot(page);
  expect(afterEdit.laserSource).toContain('stroke(255, 120, 0)');
  expect(afterEdit.canvasId).toBe('original');
  expect(afterEdit.frameCount).toBeGreaterThan(before.frameCount);
  // A loop may wrap to the start while the edit is evaluated; the invariant is
  // that playback remains live rather than resetting to a stopped source.
  expect(afterEdit.audioPosition).toBeGreaterThan(0);
  expect(afterEdit.audioPlaying).toBe(true);
  expect(afterEdit.trailLength).toBeGreaterThanOrEqual(before.trailLength);

  await setBufferAndCursor(
    page,
    edited.replace(LASER_EDITED, LASER_SYNTAX_ERROR),
    'not javascript',
  );
  await page.locator('#code').press('Control+Enter');
  await page.waitForTimeout(300);
  const afterSyntaxError = await snapshot(page);
  expect(afterSyntaxError.laserVersion).toBe(2);
  expect(afterSyntaxError.laserSource).toContain('stroke(255, 120, 0)');
  expect(afterSyntaxError.audioPlaying).toBe(true);
  await expect(page.locator('#diagnostics-list')).toContainText('Syntax error');
  await expect(page.locator('#stage')).not.toContainText('Syntax error');

  await setBufferAndCursor(
    page,
    edited.replace(LASER_EDITED, LASER_RUNTIME_ERROR),
    'missingThing',
  );
  await page.locator('#code').press('Control+Enter');
  await expect.poll(() => latestMessage(page)).toContain('rolled back');
  const afterRollback = await snapshot(page);
  expect(afterRollback.laserVersion).toBe(2);
  expect(afterRollback.plasmaStatus).toBe('ok');
  expect(afterRollback.audioPlaying).toBe(true);
  expect(afterRollback.trailLength).toBeGreaterThan(0);
  expect(afterRollback.canvasId).toBe('original');

  const reordered = edited.replace(
    'const liveSet = [baseFade, laserFan, trailDots, plasma];',
    'const liveSet = [baseFade, trailDots, laserFan, plasma];',
  );
  await setBufferAndCursor(page, reordered, 'const liveSet =');
  await page.locator('#code').press('Control+Enter');
  await expect
    .poll(() => page.evaluate(() => window.p5jsLive.registry.activeOrder()))
    .toEqual(['baseFade', 'trailDots', 'laserFan', 'plasma']);

  await page.getByRole('tab', { name: /^Messages/ }).click();
  await expect(page.locator('#history-list')).toBeVisible();
  await page.getByRole('button', { name: 'Make laserFan v1 active again' }).click();
  await expect.poll(() => latestMessage(page)).toBe('laserFan v3 active');
  await expect
    .poll(() => page.evaluate(() => window.p5jsLive.registry.getStrategy('laserFan').source))
    .toContain('hue: 165');

  const final = await snapshot(page);
  expect(final.laserStatus).toBe('ok');
  expect(final.sceneOrder).toEqual(['baseFade', 'trailDots', 'laserFan', 'plasma']);
  expect(final.canvasId).toBe('original');
  expect(final.audioPlaying).toBe(true);
  expect(final.frameCount).toBeGreaterThan(afterRollback.frameCount);
  expect(pageErrors).toEqual([]);
});

test('source, installed patches, and scene order survive a refresh', async ({ page }) => {
  await page.goto('/live/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.activeOrder()))
    .toEqual(['asciiNoise', 'plasma']);

  await page.evaluate(() => {
    const editor = document.getElementById('code');
    const marker = '// %% patch marker\nconst marker = { draw() { circle(10, 10, 5); } };\n\n';
    editor.value = editor.value
      .replace('// %% scene scene', `${marker}// %% scene scene`)
      .replace(
        'const scene = [\n  asciiNoise,\n  plasma,\n];',
        'const scene = [\n  asciiNoise,\n  marker,\n  plasma,\n];',
      );
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    window.p5jsLive.evaluator.evaluate(editor.value, { label: 'buffer' });
  });
  await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.hasStrategy('marker'))).toBe(true);
  await page.waitForTimeout(900);

  await page.reload();
  await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.hasStrategy('marker'))).toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.p5jsLive.registry.activeOrder()))
    .toEqual(['asciiNoise', 'marker', 'plasma']);
});
