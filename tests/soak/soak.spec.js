// Reliability claims that only a long run can support.
//
//   "A 30-minute input-and-render soak test completes without audio
//    reinitialization or unbounded host memory growth."
//
// The rehearsal path also covers accidental double evaluation, bad code, and FPS
// degradation over a sustained set.
//
// This is separated from the normal E2E suite because it is slow by nature. Duration
// is configurable so it can run short in a normal check and for the full thirty
// minutes before a show:
//
//   npm run test:soak                 # 3 minutes, the default
//   SOAK_MINUTES=30 npm run test:soak
//
// What it is actually watching for: a leak that only shows up after thousands of
// evaluations, an audio graph quietly rebuilt underneath the sketch, and a frame rate
// that decays rather than holding.

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const TONE = fileURLToPath(new URL('../fixtures/test-tone.wav', import.meta.url));
const MINUTES = Number(process.env.SOAK_MINUTES ?? 3);
const DURATION_MS = MINUTES * 60_000;
const EDIT_INTERVAL_MS = 250;
const EDITS_PER_SAMPLE = 40;

// A rotating set of edits, so the run exercises the paths a real set does rather than
// evaluating the same text over and over: a good replacement, a stateful one, a
// syntax error, and code that throws on its first frame.
const EDITS = [
  (i) => `const rings = {
    draw({ audio }) {
      noFill(); stroke(${(i * 37) % 255}, 180, 255); strokeWeight(${1 + (i % 6)});
      circle(width / 2, height / 2, map(audio.bass, 0, 1, 40, width * 0.7));
    },
  };`,
  (i) => `const motes = {
    state: () => ({ pts: [] }),
    draw({ audio, state, dt }) {
      state.pts.push({ x: random(width), y: random(height), t: ${i} });
      if (state.pts.length > 150) state.pts.shift();
      noStroke(); fill(255, 60);
      for (const p of state.pts) circle(p.x, p.y, 2 + audio.treble * 8);
    },
  };`,
  () => 'const rings = { draw({ audio }) { this is not javascript ((( } };',
  () => 'const rings = { draw({ audio }) { definitelyNotDefined.boom(); } };',
  () => 'soakScene.draw();',
];

test(`soak — ${MINUTES} minutes of continuous render, analysis, and evaluation`, async ({
  page,
}) => {
  test.setTimeout(DURATION_MS + 120_000);

  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/live/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('#audio-file').setInputFiles(TONE);
  await expect(page.locator('#start-overlay')).toBeHidden({ timeout: 15_000 });
  await page.evaluate(() => window.p5jsLive.audio.setLoop(true));
  await expect.poll(() => page.evaluate(() => window.p5jsLive.audio.status().playing)).toBe(true);

  // Supply the patches this test replaces and explicitly select a scene. Keep a
  // nested array effect active so the soak exercises both p5 and shader resources.
  const source = `${EDITS[0](0)}\n${EDITS[1](0)}
const backdrop = () => background(20, 22, 27);
const soakScene = [backdrop, [rings, motes].rotate(0, 0.03).opacity(0.9)];
soakScene.draw();`;
  expect(await page.evaluate(source => window.p5jsLive.evaluator.evaluate(source).ok, source)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.p5jsLive.registry.activeSceneName())).toBe('soakScene');

  // Identity probes: if any of these change, something was rebuilt underneath the
  // running sketch, which would violate audio and host continuity.
  await page.evaluate(() => {
    document.querySelector('#stage canvas').dataset.probe = 'original';
    window.__probe = { context: p5.prototype.getAudioContext(), draw: window.draw, setup: window.setup };
  });

  const sample = () =>
    page.evaluate(() => {
      const R = window.p5jsLive;
      return {
        frameCount: window.frameCount,
        fps: R.host.fps(),
        hostTime: R.host.time(),
        heap: performance.memory?.usedJSHeapSize ?? 0,
        audioPosition: R.audio.status().position,
        audioPlaying: R.audio.status().playing,
        sameCanvas: document.querySelector('#stage canvas')?.dataset.probe === 'original',
        sameAudioContext: window.__probe.context === p5.prototype.getAudioContext(),
        sameDraw: window.__probe.draw === window.draw,
        sameSetup: window.__probe.setup === window.setup,
        contextState: p5.prototype.getAudioContext().state,
        strategyCount: R.registry.listStrategies().length,
        sceneName: R.registry.activeSceneName(),
        sceneSize: R.registry.activeOrder().length,
        ringsHealthy: R.registry.getStrategy('rings')?.status === 'ok',
        // Bounded structures prevent unbounded per-frame growth.
        diagnostics: R.diagnostics.list().length,
        maxHistory: Math.max(...R.registry.listStrategies().map((p) => p.history.length)),
        motesTrail: R.stateStore.get('motes')?.pts?.length ?? 0,
      };
    });

  // Let the frame-rate window fill and the audio settle before the first reading.
  await page.waitForTimeout(5_000);
  const baseline = await sample();
  expect(baseline.audioPlaying).toBe(true);
  expect(baseline.motesTrail).toBeGreaterThan(0);

  const samples = [baseline];
  let evaluations = 0;
  const started = Date.now();

  while (Date.now() - started < DURATION_MS) {
    // Roughly four evaluations per second, which is faster than any human performs —
    // the point is to accumulate thousands of them, including the failing ones.
    for (let i = 0; i < EDITS_PER_SAMPLE; i++) {
      const edit = EDITS[evaluations % EDITS.length];
      await page.evaluate(
        (source) => window.p5jsLive.evaluator.evaluate(source, { label: 'soak' }),
        edit(evaluations),
      );
      evaluations++;
      await page.waitForTimeout(EDIT_INTERVAL_MS);
    }
    samples.push(await sample());
  }

  const last = samples.at(-1);
  const elapsedSeconds = (Date.now() - started) / 1000;

  // --- nothing was rebuilt --------------------------------------------------------
  expect(last.sameCanvas).toBe(true);
  expect(last.sameAudioContext).toBe(true);
  expect(last.sameDraw).toBe(true);
  expect(last.sameSetup).toBe(true);
  expect(last.contextState).toBe('running');
  expect(last.audioPlaying).toBe(true);

  // --- everything kept running ----------------------------------------------------
  expect(last.frameCount).toBeGreaterThan(baseline.frameCount);
  expect(last.hostTime).toBeGreaterThan(baseline.hostTime + elapsedSeconds * 0.9);
  expect(samples.every((s) => s.audioPlaying)).toBe(true);
  expect(samples.every((s) => s.sceneName === 'soakScene' && s.sceneSize === 4)).toBe(true);
  expect(samples.every((s) => s.ringsHealthy && s.motesTrail > 0)).toBe(true);
  expect(evaluations).toBeGreaterThan(100);

  // --- bounded structures ---------------------------------------------------------
  expect(last.diagnostics).toBeLessThanOrEqual(200); // the diagnostics ring
  expect(last.maxHistory).toBeLessThanOrEqual(12); // per-strategy version history
  expect(last.motesTrail).toBeLessThanOrEqual(150); // the strategy's own bound

  // --- frame rate held ------------------------------------------------------------
  const meanFps = samples.reduce((a, s) => a + s.fps, 0) / samples.length;
  expect(meanFps).toBeGreaterThan(30);
  expect(last.fps).toBeGreaterThan(baseline.fps * 0.7); // no decay over the run

  // --- host memory did not grow without bound -------------------------------------
  //
  // A live-coding host allocates by design — every evaluation compiles a new function,
  // and every successful one is filed in history. The requirement is that it settles
  // rather than climbing. Compare the back half of the run to the front half instead
  // of first-to-last, so one badly-timed GC cannot decide the verdict.
  if (baseline.heap > 0) {
    const half = Math.floor(samples.length / 2);
    const mean = (list) => list.reduce((a, s) => a + s.heap, 0) / list.length;
    const front = mean(samples.slice(0, half));
    const back = mean(samples.slice(half));
    const growth = (back - front) / front;

    console.log(
      `heap: ${(front / 1e6).toFixed(1)}MB -> ${(back / 1e6).toFixed(1)}MB ` +
        `(${(growth * 100).toFixed(1)}% over ${evaluations} evaluations)`,
    );
    expect(growth).toBeLessThan(0.5);
  }

  console.log(
    `soak: ${elapsedSeconds.toFixed(0)}s · ${last.frameCount} frames · ` +
      `${evaluations} evaluations · mean ${meanFps.toFixed(1)} FPS · ` +
      `audio at ${last.audioPosition.toFixed(1)}s`,
  );

  expect(pageErrors).toEqual([]);
});
