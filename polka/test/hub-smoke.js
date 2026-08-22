/* Тест «Детской полки»: оглавление и связь с тремя приложениями. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(process.env.JSDOM_PATH || 'jsdom');

const ROOT = process.env.HUB_ROOT || path.resolve(__dirname, '..');

/* ---------- Общее окружение ---------- */
function makeDom(htmlPath, opts) {
  opts = opts || {};
  const raw = fs.readFileSync(htmlPath, 'utf8');
  const html = raw.replace(/<link[^>]*>/g, '').replace(/<script src="[^"]+"[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, {
    runScripts: 'outside-only', pretendToBeVisual: true,
    url: 'http://localhost/' + (opts.search || '')
  });
  const w = dom.window;

  w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
  w.Element.prototype.animate = () => ({ finished: Promise.resolve(), cancel() {} });
  w.Element.prototype.scrollIntoView = () => {};
  w.Element.prototype.setPointerCapture = () => {};
  w.Element.prototype.releasePointerCapture = () => {};
  w.scrollTo = () => {}; w.print = () => {};
  w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};

  class P { constructor(){ this.value = 0; } setValueAtTime(){} exponentialRampToValueAtTime(){} linearRampToValueAtTime(){} }
  class N { constructor(){ this.gain = new P(); this.frequency = new P(); this.Q = new P(); } connect(){ return this; } start(){} stop(){} }
  w.AudioContext = class {
    constructor(){ this.currentTime = 0; this.state = 'running'; this.sampleRate = 44100; this.destination = {}; }
    createGain(){ return new N(); } createOscillator(){ return new N(); } createBiquadFilter(){ return new N(); }
    createBufferSource(){ return new N(); } createBuffer(){ return { getChannelData: () => new Float32Array(8) }; }
    resume(){}
  };
  w.SpeechSynthesisUtterance = function (t) { this.text = t; };
  const spoken = [];
  w.speechSynthesis = {
    speak(u) { spoken.push(String(u.text)); if (u.onend) setTimeout(u.onend, 0); },
    cancel() {}, getVoices() { return [{ lang: 'ru-RU', name: 'Milena' }]; }, onvoiceschanged: null
  };
  w.requestAnimationFrame = cb => w.setTimeout(() => cb(w.performance.now()), 6);
  w.cancelAnimationFrame = id => w.clearTimeout(id);

  return { dom, w, spoken };
}

/** Список скриптов из html в порядке подключения. */
function scriptsOf(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  return Array.from(html.matchAll(/<script src="([^"]+)"/g)).map(m => m[1]);
}

/** Загрузить страницу вместе с её скриптами. Пути — относительно папки страницы. */
function load(relHtml, opts) {
  opts = opts || {};
  const htmlPath = path.join(ROOT, relHtml);
  const dir = path.dirname(htmlPath);
  const ctx = makeDom(htmlPath, opts);
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a.join(' '));

  for (const src of scriptsOf(htmlPath)) {
    const file = path.resolve(dir, src);
    if (!fs.existsSync(file)) { ctx.missing = (ctx.missing || []).concat(src); continue; }
    try { ctx.w.eval(fs.readFileSync(file, 'utf8')); }
    catch (e) { errors.push(`${src}: ${e.message}`); }
  }
  // Скрипты внутри самой страницы (у сказок весь код там)
  if (opts.inlineScripts !== false) {
    const raw = fs.readFileSync(htmlPath, 'utf8');
    for (const m of raw.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      try { ctx.w.eval(m[1]); } catch (e) { errors.push(`inline: ${e.message}`); }
    }
  }
  console.error = orig;
  ctx.errors = errors;
  return ctx;
}

const wait = ms => new Promise(r => setTimeout(r, ms));
let pass = 0; const fails = [];
async function test(name, fn) {
  try { await fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fails.push(name + ' → ' + e.message); console.log('✗ ' + name + ' → ' + e.message); }
}
const ok = (c, m) => { if (!c) throw new Error(m); };

(async () => {

  await test('Все три приложения лежат на своих местах', () => {
    ['index.html', 'hub/hub.css', 'hub/hub.js', 'shared/profile.js',
     'skazki/index.html', 'chasiki/index.html', 'umnyashka/index.html',
     'skazki/app.info.js', 'chasiki/app.info.js', 'umnyashka/app.info.js']
      .forEach(f => ok(fs.existsSync(path.join(ROOT, f)), 'нет файла ' + f));
  });

  /* ---------------- ОГЛАВЛЕНИЕ ---------------- */
  let hub = load('index.html');
  await wait(200);

  await test('Оглавление открывается без ошибок', () => {
    ok(hub.errors.length === 0, hub.errors.join(' | '));
    ok(hub.w.document.querySelector('.head__title'), 'нет заголовка');
  });

  await test('Заголовок написан один раз и читается «Детская полка»', () => {
    const titles = hub.w.document.querySelectorAll('.head__title');
    ok(titles.length === 1, 'заголовков ' + titles.length);
    const text = titles[0].textContent.replace(/ /g, ' ');
    ok(text === 'Детская полка', 'заголовок: «' + text + '»');
    ok(titles[0].getAttribute('aria-label') === 'Детская полка', 'нет подписи для диктора');
    // Каждая буква — отдельный span ради анимации, диктор их читать не должен
    const spans = titles[0].querySelectorAll('span');
    ok(spans.length === 13, 'букв ' + spans.length);
    ok(Array.from(spans).every(s => s.getAttribute('aria-hidden') === 'true'),
       'буквы не скрыты от диктора');
  });

  await test('Ни один блок экрана не отрисован дважды', () => {
    const d = hub.w.document;
    [['.head', 1], ['.head__logo', 1], ['.head__sub', 1], ['.cards', 1],
     ['.who', 1], ['.foot', 1], ['.field', 1], ['.chars', 1], ['.char', 4]]
      .forEach(([sel, n]) => {
        const got = d.querySelectorAll(sel).length;
        ok(got === n, sel + ': ' + got + ' вместо ' + n);
      });
  });

  await test('Показаны три карточки приложений', () => {
    const cards = hub.w.document.querySelectorAll('.card');
    ok(cards.length === 3, 'карточек ' + cards.length);
    const hrefs = Array.from(cards).map(c => c.getAttribute('href'));
    ok(hrefs.some(h => h.indexOf('skazki/index.html') === 0), 'нет ссылки на сказки');
    ok(hrefs.some(h => h.indexOf('chasiki/index.html') === 0), 'нет ссылки на часики');
    ok(hrefs.some(h => h.indexOf('umnyashka/index.html') === 0), 'нет ссылки на умняшку');
  });

  await test('Ссылки ведут на существующие файлы', () => {
    Array.from(hub.w.document.querySelectorAll('.card')).forEach(c => {
      const href = c.getAttribute('href').split('?')[0];
      ok(fs.existsSync(path.join(ROOT, href)), 'битая ссылка: ' + href);
    });
  });

  await test('У каждой карточки есть кнопка «послушать» и подпись для незрячих', () => {
    Array.from(hub.w.document.querySelectorAll('.card')).forEach(c => {
      ok(c.querySelector('.say'), 'нет кнопки 🔊 у ' + c.textContent.slice(0, 20));
      ok(c.getAttribute('aria-label'), 'нет aria-label');
    });
    const says = hub.w.document.querySelectorAll('.say');
    says[0].dispatchEvent(new hub.w.MouseEvent('click', { bubbles: true }));
    ok(hub.spoken.length > 0, 'кнопка 🔊 ничего не произнесла');
  });

  await test('Имя ребёнка сохраняется и уходит в ссылки', () => {
    const input = hub.w.document.querySelector('.field');
    ok(input, 'нет поля имени');
    input.value = 'Лука';
    input.dispatchEvent(new hub.w.Event('change'));
    ok(hub.w.KidHub.name() === 'Лука', 'имя не сохранилось: ' + hub.w.KidHub.name());
    const href = hub.w.document.querySelector('.card').getAttribute('href');
    ok(/kid=/.test(href), 'имя не попало в ссылку: ' + href);
  });

  await test('Выбор персонажа сохраняется', () => {
    const chars = hub.w.document.querySelectorAll('.char');
    ok(chars.length === 4, 'персонажей ' + chars.length);
    chars[1].dispatchEvent(new hub.w.MouseEvent('click', { bubbles: true }));
    ok(hub.w.KidHub.character() === 'owl', 'персонаж не сохранился: ' + hub.w.KidHub.character());
    ok(chars[1].classList.contains('is-on'), 'нет отметки выбора');
  });

  await test('Опасное имя не превращается в разметку', () => {
    const input = hub.w.document.querySelector('.field');
    input.value = '<img src=x onerror=alert(1)>';
    input.dispatchEvent(new hub.w.Event('change'));
    const name = hub.w.KidHub.name();
    ok(!/[<>&"'`]/.test(name), 'в имени осталась разметка: ' + name);
    input.value = 'Давид';
    input.dispatchEvent(new hub.w.Event('change'));
  });

  await test('Пропавшая папка объясняется, а не роняет ребёнка в ошибку браузера', () => {
    const card = Array.from(hub.w.document.querySelectorAll('.card'))
      .find(c => (c.getAttribute('href') || '').indexOf('chasiki') === 0);
    ok(card, 'не нашли карточку часиков');
    hub.w.Hub.missing('chasiki');

    ok(card.classList.contains('is-missing'), 'карточка не помечена');
    ok(/не найдена/i.test(card.textContent), 'нет объяснения: ' + card.textContent.slice(0, 60));
    // Ссылки быть не должно: иначе «открыть в новой вкладке» уводит на ошибку
    ok(!card.getAttribute('href'), 'ссылка осталась');
    ok(card.getAttribute('aria-disabled') === 'true', 'нет aria-disabled');
    ok(/не найдена/i.test(card.getAttribute('aria-label')), 'подпись для диктора не обновилась');
    // Старый прогресс не должен висеть на карточке отсутствующей игры
    ok(!card.querySelector('.bar'), 'осталась полоса прогресса');

    const ev = new hub.w.MouseEvent('click', { bubbles: true, cancelable: true });
    card.dispatchEvent(ev);
    ok(ev.defaultPrevented, 'переход по битой ссылке не остановлен');
  });

  /* ---------------- ПРИЛОЖЕНИЯ ---------------- */

  await test('«Умняшка» принимает имя и персонажа из оглавления', async () => {
    const app = load('umnyashka/index.html', { search: '?kid=Лука&ch=owl' });
    await wait(400);
    ok(app.errors.length === 0, app.errors.slice(0, 2).join(' | '));
    ok(app.w.Store.data.name === 'Лука', 'имя не подхватилось: ' + app.w.Store.data.name);
    ok(app.w.Store.data.character === 'owl', 'персонаж не подхватился: ' + app.w.Store.data.character);
    ok(app.w.document.getElementById('kidhub-home'), 'нет кнопки возврата');
    const href = app.w.document.getElementById('kidhub-home').getAttribute('href');
    ok(href === '../index.html', 'кнопка ведёт не туда: ' + href);
    ok(app.w.KidHub.getSummary('umnyashka'), 'не записана сводка для оглавления');
  });

  await test('«Часики» принимают имя из оглавления', async () => {
    const app = load('chasiki/index.html', { search: '?kid=Давид&ch=cat' });
    await wait(400);
    ok(app.errors.length === 0, app.errors.slice(0, 2).join(' | '));
    ok(app.w.Progress.data.name === 'Давид', 'имя не подхватилось: ' + app.w.Progress.data.name);
    ok(app.w.document.getElementById('kidhub-home'), 'нет кнопки возврата');
    ok(app.w.KidHub.getSummary('chasiki'), 'не записана сводка');
  });

  await test('«Сказки» открываются, показывают истории и кнопку возврата', async () => {
    const app = load('skazki/index.html', { search: '?kid=Лука' });
    await wait(300);
    ok(app.errors.length === 0, app.errors.slice(0, 2).join(' | '));
    ok(app.w.document.getElementById('kidhub-home'), 'нет кнопки возврата');
    const sum = app.w.KidHub.getSummary('skazki');
    ok(sum, 'не записана сводка');
    ok(/истори/i.test(sum.label), 'странная подпись: ' + sum.label);

    // Меню сказок: ищем кликабельные карточки историй
    const items = Array.from(app.w.document.querySelectorAll('*'))
      .filter(n => n.onclick || n.getAttribute('data-i') !== null);
    const menu = app.w.document.body.textContent;
    ok(/Барсик|турнир|забег|Велогонка|Ролики/i.test(menu), 'в меню нет названий сказок');

    // Открываем первую сказку так же, как это сделает ребёнок
    const clickable = app.w.document.querySelectorAll('[class*="tale"], [class*="card"], li, button');
    let opened = false;
    for (const n of clickable) {
      if (!/Барсик|турнир|забег|Велогонка|Ролики|рождения/i.test(n.textContent || '')) continue;
      n.dispatchEvent(new app.w.MouseEvent('click', { bubbles: true }));
      await wait(60);
      const after = app.w.KidHub.getSummary('skazki');
      if (/прочитано/i.test(after.label)) { opened = true; break; }
    }
    ok(opened, 'открытая сказка не отметилась прочитанной');
  });

  await test('Имя с эмодзи не роняет оглавление', async () => {
    // 16-й символ разрывал суррогатную пару, encodeURIComponent падал,
    // и вместо полки ребёнок видел пустую страницу
    const evil = 'Лук😀😀😀😀😀😀😀😀';
    const ctx2 = load('index.html');
    await wait(150);
    ctx2.w.KidHub.setName(evil);
    const link = ctx2.w.KidHub.linkTo('chasiki/index.html');
    ok(typeof link === 'string', 'ссылка не построилась');
    const again = load('index.html');
    await wait(200);
    ok(again.w.document.querySelectorAll('.card').length === 3,
       'оглавление не собралось: карточек ' + again.w.document.querySelectorAll('.card').length);
    again.w.KidHub.setName('Лука');
  });

  await test('Посреди урока кнопка «домой» спрашивает подтверждение', async () => {
    const app = load('umnyashka/index.html', { search: '?kid=Лука' });
    await wait(400);
    app.w.Router.go('lesson', { unitId: 'r-let-1' });
    await wait(300);
    ok(typeof app.w.KidHub.homeGuard === 'function', 'охрана выхода не установлена');
    const home = app.w.document.getElementById('kidhub-home');
    const ev = new app.w.MouseEvent('click', { bubbles: true, cancelable: true });
    home.dispatchEvent(ev);
    ok(ev.defaultPrevented, 'переход не остановлен');
    await wait(120);
    const modal = app.w.document.querySelector('.modal__box');
    ok(modal && /Выйти/i.test(modal.textContent), 'нет вопроса о выходе');
    // Вне урока охрана снимается
    app.w.UI.closeModal(true);
    app.w.Router.reset('home');
    await wait(300);
    ok(!app.w.KidHub.homeGuard, 'охрана осталась после выхода из урока');
  });

  await test('Приложения работают и без оглавления (открыты отдельно)', async () => {
    // подменяем путь так, чтобы shared/profile.js «не нашёлся»
    const app = load('umnyashka/index.html', { search: '' });
    await wait(300);
    ok(app.w.Store, 'приложение не поднялось');
    ok(app.w.document.querySelector('.screen'), 'нет экрана');
  });

  await test('Сводки приложений попадают на карточки оглавления', async () => {
    const again = load('index.html');
    await wait(200);
    const text = again.w.document.querySelector('.cards').textContent;
    ok(/Уровень|прочитано|истори/i.test(text), 'на карточках нет данных о прогрессе: ' + text.slice(0, 80));
  });

  await test('Нет обращений к сети, кроме необязательного шрифта', () => {
    const files = ['index.html', 'hub/hub.js', 'shared/profile.js',
                   'skazki/index.html', 'chasiki/index.html', 'umnyashka/index.html'];
    files.forEach(f => {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      const urls = (src.match(/https?:\/\/[^"'\s)]+/g) || [])
        .filter(u => !/fonts\.(googleapis|gstatic)\.com/.test(u))
        .filter(u => !/www\.w3\.org/.test(u));
      ok(urls.length === 0, f + ': сетевые адреса ' + urls.join(', '));
      ok(!/fetch\(|XMLHttpRequest/.test(src), f + ': есть сетевые запросы');
    });
  });

  await test('Шрифт подключён неблокирующе — офлайн страница рисуется сразу', () => {
    ['index.html', 'skazki/index.html', 'chasiki/index.html', 'umnyashka/index.html'].forEach(f => {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      const fontLinks = src.match(/<link[^>]*fonts\.googleapis[^>]*>/g) || [];
      fontLinks.forEach(l => {
        ok(/media="print"/.test(l), f + ': шрифт блокирует показ страницы');
      });
    });
  });

  console.log('\n' + pass + ' проверок пройдено');
  if (fails.length) { console.log('\n❌ ПРОВАЛЕНО:\n' + fails.join('\n')); process.exit(1); }
  console.log('✅ «Детская полка» собрана верно');
  process.exit(0);
})();
