import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (path) => readFile(`${root}/${path}`, 'utf8');

const pages = [
  {
    path: 'site/index.html',
    canonical: 'https://p5js.live/',
    title: 'p5js.live — Live-Code Audio-Reactive Visuals',
  },
  {
    path: 'index.html',
    canonical: 'https://p5js.live/live/',
    title: 'p5js.live Instrument — Live-Code p5.js Visuals',
  },
];

describe('public SEO metadata', () => {
  for (const page of pages) {
    test(`${page.path} has complete, page-specific metadata`, async () => {
      const html = await read(page.path);

      expect(html).toContain('<html lang="en">');
      expect(html).toContain(`<title>${page.title}</title>`);
      expect(html).toMatch(/<meta name="description" content="[^"]{80,160}"/);
      expect(html).toContain(`<link rel="canonical" href="${page.canonical}"`);
      expect(html).toContain(`<meta property="og:url" content="${page.canonical}"`);
      expect(html).toContain('<meta property="og:image" content="https://p5js.live/assets/hero-bot-3.png"');
      expect(html).toContain('<meta name="twitter:card" content="summary_large_image"');
      expect(html).toContain('<meta name="robots" content="index, follow, max-image-preview:large');
      expect(html).toContain('<link rel="icon" href="/favicon.svg"');
      if (page.path === 'site/index.html') {
        expect(html).toContain('<script type="module" src="/analytics.js"></script>');
      } else {
        expect(html).not.toContain('<script type="module" src="/analytics.js"></script>');
      }

      const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      expect(blocks).toHaveLength(1);
      expect(() => JSON.parse(blocks[0][1])).not.toThrow();
      expect(blocks[0][1]).toContain('"@id": "https://p5js.live/#application"');
    });
  }

  test('crawl files advertise both canonical pages', async () => {
    const [robots, sitemap] = await Promise.all([
      read('site/robots.txt'),
      read('site/sitemap.xml'),
    ]);

    expect(robots).toContain('Allow: /');
    expect(robots).toContain('Sitemap: https://p5js.live/sitemap.xml');
    expect(sitemap).toContain('<loc>https://p5js.live/</loc>');
    expect(sitemap).toContain('<loc>https://p5js.live/live/</loc>');
  });

  test('analytics uses the p5js.live GA4 Measurement ID', async () => {
    const analytics = await read('site/analytics.js');
    expect(analytics).toContain("const MEASUREMENT_ID = 'G-CKGF1JW4EC';");
    expect(analytics).toContain('/^G-[A-Z0-9]+$/i');
  });
});
