/*
  TUCalc — the formula engine behind the stint calculator.

  A calculator document is a small spreadsheet: named parameters, a list of
  columns (each either typed in by hand or computed by a formula), rows, and a
  handful of summary formulas. This file turns that document into numbers. It
  has no DOM and no network — the page and the tests both load it as is.

  Units: every time is a plain number of seconds. A stint of 40:42 is 2442, a
  time of day is seconds since midnight (and may run past 86400 in a 24 h race).
  That is deliberate — the Google Sheet this replaces stores times as fractions
  of a day, and its HOUR/MINUTE/SECOND arithmetic silently drops the hours once
  a stint passes 59:59.

  Formulas are parsed by the small recursive-descent parser below and
  interpreted directly. Nothing is ever handed to eval or Function.

  References inside a formula:
    laps            the value of column "laps" in the same row (or a parameter)
    prev.finish     column "finish" in the previous row (also next / first / last)
    laps[3]         column "laps" in row 3 (1-based)
    laps[2:39]      rows 2..39 — a range, only meaningful inside SUM, AVG, …
    SUM(laps)       a bare column name inside an aggregate means the whole column
*/

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TUCalc = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ----------------------------------------------------------- errors -- */

  class CalcError extends Error {
    constructor(code, message) {
      super(message || code);
      this.code = code;
    }
  }
  const E = (code, message) => new CalcError(code, message);

  const ID_RE = /^[A-Za-z_Ѐ-ӿ][A-Za-z0-9_Ѐ-ӿ]*$/;
  const SCOPES = ['prev', 'next', 'first', 'last'];
  const RESERVED = new Set(['true', 'false', ...SCOPES]);
  const MAX_ROWS = 300;

  /* --------------------------------------------------------- tokenizer -- */

  const isIdStart = c => /[A-Za-z_Ѐ-ӿ]/.test(c);
  const isIdPart = c => /[A-Za-z0-9_Ѐ-ӿ]/.test(c);

  function tokenize(src) {
    const toks = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }

      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
        toks.push({ t: 'num', v: parseFloat(m[0]), p: i, q: i + m[0].length });
        i += m[0].length;
        continue;
      }

      if (c === '"') {
        let j = i + 1;
        let s = '';
        for (;;) {
          if (j >= src.length) throw E('#PARSE', 'Не закрыта кавычка');
          if (src[j] === '"') {
            if (src[j + 1] === '"') { s += '"'; j += 2; continue; }
            break;
          }
          s += src[j++];
        }
        toks.push({ t: 'str', v: s, p: i, q: j + 1 });
        i = j + 1;
        continue;
      }

      if (isIdStart(c)) {
        let j = i + 1;
        while (j < src.length && isIdPart(src[j])) j++;
        toks.push({ t: 'id', v: src.slice(i, j), p: i, q: j });
        i = j;
        continue;
      }

      const two = src.slice(i, i + 2);
      if (two === '<=' || two === '>=' || two === '<>' || two === '!=') {
        toks.push({ t: 'op', v: two === '!=' ? '<>' : two, p: i, q: i + 2 });
        i += 2;
        continue;
      }
      if ('+-*/^&=<>(),;[].%:'.includes(c)) {
        toks.push({ t: 'op', v: c, p: i, q: i + 1 });
        i++;
        continue;
      }
      throw E('#PARSE', `Неожиданный символ «${c}»`);
    }
    toks.push({ t: 'end', p: src.length, q: src.length });
    return toks;
  }

  /* ------------------------------------------------------------ parser -- */

  const describe = tok => (tok.t === 'end' ? 'конец формулы' : `«${tok.t === 'str' ? '"' + tok.v + '"' : tok.v}»`);

  class Parser {
    constructor(toks) { this.t = toks; this.i = 0; }

    peek() { return this.t[this.i]; }
    next() { return this.t[this.i++]; }
    isOp(v) { const k = this.peek(); return k.t === 'op' && k.v === v; }
    eat(v) { if (this.isOp(v)) { this.i++; return true; } return false; }
    expect(v) {
      if (!this.eat(v)) throw E('#PARSE', `Ожидалось «${v}», найдено ${describe(this.peek())}`);
    }

    parseAll() {
      if (this.peek().t === 'end') throw E('#PARSE', 'Пустая формула');
      const node = this.cmp();
      if (this.peek().t !== 'end') throw E('#PARSE', `Лишнее: ${describe(this.peek())}`);
      return node;
    }

    cmp() {
      let a = this.concat();
      for (;;) {
        const k = this.peek();
        if (k.t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(k.v)) {
          this.i++;
          a = { k: 'bin', op: k.v, a, b: this.concat() };
        } else return a;
      }
    }

    concat() {
      let a = this.add();
      while (this.eat('&')) a = { k: 'bin', op: '&', a, b: this.add() };
      return a;
    }

    add() {
      let a = this.mul();
      while (this.isOp('+') || this.isOp('-')) {
        const op = this.next().v;
        a = { k: 'bin', op, a, b: this.mul() };
      }
      return a;
    }

    mul() {
      let a = this.unary();
      while (this.isOp('*') || this.isOp('/')) {
        const op = this.next().v;
        a = { k: 'bin', op, a, b: this.unary() };
      }
      return a;
    }

    unary() {
      if (this.eat('-')) return { k: 'un', a: this.unary() };
      if (this.eat('+')) return this.unary();
      return this.pow();
    }

    pow() {
      const a = this.postfix();
      if (this.eat('^')) return { k: 'bin', op: '^', a, b: this.unary() };
      return a;
    }

    postfix() {
      let a = this.primary();
      while (this.eat('%')) a = { k: 'pct', a };
      return a;
    }

    primary() {
      const tok = this.next();
      if (tok.t === 'num') return { k: 'num', v: tok.v };
      if (tok.t === 'str') return { k: 'str', v: tok.v };

      if (tok.t === 'op' && tok.v === '(') {
        const inner = this.cmp();
        this.expect(')');
        return inner;
      }

      if (tok.t === 'id') {
        const low = tok.v.toLowerCase();

        if (this.isOp('(')) {
          this.i++;
          const args = [];
          if (!this.eat(')')) {
            for (;;) {
              args.push(this.cmp());
              if (this.eat(',') || this.eat(';')) continue;
              this.expect(')');
              break;
            }
          }
          return { k: 'call', f: low, args, name: tok.v };
        }

        if (low === 'true' || low === 'false') return { k: 'bool', v: low === 'true' };

        if (this.isOp('.')) {
          this.i++;
          const col = this.next();
          if (col.t !== 'id') throw E('#PARSE', 'После точки нужно имя столбца');
          if (!SCOPES.includes(low)) throw E('#PARSE', `«${tok.v}.» — неизвестная область; есть prev, next, first, last`);
          return { k: 'scoped', scope: low, n: col.v.toLowerCase() };
        }

        if (this.isOp('[')) {
          this.i++;
          const from = this.cmp();
          if (this.eat(':')) {
            const to = this.cmp();
            this.expect(']');
            return { k: 'range', n: low, a: from, b: to };
          }
          this.expect(']');
          return { k: 'abs', n: low, a: from };
        }

        return { k: 'name', n: low, raw: tok.v };
      }

      throw E('#PARSE', `Неожиданно: ${describe(tok)}`);
    }
  }

  const compiled = new Map();

  // Formulas may be typed with or without the leading "=".
  const stripEq = src => String(src).trim().replace(/^=\s*/, '');

  function compile(src) {
    const text = stripEq(src);
    let hit = compiled.get(text);
    if (!hit) {
      try {
        hit = { ast: new Parser(tokenize(text)).parseAll() };
      } catch (err) {
        if (!(err instanceof CalcError)) throw err;
        hit = { err };
      }
      if (compiled.size > 3000) compiled.clear();
      compiled.set(text, hit);
    }
    if (hit.err) throw hit.err;
    return hit.ast;
  }

  /* ---------------------------------------------------------- coercion -- */

  const isBlank = v => v === null || v === undefined || v === '';

  function toNum(v) {
    if (isBlank(v)) return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    const n = Number(String(v).trim().replace(',', '.'));
    if (!Number.isFinite(n)) throw E('#VALUE', `«${v}» — не число`);
    return n;
  }

  function toBool(v) {
    if (typeof v === 'boolean') return v;
    if (isBlank(v)) return false;
    if (typeof v === 'number') return v !== 0;
    const s = String(v).trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
    throw E('#VALUE', `«${v}» — не логическое значение`);
  }

  const trimNum = n => String(Math.round(n * 1e10) / 1e10);

  function toStr(v) {
    if (isBlank(v)) return '';
    if (typeof v === 'number') return trimNum(v);
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return String(v);
  }

  function check(n) {
    if (!Number.isFinite(n)) throw E('#NUM', 'Результат не является числом');
    return n;
  }

  function compare(op, a, b) {
    let x;
    let y;
    if (typeof a === 'string' || typeof b === 'string') {
      x = toStr(a).toLowerCase();
      y = toStr(b).toLowerCase();
    } else {
      x = toNum(a);
      y = toNum(b);
    }
    switch (op) {
      case '=': return x === y;
      case '<>': return x !== y;
      case '<': return x < y;
      case '>': return x > y;
      case '<=': return x <= y;
      default: return x >= y;
    }
  }

  // Digits beyond the 15th are float noise (0.1 + 0.2); rounding functions
  // look through it so ROUNDDOWN(89 / 7.4 * 7.4) is not 88.
  const clean = x => Number(x.toPrecision(15));

  function roundTo(x, digits, how) {
    const m = 10 ** digits;
    const abs = clean(Math.abs(x) * m);
    const r = how === 'up' ? Math.ceil(abs) : how === 'down' ? Math.floor(abs) : Math.round(abs);
    return (Math.sign(x) * r) / m;
  }

  // "SUMIF"-style criterion: a bare value means equals, a leading operator
  // (">5", "<=10", "<>Kardanov") is honoured.
  function matcher(criterion) {
    if (typeof criterion === 'string') {
      const m = /^(<=|>=|<>|=|<|>)?([\s\S]*)$/.exec(criterion);
      const op = m[1] || '=';
      const rhs = m[2].trim();
      const asNum = rhs !== '' && Number.isFinite(Number(rhs.replace(',', '.'))) ? Number(rhs.replace(',', '.')) : null;
      return v => {
        if (asNum !== null && typeof v === 'number') return compare(op, v, asNum);
        return compare(op, toStr(v), rhs);
      };
    }
    return v => compare('=', v, criterion);
  }

  /* --------------------------------------------------------- functions -- */

  const numbersOnly = list => list.filter(v => typeof v === 'number');

  const FN = {
    if: {
      lazy: true, min: 2, max: 3,
      doc: ['IF(условие; если_да; если_нет)', 'Ветка, которая не выбрана, не вычисляется — можно ссылаться на prev в первой строке.'],
      run: (a, c) => (toBool(c.ev(a[0])) ? c.ev(a[1]) : a[2] ? c.ev(a[2]) : false),
    },
    iferror: {
      lazy: true, min: 2, max: 2,
      doc: ['IFERROR(значение; запасное)', 'Если значение — ошибка, берётся запасное.'],
      run: (a, c) => {
        try { return c.ev(a[0]); } catch (err) {
          if (err instanceof CalcError) return c.ev(a[1]);
          throw err;
        }
      },
    },
    and: { min: 1, doc: ['AND(a; b; …)', 'Истина, если истинны все.'], run: a => a.every(toBool) },
    or: { min: 1, doc: ['OR(a; b; …)', 'Истина, если истинно хотя бы одно.'], run: a => a.some(toBool) },
    not: { min: 1, max: 1, doc: ['NOT(a)', 'Отрицание.'], run: a => !toBool(a[0]) },

    min: {
      lazy: true, min: 1,
      doc: ['MIN(a; b; …)  ·  MIN(столбец)', 'С одним аргументом-столбцом — минимум по всему столбцу.'],
      run: (a, c) => {
        if (a.length === 1) { const v = numbersOnly(c.vec(a[0])); return v.length ? Math.min(...v) : 0; }
        return Math.min(...a.map(n => toNum(c.ev(n))));
      },
    },
    max: {
      lazy: true, min: 1,
      doc: ['MAX(a; b; …)  ·  MAX(столбец)', 'С одним аргументом-столбцом — максимум по всему столбцу.'],
      run: (a, c) => {
        if (a.length === 1) { const v = numbersOnly(c.vec(a[0])); return v.length ? Math.max(...v) : 0; }
        return Math.max(...a.map(n => toNum(c.ev(n))));
      },
    },
    sum: {
      lazy: true, min: 1,
      doc: ['SUM(столбец)  ·  SUM(столбец[2:39])', 'Имя столбца здесь — весь столбец. Диапазон строк — в квадратных скобках.'],
      run: (a, c) => a.reduce((acc, n) => acc + numbersOnly(c.vec(n)).reduce((s, v) => s + v, 0), 0),
    },
    avg: {
      lazy: true, min: 1, alias: ['average'],
      doc: ['AVG(столбец)', 'Среднее по числам столбца или диапазона.'],
      run: (a, c) => {
        const v = numbersOnly(a.flatMap(n => c.vec(n)));
        if (!v.length) throw E('#DIV/0', 'Нет чисел для среднего');
        return v.reduce((s, x) => s + x, 0) / v.length;
      },
    },
    count: {
      lazy: true, min: 1,
      doc: ['COUNT(столбец)', 'Сколько в столбце чисел.'],
      run: (a, c) => numbersOnly(a.flatMap(n => c.vec(n))).length,
    },
    sumif: {
      lazy: true, min: 2, max: 3,
      doc: ['SUMIF(столбец_условия; условие; столбец_суммы)', 'Например SUMIF(driver; "Ivanov"; length) — сколько времени за рулём у пилота. Условие может быть ">5".'],
      run: (a, c) => {
        const keys = c.vec(a[0]);
        const test = matcher(c.ev(a[1]));
        const vals = a[2] ? c.vec(a[2]) : keys;
        let s = 0;
        keys.forEach((k, i) => { if (test(k) && typeof vals[i] === 'number') s += vals[i]; });
        return s;
      },
    },
    countif: {
      lazy: true, min: 2, max: 2,
      doc: ['COUNTIF(столбец; условие)', 'Сколько строк подходит под условие.'],
      run: (a, c) => {
        const test = matcher(c.ev(a[1]));
        return c.vec(a[0]).filter(test).length;
      },
    },

    abs: { min: 1, max: 1, doc: ['ABS(x)', 'Модуль.'], run: a => Math.abs(toNum(a[0])) },
    sign: { min: 1, max: 1, doc: ['SIGN(x)', '−1, 0 или 1.'], run: a => Math.sign(toNum(a[0])) },
    sqrt: {
      min: 1, max: 1, doc: ['SQRT(x)', 'Квадратный корень.'],
      run: a => { const x = toNum(a[0]); if (x < 0) throw E('#NUM', 'Корень из отрицательного'); return Math.sqrt(x); },
    },
    pow: { min: 2, max: 2, doc: ['POW(x; n)', 'Степень (то же, что x^n).'], run: a => check(toNum(a[0]) ** toNum(a[1])) },
    mod: {
      min: 2, max: 2, doc: ['MOD(x; y)', 'Остаток от деления.'],
      run: a => { const y = toNum(a[1]); if (y === 0) throw E('#DIV/0', 'Деление на ноль'); const x = toNum(a[0]); return x - y * Math.floor(x / y); },
    },
    round: { min: 1, max: 2, doc: ['ROUND(x; знаков)', 'Обычное округление.'], run: a => roundTo(toNum(a[0]), a[1] === undefined ? 0 : toNum(a[1]), 'near') },
    roundup: { min: 1, max: 2, doc: ['ROUNDUP(x; знаков)', 'Округление от нуля.'], run: a => roundTo(toNum(a[0]), a[1] === undefined ? 0 : toNum(a[1]), 'up') },
    rounddown: { min: 1, max: 2, doc: ['ROUNDDOWN(x; знаков)', 'Округление к нулю. Целые круги стинта — ROUNDDOWN(laps).'], run: a => roundTo(toNum(a[0]), a[1] === undefined ? 0 : toNum(a[1]), 'down') },
    trunc: { min: 1, max: 2, doc: ['TRUNC(x; знаков)', 'Отбросить дробную часть. Так Google отбрасывает доли секунды в TIME().'], run: a => roundTo(toNum(a[0]), a[1] === undefined ? 0 : toNum(a[1]), 'down') },
    int: { min: 1, max: 1, doc: ['INT(x)', 'Округление вниз до целого.'], run: a => Math.floor(clean(toNum(a[0]))) },
    floor: {
      min: 1, max: 2, doc: ['FLOOR(x; шаг)', 'Вниз до кратного шагу.'],
      run: a => { const s = a[1] === undefined ? 1 : toNum(a[1]); if (s === 0) throw E('#DIV/0', 'Шаг равен нулю'); return Math.floor(clean(toNum(a[0]) / s)) * s; },
    },
    ceil: {
      min: 1, max: 2, alias: ['ceiling'], doc: ['CEIL(x; шаг)', 'Вверх до кратного шагу.'],
      run: a => { const s = a[1] === undefined ? 1 : toNum(a[1]); if (s === 0) throw E('#DIV/0', 'Шаг равен нулю'); return Math.ceil(clean(toNum(a[0]) / s)) * s; },
    },

    time: { min: 3, max: 3, doc: ['TIME(ч; мин; сек)', 'Секунды: TIME(0; 40; 42) = 2442.'], run: a => toNum(a[0]) * 3600 + toNum(a[1]) * 60 + toNum(a[2]) },
    hour: { min: 1, max: 1, doc: ['HOUR(сек)', 'Часы (0–23) времени в секундах.'], run: a => Math.floor(toNum(a[0]) / 3600) % 24 },
    minute: { min: 1, max: 1, doc: ['MINUTE(сек)', 'Минуты (0–59).'], run: a => Math.floor(toNum(a[0]) / 60) % 60 },
    second: { min: 1, max: 1, doc: ['SECOND(сек)', 'Секунды (0–59).'], run: a => Math.floor(toNum(a[0])) % 60 },
    hms: { min: 1, max: 1, doc: ['HMS(сек)', 'Текст «ч:мм:сс».'], run: a => fmtHMS(toNum(a[0])) },
    clock: { min: 1, max: 1, doc: ['CLOCK(сек)', 'Текст «чч:мм:сс» — время суток.'], run: a => fmtClock(toNum(a[0])) },

    row: { min: 0, max: 0, needsRow: true, doc: ['ROW()', 'Номер текущей строки, с 1.'], run: (a, c) => c.row + 1 },
    rows: { min: 0, max: 0, doc: ['ROWS()', 'Сколько всего строк.'], run: (a, c) => c.nRows },
    isblank: { min: 1, max: 1, doc: ['ISBLANK(x)', 'Пусто ли значение.'], run: a => isBlank(a[0]) },
    isnumber: { min: 1, max: 1, doc: ['ISNUMBER(x)', 'Число ли значение.'], run: a => typeof a[0] === 'number' },
    len: { min: 1, max: 1, doc: ['LEN(текст)', 'Длина текста.'], run: a => toStr(a[0]).length },
  };

  for (const [name, def] of Object.entries(FN)) {
    for (const alias of def.alias || []) FN[alias] = def;
    def.name = name;
  }

  const FUNCTION_DOCS = Object.values(FN)
    .filter((def, i, all) => all.indexOf(def) === i)
    .map(def => ({ name: def.name.toUpperCase(), syntax: def.doc[0], text: def.doc[1] }));

  /* ------------------------------------------------------------ format -- */

  const pad2 = n => (n < 10 ? '0' + n : String(n));

  function fmtHMS(sec) {
    let s = Math.round(sec);
    const neg = s < 0;
    if (neg) s = -s;
    return (neg ? '−' : '') + Math.floor(s / 3600) + ':' + pad2(Math.floor((s % 3600) / 60)) + ':' + pad2(s % 60);
  }

  function fmtClock(sec) {
    const total = Math.round(sec);
    const day = Math.floor(total / 86400);
    const s = ((total % 86400) + 86400) % 86400;
    const text = pad2(Math.floor(s / 3600)) + ':' + pad2(Math.floor((s % 3600) / 60)) + ':' + pad2(s % 60);
    if (day === 0) return text;
    return text + (day > 0 ? ' +' + day : ' −' + -day);
  }

  // What a cell shows. `col` carries fmt ('text' | 'num' | 'int' | 'time' | 'clock') and dec.
  function format(value, col) {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    const fmt = (col && col.fmt) || 'text';
    if (typeof value === 'string') return value;
    if (fmt === 'time') return fmtHMS(value);
    if (fmt === 'clock') return fmtClock(value);
    if (fmt === 'int') return String(Math.round(value));
    if (fmt === 'num') {
      const dec = col && Number.isInteger(col.dec) ? col.dec : 2;
      return value.toFixed(Math.min(6, Math.max(0, dec)));
    }
    return trimNum(value);
  }

  // Text typed into a cell / parameter -> stored value.
  // Returns { ok, value } — value undefined means "clear", a string starting
  // with "=" is a formula kept verbatim.
  function parseInput(text, fmt) {
    const raw = String(text == null ? '' : text).trim();
    if (raw === '') return { ok: true, value: undefined };
    if (raw[0] === '=') return { ok: true, value: raw };

    if (fmt === 'text') return { ok: true, value: raw };

    if (fmt === 'time' || fmt === 'clock') {
      const parts = raw.split(':').map(p => p.trim().replace(',', '.'));
      if (parts.some(p => p === '' || !Number.isFinite(Number(p)) || Number(p) < 0)) {
        return { ok: false, error: 'Время: 55:00, 1:01:00 или число' };
      }
      const n = parts.map(Number);
      let sec;
      if (fmt === 'time') {
        // Same convention as the stint panel: m:ss, h:mm:ss, a bare number is minutes.
        if (n.length === 1) sec = n[0] * 60;
        else if (n.length === 2) sec = n[0] * 60 + n[1];
        else if (n.length === 3) sec = n[0] * 3600 + n[1] * 60 + n[2];
      } else if (n.length === 1) sec = n[0] * 3600;
      else if (n.length === 2) sec = n[0] * 3600 + n[1] * 60;
      else if (n.length === 3) sec = n[0] * 3600 + n[1] * 60 + n[2];
      if (sec === undefined) return { ok: false, error: 'Слишком много «:»' };
      return { ok: true, value: sec };
    }

    const n = Number(raw.replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(n)) return { ok: false, error: 'Нужно число' };
    return { ok: true, value: n };
  }

  // Stored value -> text for an edit box.
  function editText(value, fmt) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    if (fmt === 'time') return fmtHMS(value);
    if (fmt === 'clock') return fmtClock(value).replace(/ [+−]\d+$/, '');
    return trimNum(value);
  }

  /* -------------------------------------------------------- evaluation -- */

  function evaluate(doc) {
    const params = doc.params || [];
    const cols = doc.columns || [];
    const rows = (doc.rows || []).slice(0, MAX_ROWS);
    const nRows = rows.length;

    const colIdx = new Map();
    cols.forEach((c, i) => { const k = String(c.id).toLowerCase(); if (!colIdx.has(k)) colIdx.set(k, i); });
    const parIdx = new Map();
    params.forEach((p, i) => { const k = String(p.id).toLowerCase(); if (!parIdx.has(k) && !colIdx.has(k)) parIdx.set(k, i); });

    const memo = new Map();

    // One evaluated slot per cell / parameter, with cycle detection: a slot that
    // is asked for while it is still being computed is a circular reference.
    function slot(key, compute) {
      let s = memo.get(key);
      if (s) {
        if (s.busy) throw E('#CYCLE', 'Циклическая ссылка');
        if (s.err) throw s.err;
        return s.v;
      }
      s = { busy: true };
      memo.set(key, s);
      try {
        s.v = compute();
      } catch (err) {
        if (!(err instanceof CalcError)) throw err;
        s.err = err;
      } finally {
        s.busy = false;
      }
      if (s.err) throw s.err;
      return s.v;
    }

    function literal(raw, fmt) {
      if (fmt === 'text') return String(raw);
      if (typeof raw === 'number') return raw;
      const n = Number(String(raw).trim().replace(',', '.'));
      return Number.isFinite(n) ? n : String(raw);
    }

    function isFormula(raw) {
      return typeof raw === 'string' && raw.trim().startsWith('=');
    }

    function getCell(ci, ri) {
      return slot('c' + ci + ':' + ri, () => {
        const col = cols[ci];
        const raw = rows[ri] ? rows[ri][col.id] : undefined;
        if (isFormula(raw)) return ev(compile(raw), ri);
        if (!isBlank(raw)) return literal(raw, col.fmt);
        if (col.type === 'formula' && col.formula && String(col.formula).trim()) {
          return ev(compile(col.formula), ri);
        }
        return null;
      });
    }

    function getParam(pi) {
      return slot('p' + pi, () => {
        const p = params[pi];
        if (isFormula(p.value)) return ev(compile(p.value), -1);
        if (isBlank(p.value)) return null;
        return literal(p.value, p.kind === 'text' ? 'text' : 'num');
      });
    }

    function column(ci) {
      const out = [];
      for (let ri = 0; ri < nRows; ri++) out.push(getCell(ci, ri));
      return out;
    }

    const colOf = (name, node) => {
      const ci = colIdx.get(name);
      if (ci === undefined) throw E('#NAME', `Нет столбца «${node.raw || node.n}»`);
      return ci;
    };

    const rowIndex = (value, name) => {
      const n = Math.round(toNum(value));
      if (n < 1 || n > nRows) throw E('#REF', `${name}[${n}]: строки ${n} нет (всего ${nRows})`);
      return n - 1;
    };

    function ev(node, row) {
      switch (node.k) {
        case 'num': return node.v;
        case 'str': return node.v;
        case 'bool': return node.v;

        case 'name': {
          if (row >= 0 && colIdx.has(node.n)) return getCell(colIdx.get(node.n), row);
          if (parIdx.has(node.n)) return getParam(parIdx.get(node.n));
          if (colIdx.has(node.n)) {
            throw E('#REF', `«${node.raw}» — столбец; вне строки берите SUM(${node.raw}) или ${node.raw}[n]`);
          }
          throw E('#NAME', `Неизвестное имя «${node.raw}»`);
        }

        case 'scoped': {
          if (row < 0) throw E('#REF', `«${node.scope}.» работает только внутри строки`);
          const ci = colOf(node.n, node);
          let target;
          if (node.scope === 'prev') target = row - 1;
          else if (node.scope === 'next') target = row + 1;
          else if (node.scope === 'first') target = 0;
          else target = nRows - 1;
          if (target < 0) throw E('#REF', 'prev: у первой строки нет предыдущей');
          if (target >= nRows) throw E('#REF', 'next: у последней строки нет следующей');
          return getCell(ci, target);
        }

        case 'abs': {
          const ci = colOf(node.n, node);
          return getCell(ci, rowIndex(ev(node.a, row), node.n));
        }

        case 'range':
          throw E('#VALUE', 'Диапазон допустим только внутри SUM, AVG, COUNT, MIN, MAX, SUMIF, COUNTIF');

        case 'un': return -toNum(ev(node.a, row));
        case 'pct': return toNum(ev(node.a, row)) / 100;

        case 'bin': {
          const a = ev(node.a, row);
          const b = ev(node.b, row);
          switch (node.op) {
            case '+': return check(toNum(a) + toNum(b));
            case '-': return check(toNum(a) - toNum(b));
            case '*': return check(toNum(a) * toNum(b));
            case '/': {
              const d = toNum(b);
              if (d === 0) throw E('#DIV/0', 'Деление на ноль');
              return check(toNum(a) / d);
            }
            case '^': return check(toNum(a) ** toNum(b));
            case '&': return toStr(a) + toStr(b);
            default: return compare(node.op, a, b);
          }
        }

        case 'call': {
          const def = FN[node.f];
          if (!def) throw E('#NAME', `Неизвестная функция «${node.name}»`);
          const n = node.args.length;
          if (n < def.min || (def.max !== undefined && n > def.max)) {
            throw E('#ARGS', `${node.name.toUpperCase()}: неверное число аргументов`);
          }
          if (def.needsRow && row < 0) throw E('#REF', 'ROW() работает только внутри строки');
          const ctx = { ev: x => ev(x, row), vec: x => vec(x, row), row, nRows };
          if (def.lazy) return def.run(node.args, ctx);
          return def.run(node.args.map(x => ev(x, row)), ctx);
        }

        default:
          throw E('#PARSE', 'Неизвестный узел формулы');
      }
    }

    // An argument of an aggregate: a bare column name is the whole column, a
    // range is a slice, anything else is a single value.
    function vec(node, row) {
      if (node.k === 'name' && colIdx.has(node.n)) return column(colIdx.get(node.n));
      if (node.k === 'range') {
        const ci = colOf(node.n, node);
        const from = rowIndex(ev(node.a, row), node.n);
        const to = rowIndex(ev(node.b, row), node.n);
        const lo = Math.min(from, to);
        const hi = Math.max(from, to);
        const out = [];
        for (let ri = lo; ri <= hi; ri++) out.push(getCell(ci, ri));
        return out;
      }
      return [ev(node, row)];
    }

    const capture = fn => {
      try {
        return { v: fn(), e: '', msg: '' };
      } catch (err) {
        if (!(err instanceof CalcError)) throw err;
        return { v: null, e: err.code, msg: err.message };
      }
    };

    const colErrors = cols.map(c => {
      if (c.type !== 'formula' || !c.formula || !String(c.formula).trim()) return '';
      try { compile(c.formula); return ''; } catch (err) { return err.message; }
    });

    const cells = rows.map((_, ri) => cols.map((_c, ci) => capture(() => getCell(ci, ri))));
    const paramOut = params.map((_, pi) => capture(() => getParam(pi)));
    const summary = (doc.summary || []).map(s => capture(() => {
      if (!s.formula || !String(s.formula).trim()) return null;
      return ev(compile(s.formula), -1);
    }));

    return { cells, params: paramOut, summary, colErrors, issues: validateDoc(doc) };
  }

  /* -------------------------------------------------------- validation -- */

  function validateDoc(doc) {
    const issues = [];
    const seen = new Map();
    const note = (id, where) => {
      if (!ID_RE.test(String(id))) { issues.push(`${where}: имя «${id}» — только буквы, цифры и _, не с цифры`); return; }
      const low = String(id).toLowerCase();
      if (RESERVED.has(low)) { issues.push(`${where}: имя «${id}» зарезервировано`); return; }
      if (seen.has(low)) issues.push(`${where}: имя «${id}» уже занято (${seen.get(low)})`);
      else seen.set(low, where);
    };
    (doc.columns || []).forEach(c => note(c.id, `столбец «${c.label || c.id}»`));
    (doc.params || []).forEach(p => note(p.id, `параметр «${p.label || p.id}»`));
    return issues;
  }

  /* ------------------------------------------------------------ rename -- */

  // Rewrite every reference to `from` inside one formula. Function names
  // (followed by "(") are left alone.
  function rewriteRefs(text, from, to) {
    if (typeof text !== 'string') return text;
    let toks;
    try { toks = tokenize(text); } catch { return text; }
    let out = '';
    let at = 0;
    toks.forEach((tok, i) => {
      if (tok.t !== 'id' || tok.v.toLowerCase() !== from) return;
      const nx = toks[i + 1];
      if (nx && nx.t === 'op' && nx.v === '(') return;
      out += text.slice(at, tok.p) + to;
      at = tok.q;
    });
    return out + text.slice(at);
  }

  // Rename a column or parameter and follow the rename through every formula.
  function renameIdentifier(doc, fromId, toId) {
    const from = String(fromId).toLowerCase();
    const fix = v => (typeof v === 'string' && v.trim().startsWith('=') ? rewriteRefs(v, from, toId) : v);

    for (const col of doc.columns || []) {
      if (col.formula) col.formula = rewriteRefs(col.formula, from, toId);
    }
    for (const row of doc.rows || []) {
      for (const key of Object.keys(row)) row[key] = fix(row[key]);
    }
    for (const p of doc.params || []) p.value = fix(p.value);
    for (const s of doc.summary || []) if (s.formula) s.formula = rewriteRefs(s.formula, from, toId);

    // Cell values are keyed by column id — move them across.
    const col = (doc.columns || []).find(c => c.id === fromId);
    if (col) {
      for (const row of doc.rows || []) {
        if (fromId in row) { row[toId] = row[fromId]; delete row[fromId]; }
      }
    }
    const map = doc.map || {};
    for (const k of Object.keys(map)) if (map[k] === fromId) map[k] = toId;
    return doc;
  }

  /* ------------------------------------------------------ default doc -- */

  const S = (h, m, s) => h * 3600 + m * 60 + (s || 0);

  // The team's Google Sheet ("Le Mans #404 2026"), one to one: same parameters,
  // same columns, same formulas — restated in seconds.
  function defaultDoc(rowCount) {
    const n = Math.min(MAX_ROWS, Math.max(1, rowCount || 36));
    const rows = [];
    for (let i = 0; i < n; i++) rows.push({ burn: 7.4, lapTime: 203.5, incs: 0 });

    return {
      params: [
        { id: 'DT', label: 'DT (drive-through), сек', kind: 'num', value: 55 },
        { id: 'SG', label: 'Stop and go (no penalty), сек', kind: 'num', value: 2 },
        { id: 'rate', label: 'Заправка, литров в секунду', kind: 'num', value: 0.438 },
        { id: 'tank', label: 'Бак, л (−0.8 л на въезд и выезд)', kind: 'num', value: 89 },
        { id: 'startFuel', label: 'Топливо на старте, л', kind: 'num', value: 89 },
        { id: 'dayNight', label: 'Разница день/ночь, сек', kind: 'num', value: 0.6 },
        { id: 'stintCount', label: 'Число стинтов', kind: 'num', value: 35 },
        { id: 'raceLength', label: 'Длина гонки', kind: 'time', value: S(24, 0) },
        { id: 'firstStart', label: 'Старт первого стинта (время суток)', kind: 'clock', value: S(10, 20) },
        { id: 'firstGame', label: 'Игровое время на старте', kind: 'clock', value: S(16, 45) },
      ],
      columns: [
        { id: 'n', label: 'Stint №', type: 'formula', fmt: 'int', formula: 'ROW()' },
        { id: 'driver', label: 'Driver', type: 'input', fmt: 'text' },
        { id: 'start', label: 'Stint Start Time', type: 'formula', fmt: 'clock', formula: 'IF(ROW() = 1, firstStart, prev.finish + prev.pit)' },
        { id: 'finish', label: 'Stint Finish Time', type: 'formula', fmt: 'clock', formula: 'start + length' },
        { id: 'left', label: 'Race Time left', type: 'formula', fmt: 'time', formula: 'IF(ROW() = 1, raceLength, prev.left - prev.length - prev.pit)' },
        { id: 'game', label: 'In-game time', type: 'formula', fmt: 'clock', formula: 'IF(ROW() = 1, firstGame, prev.game + prev.length + prev.pit)' },
        { id: 'length', label: 'Stint length', type: 'formula', fmt: 'time', formula: 'MIN(left, TRUNC(lapTime * ROUNDDOWN(fuelLaps)))' },
        { id: 'pit', label: 'Pit-stop length', type: 'formula', fmt: 'time', formula: 'IF(refuel > 0, TRUNC(DT + SG + refuel * rate), 0)' },
        { id: 'refuel', label: 'Refuel', type: 'formula', fmt: 'num', dec: 1, formula: 'IF(ROW() = 1, tank, MIN(tank, (left - length) / lapTime * burn))' },
        { id: 'burn', label: 'Fuel Consumption, л/круг', type: 'input', fmt: 'num', dec: 2 },
        { id: 'fuelLaps', label: 'Laps on fuel', type: 'formula', fmt: 'num', dec: 3, formula: 'IF(ROW() = 1, startFuel, tank) / burn' },
        { id: 'laps', label: 'Laps', type: 'formula', fmt: 'num', dec: 2, formula: 'IF(length < TRUNC(lapTime * ROUNDDOWN(fuelLaps)), length / lapTime, fuelLaps)' },
        { id: 'lapTime', label: 'Average lap time, сек', type: 'input', fmt: 'num', dec: 1 },
        { id: 'avgPit', label: 'Average lap with pit stop, сек', type: 'formula', fmt: 'num', dec: 1, formula: 'IF(laps > 0, MAX((length + pit) / laps, lapTime), 0)' },
        { id: 'incs', label: 'Incs', type: 'input', fmt: 'num', dec: 0 },
        { id: 'comment', label: 'Comments', type: 'input', fmt: 'text' },
      ],
      rows,
      summary: [
        { id: 's1', label: 'Всего кругов (overall laps count)', formula: 'SUM(laps)', fmt: 'num', dec: 2 },
        { id: 's2', label: 'Средний стинт (average stint time)', formula: 'SUM(avgPit) / stintCount', fmt: 'num', dec: 2 },
      ],
      map: { driver: 'driver', start: 'start', duration: 'length', pit: 'pit', laps: 'laps', fuel: 'refuel', note: 'comment' },
    };
  }

  return {
    CalcError, ID_RE, MAX_ROWS, FUNCTION_DOCS,
    compile, evaluate, validateDoc, renameIdentifier,
    format, parseInput, editText, fmtHMS, fmtClock,
    defaultDoc,
  };
});
