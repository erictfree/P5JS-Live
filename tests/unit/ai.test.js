import { describe, expect, it, vi } from 'vitest';
import { requestSourceEdit } from '../../src/ai/openaiClient.js';
import { createAISettings, DEFAULT_AI_MODEL } from '../../src/ai/settings.js';
import { installLibrarySources } from '../../src/ui/aiAssistant.js';

function fakeStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

describe('AI settings', () => {
  it('keeps a key session-only unless the performer explicitly remembers it', () => {
    const local = fakeStorage();
    const session = fakeStorage();
    const settings = createAISettings({ local, session });

    settings.saveKey('sk-session');
    expect(settings.load()).toEqual({ model: DEFAULT_AI_MODEL, key: 'sk-session', remember: false });
    expect(local.getItem('p5js-live.ai.openai-key')).toBe(null);

    settings.saveKey('sk-device', { remember: true });
    expect(settings.load().key).toBe('sk-device');
    expect(session.getItem('p5js-live.ai.openai-key')).toBe(null);

    settings.forgetKey();
    expect(settings.load().key).toBe('');
  });
});

describe('OpenAI source editing', () => {
  it('uses structured Responses output and disables provider storage', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        output: [{ content: [{ text: JSON.stringify({
          summary: 'Slowed Plasma.',
          source: 'const speed = 0.2;',
          installPatches: ['laserFan'],
        }) }] }],
      }),
    }));

    const result = await requestSourceEdit({
      apiKey: 'sk-private',
      model: DEFAULT_AI_MODEL,
      prompt: 'make it slower',
      source: 'const speed = 1;',
      library: [{ name: 'laserFan', category: 'visual', blurb: 'beams' }],
      fetchImpl,
    });

    expect(result).toEqual({
      summary: 'Slowed Plasma.',
      source: 'const speed = 0.2;',
      installPatches: ['laserFan'],
    });
    const [url, options] = fetchImpl.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(options.headers.Authorization).toBe('Bearer sk-private');
    expect(body.store).toBe(false);
    expect(body.text.format.type).toBe('json_schema');
    expect(body.input).toContain('<CURRENT_SOURCE>');
  });

  it('filters unknown library install requests', async () => {
    const result = await requestSourceEdit({
      apiKey: 'sk-private',
      model: DEFAULT_AI_MODEL,
      prompt: 'add it',
      source: 'const scene = [];',
      library: [{ name: 'known' }],
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ output_text: JSON.stringify({
          summary: 'Added it.',
          source: 'const scene = [known];',
          installPatches: ['known', 'invented'],
        }) }),
      }),
    });

    expect(result.installPatches).toEqual(['known']);
  });

  it('redacts the API key if a provider error includes it', async () => {
    await expect(requestSourceEdit({
      apiKey: 'sk-must-not-leak',
      model: DEFAULT_AI_MODEL,
      prompt: 'change it',
      source: 'const scene = [];',
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Rejected sk-must-not-leak' } }),
      }),
    })).rejects.toThrow('Rejected [redacted]');
  });
});

describe('AI library composition', () => {
  it('installs requested source once and keeps the scene cell last', () => {
    const source = `// %% scene scene\nconst scene = [laserFan];\nactivate(scene);`;
    const patch = `// %% patch laserFan\nconst laserFan = { draw() {} };`;
    const once = installLibrarySources(source, ['laserFan'], [{ name: 'laserFan', source: patch }]);
    const twice = installLibrarySources(once, ['laserFan'], [{ name: 'laserFan', source: patch }]);

    expect(once.indexOf('// %% patch laserFan')).toBeLessThan(once.indexOf('// %% scene scene'));
    expect(twice.match(/const laserFan/g)).toHaveLength(1);
  });
});
