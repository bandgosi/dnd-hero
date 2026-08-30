/* =========================================================
   core/store.js — профиль ребёнка: единственная точка правды.
   Все изменения прогресса проходят через этот модуль.
   ========================================================= */
(function (global) {
  'use strict';

  var KEY = 'umnyashka.profile.v1';

  function defaults() {
    return {
      v: 1,
      name: '',
      character: 'fox',
      xp: 0,
      skills: {},        // id -> Skill (см. core/skills.js)
      units: {},         // id -> { stars, done, playedAt }
      games: {},         // id -> { plays, best }
      achievements: [],
      rewards: [],
      collection: [],    // карточки «Журнала открытий» (мир + космос)
      schoolDay: { date: '', done: [] },
      equipped: { hat: null, glasses: null, bag: null, pet: null, bg: null },
      streak: { count: 0, best: 0, last: '' },
      daily: { date: '', plan: [], done: [] },
      stats: { byDay: {}, totalTasks: 0, totalCorrect: 0, bestCombo: 0, combo: 0 },
      settings: {
        sound: true, speech: true, animations: true,
        speechRate: 0.85, difficulty: 'normal', hand: 'right'
      },
      session: { startedAt: 0 }
    };
  }

  var data = defaults();
  var listeners = [];

  /* ---------- Слияние с защитой по типам ---------- */
  function merge(base, patch) {
    if (patch === null || typeof patch !== 'object') return base;
    var out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    Object.keys(patch).forEach(function (k) {
      var b = out[k], p = patch[k];
      if (p === undefined || p === null) return;
      if (b === undefined) { out[k] = p; return; }     // словари skills/units растут динамически
      if (Array.isArray(b) !== Array.isArray(p)) return;
      if (typeof b !== typeof p) return;
      if (typeof p === 'number' && !isFinite(p)) return;
      if (b && typeof b === 'object' && !Array.isArray(b)) out[k] = merge(b, p);
      else out[k] = p;
    });
    return out;
  }

  function emit() {
    listeners.forEach(function (fn) { try { fn(data); } catch (e) { console.error(e); } });
  }

  /* Запись объединяется: один ответ ребёнка вызывает save() трижды,
     а профиль за год занятий весит сотни килобайт. */
  var saveT = null;
  function flush() { saveT = null; Storage2.set(KEY, data); }
  function save(now) {
    emit();
    if (now) { if (saveT) { clearTimeout(saveT); } flush(); return; }
    if (!saveT) saveT = setTimeout(flush, 400);
  }

  /* ---------- Даты ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function touchStreak() {
    var t = dayStr();
    if (data.streak.last === t) return false;
    var y = new Date(); y.setDate(y.getDate() - 1);
    data.streak.count = (data.streak.last === dayStr(y)) ? data.streak.count + 1 : 1;
    data.streak.best = Math.max(data.streak.best, data.streak.count);
    data.streak.last = t;
    return true;
  }

  /* ---------- Уровень профиля ---------- */
  function levelInfo(xp) {
    xp = Number(xp);
    if (!isFinite(xp) || xp < 0) xp = 0;
    var lvl = 1, acc = 0, need = 120;
    while (xp >= acc + need && lvl < 5000) {
      acc += need; lvl++; need = 120 + (lvl - 1) * 45;
    }
    return { level: lvl, into: xp - acc, need: need, pct: (xp - acc) / need };
  }

  var Store = {
    /* ----- жизненный цикл ----- */
    init: function () {
      var saved = Storage2.get(KEY, null);
      if (saved) data = merge(defaults(), saved);
      data.session.startedAt = Date.now();
      touchStreak();
      save();
      return data;
    },

    get data() { return data; },
    get settings() { return data.settings; },
    onChange: function (fn) { listeners.push(fn); },
    save: save,
    dayStr: dayStr,

    isNew: function () { return !data.name && data.xp === 0; },

    /* Имя попадает в реплики персонажа, поэтому вычищаем всё,
       что может быть истолковано как разметка. */
    setName: function (n) {
      data.name = String(n || '').replace(/[<>&"'`\\]/g, '').trim().slice(0, 16);
      save();
    },
    setCharacter: function (id) { data.character = id; save(); },
    setSetting: function (k, v) { data.settings[k] = v; save(); },

    /* ----- опыт и уровень ----- */
    level: function () { return levelInfo(data.xp); },
    addXP: function (n) {
      var before = levelInfo(data.xp).level;
      data.xp += n;
      var after = levelInfo(data.xp).level;
      save();
      return after > before ? after : 0;
    },

    /* ----- статистика ответов ----- */
    answer: function (ok) {
      var s = data.stats;
      s.totalTasks++;
      if (ok) {
        s.totalCorrect++;
        s.combo++;
        if (s.combo > s.bestCombo) s.bestCombo = s.combo;
      } else {
        s.combo = 0;
      }
      var d = dayStr();
      var day = s.byDay[d] || (s.byDay[d] = { minutes: 0, tasks: 0, correct: 0 });
      day.tasks++;
      if (ok) day.correct++;
      save();
      return s.combo;
    },
    resetCombo: function () { data.stats.combo = 0; },

    /** Записать проведённое время (вызывается при выходе с урока). */
    addMinutes: function (min) {
      if (!min || min < 0) return;
      var d = dayStr();
      var day = data.stats.byDay[d] || (data.stats.byDay[d] = { minutes: 0, tasks: 0, correct: 0 });
      day.minutes = Math.round((day.minutes + min) * 10) / 10;
      save();
    },

    /* ----- юниты ----- */
    unit: function (id) {
      var u = data.units[id];
      if (!u || typeof u !== 'object') return { stars: 0, done: false, played: false, playedAt: 0 };
      return {
        stars: Number(u.stars) || 0,
        done: !!u.done,
        played: !!(u.played || u.done),
        playedAt: Number(u.playedAt) || 0
      };
    },
    /** done ставится только при осмысленном результате — это открывает следующий урок. */
    completeUnit: function (id, stars, done) {
      var u = Store.unit(id);
      u.played = true;
      u.stars = Math.max(u.stars, Number(stars) || 0);
      u.done = u.done || !!done;
      u.playedAt = Date.now();
      data.units[id] = u;
      save();
    },
    totalStars: function () {
      return Object.keys(data.units).reduce(function (a, k) {
        return a + (Number(data.units[k] && data.units[k].stars) || 0);
      }, 0);
    },

    /* ----- мини-игры ----- */
    game: function (id) { return data.games[id] || { plays: 0, best: 0 }; },
    gameResult: function (id, score) {
      var g = data.games[id] || { plays: 0, best: 0 };
      var prev = g.best;
      g.plays++; g.best = Math.max(g.best, score);
      data.games[id] = g;
      save();
      return { rec: g, prevBest: prev };
    },

    /* ----- достижения и награды ----- */
    hasAch: function (id) { return data.achievements.indexOf(id) !== -1; },
    unlockAch: function (id) {
      if (data.achievements.indexOf(id) !== -1) return null;
      data.achievements.push(id);
      save();
      var a = global.Achievements && Achievements.byId(id);
      if (a && Store.onAchievement) Store.onAchievement(a);
      return a || null;
    },
    hasReward: function (id) { return data.rewards.indexOf(id) !== -1; },
    unlockReward: function (id) {
      if (data.rewards.indexOf(id) !== -1) return null;
      data.rewards.push(id);
      save();
      var r = global.Achievements && Achievements.rewardById(id);
      if (r && Store.onReward) Store.onReward(r);
      return r || null;
    },
    equip: function (slot, id) {
      data.equipped[slot] = (data.equipped[slot] === id) ? null : id;
      save();
    },

    /* ----- журнал открытий ----- */
    hasCard: function (id) { return data.collection.indexOf(id) !== -1; },
    addCard: function (id) {
      if (data.collection.indexOf(id) !== -1) return false;
      data.collection.push(id);
      save();
      // каждые 5 карточек — маленький праздник
      if (data.collection.length % 5 === 0 && global.FX && global.UI) {
        FX.confetti({ count: 50 });
        UI.toast('В журнале уже ' + data.collection.length + ' открытий!', { type: 'gold', emoji: '📖' });
      } else if (global.UI) {
        UI.toast('Новая карточка в журнале!', { emoji: '📖', duration: 1800 });
      }
      return true;
    },

    /* ----- школьный день ----- */
    schoolDay: function () {
      if (data.schoolDay.date !== dayStr()) data.schoolDay = { date: dayStr(), done: [] };
      return data.schoolDay;
    },
    markSchoolDay: function (id) {
      var sd = Store.schoolDay();
      if (sd.done.indexOf(id) === -1) { sd.done.push(id); save(); }
    },

    /* ----- ежедневная тренировка ----- */
    daily: function () { return data.daily; },
    setDaily: function (plan) {
      data.daily = { date: dayStr(), plan: plan, done: [] };
      save();
    },
    markDaily: function (itemId) {
      if (data.daily.done.indexOf(itemId) === -1) {
        data.daily.done.push(itemId);
        save();
      }
    },
    dailyFresh: function () { return data.daily.date === dayStr(); },

    /* ----- сброс ----- */
    reset: function () {
      data = defaults();
      Storage2.remove(KEY);
      touchStreak();
      save();
    },

    /** Экспорт для родителя / будущего backend. */
    exportJSON: function () { return JSON.stringify(data, null, 2); }
  };

  global.Store = Store;

})(window);
