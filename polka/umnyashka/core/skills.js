/* =========================================================
   core/skills.js — модель навыка.
   Навык = то, что можно измерить и повторить: буква, звук,
   слог, слово, цифра, сложение… Хранит статистику ребёнка.
   ========================================================= */
(function (global) {
  'use strict';

  var MASTER_ACC = 0.85;   // точность для «освоено»
  var MASTER_STREAK = 4;   // и столько верных подряд
  var WEAK_ACC = 0.7;      // ниже этого — слабое место
  var MIN_ATTEMPTS = 3;    // раньше судить рано

  function blank(id) {
    return {
      id: id,
      attempts: 0, correct: 0,
      accuracy: 0,
      streak: 0,
      level: 1,        // сложность заданий 1..3
      box: 0,          // ступень интервального повторения
      dueAt: 0,
      lastAt: 0,
      mastered: false,
      introduced: false,
      levelUpThisLesson: false
    };
  }

  function get(id) {
    var all = Store.data.skills;
    var s = all[id];
    // Повреждённая или чужая запись не должна ронять урок
    if (!s || typeof s !== 'object' || Array.isArray(s)) s = all[id] = blank(id);
    ['attempts', 'correct', 'accuracy', 'streak', 'level', 'box', 'dueAt', 'lastAt'].forEach(function (k) {
      if (typeof s[k] !== 'number' || !isFinite(s[k])) s[k] = blank(id)[k];
    });
    if (s.introduced === undefined) s.introduced = s.attempts > 0;
    return s;
  }

  /**
   * Сгладенная точность: последние ответы весят больше, поэтому
   * прогресс ребёнка виден быстро, а старые ошибки не тянут вечно.
   */
  function updateAccuracy(s, ok) {
    var w = s.attempts <= 3 ? 0.5 : 0.25;
    var raw = ok ? 1 : 0;
    s.accuracy = s.attempts === 0 ? raw : s.accuracy * (1 - w) + raw * w;
    s.accuracy = Math.round(s.accuracy * 1000) / 1000;
  }

  var Skills = {
    MASTER_ACC: MASTER_ACC,
    WEAK_ACC: WEAK_ACC,

    get: get,
    blank: blank,

    exists: function (id) { return !!Store.data.skills[id]; },

    /** Отметить знакомство с навыком (шаг «изучение»). */
    introduce: function (id) {
      var s = get(id);
      if (!s.introduced) { s.introduced = true; s.lastAt = Date.now(); Store.save(); }
      return s;
    },

    /** Записать результат ответа. Возвращает обновлённый навык. */
    record: function (id, ok) {
      var s = get(id);
      updateAccuracy(s, ok);
      s.attempts++;
      if (ok) { s.correct++; s.streak++; } else { s.streak = 0; }
      s.lastAt = Date.now();
      s.introduced = true;

      // Сложность растёт не чаще раза за урок и только после «отлежавшегося» навыка,
      // иначе на третьем задании ребёнок теряет картинку-опору. Серию не сбрасываем.
      if (ok && s.streak >= 3 && s.level < 3 && s.box >= 2 && !s.levelUpThisLesson) {
        s.level++;
        s.levelUpThisLesson = true;
      }
      if (!ok && s.level > 1 && s.accuracy < 0.5) s.level--;

      // Освоено = точность И серия подряд (как обещано в методике)
      s.mastered = s.accuracy >= MASTER_ACC && s.streak >= MASTER_STREAK;

      SRS.schedule(s, ok);
      Store.save();
      return s;
    },

    /** Освоен ли навык. */
    isMastered: function (id) {
      var s = Store.data.skills[id];
      return !!(s && s.mastered);
    },

    /** Слабое место: достаточно попыток и низкая точность. */
    isWeak: function (id) {
      var s = Store.data.skills[id];
      return !!(s && s.attempts >= MIN_ATTEMPTS && s.accuracy < WEAK_ACC);
    },

    /** Вес показа: чем хуже точность, тем чаще показываем. */
    weight: function (id) {
      var s = Store.data.skills[id];
      if (!s || s.attempts === 0) return 1;
      return 1 + (1 - s.accuracy) * 2.5;      // 98% → ~1.05, 52% → ~2.2
    },

    /** Все слабые навыки, худшие первыми. */
    weakest: function (ids, limit) {
      var list = (ids || Object.keys(Store.data.skills)).filter(Skills.isWeak);
      list.sort(function (a, b) { return get(a).accuracy - get(b).accuracy; });
      return limit ? list.slice(0, limit) : list;
    },

    /** Снять пометку «уровень уже поднимали» — вызывается в начале урока. */
    startLesson: function (ids) {
      (ids || []).forEach(function (id) { get(id).levelUpThisLesson = false; });
    },

    /** Сводка по группе навыков — для экрана прогресса и родителя. */
    summary: function (ids) {
      var total = ids.length, mastered = 0, seen = 0, accSum = 0, accN = 0;
      ids.forEach(function (id) {
        var s = Store.data.skills[id];
        if (!s || !s.introduced) return;
        seen++;
        if (s.mastered) mastered++;
        if (s.attempts > 0) { accSum += s.accuracy; accN++; }
      });
      return {
        total: total, seen: seen, mastered: mastered,
        percent: total ? Math.round(mastered / total * 100) : 0,
        accuracy: accN ? accSum / accN : 0,
        stars: total ? Math.max(0, Math.min(5, Math.round(mastered / total * 5))) : 0
      };
    }
  };

  global.Skills = Skills;

})(window);
