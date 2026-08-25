import { describe, expect, it } from 'vitest';
import {
  DIAGNOSTIC_PATCH_NAMES,
  LIBRARY,
  MODULAR_PATCH_NAMES,
  RAVE_PATCH_NAMES,
  STANDARD_EFFECT_NAMES,
  libraryDemoSource,
  upgradeOpaqueDiagnostics,
} from '../../starter/library.js';
import { STARTER_SOURCE, upgradeLegacyPlasma } from '../../starter/starter.js';
import { createTestHost } from './helpers.js';

const RAVE_PATCHES = [
  'strobe',
  'waveScope',
  'checkerZoom',
  'laserFan',
  'glitchSlices',
  'spectrumHalo',
  'kaleido',
  'pixelRain',
  'neonTunnel',
  'beatBurst',
];

const MIX_ORDER = RAVE_PATCH_NAMES;

describe('the system patch library', () => {
  it('makes the starter Plasma visibly controllable and upgrades known untouched versions', () => {
    expect(STARTER_SOURCE).toContain('float softBlob(');
    expect(STARTER_SOURCE).toContain('speed = 0.35;');
    expect(STARTER_SOURCE).toContain('motion = 0.48;');
    expect(STARTER_SOURCE).toContain(
      'intensity = ({ audio }) => 0.035 + audio.bass * 0.080 + audio.mid * 0.035;',
    );
    expect(STARTER_SOURCE).toContain('warp = ({ audio }) => 0.004 + audio.bass * 0.018;');
    expect(STARTER_SOURCE).toContain(
      'this.#program.setUniform("uIntensity", this.intensity({ audio, time }));',
    );
    expect(STARTER_SOURCE).toContain('this.#program.setUniform("uSpeed", this.speed);');
    expect(STARTER_SOURCE).toContain('Plasma transforms the existing scene');
    expect(STARTER_SOURCE).toContain('gl_FragColor = vec4(colour, sourceSample.a);');
    expect(STARTER_SOURCE).not.toContain('vec3 colour = scene + ambient;');
    expect(STARTER_SOURCE).not.toContain('float bands = 0.5 + 0.5 * cos(');

    const customizedOpaque = STARTER_SOURCE
      .replace('motion = 0.48;', 'motion = 0.77;')
      .replace('      vec4 sourceSample = texture2D(uScene, sampleUv);\n', '')
      .replace(
        '      // Plasma transforms the existing scene; it never supplies a background.\n      vec3 colour = scene * (vec3(1.0) + ambient * 0.12);',
        '      vec3 colour = scene + ambient;',
      )
      .replace(
        '      gl_FragColor = vec4(colour, sourceSample.a);',
        '      gl_FragColor = vec4(colour, 1.0);',
      );
    const upgradedCustomized = upgradeLegacyPlasma(customizedOpaque);
    expect(upgradedCustomized).toContain('motion = 0.77;');
    expect(upgradedCustomized).toContain('gl_FragColor = vec4(colour, sourceSample.a);');

    const legacy = STARTER_SOURCE
      .replace(
        'vec2 sampleUv = clamp(uv + flow * uWarp, 0.002, 0.998);',
        'float warp = 0.008 + bass * 0.035;\n      vec2 sampleUv = clamp(uv + flow * warp, 0.002, 0.998);',
      )
      .replace(
        'float bloom = 1.0 + bass * 0.35 + mid * 0.15;',
        'float bands = 0.5 + 0.5 * cos(\n        radius * 16.0\n      );\n      vec3 plasmaColour = mix(cyan, magenta, 0.5);\n      float bloom = 1.0 + bass * 0.35 + mid * 0.15;',
      );

    expect(upgradeLegacyPlasma(legacy)).toBe(STARTER_SOURCE);

    const previousControlled = STARTER_SOURCE
      .replace(
        'intensity = ({ audio }) => 0.035 + audio.bass * 0.080 + audio.mid * 0.035;',
        'intensity = ({ audio }) => 0.0038 + audio.bass * 0.006 + audio.mid * 0.002;',
      )
      .replace('float drift = uTime * uSpeed;', 'float drift = uTime * 0.075;')
      .replace(
        'vec3 scene = vec3(red, green, blue) * 0.88;',
        'vec3 scene = vec3(red, green, blue) * 0.94;',
      );

    expect(upgradeLegacyPlasma(previousControlled)).toBe(STARTER_SOURCE);

    const previousStarter = STARTER_SOURCE
      .replace('speed = 0.35;', 'speed = 0.22;')
      .replace('motion = 0.48;', 'motion = 0.34;')
      .replace(
        'intensity = ({ audio }) => 0.035 + audio.bass * 0.080 + audio.mid * 0.035;',
        'intensity = ({ audio }) => 0.022 + audio.bass * 0.055 + audio.mid * 0.020;',
      )
      .replace('warp = ({ audio }) => 0.004 + audio.bass * 0.018;', 'warp = ({ audio }) => 0.0025 + audio.bass * 0.012;')
      .replace('vec3 scene = vec3(red, green, blue) * 0.88;', 'vec3 scene = vec3(red, green, blue) * 0.90;');

    expect(upgradeLegacyPlasma(previousStarter)).toBe(STARTER_SOURCE);

  });

  it('evaluates the ASCII and Plasma starter as ordinary live JavaScript', () => {
    const h = createTestHost();
    const result = h.evaluator.evaluate(STARTER_SOURCE);
    h.host.commitPendingChanges();

    expect(result.ok).toBe(true);
    expect(h.registry.hasStrategy('asciiNoise')).toBe(true);
    expect(h.registry.hasStrategy('plasma')).toBe(true);
    expect(h.registry.activeOrder()).toEqual(['asciiNoise', 'plasma']);
  });

  it('ships ten independently installable patches in varied JavaScript forms', () => {
    const entries = new Map(LIBRARY.map((entry) => [entry.name, entry]));
    for (const name of RAVE_PATCHES) {
      expect(entries.get(name)?.source).toContain(`// %% patch ${name}`);
    }

    expect(entries.get('strobe').source).toMatch(/function strobe\s*\(/);
    expect(entries.get('waveScope').source).toMatch(/const waveScope\s*=\s*\(/);
    expect(entries.get('checkerZoom').source).toMatch(/const checkerZoom\s*=\s*\(/);
    expect(entries.get('laserFan').source).toMatch(/const laserFan\s*=\s*{/);
    expect(entries.get('glitchSlices').source).toMatch(/const glitchSlices\s*=\s*{/);
    expect(entries.get('spectrumHalo').source).toMatch(/const spectrumHalo\s*=\s*{/);
    expect(entries.get('kaleido').source).toContain('function makeKaleido(');
    expect(entries.get('pixelRain').source).toContain('function makePixelRain(');
    expect(entries.get('neonTunnel').source).toContain('class NeonTunnel');
    expect(entries.get('beatBurst').source).toContain('class BeatBurst');
  });

  it('includes a minimal time-driven object patch as the first visual example', () => {
    const entry = LIBRARY.find(({ name }) => name === 'breathingEllipse');
    expect(entry).toMatchObject({
      category: 'visual',
      blurb: expect.stringContaining('sin(time'),
    });
    expect(entry.source).toContain('speed: 2');
    expect(entry.source).toContain('draw({ time })');
    expect(entry.source).toContain('sin(time * this.speed)');
    expect(entry.source).not.toMatch(/\bbackground\s*\(/);
    expect(entry.source).toContain('ellipse(width / 2, height / 2, diameter, diameter)');

    const h = createTestHost();
    expect(h.evaluator.evaluate(entry.source).ok).toBe(true);
    h.host.commitPendingChanges();
    expect(h.registry.hasStrategy('breathingEllipse')).toBe(true);
  });

  it('ships a silent browser-local video patch with live playback speed', () => {
    const entry = LIBRARY.find(({ name }) => name === 'localVideo');
    expect(entry).toMatchObject({
      category: 'visual',
      blurb: expect.stringContaining('silently'),
    });
    expect(entry.source).toContain('class LocalVideo');
    expect(entry.source).toContain('picker.accept = "video/*"');
    expect(entry.source).toContain('localVideo.choose()');
    expect(entry.source).toContain('control("videoSpeed", 1');
    expect(entry.source).toContain('speed: ({ controls }) => controls.videoSpeed');
    expect(entry.source).toContain('video.muted = true');
    expect(entry.source).toContain('video.defaultMuted = true');
    expect(entry.source).toContain('video.volume = 0');
    expect(entry.source).toContain('drawingContext.drawImage(');
    expect(entry.source).not.toMatch(/\bbackground\s*\(/);

    const h = createTestHost();
    expect(h.evaluator.evaluate(entry.source).ok).toBe(true);
    h.host.commitPendingChanges();
    expect(h.registry.hasStrategy('localVideo')).toBe(true);
    expect(h.registry.activeInstancesOf('localVideo')).toHaveLength(0);
  });

  it('starts with a transparent stateful random ASCII patch', () => {
    const asciiSource = STARTER_SOURCE.slice(
      STARTER_SOURCE.indexOf('// %% patch asciiNoise'),
      STARTER_SOURCE.indexOf('// %% patch plasma'),
    );
    expect(asciiSource).toContain('const asciiNoise = {');
    expect(asciiSource).toContain('characters:');
    expect(asciiSource).toContain('asciiNoise.shuffle()');
    expect(asciiSource).toContain('audio.beat');
    expect(asciiSource).not.toMatch(/\bbackground\s*\(/);

    const h = createTestHost();
    expect(h.evaluator.evaluate(STARTER_SOURCE).ok).toBe(true);
    h.host.commitPendingChanges();
    expect(h.registry.hasStrategy('asciiNoise')).toBe(true);
  });

  it('ships eight small transparent remix layers that evaluate independently', () => {
    expect(MODULAR_PATCH_NAMES).toEqual([
      'roseWindow',
      'waveTerrain',
      'moireField',
      'prismMirror',
      'slowRotate',
      'bassZoom',
      'pixelDrift',
      'neonInk',
    ]);

    const entries = new Map(LIBRARY.map((entry) => [entry.name, entry]));
    const drawings = MODULAR_PATCH_NAMES.slice(0, 3).map((name) => entries.get(name));
    const shaders = MODULAR_PATCH_NAMES.slice(3).map((name) => entries.get(name));

    expect(drawings.map(({ category }) => category)).toEqual(['visual', 'visual', 'visual']);
    expect(shaders.every(({ category }) => category === 'shader')).toBe(true);
    expect(drawings.every(({ source }) => !/\bbackground\s*\(/.test(source))).toBe(true);
    expect(shaders.every(({ source }) => source.includes('new ShaderChain()'))).toBe(true);
    expect(entries.get('roseWindow').source).toContain('const roseWindow = {');
    expect(entries.get('waveTerrain').source).toContain('const waveTerrain = ({ audio, time }) =>');
    expect(entries.get('moireField').source).toContain('field(angle, spacing, colour, alpha)');
    expect(entries.get('slowRotate').source).toContain('.rotate(({ time, audio }) =>');
    expect(entries.get('bassZoom').source).toContain('.scale(({ audio }) =>');

    const h = createTestHost();
    for (const name of MODULAR_PATCH_NAMES) {
      const entry = entries.get(name);
      expect(entry.source).toContain(`// %% patch ${name}`);
      expect(entry.source.split('\n').length).toBeLessThanOrEqual(50);
      expect(h.evaluator.evaluate(entry.source).ok).toBe(true);
      h.host.commitPendingChanges();
      expect(h.registry.hasStrategy(name)).toBe(true);
      expect(h.registry.activeInstancesOf(name)).toHaveLength(0);
    }
  });

  it("installs Conway's Game of Life as a stateful class patch with live methods", () => {
    const entry = LIBRARY.find(({ name }) => name === 'gameOfLife');
    expect(entry).toMatchObject({
      category: 'visual',
      blurb: expect.stringContaining("Conway's Game of Life"),
    });
    expect(entry.source).toContain('class GameOfLife');
    expect(entry.source).toContain('livingNeighbours(x, y, state)');
    expect(entry.source).toContain('neighbours === 3 || (alive && neighbours === 2)');
    expect(entry.source).toContain('gameOfLife.toggle()');
    expect(entry.source).toContain('gameOfLife.singleStep()');
    expect(entry.source).toContain('transparent, stateful class patch');
    expect(entry.source).not.toContain('backgroundFade');

    const h = createTestHost();
    expect(h.evaluator.evaluate(entry.source).ok).toBe(true);
    h.host.commitPendingChanges();

    const implementation = h.registry.getStrategy('gameOfLife').definition;
    expect(implementation.constructor.name).toBe('GameOfLife');
    expect(implementation.running).toBe(true);
    expect(h.evaluator.evaluate('gameOfLife.toggle();').ok).toBe(true);
    expect(implementation.running).toBe(false);
  });

  it('gives an arrow-function patch a declared live control', () => {
    const source = LIBRARY.find((entry) => entry.name === 'checkerZoom').source;
    expect(source).toContain('control("checkerSpeed", 0.08');
    expect(source).toContain('({ audio, time, controls }) =>');
    expect(source).toContain('time * controls.checkerSpeed');
    expect(source).not.toContain('fill(4, 4, 10, 35)');
    expect(source).not.toContain('rect(0, 0, width, height)');
  });

  it('ships independently installable waveform, spectrum and feature diagnostics', () => {
    const entries = new Map(LIBRARY.map((entry) => [entry.name, entry]));
    expect(DIAGNOSTIC_PATCH_NAMES).toEqual(['waveform', 'frequencyBars', 'audioMeters']);

    for (const name of DIAGNOSTIC_PATCH_NAMES) {
      const entry = entries.get(name);
      expect(entry.category).toBe('utility');
      expect(entry.source).toContain(`// %% patch ${name}`);
      expect(entry.blurb).toMatch(/^Diagnostic:/);
    }

    expect(entries.get('waveform').source).toContain('audio.waveform');
    expect(entries.get('frequencyBars').source).toContain('audio.spectrum');
    expect(entries.get('frequencyBars').source).not.toContain('fill(0, 0, 0');
    expect(entries.get('frequencyBars').source).not.toContain('rect(0, top');
    expect(entries.get('frequencyBars').source).not.toContain('opacity:');
    expect(entries.get('frequencyBars').source).not.toMatch(
      /fill\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\s*\)/,
    );
    expect(entries.get('audioMeters').source).toContain('audio.bass');
    expect(entries.get('audioMeters').source).toContain('audio.mid');
    expect(entries.get('audioMeters').source).toContain('audio.treble');
    expect(entries.get('audioMeters').source).not.toContain('fill(8, 8, 12');
    expect(entries.get('audioMeters').source).not.toContain('fill(...colour,');
  });

  it('ships a transparent-friendly solid background utility', () => {
    const entry = LIBRARY.find(({ name }) => name === 'solidBackground');
    expect(entry.category).toBe('utility');
    expect(entry.source).toContain('// %% patch solidBackground');
    expect(entry.source).toContain('background(...this.colour)');
    expect(entry.source).toContain('Put it first in the scene array');
  });

  it('keeps background ownership in the explicit background utility', () => {
    const backgroundOwners = LIBRARY
      .filter(({ source }) => /\bbackground\s*\(/.test(source))
      .map(({ name }) => name);
    expect(backgroundOwners).toEqual(['solidBackground']);

    for (const entry of LIBRARY.filter(({ category }) => category === 'shader')) {
      expect(entry.source, entry.name).not.toMatch(/\bbackground\s*\(/);
    }

    const neonTunnel = LIBRARY.find(({ name }) => name === 'neonTunnel').source;
    expect(neonTunnel).not.toMatch(/\bbackground\s*\(/);
    expect(neonTunnel).not.toContain('rect(0, 0, width, height)');
  });

  it('ships an editable first-class network receiver utility', () => {
    const entry = LIBRARY.find(({ name }) => name === 'networkReceiver');
    expect(entry.category).toBe('utility');
    expect(entry.source).toContain('// %% patch networkReceiver');
    expect(entry.source).toContain('new StreamRoom({');
    expect(entry.source).toContain('performer: "your-name"');
    expect(entry.source).toContain('stream: "performer/main-output"');
    expect(entry.source).toContain('const networkReceiver = receiverRoom.receive({');
  });

  it('upgrades copied diagnostic defaults without touching other patch cells', () => {
    const source = `// %% patch frequencyBars
const frequencyBars = {
  panelHeight: 0.34,
  draw() { fill(100, 145, 255, 230); fill(190, 125, 255, 230); fill(255, 190, 95, 230); }
};

// %% patch audioMeters
const audioMeters = { draw() { fill(...colour, 220); } };

// %% patch customPatch
const customPatch = { draw() { fill(100, 145, 255, 230); } };`;

    const upgraded = upgradeOpaqueDiagnostics(source);
    expect(upgraded).toContain('heightRatio: 0.34');
    expect(upgraded).toContain('fill(100, 145, 255);');
    expect(upgraded).toContain('fill(...colour);');
    expect(upgraded).toContain('customPatch = { draw() { fill(100, 145, 255, 230); } }');
  });

  it('gives every system library patch an explicit display category', () => {
    expect(LIBRARY.every(({ category }) => ['visual', 'utility', 'shader'].includes(category)))
      .toBe(true);
    expect(LIBRARY.find(({ name }) => name === 'cellularBlobular').category).toBe('shader');
  });

  it('ships a ShaderChain example with live higher-order parameters', () => {
    const entry = LIBRARY.find(({ name }) => name === 'shaderFlow');
    expect(entry.category).toBe('shader');
    expect(entry.source).toContain('new ShaderChain()');
    expect(entry.source).toContain('.rotate(({ time, audio }) =>');
    expect(entry.source).toContain('.scale(({ audio }) =>');
    expect(entry.source).toContain('.hue(({ time, audio }) =>');
  });

  it('ships the credited Glass Origin procedural shader as a configurable class', () => {
    const entry = LIBRARY.find(({ name }) => name === 'glassOrigin');
    expect(entry).toMatchObject({
      title: 'Glass Origin',
      category: 'shader',
    });
    expect(entry.source).toContain('SPDX-License-Identifier: CC-BY-NC-SA-4.0');
    expect(entry.source).toContain('Copyright (c) 2026 @Frostbyte');
    expect(entry.source).toContain('https://fragcoord.xyz/s/tbe1g319');
    expect(entry.source).toContain('class GlassOrigin');
    expect(entry.source).toContain('const glassOrigin = new GlassOrigin({');
    expect(entry.source).toContain('glow: ({ audio }) =>');

    const h = createTestHost();
    expect(h.evaluator.evaluate(entry.source).ok).toBe(true);
    h.host.commitPendingChanges();
    expect(h.registry.hasStrategy('glassOrigin')).toBe(true);
    expect(h.registry.activeInstancesOf('glassOrigin')).toHaveLength(0);
  });

  it('ships the credited Pattern CRT procedural shader as a configurable class', () => {
    const entry = LIBRARY.find(({ name }) => name === 'patternCRT');
    expect(entry).toMatchObject({
      title: 'Pattern CRT',
      category: 'shader',
    });
    expect(entry.source).toContain('Copyright (c) 2016 David A Roberts');
    expect(entry.source).toContain('https://davidar.io');
    expect(entry.source).toContain('https://www.shadertoy.com/view/XtlSD7');
    expect(entry.source).toContain('License: not specified');
    expect(entry.source).toContain('class PatternCRT');
    expect(entry.source).toContain('const patternCRT = new PatternCRT({');
    expect(entry.source).toContain('scale: ({ audio }) =>');

    const h = createTestHost();
    expect(h.evaluator.evaluate(entry.source).ok).toBe(true);
    h.host.commitPendingChanges();
    expect(h.registry.hasStrategy('patternCRT')).toBe(true);
    expect(h.registry.activeInstancesOf('patternCRT')).toHaveLength(0);
  });

  it('ships ten installable standard effects with live controls and no backgrounds', () => {
    expect(STANDARD_EFFECT_NAMES).toEqual([
      'transformFx', 'softBlur', 'edgeDetect', 'bloom', 'vignette',
      'noiseWarp', 'rgbSplit', 'feedbackEcho', 'lumaMask', 'mirror',
    ]);
    const entries = new Map(LIBRARY.map((entry) => [entry.name, entry]));
    const h = createTestHost();

    for (const name of STANDARD_EFFECT_NAMES) {
      const entry = entries.get(name);
      expect(entry.category).toBe('shader');
      expect(entry.blurb).toMatch(/^Effect:/);
      expect(entry.source).toContain(`// %% patch ${name}`);
      expect(entry.source).toContain('new ShaderChain()');
      expect(entry.source).toContain('.mix(');
      expect(entry.source).not.toMatch(/\bbackground\s*\(/);
      expect(h.evaluator.evaluate(entry.source).ok).toBe(true);
      h.host.commitPendingChanges();
      expect(h.registry.hasStrategy(name)).toBe(true);
      expect(h.registry.activeInstancesOf(name)).toHaveLength(0);
    }

    expect(entries.get('edgeDetect').source).toContain('.blend("screen")');
    expect(entries.get('rgbSplit').source).toContain('.mix(({ audio }) =>');
    expect(entries.get('feedbackEcho').source).toContain('.feedback(');
  });

  it('includes the credited Hydra feedback study as a configurable shader class', () => {
    const source = LIBRARY.find((entry) => entry.name === 'cellularBlobular').source;
    const h = createTestHost();
    const result = h.evaluator.evaluate(source);
    h.host.commitPendingChanges();

    expect(source).toContain('After Mahalia H-R');
    expect(source).toContain('class CellularBlobular');
    expect(source).toContain('uniform sampler2D uFeedback;');
    expect(source).toContain('scale = ({ audio, time }) =>');
    expect(source).toContain('repeats = ({ audio, time }) =>');
    expect(source).toContain('write.clear();');
    expect(source).toContain('gl_FragColor = vec4(colour, alpha);');
    expect(source).not.toContain('gl_FragColor = vec4(colour, 1.0);');
    expect(result.ok).toBe(true);
    expect(h.registry.hasStrategy('cellularBlobular')).toBe(true);
  });

  it('installs every form and composes all ten without activating them early', () => {
    const h = createTestHost();
    for (const entry of LIBRARY.filter((candidate) => RAVE_PATCHES.includes(candidate.name))) {
      expect(h.evaluator.evaluate(entry.source).ok).toBe(true);
      h.frame(2);
      expect(h.registry.hasStrategy(entry.name)).toBe(true);
      expect(h.registry.activeInstancesOf(entry.name)).toHaveLength(0);
    }

    expect(h.evaluator.evaluate(libraryDemoSource()).ok).toBe(true);
    h.evaluator.applyPending();
    expect(h.registry.activeSceneName()).toBe('stacked');
    expect(h.registry.activeOrder()).toEqual(MIX_ORDER);
  });

  it('can evaluate all ten source cells as one fast installation batch', () => {
    const h = createTestHost();
    const batch = LIBRARY.filter((entry) => RAVE_PATCHES.includes(entry.name))
      .map((entry) => entry.source)
      .join('\n\n');

    expect(h.evaluator.evaluate(batch).ok).toBe(true);
    h.frame(2);
    expect(RAVE_PATCHES.every((name) => h.registry.hasStrategy(name))).toBe(true);
    expect(h.registry.activeOrder()).toEqual([]);
  });
});
