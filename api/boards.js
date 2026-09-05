/*
  The panel's board list, plus creating and deleting boards.

    POST /api/boards  { op: "list" | "create" | "delete", ... }

  Everything here is a POST so the owner key travels in a header and nothing
  lands in a cache or a log. "list" is also how the panel learns who the caller
  is: the reply carries the role, which decides which tabs it renders.

  Creating and deleting boards stays with the key from STINTS_OWNER_KEY. Keys
  issued to other people are scoped to the boards they were issued for.
*/

import { isConfigured } from './_lib/store.js';
import { bearer, isOwnerKey, sha256, noteAuthFailure, ownerConfigured } from './_lib/auth.js';
import { loadIndex, loadBoard, createBoard, deleteBoard, boardsForKey } from './_lib/boards.js';
import { LIMITS } from './_lib/schema.js';
import { json, fail, readJsonBody } from './_lib/http.js';

export default async function handler(req, res) {
  if (!isConfigured()) {
    return fail(res, 503, 'Хранилище не настроено. Добавьте Upstash Redis в проект Vercel.');
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'Метод не поддерживается');
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return fail(res, 400, err.message);
  }

  const key = bearer(req);
  const owner = isOwnerKey(key);
  const hash = key ? sha256(key) : '';
  const mine = owner ? [] : await boardsForKey(hash);

  if (!key || (!owner && !mine.length)) {
    // Tell a misconfigured deployment apart from a wrong key — otherwise the
    // panel says "ключ не подошёл" for a variable that was never set.
    if (key && !ownerConfigured()) {
      return fail(res, 503, 'На сервере не задан STINTS_OWNER_KEY — добавьте переменную в Vercel и сделайте redeploy.');
    }
    const blocked = await noteAuthFailure(req);
    return fail(res, blocked ? 429 : 401, blocked ? 'Слишком много попыток. Подождите пять минут.' : 'Нужен действующий ключ доступа');
  }

  const op = String(body.op || 'list');

  if (op === 'list') {
    const boards = owner ? await ownerBoards() : await editorBoards(mine, hash);
    return json(res, 200, { role: owner ? 'owner' : 'editor', boards });
  }

  if (!owner) return fail(res, 403, 'Доступно только владельцу');

  if (op === 'create') {
    const index = await loadIndex();
    if (index.length >= LIMITS.boards) return fail(res, 400, 'Достигнут предел числа таблиц');
    const board = await createBoard({ title: body.title, meta: body.meta });
    return json(res, 200, { ok: true, id: board.id, title: board.title });
  }

  if (op === 'delete') {
    const board = await loadBoard(body.id);
    if (!board) return fail(res, 404, 'Таблица не найдена');
    await deleteBoard(board);
    return json(res, 200, { ok: true });
  }

  return fail(res, 400, 'Неизвестная операция');
}

async function ownerBoards() {
  const index = await loadIndex();
  const rows = [];
  for (const item of index) {
    const board = await loadBoard(item.id);
    if (!board) continue;
    rows.push(row(board, 'owner'));
  }
  return rows;
}

async function editorBoards(ids, hash) {
  const rows = [];
  for (const id of ids) {
    const board = await loadBoard(id);
    if (!board) continue;
    const entry = (board.access?.keys || []).find(k => k.hash === hash);
    if (!entry) continue;
    rows.push(row(board, entry.role === 'owner' ? 'owner' : 'editor'));
  }
  return rows;
}

const row = (board, role) => ({
  id: board.id,
  title: board.title,
  track: board.meta?.track || '',
  raceStartIso: board.meta?.raceStartIso || '',
  stints: board.data?.stints?.length || 0,
  updatedAt: board.updatedAt,
  updatedBy: board.updatedBy || '',
  rev: board.rev,
  role,
});
