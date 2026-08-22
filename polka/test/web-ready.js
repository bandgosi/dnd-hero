/* Проверка готовности «Детской полки» к публикации в вебе (GitHub Pages).

   Главная опасность переезда: macOS не различает регистр в именах файлов,
   а сервер Pages — различает. Ссылка Styles/base.css локально работает,
   а онлайн отдаёт 404 и приложение остаётся без стилей. */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.HUB_ROOT || path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['test', '.git', 'node_modules']);

let pass = 0; const fails = [];
function test(name, fn) {
  try { fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fails.push(name + ' → ' + e.message); console.log('✗ ' + name + ' → ' + e.message); }
}
const ok = (c, m) => { if (!c) throw new Error(m); };

/** Все файлы проекта, кроме служебных папок. */
function walk(dir, out) {
  out = out || [];
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Существует ли файл ровно с таким регистром букв. */
function existsExact(file) {
  const dir = path.dirname(file);
  const base = path.basename(file);
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).indexOf(base) !== -1;
}

const files = walk(ROOT);
const pages = files.filter(f => f.endsWith('.html'));
const styles = files.filter(f => f.endsWith('.css'));

/* ---------- Ссылки в HTML ---------- */
const refs = [];
for (const page of pages) {
  const src = fs.readFileSync(page, 'utf8');
  const re = /(?:src|href)\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src))) {
    const url = m[1];
    if (/^(https?:|data:|blob:|mailto:|#|javascript:)/i.test(url)) continue;
    refs.push({ from: page, url: url.split('#')[0].split('?')[0] });
  }
}

/* ---------- Ссылки в CSS (url(...)) ---------- */
for (const css of styles) {
  const src = fs.readFileSync(css, 'utf8');
  const re = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const url = m[1];
    if (/^(https?:|data:)/i.test(url)) continue;
    refs.push({ from: css, url: url });
  }
}

test('Все локальные ссылки ведут на существующие файлы (с учётом регистра)', () => {
  const bad = [];
  for (const r of refs) {
    const target = path.resolve(path.dirname(r.from), r.url);
    if (!existsExact(target)) {
      bad.push(path.relative(ROOT, r.from) + ' → ' + r.url);
    }
  }
  ok(!bad.length, 'битые ссылки:\n    ' + bad.join('\n    '));
});

test('Нет ссылок от корня сервера (ломаются на github.io/имя-репозитория/)', () => {
  const bad = refs.filter(r => r.url.charAt(0) === '/')
    .map(r => path.relative(ROOT, r.from) + ' → ' + r.url);
  ok(!bad.length, bad.join(', '));
});

test('Имена файлов и папок безопасны для веб-сервера', () => {
  const bad = [];
  const IGNORED = /(^|\/)(\.DS_Store|Thumbs\.db|\.nojekyll|\.gitignore)$/;
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    if (IGNORED.test('/' + rel)) continue;
    // пробелы, кириллица и заглавные буквы в путях — источник ошибок при переносе
    if (/[^\w\-./]/.test(rel)) bad.push(rel + ' (недопустимый символ)');
    if (/[A-Z]/.test(rel) && !/^(README|ARCHITECTURE|LICENSE|PUBLISH)/.test(path.basename(rel))) {
      bad.push(rel + ' (заглавные буквы)');
    }
  }
  ok(!bad.length, bad.join('; '));
});

test('Нет ссылок на файлы вне проекта', () => {
  const bad = refs
    .filter(r => path.relative(ROOT, path.resolve(path.dirname(r.from), r.url)).startsWith('..'))
    .map(r => path.relative(ROOT, r.from) + ' → ' + r.url);
  ok(!bad.length, bad.join(', '));
});

test('Скрипты подключены как обычные, а не как модули', () => {
  const bad = [];
  for (const page of pages) {
    const src = fs.readFileSync(page, 'utf8');
    if (/type\s*=\s*["']module["']/.test(src)) bad.push(path.relative(ROOT, page));
  }
  ok(!bad.length, 'модули не нужны и мешают офлайну: ' + bad.join(', '));
});

test('Есть .nojekyll — иначе сервер может проглотить часть файлов', () => {
  ok(fs.existsSync(path.join(ROOT, '.nojekyll')), 'файла нет');
});

test('Есть манифест и иконки для установки на телефон', () => {
  ['manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png']
    .forEach(f => ok(fs.existsSync(path.join(ROOT, f)), 'нет ' + f));
  const mf = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  ok(mf.name && mf.icons && mf.icons.length >= 2, 'манифест неполный');
  ok(mf.start_url === './' && mf.scope === './',
     'пути в манифесте должны быть относительными, иначе сломаются на подпапке');
});

test('Главная страница подключает манифест и иконку Apple', () => {
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ok(/rel="manifest"/.test(src), 'нет манифеста');
  ok(/apple-touch-icon/.test(src), 'нет иконки для iPhone');
  ok(/theme-color/.test(src), 'нет цвета темы');
});

test('Служебные файлы и черновики не попадут в репозиторий', () => {
  const ignore = path.join(ROOT, '.gitignore');
  ok(fs.existsSync(ignore), 'нет .gitignore');
  const src = fs.readFileSync(ignore, 'utf8');
  ['.DS_Store', 'node_modules/', 'test/agent-*/', 'test/qa-*/']
    .forEach(p => ok(src.indexOf(p) !== -1, '.gitignore не скрывает ' + p));
});

test('Размер сайта разумен для мобильного интернета', () => {
  const bytes = files
    .filter(f => !path.relative(ROOT, f).startsWith('test'))
    .reduce((a, f) => a + fs.statSync(f).size, 0);
  const mb = bytes / 1024 / 1024;
  ok(mb < 5, 'сайт весит ' + mb.toFixed(1) + ' МБ');
  console.log('   вес сайта: ' + Math.round(bytes / 1024) + ' КБ');
});

test('Ничего не грузится по незащищённому http', () => {
  const bad = [];
  for (const f of files.filter(x => /\.(html|css|js|webmanifest)$/.test(x))) {
    const src = fs.readFileSync(f, 'utf8');
    const urls = src.match(/http:\/\/[^\s"')]+/g) || [];
    const real = urls.filter(u => !/localhost|127\.0\.0\.1|www\.w3\.org/.test(u));
    if (real.length) bad.push(path.relative(ROOT, f) + ': ' + real.join(', '));
  }
  ok(!bad.length, 'браузер заблокирует: ' + bad.join('; '));
});

console.log('\n' + pass + ' проверок пройдено');
if (fails.length) { console.log('\n❌ ПРОВАЛЕНО:\n' + fails.join('\n')); process.exit(1); }
console.log('✅ Проект готов к публикации');
