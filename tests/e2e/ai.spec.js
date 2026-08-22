import { test, expect } from '@playwright/test';

async function boot(page) {
  await page.goto('/live/index.html');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.activeOrder().length)).toBe(2);
  await page.evaluate(() => {
    document.getElementById('start-overlay').hidden = true;
    window.p5jsLive.editor.setFolded(false);
  });
}

function sourceFromRequest(request) {
  const body = request.postDataJSON();
  return /<CURRENT_SOURCE>\n([\s\S]*)\n<\/CURRENT_SOURCE>/.exec(body.input)?.[1] ?? '';
}

async function openAndConfigure(page) {
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', {
    code: 'KeyA',
    key: 'a',
    metaKey: true,
    altKey: true,
    bubbles: true,
  })));
  await expect(page.locator('#ai-assistant')).toBeVisible();
  await expect(page.getByRole('tab', { name: /^AI beta/ })).toHaveAttribute('aria-selected', 'true');
  await page.locator('#ai-api-key').fill('sk-test-only');
  await page.locator('#ai-save-key').click();
  await expect(page.locator('#ai-key-status')).toContainText('session');
}

test.describe('AI source editor', () => {
  test('stages the real source and runs it only after acceptance', async ({ page }) => {
    await boot(page);
    await openAndConfigure(page);
    await page.route('https://api.openai.com/v1/responses', async (route) => {
      const source = sourceFromRequest(route.request());
      const changed = source.replace('density: 0.42', 'density: 0.12');
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ output: [{ content: [{ text: JSON.stringify({
          summary: 'Reduced the ASCII density.',
          source: changed,
          installPatches: [],
        }) }] }] }),
      });
    });

    await page.locator('#ai-prompt').fill('make the ASCII layer much more sparse');
    await page.locator('#ai-prompt').press('Enter');
    await expect(page.locator('#ai-stage-actions')).toBeVisible();
    await expect(page.locator('#code')).toHaveValue(/density: 0\.12/);
    await expect(page.locator('#code-layer')).toHaveClass(/is-ai-staged/);
    expect(await page.locator('#code-mirror > .ai-changed-line').count()).toBeGreaterThan(0);
    expect(await page.evaluate(() =>
      window.p5jsLive.registry.getStrategy('asciiNoise').definition.density,
    )).toBe(0.42);
    expect(await page.evaluate(() => localStorage.getItem('p5js-live.ai.openai-key'))).toBe(null);
    expect(await page.evaluate(() => sessionStorage.getItem('p5js-live.ai.openai-key'))).toBe('sk-test-only');

    await page.locator('#ai-prompt').press('Control+Enter');
    await expect(page.locator('#ai-stage-actions')).toBeHidden();
    await expect(page.locator('#code-layer')).not.toHaveClass(/is-ai-staged/);
    await expect.poll(() => page.evaluate(() =>
      window.p5jsLive.registry.getStrategy('asciiNoise').definition.density,
    )).toBe(0.12);
    await expect(page.locator('#ai-assistant')).toBeVisible();
  });

  test('keeps a broken proposal staged and restores the exact source on cancel', async ({ page }) => {
    await boot(page);
    const original = await page.locator('#code').inputValue();
    await openAndConfigure(page);
    await page.route('https://api.openai.com/v1/responses', async (route) => {
      const source = sourceFromRequest(route.request());
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ output: [{ content: [{ text: JSON.stringify({
          summary: 'Introduced a broken candidate for the recovery test.',
          source: source.replace('density: 0.42', 'density: ;'),
          installPatches: [],
        }) }] }] }),
      });
    });

    await page.locator('#ai-prompt').fill('stage the test change');
    await page.locator('#ai-prompt').press('Enter');
    await expect(page.locator('#ai-stage-actions')).toBeVisible();
    await page.locator('#ai-accept').click();
    await expect(page.locator('#ai-conversation')).toContainText('previous visual is still running');
    await expect(page.locator('#ai-stage-actions')).toBeVisible();
    expect(await page.evaluate(() =>
      window.p5jsLive.registry.getStrategy('asciiNoise').definition.density,
    )).toBe(0.42);

    await page.locator('#ai-prompt').press('Control+z');
    await expect(page.locator('#ai-stage-actions')).toBeHidden();
    await expect(page.locator('#code')).toHaveValue(original);
  });

  test('revises one staged transaction through follow-up prompts', async ({ page }) => {
    await boot(page);
    const original = await page.locator('#code').inputValue();
    await openAndConfigure(page);
    let requestCount = 0;
    await page.route('https://api.openai.com/v1/responses', async (route) => {
      requestCount += 1;
      const source = sourceFromRequest(route.request());
      const changed = requestCount === 1
        ? source.replace('density: 0.42', 'density: 0.30')
        : source.replace('density: 0.30', 'density: 0.08');
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ output_text: JSON.stringify({
          summary: requestCount === 1 ? 'Reduced density.' : 'Reduced it further.',
          source: changed,
          installPatches: [],
        }) }),
      });
    });

    await page.locator('#ai-prompt').fill('reduce the density');
    await page.locator('#ai-prompt').press('Enter');
    await expect(page.locator('#code')).toHaveValue(/density: 0\.30/);

    await page.locator('#ai-prompt').fill('further');
    await page.locator('#ai-prompt').press('Enter');
    await expect(page.locator('#code')).toHaveValue(/density: 0\.08/);
    expect(await page.evaluate(() =>
      window.p5jsLive.registry.getStrategy('asciiNoise').definition.density,
    )).toBe(0.42);

    await page.locator('#ai-cancel').click();
    await expect(page.locator('#code')).toHaveValue(original);
    await expect(page.locator('#ai-stage-actions')).toBeHidden();
  });
});
