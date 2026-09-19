/*
  The stint calculator's document, one per board.

    POST /api/calc  { op: "get",  id }
    POST /api/calc  { op: "save", id, calc, rev }

  Same people as the stint data: the owner, and any key issued for the board.
  Unlike the board itself there is no public read — the calculator is a working
  tool, so both operations need a key and the key travels in a header.

  Saves carry the revision the client last saw; a second editor saving on top of
  a newer version gets a 409 with the current document instead of overwriting it.
*/

import { isConfigured } from './_lib/store.js';
import { bearer, identify, noteAuthFailure } from './_lib/auth.js';
import { loadBoard, loadCalc, saveCalc } from './_lib/boards.js';
import { normalizeCalc } from './_lib/calc-schema.js';
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

  const board = await loadBoard(body.id);
  if (!board) return fail(res, 404, 'Таблица не найдена');

  const who = await identify(bearer(req), board);
  if (!who) {
    const blocked = await noteAuthFailure(req);
    return fail(res, blocked ? 429 : 401, blocked ? 'Слишком много попыток. Подождите пять минут.' : 'Нужен действующий ключ доступа');
  }

  const current = await loadCalc(board.id);
  const op = String(body.op || 'get');

  if (op === 'get') {
    return json(res, 200, { calc: current, role: who.role }, { 'Cache-Control': 'no-store' });
  }

  if (op === 'save') {
    const rev = current ? Number(current.rev) || 0 : 0;
    if (body.rev !== undefined && Number(body.rev) !== rev) {
      return json(res, 409, { error: 'Калькулятор уже изменили. Обновите страницу.', calc: current });
    }

    let doc;
    try {
      doc = normalizeCalc(body.calc);
    } catch (err) {
      return fail(res, 400, err.message);
    }

    const saved = await saveCalc(board.id, doc, who.label);
    return json(res, 200, { ok: true, rev: saved.rev, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy });
  }

  return fail(res, 400, 'Неизвестная операция');
}
