/*
  Key/value storage for the stint boards.

  Production: Upstash Redis over its REST API (the store Vercel provisions from
  Storage -> Upstash Redis). Talked to with plain fetch so the site keeps its
  single runtime dependency and nothing has to be installed at build time.

  Local: when the REST credentials are absent and NODE_ENV isn't production,
  values land in .stints-dev/ as files, so `vercel dev` works before the store
  exists. In production, missing credentials are NOT papered over — the API
  fails closed with 503, the same stance middleware.js takes for the admin page.
*/

import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const REST_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const REST_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

const remote = Boolean(REST_URL && REST_TOKEN);
const devFiles = !remote && process.env.NODE_ENV !== 'production';
const DEV_DIR = join(process.cwd(), '.stints-dev');

export const isConfigured = () => remote || devFiles;
export const storageMode = () => (remote ? 'upstash' : devFiles ? 'dev-files' : 'none');

async function redis(args) {
  const res = await fetch(REST_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `storage responded ${res.status}`);
  return body.result;
}

const devPath = key => join(DEV_DIR, encodeURIComponent(key) + '.json');

// Read a JSON value. Returns null for a missing key or unparseable content.
export async function kvGet(key) {
  let raw;
  if (remote) {
    raw = await redis(['GET', key]);
  } else {
    raw = await readFile(devPath(key), 'utf8').catch(() => null);
  }
  if (raw == null) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

export async function kvSet(key, value) {
  const raw = JSON.stringify(value);
  if (remote) {
    await redis(['SET', key, raw]);
    return;
  }
  await mkdir(DEV_DIR, { recursive: true });
  await writeFile(devPath(key), raw);
}

export async function kvDel(key) {
  if (remote) {
    await redis(['DEL', key]);
    return;
  }
  await unlink(devPath(key)).catch(() => {});
}

/*
  Counter with a sliding expiry, used for the failed-auth throttle. The dev
  fallback keeps the window in memory — good enough for one local process.
*/
const devCounters = new Map();

export async function kvIncr(key, ttlSec) {
  if (remote) {
    const n = await redis(['INCR', key]);
    if (n === 1) await redis(['EXPIRE', key, String(ttlSec)]);
    return n;
  }
  const now = Date.now();
  const hit = devCounters.get(key);
  if (!hit || hit.until < now) {
    devCounters.set(key, { n: 1, until: now + ttlSec * 1000 });
    return 1;
  }
  hit.n += 1;
  return hit.n;
}
