/* =========================================================
   tasks/math.js — типы заданий блока «Математика».

   Методическая основа (её нельзя «оптимизировать»):
   1. Сначала предметы, потом абстракция. Типы *Visual обязаны
      показывать реальные предметы; числовые типы — уже без них.
   2. Ребёнок 6–7 лет почти не читает: главный канал — озвучка.
      Поэтому в speak всё сказано словами: числа через Numbers.word,
      знаки — «плюс», «минус», «больше», «меньше», «равно».
   3. Предметы для счёта раскладываем пятёрками: так их пересчитывают
      пальцем, а не «на глаз» (см. PER_ROW и .mt-row).
   4. Ошибка — не провал: hint всегда подсказывает способ действия,
      а не сообщает «неправильно».
   5. level 1 — меньше вариантов и есть визуальная опора,
      level 3 — вариантов больше, опоры нет.

   Задания собираются генераторами из data/mathgen.js — свои не пишем.
   Письмо цифр живёт в tasks/tracing.js (writeDigit) и здесь не дублируется.
   ========================================================= */
(function (global) {
  'use strict';

  var el = function () { return UI.el.apply(null, arguments); };

  var PER_ROW = 5;      // предметы раскладываем пятёрками
  var TRIES = 260;      // попыток подобрать задание под нужный навык

  /* =====================================================
     Слова, навыки, границы разделов
     ===================================================== */

  function word(n) {
    var w = global.Numbers && Numbers.word(n);
    return w || String(n);
  }

  function signName(s) {
    var S = global.Numbers && Numbers.bySign(s);
    return S ? S.name : String(s);
  }

  function cap(s) {
    s = String(s);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /** «один, два, три» — счёт вслух для объяснений. */
  function countChain(n) {
    var out = [];
    for (var i = 1; i <= n; i++) out.push(word(i));
    return out.join(', ');
  }

  /** Число из идентификатора навыка: 'count:7' → 7. */
  function numFromSkill(id, def) {
    var v = parseInt(String(id || '').split(':')[1], 10);
    return isFinite(v) ? v : def;
  }

  /** Операция из навыка: 'problem:add' → 'add', 'sub:10' → 'sub'. */
  function opFromSkill(id, def) {
    var parts = String(id || '').split(':');
    if (parts[1] === 'add' || parts[1] === 'sub') return parts[1];
    if (parts[0] === 'add' || parts[0] === 'sub') return parts[0];
    return def;
  }

  /** Верхняя граница раздела берётся из навыков юнита, а не из воздуха. */
  function maxFromUnit(unit, prefix, def) {
    var list = (unit && unit.skills) || [];
    var best = 0, found = false;
    for (var i = 0; i < list.length; i++) {
      var p = String(list[i]).split(':');
      if (p[0] !== prefix) continue;
      var v = parseInt(p[1], 10);
      if (isFinite(v) && v > best) { best = v; found = true; }
    }
    return found ? best : def;
  }

  /**
   * Повторяем генератор, пока задание не совпадёт с нужным навыком.
   * Цикл ограничен: если не повезло — берём последнее задание,
   * оно корректно, просто про соседнее число.
   */
  function until(make, ok) {
    var d = make();
    for (var i = 0; i < TRIES && !ok(d); i++) d = make();
    return d;
  }

  /* =====================================================
     Варианты ответа
     ===================================================== */

  /** Сколько плиток показывать: level 1 — меньше, level 3 — больше. */
  function optCount(level, base) {
    if (level <= 1) return Math.max(2, base - 1);
    return base;
  }

  /** Оставить count вариантов, обязательно сохранив верный. */
  function cutOptions(options, answer, count) {
    var out = [answer];
    var rest = UI.shuffle(options.filter(function (v) { return v !== answer; }));
    for (var i = 0; i < rest.length && out.length < count; i++) out.push(rest[i]);
    return UI.shuffle(out);
  }

  /** Добрать вариантов соседними числами (нужно для level 3 в digitId). */
  function growOptions(options, answer, lo, hi, count) {
    count = Math.min(count, hi - lo + 1);
    var out = options.slice(), i, v;
    for (var d = 1; d <= 20 && out.length < count; d++) {
      var pair = [answer - d, answer + d];
      for (i = 0; i < 2 && out.length < count; i++) {
        v = pair[i];
        if (v >= lo && v <= hi && out.indexOf(v) < 0) out.push(v);
      }
    }
    for (v = lo; v <= hi && out.length < count; v++) {
      if (out.indexOf(v) < 0) out.push(v);
    }
    return UI.shuffle(out);
  }

  /** Ровно count вариантов вокруг верного — в обе стороны. */
  function fitOptions(options, answer, lo, hi, count) {
    if (options.length >= count) return cutOptions(options, answer, count);
    return growOptions(options, answer, lo, hi, count);
  }

  function fillNumber(v, tile) {
    tile.appendChild(el('span', { text: String(v) }));
  }

  /**
   * Плитки ответов.
   * Гарантии: верный вариант ровно один; повторный тап по той же
   * плитке не отправляет ответ второй раз; после ошибки плитка гаснет.
   *
   * o: { answer | isRight, fill, hint, answerHint, class, optClass,
   *      wide, onRight, onReveal }
   */
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
        class: 'opt' + (o.optClass ? ' ' + o.optClass : ''),
        type: 'button',
        // Отметка правильного варианта — как в блоке чтения: нужна автотестам
        dataset: { v: String(v), ok: String(v) === String(o.answer) ? '1' : '0' }
      });
      tile.__value = v;
      (o.fill || fillNumber)(v, tile);
      tile.addEventListener('click', function () { choose(v, tile); });
      tiles.push(tile);
      wrap.appendChild(tile);
    });

    wrap.__tiles = tiles;
    return wrap;
  }

  /* =====================================================
     Кирпичики картинки
     ===================================================== */

  /**
   * Предметы для счёта: строго по PER_ROW в ряд, крупные, с зазором.
   * o: { gone, mini, five, numbers, onItem }
   *   gone   — сколько последних предметов «убрали» (перечёркнуты);
   *   five   — визуально выделять пятёрки (опора для level 1);
   *   onItem — предмет становится кнопкой (учебный счёт по одному).
   */
  function itemGrid(emoji, n, o) {
    o = o || {};
    var wrap = el('div', {
      class: 'mt-items' + (o.mini ? ' mt-items--mini' : '') + (o.five ? ' mt-items--five' : '')
    });
    var row = null;
    for (var i = 0; i < n; i++) {
      if (i % PER_ROW === 0) {
        row = el('div', { class: 'mt-row' });
        wrap.appendChild(row);
      }
      row.appendChild(makeItem(emoji, i, n, o));
    }
    if (n <= 0) wrap.appendChild(el('div', { class: 'mt-empty', text: 'ничего нет' }));
    return wrap;
  }

  function makeItem(emoji, i, n, o) {
    var gone = !!o.gone && i >= n - o.gone;
    var props = {
      class: 'mt-item' + (gone ? ' mt-item--gone' : '') + (o.onItem ? ' mt-item--tap' : '') +
        (o.hidden ? ' mt-item--wait' : ''),
      'aria-hidden': o.onItem ? null : 'true'
    };
    var tag = 'span';
    if (o.onItem) {
      tag = 'button';
      props.type = 'button';
      props.onclick = function () { o.onItem(i, cell); };
    }
    var cell = el(tag, props, [
      el('span', { class: 'mt-item__ico', text: emoji }),
      o.numbers ? el('span', { class: 'mt-item__num', text: String(i + 1) }) : null
    ]);
    return cell;
  }

  /** Крупное число (абстрактный уровень — вместо предметов). */
  function bigNum(n, cls) {
    return el('div', { class: 'mt-num' + (cls ? ' ' + cls : ''), text: String(n) });
  }

  /** Линейка чисел: опора для level 1 в числовых заданиях. */
  function ruler(from, to, mark) {
    var row = el('div', { class: 'mt-ruler' });
    for (var v = from; v <= to; v++) {
      row.appendChild(el('span', {
        class: 'mt-ruler__cell' + (v === mark ? ' is-from' : ''), text: String(v)
      }));
    }
    return row;
  }

  function caption(text) {
    return el('div', { class: 'mt-cap', text: text });
  }

  /* =====================================================
     Регистрация типов
     ===================================================== */
  function registerMathTypes() {

    /* ---------------------------------------------------
       ЦИФРЫ
       --------------------------------------------------- */

    /* Знакомство с цифрой: огромный знак + столько же предметов. */
    Tasks.register('learnDigit', {
      section: 'digits',
      teach: true,
      build: function (skillId, level, unit) {
        var n = numFromSkill(skillId, 0);
        if (!(n >= 0 && n <= 9)) n = 0;
        var D = global.Numbers && Numbers.byN(n);
        var w = D ? D.word : word(n);
        var emoji = MathGen.ITEMS[UI.rnd(0, MathGen.ITEMS.length - 1)];
        return {
          n: n,
          items: emoji,
          word: w,
          prompt: 'Это цифра <b>' + n + '</b>',
          speak: n === 0
            ? 'Это цифра ноль. Ноль — это когда ничего нет. Нажми на цифру, и я скажу её ещё раз.'
            : 'Это цифра ' + w + '. Посчитай вместе со мной: ' + countChain(n) +
              '. Всего ' + w + '. Нажми на цифру, и я скажу её ещё раз.'
        };
      },
      render: function (data, api) {
        var say = function () { api.speak('Цифра ' + data.word); };
        return el('div', { class: 'mt-learn' }, [
          el('button', { class: 'mt-glyph', type: 'button', 'aria-label': 'Цифра ' + data.word, onclick: say },
            [String(data.n)]),
          el('div', { class: 'mt-learn__word', text: cap(data.word) }),
          itemGrid(data.items, data.n, { five: true }),
          el('div', { class: 'center mt4' }, [
            UI.btn('Послушать цифру', { variant: 'ghost', small: true, emoji: '🔊', onClick: say })
          ])
        ]);
      }
    });

    /* «Найди цифру 7»: отвлекающие — похожие по начертанию (карта путаницы в mathgen). */
    Tasks.register('digitId', {
      section: 'digits',
      build: function (skillId, level, unit) {
        var target = numFromSkill(skillId, -1);
        var unitMax = maxFromUnit(unit, 'digit', 9);
        var max = Math.min(9, Math.max(1, unitMax, target >= 0 ? target : 0));
        var d = until(
          function () { return MathGen.digitId({ max: max }); },
          function (r) { return target < 0 || r.digit === target; }
        );
        var hi = Math.min(9, max + 2);
        var count = level <= 1 ? 3 : (level >= 3 ? 6 : 4);
        return {
          digit: d.digit,
          answer: d.answer,
          options: fitOptions(d.options, d.answer, 0, hi, count),
          // На уровнях 2–3 цифру не показываем: иначе это сличение картинок,
          // а не узнавание цифры на слух
          prompt: level >= 2 ? 'Найди цифру 👂' : 'Найди цифру <b>' + d.digit + '</b>',
          speak: 'Найди цифру ' + word(d.digit) + '. Нажми на неё.'
        };
      },
      render: function (data, api) {
        return answerBoard(api, data.options, {
          answer: data.answer,
          hint: 'Цифры бывают похожи друг на друга. Послушай ещё раз и сравни их хвостики и кружочки.',
          answerHint: 'Вот цифра ' + data.digit + ' — это ' + word(data.digit) + '.'
        });
      }
    });

    /* Предметы ↔ цифра: чередуем направление по уровню. */
    Tasks.register('matchCount', {
      section: 'digits',
      build: function (skillId, level, unit) {
        var target = numFromSkill(skillId, 0);
        var max = Math.max(
          maxFromUnit(unit, 'count', 0),
          maxFromUnit(unit, 'digit', 0),
          target, 5
        );
        max = Math.min(max, 20);
        var d = until(
          function () { return MathGen.countItems({ max: max }); },
          function (r) { return target < 1 || r.n === target; }
        );
        /* level 2 — «дана цифра, найди группу», остальные — «даны предметы, найди цифру» */
        var toItems = (level % 2 === 0);
        var count = toItems ? 3 : optCount(level, 4);
        return {
          mode: toItems ? 'items' : 'digit',
          n: d.n,
          items: d.items,
          answer: d.answer,
          options: cutOptions(d.options, d.answer, count),
          prompt: toItems ? 'Где столько же?' : 'Какая цифра подходит?',
          speak: toItems
            ? 'Вот цифра ' + word(d.n) + '. Выбери, где ровно столько предметов.'
            : 'Посчитай предметы и выбери подходящую цифру.'
        };
      },
      render: function (data, api) {
        var opts;
        if (data.mode === 'items') {
          opts = answerBoard(api, data.options, {
            answer: data.answer,
            wide: true,
            optClass: 'mt-opt--items',
            fill: function (v, tile) { tile.appendChild(itemGrid(data.items, v, { mini: true })); },
            hint: 'Считай предметы по одному и сравнивай с цифрой.',
            answerHint: 'Цифра ' + data.n + ' — это ' + word(data.n) + ' предметов.'
          });
          return el('div', { class: 'mt-stack' }, [bigNum(data.n), opts]);
        }
        opts = answerBoard(api, data.options, {
          answer: data.answer,
          hint: 'Посчитай ещё раз: показывай пальчиком каждый предмет.',
          answerHint: 'Здесь ' + word(data.n) + ' — это цифра ' + data.n + '.'
        });
        return el('div', { class: 'mt-stack' }, [
          itemGrid(data.items, data.n, { five: true }),
          opts
        ]);
      }
    });

    /* ---------------------------------------------------
       СЧЁТ
       --------------------------------------------------- */

    /* Учебный счёт: предметы появляются по одному и называются вслух. */
    Tasks.register('learnCount', {
      section: 'count',
      teach: true,
      build: function (skillId, level, unit) {
        var target = numFromSkill(skillId, 0);
        var max = Math.min(20, Math.max(maxFromUnit(unit, 'count', 10), target, 1));
        var d = until(
          function () { return MathGen.countItems({ max: max }); },
          function (r) { return target < 1 || r.n === target; }
        );
        return {
          n: d.n,
          items: d.items,
          prompt: 'Посчитаем вместе',
          /* короткая фраза: сам счёт озвучивается по одному предмету */
          speak: 'Посчитаем вместе! Нажимай на предметы — я буду называть числа.'
        };
      },
      render: function (data, api) {
        var grid = itemGrid(data.items, data.n, {
          five: true, numbers: true, hidden: true,
          onItem: function (i) { api.speak(word(i + 1)); }
        });
        var total = caption('Всего: ' + data.n);
        total.classList.add('mt-cap--total');

        var timers = [];
        function reveal(instant) {
          var items = grid.querySelectorAll('.mt-item');
          timers.forEach(function (t) { clearTimeout(t); });
          timers = [];
          total.classList.add('mt-cap--hidden');
          Array.prototype.forEach.call(items, function (node, i) {
            node.classList.add('mt-item--wait');
            timers.push(setTimeout(function () {
              if (!document.body.contains(grid)) return;
              node.classList.remove('mt-item--wait');
              api.speak(word(i + 1));
              if (i === items.length - 1) {
                total.classList.remove('mt-cap--hidden');
              }
            }, instant ? 0 : 620 * (i + 1)));
          });
        }
        reveal(false);

        return el('div', { class: 'mt-stack' }, [
          grid,
          total,
          el('div', { class: 'center mt4' }, [
            UI.btn('Посчитать ещё раз', {
              variant: 'ghost', small: true, emoji: '🔁',
              onClick: function () { reveal(false); }
            })
          ])
        ]);
      }
    });

    /* «Сколько?» — предметы пятёрками и числовые плитки. */
    Tasks.register('countItems', {
      section: 'count',
      build: function (skillId, level, unit) {
        var target = numFromSkill(skillId, 0);
        var max = Math.min(20, Math.max(maxFromUnit(unit, 'count', 10), target, 1));
        var d = until(
          function () { return MathGen.countItems({ max: max }); },
          function (r) { return target < 1 || r.n === target; }
        );
        return {
          n: d.n,
          items: d.items,
          answer: d.answer,
          options: cutOptions(d.options, d.answer, optCount(level, 4)),
          prompt: d.speak,                    /* «Сколько яблок?» — с названием предмета */
          speak: d.speak + ' Посчитай и нажми на нужное число.'
        };
      },
      render: function (data, api) {
        return el('div', { class: 'mt-stack' }, [
          itemGrid(data.items, data.n, { five: true }),
          answerBoard(api, data.options, {
            answer: data.answer,
            hint: 'Посчитай ещё раз, показывай пальчиком каждый предмет и говори числа вслух.',
            answerHint: 'Здесь ' + word(data.n) + '.'
          })
        ]);
      }
    });

    /* ---------------------------------------------------
       СРАВНЕНИЕ
       --------------------------------------------------- */

    function compareSpeak(d) {
      return 'Сравни: ' + word(d.a) + ' и ' + word(d.b) +
        '. Какой знак поставить: больше, меньше или равно?';
    }

    function signTile(v, tile) {
      tile.appendChild(el('span', { class: 'mt-sign', text: v }));
      tile.appendChild(el('span', { class: 'opt__cap', text: signName(v) }));
    }

    /** Чаши весов: смысл сравнения виден без чтения. */
    function scale(left, right, o) {
      o = o || {};
      var slot = el('div', { class: 'mt-scale__slot', text: '?' });
      var root = el('div', { class: 'mt-scale' }, [
        el('div', { class: 'mt-scale__beam' }),
        el('div', { class: 'mt-scale__row' }, [
          el('div', { class: 'mt-pan' }, [left]),
          slot,
          el('div', { class: 'mt-pan' }, [right])
        ])
      ]);
      root.__settle = function (sign) {
        slot.textContent = sign;
        slot.classList.add('is-filled');
        root.classList.add(sign === '=' ? 'is-even' : (sign === '<' ? 'is-right' : 'is-left'));
      };
      return root;
    }

    function compareType(name, visual) {
      Tasks.register(name, {
        section: 'compare',
        build: function (skillId, level, unit) {
          var max = Math.max(2, numFromSkill(skillId, 10));
          var d = MathGen.compare({ max: max, visual: visual });
          return {
            a: d.a, b: d.b,
            items: d.items,
            max: max,
            visual: visual,
            answer: d.answer,
            options: d.options.slice(),      /* всегда три знака: <, >, = */
            prompt: 'Какой знак поставить?',
            speak: compareSpeak(d)
          };
        },
        render: function (data, api) {
          var left, right;
          if (data.visual) {
            left = el('div', {}, [
              itemGrid(data.items, data.a, { five: true }),
              api.level <= 2 ? el('div', { class: 'mt-pan__num', text: String(data.a) }) : null
            ]);
            right = el('div', {}, [
              itemGrid(data.items, data.b, { five: true }),
              api.level <= 2 ? el('div', { class: 'mt-pan__num', text: String(data.b) }) : null
            ]);
          } else {
            left = bigNum(data.a);
            right = bigNum(data.b);
          }
          var box = scale(left, right);
          var opts = answerBoard(api, data.options, {
            answer: data.answer,
            fill: function (v, tile) {
              signTile(v, tile);
              if (api.level >= 3) tile.lastChild.classList.add('hidden');
            },
            optClass: 'mt-opt--sign',
            onRight: function (v) { box.__settle(v); },
            onReveal: function () { box.__settle(data.answer); },
            hint: data.visual
              ? 'Посмотри, где предметов больше. Открытый клювик знака всегда смотрит на большее число.'
              : 'Открытый клювик знака всегда смотрит на большее число, а острый носик — на меньшее.',
            answerHint: word(data.a) + ' ' + signName(data.answer) + ' ' + word(data.b) + '.'
          });
          return el('div', { class: 'mt-stack' }, [
            box,
            /* абстрактному уровню на первом шаге помогает линейка чисел */
            (!data.visual && api.level <= 1) ? ruler(1, Math.min(data.max, 20), null) : null,
            opts
          ]);
        }
      });
    }

    compareType('compareVisual', true);
    compareType('compareNumbers', false);

    /* ---------------------------------------------------
       ЧИСЛОВОЙ РЯД
       --------------------------------------------------- */

    function lineWords(seq) {
      var out = [];
      for (var i = 0; i < seq.length; i++) out.push(seq[i] === null ? 'пусто' : word(seq[i]));
      return out.join(', ');
    }

    function lineType(name, fixedMax) {
      Tasks.register(name, {
        section: 'line',
        build: function (skillId, level, unit) {
          var max = fixedMax || Math.max(5, numFromSkill(skillId, 10));
          var d = MathGen.numberLine({ max: max, holes: 1 });
          return {
            seq: d.seq.slice(),
            answer: d.answer,
            options: cutOptions(d.options, d.answer, optCount(level, 4)),
            prompt: 'Какое число пропущено?',
            speak: 'Числа идут по порядку: ' + lineWords(d.seq) +
              '. Какое число пропущено?'
          };
        },
        render: function (data, api) {
          var slot = null;
          var row = el('div', { class: 'mt-line' });
          data.seq.forEach(function (v) {
            if (v === null) {
              slot = el('div', { class: 'mt-cell mt-cell--slot', text: '?' });
              row.appendChild(slot);
            } else {
              row.appendChild(el('div', { class: 'mt-cell', text: String(v) }));
            }
          });
          var opts = answerBoard(api, data.options, {
            answer: data.answer,
            onRight: function (v) { fill(v); },
            onReveal: function () { fill(data.answer); },
            hint: 'Назови числа по порядку вслух — и услышишь, какое потерялось.',
            answerHint: 'Пропущено число ' + data.answer + ' — ' + word(data.answer) + '.'
          });
          function fill(v) {
            if (!slot) return;
            slot.textContent = String(v);
            slot.classList.add('is-filled');
          }
          return el('div', { class: 'mt-stack' }, [row, opts]);
        }
      });
    }

    lineType('numberLine', 0);
    lineType('numberLine20', 20);

    /* Расставить числа по возрастанию: поставленное число можно вернуть. */
    Tasks.register('orderNumbers', {
      section: 'line',
      needsCheck: true,
      build: function (skillId, level, unit) {
        var max = Math.max(4, numFromSkill(skillId, 10));
        var count = level <= 1 ? 3 : (level >= 3 ? 5 : 4);
        var d = MathGen.order({ max: max, count: Math.min(count, max) });
        return {
          values: d.values.slice(),
          answer: d.answer.slice(),
          prompt: 'Расставь числа по порядку',
          speak: 'Расставь числа по порядку: от самого маленького к самому большому. ' +
            'Нажимай на числа: ' + d.values.map(word).join(', ') + '.'
        };
      },
      render: function (data, api) {
        var slots = [];
        var chips = [];

        var slotRow = el('div', { class: 'mt-slots' });
        data.answer.forEach(function () {
          var s = el('button', { class: 'mt-slot', type: 'button' });
          s.__value = null;
          s.addEventListener('click', function () { takeBack(s); });
          slots.push(s);
          slotRow.appendChild(s);
        });

        var bank = el('div', { class: 'mt-bank' });
        data.values.forEach(function (v) {
          var c = el('button', { class: 'opt opt--small mt-chip', type: 'button', text: String(v) });
          c.__value = v;
          c.addEventListener('click', function () { place(c); });
          chips.push(c);
          bank.appendChild(c);
        });

        function place(chip) {
          if (chip.classList.contains('is-used')) return;
          for (var i = 0; i < slots.length; i++) {
            if (slots[i].__value === null) {
              slots[i].__value = chip.__value;
              slots[i].__chip = chip;
              slots[i].textContent = String(chip.__value);
              slots[i].classList.add('is-filled');
              chip.classList.add('is-used');
              api.speak(word(chip.__value));
              return;
            }
          }
        }

        function takeBack(slot) {
          if (slot.__value === null) return;
          slot.__value = null;
          slot.textContent = '';
          slot.classList.remove('is-filled', 'is-bad');
          if (slot.__chip) slot.__chip.classList.remove('is-used');
          slot.__chip = null;
        }

        function clearAll() {
          slots.forEach(takeBack);
        }

        api.setCheck(function () {
          var placed = slots.map(function (s) { return s.__value; });
          if (placed.indexOf(null) >= 0) {
            return {
              ok: false,
              hint: 'Поставь в рамочки все числа: сначала самое маленькое.',
              onRetry: function () {}
            };
          }
          var ok = placed.every(function (v, i) { return v === data.answer[i]; });
          if (ok) return { ok: true, node: slotRow };
          return {
            ok: false,
            hint: 'Сначала самое маленькое число, потом всё больше и больше. ' +
              'По порядку так: ' + data.answer.join(', ') + '.',
            reveal: function () {
              clearAll();
              slots.forEach(function (s, i) {
                s.__value = data.answer[i];
                s.textContent = String(data.answer[i]);
                s.classList.add('is-filled', 'is-right');
              });
              chips.forEach(function (c) { c.classList.add('is-used'); });
            },
            onRetry: clearAll
          };
        });

        return el('div', { class: 'mt-stack' }, [
          api.level <= 1 ? el('div', { class: 'mt-arrow' }, [
            el('span', { class: 'mt-arrow__a', text: '🐭' }),
            el('span', { class: 'mt-arrow__line' }),
            el('span', { class: 'mt-arrow__b', text: '🐘' })
          ]) : null,
          slotRow,
          bank
        ]);
      }
    });

    /* ---------------------------------------------------
       СЛОЖЕНИЕ И ВЫЧИТАНИЕ
       --------------------------------------------------- */

    /* Наглядно: 🍎🍎 + 🍎 = ? */
    Tasks.register('addVisual', {
      section: 'add',
      build: function (skillId, level, unit) {
        var max = Math.max(2, numFromSkill(skillId, 5));
        var d = MathGen.add({ max: max, visual: true });
        return {
          a: d.a, b: d.b, items: d.items, answer: d.answer,
          options: cutOptions(d.options, d.answer, optCount(level, 4)),
          prompt: d.a + ' + ' + d.b + ' = ?',
          speak: cap(word(d.a)) + ' плюс ' + word(d.b) + '. Посчитай все предметы вместе. Сколько получится?'
        };
      },
      render: function (data, api) {
        return el('div', { class: 'mt-stack' }, [
          el('div', { class: 'mt-eq' }, [
            el('div', { class: 'mt-group' }, [itemGrid(data.items, data.a, { five: true })]),
            el('div', { class: 'mt-eq__sign', text: '+' }),
            el('div', { class: 'mt-group' }, [itemGrid(data.items, data.b, { five: true })]),
            el('div', { class: 'mt-eq__sign', text: '=' }),
            el('div', { class: 'mt-eq__q', text: '?' })
          ]),
          answerBoard(api, data.options, {
            answer: data.answer,
            hint: 'Сложи все предметы вместе и посчитай их по одному.',
            answerHint: word(data.a) + ' плюс ' + word(data.b) + ' будет ' + word(data.answer) + '.'
          })
        ]);
      }
    });

    /* Наглядно: было 4, убрали 2 — убранные перечёркнуты. */
    Tasks.register('subVisual', {
      section: 'sub',
      build: function (skillId, level, unit) {
        var max = Math.max(2, numFromSkill(skillId, 5));
        var d = MathGen.sub({ max: max, visual: true });
        return {
          a: d.a, b: d.b, items: d.items, answer: d.answer,
          options: cutOptions(d.options, d.answer, optCount(level, 4)),
          prompt: d.a + ' − ' + d.b + ' = ?',
          speak: 'Было ' + word(d.a) + '. Убрали ' + word(d.b) +
            '. Зачёркнутые предметы больше не считаем. Сколько осталось?'
        };
      },
      render: function (data, api) {
        return el('div', { class: 'mt-stack' }, [
          caption('Было ' + data.a + ', убрали ' + data.b),
          el('div', { class: 'mt-eq' }, [
            el('div', { class: 'mt-group' }, [
              itemGrid(data.items, data.a, { five: true, gone: data.b })
            ]),
            el('div', { class: 'mt-eq__sign', text: '=' }),
            el('div', { class: 'mt-eq__q', text: '?' })
          ]),
          answerBoard(api, data.options, {
            answer: data.answer,
            hint: 'Зачёркнутые предметы не считаем. Посчитай только те, что остались.',
            answerHint: word(data.a) + ' минус ' + word(data.b) + ' будет ' + word(data.answer) + '.'
          })
        ]);
      }
    });

    /** Пример крупными цифрами — уже без картинок. */
    function expr(a, sign, b) {
      return el('div', { class: 'mt-expr' }, [
        el('span', { class: 'mt-expr__n', text: String(a) }),
        el('span', { class: 'mt-expr__sign', text: sign }),
        el('span', { class: 'mt-expr__n', text: String(b) }),
        el('span', { class: 'mt-expr__sign', text: '=' }),
        el('span', { class: 'mt-expr__q', text: '?' })
      ]);
    }

    function numericType(name, op, fixedMax) {
      var plus = op === 'add';
      Tasks.register(name, {
        section: plus ? 'add' : 'sub',
        build: function (skillId, level, unit) {
          var max = fixedMax || Math.max(2, numFromSkill(skillId, 10));
          var d = plus ? MathGen.add({ max: max, visual: false })
                       : MathGen.sub({ max: max, visual: false });
          return {
            a: d.a, b: d.b, max: max, answer: d.answer,
            options: cutOptions(d.options, d.answer, optCount(level, 4)),
            prompt: d.a + (plus ? ' + ' : ' − ') + d.b + ' = ?',
            speak: cap(word(d.a)) + (plus ? ' плюс ' : ' минус ') + word(d.b) + '. Сколько будет?'
          };
        },
        render: function (data, api) {
          return el('div', { class: 'mt-stack' }, [
            expr(data.a, plus ? '+' : '−', data.b),
            /* опора первого уровня — числовая линейка, а не предметы:
               здесь ребёнок уже считает в уме, шагая по числам */
            api.level <= 1 ? el('div', { class: 'mt-support' }, [
              ruler(0, Math.min(data.max, 20), data.a),
              caption(plus ? 'Шагай вперёд ' + data.b + ' раз' : 'Шагай назад ' + data.b + ' раз')
            ]) : null,
            answerBoard(api, data.options, {
              answer: data.answer,
              hint: plus
                ? 'Начни с числа ' + data.a + ' и прибавляй по одному: так считать легче.'
                : 'Начни с числа ' + data.a + ' и убирай по одному.',
              answerHint: word(data.a) + (plus ? ' плюс ' : ' минус ') + word(data.b) +
                ' будет ' + word(data.answer) + '.'
            })
          ]);
        }
      });
    }

    numericType('addNumbers', 'add', 0);
    numericType('subNumbers', 'sub', 0);
    numericType('addNumbers20', 'add', 20);
    numericType('subNumbers20', 'sub', 20);

    /* ---------------------------------------------------
       ЗАДАЧИ
       --------------------------------------------------- */

    /* Текст задачи обязательно звучит: ребёнок понимает её на слух. */
    Tasks.register('problem', {
      section: 'problems',
      build: function (skillId, level, unit) {
        var op = opFromSkill(skillId, null);
        var max = 10;
        var d = MathGen.problem(op ? { op: op, max: max } : { max: max });
        return {
          op: d.op,
          a: d.a, b: d.b,
          items: d.items,
          text: d.text,
          answer: d.answer,
          options: cutOptions(d.options, d.answer, optCount(level, 4)),
          prompt: d.text,
          speak: d.speak
        };
      },
      render: function (data, api) {
        var picture = null;
        /* на первых уровнях задачу видно предметами, на третьем — только на слух */
        if (api.level <= 2) {
          picture = data.op === 'add'
            ? el('div', { class: 'mt-eq' }, [
                el('div', { class: 'mt-group' }, [itemGrid(data.items, data.a, { five: true })]),
                el('div', { class: 'mt-eq__sign', text: '+' }),
                el('div', { class: 'mt-group' }, [itemGrid(data.items, data.b, { five: true })])
              ])
            : el('div', { class: 'mt-eq' }, [
                el('div', { class: 'mt-group' }, [
                  itemGrid(data.items, data.a, { five: true, gone: data.b })
                ])
              ]);
        }
        return el('div', { class: 'mt-stack' }, [
          picture,
          answerBoard(api, data.options, {
            answer: data.answer,
            hint: 'Послушай задачу ещё раз — нажми на кнопку с динамиком. Потом посчитай по картинке.',
            answerHint: 'Правильный ответ: ' + word(data.answer) + '.'
          })
        ]);
      }
    });
  }

  global.MathTasks = { register: registerMathTypes };

  if (global.Tasks) registerMathTypes();
  else global.addEventListener('DOMContentLoaded', registerMathTypes);

})(window);
