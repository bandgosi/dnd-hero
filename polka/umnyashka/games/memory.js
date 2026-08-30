/* =========================================================
   games/memory.js — мини-игра «Найди пару» (memory).
   Правила учителя: максимум поле 4×4, хвалим за завершение,
   таймера нет, счётчик ходов — просто информация.
   ========================================================= */
(function (global) {
  'use strict';

  var el = function () { return UI.el.apply(null, arguments); };

  var DECKS = [
    ['🐱', '🐶', '🦊', '🐰', '🐻', '🐸', '🦁', '🐮'],
    ['🍎', '🍌', '🍓', '🍇', '🍉', '🍒', '🍑', '🥝'],
    ['✏️', '📚', '🎒', '📏', '🖍️', '🧮', '📎', '🔔']
  ];

  Games.register({
    id: 'pairs',
    emoji: '🃏',
    title: 'Найди пару',
    rules: 'Открывай карточки по две. Найди все пары!',
    track: 'school',
    unit: 'Внимание и память',

    build: function (shell) {
      var plays = Store.game('pairs').plays;
      var pairsCount = plays < 1 ? 4 : plays < 3 ? 6 : 8;   // 2×4 → 3×4 → 4×4
      var deck = DECKS[plays % DECKS.length].slice(0, pairsCount);
      var cards = UI.shuffle(deck.concat(deck));

      var first = null, lock = false, found = 0, moves = 0;
      shell.setScore(0);
      shell.setExtra(0, '👣');

      var grid = el('div', {
        class: 'pair-grid' + (pairsCount === 4 ? ' pair-grid--2x4' : ''),
        role: 'grid'
      });

      cards.forEach(function (face) {
        var open = false, done = false;
        var inner = el('span', { class: 'pair-card__face', text: '❓' });
        var card = el('button', { class: 'pair-card', type: 'button', 'aria-label': 'Карточка' }, [inner]);

        function show(v) { inner.textContent = v ? face : '❓'; card.classList.toggle('is-open', !!v); }

        card.addEventListener('click', function () {
          if (lock || open || done || shell.isFinished()) return;
          SFX.tap();
          open = true; show(true);

          if (!first) { first = { face: face, close: function () { open = false; show(false); }, mark: function () { done = true; } }; return; }

          moves++;
          shell.setExtra(moves, '👣');
          var prev = first; first = null;

          if (prev.face === face) {
            prev.mark(); done = true;
            found++;
            shell.setScore(found);
            SFX.right();
            shell.answer(true, 'wg:1');
            if (found === pairsCount) {
              shell.timeout(function () { shell.result(pairsCount, pairsCount); }, 600);
            }
          } else {
            lock = true;
            SFX.almost();
            // Несовпадение в memory — нормальная разведка, а не ошибка:
            // в статистику навыков её не пишем (правка код-ревью)
            shell.timeout(function () {
              prev.close(); open = false; show(false); lock = false;
            }, 750);
          }
        });
        grid.appendChild(card);
      });

      shell.area.appendChild(el('div', { class: 'center-text t-small', text: 'Пар на поле: ' + pairsCount }));
      shell.area.appendChild(grid);
    }
  });

})(window);
