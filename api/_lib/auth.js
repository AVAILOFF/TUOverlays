/*
  Access control for the stint tool.

  Two kinds of caller:
    owner  — holds STINTS_OWNER_KEY (set in Vercel env). Full access, including
             issuing keys and editing how the public page looks.
    team   — holds a team key the owner issued. The same full access over every
             board (create, delete, appearance, calculator, per-board keys) —
             the one thing it cannot do is issue or revoke team keys.
    editor — holds a key this tool issued. Only the stint data of the boards
             their key is listed on.

  Only the SHA-256 of an issued key is ever stored; the key itself is shown once
  at issue time. Keys travel to people as a #fragment, which browsers never send
  to the server, so they stay out of access logs and Referer headers.
*/

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { kvIncr, kvGet, kvSet } from './store.js';

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

// Trimmed: pasting a key into a dashboard field often carries a trailing
// newline, and a key that fails only because of invisible whitespace is a
// miserable thing to debug.
const ownerKey = () => (process.env.STINTS_OWNER_KEY || '').trim();

export const ownerConfigured = () => Boolean(ownerKey());

export function isOwnerKey(key) {
  const owner = ownerKey();
  if (!owner || !key) return false;
  return hexEqual(sha256(key), sha256(owner));
}

/*
  Team keys — full access to every board, issued by the owner. Kept as a single
  list of { hash, label, createdAt } under one store key; like every issued key,
  only the SHA-256 is stored.
*/
const TEAM_KEY = 'stints:team';
export const TEAM_LIMIT = 20;

export async function loadTeam() {
  const list = await kvGet(TEAM_KEY);
  return Array.isArray(list) ? list : [];
}

export const saveTeam = list => kvSet(TEAM_KEY, list.slice(0, TEAM_LIMIT));

async function findTeamKey(key) {
  if (!key) return null;
  const hash = sha256(key);
  const list = await loadTeam();
  return list.find(entry => hexEqual(entry.hash, hash)) || null;
}

/*
  Full access, or null: the owner key, or a team key. `root` is true only for
  the owner key — it alone may manage team keys.
*/
export async function fullAccess(key) {
  if (!key) return null;
  if (isOwnerKey(key)) return { role: 'owner', label: 'Владелец', hash: null, root: true, team: false };
  const entry = await findTeamKey(key);
  if (!entry) return null;
  return { role: 'owner', label: entry.label || 'Команда', hash: entry.hash, root: false, team: true };
}

/*
  Resolve a key against a board. `board` may be null when the caller only needs
  to know whether this is full access (board list, board creation).
*/
export async function identify(key, board) {
  if (!key) return null;
  const full = await fullAccess(key);
  if (full) return full;
  if (!board) return null;

  const hash = sha256(key);
  const entry = (board.access?.keys || []).find(k => hexEqual(k.hash, hash));
  if (!entry) return null;
  return { role: entry.role === 'owner' ? 'owner' : 'editor', label: entry.label || 'Без имени', hash, root: false, team: false };
}
