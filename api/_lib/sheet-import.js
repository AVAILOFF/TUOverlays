/*
  Turning a Google Sheets stint log into board data.

  We never fetch the URL the caller pasted — only the sheet id we can pull out
  of it, glued into a CSV export URL we build ourselves. That way the target
  host is always docs.google.com, whatever the pasted text actually contains.

  Column names vary sheet to sheet (English headers, Russian headers, extra
  analysis columns nobody asked to import), so headers are matched loosely by
  alias rather than by position.
*/

const ID_RE = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/;
const BARE_ID_RE = /^[a-zA-Z0-9_-]{20,60}$/;

export function extractSheetId(input) {
  const raw = String(input || '').trim();
  const match = ID_RE.exec(raw);
  if (match) return match[1];
  return BARE_ID_RE.test(raw) ? raw : '';
}

export function extractGid(input) {
  const raw = String(input || '');
  const all = [...raw.matchAll(/[?#&]gid=(\d+)/g)];
  return all.length ? all[all.length - 1][1] : '0';
}

export function exportUrl(id, gid) {
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${encodeURIComponent(gid)}`;
}

// Minimal RFC4180 parser: quoted fields, "" escapes, commas/newlines inside quotes.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  row.push(field);
  rows.push(row);

  return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

const HEADER_ALIASES = {
  driver: ['driver', 'пилот', 'гонщик', 'driver name'],
  duration: ['stint length', 'stint duration', 'duration', 'длительность', 'длительность стинта'],
  pit: ['pit-stop length', 'pit stop length', 'pitstop length', 'pit length', 'пит-стоп', 'пит стоп', 'pit'],
  laps: ['laps', 'круги', 'круг'],
  fuel: ['refuel', 'дозаправка', 'топливо'],
  tyres: ['tyres', 'tires', 'шины', 'резина'],
  note: ['comments', 'comment', 'notes', 'note', 'заметка', 'примечание'],
};

// Derived/analysis columns that must never be picked up even when they
// contain a substring like "pit" or "fuel" (e.g. "Avg lap with pit stop").
const isDerived = h => /avg|average|avarage|consum|incs?\b/i.test(h);

const normHeader = h => String(h || '')
  .replace(/\([^)]*\)/g, '')
  .replace(/[№#]/g, '')
  .trim()
  .toLowerCase()
  .replace(/\s+/g, ' ');

function matchColumns(headers) {
  const norm = headers.map(normHeader);
  const map = {};
  const used = new Set();

  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    let found = -1;
    norm.forEach((h, i) => {
      if (found !== -1 || used.has(i) || isDerived(h)) return;
      if (aliases.includes(h)) found = i;
    });
    if (found === -1) {
      norm.forEach((h, i) => {
        if (found !== -1 || used.has(i) || isDerived(h)) return;
        if (aliases.some(a => h.includes(a))) found = i;
      });
    }
    if (found !== -1) { map[key] = found; used.add(found); }
  }
  return map;
}

// "0:40:42" / "40:42" -> seconds. A bare number is minutes.
function parseDur(text) {
  const raw = String(text || '').trim().replace(/^\+/, '');
  if (!raw) return 0;
  if (!raw.includes(':')) {
    const n = Number(raw.replace(',', '.'));
    return Number.isFinite(n) ? Math.round(n * 60) : 0;
  }
  const parts = raw.split(':').map(p => Number(p) || 0);
  while (parts.length < 3) parts.unshift(0);
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

const parseNum = text => {
  const n = Number(String(text || '').trim().replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

const PALETTE = ['#ff0066', '#3fd8e0', '#8b7dff', '#ffb02e', '#35e08d', '#ff5f96'];

/*
  rows: full CSV grid, header row first.
  Returns { drivers, stints } in the raw shape schema.normalizeData() expects,
  chained the same way the panel's "Пересчитать старты подряд" button does —
  wall-clock start times in the sheet are for humans, not for the offsets we
  store, and they don't survive a midnight rollover cleanly.
*/
export function sheetToBoardData(rows, makeId) {
  if (!rows.length) return { drivers: [], stints: [], warnings: ['Таблица пустая'] };

  const [headerRow, ...body] = rows;
  const cols = matchColumns(headerRow);
  const warnings = [];
  if (cols.driver === undefined) warnings.push('Не нашли колонку с именем пилота — все стинты будут без пилота.');
  if (cols.duration === undefined) warnings.push('Не нашли колонку длительности стинта — она заполнится нулями.');

  const driverIds = new Map();
  const drivers = [];
  const driverIdFor = name => {
    if (!name) return '';
    if (!driverIds.has(name)) {
      const id = makeId();
      driverIds.set(name, id);
      drivers.push({ driverId: id, name, color: PALETTE[drivers.length % PALETTE.length] });
    }
    return driverIds.get(name);
  };

  let cursor = 0;
  const stints = [];
  for (const raw of body) {
    const name = cols.driver !== undefined ? String(raw[cols.driver] || '').trim() : '';
    const duration = cols.duration !== undefined ? parseDur(raw[cols.duration]) : 0;
    const pit = cols.pit !== undefined ? parseDur(raw[cols.pit]) : 0;

    // A trailing "time left after the finish" row some sheets add has no
    // driver and no length — skip it rather than importing an empty stint.
    if (!name && !duration && !pit) continue;

    stints.push({
      id: makeId(),
      driverId: driverIdFor(name),
      startOffsetSec: cursor,
      plannedDurationSec: duration,
      pitStopDurationSec: pit,
      laps: cols.laps !== undefined ? Math.round(parseNum(raw[cols.laps])) : 0,
      fuelL: cols.fuel !== undefined ? parseNum(raw[cols.fuel]) : 0,
      tyres: cols.tyres !== undefined ? String(raw[cols.tyres] || '').trim() : '',
      status: 'planned',
      note: cols.note !== undefined ? String(raw[cols.note] || '').trim() : '',
    });
    cursor += duration + pit;
  }

  if (!stints.length) warnings.push('В таблице не нашлось ни одной строки со стинтом.');

  return { drivers, stints, warnings };
}
