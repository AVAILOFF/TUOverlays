/*
  Generates widgets.html (RU) and en/widgets.html (EN) for the TU Overlays site.
  Names and one-line copy are lifted from the site's own FAQ item 09 so the two
  stay in one voice; Russian widget names match the app's own ru locale where it
  ships one.

  Both pages are plain static HTML in the repo, like every other page — this
  script just keeps the two languages from drifting apart when the widget list
  changes. Edit WIDGETS/CATS below, re-run it, commit the regenerated pages.
  It is dev-only tooling and is not part of the deploy (see .vercelignore).

  Run:  node scripts/gen-widgets.mjs
*/
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..');

const CATS = [
  { id: 'race',     ru: 'Позиции и темп', en: 'Positions &amp; pace' },
  { id: 'safety',   ru: 'Трафик',         en: 'Traffic' },
  { id: 'strategy', ru: 'Стратегия',      en: 'Strategy' },
  { id: 'car',      ru: 'Телеметрия',     en: 'Telemetry' },
  { id: 'track',    ru: 'Трасса',         en: 'Track' },
  { id: 'weather',  ru: 'Погода',         en: 'Weather' },
  { id: 'stream',   ru: 'Стрим',          en: 'Stream' },
];

const S = (file, w, h) => ({ file, w, h });

const WIDGETS = [
  { en: 'Standings', ru: 'Турнирная таблица', cat: 'race', shot: S('standings.png', 845, 418),
    dru: 'Позиции, отрывы, лучшие круги, пит-стопы и классы.',
    den: 'Positions, gaps, best laps, pit status and classes.' },
  { en: 'Standings (Compact)', ru: 'Турнирная таблица (компакт)', cat: 'race',
    dru: 'Компактная таблица позиций для тесных раскладок.',
    den: 'A compact standings table for tight layouts.' },
  { en: 'Relative', ru: 'Относительные позиции', cat: 'race', shot: S('relative.png', 584, 307),
    dru: 'Машины вокруг вас и интервалы до них в реальном времени.',
    den: 'The cars around you and live intervals to them.' },
  { en: 'Track Map', ru: 'Карта трассы', cat: 'track', shot: S('track-map.png', 480, 320),
    dru: 'Карта трассы с позициями всех участников.',
    den: 'A track map with every driver&#8217;s live position.' },
  { en: 'Flat Track Map', ru: 'Плоская карта трассы', cat: 'track', shot: S('flat-track-map.png', 852, 74),
    dru: 'Компактная горизонтальная версия карты.',
    den: 'A compact, horizontal version of the map.' },
  { en: 'Weather', ru: 'Погода', cat: 'weather', shot: S('weather.png', 232, 295),
    dru: 'Температура трассы и воздуха, влажность и состояние покрытия.',
    den: 'Track and air temperature, humidity and track state.' },
  { en: 'Weather Forecast', ru: 'Прогноз погоды', cat: 'weather', shot: S('weather-forecast.png', 640, 125),
    dru: 'Прогноз погоды на ближайшее время сессии.',
    den: 'A weather forecast for the rest of the session.' },
  { en: 'Wind', ru: 'Ветер', cat: 'weather', shot: S('wind.png', 397, 389),
    dru: 'Направление и сила ветра.',
    den: 'Wind direction and speed.' },
  { en: 'Faster Cars From Behind', ru: 'Быстрые машины сзади', cat: 'safety', shot: S('faster-cars-from-behind.png', 621, 163),
    dru: 'Предупреждение о более быстрых машинах сзади.',
    den: 'A warning about faster cars closing in from behind.' },
  { en: 'Fuel Calculator', ru: 'Калькулятор топлива', cat: 'strategy', shot: S('fuel-calculator.png', 423, 234),
    dru: 'Расход топлива, остаток, запас и расчёт пит-стопа.',
    den: 'Consumption, fuel remaining, reserve and pit-stop timing.' },
  { en: 'Blind Spot Monitor', ru: 'Контроль слепых зон', cat: 'safety', shot: S('blind-spot-monitor.png', 842, 526),
    dru: 'Машины в мёртвой зоне слева и справа.',
    den: 'Cars in your left or right blind spot.' },
  { en: 'Radar', ru: 'Радар', cat: 'safety', shot: S('radar.png', 656, 611),
    dru: 'Ближний радар машин вокруг вас с их положением по полосам.',
    den: 'A close-range radar of the cars around you and their lanes.' },
  { en: 'Garage Cover', ru: 'Заставка гаража', cat: 'stream',
    dru: 'Заглушка экрана во время нахождения в гараже.',
    den: 'A screen cover while you&#8217;re in the garage.' },
  { en: 'Rejoin Indicator', ru: 'Индикатор возврата на трассу', cat: 'safety', shot: S('rejoin-indicator.png', 852, 110),
    dru: 'Помощь при безопасном возвращении на трассу.',
    den: 'Help rejoining the track safely.' },
  { en: 'Pitlane Helper', ru: 'Помощник на пит-лейн', cat: 'strategy', shot: S('pitlane-helper.png', 354, 292),
    dru: 'Скорость, позиция бокса и подсказки на пит-лейне.',
    den: 'Speed, pitbox position and hints on pit entry.' },
  { en: 'Tachometer', ru: 'Тахометр', cat: 'car', shot: S('tachometer.png', 710, 159),
    dru: 'Обороты, точки переключения и температуры двигателя.',
    den: 'RPM, shift points and engine temperatures.' },
  { en: 'ABS', ru: 'ABS', cat: 'car', shot: S('abs-icon.svg', 150, 105),
    dru: 'Индикатор срабатывания ABS.',
    den: 'An ABS activation indicator.' },
  { en: 'Flag', ru: 'Флаги', cat: 'race', shot: S('flag.png', 274, 277),
    dru: 'Текущий флаг сессии.',
    den: 'The session&#8217;s current flag.' },
  { en: 'Twitch Chat', ru: 'Чат Twitch', cat: 'stream',
    dru: 'Чат Twitch прямо поверх симулятора.',
    den: 'A Twitch chat right on top of the simulator.' },
  { en: 'Lap Timer', ru: 'Журнал кругов', cat: 'race', shot: S('lap-timer.png', 294, 131),
    dru: 'Текущий, лучший и предыдущий круги.',
    den: 'Current, best and previous laps.' },
  { en: 'Information Bar', ru: 'Информационная панель', cat: 'race', shot: S('information-bar.png', 890, 67),
    dru: 'Флаг, номер круга и время сессии.',
    den: 'Flag, lap number and session time.' },
  { en: 'Slow Car Ahead', ru: 'Медленная машина впереди', cat: 'safety', shot: S('slow-car-ahead.png', 469, 51),
    dru: 'Предупреждение о медленной машине впереди.',
    den: 'A warning about a slower car ahead.' },
  { en: 'Sector Delta', ru: 'Дельта по секторам', cat: 'race', shot: S('sector-delta.png', 456, 55),
    dru: 'Дельта по каждому сектору.',
    den: 'The delta for each sector.' },
  { en: 'Heart Rate', ru: 'Пульс', cat: 'stream',
    dru: 'Пульс в реальном времени через HypeRate.',
    den: 'Your live heart rate via HypeRate.' },
  { en: 'Corner Names', ru: 'Названия поворотов', cat: 'track', shot: S('corner-names.png', 95, 20),
    dru: 'Текущий поворот или секция трассы.',
    den: 'The current corner or track section.' },
  { en: 'Input Traces', ru: 'Педали и руль', cat: 'car', shot: S('inputs.png', 453, 102),
    dru: 'Газ, тормоз, сцепление, руль, передача и скорость.',
    den: 'Throttle, brake, clutch, steering, gear and speed.' },
  { en: 'Cornering Speed', ru: 'Скорость в повороте', cat: 'track', shot: S('cornering-speed.png', 304, 114),
    dru: 'Максимальная и минимальная скорость в повороте против вашего лучшего прохода за сессию.',
    den: 'Max and apex speed through the corner against your best pass this session.' },
  { en: 'Data Block', ru: 'Блок данных', cat: 'car', shot: S('data-block.png', 203, 63),
    dru: 'Одно значение телеметрии на выбор; дублируется в целый ряд показателей.',
    den: 'A single telemetry value of your choice; duplicate it into a row of readouts.' },
  { en: 'Delta Bar', ru: 'Полоса дельты', cat: 'race',
    dru: 'Живая дельта к лучшему кругу сессии полосой и числом.',
    den: 'A live delta to the session&#8217;s best lap, as a bar and a signed number.' },
  { en: 'Damage Indicator', ru: 'Индикатор повреждений', cat: 'strategy',
    dru: 'Сигнал о повреждениях и обязательном заезде на ремонт.',
    den: 'A damage and mandatory-repair alert.' },
  { en: 'Tires', ru: 'Шины', cat: 'car', shot: S('tires.png', 301, 188),
    dru: 'Температура шин по зонам, износ протектора и холодное давление.',
    den: 'Tire temperature by zone, tread wear and cold pressure.' },
  { en: 'G-Force', ru: 'Перегрузки', cat: 'car', shot: S('g-force.png', 417, 444),
    dru: 'Круг сцепления: продольные и поперечные перегрузки со следом и пиками.',
    den: 'A traction circle with lateral and longitudinal load, its trail and peaks.' },
  { en: 'Undercut / Overcut', ru: 'Андеркат / оверкат', cat: 'strategy', shot: S('undercut-overcut.png', 380, 153),
    dru: 'Что выгоднее: заехать на пит сейчас или остаться на трассе.',
    den: 'Whether pitting now beats staying out.' },
  { en: 'Balance Meter', ru: 'Баланс машины', cat: 'car',
    dru: 'Недостаточная или избыточная поворачиваемость в реальном времени.',
    den: 'Live understeer or oversteer.' },
  { en: 'Setup Deck', ru: 'Панель настроек', cat: 'car',
    dru: 'Текущие положения регулировок из кокпита с подсветкой изменений.',
    den: 'Live in-car adjustment positions, highlighted on every change.' },
  { en: 'Brake Pressure', ru: 'Давление в тормозах', cat: 'car',
    dru: 'Давление в тормозных контурах по колёсам и фактический баланс перед/зад.',
    den: 'Per-wheel brake circuit pressure and the real front/rear balance.' },
  { en: 'Traffic Ahead', ru: 'Трафик впереди', cat: 'safety',
    dru: 'Машины, которые вы вот-вот догоните, со скоростью сближения.',
    den: 'Cars you are about to catch, with closing speed.' },
  { en: 'Track Wetness', ru: 'Влажность трассы', cat: 'weather',
    dru: 'Влажность покрытия по шкале iRacing, её тренд и выбор резины.',
    den: 'Surface wetness on iRacing&#8217;s scale, its trend and the tyre call.' },
];

// Display order: everything that has a preview leads, keeping its own relative
// order, then the rest. The cards are top-aligned in the grid, so a preview
// card scattered mid-list would leave a ragged hole beside every short card in
// its row. Delete this sort to fall back to the app's own order.
WIDGETS.sort((a, b) => (b.shot ? 1 : 0) - (a.shot ? 1 : 0));

const TOTAL = WIDGETS.length;
const SHOTS = WIDGETS.filter((w) => w.shot).length;
const pad = (n) => String(n).padStart(2, '0');
const strip = (s) => s.replace(/&#8217;/g, "'").replace(/&amp;/g, '&');
// strip() gives the plain-text form; attr() puts it back into an attribute
const attr = (s) => strip(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// ── copy ────────────────────────────────────────────────────────────────────
const T = {
  ru: {
    lang: 'ru',
    title: `Все виджеты TU Overlays — каталог из ${TOTAL} оверлеев для iRacing`,
    desc: `Полный каталог виджетов TU Overlays: ${TOTAL} независимых оверлеев для iRacing — таблица, relative, карта трассы, топливо, телеметрия, погода и стрим-виджеты.`,
    canonical: 'https://tuoverlays.xyz/widgets',
    imgBase: 'img/',
    home: 'index.html', dl: 'download.html', chg: 'changelog.html', sup: 'support.html',
    altHref: 'en/widgets.html',
    homeAria: 'TU Overlays — на главную',
    langAria: 'Язык', back: 'На главную',
    eyebrow: 'Каталог',
    h1a: 'Все ', h1b: 'виджеты',
    lead: `Каждый виджет — отдельное окно: включается, перемещается, масштабируется и настраивается само по себе. Здесь весь список — ${TOTAL} штук, с коротким описанием и фильтром по назначению.`,
    statTotal: 'Виджетов', statCats: 'Групп', statShots: 'Со скриншотом',
    toolbarAria: 'Фильтр каталога',
    searchLabel: 'Поиск по виджетам',
    searchPh: 'Поиск: топливо, radar…',
    clear: 'Очистить поиск',
    all: 'Все',
    countAria: 'Найдено виджетов',
    of: 'из',
    shotAlt: (n) => `Виджет ${n} — как он выглядит в игре`,
    emptyT: 'Ничего не нашлось',
    emptyP: 'Попробуйте другое слово или сбросьте фильтр. Если нужного виджета в списке нет — расскажите нам в Discord, список пополняется по заявкам.',
    emptyBtn: 'Сбросить фильтр',
    ctaEyebrow: 'Дальше',
    ctaH: 'Список будет расти',
    ctaP: 'TU Overlays развивается вместе с сообществом: предложите виджет, которого вам не хватает, — и он вполне может появиться в следующем релизе.',
    ctaDl: 'Скачать TU Overlays',
    ctaDs: 'Предложить виджет в Discord',
    lbClose: 'Закрыть', lbPrev: 'Предыдущий', lbNext: 'Следующий',
    lbAria: 'Просмотр скриншота виджета',
    ftrAria: 'Дополнительно',
    ftrLinks: [['index.html#features', 'Возможности'], ['widgets.html', 'Все виджеты'], ['download.html', 'Скачать'], ['support.html', 'Поддержать проект']],
    disc: '<b>TU Overlays — независимый проект.</b> Приложение не связано с iRacing.com Motorsport Simulations, LLC, не разрабатывается и не поддерживается этой компанией. При разработке приложения и этого сайта использовались инструменты на основе искусственного интеллекта. © 2026 TU Overlays.',
  },
  en: {
    lang: 'en',
    title: `All TU Overlays widgets — a catalogue of ${TOTAL} iRacing overlays`,
    desc: `The full TU Overlays widget catalogue: ${TOTAL} independent iRacing overlays — standings, relative, track map, fuel, telemetry, weather and stream widgets.`,
    canonical: 'https://tuoverlays.xyz/en/widgets',
    imgBase: '../img/',
    home: 'index.html', dl: 'download.html', chg: 'changelog.html', sup: 'support.html',
    altHref: '../widgets.html',
    homeAria: 'TU Overlays — home',
    langAria: 'Language', back: 'Back home',
    eyebrow: 'Catalogue',
    h1a: 'Every ', h1b: 'widget',
    lead: `Every widget is its own window: toggle it, move it, resize it and configure it on its own. This is the whole list — ${TOTAL} of them, each with a one-line description and a filter by what it is for.`,
    statTotal: 'Widgets', statCats: 'Groups', statShots: 'With a shot',
    toolbarAria: 'Catalogue filter',
    searchLabel: 'Search widgets',
    searchPh: 'Search: fuel, radar…',
    clear: 'Clear search',
    all: 'All',
    countAria: 'Widgets found',
    of: 'of',
    shotAlt: (n) => `The ${n} widget as it looks in game`,
    emptyT: 'Nothing matched',
    emptyP: 'Try another word or reset the filter. If the widget you need is not on the list, tell us on Discord — the list grows on requests.',
    emptyBtn: 'Reset the filter',
    ctaEyebrow: 'Next',
    ctaH: 'The list keeps growing',
    ctaP: 'TU Overlays evolves with the community: tell us which widget you are missing and it may well ship in the next release.',
    ctaDl: 'Download TU Overlays',
    ctaDs: 'Request a widget on Discord',
    lbClose: 'Close', lbPrev: 'Previous', lbNext: 'Next',
    lbAria: 'Widget screenshot viewer',
    ftrAria: 'More',
    ftrLinks: [['index.html#features', 'Features'], ['widgets.html', 'All widgets'], ['download.html', 'Download'], ['support.html', 'Support the project']],
    disc: '<b>TU Overlays is an independent project.</b> The app is not affiliated with, developed, or endorsed by iRacing.com Motorsport Simulations, LLC. AI-assisted tools were used in building the app and this site. © 2026 TU Overlays.',
  },
};

// ── card markup ─────────────────────────────────────────────────────────────
const card = (w, i, L) => {
  const cat = CATS.find((c) => c.id === w.cat);
  // The app names its widgets in English in both locales, so the card title is
  // the English name either way; the RU page adds the app's own Russian name
  // underneath it. On the EN page that line would just repeat the title.
  const name = w.en;
  const gloss = L.lang === 'ru' ? `\n      <p class="wc-gloss mono">${w.ru}</p>` : '';
  const desc = L.lang === 'ru' ? w.dru : w.den;
  // one flat haystack so the search covers the English name, the Russian name
  // and the description without the filter having to walk the DOM
  const keys = attr([w.en, w.ru, desc, cat.ru, cat.en].join(' ').toLowerCase());
  // The preview sits in the card itself: the widget is visible without any
  // click at all, and the click only enlarges it.
  const shot = w.shot
    ? `\n      <div class="wc-mv">
        <img src="${L.imgBase}${w.shot.file}" alt="${attr(L.shotAlt(strip(name)))}" width="${w.shot.w}" height="${w.shot.h}" loading="lazy" decoding="async">
        <span class="wc-zoom" aria-hidden="true">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M6 2H2v4M10 14h4v-4M14 6V2h-4M2 10v4h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </span>
      </div>`
    : '';
  return `    <article class="panel brk wcard${w.shot ? ' has-mv' : ''}" data-cat="${w.cat}" data-keys="${keys}" data-name="${attr(name)}" data-reveal>${shot}
      <div class="wc-hd">
        <span class="wc-tag">${L.lang === 'ru' ? cat.ru : cat.en}</span>
        <span class="wc-n mono">${pad(i + 1)}</span>
      </div>
      <h3>${name}</h3>${gloss}
      <p class="wc-d">${desc}</p>
    </article>`;
};

const chips = (L) => [
  `        <button class="chip is-on" type="button" data-cat="all" aria-pressed="true">${L.all} <span class="chip-n mono">${TOTAL}</span></button>`,
  ...CATS.map((c) => {
    const n = WIDGETS.filter((w) => w.cat === c.id).length;
    return `        <button class="chip" type="button" data-cat="${c.id}" aria-pressed="false">${L.lang === 'ru' ? c.ru : c.en} <span class="chip-n mono">${n}</span></button>`;
  }),
].join('\n');

// ── page ────────────────────────────────────────────────────────────────────
const page = (L) => `<!doctype html>
<html lang="${L.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${L.title}</title>
<meta name="description" content="${L.desc}">
<meta name="theme-color" content="#02102c">
<script src="/scripts/analytics.js" defer></script>
<link rel="canonical" href="${L.canonical}">
<link rel="alternate" hreflang="ru" href="https://tuoverlays.xyz/widgets">
<link rel="alternate" hreflang="en" href="https://tuoverlays.xyz/en/widgets">
<link rel="alternate" hreflang="x-default" href="https://tuoverlays.xyz/widgets">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="16x16" href="${L.imgBase}favicon-16.png">
<link rel="icon" type="image/png" sizes="32x32" href="${L.imgBase}favicon-32.png">
<link rel="icon" type="image/png" sizes="48x48" href="${L.imgBase}favicon-48.png">
<link rel="icon" type="image/png" sizes="96x96" href="${L.imgBase}favicon-96.png">
<link rel="icon" type="image/png" sizes="192x192" href="${L.imgBase}favicon-192.png">
<link rel="icon" type="image/png" sizes="512x512" href="${L.imgBase}favicon-512.png">
<link rel="apple-touch-icon" href="${L.imgBase}apple-touch-icon.png">

<link rel="stylesheet" href="/css/tu-core.css">
<style>
/* ── header ────────────────────────────────────────────────────────────────
   Like every other secondary page: this one doesn't run the scroll-driven
   .stuck toggle from js/tu-home.js, so the header stays in normal flow and
   the filter bar below it is the only sticky element. */
.hdr{position:static;padding-block:18px;border-bottom:1px solid var(--line)}
.hdr-in{display:flex;align-items:center;gap:14px;height:auto}
.hdr-back{margin-left:auto;display:inline-flex;align-items:center;gap:8px;
  font-family:var(--f-mono);font-size:var(--t-xs);letter-spacing:.08em;text-transform:uppercase;color:var(--tx-3);
  transition:color var(--d-1) var(--e-state)}
.hdr-back:hover{color:var(--tx)}
.lang-switch{display:flex;margin-left:0}

/* ── hero ──────────────────────────────────────────────────────────────── */
.stage{position:relative;overflow:hidden;padding-block:clamp(52px,8vw,84px) clamp(24px,3vw,36px)}
.glow{position:absolute;border-radius:50%;filter:blur(100px);opacity:.34;pointer-events:none;
  width:min(900px,120vw);height:480px;left:50%;top:-240px;transform:translateX(-50%);
  background:radial-gradient(50% 50% at 50% 50%, rgba(255,0,102,.4), rgba(255,0,102,0) 70%)}
/* .stage-in is also the .wrap, so it must not carry its own max-width: that
   would override --maxw and centre the hero away from the left edge every
   other band on the page starts at. The copy column is constrained instead. */
.stage-in{position:relative;z-index:1}
.stage-copy{display:flex;flex-direction:column;gap:14px;max-width:66ch}

/* three readouts on one hairline — the page's only numerals at display size */
.stats{display:flex;flex-wrap:wrap;gap:0 var(--s7);margin-top:var(--s5);
  border-top:1px solid var(--line);padding-top:var(--s4)}
.stat{display:flex;flex-direction:column;gap:2px}
.stat b{font-family:var(--f-mono);font-variant-numeric:tabular-nums;font-size:var(--t-num);
  font-weight:600;line-height:1;letter-spacing:-.03em;color:var(--tx)}
.stat b u{text-decoration:none;color:var(--brand)}
.stat span{font-family:var(--f-mono);font-size:var(--t-lbl-s);letter-spacing:var(--tr-lbl);
  text-transform:uppercase;color:var(--tx-4)}

/* ── filter bar ───────────────────────────────────────────────────────────
   Sticks to the top of the viewport so the filter is reachable from anywhere
   in a 40-card list. backdrop-filter is allowed here for the same reason it is
   allowed on the home page header: this is the sticky chrome layer. */
.tools{position:sticky;top:0;z-index:30;padding-block:var(--s3);
  background:rgba(2,16,44,.82);border-bottom:1px solid var(--line);
  backdrop-filter:blur(20px) saturate(1.35);-webkit-backdrop-filter:blur(20px) saturate(1.35)}
.tools-in{display:flex;align-items:center;gap:var(--s4);flex-wrap:wrap}

/* 260px is what's left over once the seven chips and the count have taken
   their share of a 1920-wide desktop; below that the row wraps. */
.srch{position:relative;flex:0 1 260px;max-width:100%}
.srch svg{position:absolute;left:13px;top:50%;transform:translateY(-50%);color:var(--tx-4);pointer-events:none}
.srch input{
  width:100%;height:40px;padding:0 34px 0 36px;border-radius:var(--r-pill);
  background:var(--elev-1);border:1px solid var(--line-2);color:var(--tx);
  font-family:var(--f-text);font-size:14px;
  transition:border-color var(--d-1) var(--e-state),background var(--d-1) var(--e-state);
}
.srch input::placeholder{color:var(--tx-4)}
.srch input:hover{border-color:var(--line-3)}
.srch input:focus{outline:none;border-color:var(--brand);background:var(--elev-2)}
.srch input:focus-visible{outline:2px solid var(--data);outline-offset:2px}
.srch-x{position:absolute;right:6px;top:50%;transform:translateY(-50%);
  width:28px;height:28px;display:none;align-items:center;justify-content:center;border-radius:50%;
  color:var(--tx-3);transition:color var(--d-1) var(--e-state)}
.srch-x:hover{color:var(--brand-hi)}
.srch.has-q .srch-x{display:flex}

.chips{display:flex;flex-wrap:wrap;gap:var(--s2)}
.chip{
  display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 12px;
  border:1px solid var(--line-2);border-radius:var(--r-pill);
  font-family:var(--f-mono);font-size:var(--t-lbl);letter-spacing:.06em;text-transform:uppercase;
  color:var(--tx-3);white-space:nowrap;
  transition:color var(--d-1) var(--e-state),border-color var(--d-1) var(--e-state),background var(--d-1) var(--e-state);
}
.chip:hover{color:var(--tx);border-color:var(--line-3)}
.chip-n{font-size:var(--t-lbl-s);color:var(--tx-4);transition:color var(--d-1) var(--e-state)}
.chip.is-on{color:var(--tx);border-color:var(--line-hot);background:var(--brand-dim)}
.chip.is-on .chip-n{color:var(--brand-hi)}

.count{margin-left:auto;font-family:var(--f-mono);font-variant-numeric:tabular-nums;
  font-size:var(--t-lbl);letter-spacing:var(--tr-lbl);text-transform:uppercase;color:var(--tx-4);white-space:nowrap}
.count b{color:var(--tx);font-weight:400}

/* ── catalogue ─────────────────────────────────────────────────────────── */
/* html carries zoom:1.5, so the track floor is in layout px, not screen px:
   258px lands 3 columns on a 1366-wide laptop and 4 on a 1920 desktop. */
.wgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(258px,1fr));gap:var(--gut);
  align-items:start;padding-block:var(--s6) var(--s7)}
.wcard{display:flex;flex-direction:column;gap:6px;padding:var(--s4) var(--s4) var(--s5);overflow:hidden;
  transition:background var(--d-1) var(--e-state),border-color var(--d-1) var(--e-state),
             opacity var(--d-3) var(--e-enter),transform var(--d-3) var(--e-enter)}
.wcard[hidden]{display:none}
.wcard:hover{background:var(--elev-2);border-color:var(--line-3)}
/* same hover affordance as the feature cards on the home page: a hairline
   drawing itself left to right, never a lift */
.wcard::after{content:'';position:absolute;left:0;right:0;top:0;height:1px;background:var(--brand);
  transform:scaleX(0);transform-origin:left;transition:transform var(--d-2) var(--e-state)}
.wcard:hover::after{transform:scaleX(1)}

.wc-hd{display:flex;align-items:baseline;gap:10px;margin-bottom:var(--s2)}
.wc-tag{font-family:var(--f-mono);font-size:var(--t-lbl-s);letter-spacing:var(--tr-lbl);
  text-transform:uppercase;color:var(--tx-4)}
.wc-n{margin-left:auto;font-size:var(--t-lbl-s);letter-spacing:.12em;color:var(--tx-4);flex:none}
.wcard h3{color:var(--tx)}
.wc-gloss{font-size:var(--t-lbl);letter-spacing:.04em;color:var(--tx-3)}
.wc-d{font-size:13.8px;line-height:1.55;color:var(--tx-2d);margin-top:6px}

/* the preview well — same construction as the feature cards on the home page:
   a recessed well, the shot letterboxed inside it with a deterministic inset
   so a portrait screenshot and a wide one get the same margin */
.wc-mv{position:relative;display:flex;align-items:center;justify-content:center;
  height:124px;padding:10px;margin-bottom:var(--s3);border-radius:var(--r-1);
  overflow:hidden;border:1px solid var(--line);background:var(--well)}
/* auto + max-*, not object-fit:contain: "contain" also scales an image UP to
   fill the box, and several of these overlays are genuinely tiny (Corner Names
   ships at 95x20) — blowing one up to fill the well only makes it soft. Big
   shots shrink to fit, small ones stay crisp at native size, and the wall
   keeps the widgets' real size relative to each other. */
.wc-mv img{width:auto;height:auto;max-width:100%;max-height:100%;cursor:zoom-in}
.wc-mv img[src$=".svg"]{max-height:74%}
/* the enlarge affordance only announces itself on hover — the shot is already
   readable without it */
.wc-zoom{position:absolute;top:7px;right:7px;width:22px;height:22px;pointer-events:none;
  display:flex;align-items:center;justify-content:center;border-radius:var(--r-1);
  background:rgba(2,16,44,.72);border:1px solid var(--line-2);color:var(--tx-3);
  opacity:0;transition:opacity var(--d-1) var(--e-state),color var(--d-1) var(--e-state)}
.wcard:hover .wc-zoom,.wc-mv img:focus-visible + .wc-zoom{opacity:1;color:var(--brand-hi)}

/* mark: highlights the matched substring during a search */
.wcard mark{background:rgba(255,0,102,.22);color:var(--tx);border-radius:2px}

.empty{display:none;padding:var(--s7) var(--s5);text-align:center}
.empty.on{display:block}
.empty h3{font-size:19px}
.empty p{color:var(--tx-2d);font-size:var(--t-sm);margin:10px auto var(--s5);max-width:52ch}

/* ── closing plate ─────────────────────────────────────────────────────── */
.cta{position:relative;overflow:hidden;border-radius:var(--r-3);border:1px solid var(--line-2);
  background:var(--elev-1);padding:clamp(28px,4vw,48px);margin-bottom:var(--s8)}
.cta::before{content:'';position:absolute;left:0;right:0;top:0;height:2px;background:var(--brand)}
.cta h2{margin-top:10px}
.cta p{color:var(--tx-2);font-size:var(--t-lead);line-height:var(--lh-lead);max-width:56ch;margin-top:12px}
.cta-actions{display:flex;gap:var(--s3);flex-wrap:wrap;margin-top:var(--s5)}

/* ── footer ────────────────────────────────────────────────────────────── */
.ftr{border-top:1px solid var(--line);padding-block:36px}
.ftr-in{display:flex;flex-wrap:wrap;gap:20px 30px;align-items:center}
.ftr-links{display:flex;gap:22px;flex-wrap:wrap;margin-left:auto}
.ftr-links a{font-size:var(--t-xs);color:var(--tx-3);transition:color var(--d-1) var(--e-state)}
.ftr-links a:hover{color:var(--tx)}
.disc{width:100%;color:var(--tx-4);font-size:var(--t-xs);line-height:1.6;max-width:74ch;
  padding-top:22px;margin-top:4px;border-top:1px solid var(--line)}
.disc b{color:var(--tx-3);font-weight:500}

@media (max-width:900px){
  .tools-in{gap:var(--s3)}
  /* the field and the tally share one line so the sticky bar costs a phone two
     rows, not three */
  .srch{order:-1;flex:1 1 120px;min-width:0}
  .count{order:0;flex:none;margin-left:0}
  /* seven chips wrapped onto four rows would leave a phone with a sticky bar
     taller than the cards under it: run them as one scrolling rail instead,
     bled to the screen edges so the overflow reads as scrollable */
  .chips{order:1;flex:1 1 100%;min-width:0;flex-wrap:nowrap;overflow-x:auto;overscroll-behavior-x:contain;
    width:calc(100% + var(--pad) * 2);margin-inline:calc(var(--pad) * -1);padding-inline:var(--pad);
    scrollbar-width:none;-ms-overflow-style:none}
  .chips::-webkit-scrollbar{display:none}
  .chip{flex:none}
}
@media (max-width:560px){
  .stats{gap:0 var(--s5)}
  .wgrid{grid-template-columns:1fr}
}
</style>
</head>
<body>

<header class="hdr">
  <div class="wrap hdr-in">
    <a class="logo" href="${L.home}" aria-label="${L.homeAria}">
      <img class="logo-mk" src="${L.imgBase}logo.png" alt="" width="26" height="28" decoding="async">
      <span class="logo-tx"><b>TU</b> <span>Overlays</span></span>
    </a>
    <div class="lang-switch" aria-label="${L.langAria}">
      ${L.lang === 'ru'
        ? '<a class="on" href="widgets.html" aria-current="true">RU</a>\n      <a href="en/widgets.html">EN</a>'
        : '<a href="../widgets.html">RU</a>\n      <a class="on" href="widgets.html" aria-current="true">EN</a>'}
    </div>
    <a class="hdr-back" href="${L.home}">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3 5 8l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      ${L.back}
    </a>
  </div>
</header>

<main>

<!-- ══════════════════════════ HERO ══════════════════════════ -->
<section class="stage">
  <div class="glow" aria-hidden="true"></div>
  <div class="wrap stage-in">
    <div class="stage-copy">
      <span class="eyebrow">${L.eyebrow}</span>
      <h1>${L.h1a}<span class="acc">${L.h1b}</span></h1>
      <p class="lead">${L.lead}</p>
    </div>
    <div class="stats">
      <span class="stat"><b>${TOTAL}</b><span>${L.statTotal}</span></span>
      <span class="stat"><b>${pad(CATS.length)}</b><span>${L.statCats}</span></span>
      <span class="stat"><b>${pad(SHOTS)}</b><span>${L.statShots}</span></span>
    </div>
  </div>
</section>

<!-- ══════════════════════════ FILTER ══════════════════════════ -->
<div class="tools">
  <div class="wrap tools-in" role="search" aria-label="${L.toolbarAria}">
    <div class="srch" id="srch">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.5"/><path d="m10.5 10.5 3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      <input id="q" type="search" autocomplete="off" spellcheck="false" placeholder="${L.searchPh}" aria-label="${L.searchLabel}">
      <button class="srch-x" id="qx" type="button" aria-label="${L.clear}">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      </button>
    </div>
    <div class="chips" id="chips">
${chips(L)}
    </div>
    <p class="count" aria-label="${L.countAria}"><b id="cNow">${TOTAL}</b> ${L.of} ${TOTAL}</p>
  </div>
</div>

<!-- ══════════════════════════ CATALOGUE ══════════════════════════ -->
<section class="wrap">
  <div class="wgrid" id="grid">
${WIDGETS.map((w, i) => card(w, i, L)).join('\n')}
  </div>

  <div class="panel empty" id="empty">
    <h3>${L.emptyT}</h3>
    <p>${L.emptyP}</p>
    <button class="btn btn-ghost btn-sm" type="button" id="reset">${L.emptyBtn}</button>
  </div>
</section>

<!-- ══════════════════════════ CLOSING PLATE ══════════════════════════ -->
<section class="wrap">
  <div class="cta">
    <span class="eyebrow">${L.ctaEyebrow}</span>
    <h2>${L.ctaH}</h2>
    <p>${L.ctaP}</p>
    <div class="cta-actions">
      <a class="btn btn-primary" href="${L.dl}">
        <span class="btn-content">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2v9m0 0 3.4-3.4M8 11 4.6 7.6M2.5 13.5h11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span class="btn-label">${L.ctaDl}</span>
        </span>
        <span class="btn-arrow" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
      </a>
      <a class="btn btn-ghost" href="https://discord.gg/8nys62n7M" target="_blank" rel="noopener">${L.ctaDs}</a>
    </div>
  </div>
</section>

</main>

<!-- ══════════════════════════ FOOTER ══════════════════════════ -->
<footer class="ftr">
  <div class="wrap ftr-in">
    <a class="logo" href="${L.home}">
      <img class="logo-mk" src="${L.imgBase}logo.png" alt="" aria-hidden="true" width="26" height="28" loading="lazy" decoding="async">
      <span class="logo-tx"><b>TU</b> <span>Overlays</span></span>
    </a>
    <nav class="ftr-links" aria-label="${L.ftrAria}">
${L.ftrLinks.map(([h, t]) => `      <a href="${h}">${t}</a>`).join('\n')}
      <a href="https://discord.gg/8nys62n7M" target="_blank" rel="noopener">Discord</a>
    </nav>
    <p class="disc">${L.disc}</p>
  </div>
</footer>

<!-- screenshot viewer — the same photo lightbox the home page gallery uses -->
<div class="plb" id="plb" hidden role="dialog" aria-modal="true" aria-label="${L.lbAria}">
  <div class="plb-box">
    <div class="plb-frame"><img id="plbImg" src="" alt="" width="1" height="1"></div>
    <div class="lb-bar">
      <h3 id="plbTitle">—</h3>
      <div class="lb-nav">
        <button id="plbPrev" type="button" aria-label="${L.lbPrev}">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3 5 8l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button id="plbNext" type="button" aria-label="${L.lbNext}">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 3 5 5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
      <button class="lb-close" id="plbClose" type="button" aria-label="${L.lbClose}">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
  </div>
</div>

<script>
(() => {
  'use strict';

  /* ── scroll reveal ──────────────────────────────────────────────────────
     tu-home.js isn't loaded here, so the page runs its own copy of the one
     reveal in the system: 420ms, 60ms stagger, opacity + 14px. */
  const reveal = () => {
    const items = [...document.querySelectorAll('[data-reveal]')];
    if (!('IntersectionObserver' in window) ||
        matchMedia('(prefers-reduced-motion: reduce)').matches) {
      items.forEach(el => el.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      let n = 0;
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        // cap the cascade: a whole screen of cards entering at once must not
        // run a two-second staircase
        e.target.style.setProperty('--d', (Math.min(n++, 7) * 60) + 'ms');
        e.target.classList.add('in');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: .05 });
    items.forEach(el => io.observe(el));
  };
  reveal();

  /* ── filter ──────────────────────────────────────────────────────────── */
  const cards  = [...document.querySelectorAll('.wcard')];
  const chips  = [...document.querySelectorAll('.chip')];
  const q      = document.getElementById('q');
  const srch   = document.getElementById('srch');
  const qx     = document.getElementById('qx');
  const cNow   = document.getElementById('cNow');
  const empty  = document.getElementById('empty');
  const reset  = document.getElementById('reset');

  let cat = 'all';

  // Cache each title's original markup so highlighting can be undone without
  // re-reading a string we have already wrapped in <mark>.
  cards.forEach((c) => { c._h3 = c.querySelector('h3'); c._name = c.dataset.name; });

  const mark = (card, term) => {
    const name = card._name;
    if (!term) { card._h3.textContent = name; return; }
    const i = name.toLowerCase().indexOf(term);
    if (i < 0) { card._h3.textContent = name; return; }
    card._h3.textContent = '';
    card._h3.append(
      name.slice(0, i),
      Object.assign(document.createElement('mark'), { textContent: name.slice(i, i + term.length) }),
      name.slice(i + term.length)
    );
  };

  const apply = () => {
    const term = q.value.trim().toLowerCase();
    let n = 0;
    cards.forEach((c) => {
      const hit = (cat === 'all' || c.dataset.cat === cat) &&
                  (!term || c.dataset.keys.includes(term));
      c.hidden = !hit;
      if (hit) { n++; mark(c, term); }
    });
    cNow.textContent = n;
    empty.classList.toggle('on', n === 0);
    srch.classList.toggle('has-q', q.value !== '');
  };

  chips.forEach((b) => b.addEventListener('click', () => {
    cat = b.dataset.cat;
    chips.forEach((o) => {
      const on = o === b;
      o.classList.toggle('is-on', on);
      o.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    apply();
  }));

  q.addEventListener('input', apply);
  qx.addEventListener('click', () => { q.value = ''; q.focus(); apply(); });
  reset.addEventListener('click', () => {
    q.value = '';
    chips[0].click();
    q.focus();
  });
  // Esc clears the field before the browser's own search-input reset kicks in
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && q.value) { e.preventDefault(); q.value = ''; apply(); }
  });

  /* ── screenshot viewer ───────────────────────────────────────────────── */
  const plb   = document.getElementById('plb');
  const img   = document.getElementById('plbImg');
  const title = document.getElementById('plbTitle');
  // the previews in the cards are the triggers: the shot is already on screen,
  // clicking it only blows it up
  const shots = [...document.querySelectorAll('.wc-mv img')];
  // prev/next walks the shots the filter is currently showing, so arrowing
  // through "weather" never lands on a widget the visitor filtered out
  let reel = shots, at = 0, last = null;

  const show = (i) => {
    at = (i + reel.length) % reel.length;
    const b = reel[at];
    const card = b.closest('.wcard');
    img.src = b.currentSrc || b.src;
    img.width = b.getAttribute('width');
    img.height = b.getAttribute('height');
    img.alt = b.alt;
    title.textContent = card.dataset.name;
  };

  const open = (b) => {
    last = b;
    reel = shots.filter((s) => !s.closest('.wcard').hidden);
    if (!reel.length) reel = shots;
    show(Math.max(0, reel.indexOf(b)));
    plb.hidden = false;
    document.body.style.overflow = 'hidden';
    document.getElementById('plbClose').focus();
  };

  const close = () => {
    plb.hidden = true;
    document.body.style.overflow = '';
    if (last) last.focus();
  };

  // an <img> is not focusable on its own; promote it the same way the home
  // page's gallery does so the preview stays reachable from the keyboard
  shots.forEach((b) => {
    b.setAttribute('role', 'button');
    b.setAttribute('tabindex', '0');
    b.addEventListener('click', () => open(b));
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(b); }
    });
  });
  document.getElementById('plbClose').addEventListener('click', close);
  document.getElementById('plbPrev').addEventListener('click', () => show(at - 1));
  document.getElementById('plbNext').addEventListener('click', () => show(at + 1));
  plb.addEventListener('click', (e) => { if (e.target === plb) close(); });
  document.addEventListener('keydown', (e) => {
    if (plb.hidden) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') show(at - 1);
    if (e.key === 'ArrowRight') show(at + 1);
  });
})();
</script>

</body>
</html>
`;

writeFileSync(join(ROOT, 'widgets.html'), page(T.ru), 'utf8');
writeFileSync(join(ROOT, 'en', 'widgets.html'), page(T.en), 'utf8');
console.log(`widgets: ${TOTAL}, categories: ${CATS.length}, shots: ${SHOTS}`);
const per = {};
WIDGETS.forEach((w) => { per[w.cat] = (per[w.cat] || 0) + 1; });
console.log(per);
