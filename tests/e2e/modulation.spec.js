import { test, expect } from '@playwright/test';

const SOURCE = `// %% patch blue
const blue = () => background(0, 0, 255);
// %% patch stripe
const stripe = { draw() { noStroke(); fill(255, 0, 0); rect(width * 0.5, 0, width * 0.25, height); } };
// %% patch shift
const shift = { state: () => ({frames:0}), draw({state}) { state.frames++; background(255, 128, 0); } };
// %% scene scene
const scene = [blue, [stripe].modulate([shift], 0.5)]; scene.draw();`;

async function boot(page, savedSource = SOURCE) {
  await page.addInitScript(source => {
    if (!localStorage.getItem('p5js-live.project.v5')) localStorage.setItem('p5js-live.project.v5', JSON.stringify({schema:7, savedAt:Date.now(), source, params:[]}));
  }, savedSource);
  await page.goto('/live/');
  await page.getByRole('button', {name:'Start silent'}).click();
  await settled(page);
}
async function settled(page) {
  await expect.poll(() => page.evaluate(() => window.p5jsLive?.registry.activeSceneName())).toBeTruthy();
  await expect.poll(() => page.evaluate(() => window.p5jsLive.evaluator.pendingCount())).toBe(0);
  await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.listStrategies().some(r=>r.candidate))).toBe(false);
}
async function evaluate(page, source) {
  const result = await page.evaluate(source => {
    const r=window.p5jsLive.evaluator.evaluate(source);return {ok:r.ok,error:r.error?.message};
  },source);
  expect(result, source).toMatchObject({ok:true});await settled(page);
}
async function pixels(page) {
  return page.evaluate(() => {
    const c=document.querySelector('#stage canvas');const ctx=c.getContext('2d');
    return [0.125,0.375,0.625,0.875].map(x=>[...ctx.getImageData(Math.floor(c.width*x),Math.floor(c.height/2),1,1).data]);
  });
}
const B=[0,0,255,255],R=[255,0,0,255];

test('image inputs displace pixels privately, replace live, preserve order and resize', async ({page}) => {
  const errors=[];page.on('pageerror', e=>errors.push(e.message));
  await boot(page);
  await expect.poll(()=>pixels(page)).toEqual([B,R,B,B]);
  await evaluate(page,'const shift = { draw() { background(0, 128, 0); } };');
  await expect.poll(()=>pixels(page)).toEqual([B,B,B,R]);
  await evaluate(page,'const scene = [blue, [stripe].modulate([shift], 0)]; scene.draw();');
  await expect.poll(()=>pixels(page)).toEqual([B,B,R,B]);
  await evaluate(page,'const scene = [blue, [stripe].modulate([shift], () => 0.5).hue(1/3)]; scene.draw();');
  await expect.poll(()=>pixels(page)).toEqual([B,B,B,[0,255,0,255]]);
  await page.setViewportSize({width:960,height:640});
  await expect.poll(()=>pixels(page)).toEqual([B,B,B,[0,255,0,255]]);
  await evaluate(page,'const shift = { draw() {} };');
  await expect.poll(()=>pixels(page)).toEqual([B,B,[0,255,0,255],B]);
  expect(errors).toEqual([]);
});

test('nested image effects, mute and multiple modulation passes use the correct input texture', async ({page}) => {
  await boot(page);
  await evaluate(page,`const neutral = () => {};
    const scene = [blue, [stripe].modulate([shift].modulate([neutral], 0.4).blur(2), 0.5)]; scene.draw();`);
  await expect.poll(()=>pixels(page)).toEqual([B,R,B,B]);
  await evaluate(page,`const scene = [blue, [stripe].modulate([shift], 0.5).modulate([shift], 0.5)]; scene.draw();`);
  await expect.poll(()=>pixels(page)).toEqual([R,B,B,B]);
  await evaluate(page,`const scene = [blue, [stripe].modulate([shift].mute(), 0.5)]; scene.draw();`);
  await expect.poll(()=>pixels(page)).toEqual([B,B,R,B]);
});

test('bad image edits and invalid amounts recover without losing the working composition', async ({page}) => {
  await boot(page);
  await expect.poll(()=>pixels(page)).toEqual([B,R,B,B]);
  await evaluate(page,'const shift = { draw() { throw new Error("bad input"); } };');
  await expect.poll(()=>pixels(page)).toEqual([B,R,B,B]);
  await evaluate(page,'const scene = [blue, [stripe].modulate([shift], () => NaN)]; scene.draw();');
  await expect.poll(()=>pixels(page)).toEqual([B,R,B,B]);
  const r=await page.evaluate(()=> {
    const r=window.p5jsLive.evaluator.evaluate('const a=[]; const fx=[stripe].modulate(a); a.push(fx); const bad=[fx]; bad.draw();');
    return {ok:r.ok,message:r.error?.message};
  });
  expect(r.ok).toBe(false);expect(r.message).toMatch(/cyclic/i);
  await expect.poll(()=>pixels(page)).toEqual([B,R,B,B]);
});

test('the runnable example exposes its input in the Scene inspector and survives reload', async ({page},testInfo) => {
  await boot(page);
  await page.locator('#tools-toggle').click();
  await page.getByRole('tab',{name:'Scene',exact:true}).click();
  await page.getByText('Let one image distort another',{exact:true}).click();
  await page.getByRole('button',{name:'Run Image Modulation',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.p5jsLive.registry.activeSceneName())).toBe('imageModulation');
  await settled(page);
  await expect(page.locator('#scene-tree')).toContainText('Image input');
  await expect(page.locator('#scene-tree')).toContainText('modRings');
  expect(await page.evaluate(()=>window.p5jsLive.registry.listStrategies().filter(r=>r.status==='failed').map(r=>r.name))).toEqual([]);
  await page.keyboard.press('Escape');
  await page.keyboard.press('e');
  await page.locator('#tools-close').click();
  await page.screenshot({path:testInfo.outputPath('image-modulation.png')});
  await page.keyboard.down('h');
  await page.screenshot({path:testInfo.outputPath('image-modulation-original.png')});
  await page.keyboard.up('h');
  await page.reload();
  const start = page.getByRole('button', {name:'Start silent'});
  if (await start.isVisible()) await start.click();
  await settled(page);
  await expect.poll(()=>page.evaluate(()=>window.p5jsLive.registry.activeSceneName())).toBe('imageModulation');
  expect(await page.evaluate(()=>window.p5jsLive.registry.listStrategies().filter(r=>r.status==='failed').map(r=>r.name))).toEqual([]);
});


test('Safe State restores private inputs and departure releases their offscreen targets', async ({page}) => {
  await boot(page);
  await evaluate(page, `const shift = { draw({canvas}) { if (!globalThis.__inputElement) {
    const release = canvas.remove.bind(canvas);
    canvas.remove = () => { globalThis.__inputReleased = true; release(); };
  }
  globalThis.__inputElement = canvas.canvas; background(255, 128, 0); } };`);
  await expect.poll(()=>pixels(page)).toEqual([B,R,B,B]);
  expect(await page.evaluate(()=>window.p5jsLive.controller.actions.setSafeState().ok)).toBe(true);
  await page.evaluate(()=>{globalThis.__previousInput = globalThis.__inputElement;});
  await evaluate(page, 'const scene = [blue]; scene.draw();');
  await expect.poll(()=>page.evaluate(()=>globalThis.__inputReleased)).toBe(true);
  expect(await page.evaluate(()=>window.p5jsLive.controller.actions.restoreSafeState().ok)).toBe(true);
  await expect.poll(()=>pixels(page)).toEqual([B,R,B,B]);
  await expect.poll(()=>page.evaluate(()=>globalThis.__inputElement !== globalThis.__previousInput)).toBe(true);
});


test('spatial maps keep their orientation, green displaces vertically, and alpha weights movement', async ({page}) => {
  await boot(page);
  const sample = (x,y) => page.evaluate(({x,y}) => {
    const c=document.querySelector('#stage canvas');
    return [...c.getContext('2d').getImageData(Math.floor(c.width*x),Math.floor(c.height*y),1,1).data];
  },{x,y});
  await evaluate(page, `const shift = { draw() { background(128); noStroke(); fill(255,128,0); rect(0,0,width,height/2); } };`);
  await expect.poll(()=>sample(0.375,0.25)).toEqual(R);
  await expect.poll(()=>sample(0.375,0.75)).toEqual(B);
  await evaluate(page, `const shift = { draw() { background(255,128,0,128); } };`);
  await expect.poll(()=>sample(0.3,0.5)).toEqual(B);
  await expect.poll(()=>sample(0.45,0.5)).toEqual(R);
  await evaluate(page, `const stripe = { draw() { noStroke(); fill(255,0,0); rect(0,height*0.5,width,height*0.25); } };
    const shift = { draw() { background(128,255,0); } };`);
  await expect.poll(()=>sample(0.5,0.375)).toEqual(R);
  await expect.poll(()=>sample(0.5,0.625)).toEqual(B);
});


test('named image arrays and anonymous input occurrences navigate to the owning source', async ({page}) => {
  await boot(page, SOURCE.replace('// %% scene scene', '// %% setup imageMap\nconst imageMap = [shift];\n// %% scene scene').replace('.modulate([shift], 0.5)', '.modulate(imageMap, 0.5)'));
  expect(await page.evaluate(()=>window.p5jsLive.editor.revealStrategy('imageMap'))).toBe(true);
  expect(await page.evaluate(()=>window.p5jsLive.editor.revealStrategy('scene[1][1][input0][0]'))).toBe(true);
});
