/* =========================================================
   data/curriculum.js — учебная программа обоих блоков.
   Юнит = небольшой набор навыков + типы заданий для них.
   Порядок открытия задаётся полем requires.
   ========================================================= */
(function (global) {
  'use strict';

  /* Буквы по шагам изучения (order из data/alphabet.js) */
  function lettersUpTo(n) {
    return Alphabet.LETTERS.slice().sort(function (a, b) { return a.order - b.order; })
      .slice(0, n).map(function (l) { return l.ch; });
  }
  function lettersRange(from, to) {
    return Alphabet.LETTERS.slice().sort(function (a, b) { return a.order - b.order; })
      .filter(function (l) { return l.order > from && l.order <= to; })
      .map(function (l) { return l.ch; });
  }

  function skills(prefix, list) {
    return list.map(function (x) { return prefix + ':' + x; });
  }

  /* Опечатка в данных не должна ронять всё приложение */
  function typeOf(ch) {
    var L = Alphabet.byChar(ch);
    return L ? L.type : '';
  }

  /**
   * Слоги: согласная + гласная, обе уже изученные.
   * Орфографически невозможные сочетания исключаем — иначе ребёнок
   * заучит написание ШЫ вопреки правилу «жи-ши».
   */
  function allowedPair(c, v) {
    if ('ЖШЦ'.indexOf(c) > -1 && 'ЫЯЮ'.indexOf(v) > -1) return false;
    if ('ЧЩ'.indexOf(c) > -1 && 'ЫЯЮ'.indexOf(v) > -1) return false;
    return true;
  }

  function syllablesFor(letters) {
    var vowels = letters.filter(function (ch) { return typeOf(ch) === 'vowel'; });
    var cons = letters.filter(function (ch) { return typeOf(ch) === 'consonant'; });
    var out = [];
    cons.forEach(function (c) {
      vowels.forEach(function (v) { if (allowedPair(c, v)) out.push(c + v); });
    });
    return out;
  }

  /** Выбрать слоги так, чтобы каждая согласная была представлена. */
  function spreadSyllables(list, limit) {
    var byCons = {};
    list.forEach(function (s) { (byCons[s[0]] = byCons[s[0]] || []).push(s); });
    var keys = Object.keys(byCons), out = [], round = 0;
    while (out.length < limit && round < 12) {
      var added = false;
      keys.forEach(function (k) {
        if (byCons[k][round] && out.length < limit) { out.push(byCons[k][round]); added = true; }
      });
      if (!added) break;
      round++;
    }
    return out;
  }

  function wordsOfLevel(lvl) {
    return Words.byLevel(lvl).map(function (w) { return w.w; });
  }

  function range(a, b) {
    var out = [];
    for (var i = a; i <= b; i++) out.push(i);
    return out;
  }

  /* ------------------------------------------------------
     ЧТЕНИЕ И ПИСЬМО
     ------------------------------------------------------ */
  var L1 = lettersUpTo(6);                 // А М О У С Х
  var L2 = lettersRange(6, 13);            // Ш Р Ы Л Н К Т
  var L3 = lettersRange(13, 21);           // И П З В Д Б Г Ж
  var L4 = lettersRange(21, 33);           // Й Е Ё Я Ю Ч Ц Ф Э Щ Ь Ъ

  var READING = [
    {
      id: 'r-let-1', section: 'letters', title: 'Первые буквы', emoji: '🅰️',
      desc: 'А, М, О, У, С, Х',
      skills: skills('letter', L1).concat(skills('sound', L1)),
      types: ['findLetter', 'whichSound', 'firstLetter'],
      requires: []
    },
    {
      id: 'r-wr-1', section: 'writeLetters', title: 'Пишем буквы', emoji: '✍️',
      desc: 'Учимся писать А, М, О, У, С, Х',
      skills: skills('write', L1),
      types: ['writeLetter'],
      requires: ['r-let-1']
    },
    {
      id: 'r-syl-1', section: 'syllables', title: 'Первые слоги', emoji: '🔤',
      desc: 'МА, МО, МУ, СА…',
      skills: skills('syllable', syllablesFor(L1)),
      types: ['readSyllable', 'buildSyllable'],
      requires: ['r-let-1']
    },
    {
      id: 'r-wd-1', section: 'words', title: 'Первые слова', emoji: '📗',
      desc: 'МАМА, СОМ, ОСА…',
      skills: skills('word', wordsOfLevel(1)),
      types: ['buildWord', 'missingLetter', 'readWord'],
      requires: ['r-syl-1']
    },
    {
      id: 'r-let-2', section: 'letters', title: 'Новые буквы', emoji: '🔠',
      desc: 'Ш, Р, Ы, Л, Н, К, Т',
      skills: skills('letter', L2).concat(skills('sound', L2)),
      types: ['findLetter', 'whichSound', 'firstLetter'],
      requires: ['r-wd-1']
    },
    {
      id: 'r-wr-2', section: 'writeLetters', title: 'Пишем дальше', emoji: '✏️',
      desc: 'Ш, Р, Ы, Л, Н, К, Т',
      skills: skills('write', L2),
      types: ['writeLetter'],
      requires: ['r-let-2']
    },
    {
      id: 'r-syl-2', section: 'syllables', title: 'Больше слогов', emoji: '🧩',
      desc: 'ША, РО, ЛУ, КИ…',
      skills: skills('syllable', spreadSyllables(syllablesFor(L1.concat(L2)), 28)),
      types: ['readSyllable', 'buildSyllable'],
      requires: ['r-let-2']
    },
    {
      id: 'r-wd-2', section: 'words', title: 'Читаем слова', emoji: '📘',
      desc: 'КОТ, ШАР, ЛУНА…',
      skills: skills('word', wordsOfLevel(2).slice(0, 18)),
      types: ['buildWord', 'missingLetter', 'readWord', 'extraLetter'],
      requires: ['r-syl-2']
    },
    {
      id: 'r-let-3', section: 'letters', title: 'Ещё буквы', emoji: '🔡',
      desc: 'И, П, З, В, Д, Б, Г, Ж',
      skills: skills('letter', L3).concat(skills('sound', L3)),
      types: ['findLetter', 'whichSound', 'firstLetter'],
      requires: ['r-wd-2']
    },
    {
      id: 'r-wr-3', section: 'writeLetters', title: 'Пишем красиво', emoji: '🖊️',
      desc: 'И, П, З, В, Д, Б, Г, Ж',
      skills: skills('write', L3),
      types: ['writeLetter'],
      requires: ['r-let-3']
    },
    {
      id: 'r-wd-3', section: 'words', title: 'Новые слова', emoji: '📙',
      desc: 'ДОМ, ПАПА, РЫБА…',
      skills: skills('word', wordsOfLevel(3).slice(0, 18)),
      types: ['buildWord', 'missingLetter', 'readWord', 'extraLetter'],
      requires: ['r-let-3']
    },
    {
      id: 'r-sent-1', section: 'sentences', title: 'Первые предложения', emoji: '💬',
      desc: 'МАМА ДОМА.',
      skills: Sentences.byLevel(1).map(function (s) { return 'sentence:' + s.id; }),
      types: ['buildSentence'],
      requires: ['r-wd-3']
    },
    /* L4 разбит на три юнита: йотированные, шипящие и знаки — это три
       разные темы, в одном уроке их давать нельзя */
    {
      id: 'r-let-4', section: 'letters', title: 'Хитрые буквы', emoji: '🎵',
      desc: 'Й, Е, Ё, Я, Ю',
      skills: skills('letter', lettersRange(21, 26))
        .concat(skills('sound', lettersRange(21, 26))),
      types: ['findLetter', 'whichSound', 'firstLetter'],
      requires: ['r-sent-1']
    },
    {
      id: 'r-let-5', section: 'letters', title: 'Шипящие буквы', emoji: '🐍',
      desc: 'Ч, Ц, Ф, Э, Щ',
      skills: skills('letter', lettersRange(26, 31))
        .concat(skills('sound', lettersRange(26, 31))),
      types: ['findLetter', 'whichSound', 'firstLetter'],
      requires: ['r-let-4']
    },
    {
      id: 'r-let-6', section: 'letters', title: 'Буквы без звука', emoji: '🤫',
      desc: 'Ь и Ъ ничего не говорят',
      skills: skills('letter', lettersRange(31, 33)),
      types: ['findLetter'],
      requires: ['r-let-5']
    },
    {
      id: 'r-wd-4', section: 'words', title: 'Длинные слова', emoji: '📚',
      desc: 'Слова со всеми буквами',
      skills: skills('word', wordsOfLevel(4).slice(0, 16)),
      types: ['buildWord', 'missingLetter', 'readWord', 'extraLetter'],
      requires: ['r-let-6']
    },
    {
      id: 'r-sent-2', section: 'sentences', title: 'Читаем предложения', emoji: '📖',
      desc: 'Собираем фразы из слов',
      skills: Sentences.byLevel(2).concat(Sentences.byLevel(3))
        .map(function (s) { return 'sentence:' + s.id; }),
      types: ['buildSentence'],
      requires: ['r-wd-4']
    }
  ];

  /* ------------------------------------------------------
     МАТЕМАТИКА
     ------------------------------------------------------ */
  var MATH = [
    {
      id: 'm-dig-1', section: 'digits', title: 'Цифры 0–5', emoji: '5️⃣',
      desc: 'Знакомимся с цифрами',
      skills: skills('digit', range(0, 5)),
      types: ['digitId', 'matchCount'],
      requires: []
    },
    {
      id: 'm-cnt-1', section: 'count', title: 'Считаем до 5', emoji: '🍎',
      desc: 'Сколько предметов?',
      skills: skills('count', range(1, 5)),
      types: ['countItems', 'matchCount'],
      requires: ['m-dig-1']
    },
    {
      id: 'm-wr-1', section: 'writeDigits', title: 'Пишем цифры', emoji: '✍️',
      desc: '0, 1, 2, 3, 4, 5',
      skills: skills('writeNum', range(0, 5)),
      types: ['writeDigit'],
      requires: ['m-dig-1']
    },
    {
      id: 'm-cmp-1', section: 'compare', title: 'Больше и меньше', emoji: '⚖️',
      desc: 'Сравниваем предметы',
      skills: ['compare:5'],
      types: ['compareVisual'],
      requires: ['m-cnt-1']
    },
    {
      id: 'm-add-1', section: 'add', title: 'Сложение до 5', emoji: '➕',
      desc: '2 + 1 = ?',
      skills: ['add:5'],
      types: ['addVisual'],
      requires: ['m-cnt-1']
    },
    {
      id: 'm-sub-1', section: 'sub', title: 'Вычитание до 5', emoji: '➖',
      desc: '4 − 2 = ?',
      skills: ['sub:5'],
      types: ['subVisual'],
      requires: ['m-add-1']
    },
    {
      id: 'm-dig-2', section: 'digits', title: 'Цифры 6–9', emoji: '9️⃣',
      desc: 'Все цифры',
      skills: skills('digit', range(6, 9)),
      types: ['digitId', 'matchCount'],
      requires: ['m-sub-1']
    },
    {
      id: 'm-cnt-2', section: 'count', title: 'Считаем до 10', emoji: '🔟',
      desc: 'Больше предметов',
      skills: skills('count', range(6, 10)),
      types: ['countItems', 'matchCount'],
      requires: ['m-dig-2']
    },
    {
      id: 'm-wr-2', section: 'writeDigits', title: 'Пишем 6–9', emoji: '🖊️',
      desc: '6, 7, 8, 9',
      skills: skills('writeNum', range(6, 9)),
      types: ['writeDigit'],
      requires: ['m-dig-2']
    },
    {
      id: 'm-line-1', section: 'line', title: 'Числовой ряд', emoji: '📏',
      desc: '1 2 3 _ 5',
      skills: ['line:10', 'order:10'],
      types: ['numberLine', 'orderNumbers'],
      requires: ['m-cnt-2']
    },
    {
      id: 'm-cmp-2', section: 'compare', title: 'Сравнение чисел', emoji: '🔣',
      desc: 'Уже без картинок',
      skills: ['compare:10'],
      types: ['compareNumbers'],
      requires: ['m-line-1']
    },
    {
      id: 'm-add-2', section: 'add', title: 'Сложение до 10', emoji: '➕',
      desc: '5 + 4 = ?',
      skills: ['add:10'],
      types: ['addNumbers'],
      requires: ['m-cnt-2']
    },
    {
      id: 'm-sub-2', section: 'sub', title: 'Вычитание до 10', emoji: '➖',
      desc: '9 − 3 = ?',
      skills: ['sub:10'],
      types: ['subNumbers'],
      requires: ['m-add-2']
    },
    {
      id: 'm-prob-1', section: 'problems', title: 'Задачи', emoji: '🧠',
      desc: 'У Маши было 3 яблока…',
      skills: ['problem:add', 'problem:sub'],
      types: ['problem'],
      requires: ['m-sub-2']
    },
    {
      id: 'm-cnt-3', section: 'count', title: 'Числа до 20', emoji: '🎯',
      desc: 'Считаем дальше',
      skills: skills('count', range(11, 20)),
      types: ['countItems', 'numberLine20'],
      requires: ['m-prob-1']
    },
    {
      id: 'm-add-3', section: 'add', title: 'Сложение до 20', emoji: '🚀',
      desc: 'Самое сложное',
      skills: ['add:20', 'sub:20'],
      types: ['addNumbers20', 'subNumbers20'],
      requires: ['m-cnt-3']
    }
  ];

  READING.forEach(function (u) { u.track = 'reading'; });
  MATH.forEach(function (u) { u.track = 'math'; });

  var ALL = READING.concat(MATH);

  /* Названия разделов — для экрана прогресса и родителя */
  var SECTIONS = {
    letters:      { title: 'Буквы',            emoji: '🔠', track: 'reading' },
    syllables:    { title: 'Слоги',            emoji: '🔤', track: 'reading' },
    words:        { title: 'Чтение слов',      emoji: '📗', track: 'reading' },
    sentences:    { title: 'Предложения',      emoji: '💬', track: 'reading' },
    writeLetters: { title: 'Письмо букв',      emoji: '✍️', track: 'reading' },
    digits:       { title: 'Цифры',            emoji: '🔢', track: 'math' },
    count:        { title: 'Счёт',             emoji: '🍎', track: 'math' },
    compare:      { title: 'Сравнение',        emoji: '⚖️', track: 'math' },
    add:          { title: 'Сложение',         emoji: '➕', track: 'math' },
    sub:          { title: 'Вычитание',        emoji: '➖', track: 'math' },
    problems:     { title: 'Задачи',           emoji: '🧠', track: 'math' },
    line:         { title: 'Числовой ряд',     emoji: '📏', track: 'math' },
    writeDigits:  { title: 'Письмо цифр',      emoji: '✏️', track: 'math' }
  };

  var Curriculum = {
    READING: READING,
    MATH: MATH,
    ALL: ALL,
    SECTIONS: SECTIONS,

    byTrack: function (t) { return t === 'math' ? MATH : READING; },
    byId: function (id) {
      for (var i = 0; i < ALL.length; i++) if (ALL[i].id === id) return ALL[i];
      return null;
    },

    /** Юнит открыт, если пройдены все требуемые. */
    isOpen: function (id) {
      var u = Curriculum.byId(id);
      if (!u) return false;
      return u.requires.every(function (r) { return Store.unit(r).done; });
    },

    /** Следующий непройденный открытый юнит блока. */
    next: function (track) {
      var list = Curriculum.byTrack(track);
      for (var i = 0; i < list.length; i++) {
        if (!Store.unit(list[i].id).done && Curriculum.isOpen(list[i].id)) return list[i];
      }
      // всё пройдено — возвращаем последний для повторения
      for (var j = 0; j < list.length; j++) {
        if (Curriculum.isOpen(list[j].id)) var last = list[j];
      }
      return last || list[0];
    },

    /** Все навыки раздела. */
    sectionSkills: function (section) {
      var out = [];
      ALL.forEach(function (u) {
        if (u.section === section) out = out.concat(u.skills);
      });
      return out;
    },

    /** Прогресс блока в процентах по пройденным юнитам. */
    trackPercent: function (track) {
      var list = Curriculum.byTrack(track);
      var done = list.filter(function (u) { return Store.unit(u.id).done; }).length;
      return Math.round(done / list.length * 100);
    },

    trackStars: function (track) {
      return Curriculum.byTrack(track).reduce(function (a, u) {
        return a + (Store.unit(u.id).stars || 0);
      }, 0);
    },

    trackLevel: function (track) {
      var list = Curriculum.byTrack(track);
      var done = list.filter(function (u) { return Store.unit(u.id).done; }).length;
      return done + 1;
    },

    /** Все навыки блока — для подбора повторения. */
    trackSkills: function (track) {
      var out = [];
      Curriculum.byTrack(track).forEach(function (u) { out = out.concat(u.skills); });
      return out;
    }
  };

  global.Curriculum = Curriculum;

})(window);
