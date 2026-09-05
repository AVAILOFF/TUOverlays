/*
  Renders a stint board and keeps it fresh. Used by stints.html in two modes:

    public   /s/<id>            fetches the board, re-reads it every view.refreshSec
    preview  /s/<id>?preview=1  same renderer, but the panel drives it over
                                postMessage so unsaved edits show up instantly

  All board content goes into the DOM as text nodes, never as markup — a driver
  called <img onerror> is a driver called <img onerror>, not a script.
*/

(function () {
  'use strict';

  const COPY = {
    ru: {
      index: '#', driver: 'Пилот', start: 'Старт', duration: 'Длительность', finish: 'Конец',
      laps: 'Круги', fuel: 'Топливо', tyres: 'Шины', pit: 'Пит', note: 'Заметка',
      now: 'Сейчас за рулём', next: 'Следующий', toChange: 'До смены', stints: 'Стинтов',
      track: 'Трасса', car: 'Машина', raceStart: 'Старт гонки', nobody: 'Не назначен',
      updated: 'Обновлено', justNow: 'только что', minAgo: 'мин назад', hAgo: 'ч назад',
      live: 'Автообновление', empty: 'Стинты ещё не добавлены', inPit: 'В боксах',
      notFound: 'Таблица не найдена', notFoundHint: 'Проверьте ссылку — возможно, таблицу удалили.',
      failed: 'Не удалось загрузить таблицу', retry: 'Повторная попытка через несколько секунд.',
      of: 'из', done_: 'пройдено', ahead: 'впереди',
    },
    en: {
      index: '#', driver: 'Driver', start: 'Start', duration: 'Duration', finish: 'Finish',
      laps: 'Laps', fuel: 'Fuel', tyres: 'Tyres', pit: 'Pit', note: 'Note',
      now: 'On track now', next: 'Up next', toChange: 'To change', stints: 'Stints',
      track: 'Track', car: 'Car', raceStart: 'Race start', nobody: 'Unassigned',
      updated: 'Updated', justNow: 'just now', minAgo: 'min ago', hAgo: 'h ago',
      live: 'Auto refresh', empty: 'No stints yet', inPit: 'In the pits',
      notFound: 'Board not found', notFoundHint: 'Check the link — the board may have been deleted.',
      failed: 'Could not load the board', retry: 'Retrying in a few seconds.',
      of: 'of', done_: 'done', ahead: 'ahead',
    },
  };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null && text !== '') node.textContent = String(text);
    return node;
  };

  const pad = n => String(n).padStart(2, '0');

  // 3661 -> "1:01:01", 2730 -> "45:30". Durations, not clock times.
  function fmtDur(sec) {
    const s = Math.max(0, Math.round(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? h + ':' + pad(m) + ':' + pad(s % 60) : m + ':' + pad(s % 60);
  }

  function fmtClock(date, view) {
    try {
      return new Intl.DateTimeFormat(view.lang === 'en' ? 'en-GB' : 'ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: !view.clock24,
        timeZone: view.tz || undefined,
      }).format(date);
    } catch {
      return pad(date.getHours()) + ':' + pad(date.getMinutes());
    }
  }

  function fmtDateTime(date, view) {
    try {
      return new Intl.DateTimeFormat(view.lang === 'en' ? 'en-GB' : 'ru-RU', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
        hour12: !view.clock24,
        timeZone: view.tz || undefined,
      }).format(date);
    } catch {
      return date.toISOString().slice(0, 16).replace('T', ' ');
    }
  }

  function relTime(iso, t) {
    const then = Date.parse(iso);
    if (Number.isNaN(then)) return '';
    const mins = Math.round((Date.now() - then) / 60000);
    if (mins < 1) return t.justNow;
    if (mins < 60) return mins + ' ' + t.minAgo;
    return Math.round(mins / 60) + ' ' + t.hAgo;
  }

  /* ------------------------------------------------------------- model -- */

  // One pass over the board that answers everything the header and rows need.
  function analyse(board) {
    const view = board.view;
    const drivers = new Map((board.data.drivers || []).map(d => [d.driverId, d]));
    const stints = (board.data.stints || []).slice().sort((a, b) => a.startOffsetSec - b.startOffsetSec);

    const raceStart = board.meta && board.meta.raceStartIso ? Date.parse(board.meta.raceStartIso) : NaN;
    const hasClock = !Number.isNaN(raceStart);
    const elapsed = hasClock ? (Date.now() - raceStart) / 1000 : NaN;

    const currentIndex = hasClock
      ? stints.findIndex(s => elapsed >= s.startOffsetSec && elapsed < s.startOffsetSec + s.plannedDurationSec)
      : -1;

    const rows = stints.map((stint, i) => {
      const startAt = hasClock ? new Date(raceStart + stint.startOffsetSec * 1000) : null;
      const endAt = hasClock ? new Date(raceStart + (stint.startOffsetSec + stint.plannedDurationSec) * 1000) : null;
      let state = 'planned';
      if (i === currentIndex) state = 'running';
      else if (hasClock && elapsed >= stint.startOffsetSec + stint.plannedDurationSec) state = 'done';
      return { stint, i, startAt, endAt, state, driver: drivers.get(stint.driverId) || null };
    });

    const current = currentIndex >= 0 ? rows[currentIndex] : null;
    const next = rows.find(r => r.i > (current ? current.i : -1) && r.state !== 'done') || null;

    // Between two stints (previous done, next not started) nobody is on
    // track — worth its own state rather than a blank "now" tile.
    let pit = null;
    if (!current && hasClock) {
      for (let i = 0; i < rows.length - 1; i++) {
        const a = rows[i], b = rows[i + 1];
        if (a.state === 'done' && b.state === 'planned' &&
            elapsed >= a.stint.startOffsetSec + a.stint.plannedDurationSec && elapsed < b.stint.startOffsetSec) {
          pit = { prev: a, next: b };
          break;
        }
      }
    }

    const changeAt = current ? current.endAt : (pit ? pit.next.startAt : null);
    const changeInSec = changeAt ? (changeAt - Date.now()) / 1000 : NaN;

    const totalPlannedSec = stints.reduce((max, s) => Math.max(max, s.startOffsetSec + s.plannedDurationSec), 0);

    return { view, rows, current, next, pit, changeAt, changeInSec, hasClock, raceStart, elapsed, totalPlannedSec, total: rows.length };
  }

  /* ------------------------------------------------------------ chrome -- */

  const RADIUS_PX = { sharp: '3px', soft: '10px', round: '18px' };

  function applyChrome(root, view) {
    root.className = 'st-root';
    root.dataset.theme = view.theme;
    root.dataset.density = view.density;
    root.dataset.finished = view.finishedStyle;
    root.dataset.cards = view.mobileCards ? 'on' : 'off';
    root.dataset.align = view.titleAlign;
    root.dataset.stripe = view.stripedRows ? 'on' : 'off';
    root.dataset.borders = view.tableBorders;
    root.dataset.numbers = view.numbersAlign;
    root.dataset.glow = view.currentGlow ? 'on' : 'off';
    root.style.setProperty('--accent', view.accent);
    root.style.setProperty('--data', view.dataColor);
    root.style.setProperty('--good', view.goodColor);
    root.style.setProperty('--warn', view.warnColor);
    root.style.setProperty('--custom-bg', view.customBg);
    root.style.setProperty('--custom-tx', view.customText);
    root.style.setProperty('--fs', (view.fontScale / 100).toFixed(2));
    root.style.setProperty('--maxw', view.maxWidth + 'px');
    root.style.setProperty('--radius', RADIUS_PX[view.radius] || RADIUS_PX.soft);
    document.documentElement.style.background = getComputedStyle(root).backgroundColor;
  }

  /* ------------------------------------------------------------ render -- */

  function render(root, board) {
    const view = board.view;
    const t = COPY[view.lang] || COPY.ru;
    const model = analyse(board);

    applyChrome(root, view);
    root.textContent = '';

    const shell = el('div', 'st-shell st-reveal');
    root.appendChild(shell);

    if (model.current && view.highlightCurrent && view.showBreakNumber) {
      shell.appendChild(el('div', 'st-break', pad(model.current.i + 1)));
    }

    shell.appendChild(head(board, view, t));
    if (view.showRaceProgress) {
      const bar = progressBar(model);
      if (bar) shell.appendChild(bar);
    }
    if (view.showSummary) shell.appendChild(rail(model, view, t));
    shell.appendChild(table(model, view, t));
    shell.appendChild(foot(board, view, t));

    return model;
  }

  function head(board, view, t) {
    const head = el('header', 'st-head');
    const main = el('div', 'st-head-main');

    main.appendChild(el('h1', 'st-title', board.title));
    if (view.subtitle) main.appendChild(el('p', 'st-sub', view.subtitle));

    if (view.showMeta) {
      const meta = el('div', 'st-meta');
      const add = (label, value) => {
        if (!value) return;
        const item = el('span', null, label + ' ');
        item.appendChild(el('b', null, value));
        meta.appendChild(item);
      };
      add(t.track, board.meta.track);
      add(t.car, board.meta.car);
      if (board.meta.raceStartIso) add(t.raceStart, fmtDateTime(new Date(board.meta.raceStartIso), view));
      if (board.meta.note) meta.appendChild(el('span', null, board.meta.note));
      if (meta.childNodes.length) main.appendChild(meta);
    }

    head.appendChild(main);

    if (view.logoUrl) {
      const img = el('img', 'st-logo');
      img.src = view.logoUrl;
      img.alt = '';
      head.appendChild(img);
    }
    return head;
  }

  // % of the planned race span elapsed so far — nothing to show without a
  // race start time or without any stints to measure a span from.
  function progressBar(model) {
    if (!model.hasClock || !model.totalPlannedSec) return null;
    const pct = Math.min(1, Math.max(0, model.elapsed / model.totalPlannedSec));
    const box = el('div', 'st-progress');
    const bar = el('div', 'st-progress-bar');
    bar.dataset.progress = '1';
    bar.style.transform = 'scaleX(' + pct.toFixed(4) + ')';
    box.appendChild(bar);
    return box;
  }

  function rail(model, view, t) {
    const rail = el('div', 'st-rail');

    const tile = (label, value, valueClass, sub, subClass) => {
      const box = el('div', 'st-tile');
      box.appendChild(el('span', 'k', label));
      box.appendChild(el('span', 'v' + (valueClass ? ' ' + valueClass : ''), value));
      if (sub) box.appendChild(el('span', 's' + (subClass ? ' ' + subClass : ''), sub));
      return box;
    };

    const nameOf = row => (row && row.driver ? row.driver.name : t.nobody);
    const inPit = model.pit && view.showPitState;

    rail.appendChild(tile(
      t.now,
      inPit ? t.inPit : (model.current ? nameOf(model.current) : '—'),
      inPit ? 'is-warn' : 'is-accent',
      inPit ? nameOf(model.pit.next) : (model.current ? pad(model.current.i + 1) + ' ' + t.of + ' ' + pad(model.total) : null)
    ));

    rail.appendChild(tile(
      t.next,
      model.next ? nameOf(model.next) : '—',
      null,
      model.next && model.next.startAt ? fmtClock(model.next.startAt, view) : null
    ));

    const countdown = tile(t.toChange, Number.isFinite(model.changeInSec) ? fmtDur(model.changeInSec) : '—', 'is-data',
      model.changeAt ? fmtClock(model.changeAt, view) : null);
    const countdownValue = countdown.querySelector('.v');
    countdownValue.dataset.countdown = '1';
    const soon = !model.pit && view.pitWarningSec > 0 && Number.isFinite(model.changeInSec) && model.changeInSec <= view.pitWarningSec;
    countdownValue.classList.toggle('is-soon', soon);
    rail.appendChild(countdown);

    const doneCount = model.rows.filter(r => r.state === 'done').length;
    const allDone = model.total > 0 && doneCount === model.total;
    rail.appendChild(tile(t.stints, String(model.total), null, doneCount + ' ' + t.done_, allDone ? 'is-good' : null));

    return rail;
  }

  function table(model, view, t) {
    const wrap = el('div', 'st-tablewrap');
    const table = el('table', 'st-table');
    const columns = view.columns.filter(c => c.visible);
    const label = col => col.label || t[col.key] || col.key;

    const thead = el('thead');
    const hrow = el('tr');
    for (const col of columns) hrow.appendChild(el('th', 'h-' + col.key, label(col)));
    thead.appendChild(hrow);
    table.appendChild(thead);

    const body = el('tbody');
    let rows = model.rows;
    if (view.finishedStyle === 'hide') rows = rows.filter(r => r.state !== 'done');

    if (!rows.length) {
      const tr = el('tr');
      const td = el('td', 'st-empty', view.emptyText || t.empty);
      td.colSpan = Math.max(1, columns.length);
      tr.appendChild(td);
      body.appendChild(tr);
    }

    let group = null;
    if (view.groupBy === 'driver') {
      rows = rows.slice().sort((a, b) => {
        const an = a.driver ? a.driver.name : '￿';
        const bn = b.driver ? b.driver.name : '￿';
        return an.localeCompare(bn) || a.stint.startOffsetSec - b.stint.startOffsetSec;
      });
    }

    for (const row of rows) {
      if (view.groupBy === 'driver') {
        const name = row.driver ? row.driver.name : t.nobody;
        if (name !== group) {
          group = name;
          const tr = el('tr', 'st-group');
          const td = el('td', null, name);
          td.colSpan = Math.max(1, columns.length);
          tr.appendChild(td);
          body.appendChild(tr);
        }
      }

      const tr = el('tr');
      if (row.state === 'running' && view.highlightCurrent) tr.classList.add('is-current');
      if (row.state === 'done') tr.classList.add('is-done');
      if (view.highlightNext && row === model.next) tr.classList.add('is-next');

      for (const col of columns) {
        const td = cell(col.key, row, view, t);
        td.dataset.label = label(col);
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }

    table.appendChild(body);
    wrap.appendChild(table);
    return wrap;
  }

  function cell(key, row, view, t) {
    const { stint, driver, startAt, endAt } = row;

    if (key === 'index') return el('td', 'c-index', pad(row.i + 1));

    if (key === 'driver') {
      const td = el('td', 'c-driver');
      const box = el('div', 'st-driver');
      if (view.driverColors) {
        const dot = el('span', 'st-dot');
        if (driver && driver.color) dot.style.background = driver.color;
        box.appendChild(dot);
      }
      box.appendChild(el('span', 'n', driver ? driver.name : t.nobody));
      td.appendChild(box);
      return td;
    }

    if (key === 'start' || key === 'finish') {
      const at = key === 'start' ? startAt : endAt;
      const offset = key === 'start'
        ? stint.startOffsetSec
        : stint.startOffsetSec + stint.plannedDurationSec;
      const td = el('td', 'c-num');
      if (view.timeMode !== 'race' && at) {
        td.appendChild(document.createTextNode(fmtClock(at, view)));
        if (view.timeMode === 'both') td.appendChild(el('span', 'st-sub-time', '+' + fmtDur(offset)));
      } else {
        td.appendChild(document.createTextNode('+' + fmtDur(offset)));
      }
      return td;
    }

    if (key === 'duration') return el('td', 'c-num', fmtDur(stint.plannedDurationSec));
    if (key === 'pit') return el('td', 'c-num', stint.pitStopDurationSec ? fmtDur(stint.pitStopDurationSec) : '—');
    if (key === 'laps') return el('td', 'c-num', stint.laps || '—');
    if (key === 'fuel') return el('td', 'c-num', stint.fuelL ? stint.fuelL + ' L' : '—');
    if (key === 'tyres') return el('td', 'c-tyres', stint.tyres || '—');
    if (key === 'note') return el('td', 'c-note', stint.note || '');

    return el('td', null, '');
  }

  function foot(board, view, t) {
    const foot = el('footer', 'st-foot');
    if (view.showUpdated && board.updatedAt) {
      foot.appendChild(el('span', null, t.updated + ' ' + relTime(board.updatedAt, t)));
    }
    if (view.refreshSec) foot.appendChild(el('span', 'st-live', t.live + ' · ' + view.refreshSec + 's'));
    if (view.footerNote) foot.appendChild(el('span', 'note', view.footerNote));
    return foot;
  }

  /* --------------------------------------------------------------- boot -- */

  function message(root, title, hint) {
    root.textContent = '';
    const box = el('div', 'st-msg');
    box.appendChild(el('h1', null, title));
    box.appendChild(el('p', null, hint));
    root.appendChild(box);
  }

  function boardId() {
    const fromPath = /^\/s\/([A-Za-z0-9_-]{4,32})/.exec(location.pathname);
    if (fromPath) return fromPath[1];
    return new URLSearchParams(location.search).get('id') || '';
  }

  function boot() {
    const root = document.getElementById('st-root');
    const preview = new URLSearchParams(location.search).has('preview');
    const id = boardId();

    let board = null;
    let model = null;
    let refreshTimer = 0;

    const draw = () => {
      if (!board) return;
      model = render(root, board);
      document.title = board.title + ' · TU Overlays';
    };

    // The countdown, the pit-warning tint and the progress bar are the only
    // things that have to move between refreshes.
    setInterval(() => {
      if (!model) return;
      if (model.changeAt && Number.isFinite(model.changeInSec)) {
        const node = root.querySelector('[data-countdown]');
        if (node) {
          const left = (model.changeAt - Date.now()) / 1000;
          node.textContent = left > 0 ? fmtDur(left) : '0:00';
          const soon = !model.pit && model.view.pitWarningSec > 0 && left <= model.view.pitWarningSec;
          node.classList.toggle('is-soon', soon);
        }
      }
      if (model.hasClock && model.totalPlannedSec) {
        const bar = root.querySelector('[data-progress]');
        if (bar) {
          const pct = Math.min(1, Math.max(0, (Date.now() - model.raceStart) / 1000 / model.totalPlannedSec));
          bar.style.transform = 'scaleX(' + pct.toFixed(4) + ')';
        }
      }
    }, 1000);

    const schedule = () => {
      clearTimeout(refreshTimer);
      if (preview || !board || !board.view.refreshSec) return;
      refreshTimer = setTimeout(load, board.view.refreshSec * 1000);
    };

    async function load() {
      try {
        const res = await fetch('/api/stints?id=' + encodeURIComponent(id), { cache: 'no-store' });
        if (res.status === 404) {
          if (!preview) message(root, COPY.ru.notFound, COPY.ru.notFoundHint);
          return;
        }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        board = await res.json();
        draw();
      } catch {
        if (!board && !preview) message(root, COPY.ru.failed, COPY.ru.retry);
        if (!preview) refreshTimer = setTimeout(load, 15000);
        return;
      }
      schedule();
    }

    if (preview) {
      // Same-origin only: the panel is the sole thing allowed to drive this.
      window.addEventListener('message', event => {
        if (event.origin !== location.origin) return;
        const msg = event.data;
        if (!msg || msg.type !== 'tu-stints-preview') return;
        board = msg.board;
        draw();
      });
      window.parent.postMessage({ type: 'tu-stints-ready' }, location.origin);
    }

    if (!id) {
      if (!preview) message(root, COPY.ru.notFound, COPY.ru.notFoundHint);
      return;
    }
    load();
  }

  window.TUStints = { render, applyChrome, analyse, fmtDur };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
