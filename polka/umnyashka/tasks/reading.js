/* =========================================================
   tasks/reading.js — типы заданий блока «Чтение и письмо».

   14 типов: буквы (4), слоги (3), слова (5), предложения (2).

   Методические правила, зашитые в код:
   • ребёнок 6–7 лет почти не читает → у КАЖДОГО задания есть
     устная инструкция speak, а вместо текста — картинка, буква
     или эмодзи;
   • отвлекающие варианты обучают: для букв — похожие по
     начертанию (Ш/Щ, И/Й, О/С…), для слов — отличающиеся одной
     буквой (СОМ/СОН/СОК), для картинок — слова того же уровня;
   • сложность навыка (level 1..3) реально меняет задание:
     на 1 меньше вариантов и есть картинка-подсказка,
     на 3 вариантов больше, подсказку убираем;
   • ошибок «неправильно» не бывает — только мягкая подсказка
     о том, куда посмотреть и что послушать.
   ========================================================= */
(function (global) {
  'use strict';

  var el = function () { return UI.el.apply(null, arguments); };

  /* ---------------------------------------------------------
     Похожие по начертанию буквы.
     Отсюда берутся отвлекающие варианты: ребёнок тренируется
     различать «почти одинаковые» буквы, а не угадывать.
     --------------------------------------------------------- */
  var SIMILAR = {
    'А': ['Л', 'Д', 'М', 'Я'],
    'Б': ['В', 'Ь', 'Ъ', 'Р', 'Ы'],
    'В': ['Б', 'Ь', 'Ы', 'Р', 'З'],
    'Г': ['Т', 'Р', 'П', 'Ч'],
    'Д': ['Л', 'А', 'Ц', 'Щ'],
    'Е': ['Ё', 'Э', 'С', 'З'],
    'Ё': ['Е', 'Ю', 'Э'],
    'Ж': ['Х', 'К', 'Ф', 'З'],
    'З': ['Э', 'В', 'Б', 'Ж'],
    'И': ['Й', 'Н', 'П', 'М'],
    'Й': ['И', 'Н', 'П'],
    'К': ['Ж', 'Х', 'Н', 'Р'],
    'Л': ['М', 'А', 'Д', 'П'],
    'М': ['Л', 'И', 'Ш', 'А'],
    'Н': ['П', 'И', 'Ц', 'Ы', 'К'],
    'О': ['С', 'Э', 'Ю', 'Ф'],
    'П': ['Н', 'И', 'Т', 'Ц', 'Л'],
    'Р': ['Ь', 'Б', 'В', 'Ф', 'Г'],
    'С': ['О', 'Э', 'Ю', 'Е'],
    'Т': ['Г', 'П', 'Ч', 'Ш'],
    'У': ['Ч', 'Х', 'Ф', 'Ю'],
    'Ф': ['Р', 'О', 'Ю', 'Ж', 'У'],
    'Х': ['Ж', 'К', 'У', 'Я'],
    'Ц': ['Щ', 'Ш', 'П', 'Н'],
    'Ч': ['У', 'Г', 'Т', 'Ц'],
    'Ш': ['Щ', 'Ц', 'И', 'М'],
    'Щ': ['Ш', 'Ц', 'Д'],
    'Ъ': ['Ь', 'Ы', 'Б'],
    'Ы': ['Ь', 'Ъ', 'Н', 'И'],
    'Ь': ['Ъ', 'Ы', 'Б', 'В'],
    'Э': ['О', 'С', 'З', 'Е'],
    'Ю': ['Ё', 'Ы', 'О', 'Ф'],
    'Я': ['А', 'Р', 'Ю', 'Х']
  };

  /* ---------------------------------------------------------
     Мелкие помощники
     --------------------------------------------------------- */
  function up(s) { return String(s === null || s === undefined ? '' : s).toUpperCase(); }

  /** 'letter:М' → 'М', 'sentence:3' → '3' */
  function valueOf(id) {
    var s = String(id || '');
    var i = s.indexOf(':');
    return i < 0 ? s : s.slice(i + 1);
  }
  function kindOf(id) {
    var s = String(id || '');
    var i = s.indexOf(':');
    return i < 0 ? '' : s.slice(0, i);
  }
  function letterOf(id) { return up(valueOf(id)).charAt(0); }
  function lvl(n) { n = parseInt(n, 10); return n >= 3 ? 3 : (n <= 1 || isNaN(n)) ? 1 : 2; }
  function chars(s) { return String(s).split(''); }
  function isVowel(ch) { var L = Alphabet.byChar(ch); return !!L && L.type === 'vowel'; }
  function isCons(ch) { var L = Alphabet.byChar(ch); return !!L && L.type === 'consonant'; }
  function allChars() { return Alphabet.LETTERS.map(function (l) { return l.ch; }); }
  function orderChars(n) { return Alphabet.inOrder(n).map(function (l) { return l.ch; }); }
  function low(s) { return String(s).toLowerCase(); }

  /** 1 буква, 2 буквы, 5 букв — иначе текст выглядит неряшливо. */
  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return n + ' ' + many;
    if (b > 1 && b < 5) return n + ' ' + few;
    if (b === 1) return n + ' ' + one;
    return n + ' ' + many;
  }

  /** Буквы, которые ребёнок уже видел в этом юните. */
  function unitLetters(unit) {
    var out = [], seen = {};
    function push(ch) {
      if (ch && Alphabet.byChar(ch) && !seen[ch]) { seen[ch] = 1; out.push(ch); }
    }
    ((unit && unit.skills) || []).forEach(function (id) {
      var k = kindOf(id), v = up(valueOf(id));
      if (k === 'letter' || k === 'sound' || k === 'write') push(v.charAt(0));
      else if (k === 'syllable' || k === 'word') chars(v).forEach(push);
    });
    return out;
  }

  /**
   * Максимальный шаг изучения, доступный ребёнку в этом юните.
   * Отвлекающие варианты не должны содержать букв, которых он ещё не видел:
   * иначе в первом уроке правильный ответ — единственная знакомая буква,
   * и ребёнок учится не читать, а узнавать знакомое.
   */
  function maxOrder(unit) {
    var m = 0;
    unitLetters(unit).forEach(function (ch) {
      var L = Alphabet.byChar(ch);
      if (L && L.order > m) m = L.order;
    });
    // плюс всё, что ребёнок уже проходил в других юнитах
    Alphabet.LETTERS.forEach(function (L) {
      if (L.order > m && Skills.exists('letter:' + L.ch) &&
          Store.data.skills['letter:' + L.ch].introduced) m = L.order;
    });
    return m || 6;
  }

  /** Буква разрешена в вариантах, если её уже проходили. */
  function learnedOnly(unit) {
    var m = maxOrder(unit);
    return function (ch) {
      var L = Alphabet.byChar(up(ch).charAt(0));
      return !!L && L.order <= m;
    };
  }

  /** Буквы для отвлекающих вариантов: только изученные. */
  function knownLetters(unit) {
    var m = maxOrder(unit);
    var all = Alphabet.LETTERS.slice()
      .sort(function (a, b) { return a.order - b.order; })
      .filter(function (L) { return L.order <= m; })
      .map(function (L) { return L.ch; });
    var u = unitLetters(unit);
    // сначала буквы своего юнита, потом остальные изученные
    var rest = all.filter(function (ch) { return u.indexOf(ch) === -1; });
    return u.concat(rest);
  }

  /** Слова юнита (для отвлекающих картинок и слов). */
  function unitWords(unit) {
    var out = [];
    ((unit && unit.skills) || []).forEach(function (id) {
      if (kindOf(id) !== 'word') return;
      var W = Words.find(valueOf(id));
      if (W) out.push(W);
    });
    return out;
  }

  /**
   * Похожие буквы двумя пулами: сначала самые «путающиеся»
   * (Ш→Щ, О→С, П→Н…), потом остальные похожие. Первый пул
   * маленький, поэтому нужная пара попадает в варианты всегда.
   */
  function simPools(ch, unit) {
    var list = SIMILAR[up(ch)] || [];
    if (unit) {
      var ok = learnedOnly(unit);
      list = list.filter(ok);          // похожая, но ещё не изученная буква не годится
    }
    return [list.slice(0, 2), list.slice(2)];
  }

  /**
   * Набрать count различных значений: правильное + отвлекающие.
   * pools перебираются по очереди — первый пул самый «обучающий».
   */
  function fillOptions(correct, count, pools, allow) {
    var out = [correct], seen = {};
    seen[correct] = 1;
    for (var p = 0; p < pools.length && out.length < count; p++) {
      var list = UI.shuffle(pools[p] || []);
      for (var i = 0; i < list.length && out.length < count; i++) {
        var v = list[i];
        if (!v || seen[v] || v === correct) continue;
        if (allow && !allow(v)) continue;
        seen[v] = 1;
        out.push(v);
      }
    }
    return out;
  }

  /** Значения → перемешанные варианты с отметкой правильного. */
  function mkOptions(correct, values) {
    return UI.shuffle(values).map(function (v) { return { v: v, ok: v === correct }; });
  }

  /* ---------------------------------------------------------
     Общие кусочки интерфейса
     --------------------------------------------------------- */

  /** Картинка-подсказка: эмодзи, по нажатию — слово (или фраза) вслух. */
  function picCard(emoji, word, fn) {
    return el('button', {
      class: 'rt-pic', type: 'button', 'aria-label': 'Послушать',
      onclick: function () {
        SFX.tap();
        if (fn) fn();
        else if (word) Speech.word(word);
      }
    }, [el('span', { class: 'rt-pic__emoji', text: emoji || '🖼️' })]);
  }

  function listenBtn(label, fn, variant) {
    return UI.btn(label, {
      variant: variant || 'sun', emoji: '🔊', small: true,
      onClick: function () { fn(); }
    });
  }

  /** Слово по буквам; буквы ch выделены жирным. */
  function wordSpans(word, ch) {
    return chars(up(word)).map(function (c) {
      return c === up(ch) ? el('b', { text: c }) : el('span', { text: c });
    });
  }

  /** Последовательная подсветка кусочков с озвучкой каждого. */
  function playParts(nodes, speakEach, done) {
    var i = 0;
    (function step() {
      if (!nodes.length || !document.body.contains(nodes[0])) return;
      if (i >= nodes.length) {
        nodes.forEach(function (n) { n.classList.remove('is-on'); });
        if (done) done();
        return;
      }
      nodes.forEach(function (n) { n.classList.remove('is-on'); });
      nodes[i].classList.add('is-on');
      Promise.resolve(speakEach(i)).then(function () {
        i++;
        setTimeout(step, 220);
      });
    })();
  }

  /**
   * Сетка вариантов с однократным ответом.
   * o: {items, grid, optClass, body(item), hint, answerHint}
   * Каждый вариант можно нажать только один раз — повторный тап
   * не превращается во второй ответ.
   */
  function choiceGrid(api, o) {
    var items = o.items || [];
    var cls;
    if (o.grid === 'strip') cls = 'rt-strip';
    else {
      var cols = o.grid || (items.length === 2 ? 2 : (items.length === 3 || items.length === 6) ? 3 : 4);
      cls = 'opts opts--' + cols;
    }
    var grid = el('div', { class: cls });
    var nodes = [];
    var locked = false;

    function reveal() {
      nodes.forEach(function (n, i) { if (items[i].ok) n.classList.add('is-right'); });
    }

    items.forEach(function (it, i) {
      var node = el('button', {
        class: 'opt' + (o.optClass ? ' ' + o.optClass : ''),
        type: 'button',
        dataset: { v: String(it.v), i: String(i), ok: it.ok ? '1' : '0' },
        onclick: function () {
          if (locked || node.__used) return;
          node.__used = true;
          SFX.tap();
          if (it.ok) {
            locked = true;
            node.classList.add('is-right');
            nodes.forEach(function (n) { if (n !== node) n.classList.add('is-dim'); });
            api.answer(true, { node: node });
          } else {
            // Блокируем плитки до ответа ребёнка на подсказку: иначе два
            // быстрых тычка подряд съедали обе попытки за одно движение пальца
            locked = true;
            node.classList.add('is-almost');
            node.classList.add('is-dim');
            api.answer(false, {
              hint: o.hint, answerHint: o.answerHint, reveal: reveal, node: node,
              onRetry: function () { locked = false; }
            });
          }
        }
      }, o.body ? o.body(it) : [el('span', { text: String(it.label === undefined ? it.v : it.label) })]);
      nodes.push(node);
      grid.appendChild(node);
    });

    grid.__reveal = reveal;
    return grid;
  }

  /**
   * Плитки-звуки для whichSound.
   * Первое нажатие на плитку — только проигрывание звука, сколько
   * угодно раз. Ответ засчитывается лишь по отдельной галочке,
   * которая появляется после прослушивания. Случайный тап во время
   * прослушивания ответом не становится.
   */
  function soundGrid(api, o) {
    var items = o.items || [];
    var grid = el('div', { class: 'opts opts--' + (items.length === 4 ? 4 : 3) });
    var nodes = [];
    var locked = false;

    function reveal() {
      nodes.forEach(function (n, i) {
        if (items[i].ok) { n.classList.add('is-right'); n.__ch.textContent = items[i].v; }
      });
    }

    items.forEach(function (it, i) {
      var chSpan = el('span', { class: 'rt-sound__ch', text: '' });

      var play = el('button', {
        class: 'rt-sound__play', type: 'button', 'data-role': 'play',
        'aria-label': 'Послушать звук',
        onclick: function () {
          SFX.tap();
          Speech.letterSound(it.v);
          tile.classList.add('is-armed');
          if (o.showLetters) chSpan.textContent = it.v;
        }
      }, [el('span', { text: '🔊' })]);

      var pick = el('button', {
        class: 'rt-sound__pick', type: 'button', 'data-role': 'pick',
        onclick: function () {
          // пока не послушал — галочка неактивна, тап просто играет звук
          if (!tile.classList.contains('is-armed')) {
            Speech.letterSound(it.v);
            tile.classList.add('is-armed');
            return;
          }
          if (locked || tile.__used) return;
          tile.__used = true;
          SFX.tap();
          if (it.ok) {
            locked = true;
            tile.classList.add('is-right');
            chSpan.textContent = it.v;
            nodes.forEach(function (n) { if (n !== tile) n.classList.add('is-dim'); });
            api.answer(true, { node: tile });
          } else {
            tile.classList.add('is-almost');
            tile.classList.add('is-dim');
            api.answer(false, { hint: o.hint, answerHint: o.answerHint, reveal: reveal, node: tile });
          }
        }
      }, [el('span', { text: '✓' })]);

      var tile = el('div', {
        class: 'opt rt-sound', dataset: { v: it.v, i: String(i), ok: it.ok ? '1' : '0' }
      }, [play, chSpan, pick]);
      tile.__ch = chSpan;

      nodes.push(tile);
      grid.appendChild(tile);
    });

    grid.__reveal = reveal;
    return grid;
  }

  /**
   * Конструктор ответа: окошки + банк кусочков.
   * Нажатие на кусочек ставит его в первое свободное окошко,
   * нажатие на заполненное окошко возвращает кусочек обратно.
   * o: {tiles, parts, answer, joiner, wide, hint, answerHint}
   */
  function builder(api, o) {
    var tiles = o.tiles.slice();
    var parts = o.parts.slice();
    var n = parts.length;
    var placed = [];
    for (var k = 0; k < n; k++) placed.push(null);

    var slotsRow = el('div', { class: 'rt-slots' + (o.wide ? ' rt-slots--wide' : '') });
    var bank = el('div', { class: 'rt-bank' });
    var slotNodes = [], tileNodes = [];

    parts.forEach(function (_, si) {
      var s = el('button', {
        class: 'rt-slot' + (o.wide ? ' rt-slot--wide' : ''), type: 'button',
        dataset: { i: String(si), v: '' }, 'aria-label': 'Окошко ' + (si + 1),
        onclick: function () { SFX.tap(); unplace(si); }
      }, [el('span', { class: 'rt-slot__v', text: '' })]);
      slotNodes.push(s);
      slotsRow.appendChild(s);
    });

    tiles.forEach(function (t, ti) {
      var b = el('button', {
        class: 'rt-tile' + (o.wide ? ' rt-tile--wide' : ''), type: 'button',
        dataset: { v: t, i: String(ti) },
        onclick: function () { SFX.tap(); place(ti); }
      }, [el('span', { text: t })]);
      tileNodes.push(b);
      bank.appendChild(b);
    });

    function place(ti) {
      if (placed.indexOf(ti) >= 0) return;
      var free = placed.indexOf(null);
      if (free < 0) return;
      placed[free] = ti;
      paint();
      if (o.speakTile !== false) Speech.word(tiles[ti]);
    }
    function unplace(si) {
      if (placed[si] === null) return;
      placed[si] = null;
      paint();
    }
    function paint() {
      slotNodes.forEach(function (s, si) {
        var ti = placed[si];
        var v = ti === null ? '' : tiles[ti];
        s.firstChild.textContent = v;
        s.dataset.v = v;
        if (v) s.classList.add('is-filled'); else s.classList.remove('is-filled');
        s.classList.remove('is-right');
      });
      tileNodes.forEach(function (b, ti) {
        if (placed.indexOf(ti) >= 0) b.classList.add('is-used'); else b.classList.remove('is-used');
      });
    }
    function value() {
      return placed.map(function (ti) { return ti === null ? '' : tiles[ti]; }).join(o.joiner || '');
    }
    function clear() {
      for (var i = 0; i < n; i++) placed[i] = null;
      paint();
    }
    function reveal() {
      clear();
      parts.forEach(function (p, si) {
        for (var t = 0; t < tiles.length; t++) {
          if (tiles[t] === p && placed.indexOf(t) < 0) { placed[si] = t; break; }
        }
      });
      paint();
      slotNodes.forEach(function (s) { s.classList.add('is-right'); });
    }

    api.setCheck(function () {
      if (placed.indexOf(null) >= 0) {
        return {
          ok: false,
          // Пустые окошки — это не ответ, а напоминание: попытку не тратим
          incomplete: true,
          hint: 'Заполни все окошки: нажимай кусочки внизу.',
          onRetry: function () {}
        };
      }
      if (value() === o.answer) return { ok: true, node: slotsRow };
      return { ok: false, hint: o.hint, answerHint: o.answerHint, reveal: reveal, onRetry: clear };
    });

    var wrap = el('div', { class: 'rt-build' }, [slotsRow, bank]);
    // для подсказок и автотестов
    wrap.__value = value;
    wrap.__clear = clear;
    wrap.__reveal = reveal;
    wrap.__parts = parts.slice();
    return wrap;
  }

  /* ---------------------------------------------------------
     Подбор данных
     --------------------------------------------------------- */

  /** Слово-пример, которое начинается на букву ch. */
  function wordStartingWith(ch, unit) {
    ch = up(ch);
    var mine = unitWords(unit).filter(function (W) { return W.w.charAt(0) === ch; });
    if (mine.length) return UI.pick(mine);
    var pool = Words.WORDS.filter(function (W) { return W.w.charAt(0) === ch; });
    if (pool.length) {
      // короткие слова понятнее — предпочитаем их
      pool.sort(function (a, b) { return a.w.length - b.w.length; });
      return pool[UI.rnd(0, Math.min(2, pool.length - 1))];
    }
    var L = Alphabet.byChar(ch);
    if (L && up(L.word).charAt(0) === ch) return { w: up(L.word), emoji: L.emoji, letters: chars(up(L.word)) };
    return null;
  }

  /** Слоги, отличающиеся от заданного одной буквой. */
  function syllableDistractors(syl, unit) {
    var c = syl.charAt(0), v = syl.slice(1);
    var pool = knownLetters(unit);
    var vowels = pool.filter(isVowel), cons = pool.filter(isCons);
    if (vowels.length < 2) vowels = Alphabet.vowels().map(function (l) { return l.ch; });
    if (cons.length < 2) cons = Alphabet.consonants().map(function (l) { return l.ch; });
    var out = [];
    UI.shuffle(vowels).forEach(function (x) { if (x !== v) out.push(c + x); });
    UI.shuffle(cons).forEach(function (x) { if (x !== c) out.push(x + v); });
    return out;
  }

  /** Слова того же уровня словаря — для картинок и для выбора слова. */
  function siblingWords(W, unit) {
    var same = unitWords(unit).filter(function (x) { return x.w !== W.w; });
    var lvlPool = Words.byLevel(W.level).filter(function (x) { return x.w !== W.w; });
    var near = lvlPool.filter(function (x) { return x.w.length === W.w.length && diffCount(x.w, W.w) === 1; });
    var all = Words.WORDS.filter(function (x) { return x.w !== W.w; });
    return { near: near, same: same, level: lvlPool, all: all };
  }

  function diffCount(a, b) {
    if (a.length !== b.length) return 99;
    var d = 0;
    for (var i = 0; i < a.length; i++) if (a.charAt(i) !== b.charAt(i)) d++;
    return d;
  }

  /**
   * Варианты вставки одной лишней буквы так, чтобы ответ был
   * однозначным: ровно один индекс, удаление которого даёт слово.
   */
  function extraVariants(word, pool) {
    var out = [];
    pool.forEach(function (c) {
      for (var p = 0; p <= word.length; p++) {
        var shown = word.slice(0, p) + c + word.slice(p);
        var hits = [];
        for (var i = 0; i < shown.length; i++) {
          if (shown.slice(0, i) + shown.slice(i + 1) === word) hits.push(i);
        }
        if (hits.length === 1) out.push({ shown: shown, index: hits[0], ch: c });
      }
    });
    return out;
  }

  /* =========================================================
     РЕГИСТРАЦИЯ ТИПОВ
     ========================================================= */
  function registerReadingTypes() {

    /* =====================================================
       БУКВЫ
       ===================================================== */

    /* --- Знакомство с буквой ---------------------------- */
    Tasks.register('learnLetter', {
      section: 'letters',
      teach: true,
      build: function (skillId) {
        var L = Alphabet.byChar(letterOf(skillId));
        if (!L) return null;
        var sign = L.type === 'sign';
        return {
          letter: L, sign: sign,
          prompt: 'Знакомься: буква <b>' + L.ch + ' ' + L.low + '</b>',
          speak: sign
            ? 'Это ' + L.name + '. Сам он не звучит, но помогает другим буквам.'
            : 'Это буква ' + L.name + '. Нажми на неё и послушай, как она звучит.'
        };
      },
      render: function (data) {
        var L = data.letter;

        var glyph = el('button', {
          class: 'rt-glyph', type: 'button', dataset: { v: L.ch },
          'aria-label': 'Послушать звук буквы',
          onclick: function () { SFX.tap(); Speech.letterSound(L.ch); }
        }, [
          el('span', { class: 'rt-glyph__big', text: L.ch }),
          el('span', { class: 'rt-glyph__low', text: L.low })
        ]);

        var example = el('button', {
          class: 'rt-example', type: 'button', dataset: { v: L.word },
          onclick: function () { SFX.tap(); Speech.word(L.word); }
        }, [
          el('span', { class: 'rt-example__emoji', text: L.emoji }),
          el('span', { class: 'rt-example__word' }, wordSpans(L.word, L.ch))
        ]);

        return el('div', { class: 'rt-task rt-learn' }, [
          glyph,
          example,
          el('div', { class: 'center g3 mt4 wrap' }, [
            listenBtn(data.sign ? 'Послушать' : 'Как звучит', function () { Speech.letterSound(L.ch); }),
            listenBtn('Название буквы', function () { Speech.letterName(L.ch); }, 'ghost')
          ])
        ]);
      }
    });

    /* --- Найди букву ------------------------------------ */
    Tasks.register('findLetter', {
      section: 'letters',
      build: function (skillId, level, unit) {
        var ch = letterOf(skillId);
        var L = Alphabet.byChar(ch);
        if (!L) return null;
        var lv = lvl(level);
        var count = lv === 1 ? 3 : lv === 3 ? 6 : 4;
        var values = fillOptions(ch, count, simPools(ch, unit).concat([knownLetters(unit)]), learnedOnly(unit));
        if (values.length < 2) return null;
        return {
          ch: ch, letter: L, level: lv,
          options: mkOptions(ch, values),
          showModel: lv <= 2,
          showPic: lv === 1,
          prompt: lv === 3 ? 'Найди букву на слух 👂' : 'Найди букву <b>' + ch + '</b>',
          speak: 'Найди букву ' + L.name,
          hint: 'Посмотри внимательно на форму буквы: сравни палочки и кружочки.',
          answerHint: 'Вот буква ' + L.name + ' — она пишется так: ' + ch
        };
      },
      render: function (data, api) {
        var wrap = el('div', { class: 'rt-task' });
        if (data.showModel) {
          wrap.appendChild(el('div', { class: 'rt-model' }, [
            el('span', { class: 'rt-model__ch', text: data.ch }),
            data.showPic ? el('span', { class: 'rt-model__pic', text: data.letter.emoji }) : null
          ]));
        }
        wrap.appendChild(choiceGrid(api, {
          items: data.options,
          grid: data.options.length === 3 ? 3 : data.options.length === 6 ? 3 : 4,
          hint: data.hint, answerHint: data.answerHint
        }));
        return wrap;
      }
    });

    /* --- Какая кнопка так звучит ------------------------ */
    Tasks.register('whichSound', {
      section: 'letters',
      build: function (skillId, level, unit) {
        var ch = letterOf(skillId);
        var L = Alphabet.byChar(ch);
        if (!L || L.type === 'sign' || !L.sound) return null;
        var lv = lvl(level);
        var count = lv === 3 ? 4 : 3;
        var allow = function (c) {
          var X = Alphabet.byChar(c);
          return !!X && X.type !== 'sign' && !!X.sound && X.sound !== L.sound;
        };
        var values = fillOptions(ch, count, simPools(ch, unit).concat([knownLetters(unit)]), function (v) { return learnedOnly(unit)(v) && (!allow || allow(v)); });
        if (values.length < 2) return null;
        return {
          ch: ch, letter: L, level: lv,
          options: mkOptions(ch, values),
          showLetters: lv === 1,
          prompt: 'Какая кнопка звучит как буква <b>' + ch + '</b>?',
          speak: 'Послушай кнопки. Слушать можно сколько хочешь. ' +
                 'Нашёл звук буквы ' + L.name + ' — нажми на плитке галочку.',
          hint: 'Послушай кнопки ещё раз: буква ' + L.name + ' звучит коротко и по-своему.',
          answerHint: 'Так звучит буква ' + L.name
        };
      },
      render: function (data, api) {
        return el('div', { class: 'rt-task' }, [
          el('div', { class: 'rt-model rt-model--quiet' }, [
            el('span', { class: 'rt-model__ch', text: data.ch })
          ]),
          el('p', { class: 't-small center-text mt2', text: 'Сначала послушай 🔊, потом нажми ✓' }),
          soundGrid(api, {
            items: data.options,
            showLetters: data.showLetters,
            hint: data.hint, answerHint: data.answerHint
          })
        ]);
      }
    });

    /* --- Первая буква слова ----------------------------- */
    Tasks.register('firstLetter', {
      section: 'letters',
      build: function (skillId, level, unit) {
        var ch = letterOf(skillId);
        var L = Alphabet.byChar(ch);
        if (!L) return null;
        var W = wordStartingWith(ch, unit);
        if (!W) return null;
        var lv = lvl(level);
        var count = lv === 1 ? 3 : 4;
        var values = fillOptions(ch, count, simPools(ch, unit).concat([knownLetters(unit)]), learnedOnly(unit));
        if (values.length < 2) return null;
        return {
          ch: ch, word: W.w, emoji: W.emoji, level: lv,
          masked: '_' + W.w.slice(1),
          showWord: lv <= 2,
          options: mkOptions(ch, values),
          prompt: 'С какой буквы начинается слово?',
          speak: 'Послушай слово: ' + low(W.w) + '. С какой буквы оно начинается?',
          hint: 'Послушай ещё раз, с какого звука начинается слово.',
          answerHint: 'Слово ' + low(W.w) + ' начинается с буквы ' + L.name
        };
      },
      render: function (data, api) {
        var wrap = el('div', { class: 'rt-task' }, [
          picCard(data.emoji, data.word),
          data.showWord
            ? el('div', { class: 'rt-mask' }, chars(data.masked).map(function (c) {
                return el('span', { class: c === '_' ? 'rt-mask__gap' : 'rt-mask__ch', text: c === '_' ? '?' : c });
              }))
            : null,
          el('div', { class: 'center mt3' }, [
            listenBtn('Слово ещё раз', function () { Speech.word(data.word); })
          ])
        ]);
        wrap.appendChild(choiceGrid(api, {
          items: data.options,
          grid: data.options.length === 3 ? 3 : 4,
          hint: data.hint, answerHint: data.answerHint
        }));
        return wrap;
      }
    });

    /* =====================================================
       СЛОГИ
       ===================================================== */

    /* --- Знакомство со слогом --------------------------- */
    Tasks.register('learnSyllable', {
      section: 'syllables',
      teach: true,
      build: function (skillId) {
        var syl = up(valueOf(skillId));
        if (syl.length < 2) return null;
        var a = syl.charAt(0), b = syl.slice(1);
        var A = Alphabet.byChar(a), B = Alphabet.byChar(b.charAt(0));
        if (!A || !B) return null;
        return {
          syl: syl, a: a, b: b,
          prompt: 'Читаем слог <b>' + syl + '</b>',
          speak: 'Смотри: ' + A.name + ' и ' + B.name + ' вместе читаются ' + low(syl) +
                 '. Послушай: ' + low(syl)
        };
      },
      render: function (data) {
        var pa = el('span', { class: 'rt-merge__part', dataset: { v: data.a }, text: data.a });
        var pb = el('span', { class: 'rt-merge__part', dataset: { v: data.b }, text: data.b });
        var res = el('button', {
          class: 'rt-merge__res', type: 'button', dataset: { v: data.syl },
          onclick: function () { SFX.tap(); Speech.word(data.syl); }
        }, [el('span', { text: data.syl })]);

        var merge = el('div', { class: 'rt-merge' }, [
          pa,
          el('span', { class: 'rt-merge__sign', text: '+' }),
          pb,
          el('span', { class: 'rt-merge__sign', text: '=' }),
          res
        ]);
        // слияние букв: буквы «съезжаются» к слогу
        setTimeout(function () { merge.classList.add('is-on'); }, 260);

        function byParts() {
          Promise.resolve(Speech.letterSound(data.a)).then(function () {
            return Speech.letterSound(data.b.charAt(0));
          }).then(function () {
            return Speech.word(data.syl);
          });
        }

        return el('div', { class: 'rt-task rt-learn' }, [
          merge,
          el('div', { class: 'center g3 mt5 wrap' }, [
            listenBtn('По частям', byParts, 'ghost'),
            listenBtn('Целиком', function () { Speech.word(data.syl); })
          ])
        ]);
      }
    });

    /* --- Услышал слог — найди его ----------------------- */
    Tasks.register('readSyllable', {
      section: 'syllables',
      build: function (skillId, level, unit) {
        var syl = up(valueOf(skillId));
        if (syl.length < 2) return null;
        var lv = lvl(level);
        var count = lv === 1 ? 3 : 4;
        var pools = [syllableDistractors(syl, unit)];
        if (lv === 3 && syl.length === 2) pools.unshift([syl.charAt(1) + syl.charAt(0)]);
        var values = fillOptions(syl, count, pools);
        if (values.length < 2) return null;
        return {
          syl: syl, level: lv,
          options: mkOptions(syl, values),
          prompt: 'Какой слог ты слышишь? 👂',
          speak: 'Слушай: ' + low(syl) + '. Найди этот слог.',
          hint: 'Послушай ещё раз и посмотри, с какой буквы слог начинается.',
          answerHint: 'Это слог ' + syl
        };
      },
      render: function (data, api) {
        var wrap = el('div', { class: 'rt-task' }, [
          el('div', { class: 'center' }, [
            UI.btn('Послушать слог', {
              variant: 'sun', emoji: '🔊', huge: true,
              onClick: function () { Speech.word(data.syl); }
            })
          ])
        ]);
        wrap.appendChild(choiceGrid(api, {
          items: data.options,
          grid: data.options.length === 3 ? 3 : 4,
          optClass: 'opt--small',
          hint: data.hint, answerHint: data.answerHint
        }));
        // слог звучит и сам, после устной инструкции движка
        setTimeout(function () {
          if (document.body.contains(wrap)) Speech.word(data.syl);
        }, 2600);
        return wrap;
      }
    });

    /* --- Собери слог ------------------------------------ */
    Tasks.register('buildSyllable', {
      section: 'syllables',
      needsCheck: true,
      build: function (skillId, level, unit) {
        var syl = up(valueOf(skillId));
        if (syl.length < 2) return null;
        var lv = lvl(level);
        var parts = chars(syl);
        var tiles = parts.slice();
        if (lv === 3) {
          var extra = fillOptions(syl.charAt(0), 2, [knownLetters(unit)], function (c) {
            return parts.indexOf(c) < 0;
          })[1];
          if (extra) tiles.push(extra);
        }
        return {
          syl: syl, level: lv,
          parts: parts,
          tiles: UI.shuffle(tiles),
          answer: syl,
          showModel: lv === 1,
          prompt: lv === 1 ? 'Собери слог <b>' + syl + '</b>' : 'Собери слог, который слышишь 👂',
          speak: 'Собери слог ' + low(syl) + '. Нажимай буквы по порядку. ' +
                 'Если ошибся — нажми на окошко, буква вернётся.',
          hint: 'Послушай слог ещё раз: какая буква звучит первой?',
          answerHint: 'Получается слог ' + syl
        };
      },
      render: function (data, api) {
        var wrap = el('div', { class: 'rt-task' });
        wrap.appendChild(el('div', { class: 'center g3 wrap' }, [
          data.showModel ? el('span', { class: 'rt-model__ch rt-model__ch--sm', text: data.syl }) : null,
          listenBtn('Послушать', function () { Speech.word(data.syl); })
        ]));
        wrap.appendChild(builder(api, {
          tiles: data.tiles, parts: data.parts, answer: data.answer,
          hint: data.hint, answerHint: data.answerHint
        }));
        return wrap;
      }
    });

    /* =====================================================
       СЛОВА
       ===================================================== */

    /* --- Знакомство со словом --------------------------- */
    Tasks.register('learnWord', {
      section: 'words',
      teach: true,
      build: function (skillId) {
        var W = Words.find(valueOf(skillId));
        if (!W) return null;
        return {
          word: W,
          prompt: 'Читаем слово <b>' + W.w + '</b>',
          speak: 'Слово ' + low(W.w) + '. Читаем по слогам: ' + low(W.syllables.join(', ')) +
                 '. Вместе: ' + low(W.w)
        };
      },
      render: function (data) {
        var W = data.word;
        var sylNodes = W.syllables.map(function (s) {
          return el('button', {
            class: 'rt-syl', type: 'button', dataset: { v: s },
            onclick: function () { SFX.tap(); Speech.word(s); }
          }, [el('span', { text: s })]);
        });

        var wordRow = el('div', { class: 'rt-word' }, sylNodes.reduce(function (acc, n, i) {
          if (i) acc.push(el('span', { class: 'rt-word__dash', text: '-' }));
          acc.push(n);
          return acc;
        }, []));

        var facts = el('div', { class: 'center g2 mt4 wrap' }, [
          UI.chip(plural(W.letters.length, 'буква', 'буквы', 'букв'), 'soft', '🔤'),
          UI.chip(plural(W.syllables.length, 'слог', 'слога', 'слогов'), 'sun', '🧩'),
          UI.chip('Первая: ' + W.w.charAt(0), 'grass', '👆')
        ]);

        return el('div', { class: 'rt-task rt-learn' }, [
          picCard(W.emoji, W.w),
          wordRow,
          facts,
          el('div', { class: 'center g3 mt5 wrap' }, [
            listenBtn('По слогам', function () {
              playParts(sylNodes, function (i) { return Speech.word(W.syllables[i]); }, function () {
                Speech.word(W.w);
              });
            }, 'ghost'),
            listenBtn('Целиком', function () { Speech.word(W.w); })
          ])
        ]);
      }
    });

    /* --- Собери слово ----------------------------------- */
    Tasks.register('buildWord', {
      section: 'words',
      needsCheck: true,
      build: function (skillId, level, unit) {
        var W = Words.find(valueOf(skillId));
        if (!W) return null;
        var lv = lvl(level);
        var parts = W.letters.slice();
        var tiles = parts.slice();
        if (lv === 3) {
          var extra = fillOptions(W.w.charAt(0), 2, [knownLetters(unit)], function (c) {
            return parts.indexOf(c) < 0;
          })[1];
          if (extra) tiles.push(extra);
        }
        return {
          word: W, level: lv,
          parts: parts,
          tiles: UI.shuffle(tiles),
          answer: W.w,
          showModel: lv === 1,
          prompt: lv === 1 ? 'Собери слово <b>' + W.w + '</b>' : 'Собери слово по картинке',
          speak: 'Собери слово ' + low(W.w) + '. Нажимай буквы по порядку. ' +
                 'Нажмёшь на окошко — буква вернётся обратно.',
          hint: 'Посмотри на картинку и послушай слово ещё раз: какая буква первая?',
          answerHint: 'Получается слово ' + W.w
        };
      },
      render: function (data, api) {
        var W = data.word;
        var wrap = el('div', { class: 'rt-task' }, [
          picCard(W.emoji, W.w),
          el('div', { class: 'center g3 mt3 wrap' }, [
            data.showModel ? el('span', { class: 'rt-model__ch rt-model__ch--sm', text: W.w }) : null,
            listenBtn('Послушать слово', function () { Speech.word(W.w); })
          ])
        ]);
        wrap.appendChild(builder(api, {
          tiles: data.tiles, parts: data.parts, answer: data.answer,
          hint: data.hint, answerHint: data.answerHint
        }));
        return wrap;
      }
    });

    /* --- Пропала буква ---------------------------------- */
    Tasks.register('missingLetter', {
      section: 'words',
      build: function (skillId, level, unit) {
        var W = Words.find(valueOf(skillId));
        if (!W) return null;
        var lv = lvl(level);
        var letters = W.letters.slice();
        if (letters.length < 2) return null;

        var pos;
        if (lv === 1) pos = 0;
        else if (lv === 2) pos = letters.length - 1;
        else pos = letters.length > 2 ? UI.rnd(1, letters.length - 2) : UI.rnd(0, letters.length - 1);

        var correct = letters[pos];

        // лучшие отвлекающие — те, что дают ДРУГОЕ настоящее слово
        var twins = [];
        allChars().forEach(function (c) {
          if (c === correct) return;
          var cand = letters.slice();
          cand[pos] = c;
          if (Words.find(cand.join(''))) twins.push(c);
        });

        var count = lv === 1 ? 3 : 4;
        var values = fillOptions(correct, count, [twins].concat(simPools(correct, unit), [knownLetters(unit)]), learnedOnly(unit));
        if (values.length < 2) return null;

        var masked = letters.slice();
        masked[pos] = '_';

        return {
          word: W, level: lv, pos: pos, correct: correct,
          masked: masked,
          showPic: lv <= 2,
          options: mkOptions(correct, values),
          prompt: 'Какая буква пропала?',
          speak: 'В слове ' + low(W.w) + ' пропала буква. Послушай ещё раз: ' + low(W.w) + '. Какая буква нужна?',
          hint: 'Послушай слово ещё раз и произнеси его медленно по звукам.',
          answerHint: 'Нужна буква ' + correct + ': получается ' + W.w
        };
      },
      render: function (data, api) {
        var wrap = el('div', { class: 'rt-task' }, [
          data.showPic ? picCard(data.word.emoji, data.word.w) : null,
          el('div', { class: 'rt-mask' }, data.masked.map(function (c) {
            return el('span', { class: c === '_' ? 'rt-mask__gap' : 'rt-mask__ch', text: c === '_' ? '?' : c });
          })),
          el('div', { class: 'center mt3' }, [
            listenBtn('Послушать слово', function () { Speech.word(data.word.w); })
          ])
        ]);
        wrap.appendChild(choiceGrid(api, {
          items: data.options,
          grid: data.options.length === 3 ? 3 : 4,
          hint: data.hint, answerHint: data.answerHint
        }));
        return wrap;
      }
    });

    /* --- Лишняя буква ----------------------------------- */
    Tasks.register('extraLetter', {
      section: 'words',
      build: function (skillId, level, unit) {
        var W = Words.find(valueOf(skillId));
        if (!W) return null;
        var lv = lvl(level);
        var own = W.letters;
        var known = knownLetters(unit).filter(function (c) {
          var L = Alphabet.byChar(c);
          return L && L.type !== 'sign';
        });

        // на 1 уровне лишняя буква чужая, на 3 — своя же (КОТ → ОКОТ)
        var pool = lv === 3 ? own.slice() : known.filter(function (c) { return own.indexOf(c) < 0; });
        var variants = extraVariants(W.w, pool);
        if (!variants.length) variants = extraVariants(W.w, known);
        if (!variants.length) variants = extraVariants(W.w, allChars());
        if (!variants.length) return null;

        var v = UI.pick(variants);
        var options = chars(v.shown).map(function (c, i) {
          return { v: c, ok: i === v.index, i: i };
        });

        return {
          word: W, level: lv, shown: v.shown, index: v.index,
          options: options,
          showPic: lv <= 2,
          prompt: 'Найди лишнюю букву',
          speak: 'Здесь спряталась лишняя буква. Убери её, чтобы получилось слово ' + low(W.w),
          hint: 'Читай по буквам и слушай: какая буква мешает?',
          answerHint: 'Без этой буквы получается ' + W.w
        };
      },
      render: function (data, api) {
        var wrap = el('div', { class: 'rt-task' }, [
          data.showPic ? picCard(data.word.emoji, data.word.w) : null,
          el('div', { class: 'center mt3' }, [
            listenBtn('Какое слово?', function () { Speech.word(data.word.w); })
          ])
        ]);
        wrap.appendChild(choiceGrid(api, {
          items: data.options,
          grid: 'strip',
          optClass: 'rt-opt--letter',
          hint: data.hint, answerHint: data.answerHint
        }));
        return wrap;
      }
    });

    /* --- Слово ↔ картинка ------------------------------- */
    Tasks.register('readWord', {
      section: 'words',
      build: function (skillId, level, unit) {
        var W = Words.find(valueOf(skillId));
        if (!W) return null;
        var lv = lvl(level);
        var sib = siblingWords(W, unit);
        var count = lv === 1 ? 3 : 4;

        if (lv === 3) {
          // наоборот: картинка и слова
          var wpool = [sib.near, sib.same, sib.level, sib.all].map(function (list) {
            return list.map(function (x) { return x.w; });
          });
          var values = fillOptions(W.w, count, wpool);
          if (values.length < 2) return null;
          return {
            word: W, level: lv, mode: 'word',
            options: mkOptions(W.w, values),
            prompt: 'Какое слово подходит к картинке?',
            speak: 'Посмотри на картинку и выбери слово. Читай не спеша, по слогам.',
            hint: 'Прочитай слова по слогам: они очень похожи, смотри на каждую букву.',
            answerHint: 'Здесь написано ' + W.w
          };
        }

        // слово → картинка
        var used = {};
        used[W.emoji] = 1;
        var picked = [{ v: W.emoji, w: W.w, ok: true }];
        [sib.same, sib.level, sib.all].forEach(function (list) {
          UI.shuffle(list).forEach(function (x) {
            if (picked.length >= count) return;
            if (used[x.emoji]) return;
            used[x.emoji] = 1;
            picked.push({ v: x.emoji, w: x.w, ok: false });
          });
        });
        if (picked.length < 2) return null;

        return {
          word: W, level: lv, mode: 'pic',
          options: UI.shuffle(picked),
          prompt: 'Прочитай слово <b>' + W.w + '</b> и выбери картинку',
          speak: 'Прочитай слово сам, по слогам, и выбери подходящую картинку.',
          hint: 'Прочитай слово ещё раз по слогам — не спеши.',
          answerHint: 'Слово ' + low(W.w) + ' — вот эта картинка'
        };
      },
      render: function (data, api) {
        var W = data.word;
        var wrap = el('div', { class: 'rt-task' });

        if (data.mode === 'word') {
          wrap.appendChild(picCard(W.emoji, W.w));
          wrap.appendChild(choiceGrid(api, {
            items: data.options,
            grid: data.options.length === 3 ? 3 : 4,
            optClass: 'opt--word',
            hint: data.hint, answerHint: data.answerHint
          }));
        } else {
          wrap.appendChild(el('div', { class: 'rt-bigword', dataset: { v: W.w }, text: W.w }));
          wrap.appendChild(choiceGrid(api, {
            items: data.options,
            grid: data.options.length === 3 ? 3 : 4,
            optClass: 'rt-opt--pic',
            body: function (it) { return [el('span', { class: 'rt-opt__emoji', text: it.v })]; },
            hint: data.hint, answerHint: data.answerHint
          }));
        }
        return wrap;
      }
    });

    /* =====================================================
       ПРЕДЛОЖЕНИЯ
       ===================================================== */

    function sentenceById(id) {
      var n = parseInt(id, 10);
      var list = Sentences.SENTENCES;
      for (var i = 0; i < list.length; i++) if (list[i].id === n) return list[i];
      return null;
    }

    /* --- Знакомство с предложением ---------------------- */
    Tasks.register('learnSentence', {
      section: 'sentences',
      teach: true,
      build: function (skillId) {
        var S = sentenceById(valueOf(skillId));
        if (!S) return null;
        return {
          sentence: S,
          prompt: 'Читаем предложение',
          speak: 'Читаем по словам: ' + low(S.words.join(', ')) + '. Вместе: ' + low(S.text)
        };
      },
      render: function (data) {
        var S = data.sentence;
        var wordNodes = S.words.map(function (w) {
          return el('button', {
            class: 'rt-sword', type: 'button', dataset: { v: w },
            onclick: function () { SFX.tap(); Speech.word(w); }
          }, [el('span', { text: w })]);
        });
        var row = el('div', { class: 'rt-sent' }, wordNodes.concat([
          el('span', { class: 'rt-sent__dot', text: '.' })
        ]));

        return el('div', { class: 'rt-task rt-learn' }, [
          picCard(S.emoji, null, function () { Speech.phrase(S.text); }),
          row,
          el('div', { class: 'center g3 mt5 wrap' }, [
            listenBtn('По словам', function () {
              playParts(wordNodes, function (i) { return Speech.word(S.words[i]); }, function () {
                Speech.phrase(S.text);
              });
            }, 'ghost'),
            listenBtn('Целиком', function () { Speech.phrase(S.text); })
          ])
        ]);
      }
    });

    /* --- Собери предложение ----------------------------- */
    Tasks.register('buildSentence', {
      section: 'sentences',
      needsCheck: true,
      build: function (skillId, level) {
        var S = sentenceById(valueOf(skillId));
        if (!S) return null;
        var lv = lvl(level);
        var parts = S.words.slice();
        var tiles = parts.slice();

        if (lv === 3) {
          // лишнее слово из другого предложения того же уровня
          var pool = [];
          Sentences.byLevel(S.level).forEach(function (x) {
            if (x.id === S.id) return;
            x.words.forEach(function (w) { if (parts.indexOf(w) < 0 && pool.indexOf(w) < 0) pool.push(w); });
          });
          if (pool.length) tiles.push(UI.pick(pool));
        }

        return {
          sentence: S, level: lv,
          parts: parts,
          tiles: UI.shuffle(tiles),
          answer: parts.join(' '),
          showModel: lv === 1,
          prompt: lv === 1 ? 'Собери предложение: <b>' + S.text + '</b>' : 'Собери предложение по картинке',
          speak: 'Собери предложение: ' + low(S.text) + ' Нажимай слова по порядку. ' +
                 'Нажмёшь на окошко — слово вернётся обратно.',
          hint: 'Послушай ещё раз: какое слово в предложении первое?',
          answerHint: 'Получается: ' + S.text
        };
      },
      render: function (data, api) {
        var S = data.sentence;
        var wrap = el('div', { class: 'rt-task' }, [
          picCard(S.emoji, null, function () { Speech.phrase(S.text); }),
          el('div', { class: 'center g3 mt3 wrap' }, [
            data.showModel ? el('span', { class: 'rt-hintline', text: S.text }) : null,
            listenBtn('Послушать', function () { Speech.phrase(S.text); })
          ])
        ]);
        wrap.appendChild(builder(api, {
          tiles: data.tiles, parts: data.parts, answer: data.answer,
          joiner: ' ', wide: true, speakTile: true,
          hint: data.hint, answerHint: data.answerHint
        }));
        return wrap;
      }
    });
  }

  if (global.Tasks) registerReadingTypes();
  else global.addEventListener('DOMContentLoaded', registerReadingTypes);

})(window);
