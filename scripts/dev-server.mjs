// Static development server plus the small WebSocket introduction service used by
// StreamRoom. WebRTC media still travels browser-to-browser, never through this app.
//
// p5js live is a plain HTML page — there is no bundler and no compile step. But ES
// modules will not load from a `file://` URL, so the page needs an HTTP origin.
// This server supplies that origin and the optional signaling control plane. The
// only runtime package is `ws`; the visual app itself remains plain browser modules.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachSignalingServer } from './signaling-server.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE_ROOT = join(ROOT, 'site');
const LIVE_PREFIX = '/live';
const PORT = Number(process.env.PORT ?? 5173);

function configuredIceServers() {
  const value = process.env.P5JS_LIVE_ICE_SERVERS;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new TypeError('expected a JSON array');
    return parsed;
  } catch (error) {
    console.error(`Invalid P5JS_LIVE_ICE_SERVERS: ${error.message}`);
    process.exitCode = 1;
    return [];
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
};

function resolveStaticFile(root, pathname) {
  const rootPath = resolve(root);
  const relativePath = pathname.replace(/^\/+/, '');
  const filePath = resolve(rootPath, relativePath);
  if (filePath !== rootPath && !filePath.startsWith(`${rootPath}${sep}`)) return null;
  return filePath;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }

  if (pathname === LIVE_PREFIX) {
    res.writeHead(308, {
      Location: `${LIVE_PREFIX}/${url.search}`,
      'Cache-Control': 'no-store',
    });
    res.end();
    return;
  }

  const isLive = pathname.startsWith(`${LIVE_PREFIX}/`);
  const staticRoot = isLive ? ROOT : SITE_ROOT;
  if (isLive) pathname = pathname.slice(LIVE_PREFIX.length);
  if (pathname.endsWith('/')) pathname += 'index.html';

  // Resolve inside the selected mount and refuse anything that escapes it.
  const filePath = resolveStaticFile(staticRoot, pathname);
  if (!filePath) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
      // The performer edits and reloads constantly; never serve a stale module.
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Not found: ${pathname}`);
  }
});

attachSignalingServer(server, { iceServers: configuredIceServers() });

server.listen(PORT, () => {
  console.log('p5js live');
  console.log(`  http://localhost:${PORT}/ — site`);
  console.log(`  http://localhost:${PORT}${LIVE_PREFIX}/ — instrument`);
  console.log(`  ws://localhost:${PORT}/network — room discovery + WebRTC signaling`);
});
