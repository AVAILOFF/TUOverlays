/*
  The stint board itself.

    GET  /api/stints?id=<boardId>   public read — what /s/<id> renders
    POST /api/stints                write, key required

  The public read is the only unauthenticated route in the tool. It answers with
  publicBoard(), which drops the access section, so the key hashes never leave
  the server even though the board id is effectively a public link.
*/

import { isConfigured } from './_lib/store.js';
import { bearer, identify, noteAuthFailure } from './_lib/auth.js';
import { loadBoard, saveBoard, makeId } from './_lib/boards.js';
import { normalizeData, normalizeMeta, normalizeView, normalizeTitle, publicBoard } from './_lib/schema.js';
import { json, fail, readJsonBody } from './_lib/http.js';

export default async function handler(req, res) {
  if (!isConfigured()) {
    return fail(res, 503, 'Хранилище не настроено. Добавьте Upstash Redis в проект Vercel.');
  }

  if (req.method === 'GET') return read(req, res);
  if (req.method === 'POST') return write(req, res);

  res.setHeader('Allow', 'GET, POST');
  return fail(res, 405, 'Метод не поддерживается');
}

async function read(req, res) {
  const id = String((req.query && req.query.id) || new URL(req.url, 'http://x').searchParams.get('id') || '');
  const board = await loadBoard(id);
  if (!board) return fail(res, 404, 'Таблица не найдена');

  return json(res, 200, publicBoard(board), {
    'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30',
  });
}

async function write(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return fail(res, 400, err.message);
  }

  const board = await loadBoard(body.id);
  if (!board) return fail(res, 404, 'Таблица не найдена');

  const who = identify(bearer(req), board);
  if (!who) {
    const blocked = await noteAuthFailure(req);
    return fail(res, blocked ? 429 : 401, blocked ? 'Слишком много попыток. Подождите пять минут.' : 'Нужен действующий ключ доступа');
  }

  // Appearance is the owner's call; editors own the race data.
  if (body.view !== undefined && who.role !== 'owner') {
    return fail(res, 403, 'Оформление меняет только владелец');
  }

  // Optimistic locking: two people editing at once, the second one is told to
  // reload instead of silently overwriting the first.
  if (body.rev !== undefined && Number(body.rev) !== Number(board.rev)) {
    return json(res, 409, { error: 'Таблицу уже изменили. Обновите страницу.', board: publicBoard(board) });
  }

  if (body.title !== undefined) board.title = normalizeTitle(body.title);
  if (body.meta !== undefined) board.meta = normalizeMeta(body.meta);
  if (body.data !== undefined) board.data = normalizeData(body.data, makeId);
  if (body.view !== undefined) board.view = normalizeView(body.view);

  board.updatedBy = who.label;
  if (who.hash) {
    const entry = (board.access?.keys || []).find(k => k.hash === who.hash);
    if (entry) entry.lastUsedAt = new Date().toISOString();
  }
  await saveBoard(board);

  return json(res, 200, {
    ok: true,
    rev: board.rev,
    updatedAt: board.updatedAt,
    updatedBy: board.updatedBy,
  });
}
