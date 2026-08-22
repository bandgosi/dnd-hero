/* =========================================================
   games/shell.js — общий каркас мини-игр.
   Игра регистрируется через Games.register и получает
   готовые HUD, окно правил, экран результата и уборку таймеров.
   ========================================================= */
(function (global) {
  'use strict';

  var el = function () { return UI.el.apply(null, arguments); };
  var REG = [];

  var Games = {
    LIST: REG,

    /**
     * @param {object} def
     *   id, emoji, title, rules, track ('reading'|'math'), unit (подпись «чему учит»)
     *   build: function (shell) { ... }   — вызывается при старте
     */
    register: function (def) {
      REG.push(def);
    },

    byId: function (id) {
      for (var i = 0; i < REG.length; i++) if (REG[i].id === id) return REG[i];
      return null;
    },

    ids: function () { return REG.map(function (g) { return g.id; }); },

    /** Экран мини-игры (регистрируется в роутере). */
    Screen: function (params) {
      var game = Games.byId(params.id);
      if (!game) { Router.go('games', {}, { replace: true }); return UI.screen(''); }
      return makeShell(game).screen;
    }
  };

  function makeShell(game) {
    var cleanups = [];
    var timers = [];
    var finished = false;
    var startedAt = Date.now();

    var scoreChip = UI.chip('0', 'sun', '⭐');
    var extraChip = UI.chip('', 'soft', '📍');
    extraChip.classList.add('hidden');
    var timerChip = UI.chip('60', 'grass', '⏳');
    timerChip.classList.add('hidden');

    var screen = UI.screen('game t-' + (game.track === 'math' ? 'math' : 'read'));
    var area = el('div', { class: 'game__area stack grow g4' });

    screen.appendChild(el('div', { class: 'topbar' }, [
      UI.iconBtn('←', function () { Router.go('games', {}, { replace: true }); }, 'Назад'),
      el('div', { class: 'topbar__title grow nowrap', text: game.emoji + ' ' + game.title }),
      extraChip, scoreChip, timerChip
    ]));
    screen.appendChild(area);

    var shell = {
      screen: screen,
      area: area,
      game: game,

      setScore: function (v) { scoreChip.lastChild.textContent = String(v); },
      setExtra: function (v, emoji) {
        extraChip.classList.toggle('hidden', v === null || v === undefined);
        if (v !== null && v !== undefined) {
          extraChip.lastChild.textContent = String(v);
          if (emoji) extraChip.firstChild.textContent = emoji;
        }
      },
      setTimer: function (sec) {
        timerChip.classList.toggle('hidden', sec === null);
        if (sec !== null) timerChip.lastChild.textContent = String(sec);
      },

      /** Все таймеры игры регистрируются здесь — их снимет роутер. */
      interval: function (fn, ms) { var id = setInterval(fn, ms); timers.push(id); return id; },
      timeout: function (fn, ms) { var id = setTimeout(fn, ms); timers.push(id); return id; },
      onCleanup: function (fn) { cleanups.push(fn); },

      /** Окно с правилами перед стартом. */
      intro: function (onStart) {
        UI.modal({
          emoji: game.emoji, title: game.title, text: game.rules,
          dismissable: false, speak: game.rules,
          actions: [
            { label: 'Начать!', variant: 'grass', emoji: '▶️', onClick: onStart },
            { label: 'Назад', variant: 'ghost', onClick: function () { Router.go('games', {}, { replace: true }); } }
          ]
        });
      },

      /** Показать итог. max — максимум очков (для нормировки опыта). */
      result: function (score, max) {
        if (finished) return;
        finished = true;
        cleanup();

        var r = Store.gameResult(game.id, score);
        var isBest = score > r.prevBest && score > 0;
        var norm = max ? Math.max(0, Math.min(1, score / max)) : Math.min(1, score / 15);
        var xp = Math.max(5, Math.round(norm * 25));
        Store.addXP(xp);
        if (Store.data.games && allPlayed()) Store.unlockAch('games-all');
        Achievements.checkCounters();

        SFX.reward();
        FX.confetti({ count: score > 0 ? 100 : 40 });

        area.innerHTML = '';
        area.appendChild(el('div', { class: 'card card--sun center-text appear' }, [
          el('div', { style: { fontSize: '64px' }, text: game.emoji }),
          el('h2', { class: 't-title mt2', text: isBest ? 'Новый рекорд!' : 'Отличная игра!' }),
          el('div', { class: 'center g2 mt4 wrap' }, [
            UI.chip(score + (max ? ' из ' + max : '') + ' очков', 'grass', '⭐'),
            UI.chip('+' + xp + ' XP', 'soft', '💎'),
            UI.chip('рекорд: ' + r.rec.best, 'sun', '🏅')
          ]),
          el('div', { class: 'stack g3 mt6' }, [
            UI.btn('Сыграть ещё', { variant: 'grass', block: true,
              onClick: function () { Router.go('game', { id: game.id }, { replace: true }); } }),
            UI.btn('К играм', { variant: 'ghost', block: true, small: true,
              onClick: function () { Router.go('games', {}, { replace: true }); } })
          ])
        ]));
        Speech.phrase(isBest ? 'Новый рекорд! Молодец!' : 'Отличная игра!');
      },

      /** Зафиксировать ответ ребёнка в статистике и навыках. */
      answer: function (ok, skillId) {
        Store.answer(ok);
        if (skillId) Skills.record(skillId, ok);
      },

      isFinished: function () { return finished; }
    };

    function allPlayed() {
      return Games.ids().every(function (id) { return Store.game(id).plays > 0; });
    }

    function cleanup() {
      timers.forEach(clearTimeout);
      timers.forEach(clearInterval);
      timers.length = 0;
      cleanups.forEach(function (f) { try { f(); } catch (e) {} });
      cleanups.length = 0;
      Speech.stop();
    }

    screen.__onLeave = function () {
      finished = true;
      cleanup();
      var min = (Date.now() - startedAt) / 60000;
      if (min > 0.05 && min < 60) Store.addMinutes(Math.min(min, 20));
    };

    shell.intro(function () {
      try { game.build(shell); }
      catch (e) {
        console.error('Игра не запустилась', game.id, e);
        area.appendChild(el('div', { class: 'card center-text' }, [
          el('div', { class: 't-sub', text: 'Игра сейчас недоступна' }),
          UI.btn('К играм', { variant: 'grass', block: true, onClick: function () { Router.go('games', {}, { replace: true }); } })
        ]));
      }
    });

    return shell;
  }

  global.Games = Games;

})(window);
