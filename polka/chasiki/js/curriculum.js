/* =========================================================
   curriculum.js — учебная программа: 10 уровней.
   Каждый уровень состоит из «шагов»: объяснения + задания.

   Типы шагов:
     teach   — объяснение с анимацией часов
     set     — поставить стрелки (drag: 'hour' | 'minute' | 'both')
     read    — показаны часы, выбрать цифровое время
     pick    — показано цифровое время, выбрать часы
     minutes — сколько минут показывает длинная стрелка
     match   — соединить аналоговые и цифровые часы
   ========================================================= */
(function (global) {
  'use strict';

  function rnd(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function same(a, b) { return a.h === b.h && a.m === b.m; }
  function key(t) { return t.h + ':' + t.m; }

  /* -------- Генераторы времени по сложности -------- */
  var Gen = {
    whole: function () { return { h: rnd(1, 12), m: 0 }; },
    half:  function () { return { h: rnd(1, 12), m: 30 }; },
    quarter: function () { return { h: rnd(1, 12), m: pick([15, 45]) }; },
    five:  function () { return { h: rnd(1, 12), m: rnd(0, 11) * 5 }; },
    any:   function () { return { h: rnd(1, 12), m: rnd(0, 59) }; },

    /** Случайное время с учётом выбранной сложности. */
    byDifficulty: function (d) {
      if (d === 'easy') return pick([Gen.whole, Gen.whole, Gen.half])();
      if (d === 'hard') return Math.random() < 0.25 ? Gen.any() : Gen.five();
      return pick([Gen.whole, Gen.half, Gen.quarter, Gen.five, Gen.five])();
    }
  };

  /**
   * Сгенерировать варианты ответа: правильный + n «похожих» неправильных.
   * Неправильные делаются похожими, чтобы задание учило, а не угадывалось.
   */
  function makeOptions(correct, n, mode) {
    var seen = {}; seen[key(correct)] = true;
    var out = [correct];
    var guard = 0;

    while (out.length < n + 1 && guard++ < 400) {
      var cand;
      var r = Math.random();
      if (mode === 'whole') {
        cand = { h: ((correct.h + rnd(1, 11) - 1) % 12) + 1, m: 0 };
      } else if (r < 0.42) {
        // тот же час, другие минуты
        var mm = correct.m + pick([-30, -15, -10, -5, 5, 10, 15, 30]);
        mm = ((mm % 60) + 60) % 60;
        cand = { h: correct.h, m: mm };
      } else if (r < 0.8) {
        // другой час, те же минуты (частая детская ошибка)
        cand = { h: ((correct.h + pick([1, 2, 11, 10]) - 1) % 12) + 1, m: correct.m };
      } else if (correct.m % 5 === 0) {
        // «стрелки перепутаны местами» — только для круглых минут, иначе
        // вариант отличался бы от верного на одну минуту и был неразличим
        var swapped = { h: (correct.m / 5) | 0, m: (correct.h * 5) % 60 };
        cand = { h: swapped.h === 0 ? 12 : swapped.h, m: swapped.m };
      } else {
        cand = { h: correct.h, m: (correct.m + pick([10, 15, 45, 50])) % 60 };
      }
      if (!seen[key(cand)]) { seen[key(cand)] = true; out.push(cand); }
    }
    // Если вдруг не хватило — добираем случайными
    while (out.length < n + 1) {
      var c2 = Gen.five();
      if (!seen[key(c2)]) { seen[key(c2)] = true; out.push(c2); }
    }
    return shuffle(out);
  }

  function makeMinuteOptions(correct, n) {
    var seen = {}; seen[correct] = true;
    var out = [correct];
    // Порядок случайный: иначе верный ответ всегда оказывался наименьшим числом
    // и задание решалось стратегией «жми самое маленькое»
    var deltas = shuffle([5, 10, 15, 20, -5, -10, -15, -20]);
    var i = 0;
    while (out.length < n + 1 && i < 60) {
      var c = correct + deltas[i % deltas.length] + (i > 7 ? rnd(-2, 2) * 5 : 0);
      c = ((c % 60) + 60) % 60;
      if (c === 0 && correct !== 0) { i++; continue; }   // «0 минут» как отвлекающий вариант сбивает
      if (!seen[c]) { seen[c] = true; out.push(c); }
      i++;
    }
    // Добираем, если вдруг не хватило
    var extra = 5;
    while (out.length < n + 1) {
      if (!seen[extra] && extra !== 0) { seen[extra] = true; out.push(extra); }
      extra += 5;
      if (extra >= 60) break;
    }
    return shuffle(out);
  }

  /* -------- Короткие конструкторы шагов -------- */
  function readTask(time, question) {
    return {
      type: 'read', time: time,
      question: question || 'Сколько времени?',
      options: makeOptions(time, 3)
    };
  }
  function pickTask(time, question) {
    return {
      type: 'pick', time: time,
      question: question || 'Найди эти часы',
      options: makeOptions(time, 3)
    };
  }
  function setTask(time, drag, question, hint) {
    time = drag === 'hour' ? time : snap5(time);
    return {
      type: 'set', target: time, drag: drag || 'both',
      snap: 5, snapHour: drag === 'hour' ? 'strict' : false,
      question: question || ('Поставь ' + fmt(time)),
      hint: hint
    };
  }
  function fmt(t) {
    return t.h + ':' + (t.m < 10 ? '0' + t.m : t.m);
  }

  /**
   * Округлить до 5 минут. Стрелки в заданиях «поставь время» притягиваются
   * к делениям по 5 минут, поэтому цель обязана быть достижимой — иначе
   * ребёнок крутит стрелку и всё равно получает «неверно».
   */
  function snap5(t) {
    return { h: t.h, m: Math.round(t.m / 5) * 5 % 60 };
  }

  /* =======================================================
     УРОКИ
     ======================================================= */
  var LESSONS = [

    /* ---------- Урок 1: короткая стрелка ---------- */
    {
      id: 'l1', num: 1, emoji: '🕐', title: 'Короткая стрелка', short: 'Часы',
      sticker: '🕐', achievement: 'first_step',
      build: function () {
        return [
          {
            type: 'teach',
            title: 'У часов две стрелки',
            clock: { h: 3, m: 0 },
            anim: 'introHands',
            points: [
              { emoji: '🔵', html: '<b>Короткая</b> стрелка — это <b>часы</b>' },
              { emoji: '🟢', html: '<b>Длинная</b> стрелка — это <b>минуты</b>' }
            ]
          },
          {
            type: 'teach',
            title: 'Короткая стрелка показывает час',
            clock: { h: 1, m: 0 },
            anim: 'hourWalk',
            points: [
              { emoji: '🐢', html: 'Она движется <b>медленно</b>' },
              { emoji: '👉', html: 'На какую цифру показывает — <b>столько и часов</b>' }
            ]
          },
          setTask({ h: 3, m: 0 }, 'hour', 'Покажи 3 часа', 'Двигай короткую стрелку 🔵'),
          setTask({ h: 7, m: 0 }, 'hour', 'Покажи 7 часов', 'Двигай короткую стрелку 🔵'),
          setTask({ h: 10, m: 0 }, 'hour', 'Покажи 10 часов'),
          setTask({ h: 5, m: 0 }, 'hour', 'Покажи 5 часов'),
          setTask({ h: 12, m: 0 }, 'hour', 'Покажи 12 часов'),
          {
            type: 'read', time: { h: 8, m: 0 }, question: 'Сколько часов?',
            options: makeOptions({ h: 8, m: 0 }, 3, 'whole'), hideMinutes: true
          }
        ];
      }
    },

    /* ---------- Урок 2: минутная стрелка ---------- */
    {
      id: 'l2', num: 2, emoji: '🟢', title: 'Длинная стрелка', short: 'Минуты',
      sticker: '⏱️', achievement: 'hands',
      build: function () {
        return [
          {
            type: 'teach',
            title: 'Полный круг — это 60 минут',
            clock: { h: 12, m: 0 },
            anim: 'minuteSweep',
            points: [
              { emoji: '🔄', html: 'Длинная стрелка бежит <b>быстро</b>' },
              { emoji: '⏰', html: 'Один круг = <b>60 минут</b> = <b>1 час</b>' }
            ]
          },
          {
            type: 'teach',
            title: 'Каждая цифра — это 5 минут',
            clock: { h: 12, m: 0 },
            anim: 'fiveSteps',
            points: [
              { emoji: '🖐️', html: '1 → 5 минут, 2 → 10 минут, 3 → <b>15 минут</b>' },
              { emoji: '🔢', html: 'Считай по пять: 5, 10, 15, 20…' }
            ]
          },
          { type: 'minutes', m: 15, question: 'Сколько минут?', options: makeMinuteOptions(15, 3) },
          { type: 'minutes', m: 30, question: 'Сколько минут?', options: makeMinuteOptions(30, 3) },
          { type: 'minutes', m: 45, question: 'Сколько минут?', options: makeMinuteOptions(45, 3) },
          { type: 'minutes', m: 25, question: 'Сколько минут?', options: makeMinuteOptions(25, 3) },
          {
            type: 'set', target: { h: 12, m: 20 }, drag: 'minute', snap: 5,
            question: 'Поставь 20 минут', hint: 'Двигай длинную стрелку 🟢', showMinutesOnly: true
          },
          {
            type: 'set', target: { h: 12, m: 50 }, drag: 'minute', snap: 5,
            question: 'Поставь 50 минут', hint: 'Считай по 5: 5, 10, 15…', showMinutesOnly: true
          }
        ];
      }
    },

    /* ---------- Урок 3: целые часы ---------- */
    {
      id: 'l3', num: 3, emoji: '🕒', title: 'Целые часы', short: 'Ровно',
      sticker: '🔔', achievement: 'whole',
      build: function () {
        return [
          {
            type: 'teach',
            title: 'Ровный час',
            clock: { h: 1, m: 0 },
            anim: 'showList',
            list: [{ h: 1, m: 0 }, { h: 2, m: 0 }, { h: 7, m: 0 }, { h: 11, m: 0 }],
            points: [
              { emoji: '⬆️', html: 'Длинная стрелка смотрит на <b>12</b>' },
              { emoji: '🔵', html: 'Читаем цифру под короткой стрелкой' },
              { emoji: '🗣️', html: 'Говорим: «ровно 7 часов» — <b>7:00</b>' }
            ]
          },
          readTask({ h: 2, m: 0 }),
          readTask({ h: 9, m: 0 }),
          pickTask({ h: 5, m: 0 }),
          readTask({ h: 11, m: 0 }),
          setTask({ h: 4, m: 0 }, 'hour', 'Поставь 4:00'),
          pickTask({ h: 12, m: 0 }),
          setTask({ h: 8, m: 0 }, 'hour', 'Поставь 8:00')
        ];
      }
    },

    /* ---------- Урок 4: половина часа ---------- */
    {
      id: 'l4', num: 4, emoji: '🕜', title: 'Половина часа', short: 'Полчаса',
      sticker: '🍕', achievement: 'half',
      build: function () {
        return [
          {
            type: 'teach',
            title: 'Половина круга — 30 минут',
            clock: { h: 3, m: 30 },
            anim: 'halfSector',
            points: [
              { emoji: '🍕', html: 'Стрелка прошла <b>полкруга</b>' },
              { emoji: '6️⃣', html: 'Длинная стрелка на <b>6</b> — это <b>30 минут</b>' },
              { emoji: '🔵', html: 'Короткая стоит между цифрами — называем ту, которую она <b>уже прошла</b>' }
            ]
          },
          readTask({ h: 3, m: 30 }, 'Сколько времени?'),
          readTask({ h: 8, m: 30 }),
          pickTask({ h: 10, m: 30 }),
          setTask({ h: 6, m: 30 }, 'both', 'Поставь 6:30'),
          readTask({ h: 1, m: 30 }),
          setTask({ h: 9, m: 30 }, 'both', 'Поставь 9:30')
        ];
      }
    },

    /* ---------- Урок 5: четверть часа ---------- */
    {
      id: 'l5', num: 5, emoji: '🕓', title: 'Четверть часа', short: 'Четверть',
      sticker: '🍰', achievement: 'quarter',
      build: function () {
        return [
          {
            type: 'teach',
            title: 'Четверть круга — 15 минут',
            clock: { h: 4, m: 15 },
            anim: 'quarterSector',
            points: [
              { emoji: '🍰', html: 'Стрелка прошла <b>четвертинку</b> круга' },
              { emoji: '3️⃣', html: 'Длинная стрелка на <b>3</b> — это <b>15 минут</b>' }
            ]
          },
          {
            type: 'teach',
            title: 'Три четверти — 45 минут',
            clock: { h: 4, m: 45 },
            anim: 'quarter3Sector',
            points: [
              { emoji: '9️⃣', html: 'Длинная стрелка на <b>9</b> — это <b>45 минут</b>' },
              { emoji: '⏳', html: 'До нового часа осталось 15 минут' }
            ]
          },
          readTask({ h: 4, m: 15 }),
          readTask({ h: 7, m: 45 }),
          pickTask({ h: 2, m: 15 }),
          setTask({ h: 5, m: 45 }, 'both', 'Поставь 5:45'),
          readTask({ h: 11, m: 15 }),
          setTask({ h: 1, m: 15 }, 'both', 'Поставь 1:15')
        ];
      }
    },

    /* ---------- Урок 6: любое время ---------- */
    {
      id: 'l6', num: 6, emoji: '⏰', title: 'Любое время', short: 'Всё время',
      sticker: '🌟', achievement: 'anytime',
      build: function () {
        return [
          {
            type: 'teach',
            title: 'Считаем минуты по пять',
            clock: { h: 2, m: 10 },
            anim: 'countBy5',
            points: [
              { emoji: '👆', html: 'Смотрим, на какой цифре длинная стрелка' },
              { emoji: '🖐️', html: 'Считаем: 5, 10, 15, 20, 25…' },
              { emoji: '🔵', html: 'Час — это цифра, которую короткая уже <b>прошла</b>' }
            ]
          },
          {
            type: 'teach',
            title: 'Читаем вместе',
            clock: { h: 6, m: 25 },
            anim: 'showList',
            list: [{ h: 2, m: 10 }, { h: 6, m: 25 }, { h: 4, m: 40 }, { h: 9, m: 55 }],
            points: [
              { emoji: '🗣️', html: 'Сначала <b>час</b>, потом <b>минуты</b>' }
            ]
          },
          readTask({ h: 2, m: 10 }),
          readTask({ h: 6, m: 25 }),
          pickTask({ h: 4, m: 40 }),
          readTask({ h: 9, m: 55 }),
          setTask({ h: 3, m: 20 }, 'both', 'Поставь 3:20'),
          readTask({ h: 7, m: 35 }),
          setTask({ h: 10, m: 5 }, 'both', 'Поставь 10:05')
        ];
      }
    },

    /* ---------- Урок 7: аналоговые ↔ цифровые ---------- */
    {
      id: 'l7', num: 7, emoji: '🔗', title: 'Соедини часы', short: 'Пары',
      sticker: '🧲',
      build: function () {
        function fourTimes() {
          var out = [], seen = {};
          while (out.length < 4) {
            var t = Gen.byDifficulty(Progress.settings.difficulty);
            if (!seen[key(t)]) { seen[key(t)] = true; out.push(t); }
          }
          return out;
        }
        return [
          {
            type: 'teach',
            title: 'Одно и то же время',
            clock: { h: 3, m: 15 },
            anim: 'analogDigital',
            points: [
              { emoji: '🕒', html: 'Часы со стрелками' },
              { emoji: '🔢', html: 'Электронные часы' },
              { emoji: '🟰', html: 'Это <b>одно и то же</b> время!' }
            ]
          },
          { type: 'match', pairs: fourTimes(), question: 'Соедини пары' },
          { type: 'match', pairs: fourTimes(), question: 'Соедини пары' },
          { type: 'match', pairs: fourTimes(), question: 'И ещё раз!' }
        ];
      }
    },

    /* ---------- Урок 8: поставь стрелки ---------- */
    {
      id: 'l8', num: 8, emoji: '🎛️', title: 'Поставь стрелки', short: 'Стрелки',
      sticker: '🛠️',
      build: function () {
        var d = Progress.settings.difficulty;
        var list = [{ h: 7, m: 20 }, { h: 2, m: 45 }, { h: 11, m: 10 }, { h: 5, m: 35 }];
        while (list.length < 6) list.push(snap5(Gen.byDifficulty(d)));
        return [
          {
            type: 'teach',
            title: 'Теперь ты — часовщик!',
            clock: { h: 7, m: 20 },
            anim: 'setHint',
            points: [
              { emoji: '🟢', html: 'Сначала ставим <b>минуты</b> длинной стрелкой' },
              { emoji: '🔵', html: 'Потом — <b>час</b> короткой стрелкой' }
            ]
          }
        ].concat(list.map(function (t) {
          return setTask(t, 'both', 'Поставь ' + fmt(t));
        }));
      }
    },

    /* ---------- Урок 9: сколько времени? ---------- */
    {
      id: 'l9', num: 9, emoji: '❓', title: 'Сколько времени?', short: 'Ответы',
      sticker: '🔍',
      build: function () {
        var d = Progress.settings.difficulty;
        var steps = [];
        var seen = {};
        while (steps.length < 8) {
          var t = Gen.byDifficulty(d);
          if (seen[key(t)]) continue;
          seen[key(t)] = true;
          steps.push(steps.length % 3 === 2 ? pickTask(t) : readTask(t));
        }
        return steps;
      }
    },

    /* ---------- Урок 10: экзамен ---------- */
    {
      id: 'exam', num: 10, emoji: '🎓', title: 'Экзамен', short: 'Экзамен',
      isExam: true, sticker: '🏆',
      build: function () {
        var d = Progress.settings.difficulty;
        var steps = [], seen = {};
        while (steps.length < 20) {
          var t = Gen.byDifficulty(d);
          if (seen[key(t)] && Math.random() < 0.8) continue;
          seen[key(t)] = true;
          var r = Math.random();
          if (r < 0.45) steps.push(readTask(t));
          else if (r < 0.75) steps.push(pickTask(t));
          else { var ts = snap5(t); steps.push(setTask(ts, 'both', 'Поставь ' + fmt(ts))); }
        }
        return steps;
      }
    }
  ];

  var LESSON_IDS = LESSONS.map(function (l) { return l.id; });

  function byId(id) {
    return LESSONS.filter(function (l) { return l.id === id; })[0];
  }

  /** Урок доступен, если пройден предыдущий (или включён режим «всё открыто»). */
  function isUnlocked(id) {
    if (Progress.settings.unlockAll) return true;
    var i = LESSON_IDS.indexOf(id);
    if (i <= 0) return true;
    return Progress.isDone(LESSON_IDS[i - 1]);
  }

  function nextLessonId() {
    for (var i = 0; i < LESSON_IDS.length; i++) {
      if (!Progress.isDone(LESSON_IDS[i])) return LESSON_IDS[i];
    }
    return 'exam';
  }

  global.Curriculum = {
    LESSONS: LESSONS,
    LESSON_IDS: LESSON_IDS,
    byId: byId,
    isUnlocked: isUnlocked,
    nextLessonId: nextLessonId,
    Gen: Gen,
    makeOptions: makeOptions,
    makeMinuteOptions: makeMinuteOptions,
    readTask: readTask,
    pickTask: pickTask,
    setTask: setTask,
    fmt: fmt
  };

})(window);
