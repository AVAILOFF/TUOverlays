/*
  Дублирует changelog с сайта в Discord.

  changelog.html (и en/changelog.html) читают GitHub Releases живьём через API,
  поэтому опубликованный релиз — это ровно то, что видно на сайте. Этот скрипт
  берёт тот же объект релиза и отправляет его текст в канал Discord вебхуком,
  так что копировать руками ничего не нужно.

  Вход:  JSON релиза на stdin — то, что печатает
         gh release view <tag> --json tagName,body,url,publishedAt,isDraft,isPrerelease
  Env:   DISCORD_WEBHOOK   — URL вебхука (обязателен, кроме --dry-run)
         DISCORD_ROLE_ID   — ID роли для пинга (необязателен)

  Запускается из .github/workflows/discord-release.yml на каждом published
  релизе. Посмотреть, как будет выглядеть сообщение, ничего не отправляя:

    gh release view v0.1.0 --json tagName,body,url,publishedAt,isDraft,isPrerelease \
      | node scripts/discord-release.mjs --dry-run
*/

const SITE = 'https://tuoverlays.xyz';
const LOGO = `${SITE}/img/logo.png`;
const BRAND = 0xff0066;        // --brand в css/tu-core.css
const MAX_NOTES = 3800;        // у description эмбеда потолок 4096

const readStdin = () =>
  new Promise((resolve, reject) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { buf += chunk; });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', reject);
  });

const raw = (await readStdin()).trim();
if (!raw) {
  console.error('Нет данных на stdin: ожидается вывод "gh release view --json ...".');
  process.exit(1);
}

const rel = JSON.parse(raw);

if (rel.isDraft) {
  console.log(`${rel.tagName} — черновик, на сайте его нет. В Discord не отправляем.`);
  process.exit(0);
}

// Текст релиза как есть: то же самое рендерит changelog.html, и Discord
// понимает тот же поднабор markdown (заголовки, **жирный**, списки, `код`).
let notes = (rel.body || '').replace(/\r/g, '').trim();
if (!notes) notes = '_Без описания._';
if (notes.length > MAX_NOTES) {
  notes = `${notes.slice(0, MAX_NOTES)}\n…\n[Полный список изменений на GitHub](${rel.url})`;
}

const roleId = (process.env.DISCORD_ROLE_ID || '').trim();

const payload = {
  username: 'TU Overlays',
  avatar_url: LOGO,
  content: roleId ? `<@&${roleId}>` : '',
  // Пингуем только явно указанную роль — @everyone и случайные упоминания
  // внутри текста релиза остаются просто текстом.
  allowed_mentions: { parse: [], roles: roleId ? [roleId] : [] },
  embeds: [{
    title: `TU Overlays ${rel.tagName}${rel.isPrerelease ? '  ·  pre-release' : ''}`,
    url: rel.url,
    color: BRAND,
    timestamp: rel.publishedAt,
    description: notes,
    thumbnail: { url: LOGO },
    fields: [
      { name: 'Скачать', value: `[tuoverlays.xyz/download](${SITE}/download)`, inline: true },
      { name: 'Changelog', value: `[tuoverlays.xyz/changelog](${SITE}/changelog)`, inline: true },
    ],
    footer: { text: 'tuoverlays.xyz' },
  }],
};

if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

const webhook = process.env.DISCORD_WEBHOOK;
if (!webhook) {
  console.error('DISCORD_WEBHOOK не задан.');
  process.exit(1);
}

let res;
try {
  res = await fetch(`${webhook}?wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
} catch (err) {
  console.error(`Не удалось достучаться до вебхука Discord: ${err.message}`);
  process.exit(1);
}

if (!res.ok) {
  console.error(`Discord ответил HTTP ${res.status}: ${await res.text()}`);
  process.exit(1);
}

console.log(`${rel.tagName} отправлен в Discord.`);
