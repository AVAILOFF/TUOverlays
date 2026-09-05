/*
  Issuing and revoking the personal access keys.

    POST /api/keys  { op: "list" | "issue" | "revoke", boardId, ... }

  Only the key from STINTS_OWNER_KEY may call this. A freshly issued key is
  returned exactly once, in the reply to "issue" — the board keeps only its
  SHA-256, so a lost key can be revoked and reissued but never recovered.
*/

import { isConfigured } from './_lib/store.js';
import { bearer, isOwnerKey, sha256, newKey, noteAuthFailure } from './_lib/auth.js';
import { loadBoard, saveBoard, linkKey, unlinkKey } from './_lib/boards.js';
import { LIMITS, normalizeLabel } from './_lib/schema.js';
import { json, fail, readJsonBody } from './_lib/http.js';

export default async function handler(req, res) {
  if (!isConfigured()) {
    return fail(res, 503, 'Хранилище не настроено. Добавьте Upstash Redis в проект Vercel.');
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'Метод не поддерживается');
  }

  if (!isOwnerKey(bearer(req))) {
    const blocked = await noteAuthFailure(req);
    return fail(res, blocked ? 429 : 403, blocked ? 'Слишком много попыток. Подождите пять минут.' : 'Доступно только владельцу');
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return fail(res, 400, err.message);
  }

  const board = await loadBoard(body.boardId);
  if (!board) return fail(res, 404, 'Таблица не найдена');
  if (!board.access || !Array.isArray(board.access.keys)) board.access = { keys: [] };

  const op = String(body.op || 'list');

  if (op === 'list') {
    return json(res, 200, { keys: board.access.keys.map(publicKey) });
  }

  if (op === 'issue') {
    if (board.access.keys.length >= LIMITS.keys) return fail(res, 400, 'Достигнут предел числа ключей');
    const key = newKey();
    const entry = {
      hash: sha256(key),
      label: normalizeLabel(body.label),
      role: body.role === 'owner' ? 'owner' : 'editor',
      createdAt: new Date().toISOString(),
      lastUsedAt: '',
    };
    board.access.keys.push(entry);
    await saveBoard(board);
    await linkKey(entry.hash, board.id);
    // The only moment the key exists outside the issuer's browser.
    return json(res, 200, { ok: true, key, entry: publicKey(entry) });
  }

  if (op === 'revoke') {
    const hash = String(body.hash || '');
    const entry = board.access.keys.find(k => k.hash === hash);
    if (!entry) return fail(res, 404, 'Ключ не найден');
    board.access.keys = board.access.keys.filter(k => k.hash !== hash);
    await saveBoard(board);
    await unlinkKey(hash, board.id);
    return json(res, 200, { ok: true });
  }

  return fail(res, 400, 'Неизвестная операция');
}

// The panel lists keys by label; the hash is the handle used to revoke one.
const publicKey = entry => ({
  hash: entry.hash,
  label: entry.label,
  role: entry.role,
  createdAt: entry.createdAt,
  lastUsedAt: entry.lastUsedAt || '',
});
