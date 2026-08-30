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

  /* ------------------------------------------------------
     🚀 КОСМОС — «Моя космическая экспедиция»
     Прогрессия: от знакомого (Земля) к далёкому (полёт).
     ------------------------------------------------------ */
  var SPACE = [
    { id: 's-earth', section: 'spBasics', title: 'Земля', emoji: '🌍',
      desc: 'Наш дом. День и ночь',
      skills: ['sp:earth', 'sp:daynight'], types: ['dayNight', 'spQuiz'], requires: [] },
    { id: 's-moon', section: 'spBasics', title: 'Луна', emoji: '🌙',
      desc: 'Спутница Земли и её фазы',
      skills: ['sp:moon', 'sp:moonphases'], types: ['spQuiz', 'moonOrder'], requires: ['s-earth'] },
    { id: 's-sun', section: 'spBasics', title: 'Солнце', emoji: '☀️',
      desc: 'Наша звезда',
      skills: ['sp:sun'], types: ['spQuiz'], requires: ['s-moon'] },
    { id: 's-planets-1', section: 'spPlanets', title: 'Соседи Земли', emoji: '🔴',
      desc: 'Меркурий, Венера, Марс',
      skills: ['spp:mercury', 'spp:venus', 'spp:mars'], types: ['spQuiz', 'findPlanet'], requires: ['s-sun'] },
    { id: 's-planets-2', section: 'spPlanets', title: 'Планеты-великаны', emoji: '🪐',
      desc: 'Юпитер, Сатурн, Уран, Нептун',
      skills: ['spp:jupiter', 'spp:saturn', 'spp:uranus', 'spp:neptune'],
      types: ['spQuiz', 'findPlanet'], requires: ['s-planets-1'] },
    { id: 's-order', section: 'spPlanets', title: 'Парад планет', emoji: '🎡',
      desc: 'Расставь планеты от Солнца',
      skills: ['sp:planets', 'sp:order'], types: ['planetOrder', 'spQuiz', 'findPlanet'], requires: ['s-planets-2'] },
    { id: 's-stars', section: 'spStars', title: 'Звёзды', emoji: '⭐',
      desc: 'Созвездия ночного неба',
      skills: ['sp:stars', 'spc:dipper', 'spc:cassiopeia', 'spc:orion'],
      types: ['spQuiz', 'connectStars'], requires: ['s-order'] },
    { id: 's-cosmo', section: 'spFlight', title: 'Космонавты', emoji: '🧑‍🚀',
      desc: 'Скафандр и жизнь в космосе',
      skills: ['sp:cosmonaut'], types: ['spQuiz', 'buildCosmonaut'], requires: ['s-stars'] },
    { id: 's-rocket', section: 'spFlight', title: 'Ракета', emoji: '🚀',
      desc: 'Готовимся к старту!',
      skills: ['sp:rocket'], types: ['spQuiz', 'rocketLaunch'], requires: ['s-cosmo'] },
    { id: 's-final', section: 'spFlight', title: 'Большая миссия', emoji: '🏆',
      desc: 'Всё, чему ты научился!', size: 8,
      skills: ['sp:daynight', 'sp:moonphases', 'sp:planets', 'sp:cosmonaut', 'spc:dipper', 'sp:rocket'],
      types: ['dayNight', 'moonOrder', 'planetOrder', 'buildCosmonaut', 'connectStars', 'rocketLaunch', 'spQuiz'],
      requires: ['s-rocket'] }
  ];

  /* ------------------------------------------------------
     🎒 ПОДГОТОВКА К ШКОЛЕ — «Готов к первому классу»
     ------------------------------------------------------ */
  var SCHOOL = [
    { id: 'sch-read-1', section: 'schoolRead', title: 'Класс чтения', emoji: '📖',
      desc: 'Читаю и понимаю',
      skills: ['rc:1', 'ps:1'], types: ['schReading', 'schPicSentence'], requires: [] },
    { id: 'sch-read-2', section: 'schoolRead', title: 'Понимаю текст', emoji: '📚',
      desc: 'Тексты подлиннее',
      skills: ['rc:2', 'rc:3', 'fs:1'], types: ['schReading', 'schFinishSentence'], requires: ['sch-read-1'] },
    { id: 'sch-write-1', section: 'schoolWrite', title: 'Класс письма', emoji: '✍️',
      desc: 'Буквы и хитрюшки',
      skills: ['ml:1', 'typo:1'], types: ['schMissingLetter', 'schFindTypo'], requires: [] },
    { id: 'sch-write-2', section: 'schoolWrite', title: 'Собираю фразы', emoji: '🧩',
      desc: 'Предложения из слов',
      skills: ['ml:2', 'sb:1', 'sb:2'], types: ['schMissingLetter', 'schSentenceBuild'], requires: ['sch-write-1'] },
    { id: 'sch-math-1', section: 'schoolMath', title: 'Соседи чисел', emoji: '🏘️',
      desc: 'Кто перед, кто после',
      skills: ['nb:easy', 'nb:hard'], types: ['schNeighbors'], requires: [] },
    { id: 'sch-math-2', section: 'schoolMath', title: 'Домики чисел', emoji: '🏠',
      desc: 'Состав чисел 4–7',
      skills: ['bond:4', 'bond:5', 'bond:6', 'bond:7'], types: ['schBonds'], requires: ['sch-math-1'] },
    { id: 'sch-math-3', section: 'schoolMath', title: 'Домик десятки', emoji: '🔟',
      desc: 'Состав 8–10 и задачи',
      skills: ['bond:8', 'bond:9', 'bond:10', 'wp:1'], types: ['schBonds', 'schProblem'], requires: ['sch-math-2'] },
    { id: 'sch-logic-1', section: 'schoolLogic', title: 'Лаборатория логики', emoji: '🧠',
      desc: 'Ряды, лишнее, сравнение',
      skills: ['pat:1', 'odd:1', 'cmpq:1'], types: ['schPattern', 'schOddOne', 'schCompare'], requires: [] },
    { id: 'sch-logic-2', section: 'schoolLogic', title: 'Логика-профи', emoji: '🎓',
      desc: 'Хитрые закономерности',
      skills: ['pat:2', 'pat:3', 'odd:2', 'wp:2'], types: ['schPattern', 'schOddOne', 'schProblem'],
      requires: ['sch-logic-1', 'sch-math-1'] },
    { id: 'sch-attn-1', section: 'schoolAttn', title: 'Тренировка внимания', emoji: '👀',
      desc: 'Что исчезло? Найди буквы!',
      skills: ['wg:1', 'fl:1'], types: ['schWhatGone', 'schFindLetter'], requires: [] },
    { id: 'sch-attn-2', section: 'schoolAttn', title: 'Зоркий глаз', emoji: '🔍',
      desc: 'Буквы-обманки и команды',
      skills: ['fl:2', 'fl:3', 'instr:1'], types: ['schFindLetter', 'schInstruction'], requires: ['sch-attn-1'] },
    { id: 'sch-mem-1', section: 'schoolMem', title: 'Комната памяти', emoji: '💭',
      desc: 'Цвета, слова и цифры',
      skills: ['mc:1', 'mw:1', 'md:1'], types: ['schMemoColors', 'schMemoWords', 'schMemoDigits'], requires: [] },
    { id: 'sch-speech-1', section: 'schoolSpeech', title: 'Класс речи', emoji: '🗣️',
      desc: 'Наоборот и по порядку',
      skills: ['opp:1', 'opp:2', 'fs:2', 'story:1'], types: ['schOpposite', 'schFinishSentence', 'schStoryOrder'], requires: [] },
    { id: 'sch-instr-1', section: 'schoolInstr', title: 'Слушай и делай', emoji: '🎯',
      desc: 'Инструкции из двух шагов',
      skills: ['instr:2', 'instr:3', 'instr:4'], types: ['schInstruction'], requires: ['sch-attn-2'] },
    { id: 'sch-final', section: 'schoolFinal', title: 'Проверка суперсил', emoji: '🏫',
      desc: 'Большая школьная миссия!', size: 10,
      skills: ['rc:3', 'ml:2', 'bond:10', 'pat:3', 'wg:1', 'instr:2', 'opp:2', 'wp:3'],
      types: ['schReading', 'schMissingLetter', 'schBonds', 'schPattern', 'schWhatGone', 'schInstruction', 'schOpposite', 'schProblem'],
      requires: ['sch-read-2', 'sch-write-2', 'sch-math-3', 'sch-logic-2',
                 'sch-attn-2', 'sch-mem-1', 'sch-speech-1', 'sch-instr-1'] }
  ];

  /* Скрытые юниты режима «Школьный день» (в списках не показываются) */
  var SCHOOLDAY = [
    { id: 'sd-1', section: 'schoolRead', title: 'Урок чтения', emoji: '📖', size: 4,
      skills: ['rc:1', 'ps:1', 'fs:1', 'opp:1'],
      types: ['schReading', 'schPicSentence', 'schFinishSentence', 'schOpposite'], requires: [] },
    { id: 'sd-2', section: 'schoolWrite', title: 'Урок письма', emoji: '✍️', size: 4,
      skills: ['ml:1', 'typo:1', 'sb:1'],
      types: ['schMissingLetter', 'schFindTypo', 'schSentenceBuild'], requires: [] },
    { id: 'sd-3', section: 'schoolMath', title: 'Урок математики', emoji: '🔢', size: 4,
      skills: ['nb:easy', 'bond:5', 'bond:7', 'wp:1'],
      types: ['schNeighbors', 'schBonds', 'schProblem'], requires: [] },
    { id: 'sd-4', section: 'schoolLogic', title: 'Урок Знайки', emoji: '🧠', size: 5,
      skills: ['pat:1', 'odd:1', 'cmpq:1', 'instr:1', 'story:1'],
      types: ['schPattern', 'schOddOne', 'schCompare', 'schInstruction', 'schStoryOrder'], requires: [] }
  ];

  /* ------------------------------------------------------
     🌍 МОЙ МИР — окружающий мир
     ------------------------------------------------------ */
  function animalSkills(from, to) {
    return WorldData.ANIMALS.slice(from, to).map(function (a) { return 'wa:' + a.name; });
  }
  var WORLD = [
    { id: 'w-animals-1', section: 'wAnimals', title: 'Зверята рядом', emoji: '🐶',
      desc: 'Домашние и дикие',
      skills: animalSkills(0, 12).concat(['w:babies', 'w:odd']),
      types: ['wAnimalQuiz', 'wBabies', 'wOdd'], requires: [] },
    { id: 'w-animals-2', section: 'wAnimals', title: 'Далёкие звери', emoji: '🐬',
      desc: 'Море, небо и насекомые',
      skills: animalSkills(12, 24).concat(['w:odd']),
      types: ['wAnimalQuiz', 'wOdd'], requires: ['w-animals-1'] },
    { id: 'w-nature', section: 'wNature', title: 'Природа и сезоны', emoji: '🌳',
      desc: 'Времена года и циклы',
      skills: ['w:season', 'w:plantcycle', 'w:butterfly'],
      types: ['wSeason', 'wCycle'], requires: [] },
    { id: 'w-weather', section: 'wWeather', title: 'Погода', emoji: '🌦️',
      desc: 'Как одеться? Что дальше?',
      skills: ['w:dress', 'w:wlogic'], types: ['wDress', 'wWeatherLogic'], requires: ['w-nature'] },
    { id: 'w-body', section: 'wBody', title: 'Моё тело', emoji: '🧍',
      desc: 'Пять чувств и привычки',
      skills: ['w:sense', 'w:bodypairs', 'w:habits'], types: ['wSense', 'wBodyPairs'], requires: [] },
    { id: 'w-planet', section: 'wPlanet', title: 'Наша планета', emoji: '🌎',
      desc: 'Кто где живёт',
      skills: ['w:zone'], types: ['wZone'], requires: ['w-nature'] },
    { id: 'w-countries', section: 'wCountries', title: 'Путешествия', emoji: '🗺️',
      desc: '7 стран мира',
      skills: WorldData.COUNTRIES.map(function (c) { return 'wc:' + c.id; }).concat(['w:countries']),
      types: ['wCountryQuiz'], requires: ['w-planet'] },
    { id: 'w-jobs', section: 'wJobs', title: 'Профессии', emoji: '👩‍🚒',
      desc: 'Кто что делает',
      skills: ['w:jobs', 'w:jobtools'], types: ['wJobQuiz', 'wJobTools'], requires: [] },
    { id: 'w-transport', section: 'wTransport', title: 'Транспорт', emoji: '🚗',
      desc: 'Земля, вода, небо',
      skills: ['w:transport', 'w:trodd'], types: ['wTransportQuiz', 'wTransportOdd'], requires: [] },
    { id: 'w-city', section: 'wCity', title: 'Мой город', emoji: '🏠',
      desc: 'Куда идти в городе',
      skills: ['w:city'], types: ['wCityQuiz'], requires: ['w-transport'] },
    { id: 'w-science', section: 'wScience', title: 'Маленький исследователь', emoji: '🧪',
      desc: 'Безопасные опыты',
      skills: ['w:float', 'w:magnet', 'w:shadow', 'w:states', 'w:whatif'],
      types: ['wFloat', 'wMagnet', 'wShadow', 'wStates', 'wWhatIf'], requires: ['w-weather'] },
    { id: 'w-final', section: 'wFinal', title: 'Большое путешествие', emoji: '🏆',
      desc: 'Всё про наш мир!', size: 10,
      skills: ['w:odd', 'w:season', 'w:dress', 'w:zone', 'w:countries', 'w:jobs', 'w:transport', 'w:whatif'],
      types: ['wOdd', 'wSeason', 'wDress', 'wZone', 'wCountryQuiz', 'wJobQuiz', 'wTransportQuiz', 'wWhatIf'],
      requires: ['w-animals-2', 'w-countries', 'w-science', 'w-jobs', 'w-transport'] }
  ];

  READING.forEach(function (u) { u.track = 'reading'; });
  MATH.forEach(function (u) { u.track = 'math'; });
  SPACE.forEach(function (u) { u.track = 'space'; });
  SCHOOL.forEach(function (u) { u.track = 'school'; });
  SCHOOLDAY.forEach(function (u) { u.track = 'schoolday'; });
  WORLD.forEach(function (u) { u.track = 'world'; });

  var ALL = READING.concat(MATH, SPACE, SCHOOL, SCHOOLDAY, WORLD);

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
    writeDigits:  { title: 'Письмо цифр',      emoji: '✏️', track: 'math' },

    spBasics:     { title: 'Земля и небо',     emoji: '🌍', track: 'space' },
    spPlanets:    { title: 'Планеты',          emoji: '🪐', track: 'space' },
    spStars:      { title: 'Звёзды',           emoji: '⭐', track: 'space' },
    spFlight:     { title: 'Полёт',            emoji: '🚀', track: 'space' },

    schoolRead:   { title: 'Чтение с пониманием', emoji: '📖', track: 'school' },
    schoolWrite:  { title: 'Правописание',     emoji: '✍️', track: 'school' },
    schoolMath:   { title: 'Мат. готовность',  emoji: '🔢', track: 'school' },
    schoolLogic:  { title: 'Логика',           emoji: '🧠', track: 'school' },
    schoolAttn:   { title: 'Внимание',         emoji: '👀', track: 'school' },
    schoolMem:    { title: 'Память',           emoji: '💭', track: 'school' },
    schoolSpeech: { title: 'Речь',             emoji: '🗣️', track: 'school' },
    schoolInstr:  { title: 'Инструкции',       emoji: '🎯', track: 'school' },
    schoolFinal:  { title: 'Финал',            emoji: '🏫', track: 'school' },

    wAnimals:     { title: 'Животные',         emoji: '🐾', track: 'world' },
    wNature:      { title: 'Природа',          emoji: '🌳', track: 'world' },
    wWeather:     { title: 'Погода',           emoji: '🌦️', track: 'world' },
    wBody:        { title: 'Моё тело',         emoji: '🧍', track: 'world' },
    wPlanet:      { title: 'Планета',          emoji: '🌎', track: 'world' },
    wCountries:   { title: 'Страны',           emoji: '🗺️', track: 'world' },
    wJobs:        { title: 'Профессии',        emoji: '🛠️', track: 'world' },
    wTransport:   { title: 'Транспорт',        emoji: '🚗', track: 'world' },
    wCity:        { title: 'Город',            emoji: '🏠', track: 'world' },
    wScience:     { title: 'Опыты',            emoji: '🧪', track: 'world' },
    wFinal:       { title: 'Финал',            emoji: '🏆', track: 'world' }
  };

  /* Пять миров главного экрана (schoolday — служебный, скрыт) */
  var TRACKS = {
    reading:   { title: 'Читаем и пишем', ico: '📚', theme: 't-read',   list: READING },
    math:      { title: 'Математика',     ico: '🔢', theme: 't-math',   list: MATH },
    space:     { title: 'Космос',         ico: '🚀', theme: 't-space',  list: SPACE },
    school:    { title: 'Скоро в школу',  ico: '🎒', theme: 't-school', list: SCHOOL },
    world:     { title: 'Мой мир',        ico: '🌍', theme: 't-world',  list: WORLD },
    schoolday: { title: 'Школьный день',  ico: '🏫', theme: 't-school', list: SCHOOLDAY, hidden: true }
  };

  var Curriculum = {
    READING: READING,
    MATH: MATH,
    SPACE: SPACE,
    SCHOOL: SCHOOL,
    SCHOOLDAY: SCHOOLDAY,
    WORLD: WORLD,
    ALL: ALL,
    SECTIONS: SECTIONS,
    TRACKS: TRACKS,
    TRACK_ORDER: ['reading', 'math', 'space', 'school', 'world'],

    byTrack: function (t) { return (TRACKS[t] || TRACKS.reading).list; },
    trackMeta: function (t) { return TRACKS[t] || TRACKS.reading; },
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

    /** Все навыки раздела (без дублей: юниты «Школьного дня»
        повторяют навыки обычных юнитов). */
    sectionSkills: function (section) {
      var out = [];
      ALL.forEach(function (u) {
        if (u.section !== section) return;
        u.skills.forEach(function (id) {
          if (out.indexOf(id) === -1) out.push(id);
        });
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
