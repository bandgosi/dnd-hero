/* =========================================================
   data/achievements.js — достижения и награды-предметы.
   У каждой записи есть понятная подсказка «как получить»:
   мотивация должна быть прозрачной, а не случайной.
   ========================================================= */
(function (global) {
  'use strict';

  var ACHIEVEMENTS = [
    { id: 'first-step',  emoji: '👣', title: 'Первый шаг',    desc: 'Пройден первый урок' },
    { id: 'first-letter',emoji: '🅰️', title: 'Знаю буквы',    desc: 'Выучены первые буквы' },
    { id: 'first-write', emoji: '✍️', title: 'Пишу сам',      desc: 'Написана первая буква' },
    { id: 'syllables',   emoji: '🔤', title: 'Читаю слоги',   desc: 'Освоены слоги' },
    { id: 'first-word',  emoji: '📗', title: 'Первое слово',  desc: 'Прочитано слово целиком' },
    { id: 'sentence',    emoji: '💬', title: 'Целая фраза',   desc: 'Собрано предложение' },
    { id: 'alphabet',    emoji: '🎓', title: 'Весь алфавит',  desc: 'Знакомы все 33 буквы' },
    { id: 'digits',      emoji: '🔢', title: 'Знаю цифры',    desc: 'Выучены цифры 0–9' },
    { id: 'count10',     emoji: '🔟', title: 'Считаю до 10',  desc: 'Освоен счёт до 10' },
    { id: 'count20',     emoji: '🎯', title: 'Считаю до 20',  desc: 'Освоен счёт до 20' },
    { id: 'plus',        emoji: '➕', title: 'Складываю',     desc: 'Освоено сложение' },
    { id: 'minus',       emoji: '➖', title: 'Вычитаю',       desc: 'Освоено вычитание' },
    { id: 'problems',    emoji: '🧠', title: 'Решаю задачи',  desc: 'Решены задачи' },
    { id: 'write-num',   emoji: '✏️', title: 'Пишу цифры',    desc: 'Написаны цифры' },
    { id: 'combo10',     emoji: '🔥', title: '10 подряд',     desc: '10 верных ответов подряд' },
    { id: 'perfect',     emoji: '⭐', title: 'Без ошибок',    desc: 'Урок на три звезды' },
    { id: 'stars15',     emoji: '🏆', title: 'Звездочёт',     desc: 'Собрано 15 звёзд' },
    { id: 'stars40',     emoji: '👑', title: 'Чемпион',       desc: 'Собрано 40 звёзд' },
    { id: 'daily-1',     emoji: '⚡', title: 'Тренировка',    desc: 'Завершена дневная тренировка' },
    { id: 'streak3',     emoji: '📅', title: 'Три дня',       desc: 'Занятия 3 дня подряд' },
    { id: 'streak7',     emoji: '🗓️', title: 'Целая неделя',  desc: 'Занятия 7 дней подряд' },
    { id: 'games-all',   emoji: '🎮', title: 'Игрок',         desc: 'Сыграно во все мини-игры' },
    { id: 'xp500',       emoji: '💎', title: '500 опыта',     desc: 'Набрано 500 XP' },
    { id: 'both-tracks', emoji: '🌈', title: 'И то, и то',    desc: 'Есть успехи в чтении и в математике' }
  ];

  /* Предметы персонажа. Открываются за освоение разделов,
     а не за количество нажатий — награда должна что-то значить. */
  var REWARDS = [
    { id: 'hat-crown',  emoji: '👑', title: 'Корона',     slot: 'hat',     need: { stars: 20 } },
    { id: 'hat-cap',    emoji: '🧢', title: 'Кепка',      slot: 'hat',     need: { unit: 'r-let-1' } },
    { id: 'hat-party',  emoji: '🎩', title: 'Цилиндр',    slot: 'hat',     need: { unit: 'm-dig-1' } },
    { id: 'hat-grad',   emoji: '🎓', title: 'Шапочка',    slot: 'hat',     need: { ach: 'alphabet' } },
    { id: 'gl-sun',     emoji: '🕶️', title: 'Очки',       slot: 'glasses', need: { unit: 'r-syl-1' } },
    { id: 'gl-smart',   emoji: '👓', title: 'Умные очки', slot: 'glasses', need: { unit: 'm-add-1' } },
    { id: 'bag-school', emoji: '🎒', title: 'Рюкзак',     slot: 'bag',     need: { unit: 'r-wd-1' } },
    { id: 'bag-magic',  emoji: '🎁', title: 'Мешок',      slot: 'bag',     need: { stars: 30 } },
    { id: 'pet-bird',   emoji: '🐤', title: 'Птенчик',    slot: 'pet',     need: { unit: 'm-cnt-1' } },
    { id: 'pet-frog',   emoji: '🐸', title: 'Лягушонок',  slot: 'pet',     need: { unit: 'r-wr-1' } },
    { id: 'pet-uni',    emoji: '🦄', title: 'Единорог',   slot: 'pet',     need: { ach: 'streak7' } },
    { id: 'pet-dragon', emoji: '🐲', title: 'Дракончик',  slot: 'pet',     need: { stars: 45 } }
  ];

  function need2text(need) {
    if (need.stars) return 'Собери ' + need.stars + ' звёзд';
    if (need.unit) {
      var u = global.Curriculum && Curriculum.byId(need.unit);
      return 'Пройди урок «' + (u ? u.title : need.unit) + '»';
    }
    if (need.ach) {
      var a = Achievements.byId(need.ach);
      return 'Получи награду «' + (a ? a.title : need.ach) + '»';
    }
    return '';
  }

  var Achievements = {
    LIST: ACHIEVEMENTS,
    REWARDS: REWARDS,

    byId: function (id) {
      for (var i = 0; i < ACHIEVEMENTS.length; i++) if (ACHIEVEMENTS[i].id === id) return ACHIEVEMENTS[i];
      return null;
    },
    rewardById: function (id) {
      for (var i = 0; i < REWARDS.length; i++) if (REWARDS[i].id === id) return REWARDS[i];
      return null;
    },
    needText: need2text,

    /** Проверить и выдать все заслуженные награды-предметы. */
    checkRewards: function () {
      var stars = Store.totalStars();
      REWARDS.forEach(function (r) {
        if (Store.hasReward(r.id)) return;
        var ok = false;
        if (r.need.stars) ok = stars >= r.need.stars;
        else if (r.need.unit) ok = Store.unit(r.need.unit).done;
        else if (r.need.ach) ok = Store.hasAch(r.need.ach);
        if (ok) Store.unlockReward(r.id);
      });
    },

    /** Проверить достижения, зависящие от накопленных чисел. */
    checkCounters: function () {
      var d = Store.data;
      if (d.xp >= 500) Store.unlockAch('xp500');
      if (d.stats.bestCombo >= 10) Store.unlockAch('combo10');
      var stars = Store.totalStars();
      if (stars >= 15) Store.unlockAch('stars15');
      if (stars >= 40) Store.unlockAch('stars40');
      if (d.streak.count >= 3) Store.unlockAch('streak3');
      if (d.streak.count >= 7) Store.unlockAch('streak7');
      if (global.Curriculum) {
        var r = Curriculum.trackPercent('reading'), m = Curriculum.trackPercent('math');
        if (r > 0 && m > 0) Store.unlockAch('both-tracks');
      }
      Achievements.checkRewards();
    }
  };

  global.Achievements = Achievements;

})(window);
