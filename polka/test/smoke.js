/* Дымовой тест: прогоняем приложение в jsdom и ловим ошибки выполнения. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(process.env.JSDOM_PATH || 'jsdom');

const ROOT = path.resolve(__dirname, '../chasiki');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .replace(/<link[^>]*fonts\.googleapis[^>]*>/g, '')
  .replace(/<script src="js\/[^"]+"><\/script>/g, '');

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const w = dom.window;

const errors = [];
w.addEventListener('error', e => errors.push('window error: ' + e.message));

// --- Заглушки браузерных API, которых нет в jsdom ---
w.HTMLCanvasElement.prototype.getContext = function () {
  return new Proxy({}, { get: () => () => {} });
};
w.Element.prototype.animate = function () { return { finished: Promise.resolve(), cancel() {} }; };
w.Element.prototype.scrollIntoView = function () {};
w.Element.prototype.setPointerCapture = function () {};
class FakeAudioParam { constructor(){ this.value = 0; } setValueAtTime(){} exponentialRampToValueAtTime(){} linearRampToValueAtTime(){} }
class FakeNode { constructor(){ this.gain = new FakeAudioParam(); this.frequency = new FakeAudioParam(); this.Q = new FakeAudioParam(); }
  connect(){ return this; } start(){} stop(){} }
w.AudioContext = class { constructor(){ this.currentTime = 0; this.state = 'running'; this.sampleRate = 44100; this.destination = {}; }
  createGain(){ return new FakeNode(); } createOscillator(){ return new FakeNode(); }
  createBiquadFilter(){ return new FakeNode(); } createBufferSource(){ return new FakeNode(); }
  createBuffer(){ return { getChannelData: () => new Float32Array(16) }; } resume(){} };

// Считаем кадры анимации, но не даём им зациклиться навсегда
let frames = 0;
w.requestAnimationFrame = cb => { if (frames++ > 4000) return 0; return w.setTimeout(() => cb(w.performance.now()), 5); };
w.cancelAnimationFrame = id => w.clearTimeout(id);
w.print = () => {};
w.scrollTo = () => {};

const origError = console.error;
console.error = (...a) => { errors.push('console.error: ' + a.join(' ')); origError(...a); };

// --- Загружаем скрипты по порядку ---
const files = ['storage.js','audio.js','fx.js','clock.js','ui.js','curriculum.js','lessons.js','games.js','app.js'];
for (const f of files) {
  try {
    w.eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
  } catch (e) {
    errors.push(`Ошибка загрузки ${f}: ${e.message}\n${e.stack}`);
  }
}

const $ = sel => w.document.querySelector(sel);
const $$ = sel => Array.from(w.document.querySelectorAll(sel));
const wait = ms => new Promise(r => setTimeout(r, ms));
const click = node => { if (!node) throw new Error('нет элемента для клика'); node.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); };
const byText = (sel, txt) => $$(sel).find(n => n.textContent.includes(txt));

(async () => {
  const log = [];
  const step = (name, fn) => { try { fn(); log.push('✓ ' + name); } catch (e) { errors.push(`✗ ${name}: ${e.message}`); } };

  await wait(400);
  step('Экран приветствия отрисован', () => {
    if (!$('.welcome')) throw new Error('нет .welcome');
    if (!$('.clock svg')) throw new Error('нет SVG часов');
  });

  // Проверяем математику часов
  step('Углы стрелок считаются верно', () => {
    const c = new w.Clock({ time: { h: 3, m: 30 } });
    const hourT = c.gHour.getAttribute('transform');
    const minT = c.gMin.getAttribute('transform');
    if (!hourT.includes('105.00')) throw new Error('часовая стрелка при 3:30 должна быть 105°, а не ' + hourT);
    if (!minT.includes('180.00')) throw new Error('минутная стрелка при :30 должна быть 180°, а не ' + minT);
  });

  step('setTime нормализует 0 часов в 12', () => {
    const c = new w.Clock({});
    c.setTime(0, 5, false);
    if (c.getTime().h !== 12) throw new Error('получили ' + c.getTime().h);
  });

  step('Варианты ответов уникальны и содержат правильный', () => {
    for (let i = 0; i < 200; i++) {
      const t = w.Curriculum.Gen.five();
      const opts = w.Curriculum.makeOptions(t, 3);
      if (opts.length !== 4) throw new Error('вариантов ' + opts.length);
      const keys = new Set(opts.map(o => o.h + ':' + o.m));
      if (keys.size !== 4) throw new Error('есть повторы: ' + [...keys].join(', '));
      if (!opts.some(o => o.h === t.h && o.m === t.m)) throw new Error('нет правильного варианта');
      if (opts.some(o => o.h < 1 || o.h > 12 || o.m < 0 || o.m > 59)) throw new Error('вариант вне диапазона');
    }
  });

  step('Все уроки собираются без ошибок', () => {
    for (const lesson of w.Curriculum.LESSONS) {
      const steps = lesson.build();
      if (!steps.length) throw new Error(lesson.id + ': пустой урок');
      steps.forEach((s, i) => {
        if (s.type === 'read' || s.type === 'pick') {
          if (!s.options.some(o => o.h === s.time.h && o.m === s.time.m))
            throw new Error(`${lesson.id} шаг ${i}: среди вариантов нет верного`);
        }
        if (s.type === 'minutes' && s.options.indexOf(s.m) === -1)
          throw new Error(`${lesson.id} шаг ${i}: нет верного количества минут`);
      });
    }
    const exam = w.Curriculum.byId('exam').build();
    if (exam.length !== 20) throw new Error('в экзамене ' + exam.length + ' заданий вместо 20');
  });

  step('Формат времени', () => {
    if (w.UI.fmt(3, 5) !== '3:05') throw new Error(w.UI.fmt(3, 5));
    if (w.UI.fmt(12, 0) !== '12:00') throw new Error(w.UI.fmt(12, 0));
    if (w.UI.fmt(0, 30) !== '12:30') throw new Error(w.UI.fmt(0, 30));
  });

  // Переход на карту
  click(byText('.btn', 'Начать') || byText('.btn', 'Продолжить'));
  await wait(400);
  step('Карта уровней открылась', () => {
    if (!$('.map')) throw new Error('нет .map');
    if ($$('.node').length !== 10) throw new Error('узлов ' + $$('.node').length);
    if ($$('.game-card').length !== 5) throw new Error('мини-игр ' + $$('.game-card').length);
    if (!$('.node.is-current')) throw new Error('не подсвечен текущий уровень');
    if ($$('.node.is-locked').length !== 9) throw new Error('заблокировано ' + $$('.node.is-locked').length + ' вместо 9');
  });

  // Урок 1
  click($('.node.is-current .node__btn'));
  await wait(400);
  step('Урок открылся на шаге объяснения', () => {
    if (!$('.lesson')) throw new Error('нет .lesson');
    if (!$('.teach')) throw new Error('нет объяснения');
  });

  /** Разобрать цель задания из текста вопроса. */
  function parseTarget(q) {
    let m = q.match(/(\d{1,2}):(\d{2})/);
    if (m) return { h: +m[1], m: +m[2] };
    m = q.match(/(\d{1,2})\s*(час|часов|часа)/);
    if (m) return { h: +m[1], m: 0 };
    m = q.match(/(\d{1,2})\s*минут/);
    if (m) return { m: +m[1] };
    return null;
  }

  // Проходим весь урок 1: объяснения -> задания, отвечая ВЕРНО
  let guard = 0, solvedSet = 0, wrongFeedback = 0;
  while (guard++ < 60) {
    await wait(110);
    if ($('.card--yellow') && byText('.btn', 'Продолжить')) break;   // финальный экран
    const nextBtn = byText('.task__actions .btn', 'Дальше');
    if (nextBtn) { click(nextBtn); continue; }

    const checkBtn = byText('.task__actions .btn', 'Проверить');
    if (checkBtn && !$('.task__actions').classList.contains('hidden')) {
      const target = parseTarget($('.task__question').textContent);
      const inst = $('.task .clock').__clock;
      if (target) inst.setTime(target.h === undefined ? inst.getTime().h : target.h,
                               target.m === undefined ? inst.getTime().m : target.m, false);
      click(checkBtn);
      await wait(120);
      if (byText('.feedback .btn', 'Дальше')) { solvedSet++; click(byText('.feedback .btn', 'Дальше')); }
      else { wrongFeedback++; const fb = byText('.feedback .btn', 'Понятно') || byText('.feedback .btn', 'Попробую'); if (fb) click(fb); }
      continue;
    }

    // Вопрос с вариантами: выбираем верный по тексту вопроса/циферблата
    const opts = $$('.opt:not(.is-muted)');
    if (opts.length) {
      const t = $('.task .clock').__clock.getTime();
      const want = w.UI.fmt(t.h, t.m);
      const right = opts.find(o => o.textContent.trim() === want) || opts[0];
      click(right);
      await wait(150);
      const fb = byText('.feedback .btn', 'Дальше') || byText('.feedback .btn', 'Понятно') || byText('.feedback .btn', 'Попробую');
      if (fb) click(fb);
      continue;
    }
  }
  step('Задания «поставь стрелки» засчитываются как верные', () => {
    if (solvedSet < 5) throw new Error('верно решено только ' + solvedSet + ' из 5 заданий со стрелками');
    if (wrongFeedback > 0) throw new Error('правильный ответ был засчитан как ошибка ' + wrongFeedback + ' раз');
  });
  step('Урок 1 доходит до финального экрана', () => {
    if (!byText('.btn', 'Продолжить')) throw new Error('не дошли до конца за 40 шагов');
    if (!w.Progress.isDone('l1')) throw new Error('урок не отмечен пройденным');
    if (w.Progress.data.xp <= 0) throw new Error('не начислен опыт');
  });

  step('Прогресс сохраняется в localStorage', () => {
    const raw = w.localStorage.getItem('chasiki.progress.v1');
    if (!raw) throw new Error('нет записи');
    const d = JSON.parse(raw);
    if (!d.lessons.l1) throw new Error('нет данных урока');
  });

  // Возврат на карту: второй уровень должен открыться
  click(byText('.btn', 'Продолжить'));
  await wait(400);
  step('Второй уровень разблокирован', () => {
    if ($$('.node.is-locked').length !== 8) throw new Error('заблокировано ' + $$('.node.is-locked').length);
  });

  // Мини-игры
  for (const g of ['balloons', 'train', 'puzzle', 'target', 'race']) {
    w.Router.go('game', { id: g });
    await wait(250);
    step('Мини-игра ' + g + ' запускается', () => {
      const start = byText('.modal__box .btn', 'Начать');
      if (!start) throw new Error('нет окна с правилами');
      click(start);
    });
    await wait(400);
    step('Мини-игра ' + g + ' отрисовала поле', () => {
      if (!$('.game')) throw new Error('нет экрана игры');
    });
  }

  // Остальные экраны
  for (const r of ['explore', 'settings', 'achievements', 'diploma', 'map']) {
    w.Router.go(r);
    await wait(300);
    step('Экран ' + r + ' отрисован', () => {
      if (!$('.screen')) throw new Error('пусто');
    });
  }

  await wait(300);
  console.log('\n' + log.join('\n'));
  if (errors.length) {
    console.log('\n❌ ОШИБКИ (' + errors.length + '):\n' + errors.join('\n---\n'));
    process.exit(1);
  }
  console.log('\n✅ Все проверки пройдены');
  process.exit(0);
})();
