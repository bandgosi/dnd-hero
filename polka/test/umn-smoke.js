/* Интеграционный тест «Умняшки»: грузим ровно то, что грузит index.html. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(process.env.JSDOM_PATH || 'jsdom');

const ROOT = path.resolve(__dirname, '../umnyashka');

function scriptsFromIndex() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g)).map(m => m[1]);
}

function boot(storage) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
    .replace(/<link[^>]*>/g, '')
    .replace(/<script src="[^"]+"><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const w = dom.window;

  w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
  w.Element.prototype.animate = () => ({ finished: Promise.resolve(), cancel() {} });
  w.Element.prototype.scrollIntoView = () => {};
  w.Element.prototype.setPointerCapture = () => {};
  w.Element.prototype.releasePointerCapture = () => {};
  w.scrollTo = () => {};
  w.print = () => {};
  w.URL.createObjectURL = () => 'blob:x';
  w.URL.revokeObjectURL = () => {};

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

  const live = { intervals: new Set(), rafs: 0 };
  const si = w.setInterval.bind(w), ci = w.clearInterval.bind(w);
  w.setInterval = (fn, ms) => { const id = si(fn, ms); live.intervals.add(id); return id; };
  w.clearInterval = id => { live.intervals.delete(id); return ci(id); };
  let rafOn = true;
  w.requestAnimationFrame = cb => { live.rafs++; return w.setTimeout(() => { if (rafOn) cb(w.performance.now()); }, 6); };
  w.cancelAnimationFrame = id => w.clearTimeout(id);

  if (storage) Object.keys(storage).forEach(k => w.localStorage.setItem(k, storage[k]));

  const errors = [];
  const orig = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); };

  for (const src of scriptsFromIndex()) {
    try { w.eval(fs.readFileSync(path.join(ROOT, src), 'utf8')); }
    catch (e) { errors.push(`Ошибка загрузки ${src}: ${e.message}`); }
  }
  console.error = orig;

  return { w, errors, spoken, live };
}

const wait = ms => new Promise(r => setTimeout(r, ms));
let pass = 0; const fails = [];
async function test(name, fn) {
  try { await fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fails.push(name + ' → ' + e.message); console.log('✗ ' + name + ' → ' + e.message); }
}
const ok = (c, m) => { if (!c) throw new Error(m); };

(async () => {
  const ctx = boot();
  const { w } = ctx;
  const $ = s => w.document.querySelector(s);
  const $$ = s => Array.from(w.document.querySelectorAll(s));
  const click = n => { ok(n, 'нет элемента для клика'); n.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); };
  const byText = (sel, t) => $$(sel).find(n => n.textContent.includes(t));

  await wait(400);

  await test('Приложение стартует без ошибок в консоли', () => {
    ok(ctx.errors.length === 0, 'ошибки: ' + ctx.errors.join(' | '));
    ok($('.screen'), 'экран не отрисован');
  });

  await test('Первый запуск: выбор персонажа и имени', () => {
    ok($('.welcome'), 'нет экрана приветствия');
    ok($$('.char').length === 4, 'персонажей ' + $$('.char').length);
    ok($('input.field'), 'нет поля имени');
  });

  await test('Данные загружены полностью', () => {
    ok(w.Alphabet.LETTERS.length === 33, 'букв ' + w.Alphabet.LETTERS.length);
    ok(w.Words.WORDS.length >= 90, 'слов ' + w.Words.WORDS.length);
    ok(w.Sentences.SENTENCES.length >= 24, 'предложений ' + w.Sentences.SENTENCES.length);
    ok(w.Numbers.DIGITS.length === 10, 'цифр ' + w.Numbers.DIGITS.length);
    ok(w.Curriculum.ALL.length >= 30, 'юнитов ' + w.Curriculum.ALL.length);
    ok(w.Games.LIST.length === 8, 'игр ' + w.Games.LIST.length);
  });

  await test('Все типы заданий из программы зарегистрированы', () => {
    const missing = [];
    w.Curriculum.ALL.forEach(u => u.types.forEach(t => { if (!w.Tasks.has(t)) missing.push(u.id + '/' + t); }));
    ok(!missing.length, 'нет типов: ' + missing.join(', '));
  });

  await test('Все навыки юнитов имеют данные (build не падает)', () => {
    const bad = [];
    w.Curriculum.ALL.forEach(u => {
      u.skills.forEach(sk => {
        u.types.forEach(t => {
          const def = w.Tasks.get(t);
          if (!def) return;
          try { def.build(sk, 1, u); } catch (e) { bad.push(u.id + '/' + t + '/' + sk + ': ' + e.message); }
        });
      });
    });
    ok(!bad.length, bad.slice(0, 5).join(' | '));
  });

  await test('Траектории письма разбираются для всех букв и цифр', () => {
    let minPts = 1e9;
    w.Alphabet.LETTERS.forEach(L => {
      ok(L.strokes.length >= 1 && L.strokes.length <= 4, L.ch + ': штрихов ' + L.strokes.length);
      L.strokes.forEach(s => {
        const pts = w.Tracing.samplePath(s.d);
        ok(pts.length > 3, L.ch + ': путь не разобрался');
        minPts = Math.min(minPts, pts.length);
        const d0 = Math.hypot(pts[0].x - s.from[0], pts[0].y - s.from[1]);
        ok(d0 < 1, L.ch + ': from не совпадает с началом пути (' + d0.toFixed(2) + ')');
        pts.forEach(p => ok(p.x >= -2 && p.x <= 102 && p.y >= -2 && p.y <= 102,
          L.ch + ': точка вне поля ' + p.x.toFixed(0) + ',' + p.y.toFixed(0)));
      });
    });
    w.Numbers.DIGITS.concat(w.Numbers.SIGNS).forEach(D => {
      D.strokes.forEach(s => {
        const pts = w.Tracing.samplePath(s.d);
        ok(pts.length > 3, (D.n !== undefined ? D.n : D.s) + ': путь не разобрался');
      });
    });
    ok(minPts >= 5, 'слишком короткий штрих: ' + minPts + ' точек');
  });

  // Переход в приложение
  click(byText('.btn', 'Начать') || byText('.btn', 'Продолжить'));
  await wait(400);

  await test('Главный экран: два блока и тренировка дня', () => {
    ok($('.home'), 'нет главного экрана');
    ok($$('.bigcard').length === 2, 'блоков ' + $$('.bigcard').length);
    ok($$('.daily__item').length >= 3, 'пунктов тренировки ' + $$('.daily__item').length);
    ok($$('.tile').length === 4, 'плиток ' + $$('.tile').length);
  });

  await test('Карта уроков чтения открывается, закрыт только первый уровень', () => {
    w.Router.go('path', { track: 'reading' });
    return wait(300).then(() => {
      ok($('.pathscreen'), 'нет карты');
      ok($$('.unit').length === w.Curriculum.READING.length, 'юнитов ' + $$('.unit').length);
      ok($('.unit.is-now'), 'не подсвечен текущий урок');
      ok($$('.unit.is-locked').length === w.Curriculum.READING.length - 1, 'открыто лишнее');
    });
  });

  /* ---- Проходим урок целиком, отвечая верно ---- */
  async function playLesson(unitId, mode) {
    w.Router.go('lesson', { unitId });
    await wait(350);
    for (let guard = 0; guard < 90; guard++) {
      await wait(60);
      if ($('.result')) return true;

      const next = byText('.actions .btn', 'Дальше');
      if (next) { click(next); continue; }

      const check = byText('.actions .btn', 'Проверить');
      if (check && !$('.actions').classList.contains('hidden')) {
        const holder = $('[data-answer]') || $('.rt-build') || $('.mt-slots');
        if (holder && holder.__fill) holder.__fill(mode === 'right');
        click(check);
        await wait(90);
        const fb = byText('.feedback .btn', 'Дальше') || byText('.feedback .btn', 'Понятно') || byText('.feedback .btn', 'Ещё раз');
        if (fb) click(fb); else return false;
        continue;
      }

      const opts = $$('.opt').filter(o => !o.classList.contains('is-dim'));
      if (opts.length) {
        const right = opts.find(o => o.dataset.ok === '1' || o.dataset.ok === 'true');
        const target = mode === 'right' ? (right || opts[0]) : (opts.find(o => o !== right) || opts[0]);
        // Задание «какой звук»: сначала слушаем плитку, только потом отвечаем галочкой
        const play = target.querySelector('[data-role="play"]');
        const pick = target.querySelector('[data-role="pick"]');
        if (play && pick) {
          click(play);
          await wait(40);
          click(pick);
        } else {
          click(target);
        }
        await wait(110);
        const fb = byText('.feedback .btn', 'Дальше') || byText('.feedback .btn', 'Понятно') || byText('.feedback .btn', 'Ещё раз');
        if (fb) click(fb);
        continue;
      }

      // задание на письмо: доводим штрихи программно
      const trace = $('.trace');
      if (trace && trace.parentNode && trace.parentNode.widget) {
        const wdg = trace.parentNode.widget;
        for (let k = 0; k < 6 && !wdg.isFinished(); k++) wdg.autoStroke();
        await wait(500);
        const fb = byText('.feedback .btn', 'Дальше');
        if (fb) click(fb);
        continue;
      }
    }
    return !!$('.result');
  }

  await test('Урок «Первые буквы» проходится до конца', async () => {
    const done = await playLesson('r-let-1', 'right');
    ok(done, 'урок не дошёл до итогового экрана');
    ok(w.Store.unit('r-let-1').done, 'юнит не отмечен пройденным');
    ok(w.Store.data.xp > 0, 'опыт не начислен');
  });

  await test('После урока открылся следующий и появились награды', () => {
    ok(w.Curriculum.isOpen('r-wr-1'), 'следующий юнит не открылся');
    ok(w.Store.data.achievements.length > 0, 'нет достижений');
  });

  await test('Урок письма проходится (траектории отрабатываются)', async () => {
    const done = await playLesson('r-wr-1', 'right');
    ok(done, 'урок письма не завершился');
    ok(w.Store.unit('r-wr-1').done, 'юнит письма не засчитан');
  });

  await test('Математика: первый урок проходится', async () => {
    const done = await playLesson('m-dig-1', 'right');
    ok(done, 'урок математики не завершился');
    ok(w.Store.unit('m-dig-1').done, 'юнит не засчитан');
  });

  await test('Адаптивность: слабый навык попадает в очередь чаще', () => {
    const s = w.Skills.get('letter:М');
    s.attempts = 8; s.correct = 3; s.accuracy = 0.42; s.introduced = true; s.mastered = false;
    const strong = w.Skills.get('letter:А');
    strong.attempts = 10; strong.correct = 10; strong.accuracy = 0.98; strong.introduced = true; strong.mastered = true;
    w.Store.save();
    ok(w.Skills.isWeak('letter:М'), 'слабый навык не распознан');
    ok(w.Skills.weight('letter:М') > w.Skills.weight('letter:А') * 1.5, 'вес слабого навыка не выше');
    let hitsWeak = 0;
    for (let i = 0; i < 40; i++) {
      const q = w.SRS.buildQueue({ pool: w.Curriculum.byId('r-let-1').skills, size: 8 });
      if (q.some(x => x.id === 'letter:М')) hitsWeak++;
    }
    ok(hitsWeak > 30, 'слабый навык попал в очередь только ' + hitsWeak + ' раз из 40');
  });

  await test('Интервальное повторение планирует показ', () => {
    const s = w.Skills.get('letter:О');
    s.box = 0; s.introduced = true; s.lastShownAt = 0;
    w.SRS.schedule(s, true);
    const first = s.dueAt;
    ok(s.box === 1, 'ступень не выросла');
    // Второй верный ответ сразу же ступень НЕ повышает: навык должен «отлежаться»
    w.SRS.schedule(s, true);
    ok(s.box === 1, 'ступень выросла без выдержки времени');
    s.lastShownAt = Date.now() - w.SRS.INTERVALS[1];
    w.SRS.schedule(s, true);
    ok(s.box === 2 && s.dueAt > first, 'интервал не вырос после выдержки');
    const before = s.box;
    w.SRS.schedule(s, false);
    ok(s.box < before, 'ошибка не вернула навык в тренировку');
  });

  await test('Все 8 мини-игр запускаются и рисуют поле', async () => {
    for (const g of w.Games.ids()) {
      w.Router.go('game', { id: g });
      await wait(240);
      const start = byText('.modal__box .btn', 'Начать');
      ok(start, g + ': нет окна правил');
      click(start);
      await wait(320);
      ok($('.game'), g + ': нет экрана игры');
      ok($('.game__area').children.length > 0, g + ': пустое поле');
      w.Router.go('home');
      await wait(260);
    }
  });

  await test('После выхода из игр не осталось живых таймеров', async () => {
    await wait(400);
    ok(ctx.live.intervals.size <= 1, 'живых интервалов: ' + ctx.live.intervals.size);
  });

  await test('Все экраны открываются', async () => {
    for (const r of ['games', 'progress', 'rewards', 'settings', 'parentgate', 'home']) {
      w.Router.go(r);
      await wait(220);
      ok($('.screen'), r + ': пусто');
    }
  });

  await test('Родительский раздел защищён примером', async () => {
    w.Router.go('parentgate');
    await wait(250);
    const inp = $('.field--num');
    ok(inp, 'нет поля ответа');
    const q = $('.t-hero').textContent.match(/(\d+)\s*\+\s*(\d+)/);
    ok(q, 'нет примера');
    inp.value = String(Number(q[1]) + Number(q[2]) + 1);   // заведомо неверно
    click(byText('.btn', 'Войти'));
    await wait(150);
    ok(!$('.parent'), 'пустили с неверным ответом');
    inp.value = String(Number(q[1]) + Number(q[2]));
    click(byText('.btn', 'Войти'));
    await wait(320);
    ok($('.parent'), 'не пустили с верным ответом');
    ok($$('.stat').length === 4, 'нет сводки');
    ok($('.week'), 'нет графика недели');
  });

  await test('Прогресс сохраняется и переживает перезапуск', async () => {
    const raw = w.localStorage.getItem('umnyashka.profile.v1');
    ok(raw, 'ничего не сохранено');
    const again = boot({ 'umnyashka.profile.v1': raw });
    await wait(350);
    ok(again.w.Store.unit('r-let-1').done, 'прогресс не восстановился');
    ok(again.w.Store.data.xp > 0, 'опыт потерян');
    ok(again.w.document.querySelector('.home'), 'вернувшийся ребёнок не попал на главный экран');
  });

  await test('Повреждённый профиль не роняет запуск', async () => {
    for (const bad of ['{"skills":null}', '{"xp":"nope"}', '{"settings":null}', 'не json', '{"streak":null}']) {
      const c = boot({ 'umnyashka.profile.v1': bad });
      await wait(260);
      ok(c.w.document.querySelector('.screen'), 'белый экран при ' + bad);
      ok(typeof c.w.Store.data.xp === 'number' && isFinite(c.w.Store.data.xp), 'xp испорчен при ' + bad);
    }
  });

  await test('Ни одной ошибки в консоли за весь прогон', () => {
    ok(ctx.errors.length === 0, ctx.errors.slice(0, 3).join(' | '));
  });

  console.log('\n' + pass + ' проверок пройдено');
  if (fails.length) { console.log('\n❌ ПРОВАЛЕНО:\n' + fails.join('\n')); process.exit(1); }
  console.log('✅ Интеграционный тест пройден');
  process.exit(0);
})();
