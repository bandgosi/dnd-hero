/* data/words.js — словарь для чтения, разбит по уровням сложности.
 *
 * Порядок изучения букв (номер = шаг обучения):
 *   А1 М2 О3 У4 С5 Х6 Ш7 Р8 Ы9 Л10 Н11 К12 Т13 И14 П15 З16 В17 Д18
 *   Б19 Г20 Ж21 Й22 Е23 Ё24 Я25 Ю26 Ч27 Ц28 Ф29 Э30 Щ31 Ь32 Ъ33
 *
 * Слово уровня N состоит только из букв, изученных к концу уровня N:
 *   1 → order ≤ 6   (А М О У С Х)
 *   2 → order ≤ 13  (+ Ш Р Ы Л Н К Т)
 *   3 → order ≤ 21  (+ И П З В Д Б Г Ж)
 *   4 → вся азбука
 * Проверяется скриптом test/agent-words/validate.js.
 */
(function (global) {
  'use strict';

  var WORDS = [
    { w: 'МАМА', syllables: ['МА', 'МА'], emoji: '👩', level: 1, letters: ['М', 'А', 'М', 'А'] },
    { w: 'МУХА', syllables: ['МУ', 'ХА'], emoji: '🪰', level: 1, letters: ['М', 'У', 'Х', 'А'] },
    { w: 'ОСА', syllables: ['О', 'СА'], emoji: '🐝', level: 1, letters: ['О', 'С', 'А'] },
    { w: 'УХО', syllables: ['У', 'ХО'], emoji: '👂', level: 1, letters: ['У', 'Х', 'О'] },
    { w: 'УС', syllables: ['УС'], emoji: '🥸', level: 1, letters: ['У', 'С'] },
    { w: 'СОМ', syllables: ['СОМ'], emoji: '🐟', level: 1, letters: ['С', 'О', 'М'] },
    { w: 'МОХ', syllables: ['МОХ'], emoji: '🌿', level: 1, letters: ['М', 'О', 'Х'] },
    { w: 'УХА', syllables: ['У', 'ХА'], emoji: '🥘', level: 1, letters: ['У', 'Х', 'А'] },
    { w: 'КОТ', syllables: ['КОТ'], emoji: '🐱', level: 2, letters: ['К', 'О', 'Т'] },
    { w: 'МАК', syllables: ['МАК'], emoji: '🌺', level: 2, letters: ['М', 'А', 'К'] },
    { w: 'ШАР', syllables: ['ШАР'], emoji: '🎈', level: 2, letters: ['Ш', 'А', 'Р'] },
    { w: 'СЫН', syllables: ['СЫН'], emoji: '🧒', level: 2, letters: ['С', 'Ы', 'Н'] },
    { w: 'ЛУНА', syllables: ['ЛУ', 'НА'], emoji: '🌙', level: 2, letters: ['Л', 'У', 'Н', 'А'] },
    { w: 'РУКА', syllables: ['РУ', 'КА'], emoji: '✋', level: 2, letters: ['Р', 'У', 'К', 'А'] },
    { w: 'НОС', syllables: ['НОС'], emoji: '👃', level: 2, letters: ['Н', 'О', 'С'] },
    { w: 'СЫР', syllables: ['СЫР'], emoji: '🧀', level: 2, letters: ['С', 'Ы', 'Р'] },
    { w: 'ЛУК', syllables: ['ЛУК'], emoji: '🧅', level: 2, letters: ['Л', 'У', 'К'] },
    { w: 'РАК', syllables: ['РАК'], emoji: '🦀', level: 2, letters: ['Р', 'А', 'К'] },
    { w: 'СОК', syllables: ['СОК'], emoji: '🧃', level: 2, letters: ['С', 'О', 'К'] },
    { w: 'РОТ', syllables: ['РОТ'], emoji: '👄', level: 2, letters: ['Р', 'О', 'Т'] },
    { w: 'КУСТ', syllables: ['КУСТ'], emoji: '🪴', level: 2, letters: ['К', 'У', 'С', 'Т'] },
    { w: 'МОСТ', syllables: ['МОСТ'], emoji: '🌉', level: 2, letters: ['М', 'О', 'С', 'Т'] },
    { w: 'ТОРТ', syllables: ['ТОРТ'], emoji: '🎂', level: 2, letters: ['Т', 'О', 'Р', 'Т'] },
    { w: 'ХОЛМ', syllables: ['ХОЛМ'], emoji: '⛰️', level: 2, letters: ['Х', 'О', 'Л', 'М'] },
    { w: 'КРАН', syllables: ['КРАН'], emoji: '🚰', level: 2, letters: ['К', 'Р', 'А', 'Н'] },
    { w: 'СТУЛ', syllables: ['СТУЛ'], emoji: '🪑', level: 2, letters: ['С', 'Т', 'У', 'Л'] },
    { w: 'СЛОН', syllables: ['СЛОН'], emoji: '🐘', level: 2, letters: ['С', 'Л', 'О', 'Н'] },
    { w: 'КАША', syllables: ['КА', 'ША'], emoji: '🍚', level: 2, letters: ['К', 'А', 'Ш', 'А'] },
    { w: 'КУКЛА', syllables: ['КУК', 'ЛА'], emoji: '🪆', level: 2, letters: ['К', 'У', 'К', 'Л', 'А'] },
    { w: 'КОШКА', syllables: ['КОШ', 'КА'], emoji: '🐈', level: 2, letters: ['К', 'О', 'Ш', 'К', 'А'] },
    { w: 'МЫШКА', syllables: ['МЫШ', 'КА'], emoji: '🐭', level: 2, letters: ['М', 'Ы', 'Ш', 'К', 'А'] },
    { w: 'КРЫСА', syllables: ['КРЫ', 'СА'], emoji: '🐀', level: 2, letters: ['К', 'Р', 'Ы', 'С', 'А'] },
    { w: 'КРЫША', syllables: ['КРЫ', 'ША'], emoji: '🏠', level: 2, letters: ['К', 'Р', 'Ы', 'Ш', 'А'] },
    { w: 'МЫЛО', syllables: ['МЫ', 'ЛО'], emoji: '🧼', level: 2, letters: ['М', 'Ы', 'Л', 'О'] },
    { w: 'ЛАМА', syllables: ['ЛА', 'МА'], emoji: '🦙', level: 2, letters: ['Л', 'А', 'М', 'А'] },
    { w: 'УТКА', syllables: ['УТ', 'КА'], emoji: '🦆', level: 2, letters: ['У', 'Т', 'К', 'А'] },
    { w: 'СУМКА', syllables: ['СУМ', 'КА'], emoji: '👜', level: 2, letters: ['С', 'У', 'М', 'К', 'А'] },
    { w: 'МАСКА', syllables: ['МАС', 'КА'], emoji: '😷', level: 2, letters: ['М', 'А', 'С', 'К', 'А'] },
    { w: 'КАРТА', syllables: ['КАР', 'ТА'], emoji: '🗺️', level: 2, letters: ['К', 'А', 'Р', 'Т', 'А'] },
    { w: 'НОТА', syllables: ['НО', 'ТА'], emoji: '🎵', level: 2, letters: ['Н', 'О', 'Т', 'А'] },
    { w: 'САЛАТ', syllables: ['СА', 'ЛАТ'], emoji: '🥗', level: 2, letters: ['С', 'А', 'Л', 'А', 'Т'] },
    { w: 'САХАР', syllables: ['СА', 'ХАР'], emoji: '🍬', level: 2, letters: ['С', 'А', 'Х', 'А', 'Р'] },
    { w: 'ШКОЛА', syllables: ['ШКО', 'ЛА'], emoji: '🏫', level: 2, letters: ['Ш', 'К', 'О', 'Л', 'А'] },
    { w: 'МАЛЫШ', syllables: ['МА', 'ЛЫШ'], emoji: '👶', level: 2, letters: ['М', 'А', 'Л', 'Ы', 'Ш'] },
    { w: 'ДОМ', syllables: ['ДОМ'], emoji: '🏡', level: 3, letters: ['Д', 'О', 'М'] },
    { w: 'ПАПА', syllables: ['ПА', 'ПА'], emoji: '👨', level: 3, letters: ['П', 'А', 'П', 'А'] },
    { w: 'РЫБА', syllables: ['РЫ', 'БА'], emoji: '🐠', level: 3, letters: ['Р', 'Ы', 'Б', 'А'] },
    { w: 'ЗУБ', syllables: ['ЗУБ'], emoji: '🦷', level: 3, letters: ['З', 'У', 'Б'] },
    { w: 'ВОДА', syllables: ['ВО', 'ДА'], emoji: '💧', level: 3, letters: ['В', 'О', 'Д', 'А'] },
    { w: 'ЛИСА', syllables: ['ЛИ', 'СА'], emoji: '🦊', level: 3, letters: ['Л', 'И', 'С', 'А'] },
    { w: 'ЗИМА', syllables: ['ЗИ', 'МА'], emoji: '❄️', level: 3, letters: ['З', 'И', 'М', 'А'] },
    { w: 'ГРИБ', syllables: ['ГРИБ'], emoji: '🍄', level: 3, letters: ['Г', 'Р', 'И', 'Б'] },
    { w: 'ЖУК', syllables: ['ЖУК'], emoji: '🪲', level: 3, letters: ['Ж', 'У', 'К'] },
    { w: 'ЛИСТ', syllables: ['ЛИСТ'], emoji: '🍃', level: 3, letters: ['Л', 'И', 'С', 'Т'] },
    { w: 'ТИГР', syllables: ['ТИГР'], emoji: '🐯', level: 3, letters: ['Т', 'И', 'Г', 'Р'] },
    { w: 'ЗОНТ', syllables: ['ЗОНТ'], emoji: '☂️', level: 3, letters: ['З', 'О', 'Н', 'Т'] },
    { w: 'ЛАПА', syllables: ['ЛА', 'ПА'], emoji: '🐾', level: 3, letters: ['Л', 'А', 'П', 'А'] },
    { w: 'НОЖ', syllables: ['НОЖ'], emoji: '🔪', level: 3, letters: ['Н', 'О', 'Ж'] },
    { w: 'СУП', syllables: ['СУП'], emoji: '🍲', level: 3, letters: ['С', 'У', 'П'] },
    { w: 'КНИГА', syllables: ['КНИ', 'ГА'], emoji: '📖', level: 3, letters: ['К', 'Н', 'И', 'Г', 'А'] },
    { w: 'ЛОЖКА', syllables: ['ЛОЖ', 'КА'], emoji: '🥄', level: 3, letters: ['Л', 'О', 'Ж', 'К', 'А'] },
    { w: 'ВИЛКА', syllables: ['ВИЛ', 'КА'], emoji: '🍴', level: 3, letters: ['В', 'И', 'Л', 'К', 'А'] },
    { w: 'ПАЛКА', syllables: ['ПАЛ', 'КА'], emoji: '🪵', level: 3, letters: ['П', 'А', 'Л', 'К', 'А'] },
    { w: 'ШАПКА', syllables: ['ШАП', 'КА'], emoji: '🧢', level: 3, letters: ['Ш', 'А', 'П', 'К', 'А'] },
    { w: 'САПОГ', syllables: ['СА', 'ПОГ'], emoji: '👢', level: 3, letters: ['С', 'А', 'П', 'О', 'Г'] },
    { w: 'ДЫМ', syllables: ['ДЫМ'], emoji: '💨', level: 3, letters: ['Д', 'Ы', 'М'] },
    { w: 'ЗАМОК', syllables: ['ЗА', 'МОК'], emoji: '🏰', level: 3, letters: ['З', 'А', 'М', 'О', 'К'] },
    { w: 'ПИЛА', syllables: ['ПИ', 'ЛА'], emoji: '🪚', level: 3, letters: ['П', 'И', 'Л', 'А'] },
    { w: 'БАНАН', syllables: ['БА', 'НАН'], emoji: '🍌', level: 3, letters: ['Б', 'А', 'Н', 'А', 'Н'] },
    { w: 'ГРУША', syllables: ['ГРУ', 'ША'], emoji: '🍐', level: 3, letters: ['Г', 'Р', 'У', 'Ш', 'А'] },
    { w: 'ТЫКВА', syllables: ['ТЫК', 'ВА'], emoji: '🎃', level: 3, letters: ['Т', 'Ы', 'К', 'В', 'А'] },
    { w: 'ЛИМОН', syllables: ['ЛИ', 'МОН'], emoji: '🍋', level: 3, letters: ['Л', 'И', 'М', 'О', 'Н'] },
    { w: 'АРБУЗ', syllables: ['АР', 'БУЗ'], emoji: '🍉', level: 3, letters: ['А', 'Р', 'Б', 'У', 'З'] },
    { w: 'ВОЛК', syllables: ['ВОЛК'], emoji: '🐺', level: 3, letters: ['В', 'О', 'Л', 'К'] },
    { w: 'КОЗА', syllables: ['КО', 'ЗА'], emoji: '🐐', level: 3, letters: ['К', 'О', 'З', 'А'] },
    { w: 'СОБАКА', syllables: ['СО', 'БА', 'КА'], emoji: '🐕', level: 3, letters: ['С', 'О', 'Б', 'А', 'К', 'А'] },
    { w: 'ПАУК', syllables: ['ПА', 'УК'], emoji: '🕷️', level: 3, letters: ['П', 'А', 'У', 'К'] },
    { w: 'УЛИТКА', syllables: ['У', 'ЛИТ', 'КА'], emoji: '🐌', level: 3, letters: ['У', 'Л', 'И', 'Т', 'К', 'А'] },
    { w: 'МАШИНА', syllables: ['МА', 'ШИ', 'НА'], emoji: '🚗', level: 3, letters: ['М', 'А', 'Ш', 'И', 'Н', 'А'] },
    { w: 'ГУСЬ', syllables: ['ГУСЬ'], emoji: '🪿', level: 4, letters: ['Г', 'У', 'С', 'Ь'] },
    { w: 'МЯЧ', syllables: ['МЯЧ'], emoji: '⚽', level: 4, letters: ['М', 'Я', 'Ч'] },
    { w: 'ЁЖ', syllables: ['ЁЖ'], emoji: '🦔', level: 4, letters: ['Ё', 'Ж'] },
    { w: 'ЛЕВ', syllables: ['ЛЕВ'], emoji: '🦁', level: 4, letters: ['Л', 'Е', 'В'] },
    { w: 'ЗАЯЦ', syllables: ['ЗА', 'ЯЦ'], emoji: '🐰', level: 4, letters: ['З', 'А', 'Я', 'Ц'] },
    { w: 'ЯБЛОКО', syllables: ['ЯБ', 'ЛО', 'КО'], emoji: '🍎', level: 4, letters: ['Я', 'Б', 'Л', 'О', 'К', 'О'] },
    { w: 'ЦВЕТОК', syllables: ['ЦВЕ', 'ТОК'], emoji: '🌸', level: 4, letters: ['Ц', 'В', 'Е', 'Т', 'О', 'К'] },
    { w: 'ХЛЕБ', syllables: ['ХЛЕБ'], emoji: '🍞', level: 4, letters: ['Х', 'Л', 'Е', 'Б'] },
    { w: 'ЗВЕЗДА', syllables: ['ЗВЕЗ', 'ДА'], emoji: '⭐', level: 4, letters: ['З', 'В', 'Е', 'З', 'Д', 'А'] },
    { w: 'ДЕРЕВО', syllables: ['ДЕ', 'РЕ', 'ВО'], emoji: '🌳', level: 4, letters: ['Д', 'Е', 'Р', 'Е', 'В', 'О'] },
    { w: 'ПЕТУХ', syllables: ['ПЕ', 'ТУХ'], emoji: '🐓', level: 4, letters: ['П', 'Е', 'Т', 'У', 'Х'] },
    { w: 'ЖИРАФ', syllables: ['ЖИ', 'РАФ'], emoji: '🦒', level: 4, letters: ['Ж', 'И', 'Р', 'А', 'Ф'] },
    { w: 'ЧАШКА', syllables: ['ЧАШ', 'КА'], emoji: '☕', level: 4, letters: ['Ч', 'А', 'Ш', 'К', 'А'] },
    { w: 'ЩЕНОК', syllables: ['ЩЕ', 'НОК'], emoji: '🐶', level: 4, letters: ['Щ', 'Е', 'Н', 'О', 'К'] },
    { w: 'ЯГОДА', syllables: ['Я', 'ГО', 'ДА'], emoji: '🍓', level: 4, letters: ['Я', 'Г', 'О', 'Д', 'А'] },
    { w: 'СНЕГОВИК', syllables: ['СНЕ', 'ГО', 'ВИК'], emoji: '⛄', level: 4, letters: ['С', 'Н', 'Е', 'Г', 'О', 'В', 'И', 'К'] },
    { w: 'ОГУРЕЦ', syllables: ['О', 'ГУ', 'РЕЦ'], emoji: '🥒', level: 4, letters: ['О', 'Г', 'У', 'Р', 'Е', 'Ц'] },
    { w: 'ЯЙЦО', syllables: ['ЯЙ', 'ЦО'], emoji: '🥚', level: 4, letters: ['Я', 'Й', 'Ц', 'О'] },
    { w: 'ЮЛА', syllables: ['Ю', 'ЛА'], emoji: '🪀', level: 4, letters: ['Ю', 'Л', 'А'] },
    { w: 'ЁЛКА', syllables: ['ЁЛ', 'КА'], emoji: '🎄', level: 4, letters: ['Ё', 'Л', 'К', 'А'] },
    { w: 'КЛЮЧ', syllables: ['КЛЮЧ'], emoji: '🔑', level: 4, letters: ['К', 'Л', 'Ю', 'Ч'] },
    { w: 'ЧАЙНИК', syllables: ['ЧАЙ', 'НИК'], emoji: '🫖', level: 4, letters: ['Ч', 'А', 'Й', 'Н', 'И', 'К'] }
  ];

  function byLevel(lvl) {
    return WORDS.filter(function (x) { return x.level === lvl; });
  }
  function upToLevel(lvl) {
    return WORDS.filter(function (x) { return x.level <= lvl; });
  }

  global.Words = {
    WORDS: WORDS,

    byLevel: byLevel,
    upToLevel: upToLevel,

    byLength: function (n) {
      return WORDS.filter(function (x) { return x.w.length === n; });
    },

    find: function (w) {
      var key = String(w || '').toUpperCase();
      for (var i = 0; i < WORDS.length; i++) if (WORDS[i].w === key) return WORDS[i];
      return null;
    },

    random: function (lvl) {
      var pool = (lvl == null) ? WORDS : byLevel(lvl);
      if (!pool.length) return null;
      return pool[Math.floor(Math.random() * pool.length)];
    }
  };
})(window);
