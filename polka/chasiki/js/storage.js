/* =========================================================
   storage.js — прогресс ребёнка в LocalStorage
   XP, уровни, звёзды, медали, достижения, серия дней,
   настройки. Всё хранится в одном ключе.
   ========================================================= */
(function (global) {
  'use strict';

  var KEY = 'chasiki.progress.v1';

  /* ---------- Достижения ---------- */
  var ACHIEVEMENTS = [
    { id: 'first_step', emoji: '👣', title: 'Первый шаг',   desc: 'Пройден первый урок' },
    { id: 'hands',      emoji: '👐', title: 'Две стрелки',  desc: 'Знаешь обе стрелки' },
    { id: 'whole',      emoji: '🕐', title: 'Целые часы',   desc: 'Читаешь ровные часы' },
    { id: 'half',       emoji: '🕧', title: 'Половинка',    desc: 'Понимаешь «полчаса»' },
    { id: 'quarter',    emoji: '🕓', title: 'Четвертинка',  desc: 'Понимаешь «четверть»' },
    { id: 'anytime',    emoji: '⏰', title: 'Знаток времени',desc: 'Читаешь любое время' },
    { id: 'perfect',    emoji: '⭐', title: 'Без ошибок',    desc: 'Урок на 3 звезды' },
    { id: 'combo10',    emoji: '🔥', title: '10 подряд',    desc: '10 верных ответов подряд' },
    { id: 'stars30',    emoji: '🏆', title: 'Коллекционер', desc: 'Собран 21 звёздочка' },
    { id: 'xp500',      emoji: '💎', title: '500 опыта',    desc: 'Набрано 500 XP' },
    { id: 'streak3',    emoji: '📅', title: 'Три дня',      desc: 'Играешь 3 дня подряд' },
    { id: 'allgames',   emoji: '🎮', title: 'Игроман',      desc: 'Сыграно во все мини-игры' },
    { id: 'sniper',     emoji: '🎯', title: 'Снайпер',      desc: 'Точность 100%' },
    { id: 'speedy',     emoji: '⚡', title: 'Молния',        desc: '12 ответов в гонке' },
    { id: 'graduate',   emoji: '🎓', title: 'Выпускник',    desc: 'Сдан экзамен' },
    { id: 'gold',       emoji: '🥇', title: 'Золотая медаль',desc: '18 из 20 на экзамене' }
  ];

  /* ---------- Значения по умолчанию ---------- */
  function defaults() {
    return {
      v: 1,
      name: '',
      xp: 0,
      lessons: {},          // id -> { done:true, stars:0..3, best:0..3 }
      games: {},            // id -> { plays:0, best:0 }
      achievements: [],     // список id
      stickers: [],         // список эмодзи-наклеек
      streak: { count: 0, best: 0, last: '' },
      totalCorrect: 0,
      totalTasks: 0,
      combo: 0,
      bestCombo: 0,
      exam: { passed: false, best: 0, attempts: 0 },
      settings: { sound: true, animations: true, difficulty: 'normal', unlockAll: false }
    };
  }

  var data = defaults();
  var listeners = [];

  /* ---------- Загрузка / сохранение ---------- */
  function load() {
    try {
      var raw = global.localStorage.getItem(KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        data = merge(defaults(), parsed);
      }
    } catch (e) {
      // LocalStorage может быть недоступен (приватный режим) — просто работаем в памяти
      console.warn('Не удалось прочитать прогресс:', e);
    }
    return data;
  }

  var storageOk = true;

  function save() {
    if (storageOk) {
      try {
        global.localStorage.setItem(KEY, JSON.stringify(data));
      } catch (e) {
        // Приватный режим: предупреждаем один раз, дальше играем «в памяти»
        storageOk = false;
        console.warn('Прогресс не сохраняется (хранилище недоступно)');
      }
    }
    emit();
  }

  /**
   * Аккуратное слияние: недостающие поля берём из значений по умолчанию.
   * Тип поля обязан совпадать с эталонным — иначе повреждённая или чужая
   * запись в хранилище роняла приложение в белый экран без выхода.
   */
  function merge(base, patch) {
    if (patch === null || typeof patch !== 'object') return base;
    var out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    Object.keys(patch).forEach(function (k) {
      var b = out[k], p = patch[k];
      if (p === undefined || p === null) return;                 // null не затирает эталон
      if (b === undefined) return;                               // чужих полей не берём
      if (Array.isArray(b) !== Array.isArray(p)) return;         // массив — только массивом
      if (typeof b !== typeof p) return;                         // тип должен совпадать
      if (typeof p === 'number' && !isFinite(p)) return;         // NaN / Infinity
      if (b && typeof b === 'object' && !Array.isArray(b)) out[k] = merge(b, p);
      else out[k] = p;
    });
    return out;
  }

  function emit() {
    listeners.forEach(function (fn) { try { fn(data); } catch (e) { console.error(e); } });
  }

  /* ---------- Уровни ---------- */
  // Для каждого следующего уровня нужно всё больше опыта.
  function levelInfo(xp) {
    xp = Number(xp);
    if (!isFinite(xp) || xp < 0) xp = 0;      // защита от повреждённого значения: иначе цикл вечный
    var lvl = 1, acc = 0, need = 120;
    while (xp >= acc + need && lvl < 10000) {
      acc += need;
      lvl++;
      need = 120 + (lvl - 1) * 40;
    }
    return { level: lvl, into: xp - acc, need: need, pct: (xp - acc) / need };
  }

  /* ---------- Серия дней ---------- */
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function touchStreak() {
    var t = todayStr();
    if (data.streak.last === t) return false;      // уже отмечались сегодня
    var yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    var y = yesterday.getFullYear() + '-' + pad(yesterday.getMonth() + 1) + '-' + pad(yesterday.getDate());

    data.streak.count = (data.streak.last === y) ? data.streak.count + 1 : 1;
    data.streak.best = Math.max(data.streak.best, data.streak.count);
    data.streak.last = t;
    if (data.streak.count >= 3) unlock('streak3');
    save();
    return true;
  }

  /* ---------- Публичное API ---------- */
  var Progress = {
    ACHIEVEMENTS: ACHIEVEMENTS,

    init: function () {
      load();
      touchStreak();
      return data;
    },

    get data() { return data; },
    get settings() { return data.settings; },

    onChange: function (fn) { listeners.push(fn); },

    save: save,

    level: function () { return levelInfo(data.xp); },

    /** Начислить опыт. Возвращает true, если ребёнок перешёл на новый уровень. */
    addXP: function (amount) {
      var before = levelInfo(data.xp).level;
      data.xp += amount;
      if (data.xp >= 500) unlock('xp500');
      var after = levelInfo(data.xp).level;
      save();
      return after > before;
    },

    /** Отметить ответ (верный/неверный) — ведёт статистику и серию верных ответов. */
    answer: function (ok) {
      data.totalTasks++;
      if (ok) {
        data.totalCorrect++;
        data.combo++;
        if (data.combo > data.bestCombo) data.bestCombo = data.combo;
        if (data.combo >= 10) unlock('combo10');
      } else {
        data.combo = 0;
      }
      save();
      return data.combo;
    },

    resetCombo: function () { data.combo = 0; },

    /** Завершение урока: сохраняем лучший результат в звёздах. */
    completeLesson: function (id, stars) {
      var rec = data.lessons[id] || { done: false, stars: 0, best: 0 };
      rec.done = true;
      rec.stars = stars;
      rec.best = Math.max(rec.best || 0, stars);
      data.lessons[id] = rec;
      if (stars >= 3) unlock('perfect');
      // 21 из 30 звёзд: достижимо для ребёнка, но требует стараний
      if (Progress.totalStars() >= 21) unlock('stars30');
      save();
    },

    lesson: function (id) { return data.lessons[id] || { done: false, stars: 0, best: 0 }; },

    isDone: function (id) { return !!(data.lessons[id] && data.lessons[id].done); },

    totalStars: function () {
      return Object.keys(data.lessons).reduce(function (s, k) { return s + (data.lessons[k].best || 0); }, 0);
    },

    /** Процент прохождения курса (по урокам). */
    percent: function (lessonIds) {
      if (!lessonIds || !lessonIds.length) return 0;
      var done = lessonIds.filter(function (id) { return Progress.isDone(id); }).length;
      return Math.round(done / lessonIds.length * 100);
    },

    /** Результат мини-игры. */
    gameResult: function (id, score) {
      var rec = data.games[id] || { plays: 0, best: 0 };
      rec.plays++;
      rec.best = Math.max(rec.best, score);
      data.games[id] = rec;
      save();
      return rec;
    },

    game: function (id) { return data.games[id] || { plays: 0, best: 0 }; },

    playedAllGames: function (ids) {
      return ids.every(function (id) { return (data.games[id] && data.games[id].plays > 0); });
    },

    /** Экзамен. */
    setExam: function (score, total) {
      data.exam.attempts++;
      data.exam.best = Math.max(data.exam.best, score);
      if (score >= Math.ceil(total * 0.7)) {
        data.exam.passed = true;
        unlock('graduate');
      }
      if (score >= 18) unlock('gold');
      save();
    },

    addSticker: function (emoji) {
      if (data.stickers.indexOf(emoji) === -1) {
        data.stickers.push(emoji);
        save();
      }
    },

    unlock: unlock,

    has: function (id) { return data.achievements.indexOf(id) !== -1; },

    /* Имя попадает в диплом и в общий профиль: вычищаем разметку
       и не рвём эмодзи пополам */
    setName: function (name) {
      data.name = String(name || '').replace(/[<>&"'`\\]/g, '')
        .trim().slice(0, 16).replace(/[\uD800-\uDBFF]$/, '').trim();
      save();
    },

    setSetting: function (key, value) {
      data.settings[key] = value;
      save();
    },

    reset: function () {
      data = defaults();
      try { global.localStorage.removeItem(KEY); } catch (e) {}
      touchStreak();
      save();
    }
  };

  /** Открыть достижение. Возвращает объект достижения, если оно новое. */
  function unlock(id) {
    if (data.achievements.indexOf(id) !== -1) return null;
    var ach = ACHIEVEMENTS.filter(function (a) { return a.id === id; })[0];
    if (!ach) return null;
    data.achievements.push(id);
    save();
    // Оповещение показывает UI-слой (подписан через onAchievement)
    if (Progress.onAchievement) Progress.onAchievement(ach);
    return ach;
  }

  global.Progress = Progress;

})(window);
