/*
  Ежедневный снимок счётчиков скачиваний с GitHub Releases.

  GitHub хранит по каждому файлу релиза только накопительный download_count —
  без истории. Этот скрипт раз в сутки записывает текущие значения в CSV,
  чтобы было видно, сколько скачали за день / за неделю.

  Вход:  каталог с данными (ветка `stats`, см. .github/workflows/download-stats.yml)
  Env:   GH_TOKEN — токен для GitHub API (в Actions это github.token)
         REPO     — owner/name, по умолчанию AVAILOFF/TUOverlays

  Пишет в каталог:
    downloads.csv — date,tag,asset,downloads; одна строка на файл релиза в день.
                    Повторный запуск в тот же день (UTC) заменяет строки этого дня.
    README.md     — сводка по версиям: всего, за сутки, за 7 дней.

  Локально, ничего не коммитя:
    GH_TOKEN=$(gh auth token) node scripts/download-stats.mjs ./tmp-stats
*/

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('Укажите каталог с данными: node scripts/download-stats.mjs <dir>');
  process.exit(1);
}

const REPO = process.env.REPO || 'AVAILOFF/TUOverlays';
const TOKEN = process.env.GH_TOKEN || '';
const CSV = join(dir, 'downloads.csv');
const README = join(dir, 'README.md');
const HEADER = 'date,tag,asset,downloads';
const DAY_MS = 24 * 60 * 60 * 1000;

const fetchReleases = async () => {
  const releases = [];
  let url = `https://api.github.com/repos/${REPO}/releases?per_page=100`;
  while (url) {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    releases.push(...(await res.json()));
    url = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') || '')?.[1];
  }
  // Черновики видны только с токеном и на сайте их нет — не считаем.
  return releases.filter(r => !r.draft);
};

// Имена файлов на GitHub могут содержать запятые, поэтому минимальный
// CSV с кавычками, а не split(',').
const csvCell = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

const parseCsvLine = line => {
  const cells = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { cells.push(cur); cur = ''; }
    else cur += ch;
  }
  cells.push(cur);
  return cells;
};

const readRows = async () => {
  let text;
  try {
    text = await readFile(CSV, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return text
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map(line => {
      const [date, tag, asset, downloads] = parseCsvLine(line);
      return { date, tag, asset, downloads: Number(downloads) };
    });
};

const releases = await fetchReleases();
const today = new Date().toISOString().slice(0, 10);

const todayRows = releases.flatMap(r =>
  r.assets.map(a => ({ date: today, tag: r.tag_name, asset: a.name, downloads: a.download_count })),
);

const rows = [...(await readRows()).filter(r => r.date !== today), ...todayRows];

await mkdir(dir, { recursive: true });
await writeFile(
  CSV,
  [HEADER, ...rows.map(r => [r.date, r.tag, r.asset, r.downloads].map(csvCell).join(','))].join('\n') + '\n',
);

// ── Сводка ───────────────────────────────────────────────────────────────────

// date → tag → сумма по всем файлам релиза
const totals = new Map();
for (const r of rows) {
  if (!totals.has(r.date)) totals.set(r.date, new Map());
  const byTag = totals.get(r.date);
  byTag.set(r.tag, (byTag.get(r.tag) || 0) + r.downloads);
}
const dates = [...totals.keys()].sort();

const shiftDate = (date, days) => new Date(Date.parse(date) - days * DAY_MS).toISOString().slice(0, 10);
// Последний снимок не позже чем `days` дней назад. Если в какой-то день
// workflow не отработал, берём ближайший более ранний — дельта будет
// чуть больше периода, но не потеряется.
const snapshotBefore = days => {
  const limit = shiftDate(today, days);
  return dates.filter(d => d <= limit).at(-1);
};

const sumTag = (date, tag) => totals.get(date)?.get(tag) ?? 0;
const sumAll = date => [...(totals.get(date)?.values() ?? [])].reduce((a, b) => a + b, 0);
// Минус возможен, если релиз или файл удалили: его счётчик пропадает целиком.
const signed = n => (n >= 0 ? `+${n}` : String(n));
const delta = (ref, now, before) => (ref ? signed(now - before) : '—');

const dayRef = snapshotBefore(1);
const weekRef = snapshotBefore(7);

const sumAssets = (r, re) => r.assets.filter(a => re.test(a.name)).reduce((s, a) => s + a.download_count, 0);

const byPublished = [...releases].sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));

const releaseLines = byPublished.map(r => {
  const total = sumTag(today, r.tag_name);
  return [
    r.tag_name,
    (r.published_at || '').slice(0, 10),
    total,
    sumAssets(r, /\.exe$/i),
    sumAssets(r, /\.zip$/i),
    delta(dayRef, total, sumTag(dayRef, r.tag_name)),
    delta(weekRef, total, sumTag(weekRef, r.tag_name)),
  ];
});

const grand = sumAll(today);

const dailyLines = dates
  .map((d, i) => [d, sumAll(d), i > 0 ? signed(sumAll(d) - sumAll(dates[i - 1])) : '—'])
  .slice(-30)
  .reverse();

const table = (head, lines) =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...lines.map(l => `| ${l.join(' | ')} |`)].join('\n');

const readme = `# Скачивания TU Overlays

Снимок от **${today}** (UTC). Обновляется раз в сутки workflow \`download-stats.yml\` из ветки \`main\`.

Всего скачиваний: **${grand}**${dayRef ? ` · за сутки: **${signed(grand - sumAll(dayRef))}**` : ''}${weekRef ? ` · за 7 дней: **${signed(grand - sumAll(weekRef))}**` : ''}

Считаются только файлы, приложенные к релизу (Setup .exe и portable .zip). Архивы «Source code» GitHub не считает.
Это число скачиваний, а не уникальных людей: повторные загрузки и обновления через приложение тоже входят.

## По версиям

${table(['Версия', 'Опубликован', 'Всего', 'Setup', 'Portable', 'За сутки', 'За 7 дней'], releaseLines)}

## По дням (последние 30 снимков)

${table(['Дата', 'Всего', 'За день'], dailyLines)}

Сырые данные: [downloads.csv](downloads.csv) — date, tag, asset, downloads.
`;

await writeFile(README, readme);

console.log(`${today}: ${releases.length} релизов, ${todayRows.length} файлов, всего ${grand} скачиваний.`);
