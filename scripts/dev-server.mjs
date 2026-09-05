/*
  Local stand-in for Vercel: static files from the project root plus the /api
  handlers, so the stint tool can be run and tested without deploying.

  `python -m http.server` can serve the marketing pages, but not /api — and the
  stint pages are nothing without it.

    node scripts/dev-server.mjs            -> http://localhost:8787
    STINTS_OWNER_KEY=... node scripts/...  -> sets the owner key for the session

  Without Upstash credentials in the environment, api/_lib/store.js falls back
  to files under .stints-dev/, which is gitignored. Never used in production —
  Vercel runs the api/ handlers itself.
*/

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8787);

if (!process.env.STINTS_OWNER_KEY) {
  process.env.STINTS_OWNER_KEY = 'dev-owner-key';
  console.log('dev-server: STINTS_OWNER_KEY not set, using "dev-owner-key"');
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

const handlers = new Map();

async function apiHandler(name) {
  if (!/^[a-z0-9-]+$/i.test(name)) return null;
  if (handlers.has(name)) return handlers.get(name);
  const file = join(ROOT, 'api', name + '.js');
  try {
    await stat(file);
  } catch {
    return null;
  }
  // Cache-bust so an edited handler is picked up without a restart.
  const mod = await import(pathToFileURL(file).href + '?t=' + Date.now());
  handlers.set(name, mod.default);
  return mod.default;
}

async function send(res, status, body, type) {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.end(body);
}

async function tryFiles(pathname) {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const candidates = [clean];
  if (!extname(clean)) {
    candidates.push(clean + '.html', join(clean, 'index.html'));
  }
  for (const rel of candidates) {
    const abs = join(ROOT, rel);
    if (!abs.startsWith(ROOT)) continue;
    try {
      const info = await stat(abs);
      if (info.isFile()) return abs;
    } catch { /* next candidate */ }
  }
  return null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let pathname = url.pathname;

  if (pathname.startsWith('/api/')) {
    const handler = await apiHandler(pathname.slice(5));
    if (!handler) return send(res, 404, '{"error":"no such endpoint"}', 'application/json');
    req.query = Object.fromEntries(url.searchParams);
    try {
      await handler(req, res);
    } catch (err) {
      console.error('dev-server: handler failed', err);
      if (!res.writableEnded) send(res, 500, JSON.stringify({ error: String(err.message || err) }), 'application/json');
    }
    return;
  }

  // Mirrors the rewrite in vercel.json (tryFiles resolves the .html itself).
  if (/^\/s\/[A-Za-z0-9_-]+$/.test(pathname)) pathname = '/stints';

  const file = await tryFiles(pathname === '/' ? '/index.html' : pathname);
  if (!file) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');

  const body = await readFile(file);
  res.setHeader('Cache-Control', 'no-store');
  send(res, 200, body, TYPES[extname(file)] || 'application/octet-stream');
});

server.listen(PORT, () => {
  console.log(`dev-server: http://localhost:${PORT}`);
  console.log(`dev-server: panel  http://localhost:${PORT}/stints-admin`);
});
