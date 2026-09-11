// Assemble the Cloudflare Workers static-asset tree.
//
// The marketing site owns `/`. The live instrument keeps its source-relative module
// paths and assets under `/live/`. Networking will be added to the Worker separately.

import { cp, mkdir, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const LIVE = join(DIST, 'live');

const include = (source) => basename(source) !== '.DS_Store';

await rm(DIST, { recursive: true, force: true });
await cp(join(ROOT, 'site'), DIST, {
  recursive: true,
  filter: (source) => include(source) && source !== join(ROOT, 'site/assets'),
});
await mkdir(LIVE, { recursive: true });
await cp(join(ROOT, 'index.html'), join(LIVE, 'index.html'));

for (const directory of ['src', 'starter', 'vendor']) {
  await cp(join(ROOT, directory), join(LIVE, directory), {
    recursive: true,
    filter: include,
  });
}

// Only current application media ships. Historical artwork remains in the source
// repository for design reference; add new runtime assets to this manifest.
const assets = [
  ['site/assets/editor-preview.jpg', 'assets/editor-preview.jpg'],
  ['assets/brand/startup.bgr565', 'live/assets/brand/startup.bgr565'],
  ['assets/video/p5jsrobot.mp4', 'live/assets/video/p5jsrobot.mp4'],
];
for (const [source, target] of assets) {
  const destination = join(DIST, target);
  await mkdir(dirname(destination), { recursive: true });
  await cp(join(ROOT, source), destination);
}

await cp(join(ROOT, 'site/assets/fonts'), join(DIST, 'assets/fonts'), {
  recursive: true,
  filter: include,
});

console.log('Built Cloudflare static assets:');
console.log('  /      site/index.html');
console.log('  /live/ index.html + instrument assets');
