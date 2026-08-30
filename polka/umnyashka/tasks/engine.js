/* =========================================================
   tasks/engine.js — движок урока.
   Собирает очередь навыков через SRS, показывает задания,
   проверяет ответы, ведёт звёзды, XP и повторение.

   Типы заданий регистрируются так:
     Tasks.register('findLetter', {
       section: 'letters',
       needsCheck: false,          // true → появится кнопка «Проверить»
       teach: false,               // true → это объяснение, ответа нет
       build: function (skillId, level) { return {prompt, speak, ...}; },
       render: function (data, api) { return node; }
     });
   ========================================================= */
(function (global) {
  'use strict';

  var el = function () { return UI.el.apply(null, arguments); };
  var TYPES = {};

  /* Какой тип «знакомит» с новым навыком раздела */
  var LEARN_FOR = {
    letters: 'learnLetter',
    syllables: 'learnSyllable',
    words: 'learnWord',
    sentences: 'learnSentence',
    digits: 'learnDigit',
    count: 'learnCount',
    /* космос: знакомство с темой или планетой */
    spBasics: 'learnSpace',
    spStars: 'learnSpace',
    spFlight: 'learnSpace',
    spPlanets: 'learnPlanet',
    /* мой мир: карточка животного/страны/темы */
    wAnimals: 'learnWorld',
    wNature: 'learnWorld',
    wWeather: 'learnWorld',
    wBody: 'learnWorld',
    wPlanet: 'learnWorld',
    wCountries: 'learnWorld',
    wJobs: 'learnWorld',
    wTransport: 'learnWorld',
    wCity: 'learnWorld',
    wScience: 'learnWorld'
  };

  var Tasks = {
    TYPES: TYPES,
    register: function (name, def) { TYPES[name] = def; TYPES[name].name = name; },
    get: function (name) { return TYPES[name]; },
    has: function (name) { return !!TYPES[name]; }
  };

  /* =====================================================
     Экран урока
     ===================================================== */
  function LessonScreen(params) {
    var unit = Curriculum.byId(params.unitId);
    if (!unit) { Router.go('home', {}, { replace: true }); return UI.screen(''); }

    // Разделам письма нужно больше повторов на букву, чем одно касание
    var isWrite = unit.section === 'writeLetters' || unit.section === 'writeDigits';
    var size = params.size || unit.size || (isWrite ? Math.min(12, unit.skills.length * 2) : 9);
    var queue = SRS.buildQueue({ pool: unit.skills, size: size, newLimit: params.newLimit === undefined ? 2 : params.newLimit });
    // Возврат навыка после ошибки не должен удлинять урок бесконечно
    var maxLen = queue.length + 3;
    Skills.startLesson(unit.skills);

    var idx = 0, attempts = 0;
    var solved = 0, firstTry = 0, answered = 0;
    var xpEarned = 0;
    var startedAt = Date.now();
    var finished = false;

    var screen = UI.screen('lesson t-' + (unit.track === 'math' ? 'math' : 'read'));

    // Кнопка «домой» из общего оглавления не должна выдёргивать ребёнка
    // из урока одним случайным касанием
    if (global.KidHub) {
      KidHub.homeGuard = function (go) {
        UI.modal({
          emoji: '🏠', title: 'Выйти ко всем играм?',
          text: 'Урок не закончен — он не сохранится.',
          actions: [
            { label: 'Остаться', variant: 'grass' },
            { label: 'Выйти', variant: 'ghost', onClick: go }
          ]
        });
      };
    }

    screen.__onLeave = function () {
      Speech.stop();
      if (global.KidHub) KidHub.homeGuard = null;
      var min = (Date.now() - startedAt) / 60000;
      if (min > 0.05 && min < 90) Store.addMinutes(Math.min(min, 30));
    };

    var barFill = UI.bar(0);
    var scoreChip = UI.chip('0', 'sun', '⭐');
    var top = el('div', { class: 'topbar' }, [
      UI.iconBtn('✕', confirmExit, 'Выйти'),
      el('div', { class: 'grow' }, [barFill]),
      scoreChip
    ]);

    var head = el('div', { class: 'lesson__head' });
    var body = el('div', { class: 'lesson__body' });
    var actions = el('div', { class: 'actions' });

    screen.appendChild(top);
    screen.appendChild(head);
    screen.appendChild(body);
    screen.appendChild(actions);

    function confirmExit() {
      UI.modal({
        emoji: '🚪', title: 'Закончить урок?',
        text: 'Ты сможешь вернуться и пройти его снова.',
        actions: [
          { label: 'Остаться', variant: 'grass' },
          { label: 'Выйти', variant: 'ghost', onClick: function () {
              // из тренировки дня — домой, из школьного дня — к расписанию,
              // из обычного урока — на карту блока
              if (params.daily) Router.reset('home');
              else if (params.school) Router.go('schoolday', {}, { replace: true });
              else Router.go('path', { track: unit.track }, { replace: true });
            } }
        ]
      });
    }

    function updateBar() {
      var total = queue.length || 1;
      barFill.setPercent(Math.round(idx / total * 100));
      scoreChip.lastChild.textContent = String(solved);
    }

    /* ---------- Выбор типа задания ---------- */
    var typeTurn = 0;   // чередование типов на первом уровне сложности

    /** Тип задания должен соответствовать виду навыка: звук нельзя тренировать глазами. */
    function suitsSkill(typeName, skillId) {
      var kind = skillId.split(':')[0];
      if (kind === 'sound') return typeName === 'whichSound' || typeName === 'firstLetter';
      if (kind === 'letter') return typeName !== 'whichSound';
      return true;
    }

    function pickType(item, exclude) {
      exclude = exclude || [];
      if (item.mode === 'new') {
        var learn = LEARN_FOR[unit.section];
        if (learn && Tasks.has(learn) && !Skills.get(item.id).introduced &&
            exclude.indexOf(learn) < 0) return learn;
      }
      var list = unit.types.filter(function (t) {
        return Tasks.has(t) && exclude.indexOf(t) < 0 && suitsSkill(t, item.id);
      });
      // если под вид навыка ничего не нашлось — берём что есть
      if (!list.length) {
        list = unit.types.filter(function (t) { return Tasks.has(t) && exclude.indexOf(t) < 0; });
      }
      if (!list.length) return null;
      var lvl = Skills.get(item.id).level;
      // На первом уровне не «всегда первый тип», а по кругу: иначе весь урок
      // состоял из одного и того же задания
      var i = lvl <= 1 ? (typeTurn++ % list.length) : UI.rnd(0, list.length - 1);
      return list[Math.min(i, list.length - 1)];
    }

    /* ---------- Рендер шага ---------- */
    function render() {
      Speech.stop();
      UI.hideFeedback(true);
      attempts = 0;
      head.innerHTML = '';
      body.innerHTML = '';
      actions.innerHTML = '';
      actions.classList.remove('hidden');
      updateBar();

      if (idx >= queue.length) return finish();

      var item = queue[idx];
      var skill = Skills.get(item.id);

      // Если тип не смог собрать задание для этого навыка (например, нет слова
      // на букву Ы) — пробуем другой тип, а не выбрасываем навык из урока
      var tried = [], typeName = null, def = null, data = null;
      while (!data) {
        typeName = pickType(item, tried);
        def = typeName && TYPES[typeName];
        if (!def) { idx++; return render(); }
        tried.push(typeName);
        try {
          data = def.build(item.id, skill.level, unit);
        } catch (e) {
          console.error('Не удалось собрать задание', typeName, item.id, e);
          data = null;
        }
      }

      // Шапка задания: вопрос + кнопка «Послушать»
      if (data.prompt) {
        head.appendChild(el('h2', { class: 'task__q', html: data.prompt }));
      }
      if (data.speak !== false) {
        head.appendChild(el('div', { class: 'center mt2' }, [
          UI.speakBtn(function () { return data.speak || stripTags(data.prompt || ''); })
        ]));
      }

      var api = makeApi(def, data, item);
      var node;
      try {
        node = def.render(data, api);
      } catch (e) {
        console.error('Не удалось показать задание', typeName, e);
        idx++; return render();
      }
      body.appendChild(node);

      // Автоозвучка задания: ребёнок ещё плохо читает
      if (data.speak !== false && Store.settings.speech) {
        setTimeout(function () {
          if (document.body.contains(node)) Speech.phrase(data.speak || stripTags(data.prompt || ''));
        }, 380);
      }

      if (def.teach) {
        Skills.introduce(item.id);
        actions.appendChild(UI.btn('Дальше', {
          variant: 'grass', emoji: '👉', block: true,
          onClick: UI.once(function () { idx++; render(); })
        }));
      } else if (def.needsCheck) {
        var checked = false;
        actions.appendChild(UI.btn('Проверить', {
          variant: 'grass', block: true,
          onClick: function () {
            if (checked || !api._check) return;
            var res = api._check() || {};
            // Незаполненные окошки — это не ответ, а напоминание.
            // Иначе два нажатия «Проверить» проваливали задание.
            if (res.incomplete) {
              SFX.almost();
              UI.feedback({
                ok: false, hint: res.hint, buttonLabel: 'Понятно',
                onNext: UI.once(function () { actions.classList.remove('hidden'); })
              });
              actions.classList.add('hidden');
              return;
            }
            checked = true;
            if (!res.ok) {
              api.answer(false, {
                hint: res.hint,
                reveal: res.reveal,
                onRetry: function () { checked = false; if (res.onRetry) res.onRetry(); }
              });
            } else {
              api.answer(true, { node: res.node || node });
            }
          }
        }));
      } else {
        actions.classList.add('hidden');
      }
    }

    /* ---------- API, доступный заданию ---------- */
    function makeApi(def, data, item) {
      var api = {
        skill: item.id,
        level: Skills.get(item.id).level,
        unit: unit,
        data: data,
        speak: function (t) { return Speech.phrase(t); },
        setCheck: function (fn) { api._check = fn; },
        answer: function (ok, o) { judge(ok, o || {}, item, def); },
        /** Задание, которое ребёнок не может выполнить (например, письмо), — идём дальше без упрёков. */
        skip: function (o) { attempts = 1; judge(false, o || {}, item, def); }
      };
      return api;
    }

    /* ---------- Проверка ответа ---------- */
    function judge(ok, o, item, def) {
      attempts++;
      actions.classList.add('hidden');

      if (ok) {
        solved++;
        answered++;
        if (attempts === 1) firstTry++;
        // В модель навыка идёт результат ПЕРВОЙ попытки: иначе ребёнок,
        // который каждый раз ошибается и исправляется, получает точность 100%
        Skills.record(item.id, attempts === 1);
        Store.answer(attempts === 1);
        var gain = attempts === 1 ? 10 : 5;
        xpEarned += gain;
        var up = Store.addXP(gain);
        SFX.right();
        if (o.node) FX.at(o.node, '✨');
        if (up) {
          SFX.levelUp();
          UI.toast('Новый уровень: ' + up, { type: 'gold', emoji: '🚀' });
          FX.confetti({ count: 60 });
        }
        var combo = Store.data.stats.combo;
        if (combo > 0 && combo % 5 === 0) {
          FX.confetti({ count: 40 });
          UI.toast(combo + ' подряд!', { type: 'grass', emoji: '🔥' });
        }
        Achievements.checkCounters();
        idx++;
        updateBar();
        UI.feedback({ ok: true, onNext: UI.once(render) });
        return;
      }

      // Ошибка: первая попытка — мягкая подсказка, вторая — показываем ответ
      SFX.almost();
      var last = attempts >= 2;
      if (last) {
        answered++;
        Skills.record(item.id, false);
        Store.answer(false);
        if (o.reveal) o.reveal();
        // вернём навык в этом же уроке, но урок обязан закончиться
        if (queue.length < maxLen) SRS.reinsert(queue, idx, item);
        idx++;
        updateBar();
        UI.feedback({
          ok: false,
          title: Characters.line('reveal'),
          hint: o.answerHint || o.hint || '',
          buttonLabel: 'Понятно',
          onNext: UI.once(render)
        });
      } else {
        Store.resetCombo();
        UI.feedback({
          ok: false,
          hint: o.hint || '',
          buttonLabel: 'Ещё раз',
          onNext: UI.once(function () {
            if (actions.children.length) actions.classList.remove('hidden');
            if (o.onRetry) o.onRetry();
          })
        });
      }
    }

    /* ---------- Итог урока ---------- */
    function finish() {
      if (finished) return;
      finished = true;
      Speech.stop();
      head.innerHTML = ''; body.innerHTML = ''; actions.innerHTML = '';
      barFill.setPercent(100);

      var total = answered || 1;
      var acc = firstTry / total;
      // Минимум одна звезда за старание — «двоек» у нас не бывает
      var stars = acc >= 0.9 ? 3 : acc >= 0.6 ? 2 : 1;
      var bonus = 15 + stars * 10;
      xpEarned += bonus;
      Store.addXP(bonus);

      // Урок считается пройденным (и открывает следующий), только если ребёнок
      // действительно справлялся: иначе программа убегала вперёд от него
      var mastered = unit.skills.filter(Skills.isMastered).length;
      var passed = stars >= 2 || mastered * 2 >= unit.skills.length;
      Store.completeUnit(unit.id, stars, passed);

      grantUnitAchievements(unit, stars);
      Achievements.checkCounters();
      Store.save(true);

      if (params.daily) Store.markDaily(params.daily);
      if (params.school) Store.markSchoolDay(params.school);

      SFX.reward();
      FX.confetti({ count: 120 });
      if (stars === 3) FX.rain(['⭐', '🎉', unit.emoji], 14);

      var mascot = Mascot.say(Characters.line('unitDone'), { center: true, big: true });

      body.appendChild(el('div', { class: 'result appear' }, [
        mascot,
        el('div', { class: 'center mt5' }, [UI.stars(stars, true)]),
        el('div', { class: 'center g2 mt5 wrap' }, [
          UI.chip(solved + ' из ' + total, 'grass', '✅'),
          UI.chip('+' + xpEarned + ' XP', 'soft', '💎'),
          UI.chip(unit.title, 'sun', unit.emoji)
        ])
      ]));

      var nextUnit = Curriculum.next(unit.track);
      var backLabel = params.school ? 'К расписанию'
        : (nextUnit && nextUnit.id !== unit.id ? 'Дальше' : 'На главную');
      actions.appendChild(el('div', { class: 'stack g3', style: { width: 'min(460px,100%)' } }, [
        UI.btn(backLabel, {
          variant: 'grass', block: true,
          onClick: function () {
            if (params.school) Router.go('schoolday', {}, { replace: true });
            else if (nextUnit && nextUnit.id !== unit.id) Router.go('path', { track: unit.track }, { replace: true });
            else Router.reset('home');
          }
        }),
        UI.btn('Пройти ещё раз', {
          variant: 'ghost', block: true, small: true,
          onClick: function () { Router.go('lesson', { unitId: unit.id }, { replace: true }); }
        })
      ]));
    }

    render();
    return screen;
  }

  /* Достижения, привязанные к разделам */
  function grantUnitAchievements(unit, stars) {
    Store.unlockAch('first-step');
    if (stars >= 3) Store.unlockAch('perfect');
    var s = unit.section;
    if (s === 'letters') Store.unlockAch('first-letter');
    if (s === 'writeLetters') Store.unlockAch('first-write');
    if (s === 'syllables') Store.unlockAch('syllables');
    if (s === 'words') Store.unlockAch('first-word');
    if (s === 'sentences') Store.unlockAch('sentence');
    if (s === 'digits') Store.unlockAch('digits');
    if (s === 'writeDigits') Store.unlockAch('write-num');
    if (s === 'add') Store.unlockAch('plus');
    if (s === 'sub') Store.unlockAch('minus');
    if (s === 'problems') Store.unlockAch('problems');
    if (unit.id === 'm-cnt-2') Store.unlockAch('count10');
    if (unit.id === 'm-cnt-3') Store.unlockAch('count20');
    if (unit.id === 'r-let-6') Store.unlockAch('alphabet');

    /* 🚀 Космос */
    if (unit.track === 'space') Store.unlockAch('sp-first');
    if (unit.id === 's-moon') Store.unlockAch('sp-moon');
    if (unit.id === 's-order') Store.unlockAch('sp-planets');
    if (unit.id === 's-stars') Store.unlockAch('sp-stars');
    if (unit.id === 's-final') Store.unlockAch('sp-cosmonaut');

    /* 🎒 Школа */
    if (unit.id === 'sch-read-1') Store.unlockAch('sch-reader');
    if (unit.id === 'sch-write-2') Store.unlockAch('sch-letters');
    if (unit.id === 'sch-math-3') Store.unlockAch('sch-numbers');
    if (unit.id === 'sch-logic-2') Store.unlockAch('sch-logic');
    if (unit.id === 'sch-final') Store.unlockAch('sch-ready');

    /* 🌍 Мой мир */
    if (unit.track === 'world') Store.unlockAch('w-explorer');
    if (unit.id === 'w-animals-2') Store.unlockAch('w-animals');
    if (unit.id === 'w-nature') Store.unlockAch('w-nature');
    if (unit.id === 'w-weather') Store.unlockAch('w-weather');
    if (unit.id === 'w-countries') Store.unlockAch('w-traveler');
    if (unit.id === 'w-science') Store.unlockAch('w-scientist');
    if (unit.id === 'w-final') Store.unlockAch('w-great');
  }

  function stripTags(s) { return String(s).replace(/<[^>]*>/g, ''); }

  Tasks.LessonScreen = LessonScreen;
  Tasks.LEARN_FOR = LEARN_FOR;
  global.Tasks = Tasks;

})(window);
