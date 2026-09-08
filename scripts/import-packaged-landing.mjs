// Import the static page and embedded resources from a packaged single-file HTML.
// Usage: node scripts/import-packaged-landing.mjs /path/to/packaged.html

import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const source = process.argv[2];
const run = promisify(execFile);

if (!source) {
  throw new Error('Pass the packaged landing-page HTML as the first argument.');
}

const packaged = await readFile(resolve(source), 'utf8');

function scriptPayload(type) {
  const openTag = `<script type="${type}">`;
  const start = packaged.indexOf(openTag);
  if (start === -1) throw new Error(`Missing ${type} payload.`);

  const contentStart = start + openTag.length;
  const end = packaged.indexOf('</script>', contentStart);
  if (end === -1) throw new Error(`Unclosed ${type} payload.`);

  return packaged.slice(contentStart, end).trim();
}

const manifest = JSON.parse(scriptPayload('__bundler/manifest'));
const template = JSON.parse(scriptPayload('__bundler/template'));
const imageEntry = Object.entries(manifest).find(([, value]) => value.mime === 'image/png');

if (!imageEntry) throw new Error('The package does not contain the landing-page PNG.');

const [imageId, imageResource] = imageEntry;
const fontEntries = Object.entries(manifest).filter(([, value]) => value.mime === 'font/woff2');
const fontDirectory = join(ROOT, 'site', 'assets', 'fonts');
const sourceImage = join(ROOT, 'site', 'assets', 'editor-preview.png');
const webImage = join(ROOT, 'site', 'assets', 'editor-preview.jpg');

await mkdir(fontDirectory, { recursive: true });
await writeFile(
  sourceImage,
  Buffer.from(imageResource.data, 'base64'),
);
// The exported PNG includes auxiliary HDR metadata that makes some Chromium
// versions paint it transparent. Re-encoding also cuts the transfer size by 75%.
await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '88', sourceImage, '--out', webImage]);
await rm(sourceImage);

for (const [id, resource] of fontEntries) {
  await writeFile(join(fontDirectory, `${id}.woff2`), Buffer.from(resource.data, 'base64'));
}

const helmetMatch = template.match(/<helmet>([\s\S]*?)<\/helmet>/);
if (!helmetMatch) throw new Error('The packaged template has no helmet content.');

let helmet = helmetMatch[1]
  .replace(/\s*<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\s*/, '\n');

for (const [id] of fontEntries) {
  helmet = helmet.replaceAll(id, `/assets/fonts/${id}.woff2`);
}

const bodyMatch = template.match(/<body>([\s\S]*?)<\/body>/);
if (!bodyMatch) throw new Error('The packaged template has no body content.');

let body = bodyMatch[1]
  .replace(/<helmet>[\s\S]*?<\/helmet>/, '')
  .replace(/<\/?x-dc>/g, '')
  .replace(new RegExp(imageId, 'g'), '/assets/editor-preview.jpg')
  .replace(
    'alt="p5js.live editor showing a live audio-reactive tunnel visual"',
    'alt="p5js.live editor showing a live audio-reactive tunnel visual" width="4108" height="2112" decoding="async"',
  )
  .trim();

const output = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>p5js.live — Live-Code Audio-Reactive Visuals</title>
  <meta name="description" content="Write JavaScript and p5.js code that becomes the performance. Improvise audio-reactive graphics, scenes, shaders, and shared visuals live in the browser.">
  <meta name="author" content="Eric Freeman">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
  <meta name="theme-color" content="#fbfbfa">
  <link rel="canonical" href="https://p5js.live/">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" sizes="any">

  <meta property="og:type" content="website">
  <meta property="og:site_name" content="p5js.live">
  <meta property="og:locale" content="en_US">
  <meta property="og:url" content="https://p5js.live/">
  <meta property="og:title" content="p5js.live — Live-Code Audio-Reactive Visuals">
  <meta property="og:description" content="Write JavaScript and p5.js code that becomes the performance.">
  <meta property="og:image" content="https://p5js.live/assets/editor-preview.jpg">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="og:image:width" content="4108">
  <meta property="og:image:height" content="2112">
  <meta property="og:image:alt" content="The p5js.live editor rendering an audio-reactive tunnel visual">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="p5js.live — Live-Code Audio-Reactive Visuals">
  <meta name="twitter:description" content="Write JavaScript and p5.js code that becomes the performance.">
  <meta name="twitter:image" content="https://p5js.live/assets/editor-preview.jpg">
  <meta name="twitter:image:alt" content="The p5js.live editor rendering an audio-reactive tunnel visual">

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "@id": "https://p5js.live/#application",
    "name": "p5js.live",
    "url": "https://p5js.live/live/",
    "description": "A browser-based instrument for improvising audio-reactive JavaScript and p5.js visuals.",
    "applicationCategory": "DeveloperApplication",
    "operatingSystem": "Any operating system with a modern web browser",
    "isAccessibleForFree": true,
    "author": {
      "@type": "Person",
      "name": "Eric Freeman",
      "affiliation": {
        "@type": "Organization",
        "name": "The University of Texas at Austin"
      }
    },
    "codeRepository": "https://github.com/erictfree/P5JS-Live",
    "image": "https://p5js.live/assets/editor-preview.jpg"
  }
  </script>

  <script type="module" src="/analytics.js"></script>
${helmet.trim()}
</head>
<body>
${body}
</body>
</html>
`;

const destination = join(ROOT, 'site', 'index.html');
await writeFile(destination, output);

console.log(`Imported landing page to ${destination}`);
console.log(`Extracted 1 image and ${fontEntries.length} font files.`);
