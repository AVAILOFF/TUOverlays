/*
  The stint calculator page.

  A spreadsheet surface over TUCalc (js/tu-calc-engine.js): a grid of rows and
  columns, a formula bar, and a side panel where columns, parameters and summary
  formulas are edited. Every column is either typed in by hand or computed by a
  formula, and any single cell can override its column with its own number or
  =formula — the same model as Google Sheets, which is what this replaces.

  It lives on its own page, not inside the stint panel. The two meet in two
  places: "Пилоты из таблицы" pulls driver names in, and "Применить к стинтам"
  writes the calculated plan back into the board through the ordinary
  /api/stints endpoint.

  The key is the stint panel's key (localStorage) and travels only in an
  Authorization header. The calculator document is saved to /api/calc with the
  revision it was loaded at, so two people editing cannot silently overwrite
  each other.
*/

(function () {
  'use strict';

  const T = window.TUCalc;

  const STORE_KEY = 'tu-stints-key';
  const BOARD_KEY = 'tu-calc-board';

  const FMT_LABEL = { text: 'Текст', num: 'Число', int: 'Целое', time: 'Длительность (ч:мм:сс)', clock: 'Время суток' };
  const KIND_LABEL = { num: 'Число', time: 'Длительность', clock: 'Время суток', text: 'Текст' };
  const RESERVED = ['true', 'false', 'prev', 'next', 'first', 'last'];

  // [key in doc.map, label, required]
  const MAP_FIELDS = [
    ['driver', 'Пилот', false],
    ['start', 'Старт (время суток)', true],
    ['duration', 'Длительность стинта', true],
    ['pit', 'Пит-стоп', false],
    ['laps', 'Круги', false],
    ['fuel', 'Топливо, л', false],
    ['note', 'Заметка', false],
  ];

  const state = {
    key: '',
    role: '',
    boards: [],
    boardId: '',
    board: null,        // the public copy of the board: title, drivers, stints, rev
    doc: null,          // the calculator document being edited
    rev: 0,             // revision of the saved calculator (0 = never saved)
    saved: '',          // JSON of the last saved doc
    res: null,          // TUCalc.evaluate(doc)
    sel: { ci: 0, ri: 0 },
    tab: 'col',
    editing: null,      // { ci, ri, text, initial }
    formulaField: null, // the last formula input focused — chips insert there
    undo: [],
    lastSnap: '',
    lastKey: '',
    lastAt: 0,
  };

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const clone = v => JSON.parse(JSON.stringify(v));

  const cols = () => state.doc.columns;
  const rowsOf = () => state.doc.rows;

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

  async function fetchBoard(id) {
    const res = await fetch('/api/stints?id=' + encodeURIComponent(id), { cache: 'no-store' });
    if (!res.ok) throw new Error('Не удалось загрузить таблицу стинтов');
    return res.json();
  }

  function newId() {
    const bytes = new Uint8Array(9);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /* --------------------------------------------------------------- gate -- */

  function readKeyFromHash() {
    const match = /[#&]k=([^&]+)/.exec(location.hash || '');
    if (!match) return '';
    const key = decodeURIComponent(match[1]);
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
    if (isDirty() && !confirm('Есть несохранённые изменения. Выйти и потерять их?')) return;
    localStorage.removeItem(STORE_KEY);
    state.key = '';
    state.doc = null;
    showGate('');
    $('#gate-key').value = '';
  }

  /* ----------------------------------------------------------- document -- */

  function ensureDoc(doc) {
    doc.params = Array.isArray(doc.params) ? doc.params : [];
    doc.columns = Array.isArray(doc.columns) ? doc.columns : [];
    doc.rows = Array.isArray(doc.rows) ? doc.rows : [];
    doc.summary = Array.isArray(doc.summary) ? doc.summary : [];
    doc.map = doc.map && typeof doc.map === 'object' ? doc.map : {};
    if (!doc.rows.length) doc.rows.push({});
    return doc;
  }

  const serialize = () => JSON.stringify(state.doc);
  const isDirty = () => Boolean(state.doc) && serialize() !== state.saved;

  function recompute() {
    state.res = T.evaluate(state.doc);
  }

  function takeSnapshot(coalesce) {
    const now = Date.now();
    const cur = serialize();
    if (cur === state.lastSnap) return;
    const merge = coalesce && coalesce === state.lastKey && now - state.lastAt < 1500;
    if (!merge) {
      state.undo.push(state.lastSnap);
      if (state.undo.length > 60) state.undo.shift();
    }
    state.lastSnap = cur;
    state.lastKey = coalesce || '';
    state.lastAt = now;
  }

  function undo() {
    const prev = state.undo.pop();
    if (!prev) return;
    state.doc = ensureDoc(JSON.parse(prev));
    state.lastSnap = prev;
    state.lastKey = '';
    clampSel();
    recompute();
    renderAll();
  }

  /* -------------------------------------------------------------- render -- */

  const isNumericCol = c => c.fmt !== 'text';

  function cellRaw(ci, ri) {
    const c = cols()[ci];
    return rowsOf()[ri] ? rowsOf()[ri][c.id] : undefined;
  }

  // What the edit box / formula bar shows: the cell's own content, or — for a
  // formula column with nothing of its own — the column's formula.
  function cellEditText(ci, ri) {
    const c = cols()[ci];
    const raw = cellRaw(ci, ri);
    if (raw !== undefined) return T.editText(raw, c.fmt);
    if (c.type === 'formula' && c.formula) return '= ' + c.formula;
    return '';
  }

  function renderGrid() {
    const { doc, res } = state;
    const head = ['<thead><tr><th class="rn"></th>'];
    doc.columns.forEach((c, ci) => {
      const cls = (ci === state.sel.ci ? 'is-sel' : '') + (res.colErrors[ci] ? ' has-err' : '');
      head.push(`<th data-ci="${ci}" class="${cls}" title="${esc(c.label)}"><span class="th-l">${esc(c.label)}</span><span class="th-id">${esc(c.id)}${c.type === 'formula' ? ' · ƒ' : ''}</span></th>`);
    });
    head.push('</tr></thead>');

    const body = ['<tbody>'];
    doc.rows.forEach((row, ri) => {
      body.push(`<tr data-ri="${ri}"${ri === state.sel.ri ? ' class="is-sel-row"' : ''}><td class="rn" data-ri="${ri}">${ri + 1}</td>`);
      doc.columns.forEach((c, ci) => {
        const isSel = ci === state.sel.ci && ri === state.sel.ri;
        const ed = state.editing;
        if (ed && ed.ci === ci && ed.ri === ri) {
          body.push(`<td class="is-editing is-sel" data-ci="${ci}" data-ri="${ri}"><input type="text" value="${esc(ed.text)}" spellcheck="false" autocomplete="off"></td>`);
          return;
        }
        const cell = res.cells[ri][ci];
        const overrides = c.type === 'formula' && row[c.id] !== undefined;
        const cls = [
          isNumericCol(c) ? 'r' : '',
          c.type === 'input' ? 'is-in' : '',
          overrides ? 'is-ovr' : '',
          cell.e ? 'is-err' : '',
          isSel ? 'is-sel' : '',
        ].filter(Boolean).join(' ');
        const text = cell.e ? cell.e : T.format(cell.v, c);
        const title = cell.e ? cell.msg : '';
        body.push(`<td class="${cls}" data-ci="${ci}" data-ri="${ri}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</td>`);
      });
      body.push('</tr>');
    });
    body.push('</tbody>');
    $('#grid').innerHTML = head.join('') + body.join('');
  }

  const cellEl = (ci, ri) => $(`#grid td[data-ci="${ci}"][data-ri="${ri}"]`);

  // Selection moves without rebuilding the table, so a double-click's second
  // half still lands on the element its first half did.
  function paintSel() {
    $$('#grid .is-sel').forEach(n => { if (!n.classList.contains('is-editing')) n.classList.remove('is-sel'); });
    $$('#grid tr.is-sel-row').forEach(n => n.classList.remove('is-sel-row'));
    const td = cellEl(state.sel.ci, state.sel.ri);
    if (td) td.classList.add('is-sel');
    const th = $(`#grid th[data-ci="${state.sel.ci}"]`);
    if (th) th.classList.add('is-sel');
    const tr = $(`#grid tr[data-ri="${state.sel.ri}"]`);
    if (tr) tr.classList.add('is-sel-row');
  }

  function renderFormulaBar() {
    const { ci, ri } = state.sel;
    const c = cols()[ci];
    const input = $('#cell-input');
    if (!c || !rowsOf()[ri]) {
      $('#cell-name').textContent = '—';
      input.value = '';
      $('#cell-val').textContent = '';
      return;
    }
    $('#cell-name').textContent = `${c.id}[${ri + 1}]`;
    if (document.activeElement !== input) input.value = cellEditText(ci, ri);
    const cell = state.res.cells[ri][ci];
    const val = $('#cell-val');
    val.classList.toggle('is-err', Boolean(cell.e));
    val.textContent = cell.e ? `${cell.e}: ${cell.msg}` : cell.v === null ? '' : '= ' + T.format(cell.v, c);
    val.title = val.textContent;
  }

  function renderTotals() {
    const host = $('#totals');
    host.innerHTML = state.doc.summary.map((s, i) => {
      const r = state.res.summary[i];
      const value = r.e ? r.e : T.format(r.v, s) || '—';
      return `<div class="total"><span class="k">${esc(s.label || s.id)}</span><span class="v${r.e ? ' is-err' : ''}" title="${esc(r.msg || '')}">${esc(value)}</span></div>`;
    }).join('');
  }

  function renderIssues() {
    const host = $('#issues');
    const lines = state.res.issues.slice();
    state.res.colErrors.forEach((msg, ci) => { if (msg) lines.push(`Формула столбца «${cols()[ci].label}»: ${msg}`); });
    host.hidden = !lines.length;
    host.innerHTML = lines.map(l => `<p>${esc(l)}</p>`).join('');
  }

  function renderTop() {
    const dirty = isDirty();
    $('#save').disabled = !dirty && state.rev > 0;
    const status = $('#save-status');
    if (dirty) {
      status.textContent = state.rev ? 'Есть несохранённые изменения' : 'Не сохранено';
      status.className = 'status pending';
    } else {
      status.textContent = 'Сохранено · версия ' + state.rev;
      status.className = 'status ok';
    }
  }

  function flash(message, kind) {
    const status = $('#save-status');
    status.textContent = message;
    status.className = 'status ' + (kind || '');
  }

  function renderAll() {
    renderTop();
    renderIssues();
    renderTotals();
    renderGrid();
    renderFormulaBar();
    renderSide();
  }

  // After an edit that leaves the structure alone: everything but the side
  // panel's form fields, which would lose focus if rebuilt under the cursor.
  function refreshLive() {
    recompute();
    renderTop();
    renderIssues();
    renderTotals();
    renderGrid();
    renderFormulaBar();
    updateSideLive();
  }

  function commit(coalesce) {
    takeSnapshot(coalesce);
    refreshLive();
  }

  function commitStructural() {
    takeSnapshot('');
    recompute();
    renderAll();
  }

  /* ---------------------------------------------------------- selection -- */

  function clampSel() {
    state.sel.ci = Math.min(Math.max(0, state.sel.ci), Math.max(0, cols().length - 1));
    state.sel.ri = Math.min(Math.max(0, state.sel.ri), Math.max(0, rowsOf().length - 1));
  }

  function setSel(ci, ri, opts) {
    const before = state.sel.ci;
    state.sel.ci = ci;
    state.sel.ri = ri;
    clampSel();
    paintSel();
    renderFormulaBar();
    if (state.sel.ci !== before && state.tab === 'col') renderSide();
    if (opts && opts.scroll) {
      const td = cellEl(state.sel.ci, state.sel.ri);
      if (td) td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  const moveSel = (dc, dr) => setSel(state.sel.ci + dc, state.sel.ri + dr, { scroll: true });

  /* ------------------------------------------------------------ editing -- */

  function setCellFromText(ci, ri, text) {
    const c = cols()[ci];
    if (text === cellEditText(ci, ri)) return true;
    const parsed = T.parseInput(text, c.fmt);
    if (!parsed.ok) {
      flash(parsed.error, 'err');
      return false;
    }
    const row = rowsOf()[ri];
    if (parsed.value === undefined) delete row[c.id];
    else row[c.id] = parsed.value;
    return true;
  }

  function startEdit(initial) {
    const { ci, ri } = state.sel;
    if (!cols()[ci] || !rowsOf()[ri]) return;
    const base = cellEditText(ci, ri);
    state.editing = { ci, ri, initial: base, text: initial !== undefined ? initial : base };
    renderGrid();
    const input = $('#grid td.is-editing input');
    if (!input) return;
    input.focus();
    if (initial === undefined) input.select();
    else input.setSelectionRange(input.value.length, input.value.length);
  }

  function finishEdit(text) {
    const e = state.editing;
    if (!e) return true;
    state.editing = null;
    if (!setCellFromText(e.ci, e.ri, text)) {
      state.editing = { ...e, text };
      renderGrid();
      const input = $('#grid td.is-editing input');
      if (input) { input.focus(); input.select(); }
      return false;
    }
    commit();
    return true;
  }

  function cancelEdit() {
    state.editing = null;
    renderGrid();
    $('#gridwrap').focus({ preventScroll: true });
  }

  function clearCell() {
    const { ci, ri } = state.sel;
    const c = cols()[ci];
    if (!c || rowsOf()[ri][c.id] === undefined) return;
    delete rowsOf()[ri][c.id];
    commit();
  }

  function onGridKey(ev) {
    if (state.editing) {
      const input = $('#grid td.is-editing input');
      if (ev.key === 'Enter') {
        ev.preventDefault();
        if (finishEdit(input ? input.value : '')) { moveSel(0, 1); $('#gridwrap').focus({ preventScroll: true }); }
      } else if (ev.key === 'Tab') {
        ev.preventDefault();
        if (finishEdit(input ? input.value : '')) { moveSel(ev.shiftKey ? -1 : 1, 0); $('#gridwrap').focus({ preventScroll: true }); }
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        cancelEdit();
      }
      return;
    }

    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;

    switch (ev.key) {
      case 'ArrowUp': ev.preventDefault(); moveSel(0, -1); break;
      case 'ArrowDown': ev.preventDefault(); moveSel(0, 1); break;
      case 'ArrowLeft': ev.preventDefault(); moveSel(-1, 0); break;
      case 'ArrowRight': ev.preventDefault(); moveSel(1, 0); break;
      case 'Tab': ev.preventDefault(); moveSel(ev.shiftKey ? -1 : 1, 0); break;
      case 'Home': ev.preventDefault(); setSel(0, state.sel.ri, { scroll: true }); break;
      case 'End': ev.preventDefault(); setSel(cols().length - 1, state.sel.ri, { scroll: true }); break;
      case 'Enter':
      case 'F2': ev.preventDefault(); startEdit(); break;
      case 'Delete':
      case 'Backspace': ev.preventDefault(); clearCell(); break;
      default:
        if (ev.key.length === 1) { ev.preventDefault(); startEdit(ev.key); }
    }
  }

  function onGridMouseDown(ev) {
    if (ev.target.closest('td.is-editing')) return;
    if (state.editing) {
      const input = $('#grid td.is-editing input');
      if (!finishEdit(input ? input.value : '')) return;
    }
    const th = ev.target.closest('th[data-ci]');
    if (th) {
      state.tab = 'col';
      setSel(Number(th.dataset.ci), state.sel.ri);
      renderSide();
      return;
    }
    const rn = ev.target.closest('td.rn');
    if (rn) { setSel(state.sel.ci, Number(rn.dataset.ri)); return; }
    const td = ev.target.closest('td[data-ci]');
    if (td) setSel(Number(td.dataset.ci), Number(td.dataset.ri));
  }

  /* ---------------------------------------------------------- structure -- */

  const usedNames = () => new Set([...cols().map(c => c.id), ...state.doc.params.map(p => p.id)].map(s => s.toLowerCase()));

  function uniqueId(base) {
    const used = usedNames();
    let n = 1;
    while (used.has((base + n).toLowerCase())) n++;
    return base + n;
  }

  // A new row starts with the same hand-typed inputs as the last one
  // (consumption, lap time …) so a longer race does not mean retyping them.
  function newRow() {
    const last = rowsOf()[rowsOf().length - 1] || {};
    const row = {};
    for (const c of cols()) {
      const v = last[c.id];
      if (c.type === 'input' && v !== undefined && !(typeof v === 'string' && v.trim().startsWith('='))) row[c.id] = v;
    }
    return row;
  }

  function addRow() {
    if (rowsOf().length >= T.MAX_ROWS) return flash('Предел — ' + T.MAX_ROWS + ' строк', 'err');
    rowsOf().push(newRow());
    state.sel.ri = rowsOf().length - 1;
    commitStructural();
    setSel(state.sel.ci, state.sel.ri, { scroll: true });
  }

  function insertRow() {
    if (rowsOf().length >= T.MAX_ROWS) return flash('Предел — ' + T.MAX_ROWS + ' строк', 'err');
    rowsOf().splice(state.sel.ri + 1, 0, newRow());
    state.sel.ri += 1;
    commitStructural();
    setSel(state.sel.ci, state.sel.ri, { scroll: true });
  }

  function deleteRow() {
    if (rowsOf().length <= 1) return flash('Нужна хотя бы одна строка', 'err');
    if (!confirm(`Удалить строку ${state.sel.ri + 1}?`)) return;
    rowsOf().splice(state.sel.ri, 1);
    clampSel();
    commitStructural();
  }

  function addColumn() {
    if (cols().length >= 40) return flash('Предел — 40 столбцов', 'err');
    cols().push({ id: uniqueId('col'), label: 'Новый столбец', type: 'formula', fmt: 'num', dec: 2, formula: '' });
    state.sel.ci = cols().length - 1;
    state.tab = 'col';
    commitStructural();
    setSel(state.sel.ci, state.sel.ri, { scroll: true });
  }

  function resetDoc() {
    if (!confirm('Заменить все параметры, столбцы, формулы и строки шаблоном команды (как в Google-таблице)? Это можно отменить через Ctrl+Z, пока страница открыта.')) return;
    state.doc = ensureDoc(T.defaultDoc());
    state.sel = { ci: 0, ri: 0 };
    commitStructural();
  }

  /* -------------------------------------------------------------- panels -- */

  function selectOptions(map, current) {
    return Object.entries(map).map(([k, label]) => `<option value="${k}"${k === current ? ' selected' : ''}>${esc(label)}</option>`).join('');
  }

  function chipsHtml() {
    const colChips = cols().map(c => `<button type="button" class="chip" data-ins="${esc(c.id)}" data-col="${esc(c.id)}" title="Клик — имя столбца, Shift+клик — prev.${esc(c.id)}">${esc(c.id)}</button>`).join('');
    const parChips = state.doc.params.map(p => `<button type="button" class="chip" data-ins="${esc(p.id)}" title="${esc(p.label)}">${esc(p.id)}</button>`).join('');
    const fnNames = ['IF', 'MIN', 'MAX', 'SUM', 'ROUNDDOWN', 'TRUNC', 'IFERROR', 'SUMIF', 'ROW', 'TIME'];
    const fnChips = fnNames.map(n => `<button type="button" class="chip is-fn" data-ins="${n}(">${n}</button>`).join('');
    return `
      <div class="card">
        <span class="lbl">Вставить в формулу</span>
        <div class="chips" style="margin-bottom:10px">${colChips || '<span class="hint">нет столбцов</span>'}</div>
        <div class="chips" style="margin-bottom:10px">${parChips || '<span class="hint">нет параметров</span>'}</div>
        <div class="chips">${fnChips}</div>
        <p class="hint" style="margin-top:10px">Shift+клик по столбцу вставляет <code>prev.имя</code> — значение из строки выше.</p>
      </div>`;
  }

  function colPanel() {
    const c = cols()[state.sel.ci];
    if (!c) return '<div class="card"><p class="hint">Нет столбцов. Добавьте столбец кнопкой под таблицей.</p></div>';

    const formulaCard = c.type === 'formula'
      ? `<label class="lbl" for="f-formula">Формула столбца</label>
         <textarea class="formula" id="f-formula" data-f="formula" data-formula-target spellcheck="false" placeholder="например: IF(ROW() = 1; 0; prev.total + x)">${esc(c.formula || '')}</textarea>
         <p class="formula-msg" id="formula-msg"></p>
         <p class="hint">Считается для каждой строки, у которой в ячейке нет своего значения. В формуле можно писать имя столбца этой же строки, <code>prev.имя</code> — из строки выше, <code>имя[3]</code> — из строки 3.</p>`
      : `<p class="hint">Значения этого столбца вводятся руками. В любую ячейку можно вписать <code>=формулу</code> — она посчитается только в этой строке.</p>`;

    const overrides = rowsOf().filter(r => r[c.id] !== undefined).length;
    return `
      <div class="card">
        <h3>Столбец «${esc(c.label)}»</h3>
        <div class="duo">
          <div><label class="lbl" for="f-label">Название</label><input type="text" id="f-label" data-f="label" value="${esc(c.label)}"></div>
          <div><label class="lbl" for="f-id">Имя в формулах</label><input type="text" id="f-id" data-f="id" class="mono-in" value="${esc(c.id)}" spellcheck="false"></div>
        </div>
        <div class="trio" style="margin-top:12px">
          <div><label class="lbl" for="f-type">Откуда значения</label>
            <select id="f-type" data-f="type"><option value="input"${c.type === 'input' ? ' selected' : ''}>Вводятся руками</option><option value="formula"${c.type === 'formula' ? ' selected' : ''}>Считаются формулой</option></select></div>
          <div><label class="lbl" for="f-fmt">Вид</label><select id="f-fmt" data-f="fmt">${selectOptions(FMT_LABEL, c.fmt)}</select></div>
          <div><label class="lbl" for="f-dec">Знаков после запятой</label><input type="number" id="f-dec" data-f="dec" min="0" max="6" value="${Number.isInteger(c.dec) ? c.dec : 2}"${c.fmt === 'num' ? '' : ' disabled'}></div>
        </div>
      </div>
      <div class="card">${formulaCard}</div>
      ${chipsHtml()}
      <div class="card">
        <span class="lbl">Действия</span>
        <div class="row" style="margin-bottom:8px">
          <button class="btn btn-sm" data-act="col-left"${state.sel.ci === 0 ? ' disabled' : ''}>← Влево</button>
          <button class="btn btn-sm" data-act="col-right"${state.sel.ci === cols().length - 1 ? ' disabled' : ''}>Вправо →</button>
        </div>
        <div class="row">
          <button class="btn btn-sm" data-act="col-fill">Заполнить весь столбец…</button>
          ${c.type === 'formula' ? `<button class="btn btn-sm" data-act="col-reset"${overrides ? '' : ' disabled'} title="Убрать свои значения ячеек — везде снова формула столбца">Сбросить свои ячейки (${overrides})</button>` : ''}
          <button class="btn btn-sm btn-danger" data-act="col-del">Удалить столбец</button>
        </div>
      </div>`;
  }

  function paramsPanel() {
    const items = state.doc.params.map((p, i) => `
      <div class="item" data-pi="${i}">
        <div class="top-line">
          <input type="text" data-pf="label" value="${esc(p.label)}" aria-label="Название параметра">
          <button class="btn btn-icon btn-danger" data-act="p-del" title="Удалить параметр" aria-label="Удалить параметр">×</button>
        </div>
        <div class="trio">
          <div><label class="lbl">Имя в формулах</label><input type="text" class="mono-in" data-pf="id" value="${esc(p.id)}" spellcheck="false"></div>
          <div><label class="lbl">Вид</label><select data-pf="kind">${selectOptions(KIND_LABEL, p.kind)}</select></div>
          <div><label class="lbl">Значение</label><input type="text" class="mono-in" data-pf="value" data-formula-target value="${esc(T.editText(p.value, p.kind))}" spellcheck="false"></div>
        </div>
        <div class="live" data-plive="${i}"></div>
      </div>`).join('');
    return `
      <div class="card">
        <h3>Параметры</h3>
        <p class="hint" style="margin-bottom:12px">Числа, которые нужны формулам: бак, скорость заправки, длина гонки. В формуле параметр пишется по имени. Значением может быть и <code>=формула</code>.</p>
        <div class="stack">${items || '<p class="hint">Параметров пока нет.</p>'}</div>
        <div class="row" style="margin-top:12px"><button class="btn btn-sm" data-act="p-add">+ Параметр</button></div>
      </div>
      ${chipsHtml()}`;
  }

  function summaryPanel() {
    const items = state.doc.summary.map((s, i) => `
      <div class="item" data-si="${i}">
        <div class="top-line">
          <input type="text" data-sf="label" value="${esc(s.label)}" aria-label="Название итога" placeholder="Название">
          <button class="btn btn-icon btn-danger" data-act="s-del" title="Удалить итог" aria-label="Удалить итог">×</button>
        </div>
        <input type="text" class="mono-in" data-sf="formula" data-formula-target value="${esc(s.formula)}" spellcheck="false" placeholder="например: SUM(laps)" aria-label="Формула итога">
        <div class="duo">
          <select data-sf="fmt" aria-label="Вид">${selectOptions(FMT_LABEL, s.fmt)}</select>
          <input type="number" data-sf="dec" min="0" max="6" value="${Number.isInteger(s.dec) ? s.dec : 2}" aria-label="Знаков после запятой"${s.fmt === 'num' ? '' : ' disabled'}>
        </div>
        <div class="live" data-slive="${i}"></div>
      </div>`).join('');
    return `
      <div class="card">
        <h3>Итоги</h3>
        <p class="hint" style="margin-bottom:12px">Формулы над всей таблицей — показываются плашками над ней. Столбец целиком: <code>SUM(laps)</code>, часть строк: <code>SUM(laps[2:30])</code>, по пилоту: <code>SUMIF(driver; "Иванов"; length)</code>.</p>
        <div class="stack">${items || '<p class="hint">Итогов пока нет.</p>'}</div>
        <div class="row" style="margin-top:12px"><button class="btn btn-sm" data-act="s-add">+ Итог</button></div>
      </div>
      ${chipsHtml()}`;
  }

  function helpPanel() {
    const fns = T.FUNCTION_DOCS.map(f => `<div><code>${esc(f.syntax)}</code><span>${esc(f.text)}</span></div>`).join('');
    return `
      <div class="card help">
        <h3>Как это устроено</h3>
        <p>Калькулятор — это маленькая таблица. Столбец либо заполняется руками, либо считается <b>формулой столбца</b> для каждой строки. Любую ячейку можно переопределить своим числом или <code>=формулой</code> — в углу такой ячейки появится розовая метка.</p>
        <h3>Время</h3>
        <p>Внутри всё считается в секундах: 40:42 — это 2442. Поэтому стинт дольше часа считается верно (в Google-таблице после 59:59 часы терялись). Ввод: <code>55:00</code> — минуты и секунды, <code>1:01:00</code> — часы, минуты, секунды; для «времени суток» <code>10:20</code> — часы и минуты.</p>
        <h3>Ссылки в формулах</h3>
        <ul>
          <li><code>laps</code> — столбец этой же строки, или параметр</li>
          <li><code>prev.finish</code> — столбец в строке выше (ещё <code>next</code>, <code>first</code>, <code>last</code>)</li>
          <li><code>laps[3]</code> — столбец в строке 3</li>
          <li><code>SUM(laps)</code> — имя столбца внутри SUM/AVG/COUNT/MIN/MAX — весь столбец; <code>SUM(laps[2:30])</code> — строки 2–30</li>
        </ul>
        <p>Операторы: <code>+ − * / ^ %</code>, сравнения <code>= &lt;&gt; &lt; &gt; &lt;= &gt;=</code>, склейка текста <code>&amp;</code>. Аргументы функций разделяются <code>;</code> или <code>,</code>. В первой строке у <code>prev</code> ничего нет — используйте <code>IF(ROW() = 1; …; …)</code>: невыбранная ветка не считается.</p>
        <h3>Ошибки</h3>
        <p><code>#NAME</code> — неизвестное имя, <code>#PARSE</code> — формула не разобрана, <code>#DIV/0</code> — деление на ноль, <code>#CYCLE</code> — ячейки ссылаются друг на друга по кругу, <code>#REF</code> — нет такой строки. Ошибку можно перехватить: <code>IFERROR(выражение; 0)</code>.</p>
        <h3>Функции</h3>
        <div class="fn-list">${fns}</div>
      </div>`;
  }

  function renderSide() {
    $$('.calc-side .tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === state.tab)));
    const panels = { col: colPanel, params: paramsPanel, summary: summaryPanel, help: helpPanel };
    $('#side-body').innerHTML = (panels[state.tab] || colPanel)();
    updateSideLive();
  }

  function updateSideLive() {
    const { res } = state;
    if (state.tab === 'col') {
      const msg = $('#formula-msg');
      if (msg) {
        const c = cols()[state.sel.ci];
        const err = res.colErrors[state.sel.ci];
        msg.classList.toggle('is-err', Boolean(err));
        msg.textContent = err ? err : c && c.formula && c.formula.trim() ? '✓ формула разобрана' : '';
      }
    } else if (state.tab === 'params') {
      res.params.forEach((r, i) => {
        const node = $(`[data-plive="${i}"]`);
        if (!node) return;
        const p = state.doc.params[i];
        const isFormula = typeof p.value === 'string' && p.value.trim().startsWith('=');
        node.classList.toggle('is-err', Boolean(r.e));
        node.textContent = r.e ? `${r.e}: ${r.msg}` : isFormula ? '= ' + (T.format(r.v, { fmt: p.kind === 'text' ? 'text' : p.kind }) || '—') : '';
      });
    } else if (state.tab === 'summary') {
      res.summary.forEach((r, i) => {
        const node = $(`[data-slive="${i}"]`);
        if (!node) return;
        const s = state.doc.summary[i];
        node.classList.toggle('is-err', Boolean(r.e));
        node.textContent = r.e ? `${r.e}: ${r.msg}` : '= ' + (T.format(r.v, s) || '—');
      });
    }
  }

  /* -------------------------------------------------------- side events -- */

  function idProblem(next, ignore) {
    if (!T.ID_RE.test(next)) return 'Имя: буквы, цифры и _, не с цифры';
    const low = next.toLowerCase();
    if (RESERVED.includes(low)) return `«${next}» зарезервировано`;
    const clash = [...cols().map(c => c.id), ...state.doc.params.map(p => p.id)].some(id => id.toLowerCase() === low && id !== ignore);
    return clash ? `Имя «${next}» уже занято` : '';
  }

  function onColField(target) {
    const c = cols()[state.sel.ci];
    if (!c) return;
    const f = target.dataset.f;

    if (f === 'label') { c.label = target.value; commit('label'); return; }
    if (f === 'formula') { c.formula = target.value; commit('formula' + state.sel.ci); return; }
  }

  function onColChange(target) {
    const c = cols()[state.sel.ci];
    if (!c) return;
    const f = target.dataset.f;

    if (f === 'id') {
      const next = target.value.trim();
      if (next === c.id) return;
      const problem = idProblem(next, c.id);
      if (problem) { flash(problem, 'err'); target.value = c.id; return; }
      T.renameIdentifier(state.doc, c.id, next);
      c.id = next;
      commitStructural();
      return;
    }
    if (f === 'type') { c.type = target.value; commitStructural(); return; }
    if (f === 'fmt') { c.fmt = target.value; commitStructural(); return; }
    if (f === 'dec') {
      const n = Math.round(Number(target.value));
      c.dec = Number.isFinite(n) ? Math.min(6, Math.max(0, n)) : 2;
      commit();
    }
  }

  function moveColumn(dir) {
    const i = state.sel.ci;
    const j = i + dir;
    if (j < 0 || j >= cols().length) return;
    [cols()[i], cols()[j]] = [cols()[j], cols()[i]];
    state.sel.ci = j;
    commitStructural();
  }

  function fillColumn() {
    const c = cols()[state.sel.ci];
    const text = prompt(`Значение для всех строк столбца «${c.label}» — число, текст или =формула. Пустое поле очистит столбец.`, '');
    if (text === null) return;
    const parsed = T.parseInput(text, c.fmt);
    if (!parsed.ok) return flash(parsed.error, 'err');
    for (const row of rowsOf()) {
      if (parsed.value === undefined) delete row[c.id];
      else row[c.id] = parsed.value;
    }
    commit();
  }

  function resetOverrides() {
    const c = cols()[state.sel.ci];
    if (!confirm(`Убрать свои значения ячеек в столбце «${c.label}»? Везде снова будет формула столбца.`)) return;
    for (const row of rowsOf()) delete row[c.id];
    commitStructural();
  }

  function deleteColumn() {
    const c = cols()[state.sel.ci];
    if (!confirm(`Удалить столбец «${c.label}» вместе с введёнными в нём значениями? Формулы, которые на него ссылаются, покажут #NAME.`)) return;
    for (const row of rowsOf()) delete row[c.id];
    for (const k of Object.keys(state.doc.map)) if (state.doc.map[k] === c.id) delete state.doc.map[k];
    cols().splice(state.sel.ci, 1);
    clampSel();
    commitStructural();
  }

  function onParamField(target, isChange) {
    const item = target.closest('[data-pi]');
    if (!item) return;
    const p = state.doc.params[Number(item.dataset.pi)];
    const f = target.dataset.pf;

    if (f === 'label') { p.label = target.value; commit('plabel'); return; }
    if (!isChange) return;

    if (f === 'id') {
      const next = target.value.trim();
      if (next === p.id) return;
      const problem = idProblem(next, p.id);
      if (problem) { flash(problem, 'err'); target.value = p.id; return; }
      T.renameIdentifier(state.doc, p.id, next);
      p.id = next;
      commitStructural();
    } else if (f === 'kind') {
      p.kind = target.value;
      commitStructural();
    } else if (f === 'value') {
      const parsed = T.parseInput(target.value, p.kind);
      if (!parsed.ok) { flash(parsed.error, 'err'); target.value = T.editText(p.value, p.kind); return; }
      if (parsed.value === undefined) delete p.value;
      else p.value = parsed.value;
      commit();
    }
  }

  function onSummaryField(target, isChange) {
    const item = target.closest('[data-si]');
    if (!item) return;
    const s = state.doc.summary[Number(item.dataset.si)];
    const f = target.dataset.sf;

    if (f === 'label') { s.label = target.value; commit('slabel'); return; }
    if (f === 'formula') { s.formula = target.value; commit('sformula'); return; }
    if (!isChange) return;
    if (f === 'fmt') { s.fmt = target.value; commitStructural(); return; }
    if (f === 'dec') {
      const n = Math.round(Number(target.value));
      s.dec = Number.isFinite(n) ? Math.min(6, Math.max(0, n)) : 2;
      commit();
    }
  }

  function insertIntoActive(text) {
    let field = state.formulaField;
    if (!field || !document.body.contains(field)) field = $('#f-formula') || $('[data-formula-target]') || $('#cell-input');
    if (!field) return;
    const start = field.selectionStart == null ? field.value.length : field.selectionStart;
    const end = field.selectionEnd == null ? start : field.selectionEnd;
    field.value = field.value.slice(0, start) + text + field.value.slice(end);
    const at = start + text.length;
    field.focus();
    field.setSelectionRange(at, at);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function onSideClick(ev) {
    const chip = ev.target.closest('.chip');
    if (chip) {
      let text = chip.dataset.ins;
      if (ev.shiftKey && chip.dataset.col) text = 'prev.' + chip.dataset.col;
      insertIntoActive(text);
      return;
    }
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    switch (btn.dataset.act) {
      case 'col-left': moveColumn(-1); break;
      case 'col-right': moveColumn(1); break;
      case 'col-fill': fillColumn(); break;
      case 'col-reset': resetOverrides(); break;
      case 'col-del': deleteColumn(); break;
      case 'p-add': {
        if (state.doc.params.length >= 40) return flash('Предел — 40 параметров', 'err');
        state.doc.params.push({ id: uniqueId('p'), label: 'Новый параметр', kind: 'num', value: 0 });
        commitStructural();
        break;
      }
      case 'p-del': {
        const i = Number(btn.closest('[data-pi]').dataset.pi);
        if (!confirm(`Удалить параметр «${state.doc.params[i].label}»? Формулы, которые на него ссылаются, покажут #NAME.`)) return;
        state.doc.params.splice(i, 1);
        commitStructural();
        break;
      }
      case 's-add': {
        if (state.doc.summary.length >= 30) return flash('Предел — 30 итогов', 'err');
        state.doc.summary.push({ id: 's' + Date.now().toString(36), label: 'Новый итог', formula: '', fmt: 'num', dec: 2 });
        commitStructural();
        break;
      }
      case 's-del': {
        state.doc.summary.splice(Number(btn.closest('[data-si]').dataset.si), 1);
        commitStructural();
        break;
      }
      default:
    }
  }

  function onSideInput(ev, isChange) {
    const t = ev.target;
    if (t.dataset.f) return isChange ? onColChange(t) : onColField(t);
    if (t.dataset.pf) return onParamField(t, isChange);
    if (t.dataset.sf) return onSummaryField(t, isChange);
  }

  /* --------------------------------------------------------------- save -- */

  async function save() {
    if (!state.doc) return;
    // Land a half-typed cell before serialising.
    if (state.editing) {
      const input = $('#grid td.is-editing input');
      if (!finishEdit(input ? input.value : '')) return;
    }
    flash('Сохраняю…', 'pending');
    $('#save').disabled = true;
    try {
      const snapshot = serialize();
      const res = await call('/api/calc', { op: 'save', id: state.boardId, calc: state.doc, rev: state.rev });
      state.rev = res.rev;
      state.saved = snapshot;
      $('#reload').hidden = true;
      renderTop();
    } catch (err) {
      $('#save').disabled = false;
      if (err.status === 409) {
        flash(err.message, 'err');
        $('#reload').hidden = false;
      } else {
        flash(err.message, 'err');
      }
    }
  }

  /* ------------------------------------------------------------- boards -- */

  function fillBoardSelect() {
    const select = $('#board-select');
    select.innerHTML = state.boards.map(b => `<option value="${esc(b.id)}"${b.id === state.boardId ? ' selected' : ''}>${esc(b.title)}</option>`).join('');
  }

  async function openBoard(id) {
    const [board, calcRes] = await Promise.all([fetchBoard(id), call('/api/calc', { op: 'get', id })]);
    state.boardId = id;
    state.board = board;
    try { localStorage.setItem(BOARD_KEY, id); } catch { /* private mode */ }

    if (calcRes.calc) {
      const { rev, updatedAt, updatedBy, ...doc } = calcRes.calc;
      state.doc = ensureDoc(doc);
      state.rev = Number(rev) || 1;
      state.saved = serialize();
    } else {
      state.doc = ensureDoc(T.defaultDoc());
      state.rev = 0;
      state.saved = '';
    }

    state.sel = { ci: 0, ri: 0 };
    state.tab = 'col';
    state.editing = null;
    state.undo = [];
    state.lastSnap = serialize();
    state.lastKey = '';
    $('#reload').hidden = true;
    $('#back').href = '/stints-admin?b=' + encodeURIComponent(id);
    history.replaceState(null, '', location.pathname + '?b=' + encodeURIComponent(id));
    fillBoardSelect();
    recompute();
    renderAll();
  }

  async function onBoardChange(id) {
    if (isDirty() && !confirm('Есть несохранённые изменения. Открыть другую таблицу и потерять их?')) {
      fillBoardSelect();
      return;
    }
    try { await openBoard(id); } catch (err) { flash(err.message, 'err'); fillBoardSelect(); }
  }

  async function importDrivers() {
    let board;
    try { board = await fetchBoard(state.boardId); } catch (err) { return flash(err.message, 'err'); }
    const stints = board.data && board.data.stints ? board.data.stints : [];
    if (!stints.length) return flash('В таблице стинтов пока нет стинтов', 'err');

    const driverCol = cols().find(c => c.id === state.doc.map.driver) || cols().find(c => c.id.toLowerCase() === 'driver');
    if (!driverCol) return flash('Не найден столбец пилота — укажите его в «Применить к стинтам…»', 'err');
    if (!confirm(`Записать имена пилотов из таблицы «${board.title}» (${stints.length} стинтов) в столбец «${driverCol.label}»?`)) return;

    while (rowsOf().length < Math.min(stints.length, T.MAX_ROWS)) rowsOf().push(newRow());
    const names = new Map((board.data.drivers || []).map(d => [d.driverId, d.name]));
    stints.slice(0, T.MAX_ROWS).forEach((s, i) => {
      const name = names.get(s.driverId) || '';
      if (name) rowsOf()[i][driverCol.id] = name;
      else delete rowsOf()[i][driverCol.id];
    });
    state.board = board;
    commitStructural();
  }

  /* -------------------------------------------------------------- apply -- */

  function readMap() {
    const map = {};
    $$('#apply-map select').forEach(sel => { if (sel.value) map[sel.dataset.key] = sel.value; });
    return map;
  }

  // Build the board's data from the calculated rows, or explain why it can't be.
  function buildApply(board) {
    const map = readMap();
    const skip = $('#apply-skip').checked;
    const floorLaps = $('#apply-floor').checked;
    const idx = key => (map[key] ? cols().findIndex(c => c.id === map[key]) : -1);
    const ix = Object.fromEntries(MAP_FIELDS.map(([k]) => [k, idx(k)]));

    if (ix.start < 0 || ix.duration < 0) return { error: 'Укажите столбцы старта и длительности' };

    const cellAt = (ri, key) => (ix[key] < 0 ? null : state.res.cells[ri][ix[key]]);
    const included = [];

    for (let ri = 0; ri < rowsOf().length; ri++) {
      const dur = cellAt(ri, 'duration');
      if (dur.e) return { error: `Строка ${ri + 1}, «${cols()[ix.duration].label}»: ${dur.e} — ${dur.msg}` };
      const seconds = typeof dur.v === 'number' ? dur.v : 0;
      if (skip && seconds <= 0) continue;
      included.push(ri);
    }
    if (!included.length) return { error: 'Нет строк с ненулевой длительностью' };
    if (included.length > 250) return { error: `Строк ${included.length}, а в таблице стинтов помещается 250` };

    const num = (ri, key) => {
      const cell = cellAt(ri, key);
      if (!cell) return { v: 0 };
      if (cell.e) return { error: `Строка ${ri + 1}, «${cols()[ix[key]].label}»: ${cell.e} — ${cell.msg}` };
      return { v: typeof cell.v === 'number' ? cell.v : 0 };
    };

    const startCell = cellAt(included[0], 'start');
    if (startCell.e) return { error: `Строка ${included[0] + 1}, «${cols()[ix.start].label}»: ${startCell.e} — ${startCell.msg}` };
    const base = typeof startCell.v === 'number' ? startCell.v : 0;

    const existing = (board.data && board.data.stints) || [];
    const drivers = ((board.data && board.data.drivers) || []).map(d => ({ ...d }));
    const byName = new Map(drivers.map(d => [d.name.trim().toLowerCase(), d]));
    let created = 0;

    const stints = [];
    for (const ri of included) {
      const start = num(ri, 'start');
      const dur = num(ri, 'duration');
      const pit = num(ri, 'pit');
      const laps = num(ri, 'laps');
      const fuel = num(ri, 'fuel');
      for (const part of [start, dur, pit, laps, fuel]) if (part.error) return { error: part.error };

      const nameCell = cellAt(ri, 'driver');
      const name = nameCell && !nameCell.e && nameCell.v != null ? String(nameCell.v).trim() : '';
      let driverId = '';
      if (name) {
        let d = byName.get(name.toLowerCase());
        if (!d) {
          d = { driverId: newId(), name, color: '' };
          drivers.push(d);
          byName.set(name.toLowerCase(), d);
          created++;
        }
        driverId = d.driverId;
      }

      const noteCell = cellAt(ri, 'note');
      const prev = existing[stints.length] || {};
      stints.push({
        id: prev.id || '',
        driverId,
        startOffsetSec: Math.round(start.v - base),
        plannedDurationSec: Math.round(dur.v),
        pitStopDurationSec: Math.round(pit.v),
        laps: Math.max(0, floorLaps ? Math.floor(laps.v + 1e-9) : Math.round(laps.v)),
        fuelL: Math.max(0, Math.round(fuel.v)),
        tyres: prev.tyres || '',
        status: prev.status || 'planned',
        note: noteCell ? (noteCell.e || noteCell.v == null ? '' : String(noteCell.v)) : prev.note || '',
      });
    }
    return { stints, drivers, created, skipped: rowsOf().length - included.length };
  }

  function updateApplySummary() {
    const out = buildApply(state.board);
    const node = $('#apply-summary');
    const go = $('#apply-go');
    if (out.error) {
      node.textContent = out.error;
      node.style.color = 'var(--bad)';
      go.disabled = true;
      return;
    }
    node.style.color = '';
    const old = (state.board.data && state.board.data.stints ? state.board.data.stints.length : 0);
    node.textContent = `Получится ${out.stints.length} стинтов` +
      (out.skipped ? ` (пропущено строк: ${out.skipped})` : '') +
      (out.created ? `, новых пилотов: ${out.created}` : '') +
      `. Сейчас в таблице ${old}. Шины и статусы сохранятся у стинтов с тем же порядковым номером; старт — смещение от первого стинта.`;
    go.disabled = false;
  }

  function openApply() {
    const guess = { driver: 'driver', start: 'start', duration: 'length', pit: 'pit', laps: 'laps', fuel: 'refuel', note: 'comment' };
    const known = new Set(cols().map(c => c.id));
    $('#apply-map').innerHTML = MAP_FIELDS.map(([key, label, required]) => {
      const wanted = state.doc.map[key] || (known.has(guess[key]) ? guess[key] : '');
      const options = (required ? '' : '<option value="">— не переносить —</option>') +
        cols().map(c => `<option value="${esc(c.id)}"${c.id === wanted ? ' selected' : ''}>${esc(c.label)} (${esc(c.id)})</option>`).join('');
      return `<div><label class="lbl">${esc(label)}</label><select data-key="${key}">${options}</select></div>`;
    }).join('');
    const n = state.board.data && state.board.data.stints ? state.board.data.stints.length : 0;
    $('#apply-intro').textContent = `Результат расчёта заменит список стинтов в таблице «${state.board.title}» (сейчас там ${n}). Пилоты сопоставляются по имени, цвета пилотов сохраняются.`;
    $('#apply-status').textContent = '';
    $('#apply-status').className = 'status';
    updateApplySummary();
    $('#apply-dlg').showModal();
  }

  async function performApply() {
    const status = $('#apply-status');
    const go = $('#apply-go');
    go.disabled = true;
    status.className = 'status pending';
    status.textContent = 'Записываю…';
    try {
      const fresh = await fetchBoard(state.boardId);
      const out = buildApply(fresh);
      if (out.error) throw new Error(out.error);
      if (!confirm(`Заменить стинты в таблице «${fresh.title}» (${(fresh.data.stints || []).length} шт.) результатом расчёта (${out.stints.length} шт.)?`)) {
        go.disabled = false;
        status.textContent = '';
        return;
      }
      await call('/api/stints', { id: state.boardId, rev: fresh.rev, data: { drivers: out.drivers, stints: out.stints } });
      state.board = await fetchBoard(state.boardId);

      // Remember the column choice with the document.
      state.doc.map = readMap();
      commit();

      status.className = 'status ok';
      status.innerHTML = `Готово: ${out.stints.length} стинтов записано. <a href="/stints-admin?b=${encodeURIComponent(state.boardId)}">Открыть таблицу стинтов</a>`;
    } catch (err) {
      status.className = 'status err';
      status.textContent = err.status === 409 ? 'Таблицу стинтов только что изменили — откройте окно заново.' : err.message;
    } finally {
      go.disabled = false;
    }
  }

  /* --------------------------------------------------------------- wire -- */

  function wire() {
    $('#gate-form').addEventListener('submit', async event => {
      event.preventDefault();
      const key = $('#gate-key').value.trim();
      if (!key) return;
      try {
        await signIn(key);
        await start();
      } catch (err) {
        showGate(err.status === 401 ? 'Ключ не подошёл' : err.message);
      }
    });

    $('#logout').addEventListener('click', signOut);
    $('#save').addEventListener('click', save);
    $('#reload').addEventListener('click', async () => {
      if (!confirm('Загрузить версию с сервера? Ваши несохранённые правки будут потеряны.')) return;
      try { await openBoard(state.boardId); } catch (err) { flash(err.message, 'err'); }
    });
    $('#import-board').addEventListener('click', importDrivers);
    $('#apply').addEventListener('click', openApply);
    $('#board-select').addEventListener('change', event => onBoardChange(event.target.value));

    $('#add-row').addEventListener('click', addRow);
    $('#insert-row').addEventListener('click', insertRow);
    $('#del-row').addEventListener('click', deleteRow);
    $('#add-col').addEventListener('click', addColumn);
    $('#reset-doc').addEventListener('click', resetDoc);

    const wrap = $('#gridwrap');
    wrap.addEventListener('keydown', onGridKey);
    $('#grid').addEventListener('mousedown', onGridMouseDown);
    $('#grid').addEventListener('dblclick', ev => {
      const td = ev.target.closest('td[data-ci]');
      if (td && !td.classList.contains('is-editing')) startEdit();
    });
    $('#grid').addEventListener('focusout', ev => {
      if (state.editing && ev.target.tagName === 'INPUT') finishEdit(ev.target.value);
    });

    const bar = $('#cell-input');
    bar.addEventListener('focus', () => { state.formulaField = bar; });
    bar.addEventListener('change', () => {
      const { ci, ri } = state.sel;
      if (setCellFromText(ci, ri, bar.value)) commit();
      else renderFormulaBar();
    });
    bar.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); wrap.focus({ preventScroll: true }); }
      if (ev.key === 'Escape') { ev.preventDefault(); bar.value = cellEditText(state.sel.ci, state.sel.ri); wrap.focus({ preventScroll: true }); }
    });

    $$('.calc-side .tab').forEach(t => t.addEventListener('click', () => { state.tab = t.dataset.tab; renderSide(); }));
    const side = $('#side-body');
    side.addEventListener('click', onSideClick);
    side.addEventListener('input', ev => onSideInput(ev, false));
    side.addEventListener('change', ev => onSideInput(ev, true));
    side.addEventListener('focusin', ev => { if (ev.target.hasAttribute('data-formula-target')) state.formulaField = ev.target; });

    $('#apply-map').addEventListener('change', updateApplySummary);
    $('#apply-skip').addEventListener('change', updateApplySummary);
    $('#apply-floor').addEventListener('change', updateApplySummary);
    $('#apply-cancel').addEventListener('click', () => $('#apply-dlg').close());
    $('#apply-go').addEventListener('click', performApply);

    document.addEventListener('keydown', ev => {
      const mod = ev.ctrlKey || ev.metaKey;
      if (mod && ev.key.toLowerCase() === 's') { ev.preventDefault(); if (state.doc) save(); return; }
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
      if (mod && !inField && state.doc) {
        if (ev.key.toLowerCase() === 'z' && !ev.shiftKey) { ev.preventDefault(); undo(); }
      }
    });

    window.addEventListener('beforeunload', event => {
      if (!isDirty()) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  async function start() {
    if (!state.boards.length) {
      $('#gate').hidden = true;
      $('#app').hidden = false;
      $('#board-select').innerHTML = '<option>Нет доступных таблиц</option>';
      flash('Для этого ключа нет ни одной таблицы стинтов', 'err');
      return;
    }
    const wanted = new URLSearchParams(location.search).get('b') || localStorage.getItem(BOARD_KEY) || '';
    const id = state.boards.some(b => b.id === wanted) ? wanted : state.boards[0].id;
    $('#gate').hidden = true;
    $('#app').hidden = false;
    await openBoard(id);
  }

  async function boot() {
    wire();
    const invited = readKeyFromHash();
    const stored = localStorage.getItem(STORE_KEY) || '';
    const key = invited || stored;
    if (!key) return showGate('');
    try {
      await signIn(key);
      await start();
    } catch (err) {
      if (err.status !== 401) return showGate(err.message);
      showGate(stored && !invited ? 'Сохранённый ключ больше не действует' : 'Ключ не подошёл');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
