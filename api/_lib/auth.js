/*
  Access control for the stint tool.

  Two kinds of caller:
    owner  — holds STINTS_OWNER_KEY (set in Vercel env). Full access, including
             issuing keys and editing how the public page looks.
    editor — holds a key this tool issued. Only the stint data of the boards
             their key is listed on.

  Only the SHA-256 of an issued key is ever stored; the key itself is shown once
  at issue time. Keys travel to people as a #fragment, which browsers never send
  to the server, so they stay out of access logs and Referer headers.
*/

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { kvIncr } from './store.js';

export const sha256 = value => createHash('sha256').update(String(value)).digest('hex');

// Compare two hex digests without leaking, through timing, how far they matched.
export function hexEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const newKey = () => 'tus_' + b64url(randomBytes(32));
export const newId = (bytes = 9) => b64url(randomBytes(bytes));

export function bearer(req) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : '';
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

const FAIL_LIMIT = 20;
const FAIL_WINDOW_SEC = 300;

// Count a rejected key. Returns true once the caller should be locked out.
export async function noteAuthFailure(req) {
  const n = await kvIncr('stints:fail:' + sha256(clientIp(req)), FAIL_WINDOW_SEC);
  return n > FAIL_LIMIT;
}

export const ownerConfigured = () => Boolean(process.env.STINTS_OWNER_KEY);

export function isOwnerKey(key) {
  const owner = process.env.STINTS_OWNER_KEY || '';
  if (!owner || !key) return false;
  return hexEqual(sha256(key), sha256(owner));
}

/*
  Resolve a key against a board. `board` may be null when the caller only needs
  to know whether this is the owner (board list, board creation).
*/
export function identify(key, board) {
  if (!key) return null;
  if (isOwnerKey(key)) return { role: 'owner', label: 'Владелец', hash: null };
  if (!board) return null;

  const hash = sha256(key);
  const entry = (board.access?.keys || []).find(k => hexEqual(k.hash, hash));
  if (!entry) return null;
  return { role: entry.role === 'owner' ? 'owner' : 'editor', label: entry.label || 'Без имени', hash };
}
