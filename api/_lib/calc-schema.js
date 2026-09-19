/*
  Shape of a calculator document, and the normalisation every save goes through.

  Same rule as schema.js: whatever the client sends is rebuilt field by field.
  Unknown keys are dropped, strings clamped, numbers bounded, so a hostile or
  malformed payload cannot grow the document or smuggle anything into it.

  The server never evaluates a formula — formulas are opaque strings here, run
  by js/tu-calc-engine.js in the browser. What is checked is only what would
  corrupt the document: identifier syntax, uniqueness, sizes.
*/

const str = (value, max) => (typeof value === 'string' ? value : '').trim().slice(0, max);

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

const ID_RE = /^[A-Za-z_Ѐ-ӿ][A-Za-z0-9_Ѐ-ӿ]*$/;
const RESERVED = new Set(['true', 'false', 'prev', 'next', 'first', 'last']);

export const CALC_LIMITS = { params: 40, columns: 40, rows: 300, summary: 30, formula: 1000, cell: 1000, bytes: 400000 };

const FMTS = ['text', 'num', 'int', 'time', 'clock'];
const KINDS = ['num', 'time', 'clock', 'text'];
const MAP_KEYS = ['driver', 'start', 'duration', 'pit', 'laps', 'fuel', 'note'];

const finite = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e12;

function ident(value, where, seen) {
  const id = str(value, 32);
  if (!ID_RE.test(id)) throw new Error(`${where}: имя «${id}» — только буквы, цифры и _, не с цифры`);
  const low = id.toLowerCase();
  if (RESERVED.has(low)) throw new Error(`${where}: имя «${id}» зарезервировано`);
  if (seen.has(low)) throw new Error(`${where}: имя «${id}» уже занято`);
  seen.add(low);
  return id;
}

// A stored cell / parameter value: a finite number, or text (which may be a
// formula starting with "="). Anything else is dropped.
function scalar(value, max) {
  if (finite(value)) return value;
  if (typeof value === 'string') {
    const s = value.trim().slice(0, max);
    return s === '' ? undefined : s;
  }
  return undefined;
}

export function normalizeCalc(input) {
  const src = input && typeof input === 'object' ? input : {};
  const seen = new Set();

  const columns = (Array.isArray(src.columns) ? src.columns : [])
    .slice(0, CALC_LIMITS.columns)
    .map(raw => {
      const id = ident(raw && raw.id, 'Столбец', seen);
      const dec = Number(raw && raw.dec);
      const col = {
        id,
        label: str(raw && raw.label, 60) || id,
        type: pick(raw && raw.type, ['input', 'formula'], 'input'),
        fmt: pick(raw && raw.fmt, FMTS, 'text'),
      };
      if (Number.isInteger(dec) && dec >= 0 && dec <= 6) col.dec = dec;
      const formula = str(raw && raw.formula, CALC_LIMITS.formula);
      if (formula) col.formula = formula;
      return col;
    });

  const params = (Array.isArray(src.params) ? src.params : [])
    .slice(0, CALC_LIMITS.params)
    .map(raw => {
      const id = ident(raw && raw.id, 'Параметр', seen);
      const p = {
        id,
        label: str(raw && raw.label, 80) || id,
        kind: pick(raw && raw.kind, KINDS, 'num'),
      };
      const value = scalar(raw && raw.value, CALC_LIMITS.formula);
      if (value !== undefined) p.value = value;
      return p;
    });

  const known = new Set(columns.map(c => c.id));
  const rows = (Array.isArray(src.rows) ? src.rows : [])
    .slice(0, CALC_LIMITS.rows)
    .map(raw => {
      const row = {};
      if (raw && typeof raw === 'object') {
        for (const id of known) {
          const v = scalar(raw[id], CALC_LIMITS.cell);
          if (v !== undefined) row[id] = v;
        }
      }
      return row;
    });

  const summarySeen = new Set();
  const summary = (Array.isArray(src.summary) ? src.summary : [])
    .slice(0, CALC_LIMITS.summary)
    .map((raw, i) => {
      let id = str(raw && raw.id, 32) || 's' + (i + 1);
      if (summarySeen.has(id)) id = id + '_' + i;
      summarySeen.add(id);
      const dec = Number(raw && raw.dec);
      const item = {
        id,
        label: str(raw && raw.label, 80),
        formula: str(raw && raw.formula, CALC_LIMITS.formula),
        fmt: pick(raw && raw.fmt, FMTS, 'num'),
      };
      if (Number.isInteger(dec) && dec >= 0 && dec <= 6) item.dec = dec;
      return item;
    });

  const map = {};
  const rawMap = src.map && typeof src.map === 'object' ? src.map : {};
  for (const key of MAP_KEYS) if (known.has(rawMap[key])) map[key] = rawMap[key];

  const doc = { params, columns, rows, summary, map };
  if (JSON.stringify(doc).length > CALC_LIMITS.bytes) throw new Error('Калькулятор слишком большой');
  return doc;
}
