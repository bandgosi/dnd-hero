/* data/mathgen.js — генераторы математических заданий.
 *
 * Каждая функция принимает объект настроек и возвращает ПРОСТОЙ объект задания.
 * Рисованием занимается tasks/math.js — здесь нет ни DOM, ни состояния,
 * ни обращений к другим модулям (файл самодостаточен и грузится первым).
 *
 * Общие правила по вариантам ответа:
 *   · всегда 4 штуки (compare — 3 знака, order — вариантов нет);
 *   · верный ответ обязательно внутри, дубликатов нет;
 *   · неверные — СОСЕДНИЕ числа, а не случайные: задание должно учить;
 *   · диапазон вариантов 0..max+2, отрицательных не бывает.
 * Ни один цикл подбора не крутится дольше 200 попыток — дальше берётся
 * детерминированный запасной вариант.
 */
(function (global) {
  'use strict';

  var TRIES = 200;

  /* предметы для счёта */
  var ITEMS = ['🍎', '🍐', '🍓', '🐥', '🐟', '⭐', '🚗', '🎈', '🍄', '🌸'];

  /* Существительные: род + формы для 1 / 2-4 / 5+ и винительный падеж ед. ч.
     Нужны, чтобы озвучка и текст задачи были грамотными:
     «1 яблоко», «2 яблока», «5 яблок», «съел 1 машинку». */
  var NOUN = {
    '🍎': { g: 'n', one: 'яблоко',    few: 'яблока',    many: 'яблок',      acc: 'яблоко' },
    '🍐': { g: 'f', one: 'груша',     few: 'груши',     many: 'груш',       acc: 'грушу' },
    '🍓': { g: 'f', one: 'клубничка', few: 'клубнички', many: 'клубничек',  acc: 'клубничку' },
    '🐥': { g: 'm', one: 'цыплёнок',  few: 'цыплёнка',  many: 'цыплят',     acc: 'цыплёнка' },
    '🐟': { g: 'f', one: 'рыбка',     few: 'рыбки',     many: 'рыбок',      acc: 'рыбку' },
    '⭐': { g: 'f', one: 'звёздочка', few: 'звёздочки', many: 'звёздочек',  acc: 'звёздочку' },
    '🚗': { g: 'f', one: 'машинка',   few: 'машинки',   many: 'машинок',    acc: 'машинку' },
    '🎈': { g: 'm', one: 'шарик',     few: 'шарика',    many: 'шариков',    acc: 'шарик' },
    '🍄': { g: 'm', one: 'грибок',    few: 'грибка',    many: 'грибков',    acc: 'грибок' },
    '🌸': { g: 'm', one: 'цветочек',  few: 'цветочка',  many: 'цветочков',  acc: 'цветочек' },
    '🍬': { g: 'f', one: 'конфета',   few: 'конфеты',   many: 'конфет',     acc: 'конфету' },
    '🐦': { g: 'f', one: 'птичка',    few: 'птички',    many: 'птичек',     acc: 'птичку' },
    '✏️': { g: 'm', one: 'карандаш',  few: 'карандаша', many: 'карандашей', acc: 'карандаш' }
  };

  /* имена детей: именительный, родительный («у Маши»), род */
  var NAMES = [
    { nom: 'Маша', gen: 'Маши', fem: true },
    { nom: 'Ваня', gen: 'Вани', fem: false },
    { nom: 'Оля',  gen: 'Оли',  fem: true },
    { nom: 'Петя', gen: 'Пети', fem: false },
    { nom: 'Катя', gen: 'Кати', fem: true },
    { nom: 'Дима', gen: 'Димы', fem: false }
  ];

  /* ------------------------------------------------------------------ *
   * Мелкие утилиты
   * ------------------------------------------------------------------ */

  function ri(a, b) {                       /* целое из [a, b] */
    if (b < a) b = a;
    return a + Math.floor(Math.random() * (b - a + 1));
  }

  function pick(arr) { return arr[ri(0, arr.length - 1)]; }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = ri(0, i), t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function num(v, def, min) {
    v = Math.floor(Number(v));
    if (!isFinite(v)) v = def;
    if (v < min) v = min;
    return v;
  }

  /* Числительные словами: 0..100, с согласованием по роду (одна/одно/две). */
  var W = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь',
    'восемь', 'девять', 'десять', 'одиннадцать', 'двенадцать', 'тринадцать',
    'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать',
    'девятнадцать', 'двадцать'];

  var T = {
    20: 'двадцать', 30: 'тридцать', 40: 'сорок', 50: 'пятьдесят',
    60: 'шестьдесят', 70: 'семьдесят', 80: 'восемьдесят', 90: 'девяносто'
  };

  function numWord(n, g, acc) {
    n = Math.round(Number(n));
    if (!isFinite(n) || n < 0 || n > 100) return String(n);
    var r = n % 10;
    if (n === 100) return 'сто';
    if (n > 20) {
      var t = T[Math.floor(n / 10) * 10];
      return r ? t + ' ' + numWord(r, g, acc) : t;
    }
    /* «одна машинка», но «подарил одну машинку» */
    if (n === 1) return g === 'f' ? (acc ? 'одну' : 'одна') : (g === 'n' ? 'одно' : 'один');
    if (n === 2) return g === 'f' ? 'две' : 'два';
    return W[n];
  }

  /* форма существительного при числительном n */
  function nounForm(n, key, acc) {
    var it = NOUN[key], n10 = n % 10, n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return acc ? it.acc : it.one;
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return it.few;
    return it.many;
  }

  /* «3 яблока» либо «три яблока» (words = true — для озвучки) */
  function ph(n, key, words, acc) {
    var s = words ? numWord(n, NOUN[key].g, acc) : String(n);
    return s + ' ' + nounForm(n, key, acc);
  }

  /* Глагол прошедшего времени перед числительным.
     При 1 он согласуется с существительным: «была 1 машинка», «был 1 шарик»,
     «было 1 яблоко»; при остальных числах — средний род: «было 5 яблок». */
  function vb(n, key, stem) {
    var n10 = n % 10;
    if (n10 === 1 && n % 100 !== 11) {
      var g = NOUN[key].g;
      return stem + (g === 'f' ? 'а' : (g === 'n' ? 'о' : ''));
    }
    return stem + 'о';
  }

  /**
   * Варианты ответа: верные значения + «похожие» соседи.
   * answers — массив обязательных значений (обычно один элемент).
   * Соседи берутся от answers[0] расширяющимися кольцами ±1, ±2, ±3…
   * Если диапазон узкий — добор детерминированный, слева направо.
   */
  function nearOptions(answers, lo, hi, total) {
    var out = [], i, v;
    for (i = 0; i < answers.length; i++) {
      if (out.indexOf(answers[i]) < 0) out.push(answers[i]);
    }
    var base = answers[0];
    for (var d = 1; d <= 40 && out.length < total; d++) {
      var pair = Math.random() < 0.5 ? [base - d, base + d] : [base + d, base - d];
      for (i = 0; i < 2 && out.length < total; i++) {
        v = pair[i];
        if (v >= lo && v <= hi && out.indexOf(v) < 0) out.push(v);
      }
    }
    for (v = lo; v <= hi && out.length < total; v++) {
      if (out.indexOf(v) < 0) out.push(v);
    }
    return shuffle(out);
  }

  /* ------------------------------------------------------------------ *
   * Генераторы
   * ------------------------------------------------------------------ */

  /* «Сколько яблок?» — показать n предметов, выбрать число */
  function countItems(o) {
    o = o || {};
    var max = num(o.max, 5, 1);
    var items = (o.emoji && NOUN[o.emoji]) ? o.emoji : pick(ITEMS);
    var n = ri(1, max);
    return {
      kind: 'count',
      items: items,
      n: n,
      options: nearOptions([n], 0, max + 2, 4),
      answer: n,
      skill: 'count:' + n,
      prompt: 'Сколько?',
      speak: 'Сколько ' + NOUN[items].many + '?'
    };
  }

  /* «Найди цифру 7» — неверные варианты берём из карты путаницы (6/9, 1/7, 3/8) */
  var CONFUSE = {
    0: [6, 9, 8], 1: [7, 4, 9], 2: [5, 7, 3], 3: [8, 5, 2], 4: [1, 9, 7],
    5: [2, 3, 6], 6: [9, 0, 8], 7: [1, 2, 4], 8: [3, 0, 6], 9: [6, 0, 4]
  };

  function digitId(o) {
    o = o || {};
    var max = Math.min(9, num(o.max, 9, 1));
    var hi = Math.min(9, max + 2);
    var d = ri(0, max);
    var opts = [d], c = CONFUSE[d] || [];
    for (var i = 0; i < c.length && opts.length < 4; i++) {
      if (c[i] >= 0 && c[i] <= hi && opts.indexOf(c[i]) < 0) opts.push(c[i]);
    }
    return {
      kind: 'digitId',
      digit: d,
      options: opts.length < 4 ? nearOptions(opts, 0, hi, 4) : shuffle(opts),
      answer: d,
      skill: 'digit:' + d,
      prompt: 'Найди цифру ' + d,
      speak: 'Найди цифру ' + numWord(d, 'm')
    };
  }

  /* Сравнение: слева a, справа b; ответ — один из '<', '>', '=' */
  function compare(o) {
    o = o || {};
    var max = num(o.max, 10, 1);
    var visual = (o.visual === undefined) ? (max <= 10) : !!o.visual;
    var items = (o.emoji && NOUN[o.emoji]) ? o.emoji : pick(ITEMS);
    var a = ri(1, max), b = a;
    if (Math.random() >= 0.2) {           /* ~20% заданий на знак «=» */
      for (var i = 0; i < TRIES; i++) {
        b = ri(1, max);
        if (b !== a) break;
      }
      if (b === a) b = (a < max) ? a + 1 : Math.max(1, a - 1);
    }
    var ans = a < b ? '<' : (a > b ? '>' : '=');
    return {
      kind: 'compare',
      a: a, b: b,
      visual: visual,
      items: items,
      options: ['<', '>', '='],
      answer: ans,
      skill: 'compare:' + max,
      prompt: a === b ? 'Какой знак поставить?' : 'Что больше?',
      speak: 'Сравни: ' + numWord(a, 'm') + ' и ' + numWord(b, 'm')
    };
  }

  /* Числовой ряд: 5 чисел, шаг 1, ровно holes пропусков (null).
     holes = 1 → answer число; holes > 1 → answer массив пропущенных
     значений слева направо. Вариантов всегда 4. */
  function numberLine(o) {
    o = o || {};
    var max = num(o.max, 10, 5);
    var holes = Math.min(3, num(o.holes, 1, 1));
    var start = ri(1, max - 4);
    var seq = [], vals = [], answers = [], i;
    for (i = 0; i < 5; i++) vals.push(start + i);
    var idx = shuffle([0, 1, 2, 3, 4]).slice(0, holes)
      .sort(function (x, y) { return x - y; });
    for (i = 0; i < 5; i++) seq.push(idx.indexOf(i) >= 0 ? null : vals[i]);
    for (i = 0; i < idx.length; i++) answers.push(vals[idx[i]]);
    return {
      kind: 'numberLine',
      seq: seq,
      options: nearOptions(answers, 0, max + 2, 4),
      answer: holes === 1 ? answers[0] : answers,
      skill: 'line:' + max,
      prompt: holes === 1 ? 'Какое число пропущено?' : 'Какие числа пропущены?',
      speak: holes === 1 ? 'Какое число пропущено?' : 'Какие числа пропущены?'
    };
  }

  /* Расставить по порядку. Числа берём из узкого окна — так задание
     тренирует сравнение, а не сортировку случайного мусора. */
  function order(o) {
    o = o || {};
    var max = num(o.max, 10, 2);
    var count = Math.min(num(o.count, 4, 2), 6, max);
    var win = Math.min(max, count * 3);
    var base = ri(1, max - win + 1);
    var pool = [];
    for (var v = 0; v < win; v++) pool.push(base + v);
    var values = shuffle(pool).slice(0, count);
    var answer = values.slice().sort(function (x, y) { return x - y; });
    return {
      kind: 'order',
      values: values,
      answer: answer,
      skill: 'order:' + max,
      prompt: 'Расставь по порядку',
      speak: 'Расставь числа по порядку от меньшего к большему'
    };
  }

  /* Сложение: сумма не больше max, оба слагаемых ≥ 1 */
  function add(o) {
    o = o || {};
    var max = num(o.max, 5, 2);
    var visual = (o.visual === undefined) ? (max <= 10) : !!o.visual;
    var items = (o.emoji && NOUN[o.emoji]) ? o.emoji : pick(ITEMS);
    var a = 1, b = 1;
    for (var i = 0; i < TRIES; i++) {
      a = ri(1, max - 1);
      b = ri(1, max - a);
      if (a >= 1 && b >= 1 && a + b <= max) break;
      a = 1; b = 1;                       /* запасной детерминированный вариант */
    }
    var s = a + b;
    return {
      kind: 'add',
      a: a, b: b,
      visual: visual,
      items: items,
      options: nearOptions([s], 0, max + 2, 4),
      answer: s,
      skill: 'add:' + max,
      prompt: a + ' + ' + b + ' = ?',
      speak: cap(numWord(a, 'm')) + ' плюс ' + numWord(b, 'm')
    };
  }

  /* Вычитание: a ≥ b, результат неотрицательный */
  function sub(o) {
    o = o || {};
    var max = num(o.max, 5, 2);
    var visual = (o.visual === undefined) ? (max <= 10) : !!o.visual;
    var items = (o.emoji && NOUN[o.emoji]) ? o.emoji : pick(ITEMS);
    var a = 2, b = 1;
    for (var i = 0; i < TRIES; i++) {
      a = ri(2, max);
      b = ri(1, a);
      if (a <= max && b >= 1 && a >= b) break;
      a = 2; b = 1;
    }
    var r = a - b;
    return {
      kind: 'sub',
      a: a, b: b,
      visual: visual,
      items: items,
      options: nearOptions([r], 0, max + 2, 4),
      answer: r,
      skill: 'sub:' + max,
      prompt: a + ' − ' + b + ' = ?',
      speak: cap(numWord(a, 'm')) + ' минус ' + numWord(b, 'm')
    };
  }

  /* --- сюжеты текстовых задач: по 8 на сложение и на вычитание --------- *
   * t(name, a, b, w) — w = true собирает тот же текст числами-словами
   * для озвучки. Формы слов согласованы по роду и падежу.               */

  function f(name) { return name.fem ? 'а' : ''; }

  var ADD_STORIES = [
    { e: '🍎', t: function (n, a, b, w) { return 'У ' + n.gen + ' ' + vb(a, '🍎', 'был') + ' ' + ph(a, '🍎', w) + '. Мама дала ещё ' + ph(b, '🍎', w, true) + '. Сколько яблок стало?'; } },
    { e: '🚗', t: function (n, a, b, w) { return 'У ' + n.gen + ' ' + vb(a, '🚗', 'был') + ' ' + ph(a, '🚗', w) + '. Папа купил ещё ' + ph(b, '🚗', w, true) + '. Сколько машинок стало?'; } },
    { e: '🎈', t: function (n, a, b, w) { return 'У ' + n.gen + ' ' + vb(a, '🎈', 'был') + ' ' + ph(a, '🎈', w) + '. Друзья принесли ещё ' + ph(b, '🎈', w, true) + '. Сколько шариков стало?'; } },
    { e: '🐟', t: function (n, a, b, w) { return 'В аквариуме ' + vb(a, '🐟', 'плавал') + ' ' + ph(a, '🐟', w) + '. ' + n.nom + ' пустил' + f(n) + ' туда ещё ' + ph(b, '🐟', w, true) + '. Сколько рыбок стало?'; } },
    { e: '🌸', t: function (n, a, b, w) { return n.nom + ' сорвал' + f(n) + ' ' + ph(a, '🌸', w, true) + '. Мама дала ещё ' + ph(b, '🌸', w, true) + '. Сколько цветочков стало?'; } },
    { e: '🍬', t: function (n, a, b, w) { return 'В вазе ' + vb(a, '🍬', 'лежал') + ' ' + ph(a, '🍬', w) + '. Бабушка положила ещё ' + ph(b, '🍬', w, true) + '. Сколько конфет стало?'; } },
    { e: '🐦', t: function (n, a, b, w) { return 'На ветке ' + vb(a, '🐦', 'сидел') + ' ' + ph(a, '🐦', w) + ', а на кормушке ' + ph(b, '🐦', w) + '. Сколько птичек всего?'; } },
    { e: '✏️', t: function (n, a, b, w) { return 'В коробке ' + vb(a, '✏️', 'был') + ' ' + ph(a, '✏️', w) + '. ' + n.nom + ' положил' + f(n) + ' ещё ' + ph(b, '✏️', w, true) + '. Сколько карандашей стало?'; } }
  ];

  var SUB_STORIES = [
    { e: '🍎', t: function (n, a, b, w) { return 'У ' + n.gen + ' ' + vb(a, '🍎', 'был') + ' ' + ph(a, '🍎', w) + '. ' + n.nom + ' съел' + f(n) + ' ' + ph(b, '🍎', w, true) + '. Сколько яблок осталось?'; } },
    { e: '🚗', t: function (n, a, b, w) { return 'У ' + n.gen + ' ' + vb(a, '🚗', 'был') + ' ' + ph(a, '🚗', w) + '. ' + n.nom + ' подарил' + f(n) + ' другу ' + ph(b, '🚗', w, true) + '. Сколько машинок осталось?'; } },
    { e: '🎈', t: function (n, a, b, w) { return 'У ' + n.gen + ' ' + vb(a, '🎈', 'был') + ' ' + ph(a, '🎈', w) + '. ' + n.nom + ' отдал' + f(n) + ' малышам ' + ph(b, '🎈', w, true) + '. Сколько шариков осталось?'; } },
    { e: '🐟', t: function (n, a, b, w) { return 'В аквариуме ' + vb(a, '🐟', 'был') + ' ' + ph(a, '🐟', w) + '. ' + n.nom + ' пересадил' + f(n) + ' в другой ' + ph(b, '🐟', w, true) + '. Сколько рыбок осталось?'; } },
    { e: '🌸', t: function (n, a, b, w) { return 'В вазе ' + vb(a, '🌸', 'стоял') + ' ' + ph(a, '🌸', w) + '. ' + n.nom + ' подарил' + f(n) + ' маме ' + ph(b, '🌸', w, true) + '. Сколько цветочков осталось?'; } },
    { e: '🍬', t: function (n, a, b, w) { return 'В вазе ' + vb(a, '🍬', 'лежал') + ' ' + ph(a, '🍬', w) + '. ' + n.nom + ' взял' + f(n) + ' ' + ph(b, '🍬', w, true) + '. Сколько конфет осталось?'; } },
    { e: '🐦', t: function (n, a, b, w) { return 'На ветке ' + vb(a, '🐦', 'сидел') + ' ' + ph(a, '🐦', w) + '. Кот спугнул ' + ph(b, '🐦', w, true) + '. Сколько птичек осталось?'; } },
    { e: '✏️', t: function (n, a, b, w) { return 'В коробке ' + vb(a, '✏️', 'был') + ' ' + ph(a, '✏️', w) + '. ' + n.nom + ' взял' + f(n) + ' на урок ' + ph(b, '✏️', w, true) + '. Сколько карандашей осталось?'; } }
  ];

  /* Текстовая задача. text — с цифрами (для показа), speak — тот же текст,
     но числа словами (для озвучки). */
  function problem(o) {
    o = o || {};
    var max = num(o.max, 10, 3);
    var op = (o.op === 'sub' || o.op === 'add') ? o.op
      : (Math.random() < 0.5 ? 'add' : 'sub');
    var name = pick(NAMES);
    var st = pick(op === 'add' ? ADD_STORIES : SUB_STORIES);
    var a, b, i;
    if (op === 'add') {
      a = 1; b = 1;
      for (i = 0; i < TRIES; i++) {
        a = ri(1, max - 1);
        b = ri(1, max - a);
        if (a + b <= max) break;
        a = 1; b = 1;
      }
    } else {
      a = 2; b = 1;
      for (i = 0; i < TRIES; i++) {
        a = ri(2, max);
        b = ri(1, a - 1);
        if (a >= b && a - b >= 0) break;
        a = 2; b = 1;
      }
    }
    var answer = op === 'add' ? a + b : a - b;
    return {
      kind: 'problem',
      op: op,
      a: a, b: b,
      items: st.e,
      text: st.t(name, a, b, false),
      options: nearOptions([answer], 0, max + 2, 4),
      answer: answer,
      skill: 'problem:' + op,
      prompt: 'Реши задачу',
      speak: st.t(name, a, b, true)
    };
  }

  global.MathGen = {
    countItems: countItems,
    digitId: digitId,
    compare: compare,
    numberLine: numberLine,
    order: order,
    add: add,
    sub: sub,
    problem: problem,
    ITEMS: ITEMS
  };
})(window);
