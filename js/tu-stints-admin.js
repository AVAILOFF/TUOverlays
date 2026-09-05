/*
  The stint panel.

  One page, three states: the key gate, the list of boards, and a board
  workspace with three tabs — Стинты (the data), Вид (how the public page
  looks), Доступ (who else may edit).

  The key lives in localStorage and travels only in an Authorization header.
  An invite link carries it in the #fragment, which never reaches the server;
  the fragment is wiped from the address bar as soon as it is read.

  The preview is the real public page in an iframe, driven over postMessage, so
  what the owner tunes here is literally what a viewer will get — no second
  renderer to drift out of sync.
*/

(function () {
  'use strict';

  const STORE_KEY = 'tu-stints-key';
  // Whether manual edits to a stint's length or pit re-chain the starts of the
  // stints below it. A per-browser editor preference, not board data.
  const AUTO_KEY = 'tu-stints-autorecalc';

  // Fallback host for viewers who can't reach the main domain (RU ISPs
  // blocking/throttling it are the recurring case) — a Vercel branch preview
  // that mirrors main, so it stays live independently of the primary domain.
  const MIRROR_ORIGIN = 'https://tu-overlays-git-stints-team-unknown2.vercel.app';

  const state = {
    key: '',
    role: '',
    boards: [],
    board: null,      // the board being edited (working copy)
    saved: null,      // last state confirmed by the server, for "отменить"
    tab: 'data',
    dataDirty: false,
    viewDirty: false,
    previewReady: false,
  };

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null && text !== '') node.textContent = String(text);
    return node;
  };

  const clone = value => JSON.parse(JSON.stringify(value));

  function setStatus(node, text, kind) {
    node.textContent = text;
    node.className = 'status' + (kind ? ' ' + kind : '');
  }

  /* ----------------------------------------------------------- time i/o -- */

  const pad = n => String(n).padStart(2, '0');

  function fmtDur(sec) {
    const s = Math.max(0, Math.round(sec || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? h + ':' + pad(m) + ':' + pad(s % 60) : m + ':' + pad(s % 60);
  }

  // "55:00" -> 3300, "1:01:00" -> 3660, "55" -> 3300 (a bare number is minutes).
  function parseDur(text) {
    const raw = String(text || '').trim().replace(/^\+/, '');
    if (!raw) return 0;
    if (!raw.includes(':')) {
      const mins = Number(raw.replace(',', '.'));
      return Number.isFinite(mins) ? Math.round(mins * 60) : 0;
    }
    const parts = raw.split(':').map(p => Number(p) || 0);
    while (parts.length < 3) parts.unshift(0);
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  /* -------------------------------------------------- start recalcing -- */

  const autoRecalc = () => {
    try { return localStorage.getItem(AUTO_KEY) === '1'; } catch { return false; }
  };
  const setAutoRecalc = on => {
    try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch { /* private mode */ }
  };

  // Chain the plan in place: each stint starts where the previous one ended,
  // plus that previous stint's pit. Same rule as the "Пересчитать старты
  // подряд" button and as the Google import.
  function chainStarts(list, fromIndex) {
    const stints = list || (state.board && state.board.data.stints) || [];
    const from = Math.max(0, fromIndex || 0);
    let cursor = from > 0
      ? stints[from - 1].startOffsetSec + stints[from - 1].plannedDurationSec + stints[from - 1].pitStopDurationSec
      : 0;
    for (let i = from; i < stints.length; i++) {
      stints[i].startOffsetSec = cursor;
      cursor += stints[i].plannedDurationSec + stints[i].pitStopDurationSec;
    }
  }

  // Called after a manual edit / row move: only re-chains when the operator
  // asked for it with the "Автопересчёт" switch.
  function chainIfAuto(fromIndex) {
    if (autoRecalc()) chainStarts(null, fromIndex);
  }

  // Race start as seconds since local midnight, for the clock hints in the
  // editor. NaN when the board has no race start set.
  function raceStartSecOfDay() {
    const iso = state.board && state.board.meta && state.board.meta.raceStartIso;
    if (!iso) return NaN;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return NaN;
    return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  }

  // offsetSec from race start -> "18:45" wall clock (24h, seconds dropped),
  // rolled over midnight. '' when there is no race start to hang it on.
  function offsetToClock(offsetSec) {
    const base = raceStartSecOfDay();
    if (Number.isNaN(base)) return '';
    let s = Math.round(base + offsetSec) % 86400;
    if (s < 0) s += 86400;
    return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor((s % 3600) / 60));
  }

  // <input type="datetime-local"> speaks local wall time; the board stores UTC.
  const isoToLocalInput = iso => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  };
  const localInputToIso = value => {
    if (!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  };

  function relTime(iso) {
    const then = Date.parse(iso);
    if (Number.isNaN(then)) return '—';
    const mins = Math.round((Date.now() - then) / 60000);
    if (mins < 1) return 'только что';
    if (mins < 60) return mins + ' мин назад';
    if (mins < 60 * 24) return Math.round(mins / 60) + ' ч назад';
    return new Date(then).toLocaleDateString('ru-RU');
  }

  /* ---------------------------------------------------------------- api -- */

  async function call(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.key },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Ошибка ' + res.status);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function loadBoard(id) {
    const res = await fetch('/api/stints?id=' + encodeURIComponent(id), { cache: 'no-store' });
    if (!res.ok) throw new Error('Не удалось загрузить таблицу');
    return res.json();
  }

  /* --------------------------------------------------------------- gate -- */

  function readKeyFromHash() {
    const match = /[#&]k=([^&]+)/.exec(location.hash || '');
    if (!match) return '';
    const key = decodeURIComponent(match[1]);
    // Out of the address bar, out of the back/forward history entry.
    history.replaceState(null, '', location.pathname + location.search);
    return key;
  }

  async function signIn(key) {
    const previous = state.key;
    state.key = key;
    try {
      const res = await call('/api/boards', { op: 'list' });
      state.role = res.role;
      state.boards = res.boards;
      localStorage.setItem(STORE_KEY, key);
      return true;
    } catch (err) {
      state.key = previous;
      throw err;
    }
  }

  function showGate(message) {
    $('#gate').hidden = false;
    $('#app').hidden = true;
    const err = $('#gate-err');
    err.textContent = message || '';
    err.hidden = !message;
  }

  function signOut() {
    localStorage.removeItem(STORE_KEY);
    state.key = '';
    state.board = null;
    showGate('');
    $('#gate-key').value = '';
  }

  /* --------------------------------------------------------- board list -- */

  async function refreshBoards() {
    const res = await call('/api/boards', { op: 'list' });
    state.role = res.role;
    state.boards = res.boards;
    renderBoards();
  }

  function renderBoards() {
    $('#who').textContent = state.role === 'owner' ? 'Владелец' : 'Редактор';
    $('#create-panel').hidden = state.role !== 'owner';

    const host = $('#boards');
    host.textContent = '';

    if (!state.boards.length) {
      host.appendChild(el('p', 'empty', state.role === 'owner'
        ? 'Таблиц пока нет — создайте первую выше.'
        : 'Вам пока не выдали доступ ни к одной таблице.'));
      return;
    }

    for (const item of state.boards) {
      const card = el('div', 'board');
      card.appendChild(el('h3', null, item.title));

      const meta = el('div', 'meta');
      if (item.track) meta.appendChild(el('span', null, item.track));
      meta.appendChild(el('span', null, item.stints + ' стинтов'));
      meta.appendChild(el('span', null, relTime(item.updatedAt) + (item.updatedBy ? ' · ' + item.updatedBy : '')));
      card.appendChild(meta);

      const acts = el('div', 'acts');
      const open = el('button', 'btn btn-sm btn-primary', 'Открыть');
      open.addEventListener('click', () => openBoard(item.id));
      acts.appendChild(open);

      const view = el('a', 'btn btn-sm', 'Публичная страница');
      view.href = '/s/' + item.id;
      view.target = '_blank';
      view.rel = 'noopener';
      acts.appendChild(view);

      if (state.role === 'owner') {
        const del = el('button', 'btn btn-sm btn-danger', 'Удалить');
        del.addEventListener('click', async () => {
          if (!confirm('Удалить «' + item.title + '»? Публичная ссылка перестанет работать, восстановить нельзя.')) return;
          await call('/api/boards', { op: 'delete', id: item.id });
          await refreshBoards();
        });
        acts.appendChild(del);
      }

      card.appendChild(acts);
      host.appendChild(card);
    }
  }

  /* ---------------------------------------------------------- workspace -- */

  async function openBoard(id) {
    state.board = await loadBoard(id);
    state.saved = clone(state.board);
    state.dataDirty = false;
    state.viewDirty = false;
    state.previewReady = false;
    $('#issued').hidden = true;
    $('#reload-board').hidden = true;

    $('#screen-list').hidden = true;
    $('#screen-board').hidden = false;
    $('#b-title').textContent = state.board.title;

    const link = location.origin + '/s/' + id;
    $('#public-link').value = link;
    $('#public-open').href = link;

    const mirrorLink = MIRROR_ORIGIN + '/s/' + id;
    $('#public-link-mirror').value = mirrorLink;
    $('#public-open-mirror').href = mirrorLink;

    // The preview is the public page itself; it announces itself when ready.
    $('#preview').src = '/s/' + id + '?preview=1';

    const canView = state.role === 'owner' || boardRole(id) === 'owner';
    $('.tab[data-tab="view"]').hidden = !canView;
    $('#tab-access-btn').hidden = state.role !== 'owner';

    renderData();
    selectTab('data');
  }

  const boardRole = id => {
    const found = state.boards.find(b => b.id === id);
    return found ? found.role : 'editor';
  };

  function backToList() {
    if (dirty() && !confirm('Есть несохранённые изменения. Выйти и потерять их?')) return;
    state.board = null;
    state.dataDirty = false;
    state.viewDirty = false;
    $('#screen-board').hidden = true;
    $('#screen-list').hidden = false;
    refreshBoards().catch(() => {});
  }

  function selectTab(name) {
    state.tab = name;
    for (const tab of $$('.tab')) tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
    $('#tab-data').hidden = name !== 'data';
    $('#tab-view').hidden = name !== 'view';
    $('#tab-access').hidden = name !== 'access';
    if (name === 'view') renderView();
    if (name === 'access') renderAccess();
  }

  const dirty = () => state.dataDirty || state.viewDirty;

  const markDirty = () => {
    state.dataDirty = true;
    $('#save-data').disabled = false;
    setStatus($('#data-status'), 'Есть несохранённые изменения', 'pending');
  };

  /* ------------------------------------------------------- tab: стинты -- */

  function renderData() {
    const board = state.board;

    $('#f-title').value = board.title;
    $('#f-track').value = board.meta.track || '';
    $('#f-car').value = board.meta.car || '';
    $('#f-start').value = isoToLocalInput(board.meta.raceStartIso);
    $('#f-note').value = board.meta.note || '';
    $('#auto-recalc').checked = autoRecalc();

    renderDrivers();
    renderStints();
    $('#save-data').disabled = !state.dataDirty;
  }

  function readMeta() {
    const board = state.board;
    board.title = $('#f-title').value.trim() || 'Без названия';
    board.meta.track = $('#f-track').value.trim();
    board.meta.car = $('#f-car').value.trim();
    board.meta.raceStartIso = localInputToIso($('#f-start').value);
    board.meta.note = $('#f-note').value.trim();
    $('#b-title').textContent = board.title;
  }

  const newId = () => 'x' + Math.random().toString(36).slice(2, 10);

  function renderDrivers() {
    const host = $('#drivers');
    host.textContent = '';

    for (const driver of state.board.data.drivers) {
      const row = el('div', 'driver-row');

      const color = el('input');
      color.type = 'color';
      color.value = driver.color || '#7186ad';
      color.title = 'Цвет пилота';
      color.addEventListener('input', () => { driver.color = color.value; markDirty(); syncPreview(); });
      row.appendChild(color);

      const name = el('input');
      name.type = 'text';
      name.value = driver.name;
      name.placeholder = 'Имя пилота';
      name.addEventListener('input', () => { driver.name = name.value; markDirty(); refreshDriverOptions(); syncPreview(); });
      row.appendChild(name);

      const del = el('button', 'btn btn-icon btn-danger', '✕');
      del.title = 'Убрать пилота';
      del.addEventListener('click', () => {
        state.board.data.drivers = state.board.data.drivers.filter(d => d !== driver);
        for (const stint of state.board.data.stints) {
          if (stint.driverId === driver.driverId) stint.driverId = '';
        }
        markDirty();
        renderDrivers();
        renderStints();
        syncPreview();
      });
      row.appendChild(del);

      host.appendChild(row);
    }

    if (!state.board.data.drivers.length) {
      host.appendChild(el('p', 'empty', 'Добавьте пилотов — их можно будет выбрать в строках стинтов.'));
    }
  }

  const PALETTE = ['#ff0066', '#3fd8e0', '#8b7dff', '#ffb02e', '#35e08d', '#ff5f96'];

  function addDriver() {
    const drivers = state.board.data.drivers;
    drivers.push({ driverId: newId(), name: '', color: PALETTE[drivers.length % PALETTE.length] });
    markDirty();
    renderDrivers();
    const inputs = $$('#drivers input[type="text"]');
    if (inputs.length) inputs[inputs.length - 1].focus();
  }

  function renderStints() {
    const body = $('#stints-body');
    body.textContent = '';

    state.board.data.stints.forEach((stint, i) => {
      const tr = el('tr');
      tr.appendChild(el('td', 'idx', pad(i + 1)));

      // driver
      const driverCell = el('td', 'w-driver');
      const select = el('select');
      select.dataset.driverSelect = '1';
      fillDriverOptions(select, stint.driverId);
      select.addEventListener('change', () => { stint.driverId = select.value; markDirty(); syncPreview(); });
      driverCell.appendChild(select);
      tr.appendChild(driverCell);

      const locked = autoRecalc();

      // opts: { title, clockFor (offsetSec for the wall-clock hint, or null),
      // readOnly, chainFrom (re-chain from this row index after a change) }
      const timeField = (value, onChange, opts) => {
        const o = opts || {};
        const td = el('td', 'num');
        const input = el('input', 'w-time' + (o.readOnly ? ' is-locked' : ''));
        input.type = 'text';
        input.value = fmtDur(value);
        if (o.title) input.title = o.title;
        if (o.readOnly) {
          input.readOnly = true;
          input.tabIndex = -1;
        } else {
          input.addEventListener('change', () => {
            onChange(parseDur(input.value));
            input.value = fmtDur(parseDur(input.value));
            if (o.chainFrom != null) chainIfAuto(o.chainFrom);
            markDirty();
            renderStints();
            syncPreview();
          });
        }
        td.appendChild(input);
        if (o.clockFor != null) {
          const clock = offsetToClock(o.clockFor);
          if (clock) td.appendChild(el('span', 'ed-clock', clock));
        }
        return td;
      };

      tr.appendChild(timeField(stint.startOffsetSec, v => { stint.startOffsetSec = v; }, {
        title: locked ? 'Старт считается автоматически — выключите «Автопересчёт», чтобы задать вручную' : 'Время от старта гонки, ч:мм:сс',
        clockFor: stint.startOffsetSec,
        readOnly: locked,
      }));
      tr.appendChild(timeField(stint.plannedDurationSec, v => { stint.plannedDurationSec = v; }, {
        title: 'Длительность стинта, мм:сс', chainFrom: i + 1,
      }));
      tr.appendChild(timeField(stint.startOffsetSec + stint.plannedDurationSec, v => {
        stint.plannedDurationSec = Math.max(0, v - stint.startOffsetSec);
      }, { title: 'Конец стинта = старт + длительность, ч:мм:сс', clockFor: stint.startOffsetSec + stint.plannedDurationSec, chainFrom: i + 1 }));
      tr.appendChild(timeField(stint.pitStopDurationSec, v => { stint.pitStopDurationSec = v; }, {
        title: 'Время на пит-стоп, мм:сс', chainFrom: i + 1,
      }));

      const numField = (value, onChange, step) => {
        const td = el('td', 'num');
        const input = el('input', 'w-n');
        input.type = 'number';
        input.min = '0';
        if (step) input.step = step;
        input.value = value || '';
        input.addEventListener('change', () => { onChange(Number(input.value) || 0); markDirty(); syncPreview(); });
        td.appendChild(input);
        return td;
      };

      tr.appendChild(numField(stint.laps, v => { stint.laps = v; }));
      tr.appendChild(numField(stint.fuelL, v => { stint.fuelL = v; }));

      const textField = (value, placeholder, className, onChange) => {
        const td = el('td');
        const input = el('input', className);
        input.type = 'text';
        input.value = value || '';
        input.placeholder = placeholder;
        input.addEventListener('input', () => { onChange(input.value); markDirty(); });
        input.addEventListener('change', syncPreview);
        td.appendChild(input);
        return td;
      };

      tr.appendChild(textField(stint.tyres, 'Soft x4', 'w-tyres', v => { stint.tyres = v; }));
      tr.appendChild(textField(stint.note, '', 'w-note', v => { stint.note = v; }));

      const acts = el('td');
      const box = el('div', 'acts');
      box.appendChild(rowButton('↑', 'Выше', () => move(i, -1)));
      box.appendChild(rowButton('↓', 'Ниже', () => move(i, 1)));
      box.appendChild(rowButton('⧉', 'Дублировать', () => {
        const copy = clone(stint);
        copy.id = newId();
        state.board.data.stints.splice(i + 1, 0, copy);
        chainIfAuto(i + 1);
        markDirty(); renderStints(); syncPreview();
      }));
      box.appendChild(rowButton('✕', 'Удалить', () => {
        state.board.data.stints.splice(i, 1);
        chainIfAuto(i);
        markDirty(); renderStints(); syncPreview();
      }, 'btn-danger'));
      acts.appendChild(box);
      tr.appendChild(acts);

      body.appendChild(tr);
    });

    if (!state.board.data.stints.length) {
      const tr = el('tr');
      const td = el('td', 'empty', 'Стинтов пока нет — добавьте первый.');
      td.colSpan = 11;
      tr.appendChild(td);
      body.appendChild(tr);
    }

    refreshRecalcFromOptions();
  }

  // The "откуда пересчитывать" dropdown in the custom-recalc panel — one entry
  // per stint, rebuilt whenever the list changes.
  function refreshRecalcFromOptions() {
    const select = $('#rc-from');
    if (!select) return;
    const keep = select.value;
    select.textContent = '';
    state.board.data.stints.forEach((_, i) => {
      const option = el('option', null, i === 0 ? 'С первого стинта' : 'Со стинта ' + pad(i + 1));
      option.value = String(i);
      select.appendChild(option);
    });
    if (keep && Number(keep) < state.board.data.stints.length) select.value = keep;
  }

  function rowButton(glyph, title, onClick, extra) {
    const btn = el('button', 'btn btn-icon' + (extra ? ' ' + extra : ''), glyph);
    btn.title = title;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function move(index, delta) {
    const list = state.board.data.stints;
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    chainIfAuto(Math.min(index, target));
    markDirty();
    renderStints();
    syncPreview();
  }

  function fillDriverOptions(select, selected) {
    select.textContent = '';
    const none = el('option', null, '— не назначен —');
    none.value = '';
    select.appendChild(none);
    for (const driver of state.board.data.drivers) {
      const option = el('option', null, driver.name || 'Без имени');
      option.value = driver.driverId;
      if (driver.driverId === selected) option.selected = true;
      select.appendChild(option);
    }
    select.value = selected || '';
  }

  function refreshDriverOptions() {
    $$('[data-driver-select]').forEach((select, i) => {
      fillDriverOptions(select, state.board.data.stints[i] ? state.board.data.stints[i].driverId : '');
    });
  }

  function addStint() {
    const list = state.board.data.stints;
    const last = list[list.length - 1];
    const start = last ? last.startOffsetSec + last.plannedDurationSec + last.pitStopDurationSec : 0;
    list.push({
      id: newId(),
      driverId: '',
      startOffsetSec: start,
      plannedDurationSec: last ? last.plannedDurationSec : 3600,
      pitStopDurationSec: last ? last.pitStopDurationSec : 60,
      laps: 0,
      fuelL: 0,
      tyres: '',
      status: 'planned',
      note: '',
    });
    chainIfAuto(list.length - 1);
    markDirty();
    renderStints();
    syncPreview();
  }

  // "Пересчитать старты подряд" — chain the whole list from zero.
  function recalcStarts() {
    chainStarts(state.board.data.stints, 0);
    markDirty();
    renderStints();
    syncPreview();
  }

  // "Пересчитать по-своему" — chain from a chosen stint, optionally forcing a
  // common stint length and/or pit and a starting point other than 0:00.
  function applyCustomRecalc() {
    const list = state.board.data.stints;
    if (!list.length) return;

    const fromIdx = Math.min(Math.max(0, Number($('#rc-from').value) || 0), list.length - 1);
    const anchorRaw = $('#rc-anchor').value.trim();
    const durRaw = $('#rc-dur').value.trim();
    const pitRaw = $('#rc-pit').value.trim();
    const fixedDur = durRaw ? parseDur(durRaw) : null;
    const fixedPit = pitRaw ? parseDur(pitRaw) : null;

    let cursor;
    if (anchorRaw) cursor = parseDur(anchorRaw);
    else if (fromIdx === 0) cursor = 0;
    else cursor = list[fromIdx].startOffsetSec;

    for (let i = fromIdx; i < list.length; i++) {
      if (fixedDur != null) list[i].plannedDurationSec = fixedDur;
      if (fixedPit != null) list[i].pitStopDurationSec = fixedPit;
      list[i].startOffsetSec = cursor;
      cursor += list[i].plannedDurationSec + list[i].pitStopDurationSec;
    }

    markDirty();
    renderStints();
    syncPreview();
    setStatus($('#data-status'),
      'Пересчитано ' + (fromIdx === 0 ? 'с первого стинта' : 'со стинта ' + pad(fromIdx + 1)) +
      '. Проверьте план и нажмите «Сохранить».', 'pending');
  }

  /* ---------------------------------------------------- google import -- */

  async function importSheet() {
    const url = $('#import-url').value.trim();
    const status = $('#import-status');
    if (!url) {
      setStatus(status, 'Вставьте ссылку на таблицу', 'err');
      return;
    }
    if (state.board.data.stints.length || state.board.data.drivers.length) {
      if (!confirm('Импорт заменит текущих пилотов и стинты в этой таблице. Продолжить?')) return;
    }

    setStatus(status, 'Импорт…', 'pending');
    $('#import-sheet').disabled = true;
    try {
      const res = await call('/api/sheet-import', { boardId: state.board.id, url });
      state.board.data = res.data;

      // Carry the sheet's own race-start clock so the imported plan lands on the
      // same wall time the sheet shows — without this the offsets are right but
      // every row is off by however far the board's "Старт гонки" sat from the
      // sheet's first stint. Keep the board's date, replace only the time.
      let anchorNote = '';
      if (Number.isFinite(res.raceStartClock)) {
        const base = state.board.meta.raceStartIso ? new Date(state.board.meta.raceStartIso) : new Date();
        if (Number.isNaN(base.getTime())) base.setTime(Date.now());
        base.setHours(0, 0, 0, 0);
        const at = new Date(base.getTime() + res.raceStartClock * 1000);
        state.board.meta.raceStartIso = at.toISOString();
        anchorNote = ' Старт гонки взят из таблицы: ' +
          pad(Math.floor(res.raceStartClock / 3600)) + ':' + pad(Math.floor((res.raceStartClock % 3600) / 60)) +
          ' (проверьте дату и часовой пояс).';
      }

      markDirty();
      renderData();
      syncPreview();
      const n = res.data.stints.length;
      const warn = res.warnings && res.warnings.length ? ' · ' + res.warnings.join(' ') : '';
      setStatus(status, 'Импортировано стинтов: ' + n + '.' + anchorNote + ' Проверьте таблицу и нажмите «Сохранить».' + warn, n ? 'ok' : 'err');
    } catch (err) {
      setStatus(status, err.message, 'err');
    } finally {
      $('#import-sheet').disabled = false;
    }
  }

  async function saveData() {
    readMeta();
    const status = $('#data-status');
    setStatus(status, 'Сохранение…', 'pending');
    $('#save-data').disabled = true;
    try {
      const res = await call('/api/stints', {
        id: state.board.id,
        rev: state.board.rev,
        title: state.board.title,
        meta: state.board.meta,
        data: state.board.data,
      });
      state.board.rev = res.rev;
      state.board.updatedAt = res.updatedAt;
      state.saved = clone(state.board);
      state.dataDirty = false;
      setStatus(status, 'Сохранено · ' + res.updatedBy, 'ok');
    } catch (err) {
      $('#save-data').disabled = false;
      if (err.status === 409) {
        setStatus(status, 'Таблицу изменил кто-то другой. Нажмите «Перезагрузить», чтобы забрать свежую версию.', 'err');
        $('#reload-board').hidden = false;
        return;
      }
      setStatus(status, err.message, 'err');
    }
  }

  /* ---------------------------------------------------------- tab: вид -- */

  const VIEW_SPEC = [
    { section: 'Шапка', items: [
      { key: 'subtitle', type: 'text', label: 'Подзаголовок', placeholder: 'Команда, класс, дивизион' },
      { key: 'logoUrl', type: 'image', label: 'Логотип', placeholder: 'https://… или загрузите файл' },
      { key: 'showMeta', type: 'bool', label: 'Показывать трассу, машину и старт' },
      { key: 'showSummary', type: 'bool', label: 'Показывать сводку сверху' },
      { key: 'titleAlign', type: 'select', label: 'Выравнивание шапки', options: [['left', 'Слева'], ['center', 'По центру']] },
    ] },
    { section: 'Время', items: [
      { key: 'timeMode', type: 'select', label: 'Формат времени', options: [['both', 'Часы + от старта'], ['local', 'Только часы'], ['race', 'Только от старта']] },
      { key: 'clock24', type: 'bool', label: '24-часовой формат' },
      { key: 'tz', type: 'text', label: 'Часовой пояс', placeholder: 'Europe/Moscow — пусто = как у зрителя' },
    ] },
    { section: 'Оформление', items: [
      { key: 'theme', type: 'select', label: 'Тема', options: [['dark', 'Тёмная'], ['light', 'Светлая'], ['contrast', 'Контрастная'], ['carbon', 'Карбон'], ['paper', 'Пергамент'], ['custom', 'Своя']] },
      { key: 'customBg', type: 'color', label: 'Фон для темы «Своя»' },
      { key: 'customText', type: 'color', label: 'Текст для темы «Своя»' },
      { key: 'density', type: 'select', label: 'Плотность строк', options: [['compact', 'Плотно'], ['normal', 'Обычно'], ['roomy', 'Просторно']] },
      { key: 'fontScale', type: 'range', label: 'Размер шрифта', min: 80, max: 140, step: 5, unit: '%' },
      { key: 'maxWidth', type: 'range', label: 'Ширина', min: 720, max: 1600, step: 20, unit: 'px' },
      { key: 'lang', type: 'select', label: 'Язык страницы', options: [['ru', 'Русский'], ['en', 'English']] },
      { key: 'radius', type: 'select', label: 'Скругление углов', options: [['sharp', 'Острые'], ['soft', 'Обычные'], ['round', 'Круглые']] },
      { key: 'showBreakNumber', type: 'bool', label: 'Крупный номер текущего стинта фоном' },
    ] },
    { section: 'Цвета', items: [
      { key: 'accent', type: 'color', label: 'Акцент (текущий стинт)' },
      { key: 'dataColor', type: 'color', label: 'Данные и «следующий»' },
      { key: 'goodColor', type: 'color', label: 'Готово / пройдено' },
      { key: 'warnColor', type: 'color', label: 'Предупреждение' },
      { key: 'currentGlow', type: 'bool', label: 'Свечение вокруг текущей строки' },
    ] },
    { section: 'Строки', items: [
      { key: 'highlightCurrent', type: 'bool', label: 'Выделять текущий стинт' },
      { key: 'highlightNext', type: 'bool', label: 'Выделять следующий стинт' },
      { key: 'finishedStyle', type: 'select', label: 'Пройденные стинты', options: [['dim', 'Приглушить'], ['normal', 'Как обычные'], ['hide', 'Скрыть']] },
      { key: 'driverColors', type: 'bool', label: 'Цветные метки пилотов' },
      { key: 'groupBy', type: 'select', label: 'Группировка', options: [['none', 'По времени'], ['driver', 'По пилотам']] },
      { key: 'stripedRows', type: 'bool', label: 'Полосатые строки' },
      { key: 'numbersAlign', type: 'select', label: 'Выравнивание чисел', options: [['left', 'Слева'], ['right', 'Справа']] },
      { key: 'tableBorders', type: 'select', label: 'Границы таблицы', options: [['row', 'Только строки'], ['grid', 'Сетка'], ['none', 'Без границ']] },
      { key: 'mobileCards', type: 'bool', label: 'На телефоне — карточки вместо таблицы' },
      { key: 'emptyText', type: 'text', label: 'Текст, если стинтов нет', placeholder: 'Стинты ещё не добавлены' },
    ] },
    { section: 'Прогресс', items: [
      { key: 'showRaceProgress', type: 'bool', label: 'Полоса прогресса гонки' },
      { key: 'showPitState', type: 'bool', label: 'Показывать «В боксах» между стинтами' },
      { key: 'pitWarningSec', type: 'select', label: 'Предупреждать до смены', options: [[0, 'Не предупреждать'], [60, 'За 1 минуту'], [120, 'За 2 минуты'], [180, 'За 3 минуты'], [300, 'За 5 минут'], [600, 'За 10 минут']] },
    ] },
    { section: 'Обновление', items: [
      { key: 'refreshSec', type: 'select', label: 'Автообновление', options: [[0, 'Выключено'], [10, 'Каждые 10 с'], [30, 'Каждые 30 с'], [60, 'Каждую минуту'], [300, 'Каждые 5 минут']] },
      { key: 'showUpdated', type: 'bool', label: 'Показывать время обновления' },
      { key: 'footerNote', type: 'text', label: 'Подпись внизу', placeholder: 'Например: план может меняться по ходу гонки' },
    ] },
  ];

  function renderView() {
    const host = $('#view-controls');
    host.textContent = '';
    const view = state.board.view;

    for (const group of VIEW_SPEC) {
      const section = el('div', 'vsec');
      section.appendChild(el('h3', null, group.section));

      for (const item of group.items) {
        section.appendChild(viewControl(item, view));
      }
      host.appendChild(section);
    }

    const columns = el('div', 'vsec');
    columns.appendChild(el('h3', null, 'Колонки — порядок перетаскиванием'));
    columns.appendChild(columnList(view));
    host.appendChild(columns);

    syncPreview();
  }

  const COLUMN_NAMES = {
    index: 'Номер', driver: 'Пилот', start: 'Старт', duration: 'Длительность', finish: 'Конец',
    laps: 'Круги', fuel: 'Топливо', tyres: 'Шины', pit: 'Пит-стоп', note: 'Заметка',
  };

  function viewControl(item, view) {
    const row = el('div', 'vrow' + (item.type === 'text' || item.type === 'image' ? ' wide' : ''));
    const label = el('label', null, item.label);
    row.appendChild(label);

    const onChange = value => {
      view[item.key] = value;
      markViewDirty();
      syncPreview();
    };

    if (item.type === 'bool') {
      const wrap = el('label', 'check');
      const input = el('input');
      input.type = 'checkbox';
      input.checked = Boolean(view[item.key]);
      input.addEventListener('change', () => onChange(input.checked));
      wrap.appendChild(input);
      row.appendChild(wrap);
      label.addEventListener('click', () => input.click());
      return row;
    }

    if (item.type === 'select') {
      const select = el('select');
      for (const [value, text] of item.options) {
        const option = el('option', null, text);
        option.value = String(value);
        if (String(view[item.key]) === String(value)) option.selected = true;
        select.appendChild(option);
      }
      select.addEventListener('change', () => {
        const raw = select.value;
        onChange(item.options.some(o => typeof o[0] === 'number') ? Number(raw) : raw);
      });
      row.appendChild(select);
      return row;
    }

    if (item.type === 'color') {
      const input = el('input');
      input.type = 'color';
      input.value = view[item.key];
      input.addEventListener('input', () => onChange(input.value));
      row.appendChild(input);
      return row;
    }

    if (item.type === 'range') {
      const box = el('div');
      const input = el('input');
      input.type = 'range';
      input.min = item.min;
      input.max = item.max;
      input.step = item.step;
      input.value = view[item.key];
      const out = el('span', 'val', view[item.key] + item.unit);
      input.addEventListener('input', () => {
        out.textContent = input.value + item.unit;
        onChange(Number(input.value));
      });
      box.appendChild(input);
      row.appendChild(box);
      row.appendChild(out);
      row.style.gridTemplateColumns = '1fr 1fr 54px';
      return row;
    }

    if (item.type === 'image') {
      const box = el('div', 'imgctl');

      const thumb = el('img', 'imgctl-thumb');
      thumb.hidden = !view[item.key];
      thumb.src = view[item.key] || '';
      thumb.alt = '';
      box.appendChild(thumb);

      const input = el('input', 'imgctl-url');
      input.type = 'text';
      input.value = view[item.key] || '';
      if (item.placeholder) input.placeholder = item.placeholder;
      input.addEventListener('input', () => {
        onChange(input.value);
        thumb.src = input.value;
        thumb.hidden = !input.value;
      });
      box.appendChild(input);

      const file = el('input');
      file.type = 'file';
      file.accept = 'image/png,image/jpeg,image/webp,image/gif';
      file.hidden = true;
      file.addEventListener('change', async () => {
        const picked = file.files && file.files[0];
        file.value = '';
        if (!picked) return;
        setStatus($('#view-status'), 'Обрабатываю изображение…', 'pending');
        try {
          const dataUrl = await fileToLogoDataUrl(picked);
          input.value = dataUrl;
          thumb.src = dataUrl;
          thumb.hidden = false;
          onChange(dataUrl);
          setStatus($('#view-status'), 'Изображение готово — не забудьте опубликовать', 'pending');
        } catch (err) {
          setStatus($('#view-status'), err.message, 'err');
        }
      });
      box.appendChild(file);

      const upload = el('button', 'btn btn-sm', 'Загрузить с устройства');
      upload.type = 'button';
      upload.addEventListener('click', () => file.click());
      box.appendChild(upload);

      const clear = el('button', 'btn btn-sm btn-icon', '✕');
      clear.type = 'button';
      clear.title = 'Убрать логотип';
      clear.addEventListener('click', () => {
        input.value = '';
        thumb.src = '';
        thumb.hidden = true;
        onChange('');
      });
      box.appendChild(clear);

      row.appendChild(box);
      return row;
    }

    const input = el('input');
    input.type = 'text';
    input.value = view[item.key] || '';
    if (item.placeholder) input.placeholder = item.placeholder;
    input.addEventListener('input', () => onChange(input.value));
    row.appendChild(input);
    return row;
  }

  // A phone photo can be several MB at a few thousand px — shrink it to a
  // small square before it goes anywhere near the board's JSON document.
  const LOGO_MAX_PX = 160;
  const LOGO_MAX_SOURCE_BYTES = 8 * 1024 * 1024;
  const LOGO_MAX_DATA_URL = 260000; // keep in step with api/_lib/schema.js LOGO_DATA_MAX

  function fileToLogoDataUrl(file) {
    if (!file.type.startsWith('image/')) return Promise.reject(new Error('Файл должен быть изображением'));
    if (file.size > LOGO_MAX_SOURCE_BYTES) return Promise.reject(new Error('Файл слишком большой (максимум 8 МБ)'));

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Не удалось распознать изображение'));
        img.onload = () => {
          const scale = Math.min(1, LOGO_MAX_PX / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/png');
          if (dataUrl.length > LOGO_MAX_DATA_URL) {
            reject(new Error('Логотип слишком сложный даже после сжатия — попробуйте другое изображение'));
            return;
          }
          resolve(dataUrl);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function columnList(view) {
    const host = el('div', 'cols');
    let dragged = null;

    view.columns.forEach(col => {
      const item = el('div', 'col-item');
      item.draggable = true;

      item.appendChild(el('span', 'handle', '⠿'));

      const check = el('input');
      check.type = 'checkbox';
      check.checked = col.visible;
      check.title = 'Показывать колонку';
      check.addEventListener('change', () => { col.visible = check.checked; markViewDirty(); syncPreview(); });
      item.appendChild(check);

      item.appendChild(el('span', 'name', COLUMN_NAMES[col.key] || col.key));

      const label = el('input');
      label.type = 'text';
      label.value = col.label || '';
      label.placeholder = 'своя подпись';
      label.addEventListener('input', () => { col.label = label.value; markViewDirty(); syncPreview(); });
      item.appendChild(label);

      item.addEventListener('dragstart', () => { dragged = col; item.classList.add('dragging'); });
      item.addEventListener('dragend', () => { dragged = null; item.classList.remove('dragging'); });
      item.addEventListener('dragover', event => { event.preventDefault(); item.classList.add('over'); });
      item.addEventListener('dragleave', () => item.classList.remove('over'));
      item.addEventListener('drop', event => {
        event.preventDefault();
        item.classList.remove('over');
        if (!dragged || dragged === col) return;
        const list = view.columns;
        list.splice(list.indexOf(dragged), 1);
        list.splice(list.indexOf(col), 0, dragged);
        markViewDirty();
        renderView();
      });

      host.appendChild(item);
    });

    return host;
  }

  function markViewDirty() {
    state.viewDirty = true;
    $('#save-view').disabled = false;
    setStatus($('#view-status'), 'Изменения видны только в предпросмотре', 'pending');
  }

  function syncPreview() {
    const frame = $('#preview');
    if (!frame || !state.previewReady || !state.board) return;
    frame.contentWindow.postMessage({ type: 'tu-stints-preview', board: clone(state.board) }, location.origin);
  }

  async function saveView() {
    const status = $('#view-status');
    setStatus(status, 'Публикация…', 'pending');
    $('#save-view').disabled = true;
    try {
      const res = await call('/api/stints', { id: state.board.id, rev: state.board.rev, view: state.board.view });
      state.board.rev = res.rev;
      state.saved = clone(state.board);
      state.viewDirty = false;
      setStatus(status, 'Опубликовано — зрители увидят при следующем обновлении', 'ok');
    } catch (err) {
      $('#save-view').disabled = false;
      setStatus(status, err.status === 409 ? 'Таблицу изменили. Перезагрузите её и повторите.' : err.message, 'err');
    }
  }

  function resetView() {
    state.board.view = clone(state.saved.view);
    state.viewDirty = false;
    renderView();
    setStatus($('#view-status'), 'Вернули последнюю опубликованную версию', '');
    $('#save-view').disabled = true;
  }

  /* ------------------------------------------------------- tab: доступ -- */

  async function renderAccess() {
    const host = $('#keys');
    host.textContent = '';
    setStatus($('#access-status'), 'Загрузка…', 'pending');
    try {
      const res = await call('/api/keys', { op: 'list', boardId: state.board.id });
      setStatus($('#access-status'), '', '');
      if (!res.keys.length) {
        host.appendChild(el('p', 'empty', 'Ключей пока нет. Ваш собственный доступ — ключ владельца из переменных окружения Vercel.'));
        return;
      }
      for (const entry of res.keys) host.appendChild(keyRow(entry));
    } catch (err) {
      setStatus($('#access-status'), err.message, 'err');
    }
  }

  function keyRow(entry) {
    const row = el('div', 'key');
    row.appendChild(el('span', 'name', entry.label));
    row.appendChild(el('span', 'role' + (entry.role === 'owner' ? ' is-owner' : ''), entry.role === 'owner' ? 'Полный' : 'Стинты'));
    row.appendChild(el('span', 'grow'));
    row.appendChild(el('span', 'when', entry.lastUsedAt ? 'заходил ' + relTime(entry.lastUsedAt) : 'ещё не заходил'));

    const revoke = el('button', 'btn btn-sm btn-danger', 'Отозвать');
    revoke.addEventListener('click', async () => {
      if (!confirm('Отозвать доступ «' + entry.label + '»? Его ссылка сразу перестанет работать.')) return;
      await call('/api/keys', { op: 'revoke', boardId: state.board.id, hash: entry.hash });
      renderAccess();
    });
    row.appendChild(revoke);
    return row;
  }

  async function issueKey(event) {
    event.preventDefault();
    const label = $('#k-label').value.trim();
    if (!label) return;
    const role = $('#k-role').value;
    setStatus($('#access-status'), 'Выпуск ключа…', 'pending');
    try {
      const res = await call('/api/keys', { op: 'issue', boardId: state.board.id, label, role });
      $('#k-label').value = '';
      const box = $('#issued');
      box.hidden = false;
      $('#issued-name').textContent = label;
      $('#issued-link').value = location.origin + '/stints-admin#k=' + encodeURIComponent(res.key);
      setStatus($('#access-status'), 'Ключ выпущен — ссылка показывается один раз', 'ok');
      renderAccess();
    } catch (err) {
      setStatus($('#access-status'), err.message, 'err');
    }
  }

  /* --------------------------------------------------------------- wire -- */

  function copyFrom(input, button) {
    input.select();
    navigator.clipboard.writeText(input.value).then(() => {
      const was = button.textContent;
      button.textContent = 'Скопировано';
      setTimeout(() => { button.textContent = was; }, 1600);
    }).catch(() => document.execCommand('copy'));
  }

  function wire() {
    $('#gate-form').addEventListener('submit', async event => {
      event.preventDefault();
      const key = $('#gate-key').value.trim();
      if (!key) return;
      try {
        await signIn(key);
        start();
      } catch (err) {
        // 401 is a wrong key; anything else (a missing env var, a store that
        // isn't wired up) is the server explaining itself — pass it through.
        showGate(err.status === 401 ? 'Ключ не подошёл' : err.message);
      }
    });

    $('#logout').addEventListener('click', signOut);
    $('#to-list').addEventListener('click', backToList);

    for (const tab of $$('.tab')) {
      tab.addEventListener('click', () => selectTab(tab.dataset.tab));
    }

    $('#create-form').addEventListener('submit', async event => {
      event.preventDefault();
      const title = $('#c-title').value.trim();
      if (!title) return;
      const status = $('#create-status');
      setStatus(status, 'Создание…', 'pending');
      try {
        const res = await call('/api/boards', {
          op: 'create',
          title,
          meta: { track: $('#c-track').value.trim(), raceStartIso: localInputToIso($('#c-start').value) },
        });
        $('#create-form').reset();
        setStatus(status, '', '');
        await refreshBoards();
        openBoard(res.id);
      } catch (err) {
        setStatus(status, err.message, 'err');
      }
    });

    for (const id of ['f-title', 'f-track', 'f-car', 'f-start', 'f-note']) {
      $('#' + id).addEventListener('input', () => {
        readMeta();
        markDirty();
        // The editor's wall-clock hints hang off the race start.
        if (id === 'f-start') renderStints();
        syncPreview();
      });
    }

    $('#import-sheet').addEventListener('click', importSheet);
    $('#add-driver').addEventListener('click', addDriver);
    $('#add-stint').addEventListener('click', addStint);
    $('#recalc').addEventListener('click', () => {
      if (confirm('Пересчитать старты подряд: каждый стинт начинается там, где закончился предыдущий, плюс пит-стоп?')) recalcStarts();
    });
    $('#recalc-custom-toggle').addEventListener('click', () => {
      const panel = $('#recalc-custom');
      panel.hidden = !panel.hidden;
    });
    $('#rc-apply').addEventListener('click', applyCustomRecalc);
    $('#auto-recalc').addEventListener('change', event => {
      const on = event.target.checked;
      setAutoRecalc(on);
      if (on && state.board) {
        chainStarts(state.board.data.stints, 0);
        markDirty();
        syncPreview();
        setStatus($('#data-status'), 'Автопересчёт включён — старты выстроены подряд. Дальше они будут пересчитываться после каждой правки длительности или пит-стопа.', 'pending');
      } else {
        setStatus($('#data-status'), 'Автопересчёт выключен — старты можно задавать вручную.', '');
      }
      if (state.board) renderStints();
    });
    $('#save-data').addEventListener('click', saveData);
    $('#reload-board').addEventListener('click', async () => {
      $('#reload-board').hidden = true;
      await openBoard(state.board.id);
    });

    $('#save-view').addEventListener('click', saveView);
    $('#reset-view').addEventListener('click', resetView);

    for (const button of $$('[data-device]')) {
      button.addEventListener('click', () => {
        $('#preview-frame').dataset.device = button.dataset.device;
        for (const other of $$('[data-device]')) other.setAttribute('aria-selected', String(other === button));
      });
    }

    $('#key-form').addEventListener('submit', issueKey);
    $('#copy-link').addEventListener('click', () => copyFrom($('#public-link'), $('#copy-link')));
    $('#copy-link-mirror').addEventListener('click', () => copyFrom($('#public-link-mirror'), $('#copy-link-mirror')));
    $('#copy-issued').addEventListener('click', () => copyFrom($('#issued-link'), $('#copy-issued')));

    window.addEventListener('message', event => {
      if (event.origin !== location.origin) return;
      if (!event.data || event.data.type !== 'tu-stints-ready') return;
      state.previewReady = true;
      syncPreview();
    });

    // Opening an invite link while the panel is already open only changes the
    // fragment — the document never reloads, so boot() would never see the key.
    window.addEventListener('hashchange', async () => {
      const key = readKeyFromHash();
      if (!key || key === state.key) return;
      if (dirty() && !confirm('Есть несохранённые изменения. Войти под другим ключом?')) return;
      try {
        await signIn(key);
        state.board = null;
        state.dataDirty = false;
        state.viewDirty = false;
        $('#screen-board').hidden = true;
        $('#screen-list').hidden = false;
        start();
      } catch {
        showGate('Ключ не подошёл');
      }
    });

    window.addEventListener('beforeunload', event => {
      if (!dirty()) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  function start() {
    $('#gate').hidden = true;
    $('#app').hidden = false;
    renderBoards();
  }

  async function boot() {
    wire();

    const invited = readKeyFromHash();
    const stored = localStorage.getItem(STORE_KEY) || '';
    const key = invited || stored;
    if (!key) return showGate('');

    try {
      await signIn(key);
      start();
    } catch (err) {
      if (err.status !== 401) return showGate(err.message);
      showGate(stored && !invited ? 'Сохранённый ключ больше не действует' : 'Ключ не подошёл');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
