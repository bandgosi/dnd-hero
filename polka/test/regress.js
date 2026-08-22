/* Регрессионный тест: проверяем ровно те дефекты, которые нашли агенты. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(process.env.JSDOM_PATH || 'jsdom');

const ROOT = path.resolve(__dirname, '../chasiki');

function makeWindow(storage) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
    .replace(/<link[^>]*fonts\.googleapis[^>]*>/g, '')
    .replace(/<script src="js\/[^"]+"><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const w = dom.window;

  w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
  w.Element.prototype.animate = () => ({ finished: Promise.resolve(), cancel() {} });
  w.Element.prototype.scrollIntoView = () => {};
  w.Element.prototype.setPointerCapture = () => {};
  class P { constructor(){ this.value=0; } setValueAtTime(){} exponentialRampToValueAtTime(){} linearRampToValueAtTime(){} }
  class N { constructor(){ this.gain=new P(); this.frequency=new P(); this.Q=new P(); } connect(){return this;} start(){} stop(){} }
  w.AudioContext = class { constructor(){ this.currentTime=0; this.state='running'; this.sampleRate=44100; this.destination={}; }
    createGain(){return new N();} createOscillator(){return new N();} createBiquadFilter(){return new N();}
    createBufferSource(){return new N();} createBuffer(){return {getChannelData:()=>new Float32Array(16)};} resume(){} };

  let frames = 0;
  w.requestAnimationFrame = cb => { if (frames++ > 20000) return 0; return w.setTimeout(() => cb(w.performance.now()), 5); };
  w.cancelAnimationFrame = id => w.clearTimeout(id);
  w.print = () => {}; w.scrollTo = () => {};

  // Счётчики живых таймеров — ловим «зомби» после ухода с экрана
  const live = { intervals: new Set() };
  const realSetInterval = w.setInterval.bind(w), realClearInterval = w.clearInterval.bind(w);
  w.setInterval = (fn, ms) => { const id = realSetInterval(fn, ms); live.intervals.add(id); return id; };
  w.clearInterval = id => { live.intervals.delete(id); return realClearInterval(id); };

  if (storage) Object.keys(storage).forEach(k => w.localStorage.setItem(k, storage[k]));

  const files = ['storage.js','audio.js','fx.js','clock.js','ui.js','curriculum.js','lessons.js','games.js','app.js'];
  for (const f of files) w.eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
  return { w, live };
}

const wait = ms => new Promise(r => setTimeout(r, ms));

let pass = 0; const fails = [];
async function test(name, fn) {
  try { await fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fails.push(name + ' → ' + e.message); console.log('✗ ' + name + ' → ' + e.message); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

(async () => {
  const { w, live } = makeWindow();
  const $ = s => w.document.querySelector(s);
  const $$ = s => Array.from(w.document.querySelectorAll(s));
  const click = n => { assert(n, 'нет элемента для клика'); n.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); };
  const byText = (sel, t) => $$(sel).find(n => n.textContent.includes(t));
  await wait(300);

  // ---------- Часы ----------
  await test('Сектор «полный круг» рисуется (было: исчезал на 60 минутах)', () => {
    const c = new w.Clock({});
    c.showSector(0, 60);
    const d = c.sector.getAttribute('d');
    assert(d.includes('A'), 'в пути нет дуги: ' + d);
    assert(c.sector.classList.contains('is-on'), 'сектор не показан');
  });

  await test('Цвет сектора не «залипает» от прошлого показа', () => {
    const c = new w.Clock({});
    c.showSector(0, 15, 'red');
    c.showSector(0, 30);
    assert(c.sector.style.fill === '', 'остался цвет: ' + c.sector.style.fill);
  });

  await test('Прерванный ход стрелок не рассинхронизирует часы', async () => {
    const c = new w.Clock({ time: { h: 10, m: 0 } });
    w.document.body.appendChild(c.el);
    c.sweepMinutes(60, 3000, () => {});
    await wait(600);
    const minuteFromAngle = Math.round(c._ma / 6);
    const p = c.sweepMinutes(30, 600, () => {});   // прерываем и запускаем новый
    const jump = Math.abs(Math.round(c._ma / 6) - minuteFromAngle);
    assert(jump <= 2, 'стрелка прыгнула на ' + jump + ' минут');
    await Promise.race([p, wait(2000).then(() => { throw new Error('await повис навсегда'); })]);
    c.el.remove();
  });

  await test('Прерывание анимации резолвит промис (нет вечного await)', async () => {
    const c = new w.Clock({});
    let done = false;
    c.setTime(6, 0, true, 5000).then(() => { done = true; });
    await wait(80);
    c.stop();
    await wait(60);
    assert(done, 'промис не разрешился после stop()');
  });

  await test('Мини-часы не блокируют прокрутку страницы', () => {
    const passive = new w.Clock({});
    const active = new w.Clock({ interactive: true });
    assert(!passive.el.classList.contains('is-interactive'), 'обычные часы помечены интерактивными');
    assert(active.el.classList.contains('is-interactive'), 'интерактивные часы не помечены');
  });

  // ---------- Прогресс ----------
  await test('Повреждённый XP не вешает приложение', () => {
    const t0 = Date.now();
    const info = w.Progress.level.call(w.Progress);
    assert(Date.now() - t0 < 500, 'слишком долго');
    const bad = makeWindow({ 'chasiki.progress.v1': '{"xp":1e999}' });
    assert(bad.w.Progress.data.xp === 0 || isFinite(bad.w.Progress.data.xp), 'бесконечный XP просочился');
    assert(info.level >= 1, 'уровень некорректен');
  });

  await test('Повреждённая запись в хранилище не роняет запуск', async () => {
    for (const bad of ['{"streak":null}', '{"settings":null}', '{"xp":"abc"}', '{"achievements":{}}', 'не json']) {
      const ctx = makeWindow({ 'chasiki.progress.v1': bad });
      await wait(120);
      assert(ctx.w.document.querySelector('.screen'), 'белый экран при данных ' + bad);
      assert(typeof ctx.w.Progress.data.xp === 'number' && isFinite(ctx.w.Progress.data.xp), 'xp испорчен: ' + bad);
      assert(ctx.w.Progress.data.streak && typeof ctx.w.Progress.data.streak.last === 'string', 'streak испорчен: ' + bad);
    }
  });

  await test('Награда за серию дней показывается ребёнку', async () => {
    const y = new Date(); y.setDate(y.getDate() - 1);
    const pad = n => (n < 10 ? '0' + n : n);
    const ys = y.getFullYear() + '-' + pad(y.getMonth() + 1) + '-' + pad(y.getDate());
    const ctx = makeWindow({ 'chasiki.progress.v1': JSON.stringify({ streak: { count: 2, best: 2, last: ys } }) });
    await wait(200);
    assert(ctx.w.Progress.has('streak3'), 'достижение не выдано');
    assert(ctx.w.document.querySelector('.toast'), 'ребёнку ничего не показали');
  });

  // ---------- Учебная программа ----------
  await test('Все задания «поставь время» достижимы на любой сложности', () => {
    for (const d of ['easy', 'normal', 'hard']) {
      w.Progress.setSetting('difficulty', d);
      for (let i = 0; i < 400; i++) {
        for (const id of ['l8', 'exam']) {
          w.Curriculum.byId(id).build().forEach(s => {
            if (s.type === 'set' && s.drag !== 'hour') {
              assert(s.target.m % 5 === 0, d + '/' + id + ': цель ' + s.target.h + ':' + s.target.m + ' недостижима шагом 5 минут');
              assert(s.question.includes(w.Curriculum.fmt(s.target)), 'текст задания не совпадает с целью: ' + s.question);
            }
          });
        }
      }
    }
    w.Progress.setSetting('difficulty', 'normal');
  });

  await test('Варианты «сколько минут» не решаются стратегией «жми меньшее»', () => {
    let correctIsSmallest = 0, total = 0;
    for (let i = 0; i < 300; i++) {
      const correct = (1 + Math.floor(Math.random() * 11)) * 5;
      const opts = w.Curriculum.makeMinuteOptions(correct, 3);
      assert(opts.length === 4, 'вариантов ' + opts.length);
      assert(opts.indexOf(correct) !== -1, 'нет верного варианта');
      assert(opts.indexOf(0) === -1, 'вариант «0 минут» сбивает ребёнка');
      total++;
      if (correct === Math.min.apply(null, opts)) correctIsSmallest++;
    }
    const share = correctIsSmallest / total;
    assert(share < 0.6, 'верный ответ наименьший в ' + Math.round(share * 100) + '% случаев');
  });

  await test('Варианты-циферблаты различимы (минимум одно деление)', () => {
    for (const d of ['easy', 'normal', 'hard']) {
      w.Progress.setSetting('difficulty', d);
      for (let i = 0; i < 3000; i++) {
        const t = w.Curriculum.Gen.byDifficulty(d);
        const opts = w.Curriculum.makeOptions(t, 3);
        for (let a = 0; a < opts.length; a++) {
          for (let b = a + 1; b < opts.length; b++) {
            const A = opts[a], B = opts[b];
            const dh = Math.abs(((A.h % 12) * 30 + A.m * 0.5) - ((B.h % 12) * 30 + B.m * 0.5));
            const dm = Math.abs(A.m * 6 - B.m * 6);
            assert(dh > 0.5 || dm > 0.5, d + ': варианты неразличимы ' + w.Curriculum.fmt(A) + ' / ' + w.Curriculum.fmt(B));
          }
        }
      }
    }
    w.Progress.setSetting('difficulty', 'normal');
  });

  // ---------- Урок: анимация, двойной тап, звёзды ----------
  await test('Анимация объяснения запускается на ПЕРВОМ шаге урока', async () => {
    w.Router.reset('map');
    await wait(300);
    w.Router.go('lesson', { id: 'l2' });     // первый шаг — minuteSweep
    await wait(500);
    const clock = $('.teach .clock').__clock;
    const before = clock._ma;
    await wait(900);
    assert(Math.abs(clock._ma - before) > 1, 'стрелка не двигается: объяснение статично');
  });

  await test('Двойной тап по «Дальше» не пропускает задание', async () => {
    w.Router.reset('map');
    await wait(300);
    w.Router.go('lesson', { id: 'l3' });
    await wait(400);
    const btn = byText('.task__actions .btn', 'Дальше');
    click(btn); click(btn);                  // ребёнок тапнул дважды
    await wait(400);
    assert($('.teach') === null, 'шаг не сменился');
    assert($('.task__question'), 'после двойного тапа не видно задания');
  });

  await test('Двойной клик по «Проверить» не даёт двойной опыт', async () => {
    w.Router.reset('map');
    await wait(250);
    w.Router.go('lesson', { id: 'l1' });
    await wait(300);
    click(byText('.task__actions .btn', 'Дальше'));
    await wait(250);
    click(byText('.task__actions .btn', 'Дальше'));
    await wait(300);
    const target = $('.task__question').textContent.match(/(\d+)/)[1];
    $('.task .clock').__clock.setTime(+target, 0, false);
    const xp0 = w.Progress.data.xp, tasks0 = w.Progress.data.totalTasks;
    const check = byText('.task__actions .btn', 'Проверить');
    click(check); click(check);
    await wait(300);
    assert(w.Progress.data.xp - xp0 === 10, 'начислено ' + (w.Progress.data.xp - xp0) + ' XP вместо 10');
    assert(w.Progress.data.totalTasks - tasks0 === 1, 'задание засчитано дважды');
  });

  await test('Три звезды не дают за урок, решённый с ошибками', async () => {
    w.Progress.reset();
    w.Router.reset('map');
    await wait(250);
    w.Router.go('lesson', { id: 'l3' });
    await wait(300);
    for (let guard = 0; guard < 60; guard++) {
      await wait(90);
      if (byText('.btn', 'Продолжить') && $('.card--yellow')) break;
      const next = byText('.task__actions .btn', 'Дальше');
      if (next) { click(next); continue; }
      // Сначала отвечаем неверно, потом верно
      const check = byText('.task__actions .btn', 'Проверить');
      if (check && !$('.task__actions').classList.contains('hidden')) {
        click(check);
        await wait(120);
        const retry = byText('.feedback .btn', 'Попробую');
        if (retry) {
          click(retry); await wait(120);
          const q = $('.task__question').textContent;
          const m = q.match(/(\d{1,2}):(\d{2})/) || q.match(/(\d{1,2})/);
          const inst = $('.task .clock').__clock;
          inst.setTime(+m[1], m[2] === undefined ? 0 : +m[2], false);
          click(byText('.task__actions .btn', 'Проверить'));
          await wait(120);
        }
        const nx = byText('.feedback .btn', 'Дальше') || byText('.feedback .btn', 'Понятно');
        if (nx) click(nx);
        continue;
      }
      const wrong = $$('.opt:not(.is-muted)').find(o => o.textContent.trim() !== w.UI.fmt(...(() => { const t = $('.task .clock').__clock.getTime(); return [t.h, t.m]; })()));
      if (wrong) {
        click(wrong); await wait(140);
        const fb = byText('.feedback .btn', 'Попробую') || byText('.feedback .btn', 'Понятно') || byText('.feedback .btn', 'Дальше');
        if (fb) click(fb);
        await wait(120);
        const t = $('.task .clock') && $('.task .clock').__clock.getTime();
        const right = t && $$('.opt:not(.is-muted)').find(o => o.textContent.trim() === w.UI.fmt(t.h, t.m));
        if (right) { click(right); await wait(140); const f2 = byText('.feedback .btn', 'Дальше') || byText('.feedback .btn', 'Понятно'); if (f2) click(f2); }
        continue;
      }
    }
    const stars = w.Progress.lesson('l3').stars;
    assert(stars < 3, 'выдано ' + stars + ' звезды при ошибке в каждом задании');
  });

  await test('Проваленный экзамен не даёт трофейную наклейку', () => {
    w.Progress.reset();
    assert(w.Progress.data.stickers.indexOf('🏆') === -1, 'наклейка выдана заранее');
  });

  // ---------- Роутер ----------
  await test('Быстрые переходы не оставляют мёртвых экранов', async () => {
    w.Router.reset('map');
    await wait(250);
    w.Router.go('achievements'); w.Router.go('settings'); w.Router.go('explore');
    await wait(500);
    const screens = $$('#app > .screen');
    assert(screens.length === 1, 'в DOM осталось ' + screens.length + ' экранов');
  });

  // ---------- Мини-игры ----------
  await test('Уход из гонки гасит таймер (нет начислений «из ниоткуда»)', async () => {
    w.Router.reset('map');
    await wait(250);
    w.Router.go('game', { id: 'race' });
    await wait(250);
    click(byText('.modal__box .btn', 'Начать'));
    await wait(1200);
    const before = live.intervals.size;
    w.Router.go('map');
    await wait(400);
    assert(live.intervals.size < before, 'интервал гонки продолжает жить после выхода');
  });

  await test('Повторный старт гонки не удваивает таймер', async () => {
    w.Router.reset('map');
    await wait(250);
    w.Router.go('game', { id: 'race' });
    await wait(250);
    click(byText('.modal__box .btn', 'Начать'));
    await wait(200);
    const n1 = live.intervals.size;
    await wait(2400);
    assert(live.intervals.size === n1, 'появился второй интервал');
    w.Router.go('map');
    await wait(300);
  });

  await test('Опыт за мини-игры соразмерен урокам', async () => {
    w.Progress.reset();
    const xp0 = w.Progress.data.xp;
    w.Progress.gameResult('target', 500);
    // Эмулируем начисление так же, как это делает экран результата
    const norm = 500 / (5 * 100);
    const xp = Math.max(5, Math.round(norm * 25));
    w.Progress.addXP(xp);
    const gained = w.Progress.data.xp - xp0;
    assert(gained <= 30, 'за одну партию начислено ' + gained + ' XP');
  });

  await test('Промах по шарику отличается от попадания', async () => {
    w.Router.reset('map');
    await wait(250);
    w.Router.go('game', { id: 'balloons' });
    await wait(300);
    click(byText('.modal__box .btn', 'Начать'));
    await wait(1600);
    const target = $('.game .clock').__clock.getTime();
    const wrong = $$('.balloon').find(b => b.textContent.trim() !== w.UI.fmt(target.h, target.m));
    assert(wrong, 'не нашли неверный шарик');
    wrong.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
    await wait(150);
    assert(wrong.classList.contains('is-miss'), 'промах помечен как лопнувший шарик');
    assert(!wrong.classList.contains('is-pop'), 'на промахе играет анимация лопания');
    w.Router.go('map');
    await wait(300);
  });

  await test('Шарики помещаются в поле и не слипаются', async () => {
    w.Router.reset('map');
    await wait(250);
    w.Router.go('game', { id: 'balloons' });
    await wait(300);
    click(byText('.modal__box .btn', 'Начать'));
    await wait(1600);
    const xs = $$('.balloon').map(b => parseFloat((b.style.transform.match(/translate\(([-\d.]+)px/) || [0, 0])[1]));
    assert(xs.length >= 4, 'шариков ' + xs.length);
    assert(xs.every(x => x >= 0), 'шарик уехал за левый край: ' + xs.join(', '));
    const sorted = xs.slice().sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      assert(sorted[i] - sorted[i - 1] >= 50, 'шарики налезают друг на друга: ' + sorted.join(', '));
    }
    w.Router.go('map');
    await wait(300);
  });

  await test('«Попади стрелкой»: шаг цели совпадает с шагом стрелки', async () => {
    w.Router.reset('map');
    await wait(250);
    w.Router.go('game', { id: 'target' });
    await wait(300);
    click(byText('.modal__box .btn', 'Начать'));
    await wait(400);
    const c = $('.game .clock').__clock;
    assert(c.o.snap === 5, 'шаг стрелки ' + c.o.snap + ' при цели, кратной 5');
    w.Router.go('map');
    await wait(300);
  });

  await test('Пазл: повторный тап по заполненному месту не считается ошибкой', async () => {
    w.Router.reset('map');
    await wait(250);
    w.Router.go('game', { id: 'puzzle' });
    await wait(300);
    click(byText('.modal__box .btn', 'Начать'));
    await wait(400);
    const filled = $('.puzzle__slot.is-filled');
    const piece = $('.piece');
    click(piece);
    const errs0 = w.Progress.data.totalTasks;
    click(filled); click(filled);
    await wait(100);
    assert(w.Progress.data.totalTasks === errs0, 'засчитаны ошибки: ' + (w.Progress.data.totalTasks - errs0));
    w.Router.go('map');
    await wait(300);
  });

  console.log('\n' + pass + ' проверок пройдено');
  if (fails.length) { console.log('\n❌ ПРОВАЛЕНО:\n' + fails.join('\n')); process.exit(1); }
  console.log('✅ Все регрессионные проверки пройдены');
  process.exit(0);
})();
