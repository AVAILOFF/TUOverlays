/*
  Shape of a stint board, and the normalisation every write goes through.

  Everything the client sends is rebuilt field by field here: unknown keys are
  dropped, strings clamped, numbers coerced and bounded. The endpoints never
  store a client object as-is, so a malformed or hostile payload can't grow the
  document or smuggle fields (an `access` section, say) into it.

  Field names follow the Endurance bundle already on the site — driverId,
  startOffsetSec, plannedDurationSec, pitStopDurationSec — so a plan exported
  from the cabinet can be pasted in later without a converter.
*/

const str = (value, max) => (typeof value === 'string' ? value : '').trim().slice(0, max);

const num = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

const color = (value, fallback) => {
  const v = str(value, 9);
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : fallback;
};

// Same-origin or https URLs, or a raster image the panel embedded itself as a
// data URI (uploaded-from-device logos). No SVG data URIs and no javascript:
// — nothing that could execute.
const LOGO_DATA_MAX = 260000;
const isLogoDataUrl = v => /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(v);

const imageUrl = value => {
  const v = (typeof value === 'string' ? value : '').trim();
  if (!v) return '';
  if (v.startsWith('data:')) return isLogoDataUrl(v) && v.length <= LOGO_DATA_MAX ? v : '';
  const httpUrl = v.slice(0, 500);
  return /^(https:\/\/|\/)[^\s'"<>]+$/i.test(httpUrl) ? httpUrl : '';
};

const isoDate = value => {
  const v = str(value, 40);
  if (!v) return '';
  const t = Date.parse(v);
  return Number.isNaN(t) ? '' : new Date(t).toISOString();
};

export const LIMITS = { drivers: 40, stints: 250, keys: 40, boards: 60 };

export const COLUMN_KEYS = [
  'index', 'driver', 'start', 'duration', 'finish',
  'laps', 'fuel', 'tyres', 'pit', 'note',
];

const DEFAULT_COLUMNS = ['index', 'driver', 'start', 'duration', 'finish', 'laps', 'fuel', 'tyres', 'note'];

export const STINT_STATUSES = ['planned', 'running', 'done'];

export function defaultView() {
  return {
    lang: 'ru',
    theme: 'dark',
    customBg: '#02102c',
    customText: '#e4ecfb',
    accent: '#ff0066',
    dataColor: '#3fd8e0',
    goodColor: '#35e08d',
    warnColor: '#ffb02e',
    currentGlow: false,
    density: 'normal',
    fontScale: 100,
    maxWidth: 1100,
    subtitle: '',
    logoUrl: '',
    showMeta: true,
    showSummary: true,
    titleAlign: 'left',
    radius: 'soft',
    showBreakNumber: true,
    timeMode: 'both',
    clock24: true,
    tz: '',
    columns: COLUMN_KEYS.map(key => ({
      key,
      label: '',
      visible: DEFAULT_COLUMNS.includes(key),
    })),
    highlightCurrent: true,
    highlightNext: false,
    finishedStyle: 'dim',
    driverColors: true,
    groupBy: 'none',
    stripedRows: false,
    numbersAlign: 'left',
    tableBorders: 'row',
    mobileCards: true,
    showRaceProgress: false,
    showPitState: true,
    pitWarningSec: 0,
    refreshSec: 30,
    showUpdated: true,
    footerNote: '',
    emptyText: '',
  };
}

export function normalizeView(input) {
  const src = input && typeof input === 'object' ? input : {};
  const base = defaultView();

  // Columns: keep the client's order, drop anything unknown, then append what
  // the client omitted — so a column added here later can't silently vanish
  // from a board saved by an older page.
  const seen = new Set();
  const columns = [];
  if (Array.isArray(src.columns)) {
    for (const raw of src.columns.slice(0, COLUMN_KEYS.length * 2)) {
      const key = str(raw && raw.key, 20);
      if (!COLUMN_KEYS.includes(key) || seen.has(key)) continue;
      seen.add(key);
      columns.push({ key, label: str(raw && raw.label, 24), visible: bool(raw && raw.visible, true) });
    }
  }
  for (const col of base.columns) {
    if (!seen.has(col.key)) columns.push(col);
  }

  return {
    lang: pick(src.lang, ['ru', 'en'], base.lang),
    theme: pick(src.theme, ['dark', 'light', 'contrast', 'carbon', 'paper', 'custom'], base.theme),
    customBg: color(src.customBg, base.customBg),
    customText: color(src.customText, base.customText),
    accent: color(src.accent, base.accent),
    dataColor: color(src.dataColor, base.dataColor),
    goodColor: color(src.goodColor, base.goodColor),
    warnColor: color(src.warnColor, base.warnColor),
    currentGlow: bool(src.currentGlow, base.currentGlow),
    density: pick(src.density, ['compact', 'normal', 'roomy'], base.density),
    fontScale: num(src.fontScale, 80, 140, base.fontScale),
    maxWidth: num(src.maxWidth, 720, 1600, base.maxWidth),
    subtitle: str(src.subtitle, 120),
    logoUrl: imageUrl(src.logoUrl),
    showMeta: bool(src.showMeta, base.showMeta),
    showSummary: bool(src.showSummary, base.showSummary),
    titleAlign: pick(src.titleAlign, ['left', 'center'], base.titleAlign),
    radius: pick(src.radius, ['sharp', 'soft', 'round'], base.radius),
    showBreakNumber: bool(src.showBreakNumber, base.showBreakNumber),
    timeMode: pick(src.timeMode, ['race', 'local', 'both'], base.timeMode),
    clock24: bool(src.clock24, base.clock24),
    tz: str(src.tz, 60),
    columns,
    highlightCurrent: bool(src.highlightCurrent, base.highlightCurrent),
    highlightNext: bool(src.highlightNext, base.highlightNext),
    finishedStyle: pick(src.finishedStyle, ['dim', 'normal', 'hide'], base.finishedStyle),
    driverColors: bool(src.driverColors, base.driverColors),
    groupBy: pick(src.groupBy, ['none', 'driver'], base.groupBy),
    stripedRows: bool(src.stripedRows, base.stripedRows),
    numbersAlign: pick(src.numbersAlign, ['left', 'right'], base.numbersAlign),
    tableBorders: pick(src.tableBorders, ['row', 'grid', 'none'], base.tableBorders),
    mobileCards: bool(src.mobileCards, base.mobileCards),
    showRaceProgress: bool(src.showRaceProgress, base.showRaceProgress),
    showPitState: bool(src.showPitState, base.showPitState),
    pitWarningSec: num(src.pitWarningSec, 0, 1800, base.pitWarningSec),
    refreshSec: Number(src.refreshSec) === 0 ? 0 : num(src.refreshSec, 10, 600, base.refreshSec),
    showUpdated: bool(src.showUpdated, base.showUpdated),
    footerNote: str(src.footerNote, 200),
    emptyText: str(src.emptyText, 80),
  };
}

export function normalizeMeta(input) {
  const src = input && typeof input === 'object' ? input : {};
  return {
    track: str(src.track, 80),
    car: str(src.car, 60),
    raceStartIso: isoDate(src.raceStartIso),
    tz: str(src.tz, 60),
    note: str(src.note, 200),
  };
}

export function normalizeData(input, makeId) {
  const src = input && typeof input === 'object' ? input : {};

  const drivers = (Array.isArray(src.drivers) ? src.drivers : [])
    .slice(0, LIMITS.drivers)
    .map(raw => ({
      driverId: str(raw && raw.driverId, 24) || makeId(),
      name: str(raw && raw.name, 60),
      color: color(raw && raw.color, ''),
    }))
    .filter(d => d.name);

  const known = new Set(drivers.map(d => d.driverId));

  const stints = (Array.isArray(src.stints) ? src.stints : [])
    .slice(0, LIMITS.stints)
    .map(raw => {
      const driverId = str(raw && raw.driverId, 24);
      return {
        id: str(raw && raw.id, 24) || makeId(),
        driverId: known.has(driverId) ? driverId : '',
        startOffsetSec: num(raw && raw.startOffsetSec, 0, 60 * 60 * 48, 0),
        plannedDurationSec: num(raw && raw.plannedDurationSec, 0, 60 * 60 * 12, 0),
        pitStopDurationSec: num(raw && raw.pitStopDurationSec, 0, 60 * 60, 0),
        laps: num(raw && raw.laps, 0, 2000, 0),
        fuelL: num(raw && raw.fuelL, 0, 500, 0),
        tyres: str(raw && raw.tyres, 40),
        status: pick(raw && raw.status, STINT_STATUSES, 'planned'),
        note: str(raw && raw.note, 300),
      };
    });

  return { drivers, stints };
}

export const normalizeTitle = value => str(value, 90) || 'Без названия';

export const normalizeLabel = value => str(value, 40) || 'Без имени';

// What a viewer is allowed to see: everything except the key material.
export function publicBoard(board) {
  return {
    id: board.id,
    title: board.title,
    meta: board.meta,
    data: board.data,
    view: board.view,
    rev: board.rev,
    updatedAt: board.updatedAt,
  };
}
