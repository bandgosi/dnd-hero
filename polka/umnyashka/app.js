/* =========================================================
   app.js — сборка приложения и запуск.
   ========================================================= */
(function (global) {
  'use strict';

  function applySettings() {
    var s = Store.settings;
    var reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    FX.setEnabled(s.animations && !reduce);
    document.body.classList.toggle('no-anim', !s.animations || !!reduce);
    if (!s.sound) Speech.stop();
  }

  /* =========================================================
     Связь с общим оглавлением «Детская полка».
     Модуль необязателен: если приложение открыли отдельно,
     всё работает как раньше.
     ========================================================= */
  function syncWithHub() {
    if (!global.KidHub) return;

    // Имя и персонаж, заданные в оглавлении, — главнее локальных
    var shared = KidHub.get();
    if (shared.name && shared.name !== Store.data.name) Store.setName(shared.name);
    if (shared.character && shared.character !== Store.data.character) {
      // берём только знакомого персонажа, чужой id игнорируем
      if (Characters.byId(shared.character).id === shared.character) {
        Store.setCharacter(shared.character);
      }
    }

    // Кнопка «ко всем играм» — ребёнок всегда может выйти
    KidHub.addHomeButton('../index.html');

    // Сводка для карточки в оглавлении
    function pushSummary() {
      var tracks = Curriculum.TRACK_ORDER;
      var sum = tracks.reduce(function (a, t) { return a + Curriculum.trackPercent(t); }, 0);
      KidHub.setSummary('umnyashka', {
        percent: Math.round(sum / tracks.length),
        stars: Store.totalStars(),
        label: 'Уровень ' + Store.level().level
      });
    }
    pushSummary();
    Store.onChange(pushSummary);

    // Имя, изменённое внутри приложения, возвращаем в общий профиль
    var lastName = Store.data.name, lastChar = Store.data.character;
    Store.onChange(function (d) {
      if (d.name !== lastName) { lastName = d.name; KidHub.setName(d.name); }
      if (d.character !== lastChar) { lastChar = d.character; KidHub.setCharacter(d.character); }
    });
  }

  function registerRoutes() {
    Router.define('welcome',    Screens.Welcome);
    Router.define('home',       Screens.Home);
    Router.define('path',       Screens.Path);
    Router.define('lesson',     Tasks.LessonScreen);
    Router.define('games',      Screens.Games);
    Router.define('game',       Games.Screen);
    Router.define('progress',   Screens.Progress);
    Router.define('rewards',    Screens.Rewards);
    Router.define('settings',   Screens.Settings);
    Router.define('parentgate', Screens.ParentGate);
    Router.define('parent',     Screens.Parent);
    Router.define('schoolday',  Screens.SchoolDay);
    Router.define('collection', Screens.Collection);
  }

  function boot() {
    // Подписки до init: награда за серию дней должна быть замечена
    Store.onAchievement = UI.achievementToast;
    Store.onReward = function (r) {
      SFX.reward();
      FX.rain([r.emoji, '🎁', '✨'], 14);
      UI.toast('Новый предмет: ' + r.title, { type: 'gold', emoji: r.emoji, duration: 3200 });
      Speech.phrase('Ты получил новый предмет: ' + r.title);
    };

    Storage2.onFail = function () {
      setTimeout(function () {
        UI.toast('Прогресс не сохраняется на этом устройстве', { emoji: '⚠️', duration: 5000 });
      }, 900);
      Storage2.onFail = null;   // предупреждаем один раз
    };

    try {
      Store.init();
    } catch (e) {
      console.warn('Профиль повреждён, начинаем заново', e);
      // Сохраняем копию: полгода занятий не должны исчезать молча
      try { Storage2.set('umnyashka.profile.broken', Storage2.get('umnyashka.profile.v1', null)); } catch (x) {}
      Store.reset();
      setTimeout(function () {
        UI.toast('Не удалось прочитать прогресс — начинаем заново', { emoji: '⚠️', duration: 5000 });
      }, 900);
    }

    syncWithHub();

    FX.init();
    applySettings();
    registerRoutes();
    Achievements.checkCounters();

    Router.go(Store.isNew() ? 'welcome' : 'home', {}, { silent: true });

    if (Store.data.streak.count > 1) {
      setTimeout(function () {
        UI.toast('Ты занимаешься ' + Store.data.streak.count + ' дня подряд!',
                 { type: 'gold', emoji: '🔥', duration: 3000 });
      }, 1400);
    }

    // Esc закрывает только модальное окно: панель обратной связи —
    // единственный путь дальше в заданиях с вариантами ответа
    global.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') UI.closeModal();
    });

    // При сворачивании вкладки глушим речь и дописываем прогресс на диск
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { Speech.stop(); Store.save(true); }
    });
    global.addEventListener('pagehide', function () { Store.save(true); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.App = { applySettings: applySettings, boot: boot };

})(window);
