/*
  Board documents and the two indexes around them.

  Layout in the store:
    stints:board:<id>   one board — title, meta, data, view, access
    stints:index        [{ id, title, createdAt, updatedAt }] for the owner's list
    stints:key:<hash>   [boardId, ...] the boards one issued key can reach

  The reverse index by key hash is what lets an invited editor open the panel
  and see their boards without the owner's list ever being read.
*/

import { kvGet, kvSet, kvDel } from './store.js';
import { newId } from './auth.js';
import { defaultView, normalizeMeta, normalizeTitle, LIMITS } from './schema.js';

const boardKey = id => 'stints:board:' + id;
const keyIndexKey = hash => 'stints:key:' + hash;
const INDEX_KEY = 'stints:index';

export const makeId = () => newId(9);

export async function loadBoard(id) {
  if (!id || typeof id !== 'string' || id.length > 32) return null;
  return kvGet(boardKey(id));
}

export async function saveBoard(board) {
  board.rev = (Number(board.rev) || 0) + 1;
  board.updatedAt = new Date().toISOString();
  await kvSet(boardKey(board.id), board);
  await touchIndex(board);
  return board;
}

export async function loadIndex() {
  const list = await kvGet(INDEX_KEY);
  return Array.isArray(list) ? list : [];
}

async function touchIndex(board) {
  const list = await loadIndex();
  const row = { id: board.id, title: board.title, createdAt: board.createdAt, updatedAt: board.updatedAt };
  const at = list.findIndex(item => item.id === board.id);
  if (at === -1) list.unshift(row);
  else list[at] = row;
  await kvSet(INDEX_KEY, list.slice(0, LIMITS.boards));
}

export async function createBoard({ title, meta }) {
  const now = new Date().toISOString();
  const board = {
    id: makeId(),
    title: normalizeTitle(title),
    meta: normalizeMeta(meta),
    data: { drivers: [], stints: [] },
    view: defaultView(),
    access: { keys: [] },
    rev: 0,
    createdAt: now,
    updatedAt: now,
    updatedBy: 'Владелец',
  };
  await saveBoard(board);
  return board;
}

export async function deleteBoard(board) {
  for (const entry of board.access?.keys || []) {
    await unlinkKey(entry.hash, board.id);
  }
  await kvDel(boardKey(board.id));
  const list = await loadIndex();
  await kvSet(INDEX_KEY, list.filter(item => item.id !== board.id));
}

export async function linkKey(hash, boardId) {
  const list = (await kvGet(keyIndexKey(hash))) || [];
  if (!list.includes(boardId)) list.push(boardId);
  await kvSet(keyIndexKey(hash), list.slice(0, LIMITS.boards));
}

export async function unlinkKey(hash, boardId) {
  const list = (await kvGet(keyIndexKey(hash))) || [];
  const left = list.filter(id => id !== boardId);
  if (left.length) await kvSet(keyIndexKey(hash), left);
  else await kvDel(keyIndexKey(hash));
}

export const boardsForKey = hash => kvGet(keyIndexKey(hash)).then(list => (Array.isArray(list) ? list : []));
