/*
  Pull stint rows out of a public Google Sheet.

    POST /api/sheet-import  { boardId, url }   key required (owner or editor)

  Only returns the parsed { drivers, stints } — it never writes to the board.
  The panel drops the result into the working copy and the operator still has
  to press "Сохранить", same as if they'd typed the rows in by hand.

  The pasted url only ever donates a sheet id; the request always goes to a
  csv export URL we build ourselves, so this can't be turned into a fetch of
  an arbitrary host.
*/

import { isConfigured } from './_lib/store.js';
import { bearer, identify, noteAuthFailure } from './_lib/auth.js';
import { loadBoard, makeId } from './_lib/boards.js';
import { normalizeData } from './_lib/schema.js';
import { json, fail, readJsonBody } from './_lib/http.js';
import { extractSheetId, extractGid, exportUrl, parseCsv, sheetToBoardData } from './_lib/sheet-import.js';

const MAX_CSV_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10000;

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

  const board = await loadBoard(body.boardId);
  if (!board) return fail(res, 404, 'Таблица не найдена');

  const who = identify(bearer(req), board);
  if (!who) {
    const blocked = await noteAuthFailure(req);
    return fail(res, blocked ? 429 : 401, blocked ? 'Слишком много попыток. Подождите пять минут.' : 'Нужен действующий ключ доступа');
  }

  const id = extractSheetId(body.url);
  if (!id) return fail(res, 400, 'Не нашли ID таблицы в ссылке. Скопируйте адрес страницы Google Таблиц целиком.');
  const gid = extractGid(body.url);

  let csv;
  try {
    csv = await fetchCsv(exportUrl(id, gid));
  } catch (err) {
    return fail(res, err.status || 502, err.message);
  }

  const rows = parseCsv(csv);
  const { drivers, stints, warnings } = sheetToBoardData(rows, makeId);
  const data = normalizeData({ drivers, stints }, makeId);

  return json(res, 200, { ok: true, data, warnings });
}

async function fetchCsv(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { redirect: 'follow', signal: controller.signal });
  } catch (err) {
    const timeout = err.name === 'AbortError';
    throw Object.assign(new Error(timeout ? 'Google Таблицы не ответили вовремя' : 'Не удалось обратиться к Google Таблицам'), { status: 504 });
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) throw Object.assign(new Error('Таблица не найдена — проверьте ссылку'), { status: 404 });
  if (!res.ok) throw Object.assign(new Error('Таблица недоступна. Откройте доступ «Все, у кого есть ссылка» и попробуйте снова.'), { status: 400 });

  const type = res.headers.get('content-type') || '';
  if (type.includes('text/html')) {
    throw Object.assign(new Error('Таблица недоступна. Откройте доступ «Все, у кого есть ссылка» и попробуйте снова.'), { status: 400 });
  }

  const reader = res.body?.getReader ? res.body.getReader() : null;
  if (!reader) return res.text();

  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_CSV_BYTES) {
      await reader.cancel().catch(() => {});
      throw Object.assign(new Error('Таблица слишком большая'), { status: 400 });
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8');
}
