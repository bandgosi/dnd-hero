/* =========================================================
   games/literacy.js — четыре мини-игры блока «Читаем и пишем».

   🧩 buildword  «Собери слово»    — звуковой анализ: слово из букв по картинке
   🐝 bees       «Поймай букву»    — узнавание буквы среди похожих
   🎨 draw       «Нарисуй букву»   — письмо по траектории (tasks/tracing.js)
   🐻 bear       «Накорми медведя» — первый звук в слове

   Общие правила модуля:
   — «неверные» варианты всегда осмысленные: похожие по начертанию буквы,
     слова на другой первый звук. Случайного мусора нет;
   — ошибка никогда не называется ошибкой: мягкий звук, лёгкая анимация,
     подсказка и возможность попробовать ещё;
   — все таймеры и кадры анимации живут только внутри shell
     (shell.timeout / shell.interval / флаг + shell.onCleanup для rAF).
   ========================================================= */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------
     Мелкие помощники
     --------------------------------------------------------- */
  function el() { return UI.el.apply(null, arguments); }
  function shuffle(a) { return UI.shuffle(a); }
  function rnd(a, b) { return UI.rnd(a, b); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  /**
   * Похожие буквы — источник осмысленных «неверных» вариантов.
   * Пары подобраны по типичным детским смешениям: начертание (Ш/Щ, И/Й),
   * зеркальность (Р/Ь, З/Э), близкий звук (Б/П, Ж/Ш).
   */
  var CONFUSE = {
    'А': ['Л', 'Д', 'Я'], 'Б': ['В', 'Ь', 'Р'], 'В': ['Б', 'Ь', 'Ы'],
    'Г': ['Т', 'П', 'Р'], 'Д': ['Л', 'А', 'Ц'], 'Е': ['Ё', 'З', 'Э'],
    'Ё': ['Е', 'Ж'], 'Ж': ['Х', 'К', 'Ш'], 'З': ['Э', 'Е', 'В'],
    'И': ['Й', 'Н', 'П'], 'Й': ['И', 'Н'], 'К': ['Ж', 'Х', 'Н'],
    'Л': ['А', 'Д', 'М'], 'М': ['Н', 'Л', 'И'], 'Н': ['И', 'П', 'М'],
    'О': ['С', 'Ю', 'Ф'], 'П': ['Н', 'И', 'Г'], 'Р': ['Ь', 'Б', 'Ф'],
    'С': ['О', 'Э', 'Е'], 'Т': ['Г', 'П'], 'У': ['Ч', 'Х'],
    'Ф': ['О', 'Р', 'Ы'], 'Х': ['Ж', 'К', 'У'], 'Ц': ['Щ', 'Ш', 'Д'],
    'Ч': ['У', 'Ц'], 'Ш': ['Щ', 'Ц', 'М'], 'Щ': ['Ш', 'Ц'],
    'Ъ': ['Ь', 'Ы'], 'Ы': ['Ь', 'Ъ', 'И'], 'Ь': ['Ы', 'Ъ', 'Б'],
    'Э': ['З', 'С', 'Е'], 'Ю': ['О', 'Ы'], 'Я': ['А', 'Ф']
  };

  function confusables(ch) { return (CONFUSE[ch] || []).slice(); }

  /** Знаком ли ребёнку навык (был показан или отвечал). */
  function seen(id) {
    var s = (global.Store && Store.data.skills) ? Store.data.skills[id] : null;
    return !!(s && (s.introduced || s.attempts > 0));
  }
  /** Вес показа: слабое повторяем чаще (см. core/skills.js). */
  function weightOf(id) {
    return (global.Skills && Skills.weight) ? Skills.weight(id) : 1;
  }

  /** n элементов без повторов с учётом веса. */
  function drawWeighted(items, weight, n) {
    var pool = items.slice(), out = [], i;
    while (pool.length && out.length < n) {
      var total = 0;
      for (i = 0; i < pool.length; i++) total += Math.max(0.01, weight(pool[i]));
      var r = Math.random() * total, acc = 0, idx = pool.length - 1;
      for (i = 0; i < pool.length; i++) {
        acc += Math.max(0.01, weight(pool[i]));
        if (r <= acc) { idx = i; break; }
      }
      out.push(pool.splice(idx, 1)[0]);
    }
    return out;
  }

  /** Дополнить список до n повторами (когда данных мало). */
  function padTo(list, n) {
    var out = list.slice(), j = 0;
    while (out.length < n && list.length) { out.push(list[j % list.length]); j++; }
    return out;
  }

  /**
   * Касание: pointerdown — чтобы на планшете срабатывало сразу.
   * click оставлен запасным путём (мышь без Pointer Events, клавиатура),
   * но гасится, если только что был pointerdown — иначе двойное начисление.
   */
  function onTap(node, fn) {
    var last = 0;
    function handler(e) {
      if (e.type === 'click' && Date.now() - last < 800) return;
      last = Date.now();
      if (e && e.preventDefault) e.preventDefault();
      fn(e, node);
    }
    node.addEventListener('pointerdown', handler);
    node.addEventListener('click', handler);
    return node;
  }

  function firstOf(word) {
    return (word.letters && word.letters[0]) || String(word.w).charAt(0);
  }

  function letterName(ch) {
    var L = global.Alphabet && Alphabet.byChar(ch);
    return L ? L.name : ch;
  }

  /* ---------------------------------------------------------
     Подбор материала под ребёнка
     --------------------------------------------------------- */

  /** Слова: приоритет уровням, которые ребёнок уже проходил. */
  function pickWords(n) {
    var all = (global.Words && Words.upToLevel(4)) || [];
    if (!all.length) return [];

    var seenLevels = {}, any = false;
    all.forEach(function (w) {
      if (seen('word:' + w.w)) { seenLevels[w.level] = true; any = true; }
    });

    var maxLv = 2;
    if (any) Object.keys(seenLevels).forEach(function (k) { maxLv = Math.max(maxLv, Number(k)); });

    var pool = all.filter(function (w) { return w.level <= maxLv && w.w.length <= 6; });
    if (pool.length < n) pool = all.filter(function (w) { return w.w.length <= 6; });
    if (pool.length < n) pool = all;

    var out = drawWeighted(pool, function (w) {
      var k = seenLevels[w.level] ? 3 : 1;
      if (seen('word:' + w.w)) k *= weightOf('word:' + w.w);   // слабое слово — чаще
      if (w.w.length <= 4) k *= 1.25;                          // короткое собрать легче
      return k;
    }, n);

    return padTo(out, n);
  }

  /** Буквы: сначала те, что ребёнок уже проходил; иначе — первые по порядку изучения. */
  function letterPool() {
    var all = (global.Alphabet ? Alphabet.LETTERS : []).filter(function (l) { return l.type !== 'sign'; });
    var studied = all.filter(function (l) {
      return seen('letter:' + l.ch) || seen('sound:' + l.ch) || seen('write:' + l.ch);
    });
    if (studied.length >= 4) return studied;
    var first = Alphabet.inOrder(12).filter(function (l) { return l.type !== 'sign'; });
    return first.length ? first : all;
  }

  function pickLetters(n) {
    var pool = letterPool();
    if (!pool.length) return [];
    var out = drawWeighted(pool, function (l) { return weightOf('letter:' + l.ch); }, n);
    return padTo(out, n);
  }

  /* =========================================================
     🧩 Собери слово
     ========================================================= */
  Games.register({
    id: 'buildword', emoji: '🧩', title: 'Собери слово', track: 'reading',
    rules: 'Собери слово из букв — картинка подскажет',
    unit: 'Чтение слов',
    build: function (shell) {
      var TOTAL = 8;
      var words = pickWords(TOTAL);
      if (!words.length) { shell.result(0, 0); return; }

      var i = 0, score = 0, pos = 0, misses = 0, busy = false;
      var word = words[0];
      var slotNodes = [];

      var pic = el('div', { class: 'gl-pic float', text: '❓' });
      var slots = el('div', { class: 'gl-slots' });
      var bank = el('div', { class: 'gl-bank' });
      var listen = UI.speakBtn(function () { return word.w.toLowerCase(); }, 'Ещё раз');

      shell.area.appendChild(el('div', { class: 'card card--tint center-text gl-card' }, [
        pic,
        el('div', { class: 'gl-note', text: 'Собери слово' }),
        slots
      ]));
      shell.area.appendChild(el('div', { class: 'center', style: { justifyContent: 'center' } }, [listen]));
      shell.area.appendChild(bank);

      shell.setScore(0);

      function round() {
        word = words[i];
        pos = 0; misses = 0; busy = false;
        shell.setExtra((i + 1) + ' / ' + words.length, '🧩');

        pic.textContent = word.emoji || '❓';
        slots.innerHTML = '';
        bank.innerHTML = '';
        slotNodes = [];

        word.letters.forEach(function () {
          var s = el('div', { class: 'gl-slot' });
          slotNodes.push(s);
          slots.appendChild(s);
        });
        markSlot();

        // Буквы слова + осмысленные лишние: похожие на буквы этого слова
        var extra = [], used = word.letters.slice();
        var uniq = [];
        word.letters.forEach(function (c) { if (uniq.indexOf(c) === -1) uniq.push(c); });
        shuffle(uniq).forEach(function (c) {
          if (extra.length >= (word.letters.length > 4 ? 1 : 2)) return;
          var cand = confusables(c).filter(function (x) {
            return used.indexOf(x) === -1 && extra.indexOf(x) === -1 && Alphabet.byChar(x);
          });
          if (cand.length) extra.push(cand[0]);
        });

        shuffle(word.letters.concat(extra)).forEach(function (ch) {
          var tile = el('button', { class: 'gl-tile', type: 'button', text: ch });
          onTap(tile, function () { tap(ch, tile); });
          bank.appendChild(tile);
        });

        Speech.word(word.w);
      }

      function markSlot() {
        slotNodes.forEach(function (s, k) { s.classList.toggle('is-now', k === pos); });
      }

      function tap(ch, tile) {
        if (busy || shell.isFinished() || tile.__used) return;
        var need = word.letters[pos];

        if (ch !== need) {
          misses++;
          SFX.almost();
          tile.classList.add('gl-shake');
          shell.timeout(function () { tile.classList.remove('gl-shake'); }, 460);
          if (misses === 1) Speech.phrase('Слушай ещё раз');
          if (misses >= 2) hint(need);
          return;
        }

        tile.__used = true;
        tile.classList.add('is-used');
        tile.disabled = true;
        slotNodes[pos].textContent = ch;
        slotNodes[pos].classList.add('is-filled');
        SFX.pop();
        pos++;
        markSlot();
        if (pos >= word.letters.length) finish();
      }

      /** Подсказка вместо упрёка: тянем звук и подсвечиваем нужную букву. */
      function hint(need) {
        Speech.letterSound(need);
        var tiles = bank.children;
        for (var k = 0; k < tiles.length; k++) {
          if (tiles[k].textContent === need && !tiles[k].__used) {
            tiles[k].classList.add('is-hint');
            break;
          }
        }
      }

      function finish() {
        busy = true;
        var ok = misses === 0;
        if (ok) { score++; shell.setScore(score); }
        shell.answer(ok, 'word:' + word.w);
        slots.classList.add('is-done');
        SFX.right();
        FX.at(slots, '✨');
        Speech.syllables(word.syllables || [word.w], word.w);
        shell.timeout(function () {
          slots.classList.remove('is-done');
          i++;
          if (i >= words.length) shell.result(score, words.length);
          else round();
        }, 1500);
      }

      round();
    }
  });

  /* =========================================================
     🐝 Поймай букву
     ========================================================= */
  Games.register({
    id: 'bees', emoji: '🐝', title: 'Поймай букву', track: 'reading',
    rules: 'Лови пчёлок с нужной буквой',
    unit: 'Узнавание букв',
    build: function (shell) {
      var ROUNDS = 5, BEE = 68;
      var targets = pickLetters(ROUNDS);
      if (!targets.length) { shell.result(0, 0); return; }

      var round = 0, score = 0, maxScore = 0;
      var bees = [], need = 0, roundDone = true, target = targets[0];
      var alive = true, rafId = 0, lastTs = 0, roundId = 0;

      var task = el('div', { class: 'gl-task' });
      var big = el('span', { class: 'gl-big', text: '' });
      var field = el('div', { class: 'gl-field' });

      var say = UI.iconBtn('🔊', function () { Speech.letterSound(target.ch); }, 'Послушать букву');

      shell.area.appendChild(el('div', { class: 'card card--tint gl-card' }, [
        el('div', { class: 'row g3', style: { justifyContent: 'center' } }, [
          el('span', { class: 'gl-note', text: 'Лови букву' }), big, say
        ])
      ]));
      shell.area.appendChild(field);
      shell.setScore(0);

      shell.onCleanup(function () {
        alive = false;
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
        bees.length = 0;
      });

      function size() {
        var w = field.clientWidth || field.offsetWidth || 320;
        var h = field.clientHeight || field.offsetHeight || 340;
        return { w: Math.max(BEE + 20, w), h: Math.max(BEE + 20, h) };
      }

      function frame(ts) {
        rafId = 0;
        if (!alive || shell.isFinished()) return;
        ts = ts || Date.now();
        var dt = lastTs ? Math.min(64, ts - lastTs) : 16;
        lastTs = ts;
        var s = size(), k = dt / 16;
        for (var n = 0; n < bees.length; n++) {
          var b = bees[n];
          b.x += b.vx * k;
          b.y += b.vy * k;
          if (b.x < 0) { b.x = 0; b.vx = Math.abs(b.vx); }
          if (b.x > s.w - BEE) { b.x = s.w - BEE; b.vx = -Math.abs(b.vx); }
          if (b.y < 0) { b.y = 0; b.vy = Math.abs(b.vy); }
          if (b.y > s.h - BEE) { b.y = s.h - BEE; b.vy = -Math.abs(b.vy); }
          b.node.style.transform = 'translate(' + b.x.toFixed(1) + 'px,' + b.y.toFixed(1) + 'px)';
          b.body.style.transform = 'scaleX(' + (b.vx < 0 ? -1 : 1) + ')';
        }
        rafId = requestAnimationFrame(frame);
      }

      function makeBee(ch, isNeed) {
        var s = size();
        var body = el('span', { class: 'gl-bee__body', text: '🐝' });
        var node = el('button', { class: 'gl-bee', type: 'button', 'aria-label': 'пчела ' + ch }, [
          body, el('span', { class: 'gl-bee__ch', text: ch })
        ]);
        var b = {
          ch: ch, need: isNeed, node: node, body: body,
          x: rnd(0, Math.max(1, s.w - BEE)), y: rnd(0, Math.max(1, s.h - BEE)),
          vx: (Math.random() < 0.5 ? -1 : 1) * (0.7 + Math.random() * 1.1),
          vy: (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 1.0),
          caught: false
        };
        node.style.transform = 'translate(' + b.x + 'px,' + b.y + 'px)';
        onTap(node, function () { katch(b); });
        return b;
      }

      function removeBee(b) {
        var k = bees.indexOf(b);
        if (k !== -1) bees.splice(k, 1);
      }

      function katch(b) {
        if (!alive || roundDone || b.caught || shell.isFinished()) return;
        b.caught = true;

        if (b.need) {
          score++;
          shell.setScore(score);
          shell.answer(true, 'letter:' + target.ch);
          SFX.pop();
          FX.at(b.node, '⭐');
          b.node.classList.add('is-caught');
          removeBee(b);
          shell.timeout(function () { if (b.node.parentNode) b.node.parentNode.removeChild(b.node); }, 320);
          need--;
          if (need <= 0) endRound(true);
        } else {
          // Не ругаем: пчёлка просто улетает, и можно ловить дальше
          shell.answer(false, 'letter:' + target.ch);
          SFX.almost();
          b.node.classList.add('is-away');
          removeBee(b);
          shell.timeout(function () { if (b.node.parentNode) b.node.parentNode.removeChild(b.node); }, 420);
          Speech.letterSound(target.ch);
        }
      }

      function startRound() {
        if (!alive || shell.isFinished()) return;
        round++;
        roundId++;
        var myRound = roundId;
        target = targets[round - 1] || pick(targets);
        roundDone = false;

        need = rnd(2, 3);
        var total = rnd(6, 8);
        if (total < need + 3) total = need + 3;
        maxScore += need;

        shell.setExtra(round + ' / ' + ROUNDS, '🍯');
        big.textContent = target.ch;
        field.innerHTML = '';
        bees = [];

        // Чужие буквы — похожие на нужную, чтобы ребёнок именно различал
        var others = confusables(target.ch).filter(function (c) { return c !== target.ch && Alphabet.byChar(c); });
        var restPool = letterPool().map(function (l) { return l.ch; }).filter(function (c) {
          return c !== target.ch && others.indexOf(c) === -1;
        });
        var wrongLetters = shuffle(others);
        while (wrongLetters.length < total - need && restPool.length) {
          wrongLetters.push(restPool.splice(Math.floor(Math.random() * restPool.length), 1)[0]);
        }
        while (wrongLetters.length < total - need) wrongLetters.push(wrongLetters[0] || target.ch);

        var list = [];
        for (var a = 0; a < need; a++) list.push(makeBee(target.ch, true));
        for (var c = 0; c < total - need; c++) list.push(makeBee(wrongLetters[c % wrongLetters.length], false));
        shuffle(list).forEach(function (b) { bees.push(b); field.appendChild(b.node); });

        Speech.phrase('Лови букву ' + letterName(target.ch));

        // Страховка от «зависания»: если долго не получается — подсказываем,
        // а потом мягко переходим к следующей букве.
        shell.timeout(function () {
          if (!alive || roundDone || myRound !== roundId) return;
          bees.forEach(function (b) { if (b.need) b.node.classList.add('is-hint'); });
          Speech.phrase('Вот она, буква ' + letterName(target.ch));
        }, 22000);
        shell.timeout(function () {
          if (!alive || roundDone || myRound !== roundId) return;
          endRound(false);
        }, 40000);

        if (!rafId) { lastTs = 0; rafId = requestAnimationFrame(frame); }
      }

      function endRound(won) {
        if (roundDone) return;
        roundDone = true;
        bees.forEach(function (b) { b.node.classList.add('is-away'); });
        bees = [];
        if (won) { SFX.star(round); Speech.phrase('Все пчёлки пойманы!'); }
        shell.timeout(function () {
          if (!alive || shell.isFinished()) return;
          field.innerHTML = '';
          if (round >= ROUNDS) shell.result(score, maxScore);
          else startRound();
        }, 1200);
      }

      startRound();
    }
  });

  /* =========================================================
     🎨 Нарисуй букву
     ========================================================= */
  Games.register({
    id: 'draw', emoji: '🎨', title: 'Нарисуй букву', track: 'reading',
    rules: 'Веди по дорожке от зелёной точки',
    unit: 'Письмо букв',
    build: function (shell) {
      var TOTAL = 5;
      var letters = pickLetters(TOTAL).filter(function (l) { return l && l.strokes && l.strokes.length; });
      if (!letters.length) { shell.result(0, 0); return; }
      letters = padTo(letters, TOTAL);

      var i = 0, score = 0, done = false, widget = null;
      var L = letters[0];

      var head = el('div', { class: 'row g3 gl-head' }, [
        el('span', { class: 'gl-big', text: L.ch }),
        el('span', { class: 'gl-note grow', text: 'Напиши букву' })
      ]);
      var host = el('div', { class: 'gl-draw' });
      var starsBox = el('div', { class: 'center' });
      var tools = el('div', { class: 'center g2 wrap' });

      shell.area.appendChild(el('div', { class: 'card card--tint gl-card' }, [head, host, starsBox]));
      shell.area.appendChild(tools);
      shell.setScore(0);

      var showBtn = UI.btn('Показать', {
        variant: 'ghost', small: true, emoji: '👀',
        onClick: function () { if (widget) { widget.demo(); Speech.phrase('Смотри, как надо'); } }
      });
      var againBtn = UI.btn('Сначала', {
        variant: 'ghost', small: true, emoji: '↩️',
        onClick: function () { if (widget && !done) widget.reset(); }
      });
      var skipBtn = UI.btn('Другая буква', {
        variant: 'ghost', small: true, emoji: '➡️',
        onClick: function () { skip(); }
      });
      tools.appendChild(showBtn); tools.appendChild(againBtn); tools.appendChild(skipBtn);

      function round() {
        L = letters[i];
        done = false;
        shell.setExtra((i + 1) + ' / ' + letters.length, '✏️');
        head.firstChild.textContent = L.ch;
        starsBox.innerHTML = '';
        host.innerHTML = '';

        widget = Tracing.TraceWidget({
          glyph: L.ch,
          strokes: L.strokes,
          onDone: function (q) { finish(q); }
        });
        host.appendChild(widget.el);
        host.__widget = widget;          // точка входа для автотестов и подсказок
        Speech.phrase('Напиши букву ' + L.name);
      }

      function finish(q) {
        if (done) return;
        done = true;
        var pts = q >= 0.72 ? 3 : q >= 0.45 ? 2 : 1;
        score += pts;
        shell.setScore(score);
        shell.answer(pts >= 2, 'write:' + L.ch);
        starsBox.innerHTML = '';
        starsBox.appendChild(UI.stars(pts, true));
        Speech.phrase(pts === 3 ? 'Красивая буква!' : 'Молодец, буква готова!');
        shell.timeout(next, 1500);
      }

      /** Не получается — идём дальше без упрёков. */
      function skip() {
        if (done || shell.isFinished()) return;
        done = true;
        shell.answer(false, 'write:' + L.ch);
        SFX.almost();
        Speech.phrase('Хорошо, попробуем другую букву');
        shell.timeout(next, 600);
      }

      function next() {
        if (shell.isFinished()) return;
        i++;
        if (i >= letters.length) shell.result(score, letters.length * 3);
        else round();
      }

      round();
    }
  });

  /* =========================================================
     🐻 Накорми медведя
     ========================================================= */

  /** Съедобное из общего словаря — чтобы медведь просил еду, а не мост. */
  /* Только то, что шестилетка уверенно узнаёт на картинке и считает едой */
  var FOOD = ['УХА', 'КАША', 'САЛАТ', 'САХАР', 'СОК', 'ЛУК',
              'СЫР', 'ТОРТ', 'ГРИБ', 'СУП', 'БАНАН', 'ГРУША', 'ЛИМОН', 'АРБУЗ', 'ТЫКВА',
              'ЯБЛОКО', 'ХЛЕБ', 'ЯГОДА', 'ОГУРЕЦ', 'ЯЙЦО', 'РЫБА'];

  function foodWords() {
    var out = [];
    if (!global.Words) return out;
    FOOD.forEach(function (w) { var f = Words.find(w); if (f) out.push(f); });
    if (out.length < 8) out = Words.upToLevel(4).slice();
    return out;
  }

  function bearRounds(n) {
    var foods = foodWords();
    if (foods.length < 4) return [];

    var byLetter = {};
    foods.forEach(function (w) {
      var ch = firstOf(w);
      (byLetter[ch] || (byLetter[ch] = [])).push(w);
    });
    var letters = Object.keys(byLetter).filter(function (ch) {
      return foods.length - byLetter[ch].length >= 3;
    });
    if (!letters.length) letters = Object.keys(byLetter);

    var order = drawWeighted(letters, function (ch) {
      var known = (seen('letter:' + ch) || seen('first:' + ch)) ? 2.5 : 1;
      return known * weightOf('first:' + ch);
    }, Math.min(n, letters.length));
    order = padTo(order, n);

    var rounds = [];
    for (var i = 0; i < n; i++) {
      var ch = order[i];
      var right = pick(byLetter[ch]);
      var others = foods.filter(function (w) { return firstOf(w) !== ch; });
      var nice = others.filter(function (w) { return confusables(ch).indexOf(firstOf(w)) !== -1; });

      var wrong = [], usedL = [ch];
      shuffle(nice).forEach(function (w) {
        if (wrong.length < 2 && usedL.indexOf(firstOf(w)) === -1) { wrong.push(w); usedL.push(firstOf(w)); }
      });
      shuffle(others).forEach(function (w) {
        if (wrong.length < 3 && usedL.indexOf(firstOf(w)) === -1) { wrong.push(w); usedL.push(firstOf(w)); }
      });
      shuffle(others).forEach(function (w) {
        if (wrong.length < 3 && wrong.indexOf(w) === -1) wrong.push(w);
      });

      rounds.push({ ch: ch, right: right, options: shuffle(wrong.slice(0, 3).concat([right])) });
    }
    return rounds;
  }

  Games.register({
    id: 'bear', emoji: '🐻', title: 'Накорми медведя', track: 'reading',
    rules: 'Дай мишке еду на нужную букву',
    unit: 'Первый звук в слове',
    build: function (shell) {
      var TOTAL = 8;
      var rounds = bearRounds(TOTAL);
      if (!rounds.length) { shell.result(0, 0); return; }

      var i = 0, score = 0, misses = 0, locked = false;
      var cur = rounds[0];

      var bear = el('div', { class: 'gl-bear', text: '🐻' });
      var big = el('span', { class: 'gl-big', text: '' });
      var bubble = el('div', { class: 'gl-bubble' }, [
        el('span', { text: 'Хочу на' }), big
      ]);
      var foodsBox = el('div', { class: 'gl-foods' });
      var say = UI.iconBtn('🔊', function () { ask(); }, 'Повторить');

      shell.area.appendChild(el('div', { class: 'card card--tint gl-card center-text' }, [
        el('div', { class: 'row g3', style: { justifyContent: 'center' } }, [bear, bubble, say])
      ]));
      shell.area.appendChild(foodsBox);
      shell.setScore(0);

      function ask() {
        Speech.phrase('Мишка хочет то, что начинается на ' + letterName(cur.ch));
      }

      function round() {
        cur = rounds[i];
        misses = 0; locked = false;
        shell.setExtra((i + 1) + ' / ' + rounds.length, '🍯');
        big.textContent = cur.ch;
        bear.className = 'gl-bear';
        foodsBox.innerHTML = '';

        cur.options.forEach(function (w) {
          var card = el('button', { class: 'gl-food', type: 'button', 'aria-label': w.w }, [
            el('span', { class: 'gl-food__ico', text: w.emoji || '🍽️' })
          ]);
          onTap(card, function () { tap(w, card); });
          foodsBox.appendChild(card);
        });

        ask();
      }

      function tap(w, card) {
        if (locked || card.__dead || shell.isFinished()) return;

        if (w !== cur.right) {
          misses++;
          card.__dead = true;
          card.disabled = true;
          card.classList.add('is-dim', 'gl-shake');
          SFX.almost();
          bear.classList.add('is-no');
          shell.timeout(function () { bear.classList.remove('is-no'); }, 500);
          // Объясняем, а не ругаем
          Speech.phrase(w.w.toLowerCase() + ' — на ' + letterName(firstOf(w)) +
                        '. Ищем на ' + letterName(cur.ch));
          if (misses >= 2) {
            for (var k = 0; k < foodsBox.children.length; k++) {
              var c = foodsBox.children[k];
              if (!c.__dead) c.classList.add('is-hint');
            }
          }
          return;
        }

        locked = true;
        var ok = misses === 0;
        if (ok) { score++; shell.setScore(score); }
        shell.answer(ok, 'first:' + cur.ch);
        card.classList.add('is-eaten');
        bear.classList.add('is-chew');
        SFX.right();
        FX.at(bear, '😋');
        Speech.word(w.w);
        shell.timeout(function () {
          if (shell.isFinished()) return;
          bear.classList.remove('is-chew');
          i++;
          if (i >= rounds.length) shell.result(score, rounds.length);
          else round();
        }, 1500);
      }

      round();
    }
  });

})(window);
