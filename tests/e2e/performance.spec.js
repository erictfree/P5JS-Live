// Performance behavior in the real page: projection, recovery, and import.

import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const TONE = fileURLToPath(new URL('../fixtures/test-tone.wav', import.meta.url));

async function boot(page, { tools = true, folded = false, welcome = false } = {}) {
  await page.goto('/live/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => window.p5jsLive.registry.activeOrder().length))
    .toBe(2);
  if (!welcome) {
    // Most tests begin after onboarding; the dedicated welcome test exercises its
    // real controls. Keep this helper from changing the audio state of every case.
    await page.evaluate(() => {
      document.getElementById('start-overlay').hidden = true;
    });
  }
  if (!folded) {
    // Most of this older suite exercises the textarea itself. Unfold through the
    // editor API so setup does not add a toolbar click to Chrome's focus/undo history.
    await page.evaluate(() => window.p5jsLive.editor.setFolded(false));
    await expect(page.locator('#code-layer')).not.toHaveClass(/is-folded/);
  }
  // The drawer is closed on arrival now — the display is the visuals and the code, and
  // everything in the drawer is a setting. Tests that drive those settings open it, so
  // that the ones asserting the default state can assert it on an untouched page.
  if (tools) await openTools(page);
}

async function openTools(page) {
  const side = page.locator('#side');
  if (await side.evaluate((el) => el.classList.contains('is-hidden'))) {
    await page.locator('#tools-toggle').click();
  }
  await expect(side).not.toHaveClass(/is-hidden/);
  await openLibrary(page);
}

async function openLibrary(page) {
  await selectTool(page, 'Library');
  await expect(page.locator('#library-panel')).toBeVisible();
  const groups = page.locator('[data-library-group]');
  const count = await groups.count();
  for (let index = 0; index < count; index++) {
    const group = groups.nth(index);
    if (!(await group.evaluate((element) => element.open))) await group.locator('summary').click();
  }
}

async function selectTool(page, name) {
  const tab = page.getByRole('tab', { name: new RegExp(`^${name}`) });
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

async function openReference(page) {
  const reference = page.locator('#reference-side');
  if (await reference.evaluate((el) => el.classList.contains('is-hidden'))) {
    await page.locator('#reference-toggle').click();
  }
  await expect(reference).not.toHaveClass(/is-hidden/);
}

async function replaceInEditorAndEvaluate(page, before, after) {
  await page.evaluate(
    ({ before, after }) => {
      const editor = document.getElementById('code');
      if (!editor.value.includes(before)) throw new Error(`Editor source did not contain: ${before}`);
      editor.value = editor.value.replace(before, after);
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.focus();
      editor.selectionStart = editor.selectionEnd = editor.value.indexOf(after) + after.length;
    },
    { before, after },
  );
  await page.locator('#code').press('Control+Enter');
}

async function appendCellAndEvaluate(page, source) {
  await page.evaluate((source) => {
    const editor = document.getElementById('code');
    editor.value = `${editor.value.trimEnd()}\n\n${source}\n`;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.focus();
    editor.selectionStart = editor.selectionEnd = editor.value.length - 1;
  }, source);
  await page.locator('#code').press('Control+Enter');
}

test.describe('projection view', () => {
  test('opens a window that shows the canvas and no diagnostics', async ({ page, context }) => {
    await boot(page);

    // Put a real error in the performer's Messages panel first — the whole point of
    // Performer diagnostics must not travel to the projector.
    await page.evaluate(() =>
      window.p5jsLive.evaluator.evaluate('const rings = { draw() { ((( broken', { label: 'strategy rings' }),
    );
    await expect(page.locator('#diagnostics-list')).toContainText('Syntax error');
    await expect(page.getByRole('tab', { name: /^Messages/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#messages-panel')).toBeVisible();

    const [projector] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('button', { name: 'Open the audience projection window' }).click(),
    ]);

    await expect(projector.locator('#projection-canvas')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.p5jsLive.projection.isOpen())).toBe(true);

    const projectorText = await projector.locator('body').innerText();
    expect(projectorText).not.toContain('Syntax error');
    expect(projectorText).not.toContain('broken');
    expect(projectorText).not.toContain('rings v'); // canvas layout shows nothing at all

    // The canvas is actually receiving frames, not just present.
    const painted = await projector.evaluate(() => {
      const canvas = document.getElementById('projection-canvas');
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let nonBlack = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 12 || data[i + 1] > 12 || data[i + 2] > 12) nonBlack++;
      }
      return nonBlack;
    });
    expect(painted).toBeGreaterThan(0);

    await projector.close();
  });

  test('code layout shows the last accepted block, not a failed one', async ({
    page,
    context,
  }) => {
    await boot(page);
    await selectTool(page, 'Project');
    await page.locator('#code-size').fill('20');
    const [projector] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('button', { name: 'Open the audience projection window' }).click(),
    ]);
    await page.locator('#projection-layout').selectOption('code');

    // A successful evaluation through the editor's own path.
    await page.evaluate(() => {
      const ta = document.getElementById('code');
      ta.value = 'const rings = { draw() { circle(200, 200, 90); } };';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.focus();
      ta.selectionStart = ta.selectionEnd = 20;
    });
    await page.locator('#code').press('Control+Enter');
    await expect(projector.locator('#overlay')).toContainText('circle(200, 200, 90)');
    await expect.poll(() => projector.locator('pre').evaluate((node) => getComputedStyle(node).fontSize))
      .toBe('20px');

    // Make a second accepted version so the revert below has a real earlier version.
    await replaceInEditorAndEvaluate(
      page,
      'circle(200, 200, 90)',
      'circle(200, 200, 120)',
    );
    await expect(projector.locator('#overlay')).toContainText('circle(200, 200, 120)');

    // Now a failed one — the audience must keep seeing the good block.
    await page.evaluate(() => {
      const ta = document.getElementById('code');
      ta.value = 'const rings = { draw() { ((( totally broken';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.focus();
      ta.selectionStart = ta.selectionEnd = 20;
    });
    await page.locator('#code').press('Control+Enter');
    await page.waitForTimeout(300);

    await expect(projector.locator('#overlay')).toContainText('circle(200, 200, 120)');
    await expect(projector.locator('#overlay')).not.toContainText('totally broken');

    // A revert is an evaluation too, so the overlay must follow it.
    await selectTool(page, 'Messages');
    await page.getByRole('button', { name: 'Make rings v1 active again' }).click();
    await expect(projector.locator('#overlay')).toContainText('circle(200, 200, 90)');

    await projector.close();
  });

  test('trace layout shows layer order and audio mappings', async ({ page, context }) => {
    await boot(page);
    const [projector] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('button', { name: 'Open the audience projection window' }).click(),
    ]);
    await page.locator('#projection-layout').selectOption('trace');

    const overlay = projector.locator('#overlay');
    await expect(overlay).toContainText('scene: scene');
    await expect(overlay).toContainText('plasma v1');
    // Plasma maps all three analysed frequency bands into shader uniforms.
    await expect(overlay.locator('.trace-row', { hasText: 'plasma' })).toContainText('bass');

    await projector.close();
  });
});

test.describe('multiple copies of one strategy', () => {
  test('editing the scene array adds and removes independent copies', async ({ page }) => {
    await boot(page);
    await expect
      .poll(() => page.evaluate(() => window.p5jsLive.registry.activeOrder()))
      .toEqual(['asciiNoise', 'plasma']);
    await replaceInEditorAndEvaluate(
      page,
      'const scene = [\n  asciiNoise,\n  plasma,\n];',
      'const scene = [\n  asciiNoise,\n  plasma,\n  plasma,\n  plasma,\n];',
    );
    await expect
      .poll(() => page.evaluate(() => window.p5jsLive.registry.activeOrder()))
      .toEqual(['asciiNoise', 'plasma', 'plasma#2', 'plasma#3']);

    // The reference shows the count; the scene itself remains authoritative in code.
    await expect(page.locator('[data-strategy="plasma"]')).toContainText('×3');
    await expect(page.locator('#scene-panel')).toHaveCount(0);
    expect(await page.evaluate(() => window.p5jsLive.registry.activeOrder())).toEqual([
      'asciiNoise',
      'plasma',
      'plasma#2',
      'plasma#3',
    ]);

    // Each copy keeps its own state.
    const independent = await page.evaluate(() => {
      const s = window.p5jsLive.stateStore;
      return s.get('plasma') !== s.get('plasma#2') && s.get('plasma#2') !== s.get('plasma#3');
    });
    expect(independent).toBe(true);

    // The strip is a read-only view of source order; editing the array is the operation.
    await expect(page.locator('[data-instance="plasma#2"] button')).toHaveCount(0);
    await replaceInEditorAndEvaluate(
      page,
      'const scene = [\n  asciiNoise,\n  plasma,\n  plasma,\n  plasma,\n];',
      'const scene = [\n  asciiNoise,\n  plasma,\n  plasma,\n];',
    );
    await expect
      .poll(() => page.evaluate(() => window.p5jsLive.registry.activeOrder()))
      .toEqual(['asciiNoise', 'plasma', 'plasma#2']);
  });

  test('library insertion installs source; scene arrays activate it', async ({ page }) => {
    await boot(page);
    // Every available patch remains in the catalog, regardless of lifecycle state.
    await expect(page.locator('[data-available="laserFan"]')).toBeVisible();
    await expect(page.locator('[data-library="plasma"]')).toContainText('system');
    await expect(
      page.getByRole('button', { name: 'plasma is active and running' }),
    ).toBeDisabled();

    // The first press installs source without changing the active scene.
    await page.getByRole('button', { name: /^Install laserFan system patch source —/ }).click();
    await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.hasStrategy('laserFan'))).toBe(true);

    // Installed is deliberately not Active or Running.
    await expect(page.locator('[data-available="laserFan"]')).toHaveCount(0);
    await expect(page.locator('[data-library="laserFan"]')).toBeVisible();
    await expect(page.locator('[data-library="laserFan"]')).toContainText('Installed');
    await expect(
      page.getByRole('button', { name: 'Add installed patch laserFan to the active scene source' }),
    ).toBeVisible();
    await expect(page.locator('[data-strategy="laserFan"]')).toContainText('v1');
    expect(await page.evaluate(() => window.p5jsLive.registry.activeInstancesOf('laserFan').length)).toBe(0);

    await replaceInEditorAndEvaluate(
      page,
      'const scene = [\n  asciiNoise,\n  plasma,\n];',
      'const scene = [\n  asciiNoise,\n  laserFan,\n  laserFan,\n  plasma,\n];',
    );
    await expect
      .poll(() => page.evaluate(() => window.p5jsLive.registry.activeInstancesOf('laserFan').length))
      .toBe(2);

    // A separately named object owns its own configuration through normal properties.
    await appendCellAndEvaluate(page, `// %% configured laser scene
const pinkLasers = { ...laserFan, hue: 330, direction: -1 };
const laserScene = [laserFan, laserFan, pinkLasers, plasma];
activate(laserScene);`);
    await expect
      .poll(() =>
        page.evaluate(() => window.p5jsLive.registry.getStrategy('pinkLasers')?.definition.hue),
      )
      .toBe(330);

    // Replacing laserFan changes its two copies; the configured object is independent.
    await page.evaluate(() =>
      window.p5jsLive.evaluator.evaluate(
        'const laserFan = { draw({ state }) { state.touched = true; } };',
        { label: 'patch laserFan' },
      ),
    );
    await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.getStrategy('laserFan').version)).toBe(2);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const s = window.p5jsLive.stateStore;
          return (
            ['laserFan', 'laserFan#2'].every((id) => s.get(id)?.touched === true) &&
            s.get('pinkLasers') !== s.get('laserFan')
          );
        }),
      )
      .toBe(true);
  });

  test('Install source honors a blank cursor line between top-level cells', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      const editor = document.getElementById('code');
      const sceneMarker = '// %% scene scene';
      const anchor = '// %% patch insertionAnchor\nconst insertionAnchor = { draw() {} };';
      editor.value = editor.value.replace(sceneMarker, `${anchor}\n\n${sceneMarker}`);
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      const anchorAt = editor.value.indexOf('// %% patch insertionAnchor');
      const blankAt = editor.value.lastIndexOf('\n', anchorAt - 1);
      editor.focus();
      editor.setSelectionRange(blankAt, blankAt);
      editor.dispatchEvent(new Event('select', { bubbles: true }));
    });

    await page.getByRole('button', { name: /^Install waveScope system patch source —/ }).click();

    const order = await page.locator('#code').evaluate((editor) => ({
      plasma: editor.value.indexOf('// %% patch plasma'),
      inserted: editor.value.indexOf('// %% patch waveScope'),
      anchor: editor.value.indexOf('// %% patch insertionAnchor'),
      scene: editor.value.indexOf('// %% scene scene'),
    }));
    expect(order.plasma).toBeLessThan(order.inserted);
    expect(order.inserted).toBeLessThan(order.anchor);
    expect(order.anchor).toBeLessThan(order.scene);
  });

  test('Add to scene honors a blank cursor line in a folded scene array', async ({ page }) => {
    await boot(page, { tools: true, folded: true });
    await page.getByRole('button', { name: /^Install checkerZoom system patch source —/ }).click();

    const scene = page.locator('.folded-block', { hasText: 'scene scene' });
    await scene.locator('summary').click();
    const editor = scene.getByRole('textbox', { name: 'Edit scene scene' });
    const source = (await editor.inputValue()).replace('  plasma,\n];', '  plasma,\n\n];');
    await editor.fill(source);
    await editor.evaluate((element) => {
      const blank = element.value.indexOf('\n\n') + 1;
      element.setSelectionRange(blank, blank);
      element.dispatchEvent(new Event('select', { bubbles: true }));
    });

    const add = page
      .getByRole('button', { name: 'Add installed patch checkerZoom to the active scene source' });
    await add.scrollIntoViewIfNeeded();
    const addBox = await add.boundingBox();
    expect(addBox).not.toBeNull();
    await page.mouse.move(addBox.x + addBox.width / 2, addBox.y + addBox.height / 2);
    await page.mouse.down();
    await page.mouse.up();

    await expect(page.locator('#code')).toHaveValue(
      /const scene = \[\n  asciiNoise,\n  plasma,\n  checkerZoom,\n\];/,
    );
    expect(await page.evaluate(() => window.p5jsLive.registry.activeOrder()))
      .toEqual(['asciiNoise', 'plasma']);
  });

  test('Add to scene moves a top-level scene line down when the caret begins that line', async ({ page }) => {
    await boot(page, { tools: true });
    await page.getByRole('button', { name: /^Install checkerZoom system patch source —/ }).click();
    await page.locator('#code').evaluate((editor) => {
      const plasmaLine = editor.value.indexOf('  plasma,');
      editor.focus();
      editor.setSelectionRange(plasmaLine, plasmaLine);
      editor.dispatchEvent(new Event('select', { bubbles: true }));
    });

    await page
      .getByRole('button', { name: 'Add installed patch checkerZoom to the active scene source' })
      .click();

    await expect(page.locator('#code')).toHaveValue(
      /const scene = \[\n  asciiNoise,\n  checkerZoom,\n  plasma,\n\];/,
    );
    expect(await page.evaluate(() => window.p5jsLive.registry.activeOrder()))
      .toEqual(['asciiNoise', 'plasma']);
  });

  test('Add to scene opens only the scene cell without unfolding the project', async ({ page }) => {
    await boot(page, { tools: true, folded: true });
    await page.getByRole('button', { name: /^Install checkerZoom system patch source —/ }).click();

    await page
      .getByRole('button', { name: 'Add installed patch checkerZoom to the active scene source' })
      .click();

    await expect(page.locator('#code-layer')).toHaveClass(/is-folded/);
    await expect(page.locator('.folded-block[open]')).toHaveCount(1);
    const scene = page.locator('.folded-block[open]', { hasText: 'scene scene' });
    await expect(scene).toBeVisible();
    await expect(scene.locator('.folded-source-editor')).toBeFocused();
    await expect(scene.locator('.folded-source-editor')).toHaveValue(
      /checkerZoom,[\s\S]*plasma,/,
    );
    expect(await page.evaluate(() => window.p5jsLive.registry.activeInstancesOf('checkerZoom').length))
      .toBe(0);

    await scene.locator('.folded-source-editor').press('Control+Enter');
    await expect
      .poll(() => page.evaluate(() => window.p5jsLive.registry.activeInstancesOf('checkerZoom').length))
      .toBe(1);
  });

  test('Add to scene preserves a commented-out plasma line', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      const editor = document.getElementById('code');
      editor.value = editor.value.replace('  plasma,', '  // plasma,');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await page.getByRole('button', { name: /^Install checkerZoom system patch source —/ }).click();
    await page
      .getByRole('button', { name: 'Add installed patch checkerZoom to the active scene source' })
      .click();

    await expect(page.locator('#code')).toHaveValue(
      /const scene = \[\n  asciiNoise,\n  \/\/ plasma,\n  checkerZoom,\n\];/,
    );
    await expect(page.locator('#code')).not.toHaveValue(/\n  plasma,\n/);
    expect(await page.evaluate(() => window.p5jsLive.registry.activeOrder()))
      .toEqual(['asciiNoise', 'plasma']);
  });

  test('shows the full lifecycle from available through running', async ({ page }) => {
    await boot(page);

    const library = page.locator('#strategy-library');
    await expect(library.locator('[data-library]')).toHaveCount(29);
    await expect(page.getByRole('button', { name: /^All 29$/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-library="laserFan"]')).toHaveAttribute('data-origin', 'system');
    await expect(page.locator('[data-library="plasma"]')).toHaveAttribute('data-origin', 'system');
    await expect(page.locator('[data-available="laserFan"]')).toContainText('laserFan');
    await expect(page.locator('[data-available="waveScope"]')).toBeVisible();
    await expect(page.locator('[data-available="breathingEllipse"]')).toBeVisible();
    await expect(page.locator('[data-library="waveform"]')).toContainText('Available');
    await expect(page.locator('[data-library="frequencyBars"]')).toContainText('Available');
    await expect(page.locator('[data-library="audioMeters"]')).toContainText('Available');
    await expect(page.locator('[data-library="solidBackground"]')).toContainText('Available');
    await expect(
      library.locator('[data-library-group="utility"] [data-library="frequencyBars"]'),
    ).toBeVisible();
    await expect(
      library.locator('[data-library-group="visual"] [data-library="laserFan"]'),
    ).toBeVisible();
    await expect(
      library.locator('[data-library-group="shader"] [data-library="plasma"]'),
    ).toBeVisible();
    await expect(
      library.locator('[data-library-group="shader"] [data-library="shaderFlow"]'),
    ).toBeVisible();
    await expect(library.locator('[data-library-group="community"]')).toHaveCount(0);
    await expect(page.locator('.shader-operator-reference')).toContainText('Shader operators');

    await expect(page.locator('[data-library="laserFan"]')).toContainText('Available');
    await page.getByRole('button', { name: /^Install laserFan system patch source —/ }).click();
    await expect
      .poll(() => page.evaluate(() => window.p5jsLive.registry.hasStrategy('laserFan')))
      .toBe(true);
    await expect(page.locator('[data-available="laserFan"]')).toHaveCount(0);
    await expect(page.locator('[data-library="laserFan"]')).toBeVisible();
    await expect(page.locator('[data-library="laserFan"]')).toContainText('Installed');
    await expect(
      page.getByRole('button', { name: 'Add installed patch laserFan to the active scene source' }),
    ).toBeVisible();
    await expect(page.locator('[data-available="waveScope"]')).toBeVisible();
    expect(
      await page.evaluate(() => window.p5jsLive.registry.activeInstancesOf('laserFan').length),
    ).toBe(0);
    await expect(page.locator('#code')).toHaveValue(/\/\/ %% patch laserFan/);
    const sourceOrder = await page.locator('#code').evaluate((editor) => ({
      patch: editor.value.indexOf('// %% patch laserFan'),
      scene: editor.value.indexOf('// %% scene scene'),
    }));
    expect(sourceOrder.patch).toBeGreaterThan(-1);
    expect(sourceOrder.scene).toBeGreaterThan(sourceOrder.patch);

    // Installing only registers source. Adding changes source composition, and the
    // performer still explicitly evaluates that scene cell before anything renders.
    await page.getByRole('button', { name: 'Add installed patch laserFan to the active scene source' }).click();
    await expect(page.locator('#code')).toHaveValue(/const scene = \[[\s\S]*laserFan,/);
    await expect(
      page.getByRole('button', {
        name: 'laserFan is in the active scene source and waiting for Cmd/Ctrl+Enter',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Add installed patch laserFan to the active scene source' }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => window.p5jsLive.registry.activeInstancesOf('laserFan').length),
    ).toBe(0);
    await expect(page.locator('#diagnostics-list')).toContainText('not active yet');
    await page.locator('#code').press('Control+Enter');
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.p5jsLive.controller.snapshot().strategies.find((entry) => entry.name === 'laserFan')?.running,
        ),
      )
      .toBe(true);
    await expect(page.locator('[data-library="laserFan"]')).toContainText('Running');

    await page.getByRole('button', { name: /^Active / }).click();
    await expect(page.locator('[data-library="laserFan"]')).toBeVisible();
    await expect(page.locator('[data-library="waveScope"]')).toHaveCount(0);
    await page.getByRole('button', { name: /^All / }).click();
    await expect(page.locator('[data-available="waveScope"]')).toBeVisible();

    await page.locator('#reference-toggle').click();
    const installed = page.locator('#reference-side [data-strategy="laserFan"]');
    await installed.locator('summary').click();
    await expect(installed).toContainText('beams: 13');
    await page.getByRole('button', { name: 'Jump to laserFan source' }).click();
    expect(
      await page.locator('#code').evaluate((editor) =>
        editor.value.slice(editor.selectionStart, editor.selectionEnd),
      ),
    ).toBe('laserFan');

    // The installed patch cell must remain above the scene that references it when a
    // saved project is compiled top-to-bottom on refresh.
    await page.waitForTimeout(650);
    await page.reload();
    await page.evaluate(() => {
      document.getElementById('start-overlay').hidden = true;
    });
    await expect
      .poll(() => page.evaluate(() => window.p5jsLive.registry.activeInstancesOf('laserFan').length))
      .toBe(1);
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.p5jsLive.controller.snapshot().strategies.find((entry) => entry.name === 'laserFan')?.running,
        ),
      )
      .toBe(true);
  });

  test('recovers a broken saved project without hiding its installed source', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const source = `// %% patch frequencyBars
const frequencyBars = { draw() { ((( } };

// %% patch audioMeters
const audioMeters = { draw() { rect(20, 20, 40, 8); } };

// %% scene show
const show = [frequencyBars, audioMeters];
activate(show);`;

    await page.addInitScript((savedSource) => {
      localStorage.clear();
      localStorage.setItem('p5js-live.project.v5', JSON.stringify({
        schema: 6,
        savedAt: Date.now(),
        source: savedSource,
        safeScene: 'show',
        params: [],
      }));
    }, source);
    await page.goto('/live/index.html');
    await page.getByRole('button', { name: 'Start silent' }).click();
    await openTools(page);

    await expect
      .poll(() => page.evaluate(() => window.p5jsLive.registry.activeOrder()))
      .toEqual(['asciiNoise', 'plasma']);
    await expect
      .poll(() => page.evaluate(() => window.p5jsLive.controller.snapshot().installedPatches))
      .toEqual(['frequencyBars', 'audioMeters', 'asciiNoise', 'plasma']);
    expect(pageErrors).toEqual([]);
    await expect(page.locator('[data-library="frequencyBars"]')).toContainText('Installed');
    await expect(page.locator('[data-library="frequencyBars"]')).toContainText('Open source');
    await expect(page.locator('[data-library="audioMeters"]')).toContainText('Installed');
    await expect(page.getByRole('button', { name: /^Installed 4$/ })).toBeVisible();
    await expect(page.locator('#diagnostics-list')).toContainText('Saved project recovered with errors');
    await expect(page.locator('#code')).toHaveValue(/const frequencyBars = \{ draw\(\) \{ \(\(\(/);
  });

  test('runs a live ShaderChain through the real WebGL draw path', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: /^Install shaderFlow system patch source —/ }).click();
    await expect
      .poll(() => page.evaluate(() => window.p5jsLive.registry.hasStrategy('shaderFlow')))
      .toBe(true);

    await replaceInEditorAndEvaluate(
      page,
      'const scene = [\n  asciiNoise,\n  plasma,\n];',
      'const scene = [\n  asciiNoise,\n  shaderFlow,\n  plasma,\n];',
    );

    await expect
      .poll(() => page.evaluate(() => {
        const strategy = window.p5jsLive.controller.snapshot().strategies
          .find(({ name }) => name === 'shaderFlow');
        return { running: strategy?.running, error: strategy?.lastError?.message ?? null };
      }))
      .toEqual({ running: true, error: null });
    await expect(page.locator('[data-library="shaderFlow"]')).toContainText('Running');
  });

  test('layers a small drawing patch through modular transform shaders', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: /^Install waveTerrain system patch source —/ }).click();
    await page.getByRole('button', { name: /^Install slowRotate system patch source —/ }).click();
    await page.getByRole('button', { name: /^Install bassZoom system patch source —/ }).click();
    await page.getByRole('button', { name: /^Install prismMirror system patch source —/ }).click();

    await replaceInEditorAndEvaluate(
      page,
      'const scene = [\n  asciiNoise,\n  plasma,\n];',
      'const scene = [\n  asciiNoise,\n  waveTerrain,\n  slowRotate,\n  bassZoom,\n  prismMirror,\n  plasma,\n];',
    );

    await expect
      .poll(() => page.evaluate(() => {
        const snapshot = window.p5jsLive.controller.snapshot();
        return ['waveTerrain', 'slowRotate', 'bassZoom', 'prismMirror'].map((name) => {
          const strategy = snapshot.strategies.find((entry) => entry.name === name);
          return { name, running: strategy?.running, error: strategy?.lastError?.message ?? null };
        });
      }))
      .toEqual([
        { name: 'waveTerrain', running: true, error: null },
        { name: 'slowRotate', running: true, error: null },
        { name: 'bassZoom', running: true, error: null },
        { name: 'prismMirror', running: true, error: null },
      ]);
    await expect(page.locator('[data-library="waveTerrain"]')).toContainText('Running');
    await expect(page.locator('[data-library="slowRotate"]')).toContainText('Running');
    await expect(page.locator('[data-library="bassZoom"]')).toContainText('Running');
    await expect(page.locator('[data-library="prismMirror"]')).toContainText('Running');
  });

  test('installs and advances the Game of Life class patch', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: /^Install gameOfLife system patch source —/ }).click();
    await expect
      .poll(() => page.evaluate(() => window.p5jsLive.registry.hasStrategy('gameOfLife')))
      .toBe(true);

    await page
      .getByRole('button', { name: 'Add installed patch gameOfLife to the active scene source' })
      .click();
    await page.locator('#code').press('Control+Enter');

    await expect
      .poll(() => page.evaluate(() => {
        const state = window.p5jsLive.stateStore.get('gameOfLife');
        return {
          running: window.p5jsLive.controller.snapshot().strategies
            .find(({ name }) => name === 'gameOfLife')?.running ?? false,
          generation: state?.generation ?? 0,
          cells: state?.cells?.length ?? 0,
          living: state?.cells?.reduce((total, cell) => total + cell, 0) ?? 0,
        };
      }))
      .toMatchObject({ running: true });
    await expect
      .poll(() => page.evaluate(() => window.p5jsLive.stateStore.get('gameOfLife')?.generation ?? 0))
      .toBeGreaterThan(0);
    const population = await page.evaluate(() => {
      const cells = window.p5jsLive.stateStore.get('gameOfLife')?.cells ?? [];
      return { cells: cells.length, living: cells.reduce((total, cell) => total + cell, 0) };
    });
    expect(population.cells).toBeGreaterThan(0);
    expect(population.living).toBeGreaterThan(0);
    await expect(page.locator('[data-library="gameOfLife"]')).toContainText('Running');
  });

  test('starts with and renders the random ASCII object patch', async ({ page }) => {
    await boot(page);

    await expect
      .poll(() => page.evaluate(() => {
        const strategy = window.p5jsLive.controller.snapshot().strategies
          .find(({ name }) => name === 'asciiNoise');
        const state = window.p5jsLive.stateStore.get('asciiNoise');
        return {
          running: strategy?.running ?? false,
          error: strategy?.lastError?.message ?? null,
          cells: state?.cells?.length ?? 0,
        };
      }))
      .toMatchObject({ running: true, error: null });
    await expect
      .poll(() => page.evaluate(() => window.p5jsLive.stateStore.get('asciiNoise')?.cells.length ?? 0))
      .toBeGreaterThan(0);
    await expect(page.locator('[data-library="asciiNoise"]')).toContainText('Running');

    const before = await page.evaluate(() => window.p5jsLive.evaluator.binding('asciiNoise').shuffleVersion);
    const result = await page.evaluate(() => window.p5jsLive.evaluator.evaluate('asciiNoise.shuffle();'));
    expect(result.ok).toBe(true);
    await expect.poll(() => page.evaluate(() => window.p5jsLive.evaluator.binding('asciiNoise').shuffleVersion))
      .toBe(before + 1);
  });

  test('runs an anonymous arrow directly from a live scene array', async ({ page }) => {
    await boot(page, { tools: false });
    await appendCellAndEvaluate(page, `// %% scene inlineShow
const inlineShow = [
  ({ time, audio, state }) => {
    state.frames = (state.frames || 0) + 1;
    noStroke();
    fill(255, 80, 220);
    circle(
      width / 2 + cos(time) * 120,
      height / 2,
      30 + audio.bass * 80
    );
  },
];
activate(inlineShow);`);

    await expect
      .poll(() => page.evaluate(() => ({
        order: window.p5jsLive.registry.activeOrder(),
        frames: window.p5jsLive.stateStore.get('inlineShow[0]')?.frames ?? 0,
        running: window.p5jsLive.controller.snapshot().strategies
          .find(({ name }) => name === 'inlineShow[0]')?.running ?? false,
      })))
      .toMatchObject({ order: ['inlineShow[0]'], running: true });
    await expect
      .poll(() => page.evaluate(() => window.p5jsLive.stateStore.get('inlineShow[0]')?.frames ?? 0))
      .toBeGreaterThan(2);
  });

  test('installed strategies expose a read-only reference and jump to their source', async ({ page }) => {
    await boot(page, { tools: false });
    await openReference(page);
    await expect(page.locator('#side')).toHaveClass(/is-hidden/);
    await expect(page.locator('#reference-side [data-available]')).toHaveCount(0);
    await expect(page.locator('#reference-side #audio-source')).toHaveCount(0);

    const plasma = page.locator('#reference-side [data-strategy="plasma"]');
    await plasma.locator('summary').click();
    await expect(plasma).toContainText('Plasma instance · running');
    await expect(plasma).toContainText('speed: 0.35');
    await expect(plasma).toContainText('motion: 0.48');
    await expect(plasma).toContainText('intensity({ audio })');
    await expect(plasma).toContainText('warp({ audio })');
    await expect(plasma).toContainText('draw({ audio, time, canvas })');
    await expect(plasma).toContainText('dispose()');

    // They are genuinely separate surfaces, never two layers of one combined drawer.
    await page.locator('#tools-toggle').click();
    await expect(page.locator('#side')).not.toHaveClass(/is-hidden/);
    await expect(page.locator('#reference-side')).toHaveClass(/is-hidden/);
    await expect(page.locator('#reference-side')).toHaveCSS('pointer-events', 'none');
    await page.locator('#reference-toggle').click();
    await expect(page.locator('#side')).toHaveClass(/is-hidden/);
    await expect(page.locator('#reference-side')).not.toHaveClass(/is-hidden/);

    await page.getByRole('button', { name: 'Jump to plasma source' }).click();
    await expect(page.locator('#reference-side')).toHaveClass(/is-hidden/);
    await expect(page.locator('#code')).toBeFocused();
    expect(
      await page.locator('#code').evaluate((editor) =>
        editor.value.slice(editor.selectionStart, editor.selectionEnd),
      ),
    ).toBe('plasma');
  });
});

test.describe('the demo scene', () => {
  test('builds even after the project has been reset away', async ({ page }) => {
    await boot(page);
    // Wipe everything. The demo must not depend on the starter Plasma patch.
    await page.evaluate(() => {
      const R = window.p5jsLive;
      R.host.reset();
      R.registry.reset();
      R.stateStore.clear();
    });
    expect(await page.evaluate(() => window.p5jsLive.registry.hasStrategy('plasma'))).toBe(false);
    await openLibrary(page);
    await expect(page.locator('#scene-panel')).toHaveCount(0);
    await expect(page.locator('#library-panel')).toContainText(
      'Add to scene edits the scene array in the code',
    );
    await expect(page.getByRole('button', { name: 'Insert a configured library scene into the source' })).toBeVisible();

    await page.getByRole('button', { name: 'Insert a configured library scene into the source' }).click();

    expect(await page.evaluate(() => window.p5jsLive.registry.activeSceneName())).toBe(null);
    await expect(page.locator('#diagnostics-list')).toContainText('not active yet');
    await page.locator('#code').press('Control+Enter');

    await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.activeSceneName())).toBe(
      'stacked',
    );
    await expect
      .poll(() => page.evaluate(() => window.p5jsLive.registry.activeOrder()))
      .toEqual([
        'checkerZoom',
        'neonTunnel',
        'spectrumHalo',
        'kaleido',
        'pixelRain',
        'waveScope',
        'laserFan',
        'glitchSlices',
        'beatBurst',
        'strobe',
      ]);
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.p5jsLive.controller.snapshot().strategies
            .filter((entry) => [
              'checkerZoom',
              'neonTunnel',
              'spectrumHalo',
              'kaleido',
              'pixelRain',
              'waveScope',
              'laserFan',
              'glitchSlices',
              'beatBurst',
              'strobe',
            ].includes(entry.name))
            .every((entry) => entry.running),
        ),
      )
      .toBe(true);
    expect(
      await page.evaluate(() =>
        window.p5jsLive.registry.listParams().find((entry) => entry.name === 'checkerSpeed')?.value,
      ),
    ).toBe(0.08);
    expect(
      await page.evaluate(() =>
        window.p5jsLive.diagnostics.list().filter((d) => d.level === 'error').length,
      ),
    ).toBe(0);
  });

  test('mixes exactly the ten system patches when starter Plasma is present', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: 'Insert a configured library scene into the source' }).click();
    await expect(page.locator('#diagnostics-list')).toContainText('not active yet');
    await page.locator('#code').press('Control+Enter');
    await expect
      .poll(() => page.evaluate(() => window.p5jsLive.registry.activeOrder()))
      .toEqual([
        'checkerZoom',
        'neonTunnel',
        'spectrumHalo',
        'kaleido',
        'pixelRain',
        'waveScope',
        'laserFan',
        'glitchSlices',
        'beatBurst',
        'strobe',
      ]);
  });
});

test.describe('the minimal display', () => {
  test('keeps labeled play/pause and loop controls visible and synchronized', async ({ page }) => {
    await boot(page, { tools: false, folded: true, welcome: true });

    const play = page.locator('#play-toggle');
    const loop = page.locator('#loop-performance-toggle');
    await expect(play).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.p5jsLive.audio.status().source))
      .toBe('none');
    await expect(play).toBeDisabled();
    await expect(play).toHaveAttribute('aria-label', /^(Play|Pause) audio$/);
    await expect(loop).toBeVisible();
    await expect(loop).toHaveAttribute('aria-pressed', 'false');

    await page.locator('#audio-file').setInputFiles(TONE);
    await expect(page.locator('#start-overlay')).toBeHidden({ timeout: 15_000 });
    await expect(play).toBeEnabled();
    await expect(play).toHaveAttribute('aria-label', 'Pause audio');

    await loop.click();
    await expect(loop).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => window.p5jsLive.audio.status().looping)).toBe(true);

    await play.click();
    await expect.poll(() => page.evaluate(() => window.p5jsLive.audio.status().playing)).toBe(false);
    await expect(play).toHaveAttribute('aria-label', 'Play audio');

    await page.locator('#tools-toggle').click();
    await selectTool(page, 'Audio');
    await expect(page.locator('#loop-toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  test('introduces p5js live and offers three explicit ways to begin', async ({ page }) => {
    await boot(page, { tools: false, folded: true, welcome: true });

    const welcome = page.getByRole('dialog', { name: 'p5js live' });
    await expect(welcome).toBeVisible();
    const frameBefore = await page.evaluate(() => window.frameCount);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.frameCount)).toBeGreaterThan(frameBefore);
    await expect(welcome).toBeVisible();
    const mascot = welcome.getByAltText(
      'Cartoon live coder wearing headphones at a laptop',
    );
    await expect(mascot).toBeVisible();
    expect(await mascot.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
    await expect(
      welcome.getByRole('link', {
        name: 'Department of Arts and Entertainment Technologies',
      }),
    ).toHaveAttribute('href', 'https://aet.utexas.edu/');
    await expect(welcome).toContainText('browser-based visual instrument');
    await expect(welcome).toContainText('Created by Eric Freeman');
    await expect(welcome).not.toContainText('last successful scene keeps running');
    await expect(welcome).not.toContainText('An ordered array of patches');
    await expect(welcome.getByRole('button', { name: 'Audio file' })).toBeVisible();
    await expect(welcome.getByRole('button', { name: 'Microphone' })).toBeVisible();
    await expect(welcome.getByRole('button', { name: 'Start silent' })).toBeVisible();
    await expect(welcome).toContainText('Files: MP3, WAV, OGG, M4A, AAC');
    await expect(page.locator('#audio-file')).toHaveAttribute(
      'accept',
      '.mp3,.wav,.ogg,.m4a,.aac',
    );
    await expect(page.locator('#audio-file-2')).toHaveAttribute(
      'accept',
      '.mp3,.wav,.ogg,.m4a,.aac',
    );

    await page.mouse.move(0, 0);
    await page.evaluate(() => document.activeElement?.blur());
    const visualTokens = await welcome.evaluate((dialog) => {
      const card = dialog.querySelector('.welcome-card');
      const hero = dialog.querySelector('.welcome-hero');
      const title = dialog.querySelector('#welcome-title');
      const primary = dialog.querySelector('.start-primary');
      return {
        cardWidth: card.getBoundingClientRect().width,
        heroBackground: getComputedStyle(hero).backgroundColor,
        titleColor: getComputedStyle(title).color,
        primaryBackground: getComputedStyle(primary).backgroundColor,
        primaryRadius: getComputedStyle(primary).borderRadius,
      };
    });
    expect(visualTokens.cardWidth).toBeLessThanOrEqual(560);
    expect(visualTokens.heroBackground).toBe('rgb(193, 188, 242)');
    expect(visualTokens.titleColor).toBe('rgb(91, 63, 166)');
    expect(visualTokens.primaryBackground).toBe('rgb(91, 63, 166)');
    expect(visualTokens.primaryRadius).toBe('7px');

    await expect.poll(() => page.evaluate(() => window.p5jsLive.audio.status().source))
      .toBe('none');
    await expect.poll(() => page.evaluate(() => window.p5jsLive.audio.status().playing))
      .toBe(false);

    await welcome.getByRole('button', { name: 'Start silent' }).click();
    await expect(welcome).toBeHidden();
    await expect(page.locator('#stage canvas')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.p5jsLive.audio.status().source)).toBe('none');
    await expect.poll(() => page.evaluate(() => window.p5jsLive.audio.status().playing)).toBe(false);
  });

  test('shows transfer and decoding progress while an audio file loads', async ({ page }) => {
    await boot(page, { tools: false, folded: true, welcome: true });
    const welcome = page.getByRole('dialog', { name: 'p5js live' });
    const initialHeight = await welcome.evaluate((element) => element.getBoundingClientRect().height);
    await page.evaluate(() => {
      window.loadSound = (_url, onSuccess, onFailure, onProgress) => {
        window.__testAudioLoad = { onSuccess, onFailure, onProgress };
      };
    });

    await page.locator('#audio-file').setInputFiles({
      name: 'long-set.mp3',
      mimeType: 'audio/mpeg',
      buffer: Buffer.from('test audio bytes'),
    });
    const loadState = page.locator('#start-load-state');
    await expect(loadState).toBeVisible();
    await expect(page.locator('#start-load-label')).toHaveText('Loading long-set.mp3…');
    const loadingHeight = await welcome.evaluate((element) => element.getBoundingClientRect().height);
    expect(Math.abs(loadingHeight - initialHeight)).toBeLessThanOrEqual(1);

    await page.evaluate(() => window.__testAudioLoad.onProgress(0.42));
    await expect(page.locator('#start-load-label')).toHaveText('Loading long-set.mp3 — 42%');
    await expect(page.locator('#start-load-progress')).toHaveJSProperty('value', 0.42);

    await page.evaluate(() => window.__testAudioLoad.onProgress(0.99));
    await expect(page.locator('#start-load-label')).toHaveText('Decoding long-set.mp3…');
    await expect(page.locator('#start-load-progress')).not.toHaveAttribute('value');

    await page.evaluate(() => window.__testAudioLoad.onFailure(new Error('test decode failure')));
    await expect(loadState).toBeHidden();
    await expect(page.getByRole('dialog', { name: 'p5js live' })).toBeVisible();
    await expect(page.locator('#start-note')).toContainText('Could not decode long-set.mp3');
    await expect(page.locator('#start-note')).toContainText('start silent');
  });

  test('can unfold every cell and still fold any object or function again', async ({ page }) => {
    await boot(page, { tools: false, folded: true });
    await expect(page.locator('#code-layer')).toHaveClass(/is-folded/);
    await expect(page.locator('.folded-block', { hasText: 'patch plasma' })).toBeVisible();
    await expect(page.locator('.folded-block', { hasText: 'scene scene' })).toBeVisible();
    await expect(page.locator('.folded-block', { hasText: 'patch plasma' }).locator('summary'))
      .toContainText('// %% patch plasma');
    await expect(
      page.locator('.folded-block', { hasText: 'patch plasma' }).locator('.folded-line.folded-closed'),
    ).toHaveText(/^\d+$/);

    const foldedSurfaces = await page.evaluate(() => {
      const alpha = (selector) => {
        const color = getComputedStyle(document.querySelector(selector)).backgroundColor;
        return Number(color.match(/[\d.]+\)$/)?.[0].slice(0, -1) ?? (color === 'transparent' ? 0 : 1));
      };
      return {
        blocks: alpha('#folded-blocks'),
        codeLine: alpha('.folded-preview'),
      };
    });
    expect(foldedSurfaces.blocks).toBe(0);
    expect(foldedSurfaces.codeLine).toBeGreaterThan(0);
    expect(foldedSurfaces.codeLine).toBeLessThan(0.4);

    const plasma = page.locator('.folded-block', { hasText: 'patch plasma' });
    const summary = plasma.locator('summary');
    const disclosure = await summary.evaluate((element) => {
      const marker = getComputedStyle(element, '::before');
      const codeSize = Number.parseFloat(getComputedStyle(element).fontSize);
      return {
        content: marker.content,
        fontSize: Number.parseFloat(marker.fontSize),
        height: Number.parseFloat(marker.height),
        left: Number.parseFloat(marker.left),
        width: Number.parseFloat(marker.width),
        codeSize,
      };
    });
    expect(disclosure.content).toContain('▸');
    expect(disclosure.fontSize).toBeGreaterThanOrEqual(disclosure.codeSize * 0.7);
    expect(disclosure.height).toBeGreaterThanOrEqual(28);
    expect(disclosure.width).toBeGreaterThanOrEqual(25);

    // Click the visible disclosure control itself, not the much larger summary row.
    await summary.click({
      position: {
        x: disclosure.left + disclosure.width / 2,
        y: disclosure.height / 2 + 3,
      },
    });
    await expect(plasma.locator('.folded-source')).toContainText('class Plasma');
    await expect(plasma.locator('.folded-line.folded-open')).toHaveText(/^\d+$/);

    const columns = await page.evaluate(() => {
      const textRect = (element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getBoundingClientRect();
      };
      const closed = document.querySelector('.folded-block:not([open]) summary');
      const open = document.querySelector('.folded-block[open] summary');
      const mirror = open.parentElement.querySelector('.folded-source-mirror');
      const numbers = open.parentElement.querySelector('.folded-source-numbers');
      return {
        code: [
          Math.round(textRect(closed.querySelector('.folded-preview')).left),
          Math.round(textRect(open.querySelector('.folded-preview.folded-open')).left),
          Math.round(mirror.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(mirror).paddingLeft)),
        ],
        numbers: [
          Math.round(textRect(closed.querySelector('.folded-line')).right),
          Math.round(textRect(open.querySelector('.folded-line.folded-open')).right),
          Math.round(textRect(numbers).right),
        ],
      };
    });
    expect(new Set(columns.code).size).toBe(1);
    expect(new Set(columns.numbers).size).toBe(1);

    // Expanded source edits in place: the other cells stay folded and the complete
    // hidden buffer receives the same edit.
    const foldedEditor = plasma.getByRole('textbox', { name: 'Edit patch plasma' });
    await foldedEditor.click();
    await expect(foldedEditor).toHaveCSS('outline-style', 'none');
    await expect(plasma.locator('.folded-source')).toHaveCSS('box-shadow', 'none');
    await page.evaluate(() => {
      const editor = document.querySelector('.folded-block[open] .folded-source-editor');
      const at = editor.value.indexOf('0.004');
      editor.focus();
      editor.setSelectionRange(at, at + '0.004'.length);
    });
    await foldedEditor.pressSequentially('0.006');
    await expect(page.locator('#code-layer')).toHaveClass(/is-folded/);
    await expect(page.locator('#code')).toHaveValue(/warp = \(\{ audio \}\) => 0\.006/);

    await foldedEditor.press('Control+Alt+]');
    await expect(page.locator('#code-layer')).toHaveClass(/is-folded/);
    const blockCount = await page.locator('.folded-block').count();
    await expect(page.locator('.folded-block[open]')).toHaveCount(blockCount);

    // "Unfold all" keeps the disclosure controls alive, so any declaration can be
    // collapsed again immediately rather than dropping into a folding dead end.
    await plasma.locator('summary').click();
    await expect(plasma).not.toHaveAttribute('open', '');

    // The complete textarea also carries one fold control per top-level object,
    // function, class or scene. Using one returns to the structured editor with only
    // that declaration collapsed.
    await page.evaluate(() => window.p5jsLive.editor.setFolded(false));
    await expect(page.locator('#code-layer')).not.toHaveClass(/is-folded/);
    await expect(page.getByRole('button', { name: 'Fold patch plasma' })).toBeVisible();
    await page.getByRole('button', { name: 'Fold patch plasma' }).click();
    await expect(page.locator('#code-layer')).toHaveClass(/is-folded/);
    await expect(plasma).not.toHaveAttribute('open', '');
  });

  test('select all from a folded cell selects and deletes the complete project', async ({ page }) => {
    await boot(page, { tools: false, folded: true });
    const plasma = page.locator('.folded-block', { hasText: 'patch plasma' });
    await plasma.locator('summary').click();
    const foldedEditor = plasma.getByRole('textbox', { name: 'Edit patch plasma' });
    await foldedEditor.focus();

    await foldedEditor.press('Control+a');
    await expect(page.locator('#code-layer')).not.toHaveClass(/is-folded/);
    const selection = await page.locator('#code').evaluate((editor) => ({
      start: editor.selectionStart,
      end: editor.selectionEnd,
      length: editor.value.length,
    }));
    expect(selection).toEqual({ start: 0, end: selection.length, length: selection.length });

    // A synthetic key has no browser default action. The application itself must
    // remove the range, covering Chrome/macOS paths where native deletion is skipped.
    await page.locator('#code').dispatchEvent('keydown', { key: 'Backspace' });
    await expect(page.locator('#code')).toHaveValue('');
  });

  test('briefly acknowledges evaluation on the visible folded patch', async ({ page }) => {
    await boot(page, { tools: false, folded: true });
    const plasma = page.locator('.folded-block', { hasText: 'patch plasma' });
    await plasma.locator('summary').click();

    // The key event and observation share one browser task so the intentionally short
    // acknowledgement cannot disappear before Playwright asks for its state.
    const flashed = await page.evaluate(() => {
      const editor = document.querySelector('.folded-block[open] .folded-source-editor');
      editor.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }),
      );
      return editor.parentElement
        .querySelector('.folded-source-mirror')
        .classList.contains('flash-ok');
    });
    expect(flashed).toBe(true);
    await expect(plasma.locator('.folded-source-mirror')).not.toHaveClass(/flash-ok/, {
      timeout: 500,
    });

    const redFailureFlash = await page.evaluate(() => {
      const editor = document.querySelector('.folded-block[open] .folded-source-editor');
      editor.value = '  draw() { ((( }\n};';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }),
      );
      return editor.parentElement
        .querySelector('.folded-source-mirror')
        .classList.contains('flash-bad');
    });
    expect(redFailureFlash).toBe(true);
  });

  test('arrives as the visuals, the code, and nothing else', async ({ page }) => {
    await boot(page, { tools: false });

    // The drawer is closed, so the only chrome on the canvas is the code in one
    // corner and the glyph row in the other.
    await expect(page.locator('#side')).toHaveClass(/is-hidden/);
    await expect(page.locator('#reference-side')).toHaveClass(/is-hidden/);
    await expect(page.locator('#code')).toBeVisible();
    await expect(page.locator('#icons')).toBeVisible();

    // The code lies on the visuals rather than sitting in a panel: no border, edge to
    // edge, and its own surface carries no fill at all.
    const code = await page.evaluate(() => {
      const cs = getComputedStyle(document.getElementById('code'));
      const box = document.getElementById('code').getBoundingClientRect();
      const alpha = Number(cs.backgroundColor.match(/[\d.]+\)$/)?.[0].slice(0, -1) ?? 1);
      return { border: cs.borderTopWidth, alpha, w: box.width, h: box.height };
    });
    expect(code.border).toBe('0px');
    expect(code.alpha).toBe(0);
    expect(code.w).toBe(await page.evaluate(() => window.innerWidth));
    expect(code.h).toBe(await page.evaluate(() => window.innerHeight));

    // Whether it is still running is the one thing that is never behind a toggle.
    await expect(page.locator('#runtime-bar')).toBeVisible();
  });

  test('each line carries its own box, sized to its own text', async ({ page }) => {
    await boot(page, { tools: false });

    // The mirror has one element per line of the buffer, and they line up with the
    // textarea's own metrics — if they drift, the caret sits off the glyphs.
    const lines = await page.evaluate(() => document.getElementById('code').value.split('\n').length);
    await expect(page.locator('#code-mirror > span')).toHaveCount(lines);
    const labels = (await page.locator('#line-numbers').textContent()).split('\n');
    expect(labels).toHaveLength(lines);
    expect(labels[0]).toBe('1');
    expect(labels.at(-1)).toBe(String(lines));

    const metrics = await page.evaluate(() => {
      const pick = (id) => {
        const cs = getComputedStyle(document.getElementById(id));
        return [cs.fontFamily, cs.fontSize, cs.lineHeight, cs.padding, cs.letterSpacing].join('|');
      };
      const spans = [...document.querySelectorAll('#code-mirror > span')];
      const wide = spans.find((s) => s.textContent.length > 40);
      const blank = spans.find((s) => s.textContent === '');
      return {
        same: pick('code') === pick('code-mirror'),
        fontSize: getComputedStyle(document.getElementById('code')).fontSize,
        lineAlpha: Number(
          getComputedStyle(wide).backgroundColor.match(/[\d.]+\)$/)?.[0].slice(0, -1) ?? 1,
        ),
        wideWidth: wide.getBoundingClientRect().width,
        blankWidth: blank.getBoundingClientRect().width,
        blankHeight: blank.getBoundingClientRect().height,
        full: document.getElementById('code-mirror').getBoundingClientRect().width,
      };
    });
    expect(metrics.same).toBe(true);
    expect(metrics.fontSize).toBe('15px');
    expect(metrics.lineAlpha).toBeGreaterThan(0);
    expect(metrics.lineAlpha).toBeLessThan(0.4);
    // A line's box hugs its text: wider than nothing, narrower than the window.
    expect(metrics.wideWidth).toBeGreaterThan(100);
    expect(metrics.wideWidth).toBeLessThan(metrics.full);
    // A blank line keeps its height and draws no box.
    expect(metrics.blankWidth).toBe(0);
    expect(metrics.blankHeight).toBeGreaterThan(0);
  });

  test('code size changes every editor presentation and persists locally', async ({ page }) => {
    await boot(page);
    await selectTool(page, 'Project');
    await page.locator('#code-size').fill('22');

    await expect(page.locator('#code-size-value')).toHaveText('22px');
    await expect.poll(() => page.evaluate(() => ({
      editor: getComputedStyle(document.getElementById('code')).fontSize,
      line: getComputedStyle(document.getElementById('code')).lineHeight,
      folded: getComputedStyle(document.querySelector('.folded-block > summary')).fontSize,
      number: getComputedStyle(document.getElementById('line-numbers')).fontSize,
    }))).toEqual({ editor: '22px', line: '32px', folded: '22px', number: '18px' });

    await page.reload();
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.getElementById('code')).fontSize))
      .toBe('22px');
    await expect(page.locator('#code-size')).toHaveValue('22');
  });

  test('large folded code uses the viewport and keeps syntax aligned while scrolling', async ({ page }) => {
    await boot(page, { folded: true });
    await selectTool(page, 'Project');
    await page.locator('#code-size').fill('24');
    const plasma = page.locator('.folded-block', { hasText: 'patch plasma' });
    await plasma.locator('summary').click();
    const editor = plasma.getByRole('textbox', { name: 'Edit patch plasma' });

    const bounds = await page.evaluate(() => ({
      viewport: window.innerWidth,
      folded: document.getElementById('folded-blocks').getBoundingClientRect().width,
      editorRight: document.querySelector('.folded-block[open] .folded-source-editor')
        .getBoundingClientRect().right,
    }));
    expect(bounds.folded).toBeGreaterThan(bounds.viewport - 40);
    expect(bounds.editorRight).toBeLessThanOrEqual(bounds.viewport);

    const scroll = await editor.evaluate((node) => {
      node.scrollLeft = Math.min(240, node.scrollWidth - node.clientWidth);
      node.dispatchEvent(new Event('scroll'));
      const mirror = node.parentElement.querySelector('.folded-source-mirror');
      return {
        available: node.scrollWidth > node.clientWidth,
        editor: node.scrollLeft,
        mirror: mirror.scrollLeft,
      };
    });
    expect(scroll.available).toBe(true);
    expect(scroll.editor).toBeGreaterThan(0);
    expect(scroll.mirror).toBe(scroll.editor);
  });

  test('the mirror follows the editor scroll, however it moved', async ({ page }) => {
    await boot(page, { tools: false });
    const scrollTops = () =>
      page.evaluate(() => ({
        code: document.getElementById('code').scrollTop,
        mirror: document.getElementById('code-mirror').scrollTop,
        numbers: document.getElementById('line-numbers').scrollTop,
      }));

    // Scrolling the textarea takes the mirror with it — with the editor unfocused,
    // because the wheel scrolls it without focusing it and the alignment cannot be
    // conditional on focus.
    await page.evaluate(() => {
      document.getElementById('code').blur();
      document.getElementById('code').scrollTop = 450;
    });
    await expect.poll(scrollTops).toEqual({ code: 450, mirror: 450, numbers: 450 });

    // And a mirror knocked out of alignment by any means repairs itself, focused or
    // not. This is the failure it guards: a mirror left behind paints the text below
    // where the caret is, which reads as the caret sitting lines too high — and it
    // gets worse the further down the buffer the performer has scrolled.
    await page.evaluate(() => {
      document.getElementById('code-mirror').scrollTop = 0;
    });
    await expect.poll(scrollTops).toEqual({ code: 450, mirror: 450, numbers: 450 });

    // Focused, too — whatever focusing does to the scroll, the two stay together.
    await page.locator('#code').focus();
    await page.evaluate(() => {
      document.getElementById('code-mirror').scrollTop = 12;
    });
    await expect.poll(async () => {
      const { code, mirror, numbers } = await scrollTops();
      return code === mirror && code === numbers;
    }).toBe(true);

    // Arrow keys walking the caret off the bottom scroll the textarea; the mirror has
    // to come along, and this is the path that does not reliably announce itself.
    await page.evaluate(() => {
      const ta = document.getElementById('code');
      ta.setSelectionRange(0, 0);
      ta.scrollTop = 0;
    });
    await expect.poll(scrollTops).toEqual({ code: 0, mirror: 0, numbers: 0 });
    for (let i = 0; i < 45; i++) await page.locator('#code').press('ArrowDown');
    await page.waitForTimeout(120);
    const after = await scrollTops();
    expect(after.code).toBeGreaterThan(0);
    expect(after.mirror).toBe(after.code);
    expect(after.numbers).toBe(after.code);
  });

  test('the caret lands on the line the mirror painted, deep into the buffer', async ({ page }) => {
    // A tall viewport and a long buffer, because this failure accumulates: a pitch
    // difference of a fraction of a pixel per line is invisible at the top of the
    // first screen and a whole line out several hundred lines down.
    await page.setViewportSize({ width: 1348, height: 1132 });
    await boot(page);
    await page.getByRole('button', { name: 'Insert a configured library scene into the source' }).click();
    await page.locator('#tools-toggle').click();
    await expect.poll(() => page.evaluate(() => document.getElementById('code').value.split('\n').length))
      .toBeGreaterThan(300);

    const mismatches = [];
    for (const scroll of [0, 1200, 4000, 7900]) {
      await page.evaluate((s) => {
        const ta = document.getElementById('code');
        ta.scrollTop = s;
        ta.dispatchEvent(new Event('scroll'));
      }, scroll);
      await page.waitForTimeout(60);

      const targets = await page.evaluate(() => {
        const out = [];
        [...document.querySelectorAll('#code-mirror > span')].forEach((s, i) => {
          const r = s.getBoundingClientRect();
          if (r.top > 20 && r.bottom < window.innerHeight - 20 && r.width > 140) {
            out.push({ line: i, x: Math.round(r.left + 50), y: Math.round(r.top + r.height / 2) });
          }
        });
        // Top, middle and bottom of the viewport is enough to catch a drift.
        return [out[0], out[Math.floor(out.length / 2)], out[out.length - 1]].filter(Boolean);
      });

      for (const t of targets) {
        await page.mouse.click(t.x, t.y);
        const got = await page.evaluate(() => {
          const ta = document.getElementById('code');
          return ta.value.slice(0, ta.selectionStart).split('\n').length - 1;
        });
        if (got !== t.line) mismatches.push({ scroll, expected: t.line, got });
      }
    }
    expect(mismatches).toEqual([]);
  });

  test('undo survives an indent', async ({ page }) => {
    await boot(page, { tools: false });
    const code = page.locator('#code');
    const original = await code.inputValue();
    await code.focus();
    await page.evaluate(() => {
      const ta = document.getElementById('code');
      ta.setSelectionRange(0, 0);
    });

    await code.pressSequentially('alpha');
    await code.press('Tab'); // used to wipe the browser's undo stack outright
    await code.pressSequentially('beta');
    expect(await code.inputValue()).toContain('alpha  beta');

    // Back over the typing, then back over the indent itself.
    for (let i = 0; i < 12; i++) await code.press('ControlOrMeta+z');
    const undone = await code.inputValue();
    expect(undone).toBe(original);

    // And the mirror shows what the textarea now holds, not what it held before.
    const firstLine = await page.locator('#code-mirror > span').first().textContent();
    expect(firstLine).toBe(undone.split('\n')[0]);
  });

  test('Enter indents brace pairs and closing braces outdent', async ({ page }) => {
    await boot(page, { tools: false });
    const code = page.locator('#code');
    await code.focus();

    await page.evaluate(() => {
      const editor = document.getElementById('code');
      editor.value = 'const shape = {}';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      const at = editor.value.indexOf('{') + 1;
      editor.setSelectionRange(at, at);
    });
    await code.press('Enter');
    expect(await code.inputValue()).toBe('const shape = {\n  \n}');

    await page.evaluate(() => {
      const editor = document.getElementById('code');
      editor.value = 'function drawShape() {\n  ';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.setSelectionRange(editor.value.length, editor.value.length);
    });
    await code.pressSequentially('}');
    expect(await code.inputValue()).toBe('function drawShape() {\n}');

    // Regression for the Orbiters case: after an ordinary statement, the new line
    // stays aligned with its siblings rather than drifting one level deeper.
    await page.evaluate(() => {
      const editor = document.getElementById('code');
      editor.value = '    noStroke();\n    fill(255);';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.setSelectionRange(editor.value.length, editor.value.length);
    });
    await code.press('Enter');
    expect(await code.inputValue()).toBe('    noStroke();\n    fill(255);\n    ');
  });

  test('Cmd/Ctrl+/ toggles comments for every selected line', async ({ page }) => {
    await boot(page, { tools: false });
    const code = page.locator('#code');
    await code.focus();
    const original = '  alpha();\n  beta();\n';

    await page.evaluate((source) => {
      const editor = document.getElementById('code');
      editor.value = source;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.setSelectionRange(0, source.length - 1);
    }, original);

    await code.press('ControlOrMeta+/');
    expect(await code.inputValue()).toBe('  // alpha();\n  // beta();\n');
    await code.press('ControlOrMeta+/');
    expect(await code.inputValue()).toBe(original);

    // Mixed selections deliberately add one reversible outer layer. A patch that
    // was already disabled stays disabled after commenting and restoring its group.
    const mixed = '  solidBackground,\n  // checkerZoom,\n  laserFan,\n';
    await page.evaluate((source) => {
      const editor = document.getElementById('code');
      editor.value = source;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.setSelectionRange(0, source.length - 1);
    }, mixed);
    await code.press('ControlOrMeta+/');
    expect(await code.inputValue()).toBe(
      '  // solidBackground,\n  // // checkerZoom,\n  // laserFan,\n',
    );
    await code.press('ControlOrMeta+/');
    expect(await code.inputValue()).toBe(mixed);
  });

  test('"e" hides the code, and the sketch does not notice', async ({ page }) => {
    await boot(page, { tools: false });
    await page.locator('#code').focus();
    await page.locator('#code').press('Escape');

    await page.keyboard.press('e');
    await expect(page.locator('#code-layer')).toHaveClass(/is-hidden/);
    await page.keyboard.press('e');
    await expect(page.locator('#code-layer')).not.toHaveClass(/is-hidden/);

    expect(await page.evaluate(() => window.p5jsLive.registry.activeOrder()))
      .toEqual(['asciiNoise', 'plasma']);
  });

  test('creates a handwritten object patch between folded cells', async ({ page }) => {
    await boot(page, { tools: false, folded: true });

    const add = page.getByRole('button', {
      name: 'New patch between patch plasma and scene scene',
    });
    await expect(add).toBeVisible();

    const plasma = page.locator('.folded-block[data-block-description="patch plasma"]');
    const scene = page.locator('.folded-block[data-block-description="scene scene"]');
    const [plasmaBefore, sceneBefore, addBefore] = await Promise.all([
      plasma.boundingBox(),
      scene.boundingBox(),
      add.boundingBox(),
    ]);
    expect(plasmaBefore).not.toBeNull();
    expect(sceneBefore).not.toBeNull();
    expect(addBefore).not.toBeNull();
    expect(sceneBefore.y - (plasmaBefore.y + plasmaBefore.height)).toBeLessThanOrEqual(1);
    expect(addBefore.y + addBefore.height / 2).toBeCloseTo(
      sceneBefore.y + Math.min(sceneBefore.height, 28) / 2,
      0,
    );

    await add.click();

    const name = page.getByRole('textbox', { name: 'New patch name' });
    await expect(name).toBeFocused();
    await expect.poll(async () => (await scene.boundingBox()).y).toBeGreaterThan(sceneBefore.y);
    await name.fill('class');
    await name.press('Enter');
    await expect(page.getByRole('alert')).toHaveText('class is reserved. Choose another name.');

    await name.fill('customPulse');
    await name.press('Enter');

    const patch = page.locator('.folded-block[data-block-description="patch customPulse"]');
    await expect(patch).toBeVisible();
    await expect(patch).toHaveAttribute('open', '');
    const body = patch.getByRole('textbox', { name: 'Edit patch customPulse' });
    await expect(body).toBeFocused();
    await expect(body).toHaveValue(/const customPulse = \{\n  draw\(\{ time, audio \}\) \{/);
    expect(await body.evaluate((element) => ({
      start: element.selectionStart,
      before: element.value.slice(0, element.selectionStart),
    }))).toMatchObject({
      before: expect.stringMatching(/draw\(\{ time, audio \}\) \{\n    $/),
    });

    const source = await page.locator('#code').inputValue();
    expect(source.indexOf('// %% patch customPulse')).toBeLessThan(
      source.indexOf('// %% scene scene'),
    );
    expect(await page.evaluate(() => window.p5jsLive.registry.hasStrategy('customPulse'))).toBe(false);

    await body.press('Control+Enter');
    await expect.poll(
      () => page.evaluate(() => window.p5jsLive.registry.hasStrategy('customPulse')),
    ).toBe(true);
  });

  test('Cmd/Ctrl+Alt+T tidies the current code cell without evaluating it', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      const editor = document.getElementById('code');
      editor.value = `const untidy = {
draw() {
if (true) {
circle(20, 20, 10);
}
},
};`;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.focus();
      editor.selectionStart = editor.selectionEnd = editor.value.indexOf('circle');
    });

    await page.locator('#code').press('Control+Alt+t');

    await expect(page.locator('#code')).toHaveValue(`const untidy = {
  draw() {
    if (true) {
      circle(20, 20, 10);
    }
  },
};`);
    expect(await page.evaluate(() => window.p5jsLive.registry.hasStrategy('untidy'))).toBe(false);
  });

  test('Cmd/Ctrl+Alt+T also tidies an open folded cell', async ({ page }) => {
    await boot(page, { folded: true });
    const plasma = page.locator('.folded-block', { hasText: 'patch plasma' });
    await plasma.locator('summary').click();
    const editor = plasma.getByRole('textbox', { name: 'Edit patch plasma' });
    const original = await editor.inputValue();
    await editor.fill(
      original
        .replace('  speed = 0.35;', 'speed = 0.35;')
        .replace(
          '      float red = texture2D(uScene, clamp(sampleUv + split, 0.002, 0.998)).r;',
          `float red = texture2D(
uScene,
clamp(sampleUv + split, 0.002, 0.998)
).r;`,
        ),
    );

    await editor.press('Control+Alt+t');

    await expect(editor).toHaveValue(/\n  speed = 0\.35;/);
    await expect(editor).toHaveValue(/\n      float red = texture2D\(\n        uScene,\n        clamp\(sampleUv \+ split, 0\.002, 0\.998\)\n      \)\.r;/);
    await expect(page.locator('#code-layer')).toHaveClass(/is-folded/);
  });

  test('Cmd+Option+T recognizes the physical T key when macOS produces a symbol', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      const editor = document.getElementById('code');
      editor.value = `const macPatch = {
draw() {
circle(20, 20, 10);
}
};`;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.focus();
      editor.selectionStart = editor.selectionEnd = editor.value.indexOf('circle');
      editor.dispatchEvent(new KeyboardEvent('keydown', {
        key: '†',
        code: 'KeyT',
        metaKey: true,
        altKey: true,
        bubbles: true,
        cancelable: true,
      }));
    });

    await expect(page.locator('#code')).toHaveValue(`const macPatch = {
  draw() {
    circle(20, 20, 10);
  }
};`);
  });

  test('"?" prints the key commands', async ({ page }) => {
    await boot(page, { tools: false });
    await page.locator('#code').focus();
    await page.locator('#code').press('Escape');

    await page.keyboard.press('?');
    await expect(page.locator('#keys-overlay')).toBeVisible();
    await expect(page.locator('#keys-overlay')).toContainText('restore the complete safe state');
    await expect(page.locator('#keys-overlay')).toContainText('fold all objects');
    await expect(page.locator('#keys-overlay')).toContainText('unfold all while keeping every fold control available');
    await expect(page.locator('#keys-overlay')).toContainText('show or hide this key-command sheet while editing');
    await page.keyboard.press('Escape');
    await expect(page.locator('#keys-overlay')).toBeHidden();

    await page.locator('#code').focus();
    await page.locator('#code').press('Control+Alt+/');
    await expect(page.locator('#keys-overlay')).toBeVisible();
    await page.locator('#code').press('Control+Alt+/');
    await expect(page.locator('#keys-overlay')).toBeHidden();
  });

  test('the canvas fills the window and the panel floats over it', async ({ page }) => {
    await boot(page);

    // The composition is the shape of the projection, not of a leftover column.
    const size = await page.evaluate(() => {
      const canvas = document.querySelector('#stage canvas');
      return { w: canvas.width, h: canvas.height, iw: window.innerWidth, ih: window.innerHeight };
    });
    expect(size.w).toBe(size.iw);
    expect(size.h).toBe(size.ih);

    // Slightly transparent, and blurred so it stays readable over moving visuals.
    const style = await page.evaluate(() => {
      const side = document.getElementById('side');
      const cs = getComputedStyle(side);
      const available = getComputedStyle(side.querySelector('.strategy.is-available .name'));
      return {
        background: cs.backgroundColor,
        backdrop: cs.backdropFilter,
        text: cs.color,
        mutedText: available.color,
        textShadow: cs.textShadow,
      };
    });
    expect(style.background).toMatch(/rgba?\(.*0\.55\)/);
    expect(style.backdrop).toContain('blur');
    expect(style.backdrop).toContain('brightness');
    expect(style.text).toBe('rgb(246, 245, 250)');
    expect(style.mutedText).toBe('rgb(199, 199, 210)');
    expect(style.textShadow).toContain('2px');

    // The slider actually changes it, live.
    await selectTool(page, 'Project');
    await page.locator('#tools-opacity').fill('0.25');
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.getElementById('side')).backgroundColor))
      .toMatch(/0\.25\)/);

    // Cmd/Ctrl+\ clears it off the canvas, and brings it back without leaving code.
    await page.locator('#code').focus();
    await page.locator('#code').evaluate((element) => {
      element.dispatchEvent(new KeyboardEvent('keydown', {
        key: '\\', code: 'Backslash', metaKey: true, bubbles: true,
      }));
    });
    await expect(page.locator('#side')).toHaveClass(/is-hidden/);
    await page.locator('#code').evaluate((element) => {
      element.dispatchEvent(new KeyboardEvent('keydown', {
        key: '\\', code: 'Backslash', metaKey: true, bubbles: true,
      }));
    });
    await expect(page.locator('#side')).not.toHaveClass(/is-hidden/);

    // Hiding the tools must not disturb the sketch — it is only a panel.
    expect(await page.evaluate(() => window.p5jsLive.registry.activeOrder()))
      .toEqual(['asciiNoise', 'plasma']);
  });

  test('the drawer keeps disabled Network last without duplicating the scene', async ({ page }) => {
    await boot(page, { tools: false });
    await page.locator('#tools-toggle').click();

    await expect(page.getByRole('tab', { name: 'Audio' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#audio-panel')).toBeVisible();
    await expect(page.locator('#library-panel')).toBeHidden();
    await expect(page.locator('#messages-panel')).toBeHidden();
    await expect(page.locator('#project-panel')).toBeHidden();
    await expect(page.locator('#network-panel')).toBeHidden();
    expect(await page.locator('#tool-tabs [data-tool-view]').evaluateAll((tabs) =>
      tabs.map((tab) => tab.dataset.toolView),
    )).toEqual(['audio', 'library', 'messages', 'project', 'ai', 'network']);
    await expect(page.getByRole('tab', { name: 'Network disabled' })).toBeDisabled();
    await expect(page.locator('#scene-panel')).toHaveCount(0);
    await expect(page.locator('#code')).toHaveValue(/const scene = \[/);
    await expect(page.locator('#parameters-panel')).toBeHidden();
    await expect(page.locator('#library-tab-count')).toHaveText('2');
    await expect(page.locator('#stagebar')).not.toContainText('set safe');

    await page.getByRole('tab', { name: 'Project' }).click();
    await expect(page.locator('#project-panel')).toBeVisible();
    await expect(page.locator('#project-panel')).toContainText('Recovery point');
  });

  test('the drawer restores its last selected tab', async ({ page }) => {
    await boot(page, { tools: false });
    await page.locator('#tools-toggle').click();
    await selectTool(page, 'Messages');

    await page.locator('#tools-toggle').click();
    await expect(page.locator('#side')).toHaveClass(/is-hidden/);
    await page.locator('#tools-toggle').click();
    await expect(page.getByRole('tab', { name: 'Messages' }))
      .toHaveAttribute('aria-selected', 'true');

    await page.reload();
    await page.evaluate(() => {
      document.getElementById('start-overlay').hidden = true;
    });
    await expect
      .poll(() => page.evaluate(() => window.p5jsLive.registry.activeOrder().length))
      .toBe(2);
    await page.locator('#tools-toggle').click();
    await expect(page.getByRole('tab', { name: 'Messages' }))
      .toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#messages-panel')).toBeVisible();
  });

  test('fullscreen keeps the code over the canvas', async ({ page }) => {
    await boot(page, { tools: false });
    const fullscreen = page.getByRole('button', { name: 'Fullscreen the stage' });

    await fullscreen.click();
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement?.id ?? null))
      .toBe('app');
    await expect(page.locator('#code-layer')).toBeVisible();
    await expect(page.locator('#stage canvas')).toBeVisible();

    await fullscreen.click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBe(null);
  });

  test('"\\" does nothing while the editor has focus', async ({ page }) => {
    await boot(page, { tools: false });
    await page.locator('#code').focus();
    await page.locator('#code').press('\\');
    await expect(page.locator('#side')).toHaveClass(/is-hidden/);
    expect(await page.locator('#code').inputValue()).toContain('\\');
  });
});

test.describe('safe-state recovery', () => {
  test('restores source, versions, scene and state from the keyboard', async ({ page }) => {
    await boot(page);

    await expect
      .poll(() => page.evaluate(() => window.p5jsLive.controller.snapshot().safeState))
      .toMatchObject({ exists: true, sceneName: 'scene', dirty: false });

    await page.evaluate(() => {
      window.p5jsLive.evaluator.evaluate(
        'const chaos = { draw() { circle(10, 10, 5); } }; const wild = [chaos]; activate(wild); param("safeProbe", 9);',
        { label: 'buffer' },
      );
    });
    await expect
      .poll(() => page.evaluate(() => window.p5jsLive.registry.activeOrder()))
      .toEqual(['chaos']);
    await expect
      .poll(() => page.evaluate(() => window.p5jsLive.controller.snapshot().safeState.dirty))
      .toBe(true);

    // One action restores the whole checkpoint, not only a scene-name pointer.
    await page.locator('#code').focus();
    await page.locator('#code').press('Escape');
    await page.keyboard.press('0');

    await expect
      .poll(() => page.evaluate(() => window.p5jsLive.registry.activeOrder()))
      .toEqual(['asciiNoise', 'plasma']);
    const restored = await page.evaluate(() => ({
      plasmaVersion: window.p5jsLive.registry.getStrategy('plasma').version,
      hasChaos: window.p5jsLive.registry.hasStrategy('chaos'),
      hasSafeProbe: window.p5jsLive.registry.listParams().some((entry) => entry.name === 'safeProbe'),
      source: document.getElementById('code').value,
      safe: window.p5jsLive.controller.snapshot().safeState,
    }));
    expect(restored.plasmaVersion).toBe(1);
    expect(restored.hasChaos).toBe(false);
    expect(restored.hasSafeProbe).toBe(false);
    expect(restored.source).not.toContain('const chaos');
    expect(restored.safe).toMatchObject({ exists: true, sceneName: 'scene', dirty: false });
    await expect(page.locator('#diagnostics-list')).toContainText('Safe state restored');
  });
});

test.describe('named Performance recall', () => {
  test('new performance clears structured-editor navigation from the previous project', async ({ page }) => {
    await boot(page, { tools: false, folded: true });

    const previous = [
      '// %% patch previous',
      'const previous = {',
      '  draw() {',
      ...Array.from({ length: 80 }, (_, index) => `    // old project line ${index}`),
      '  },',
      '};',
      '',
      '// %% scene scene',
      'const scene = [',
      '  previous,',
      '];',
      'activate(scene);',
    ].join('\n');
    await page.evaluate((source) => {
      window.p5jsLive.editor.value = source;
    }, previous);

    const patch = page.locator('.folded-block[data-block-description="patch previous"]');
    const scene = page.locator('.folded-block[data-block-description="scene scene"]');
    await patch.locator('summary').click();
    await scene.locator('summary').click();
    await page.locator('#folded-code').evaluate((node) => {
      node.scrollTop = node.scrollHeight;
      node.scrollLeft = 120;
    });
    await expect(page.locator('.folded-block[open]')).toHaveCount(2);
    await expect.poll(() => page.locator('#folded-code').evaluate((node) => node.scrollTop))
      .toBeGreaterThan(0);

    await page.keyboard.press('Control+Alt+n');
    const dialog = page.locator('.dialog-backdrop');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Start fresh' }).click();

    await expect(page.locator('.folded-block[open]')).toHaveCount(0);
    await expect(page.locator('.folded-block[data-block-description="patch plasma"]')).toBeVisible();
    await expect.poll(() => page.locator('#folded-code').evaluate((node) => ({
      top: node.scrollTop,
      left: node.scrollLeft,
    }))).toEqual({ top: 0, left: 0 });
  });

  test('starts a new default performance from the button or modifier shortcut without deleting named performances', async ({ page }) => {
    await boot(page);
    await selectTool(page, 'Project');

    await page.locator('#performance-name').fill('Keep this one');
    await page.getByRole('button', { name: 'Save current' }).click();

    const alternate = [
      '// %% patch alternate',
      'const alternate = { draw() { circle(40, 40, 20); } };',
      '// %% scene other',
      'const other = [alternate];',
      'activate(other);',
    ].join('\n');
    await page.evaluate((source) => {
      window.p5jsLive.editor.value = source;
      window.p5jsLive.editor.evaluateBuffer();
    }, alternate);
    await page.locator('#performance-name').fill('Unsaved name');

    await expect(
      page.getByRole('button', { name: 'Start a new performance from the default starter' }),
    ).toBeVisible();
    await page.locator('#code').focus();
    await page.keyboard.press('Control+Alt+n');
    const dialog = page.locator('.dialog-backdrop');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('named performances stay saved');
    await dialog.getByRole('button', { name: 'Start fresh' }).click();

    await expect
      .poll(() => page.evaluate(() => window.p5jsLive.registry.activeOrder()))
      .toEqual(['asciiNoise', 'plasma']);
    await expect(page.locator('#code')).toHaveValue(
      /const scene = \[\s*asciiNoise,\s*plasma,\s*\]/,
    );
    await expect(page.locator('#code')).not.toHaveValue(/\/\/ %% patch effects/);
    await expect(page.locator('#performance-name')).toHaveValue('');
    await expect(page.locator('#performance-name')).toBeFocused();
    await expect(page.locator('.performance-row')).toContainText('Keep this one');
    await expect
      .poll(() => page.evaluate(() => window.p5jsLive.controller.snapshot().safeState))
      .toMatchObject({ exists: true, sceneName: 'scene', dirty: false });
  });

  test('saves and recalls source, scene, parameters, audio analysis and view settings', async ({ page }) => {
    await boot(page);
    await selectTool(page, 'Project');

    await page.locator('#smoothing').evaluate((input) => {
      input.value = '0.35';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.locator('#auto-gain').evaluate((input) => {
      input.checked = false;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('#code-size').fill('18');
    await page.locator('#performance-name').fill('Opening look');
    await page.getByRole('button', { name: 'Save current' }).click();
    await expect(page.locator('.performance-row')).toContainText('Opening look');
    await expect(page.locator('.performance-row')).toContainText('scene');

    const alternate = [
      '// %% patch alternate',
      'const alternate = { draw() { circle(40, 40, 20); } };',
      '// %% scene other',
      'const other = [alternate];',
      'param("energy", 0.2, { min: 0, max: 1 });',
      'activate(other);',
    ].join('\n');
    await page.evaluate((source) => {
      window.p5jsLive.editor.value = source;
      window.p5jsLive.editor.evaluateBuffer();
    }, alternate);
    await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.activeSceneName())).toBe('other');
    await page.locator('#smoothing').evaluate((input) => {
      input.value = '0.9';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.locator('#auto-gain').evaluate((input) => {
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('#code-size').fill('12');

    await page.locator('.performance-row').getByRole('button', { name: 'Recall' }).click();
    await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.activeSceneName())).toBe('scene');
    await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.activeOrder()))
      .toEqual(['asciiNoise', 'plasma']);
    expect(await page.locator('#smoothing').inputValue()).toBe('0.35');
    expect(await page.locator('#auto-gain').isChecked()).toBe(false);
    expect(await page.locator('#code-size').inputValue()).toBe('18');
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.getElementById('code')).fontSize))
      .toBe('18px');
    expect(await page.locator('#code').inputValue()).toContain('p5js live — starter scene');

    // Named performances are browser-local recall points, independent of the current
    // project's automatic save, and remain available after a refresh.
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => window.p5jsLive.registry.activeOrder().length))
      .toBeGreaterThan(0);
    await page.evaluate(() => {
      document.getElementById('start-overlay').hidden = true;
      window.p5jsLive.editor.setFolded(false);
    });
    await openTools(page);
    await selectTool(page, 'Project');
    await expect(page.locator('.performance-row')).toContainText('Opening look');
  });

  test('a broken saved performance leaves the previous render and source running', async ({ page }) => {
    await boot(page);
    await selectTool(page, 'Project');
    await page.locator('#performance-name').fill('Broken slot');
    await page.getByRole('button', { name: 'Save current' }).click();

    const keeper = [
      '// %% patch keeper',
      'const keeper = { draw() { circle(80, 80, 30); } };',
      '// %% scene keeperScene',
      'const keeperScene = [keeper];',
      'activate(keeperScene);',
    ].join('\n');
    await page.evaluate((source) => {
      window.p5jsLive.editor.value = source;
      window.p5jsLive.editor.evaluateBuffer();
    }, keeper);
    await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.activeSceneName())).toBe('keeperScene');

    // Corrupt the local slot after it has rendered. Recall reads storage at click time.
    await page.evaluate(() => {
      const key = 'p5js-live.performances.v1';
      const data = JSON.parse(localStorage.getItem(key));
      data.performances[0].source = 'class Broken { draw() { ((( } }';
      localStorage.setItem(key, JSON.stringify(data));
    });
    await page.locator('.performance-row').getByRole('button', { name: 'Recall' }).click();

    await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.activeSceneName())).toBe('keeperScene');
    expect(await page.locator('#code').inputValue()).toContain('const keeperScene');
    await expect(page.locator('#diagnostics-list')).toContainText('previous performance restored');
  });
});

test.describe('anchored performance controls', () => {
  test('keeps the top-right controls fixed while both drawers open underneath', async ({ page }) => {
    await boot(page, { tools: false });
    const layout = () => page.evaluate(() => {
      const rect = (selector) => {
        const box = document.querySelector(selector).getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      };
      return {
        icons: rect('#icons'),
        tools: rect('#side'),
        reference: rect('#reference-side'),
      };
    });

    const closed = await layout();
    await page.locator('#tools-toggle').click();
    const toolsOpen = await layout();
    expect(toolsOpen.icons.right).toBeCloseTo(closed.icons.right, 1);
    expect(toolsOpen.tools.top).toBeGreaterThanOrEqual(toolsOpen.icons.bottom);

    await page.locator('#reference-toggle').click();
    const referenceOpen = await layout();
    expect(referenceOpen.icons.right).toBeCloseTo(closed.icons.right, 1);
    expect(referenceOpen.reference.top).toBeGreaterThanOrEqual(referenceOpen.icons.bottom);
  });
});

test.describe('project portability', () => {
  test('exports a readable project file', async ({ page }) => {
    await boot(page);
    await selectTool(page, 'Project');

    await page.evaluate(() => window.p5jsLive.performanceStore.save({
      name: 'Portable custom patch',
      source: 'const myNewPatch = { draw() {} }; const scene = [myNewPatch]; activate(scene);',
      params: [],
      audio: {},
      view: {},
    }));

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export this project and all named performances as JSON' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^p5js-live-project-\d{4}-\d{2}-\d{2}\.json$/);
    const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
    expect(exported.performances).toHaveLength(1);
    expect(exported.performances[0].source).toContain('myNewPatch');
  });

  test('import requires an explicit confirmation and can be cancelled', async ({ page }) => {
    await boot(page);

    const project = JSON.stringify({
      format: 'p5js-live-project',
      schema: 6,
      source: [
        'const imported = { draw() { circle(50, 50, 20); } };',
        'const main = [imported];',
        'activate(main);',
      ],
      params: [],
      performances: [{
        id: 'imported-performance',
        name: 'Imported set',
        createdAt: 10,
        updatedAt: 20,
        source: 'const savedPatch = { draw() {} }; const saved = [savedPatch]; activate(saved);',
        params: [],
        audio: {},
        view: {},
      }],
    });

    await page.locator('#import-file').setInputFiles({
      name: 'someone-elses.json',
      mimeType: 'application/json',
      buffer: Buffer.from(project),
    });

    // The dialog must show the actual code, and warn that this is not a sandbox.
    const dialog = page.locator('.dialog-backdrop');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('someone-elses.json');
    await expect(dialog.locator('.dialog-preview')).toContainText('const imported');
    await expect(dialog.locator('.dialog-warning')).toContainText('not a');

    // Cancelling must change nothing.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => window.p5jsLive.registry.hasStrategy('imported'))).toBe(false);

    // Confirming runs it.
    await page.locator('#import-file').setInputFiles({
      name: 'someone-elses.json',
      mimeType: 'application/json',
      buffer: Buffer.from(project),
    });
    await dialog.getByRole('button', { name: 'Import and run' }).click();
    await expect
      .poll(() => page.evaluate(() => window.p5jsLive.registry.hasStrategy('imported')))
      .toBe(true);
    await expect
      .poll(() => page.evaluate(() => window.p5jsLive.performanceStore.get('imported-performance')?.name))
      .toBe('Imported set');
  });

  test('reset goes back to the starter without reloading the page', async ({ page }) => {
    await boot(page);
    await selectTool(page, 'Project');

    // Make a mess: a new strategy, extra copies, a wrecked scene, accumulated state.
    await page.evaluate(() =>
      window.p5jsLive.evaluator.evaluate(
        'const mess = { draw() { circle(5, 5, 5); } }; const messy = [mess, plasma, plasma]; activate(messy);',
        { label: 'test' },
      ),
    );
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      document.querySelector('#stage canvas').dataset.probe = 'original';
    });
    const before = await page.evaluate(() => ({
      frameCount: window.frameCount,
      hostTime: window.p5jsLive.host.time(),
      strategies: window.p5jsLive.registry.listStrategies().length,
    }));
    expect(before.strategies).toBe(3);

    await page.getByRole('button', { name: 'Discard everything and go back to the starter project' }).click();
    const dialog = page.locator('.dialog-backdrop');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.dialog-warning')).toContainText('no undo');

    // Cancelling changes nothing.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    expect(await page.evaluate(() => window.p5jsLive.registry.hasStrategy('mess'))).toBe(true);

    await page.getByRole('button', { name: 'Discard everything and go back to the starter project' }).click();
    await dialog.getByRole('button', { name: 'Reset to starter' }).click();

    await expect
      .poll(() => page.evaluate(() => window.p5jsLive.registry.activeOrder()))
      .toEqual(['asciiNoise', 'plasma']);

    const after = await page.evaluate(() => ({
      hasMess: window.p5jsLive.registry.hasStrategy('mess'),
      stateKeys: window.p5jsLive.stateStore.names().sort(),
      source: document.getElementById('code').value,
      safeScene: window.p5jsLive.registry.safeSceneName(),
      sameCanvas: document.querySelector('#stage canvas')?.dataset.probe === 'original',
      frameCount: window.frameCount,
      hostTime: window.p5jsLive.host.time(),
    }));

    expect(after.hasMess).toBe(false);
    expect(after.stateKeys).toEqual(['asciiNoise', 'plasma']);
    expect(after.source).toContain('p5js live — starter scene');
    expect(after.safeScene).not.toBe(null);
    // The point of doing this in place rather than reloading: the canvas and the
    // clock are the same ones. Nothing the audience is looking at restarted.
    expect(after.sameCanvas).toBe(true);
    expect(after.frameCount).toBeGreaterThan(before.frameCount);
    expect(after.hostTime).toBeGreaterThan(before.hostTime);
  });

  test('a file that is not a project is refused before any confirmation', async ({ page }) => {
    await boot(page);
    await page.locator('#import-file').setInputFiles({
      name: 'notes.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"just":"some json"}'),
    });

    await expect(page.locator('.dialog-backdrop')).toBeHidden();
    await expect(page.locator('#diagnostics-list')).toContainText('Not a p5js live project');
  });
});

test.describe('patch sharing and live commands', () => {
  test('imports one patch as Available without installing or running it', async ({ page }) => {
    await boot(page);
    await selectTool(page, 'Library');
    const source = [
      '// %% patch studentGlow',
      '// @title Student Glow',
      '// @author Priya',
      '// @description A shared glow.',
      '// @category visual',
      '// @version 1',
      '',
      'const studentGlow = { draw() { circle(20, 20, 10); } };',
    ].join('\n');
    await page.locator('#import-patch-file').setInputFiles({
      name: 'student-glow.p5patch.js',
      mimeType: 'text/javascript',
      buffer: Buffer.from(source),
    });
    const dialog = page.locator('.dialog-backdrop');
    await expect(dialog).toContainText('Student Glow');
    await dialog.getByRole('button', { name: 'Add as available' }).click();

    const row = page.locator('[data-library="studentGlow"]');
    await expect(row).toContainText('Available');
    await expect(row).toContainText('Priya');
    expect(await page.evaluate(() => window.p5jsLive.registry.hasStrategy('studentGlow'))).toBe(false);
    expect(await page.locator('#code').inputValue()).not.toContain('studentGlow');
  });

  test('keeps performance slots stable and reports the quick-save slot', async ({ page }) => {
    await boot(page);
    await selectTool(page, 'Project');
    await page.locator('#performance-name').fill('First');
    await page.getByRole('button', { name: 'Save current' }).click();

    await page.locator('#code').focus();
    await page.keyboard.press('Control+Alt+s');
    await expect(page.locator('.performance-title')).toHaveText([/1\. First/, /2\. Quick/]);
    await expect(page.locator('#stat-status')).toContainText('slot 2');

    await page.locator('#performance-name').fill('Third');
    await page.getByRole('button', { name: 'Save current' }).click();
    await expect(page.locator('.performance-title')).toHaveText([/1\. First/, /2\. Quick/, /3\. Third/]);
  });

  test('recalls a performance safely while an expanded patch editor has the cursor', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await boot(page, { folded: true });
    await selectTool(page, 'Project');
    await page.locator('#performance-name').fill('Starter');
    await page.getByRole('button', { name: 'Save current' }).click();

    const alternate = [
      '// %% patch movingDot',
      'const movingDot = { draw({ time }) { circle(100 + sin(time) * 40, 100, 20); } };',
      '',
      '// %% scene alternate',
      'const alternate = [movingDot];',
      'activate(alternate);',
    ].join('\n');
    await page.evaluate((source) => {
      window.p5jsLive.editor.value = source;
      window.p5jsLive.editor.evaluateBuffer();
      window.p5jsLive.editor.setFolded(true);
    }, alternate);

    const patch = page.locator('.folded-block[data-block-description="patch movingDot"]');
    await patch.locator('summary').click();
    const inlineEditor = patch.locator('.folded-source-editor');
    await inlineEditor.focus();
    await inlineEditor.evaluate((editor) => editor.setSelectionRange(20, 20));
    const before = await page.evaluate(() => window.frameCount);

    await page.keyboard.press('Control+Alt+1');
    await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.activeSceneName()))
      .toBe('scene');
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => window.frameCount)).toBeGreaterThan(before);
    expect(pageErrors).toEqual([]);
  });

  test('moves adjacent editor lines with Alt+Arrow', async ({ page }) => {
    await boot(page, { folded: false });
    await page.evaluate(() => {
      window.p5jsLive.editor.value = 'one\ntwo\nthree';
      const code = document.getElementById('code');
      code.focus();
      code.setSelectionRange(5, 5);
    });
    await page.keyboard.press('Alt+ArrowDown');
    await expect(page.locator('#code')).toHaveValue('one\nthree\ntwo');
  });

  test('toggles the looping robot video without replacing the running scene', async ({ page }) => {
    await boot(page);
    const overlay = page.locator('#robot-easter-egg');
    const video = page.locator('#robot-easter-egg-video');
    const sceneBefore = await page.evaluate(() => window.p5jsLive.registry.activeSceneName());
    await expect(overlay).toBeHidden();

    await page.locator('#code').focus();
    await page.keyboard.press('Control+Alt+r');
    await expect(overlay).toBeVisible();
    await expect.poll(() => video.evaluate((element) => element.paused)).toBe(false);
    expect(await video.evaluate((element) => element.loop)).toBe(true);
    expect(await video.evaluate((element) => element.muted)).toBe(true);
    expect(await video.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width / Math.min(innerWidth, innerHeight);
    })).toBeCloseTo(0.64, 2);

    await page.keyboard.press('Control+Alt+r');
    await expect(overlay).toBeHidden();
    expect(await video.evaluate((element) => ({ paused: element.paused, time: element.currentTime })))
      .toEqual({ paused: true, time: 0 });
    expect(await page.evaluate(() => window.p5jsLive.registry.activeSceneName())).toBe(sceneBefore);
  });
});

test.describe('offline application bundle', () => {
  test('loads with every non-local request blocked', async ({ page }) => {
    const external = [];
    await page.route('**/*', (route) => {
      const url = route.request().url();
      const parsed = new URL(url);
      if (parsed.hostname === 'localhost' || parsed.protocol === 'data:') return route.continue();
      external.push(url);
      return route.abort();
    });

    await boot(page);
    // p5, p5.sound, the modules, and the starter all came from the vendored build.
    expect(external).toEqual([]);
    expect(await page.evaluate(() => window.p5.VERSION)).toBe('1.11.3');
  });
});
