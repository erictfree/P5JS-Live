import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const SOURCE = `// %% patch blue
const blue = () => background(0, 0, 100);
// %% patch subject
const subject = { draw() { circle(100, 100, 40); } };
// %% patch letters
const letters = codeView({ patch: 'subject', fontSize: 24 });
// %% patch inspect
const inspect = { draw({ canvas }) {
  const data = canvas.drawingContext.getImageData(0, 0, canvas.width, canvas.height).data;
  let ink = 0, transparent = 0, partial = 0, hash = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i+3]) { ink++; hash = (hash + (i+1) * (data[i]+data[i+1]+data[i+2])) % 1000000007; }
    else transparent++;
    if (data[i+3] > 0 && data[i+3] < 255) partial++;
  }
  globalThis.__codeImage = { ink, transparent, partial, hash };
} };
// %% scene scene
const scene = [blue, [letters, inspect]];
scene.draw();`;

async function boot(page) {
  await page.addInitScript(source => {
    if (!localStorage.getItem('p5js-live.project.v5')) localStorage.setItem('p5js-live.project.v5', JSON.stringify({schema:7, savedAt:Date.now(), source, params:[]}));
  }, SOURCE);
  await page.goto('/live/');
  await page.getByRole('button',{name:'Start silent'}).click();
  await settled(page);
}
async function settled(page) {
  await expect.poll(()=>page.evaluate(()=>window.p5jsLive?.registry.activeSceneName())).toBeTruthy();
  await expect.poll(()=>page.evaluate(()=>window.p5jsLive.evaluator.pendingCount())).toBe(0);
  await expect.poll(()=>page.evaluate(()=>window.p5jsLive.registry.listStrategies().some(r=>r.candidate))).toBe(false);
}
async function run(page, source) {
  const result = await page.evaluate(source => {
    const r = window.p5jsLive.evaluator.evaluate(source); return {ok:r.ok,error:r.error?.message};
  },source);
  expect(result).toMatchObject({ok:true}); await settled(page);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
const imageStats = page => page.evaluate(()=>globalThis.__codeImage);
const hash = async page => (await imageStats(page)).hash;

test('named source renders transparent coloured glyphs and follows unrun edits, deletion and restoration', async ({page}) => {
  await boot(page);
  await expect.poll(async()=> (await imageStats(page))?.ink ?? 0).toBeGreaterThan(100);
  const initial = await imageStats(page);
  expect(initial.transparent).toBeGreaterThan(initial.ink * 10);
  expect(initial.partial).toBeGreaterThan(100);
  await page.evaluate(()=>window.p5jsLive.editor.revealStrategy('subject'));
  const editor = page.getByRole('textbox',{name:'Edit patch subject',exact:true});
  await editor.fill('const subject = { draw() { circle(200, 100, 80); } }; // EDITED');
  await expect.poll(()=>hash(page)).not.toBe(initial.hash);
  expect(await page.evaluate(()=>window.p5jsLive.registry.getStrategy('subject').source)).not.toContain('EDITED');
  const changed = await hash(page);
  await page.keyboard.press('Escape'); await page.keyboard.press('e');
  await expect(page.locator('#code-layer')).toHaveClass(/is-hidden/);
  expect(await hash(page)).toBe(changed);
  await run(page, 'const letters = codeView({patch:"missing"});');
  await expect.poll(async()=> (await imageStats(page)).ink).toBe(0);
  await run(page, 'const letters = codeView({patch:"subject",fontSize:24});');
  await expect.poll(()=>hash(page)).toBe(changed);
});

test('visible editor view follows raw scrolling, folds and live text while hidden chrome stays out', async ({page}) => {
  await boot(page);
  await run(page, 'const letters = codeView();');
  await page.evaluate(()=> {
    window.p5jsLive.editor.value += '\n' + Array.from({length:60},(_,i)=>`// scrolling line ${i}`).join('\n');
    window.p5jsLive.editor.setFolded(false);
  });
  await expect.poll(async()=> (await imageStats(page)).ink).toBeGreaterThan(100);
  const first = await hash(page);
  await page.locator('#code').evaluate(el=> { el.scrollTop = 140; el.dispatchEvent(new Event('scroll')); });
  await expect.poll(()=>hash(page)).not.toBe(first);
  const scroll = await hash(page);
  await page.keyboard.press('Escape'); await page.keyboard.press('e');
  await expect(page.locator('#code-layer')).toHaveClass(/is-hidden/);
  expect(await hash(page)).toBe(scroll);
  await page.evaluate(()=> { window.p5jsLive.editor.setFolded(true); window.p5jsLive.editor.revealStrategy('subject'); });
  await expect.poll(()=>hash(page)).not.toBe(scroll);
  const folded = await hash(page);
  await page.keyboard.press('e');
  await page.getByRole('textbox',{name:'Edit patch subject',exact:true}).fill('const subject = { draw() {} }; // GLYPHS');
  await expect.poll(()=>hash(page)).not.toBe(folded);
});

test('lastRun ignores drafts and rejected/queued code, and refreshes after a successful run', async ({page}) => {
  await boot(page);
  await run(page, 'const letters = codeView({source:"lastRun",fontSize:22});');
  await run(page, 'const message = "HELLO CODE";');
  const before = await hash(page);
  await page.evaluate(()=>window.p5jsLive.editor.revealStrategy('subject'));
  await page.getByRole('textbox',{name:'Edit patch subject',exact:true}).fill('const subject = ;');
  expect(await hash(page)).toBe(before);
  expect(await page.evaluate(()=>window.p5jsLive.editor.evaluateBuffer().ok)).toBe(false);
  expect(await hash(page)).toBe(before);
  await run(page, 'const message = "NEW IMAGE";');
  await expect.poll(()=>hash(page)).not.toBe(before);
});

test('code image works through modulation and opacity, resizes and survives Safe State recovery', async ({page}) => {
  await boot(page);
  await run(page, 'const field = () => background(255,128,0); const scene = [blue, [letters,inspect].modulate([field],0.1).opacity(0.5)]; scene.draw();');
  await expect.poll(async()=> (await imageStats(page)).ink).toBeGreaterThan(100);
  const finalPixels = await page.evaluate(()=> {
    const c = document.querySelector('#stage canvas');
    const data = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let ink = 0, maxRed = 0;
    for (let i=0;i<data.length;i+=4) { if (data[i] > 0) ink++; maxRed = Math.max(maxRed,data[i]); }
    return {ink,maxRed,corner:[...data.slice(0,4)]};
  });
  expect(finalPixels.ink).toBeGreaterThan(100);
  expect(finalPixels.maxRed).toBeGreaterThan(90);
  expect(finalPixels.maxRed).toBeLessThanOrEqual(128);
  expect(finalPixels.corner).toEqual([0,0,100,255]);
  expect(await page.evaluate(()=>window.p5jsLive.controller.actions.setSafeState().ok)).toBe(true);
  const before = await hash(page);
  await run(page,'const letters = codeView({patch:"missing"});');
  await expect.poll(async()=> (await imageStats(page)).ink).toBe(0);
  expect(await page.evaluate(()=>window.p5jsLive.controller.actions.restoreSafeState().ok)).toBe(true);
  await expect.poll(()=>hash(page)).toBe(before);
  await page.setViewportSize({width:960,height:640});
  await expect.poll(async()=> (await imageStats(page)).ink).toBeGreaterThan(100);
  expect(await page.evaluate(()=>window.p5jsLive.registry.listStrategies().filter(r=>r.status==='failed').map(r=>r.name))).toEqual([]);
});

test('the Code Scene example is runnable, exports pixels without the editor, and survives reload', async ({page},testInfo) => {
  await boot(page);
  await page.locator('#tools-toggle').click();
  await page.getByRole('tab',{name:'Library',exact:true}).click();
  await page.getByRole('button',{name:'Run Code Scene',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.p5jsLive.registry.activeSceneName())).toBe('codeScene');
  await settled(page);
  await page.keyboard.press('Escape'); await page.keyboard.press('e');
  await page.locator('#tools-close').click();
  const png = await page.locator('#stage canvas').evaluate(canvas=>canvas.toDataURL());
  await writeFile(testInfo.outputPath('code-scene.png'), Buffer.from(png.split(',')[1], 'base64'));
  await page.reload();
  await page.getByRole('button',{name:'Start silent'}).click();
  await settled(page);
  expect(await page.evaluate(()=>window.p5jsLive.registry.activeSceneName())).toBe('codeScene');
  expect(await page.evaluate(()=>window.p5jsLive.registry.listStrategies().filter(r=>r.status==='failed').map(r=>r.name))).toEqual([]);
});
