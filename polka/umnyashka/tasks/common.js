/* =========================================================
   tasks/common.js — общий набор механик для миров
   «Космос», «Школа» и «Мой мир».

   Здесь нет контента — только способы взаимодействия:
     answerBoard — выбор одного варианта (порт из tasks/math.js);
     orderBoard  — «расставь по порядку» (тап по плиткам);
     pairBoard   — сопоставление пар из двух колонок;
     memoryShow  — «запомни → исчезло → ответь»;
     findAll     — «найди все такие» на поле символов;
     teachCard   — карточка знакомства с темой.

   Контракт с движком (tasks/engine.js) тот же, что у чтения
   и математики: api.answer(ok, {hint, reveal, onRetry, node}).
   ========================================================= */
(function (global) {
  'use strict';

  var el = function () { return UI.el.apply(null, arguments); };

  /* =====================================================
     Выбор одного варианта
     values: массив значений; o.fill(v, tile) рисует плитку.
     ===================================================== */
  function answerBoard(api, values, o) {
    o = o || {};
    var locked = false;
    var tiles = [];
    var cols = values.length === 2 ? 2 : (values.length === 4 ? 4 : 3);
    var cls = 'opts' + (o.wide ? '' : ' opts--' + cols) + (o.class ? ' ' + o.class : '');
    var wrap = el('div', { class: cls });

    function right(v) { return o.isRight ? !!o.isRight(v) : v === o.answer; }

    function showAnswer() {
      tiles.forEach(function (t) {
        if (right(t.__value)) t.classList.add('is-right');
        else t.classList.add('is-dim');
      });
      if (o.onReveal) o.onReveal();
    }

    function choose(v, tile) {
      if (locked || tile.__used) return;
      tile.__used = true;
      locked = true;
      if (right(v)) {
        tile.classList.add('is-right');
        tiles.forEach(function (t) { if (t !== tile) t.classList.add('is-dim'); });
        if (o.onRight) o.onRight(v, tile);
        api.answer(true, { node: tile });
      } else {
        tile.classList.add('is-almost');
        api.answer(false, {
          hint: o.hint || '',
          answerHint: o.answerHint || o.hint || '',
          reveal: showAnswer,
          onRetry: function () {
            locked = false;
            tile.classList.remove('is-almost');
            tile.classList.add('is-dim');
          }
        });
      }
    }

    values.forEach(function (v) {
      var tile = el('button', {
        class: 'opt' + (o.optClass ? ' ' + o.optClass : ''), type: 'button',
        dataset: { v: String(v && v.id !== undefined ? v.id : v), ok: right(v) ? '1' : '0' }
      });
      tile.__value = v;
      (o.fill || function (val, t) { t.appendChild(el('span', { text: String(val) })); })(v, tile);
      tile.addEventListener('click', function () { choose(v, tile); });
      tiles.push(tile);
      wrap.appendChild(tile);
    });

    wrap.__tiles = tiles;
    return wrap;
  }

  /* Готовые заполнители плиток */
  function fillEmoji(v, tile) {
    tile.appendChild(el('span', { class: 'ck-big', text: String(v) }));
  }
  function fillEmojiText(v, tile) {
    tile.appendChild(el('span', { class: 'ck-big', text: v.emoji || '' }));
    tile.appendChild(el('span', { class: 'ck-cap', text: v.label || '' }));
  }
  function fillText(v, tile) {
    tile.appendChild(el('span', { class: 'ck-txt', text: String(v.label !== undefined ? v.label : v) }));
  }

  /* =====================================================
     «Расставь по порядку».
     o: { items: [{id, emoji, label?}] в ПРАВИЛЬНОМ порядке,
          hint, answerHint, arrow ('→' по умолчанию), labels }
     Ребёнок тапает плитки из «кучи» — они занимают слоты слева
     направо. Тап по занятому слоту возвращает плитку в кучу.
     Проверка — автоматически при заполнении всех слотов.
     ===================================================== */
  function orderBoard(api, o) {
    var items = o.items;
    var slots = [], placed = [];
    var locked = false;

    var slotRow = el('div', { class: 'ck-slots', dataset: { answer: items.map(function (i) { return i.id; }).join('|') } });
    items.forEach(function (_, i) {
      var s = el('button', { class: 'ck-slot' + (o.words ? ' ck-slot--word' : ''), type: 'button', 'aria-label': 'Место ' + (i + 1) });
      s.addEventListener('click', function () {
        if (locked || placed[i] === undefined) return;
        SFX.tick();
        var it = placed[i];
        placed[i] = undefined;
        s.innerHTML = ''; s.classList.remove('is-filled');
        poolBtn(it).classList.remove('is-used');
      });
      slots.push(s);
      slotRow.appendChild(s);
      if (i < items.length - 1) slotRow.appendChild(el('span', { class: 'ck-arrow', text: o.arrow || '→' }));
    });

    var poolWrap = el('div', { class: 'ck-pool' });
    var poolMap = {};
    function poolBtn(it) { return poolMap[it.id]; }
    function faceOf(it) {
      return el('span', { class: it.emoji ? 'ck-big' : 'ck-txt', text: it.emoji || it.label });
    }

    UI.shuffle(items).forEach(function (it) {
      var b = el('button', { class: 'ck-tile', type: 'button', dataset: { id: String(it.id) } }, [
        faceOf(it),
        it.emoji && it.label && o.labels !== false ? el('span', { class: 'ck-cap', text: it.label }) : null
      ]);
      b.addEventListener('click', function () {
        if (locked || b.classList.contains('is-used')) return;
        var free = -1;
        for (var i = 0; i < items.length; i++) if (placed[i] === undefined) { free = i; break; }
        if (free < 0) return;
        SFX.tap();
        placed[free] = it;
        b.classList.add('is-used');
        slots[free].classList.add('is-filled');
        slots[free].appendChild(faceOf(it));
        if (placed.filter(function (x) { return x !== undefined; }).length === items.length) check();
      });
      poolMap[it.id] = b;
      poolWrap.appendChild(b);
    });

    function reset() {
      placed = [];
      slots.forEach(function (s) { s.innerHTML = ''; s.classList.remove('is-filled', 'is-right'); });
      Object.keys(poolMap).forEach(function (k) { poolMap[k].classList.remove('is-used'); });
    }

    function reveal() {
      reset();
      locked = true;
      items.forEach(function (it, i) {
        slots[i].classList.add('is-filled', 'is-right');
        slots[i].appendChild(faceOf(it));
        poolMap[it.id].classList.add('is-used');
      });
    }

    function check() {
      var ok = items.every(function (it, i) { return placed[i] && placed[i].id === it.id; });
      locked = true;
      if (ok) {
        slots.forEach(function (s) { s.classList.add('is-right'); });
        api.answer(true, { node: slotRow });
      } else {
        api.answer(false, {
          hint: o.hint || 'Посмотри внимательно, что идёт сначала.',
          answerHint: o.answerHint || o.hint || '',
          reveal: reveal,
          onRetry: function () { locked = false; reset(); }
        });
      }
    }

    return el('div', { class: 'ck-order' }, [slotRow, poolWrap]);
  }

  /* =====================================================
     Сопоставление пар.
     o: { pairs: [{a:{emoji,label?}, b:{emoji,label?}}], hint }
     Тап по карточке слева, потом по карточке справа.
     Ошибка учитывается один раз (первая), дальше можно доделать.
     ===================================================== */
  function pairBoard(api, o) {
    var pairs = o.pairs;
    var chosen = null;
    var doneCount = 0;
    var missed = false, judged = false, locked = false;

    function side(list, which) {
      var col = el('div', { class: 'ck-col' });
      list.forEach(function (p, idx) {
        var it = p[which];
        var b = el('button', { class: 'ck-tile ck-tile--pair', type: 'button', dataset: { i: String(idx), pair: '' } }, [
          el('span', { class: 'ck-big', text: it.emoji }),
          it.label ? el('span', { class: 'ck-cap', text: it.label }) : null
        ]);
        b.__idx = idx; b.__side = which;
        b.addEventListener('click', function () { tap(b); });
        col.appendChild(b);
      });
      return col;
    }

    var leftOrder = pairs.map(function (p, i) { return { p: p, i: i }; });
    var rightOrder = UI.shuffle(leftOrder.slice());
    var leftCol = side(leftOrder.map(function (x) { return { a: x.p.a, __i: x.i }; }).map(function (x, n) {
      return { a: pairs[leftOrder[n].i].a, b: pairs[leftOrder[n].i].b };
    }), 'a');
    // индексы левой колонки — в исходном порядке пар
    Array.prototype.forEach.call(leftCol.children, function (b, n) { b.__pair = leftOrder[n].i; b.dataset.pair = String(leftOrder[n].i); });
    var rightCol = side(rightOrder.map(function (x) { return pairs[x.i]; }), 'b');
    Array.prototype.forEach.call(rightCol.children, function (b, n) { b.__pair = rightOrder[n].i; b.dataset.pair = String(rightOrder[n].i); });

    function tap(b) {
      if (locked || b.classList.contains('is-done')) return;
      SFX.tap();
      if (!chosen) {
        chosen = b;
        b.classList.add('is-on');
        return;
      }
      if (b === chosen) { b.classList.remove('is-on'); chosen = null; return; }
      if (b.__side === chosen.__side) {
        chosen.classList.remove('is-on');
        chosen = b; b.classList.add('is-on');
        return;
      }
      var a = chosen, first = a; chosen = null;
      if (a.__pair === b.__pair) {
        a.classList.remove('is-on');
        a.classList.add('is-done'); b.classList.add('is-done');
        SFX.right();
        doneCount++;
        if (doneCount === pairs.length && !judged) {
          judged = true;
          api.answer(!missed, missed ? {
            hint: o.hint || '', answerHint: o.hint || '',
            reveal: function () {}, onRetry: function () {}
          } : { node: b });
        }
      } else {
        a.classList.remove('is-on');
        a.classList.add('is-almost'); b.classList.add('is-almost');
        SFX.almost();
        setTimeout(function () {
          a.classList.remove('is-almost'); b.classList.remove('is-almost');
        }, 500);
        if (!missed && !judged) {
          missed = true;
          locked = true;
          judged = true;
          api.answer(false, {
            hint: o.hint || 'Подумай, что к чему подходит.',
            answerHint: o.hint || '',
            reveal: function () {
              pairs.forEach(function (_, i) {
                Array.prototype.forEach.call(leftCol.children, function (n) { if (n.__pair === i) n.classList.add('is-done'); });
                Array.prototype.forEach.call(rightCol.children, function (n) { if (n.__pair === i) n.classList.add('is-done'); });
              });
            },
            onRetry: function () { locked = false; judged = false; }
          });
        }
      }
    }

    return el('div', { class: 'ck-pairs' }, [leftCol, rightCol]);
  }

  /* =====================================================
     «Запомни»: показываем ряд, прячем, потом задаём вопрос.
     o: { items: [эмодзи], showMs, after(container) — что
          показать после скрытия (обычно answerBoard) }
     ===================================================== */
  function memoryShow(api, o) {
    var wrap = el('div', { class: 'ck-memory', dataset: { items: o.items.join('|') } });
    var row = el('div', { class: 'ck-mem-row' }, o.items.map(function (e) {
      return el('span', { class: 'ck-mem-item', text: e });
    }));
    var barWrap = UI.bar(100);
    wrap.appendChild(row);
    wrap.appendChild(el('div', { class: 'ck-mem-bar' }, [barWrap]));

    var ms = o.showMs || 3000;
    // Роутер вставляет экран с задержкой ~110мс: отсчёт начинаем только
    // после монтирования, а снимаем таймер лишь когда узел УЖЕ был в DOM
    // и исчез (уход с экрана) — иначе показ «умирал» на первом тике.
    var t0 = 0, wasConnected = false;
    var iv = setInterval(function () {
      if (!document.body.contains(wrap)) {   // isConnected нет в старых WebView
        if (wasConnected) clearInterval(iv);
        return;
      }
      if (!wasConnected) { wasConnected = true; t0 = Date.now(); }
      var left = Math.max(0, 1 - (Date.now() - t0) / ms);
      barWrap.setPercent(left * 100);
      if (left <= 0) {
        clearInterval(iv);
        row.innerHTML = '';
        o.items.forEach(function () {
          row.appendChild(el('span', { class: 'ck-mem-item ck-mem-item--hidden', text: '❓' }));
        });
        wrap.appendChild(o.after(wrap));
      }
    }, 100);

    return wrap;
  }

  /* =====================================================
     «Найди все»: поле символов, нужно тапнуть все нужные.
     o: { symbols: [{ch, target}], hint }
     Ошибка учитывается один раз, поле можно доделать.
     ===================================================== */
  function findAll(api, o) {
    var total = o.symbols.filter(function (s) { return s.target; }).length;
    var found = 0, missed = false, judged = false;

    var grid = el('div', { class: 'ck-find' });
    o.symbols.forEach(function (s) {
      var b = el('button', { class: 'ck-find__cell', type: 'button', dataset: { t: s.target ? '1' : '0' } }, [
        el('span', { text: s.ch })
      ]);
      b.addEventListener('click', function () {
        if (judged) return;   // пока открыт фидбек — поле заморожено
        if (b.classList.contains('is-done')) return;
        if (s.target) {
          b.classList.add('is-done');
          SFX.right();
          found++;
          if (found === total && !judged) {
            judged = true;
            api.answer(!missed, missed ? { hint: o.hint || '' } : { node: grid });
          }
        } else {
          b.classList.add('is-almost');
          SFX.almost();
          setTimeout(function () { b.classList.remove('is-almost'); }, 450);
          if (!missed && !judged) {
            missed = true; judged = true;
            api.answer(false, {
              hint: o.hint || 'Ищи внимательно!',
              reveal: function () {
                Array.prototype.forEach.call(grid.children, function (n) {
                  if (n.dataset.t === '1') n.classList.add('is-done');
                });
              },
              onRetry: function () { judged = false; }
            });
          }
        }
      });
      grid.appendChild(b);
    });

    return grid;
  }

  /* =====================================================
     Карточка знакомства (teach): большая сцена + факты.
     o: { emoji, big (html-сцена вместо эмодзи), title,
          rows: [{ico, text}], fact }
     ===================================================== */
  function teachCard(o) {
    return el('div', { class: 'ck-teach appear' }, [
      o.big || el('div', { class: 'ck-teach__hero', text: o.emoji || '' }),
      o.title ? el('h3', { class: 'ck-teach__title', text: o.title }) : null,
      el('div', { class: 'ck-teach__rows' }, (o.rows || []).map(function (r) {
        return el('div', { class: 'ck-teach__row' }, [
          el('span', { class: 'ck-teach__ico', text: r.ico || '•' }),
          el('span', { text: r.text })
        ]);
      })),
      o.fact ? el('div', { class: 'ck-teach__fact' }, [
        el('span', { text: '💡 ' }),
        el('span', { text: o.fact })
      ]) : null
    ]);
  }

  global.TaskKit = {
    answerBoard: answerBoard,
    orderBoard: orderBoard,
    pairBoard: pairBoard,
    memoryShow: memoryShow,
    findAll: findAll,
    teachCard: teachCard,
    fillEmoji: fillEmoji,
    fillEmojiText: fillEmojiText,
    fillText: fillText
  };

})(window);
