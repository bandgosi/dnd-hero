/* =========================================================
   core/srs.js — интервальное повторение и подбор заданий.
   Задания НЕ случайны: очередь урока собирается из нового
   материала, того, что пора повторить, и слабых мест.
   ========================================================= */
(function (global) {
  'use strict';

  var MIN = 60 * 1000, DAY = 24 * 60 * MIN;
  // Ступени подобраны под возраст 6–7 лет: след памяти на букву держится
  // хуже, чем у взрослого, поэтому верхняя граница — 12 дней, а не месяц.
  var INTERVALS = [10 * MIN, 1 * DAY, 2 * DAY, 4 * DAY, 7 * DAY, 12 * DAY];

  var SRS = {
    INTERVALS: INTERVALS,

    /** Пересчитать ступень и время следующего показа. */
    schedule: function (skill, ok) {
      if (ok) {
        // Ступень растёт, только если навык действительно «отлежался»:
        // иначе четыре верных ответа за минуту отправляли букву на две недели
        var waited = Date.now() - (skill.lastShownAt || 0);
        if (skill.box === 0 || waited >= INTERVALS[skill.box] * 0.6) {
          skill.box = Math.min(INTERVALS.length - 1, skill.box + 1);
        }
      } else {
        skill.box = Math.max(0, skill.box - 2);
      }
      skill.lastShownAt = Date.now();
      skill.dueAt = Date.now() + INTERVALS[skill.box];
      return skill;
    },

    isDue: function (id) {
      var s = Store.data.skills[id];
      if (!s || !s.introduced) return false;
      return s.dueAt <= Date.now();
    },

    /** Насколько «просрочен» навык — для сортировки повторения. */
    overdue: function (id) {
      var s = Store.data.skills[id];
      if (!s) return 0;
      return Date.now() - s.dueAt;
    },

    /**
     * Собрать очередь навыков на урок.
     * @param {object} o
     *   pool      — все навыки юнита в порядке изучения
     *   size      — сколько заданий нужно
     *   newLimit  — максимум новых навыков за урок
     */
    buildQueue: function (o) {
      var pool = o.pool || [];
      var size = o.size || 8;
      var newLimit = o.newLimit === undefined ? 2 : o.newLimit;

      var fresh = [], due = [], weak = [], known = [];

      pool.forEach(function (id) {
        var s = Store.data.skills[id];
        if (!s || !s.introduced) { fresh.push(id); return; }
        if (Skills.isWeak(id)) weak.push(id);
        else if (SRS.isDue(id)) due.push(id);
        else known.push(id);
      });

      // Равнопросроченные перемешиваем: при стабильной сортировке хвост юнита
      // (последние буквы) не попадал в урок никогда.
      var SAME = 6 * 60 * 60 * 1000;
      due = shuffle(due);
      due.sort(function (a, b) {
        var d = SRS.overdue(b) - SRS.overdue(a);
        return Math.abs(d) < SAME ? 0 : d;
      });
      weak = shuffle(weak);
      weak.sort(function (a, b) { return Skills.get(a).accuracy - Skills.get(b).accuracy; });

      var queue = [];
      var nNew = Math.min(newLimit, fresh.length, Math.max(1, Math.round(size * 0.25)));
      var nWeak = Math.min(weak.length, Math.round(size * 0.3));
      var nDue = Math.min(due.length, size - nNew - nWeak);

      // Новое идёт первым: сначала знакомимся, потом тренируем
      for (var i = 0; i < nNew; i++) queue.push({ id: fresh[i], mode: 'new' });
      for (var j = 0; j < nWeak; j++) queue.push({ id: weak[j], mode: 'weak' });
      for (var k = 0; k < nDue; k++) queue.push({ id: due[k], mode: 'due' });

      // Добираем знакомым материалом И теми навыками, с которыми только что
      // познакомились в этом уроке: цикл «изучение → тренировка».
      // Подставлять то, чего ребёнок ещё не видел, нельзя.
      var justIntroduced = queue
        .filter(function (q) { return q.mode === 'new'; })
        .map(function (q) { return q.id; });
      var practice = known.concat(justIntroduced);
      var filler = weightedOrder(practice);
      var idx = 0;
      while (queue.length < size && filler.length) {
        queue.push({ id: filler[idx % filler.length], mode: 'practice' });
        idx++;
        if (idx > size * 3) break;
      }
      // Если добирать нечем — урок просто короче, это нормально

      // Новое оставляем в начале, остальное перемешиваем,
      // чтобы ребёнок не заметил закономерности
      var head = queue.filter(function (q) { return q.mode === 'new'; });
      var tail = queue.filter(function (q) { return q.mode !== 'new'; });
      shuffle(tail);

      // Один и тот же навык не должен идти подряд
      for (var t = 1; t < tail.length; t++) {
        if (tail[t].id === tail[t - 1].id) {
          var swap = tail.findIndex(function (x, n) { return n > t && x.id !== tail[t - 1].id; });
          if (swap > -1) { var tmp = tail[t]; tail[t] = tail[swap]; tail[swap] = tmp; }
        }
      }
      return head.concat(tail).slice(0, size);
    },

    /**
     * Вернуть навык в тренировку внутри текущего урока после ошибки:
     * вставляем его через 2–3 задания.
     */
    reinsert: function (queue, pos, item) {
      var at = Math.min(queue.length, pos + 2 + Math.floor(Math.random() * 2));
      queue.splice(at, 0, { id: item.id, mode: 'retry' });
      return queue;
    },

    /** Сколько навыков ждут повторения прямо сейчас. */
    dueCount: function (pool) {
      return (pool || Object.keys(Store.data.skills)).filter(SRS.isDue).length;
    }
  };

  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /**
   * Порядок с учётом веса: чем ниже точность, тем раньше и чаще навык
   * попадает в добор. Буква с точностью 52% встречается примерно вдвое
   * чаще, чем буква с точностью 98%.
   */
  function weightedOrder(ids) {
    var out = [];
    shuffle(ids).forEach(function (id) {
      var w = Math.max(1, Math.round(Skills.weight(id)));
      for (var i = 0; i < w; i++) out.push(id);
    });
    return shuffle(out);
  }

  global.SRS = SRS;

})(window);
