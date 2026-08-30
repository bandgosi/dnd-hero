/* =========================================================
   data/school.js — контент мира «🎒 Готов к первому классу».
   Программа спроектирована агентами: учитель начальных
   классов + архитектор контента + гейм-дизайнер.

   Правила учителя (нарушать нельзя):
   — тексты для чтения ЗАГЛАВНЫМИ буквами;
   — никаких таймеров в чтении/письме/задачах;
   — после 2-й ошибки показать правильный ответ;
   — правильное написание слова всегда показывается после
     «слова-хитрюшки» — ошибочный образ не остаётся последним;
   — состав числа без нуля; память ≤5 цветов и ≤4 цифр;
   — оценок нет, только звёзды; «двоек» не бывает.
   ========================================================= */
(function (global) {
  'use strict';

  /* ---------- 1.1 Мини-тексты с вопросом ---------- */
  var READING = [
    { text: 'У МАМЫ КОТ.', q: 'Кто живёт у мамы?', options: ['кот', 'пёс', 'кит'], correct: 0, band: 1 },
    { text: 'ВОТ ДОМ. ДОМ БОЛЬШОЙ.', q: 'Какой дом?', options: ['большой', 'маленький', 'синий'], correct: 0, band: 1 },
    { text: 'У АНИ ШАР. ШАР СИНИЙ.', q: 'Какого цвета шар у Ани?', options: ['синий', 'красный', 'жёлтый'], correct: 0, band: 1 },
    { text: 'САША ЕСТ СУП. СУП ГОРЯЧИЙ.', q: 'Что ест Саша?', options: ['суп', 'кашу', 'хлеб'], correct: 0, band: 1 },
    { text: 'У ДИМЫ ПЁС. ЕГО ЗОВУТ ШАРИК.', q: 'Как зовут пса?', options: ['Шарик', 'Бобик', 'Дима'], correct: 0, band: 1 },
    { text: 'МАМА КУПИЛА СЫР. КОТ ОЧЕНЬ РАД.', q: 'Что купила мама?', options: ['сыр', 'рыбу', 'молоко'], correct: 0, band: 2 },
    { text: 'ЛИСА ЖИВЁТ В ЛЕСУ. ОНА РЫЖАЯ.', q: 'Где живёт лиса?', options: ['в лесу', 'в доме', 'в реке'], correct: 0, band: 2 },
    { text: 'ЗИМА. ИДЁТ СНЕГ. ДЕТИ ЛЕПЯТ СНЕГОВИКА.', q: 'Что лепят дети?', options: ['снеговика', 'куличик', 'пирог'], correct: 0, band: 2 },
    { text: 'У ВОВЫ КНИГА ПРО КОСМОС. ВОВА ЛЮБИТ ЧИТАТЬ.', q: 'Про что книга у Вовы?', options: ['про космос', 'про море', 'про зверей'], correct: 0, band: 2 },
    { text: 'ОЛЯ ПОЛИЛА ЦВЕТОК. ЦВЕТОК ВЫРОС. ОЛЯ РАДА.', q: 'Что полила Оля?', options: ['цветок', 'дерево', 'грядку'], correct: 0, band: 3 },
    { text: 'УТРОМ ПЕТЯ ЧИСТИТ ЗУБЫ. ПОТОМ ОН ЗАВТРАКАЕТ. ПОТОМ ИДЁТ ГУЛЯТЬ.', q: 'Что Петя делает сначала?', options: ['чистит зубы', 'завтракает', 'идёт гулять'], correct: 0, band: 3 },
    { text: 'НА ДУБЕ СИДИТ СОВА. НОЧЬЮ ОНА ЛЕТАЕТ. ДНЁМ ОНА СПИТ.', q: 'Когда сова спит?', options: ['днём', 'ночью', 'вечером'], correct: 0, band: 3 }
  ];

  /* ---------- 1.2 Предложение к картинке ---------- */
  var PIC_SENTENCE = [
    { scene: '🐱🥛', options: ['КОТ ПЬЁТ МОЛОКО', 'КОТ ЧИТАЕТ КНИГУ', 'МОЛОКО ЛОВИТ КОТА'], correct: 0 },
    { scene: '👧⚽', options: ['ДЕВОЧКА ИГРАЕТ В МЯЧ', 'МЯЧ ЕСТ КАШУ', 'ДЕВОЧКА СПИТ В ШКАФУ'], correct: 0 },
    { scene: '🐶🦴', options: ['ПЁС ГРЫЗЁТ КОСТЬ', 'КОСТЬ ЛАЕТ НА ПСА', 'ПЁС ВАРИТ СУП'], correct: 0 },
    { scene: '👦📖', options: ['МАЛЬЧИК ЧИТАЕТ КНИГУ', 'КНИГА ЕСТ МОРОЖЕНОЕ', 'МАЛЬЧИК ЛЕТИТ НА ЛУНУ'], correct: 0 },
    { scene: '🐦🌳', options: ['ПТИЦА СИДИТ НА ДЕРЕВЕ', 'ДЕРЕВО ЛЕТИТ ПО НЕБУ', 'ПТИЦА ВОДИТ АВТОБУС'], correct: 0 },
    { scene: '🌧️☂️👩', options: ['МАМА ИДЁТ ПОД ЗОНТОМ', 'ЗОНТ ПРЫГАЕТ ПО ЛУЖАМ', 'ДОЖДЬ ИДЁТ В ГОСТИ'], correct: 0 },
    { scene: '👵🧶🧣', options: ['БАБУШКА ВЯЖЕТ ШАРФ', 'ШАРФ ВЯЖЕТ БАБУШКУ', 'БАБУШКА КОПАЕТ ШАРФ'], correct: 0 },
    { scene: '⛄👦👧❄️', options: ['ДЕТИ ЛЕПЯТ СНЕГОВИКА', 'СНЕГОВИК ЖАРИТ КОТЛЕТЫ', 'ДЕТИ ПЛЫВУТ ПО СНЕГУ'], correct: 0 }
  ];

  /* ---------- 2.1 Вставь букву ---------- */
  var MISSING_LETTER = [
    { word: 'Д_М', hint: '🏠', options: ['О', 'А', 'У'], correct: 0, full: 'ДОМ', band: 1 },
    { word: 'К_Т', hint: '🐱', options: ['О', 'И', 'А'], correct: 0, full: 'КОТ', band: 1 },
    { word: 'К_Т', hint: '🐋', options: ['И', 'О', 'А'], correct: 0, full: 'КИТ', band: 1 },
    { word: 'ЛУ_', hint: '🧅', options: ['К', 'Г', 'Х'], correct: 0, full: 'ЛУК', band: 1 },
    { word: 'СЛО_', hint: '🐘', options: ['Н', 'М', 'Л'], correct: 0, full: 'СЛОН', band: 1 },
    { word: 'ЛИС_', hint: '🦊', options: ['А', 'О', 'У'], correct: 0, full: 'ЛИСА', band: 2 },
    { word: 'РЫ_А', hint: '🐟', options: ['Б', 'П', 'Д'], correct: 0, full: 'РЫБА', band: 2 },
    { word: 'КО_КА', hint: '🐱', options: ['Ш', 'Ж', 'С'], correct: 0, full: 'КОШКА', band: 2 },
    { word: '_КОЛА', hint: '🏫', options: ['Ш', 'Щ', 'Ж'], correct: 0, full: 'ШКОЛА', band: 2 },
    { word: 'ЁЖИ_', hint: '🦔', options: ['К', 'Г', 'Х'], correct: 0, full: 'ЁЖИК', band: 2 }
  ];

  /* ---------- 2.2 Слово-хитрюшка ---------- */
  var FIND_TYPO = [
    { words: ['ДОРОГА', 'МАШЫНА', 'КОЛЕСО'], wrongIndex: 1, correctWord: 'МАШИНА', hint: '🚗', rule: 'ЖИ-ШИ пиши с И' },
    { words: ['ЖЫРАФ', 'ЗЕБРА', 'СЛОН'], wrongIndex: 0, correctWord: 'ЖИРАФ', hint: '🦒', rule: 'ЖИ-ШИ пиши с И' },
    { words: ['ЧАШКА', 'ЧЯЙНИК', 'ЛОЖКА'], wrongIndex: 1, correctWord: 'ЧАЙНИК', hint: '🫖', rule: 'ЧА-ЩА пиши с А' },
    { words: ['ЩЮКА', 'ОКУНЬ', 'СОМ'], wrongIndex: 0, correctWord: 'ЩУКА', hint: '🐟', rule: 'ЧУ-ЩУ пиши с У' },
    { words: ['КОШКА', 'САБАКА', 'ХОМЯК'], wrongIndex: 1, correctWord: 'СОБАКА', hint: '🐕', rule: 'Словарное слово: СОБАКА' },
    { words: ['ЛИСА', 'ВОЛК', 'МИДВЕДЬ'], wrongIndex: 2, correctWord: 'МЕДВЕДЬ', hint: '🐻', rule: 'Словарное слово: МЕДВЕДЬ' },
    { words: ['ТЕЛЕФОМ', 'ПЛАНШЕТ', 'ЛАМПА'], wrongIndex: 0, correctWord: 'ТЕЛЕФОН', hint: '📱', rule: 'На конце буква Н' },
    { words: ['ЯБЛОКО', 'ГРУША', 'БАНАМ'], wrongIndex: 2, correctWord: 'БАНАН', hint: '🍌', rule: 'На конце буква Н' }
  ];

  /* ---------- 2.3 Собери предложение ---------- */
  var SENTENCE_BUILD = [
    { cards: ['МАМА', 'МОЕТ', 'РАМУ'], band: 1 },
    { cards: ['КОТ', 'ПЬЁТ', 'МОЛОКО'], band: 1 },
    { cards: ['ПАПА', 'ЧИТАЕТ', 'КНИГУ'], band: 1 },
    { cards: ['ЗИМОЙ', 'ИДЁТ', 'СНЕГ'], band: 1 },
    { cards: ['Я', 'ИДУ', 'В', 'ШКОЛУ'], band: 2 },
    { cards: ['ДЕТИ', 'ИГРАЮТ', 'В', 'МЯЧ'], band: 2 },
    { cards: ['ПТИЦА', 'ВЬЁТ', 'ГНЕЗДО'], band: 2 },
    { cards: ['У', 'МЕНЯ', 'ЕСТЬ', 'ДРУГ'], band: 2 }
  ];

  /* ---------- 3.1 Соседи числа ---------- */
  var NEIGHBORS = {
    easy: [2, 3, 5, 7],
    hard: [4, 6, 8, 9]
  };

  /* ---------- 3.2 Состав числа (домики) ---------- */
  function bondPairs(n) {
    var out = [];
    for (var a = 1; a < n; a++) out.push([a, n - a]);
    return out;
  }
  var BONDS = { min: 4, max: 10, pairs: bondPairs };

  /* ---------- 3.3 Текстовые задачи ---------- */
  var WORD_PROBLEMS = [
    { text: 'У Кати 3 яблока. Мама дала ещё 2. Сколько яблок стало?', emoji: '🍎', a: 3, b: 2, op: '+', answer: 5, band: 1 },
    { text: 'На ветке сидели 6 птичек. Две улетели. Сколько осталось?', emoji: '🐦', a: 6, b: 2, op: '-', answer: 4, band: 1 },
    { text: 'В вазе 5 тюльпанов. Поставили ещё 3. Сколько всего цветов?', emoji: '🌷', a: 5, b: 3, op: '+', answer: 8, band: 1 },
    { text: 'У Пети было 7 шариков. Три лопнули. Сколько осталось?', emoji: '🎈', a: 7, b: 3, op: '-', answer: 4, band: 1 },
    { text: 'У Ани 8 карандашей. Пять она отдала брату. Сколько осталось?', emoji: '🖍️', a: 8, b: 5, op: '-', answer: 3, band: 2 },
    { text: 'В коробке 4 машинки. Папа положил ещё 4. Сколько машинок?', emoji: '🚗', a: 4, b: 4, op: '+', answer: 8, band: 2 },
    { text: 'На тарелке было 9 морковок. Зайка съел 6. Сколько осталось?', emoji: '🥕', a: 9, b: 6, op: '-', answer: 3, band: 2 },
    { text: 'Две рыбки уплыли, и осталось 5. Сколько рыбок было сначала?', emoji: '🐟', a: 5, b: 2, op: '+', answer: 7, band: 3 }
  ];

  /* ---------- 4.1 Продолжи ряд ---------- */
  var PATTERNS = [
    { seq: ['🔴', '🔵', '🔴', '🔵', '🔴'], answer: '🔵', options: ['🔵', '🔴', '🟢'], band: 1 },
    { seq: ['🌞', '🌙', '🌞', '🌙', '🌞'], answer: '🌙', options: ['🌙', '🌞', '⭐'], band: 1 },
    { seq: ['🚗', '🚌', '🚗', '🚌', '🚗'], answer: '🚌', options: ['🚌', '🚗', '🚲'], band: 1 },
    { seq: ['🍎', '🍎', '🍐', '🍎', '🍎'], answer: '🍐', options: ['🍐', '🍎', '🍌'], band: 1 },
    { seq: ['⭐', '⭐', '🌙', '⭐', '⭐', '🌙', '⭐', '⭐'], answer: '🌙', options: ['🌙', '⭐', '☁️'], band: 2 },
    { seq: ['🚗', '🚌', '🚌', '🚗', '🚌', '🚌', '🚗'], answer: '🚌', options: ['🚌', '🚗', '✈️'], band: 2 },
    { seq: ['🍓', '🍓', '🫐', '🫐', '🍓', '🍓'], answer: '🫐', options: ['🫐', '🍓', '🍋'], band: 2 },
    { seq: ['🔺', '🟦', '⚪', '🔺', '🟦'], answer: '⚪', options: ['⚪', '🔺', '🟦'], band: 2 },
    { seq: ['🐱', '🐶', '🐭', '🐱', '🐶'], answer: '🐭', options: ['🐭', '🐱', '🐶'], band: 3 },
    { seq: ['🐟', '🐸', '🦆', '🐟', '🐸', '🦆', '🐟'], answer: '🐸', options: ['🐸', '🦆', '🐟'], band: 3 },
    { seq: ['🟡', '🟡🟡', '🟡🟡🟡'], answer: '🟡🟡🟡🟡', options: ['🟡🟡🟡🟡', '🟡🟡', '🟡'], band: 3 },
    { seq: ['1️⃣', '2️⃣', '3️⃣', '4️⃣'], answer: '5️⃣', options: ['5️⃣', '6️⃣', '3️⃣'], band: 3 }
  ];

  /* ---------- 4.2 Найди лишнее ---------- */
  var ODD_ONE = [
    { items: ['🍎', '🍌', '🍐', '🚗'], oddIndex: 3, why: 'это транспорт, а не фрукт', band: 1 },
    { items: ['🐱', '🐶', '🐭', '✈️'], oddIndex: 3, why: 'это не животное', band: 1 },
    { items: ['👕', '👖', '🧢', '🍌'], oddIndex: 3, why: 'это не одежда', band: 1 },
    { items: ['🚌', '🚗', '🚲', '🍏'], oddIndex: 3, why: 'это не транспорт', band: 1 },
    { items: ['🍽️', '🥄', '🍵', '🐸'], oddIndex: 3, why: 'это не посуда', band: 1 },
    { items: ['🍅', '🥕', '🥒', '⚽'], oddIndex: 3, why: 'это не овощ', band: 1 },
    { items: ['🪑', '🛏️', '🛋️', '🐟'], oddIndex: 3, why: 'это не мебель', band: 1 },
    { items: ['🐻', '🦊', '🐺', '🐔'], oddIndex: 3, why: 'курица домашняя, остальные дикие', band: 2 },
    { items: ['🐱', '🐶', '🐰', '🦁'], oddIndex: 3, why: 'лев дикий, остальные домашние', band: 2 },
    { items: ['🍞', '🧀', '🍎', '🧸'], oddIndex: 3, why: 'мишку не едят', band: 2 },
    { items: ['🐦', '🦋', '🐝', '🐢'], oddIndex: 3, why: 'черепаха не летает', band: 2 },
    { items: ['❄️', '⛄', '🧤', '🏖️'], oddIndex: 3, why: 'пляж — это лето', band: 2 }
  ];

  /* ---------- 4.3 Сравнения ---------- */
  var COMPARE = [
    { q: 'Кто больше?', pair: ['🐘', '🐭'], correct: 0 },
    { q: 'Кто меньше?', pair: ['🐜', '🐕'], correct: 0 },
    { q: 'Кто выше?', pair: ['🦒', '🐰'], correct: 0 },
    { q: 'Что ниже?', pair: ['🌳', '🌷'], correct: 1 },
    { q: 'Кто быстрее?', pair: ['🐢', '🐇'], correct: 1 },
    { q: 'Кто медленнее?', pair: ['🐌', '🐎'], correct: 0 },
    { q: 'Что тяжелее?', pair: ['🪶', '🪨'], correct: 1 },
    { q: 'Что горячее?', pair: ['☀️', '🧊'], correct: 0 }
  ];

  /* ---------- 5.1 Что исчезло? ---------- */
  var WHAT_GONE = [
    { items: ['🍎', '🍌', '🍇', '🍓'], gone: '🍇', extra: '🍊' },
    { items: ['🐱', '🐶', '🐰', '🦊'], gone: '🐶', extra: '🐭' },
    { items: ['🚗', '🚌', '✈️', '🚲'], gone: '✈️', extra: '🚂' },
    { items: ['⚽', '🧸', '🎈', '🪁'], gone: '🧸', extra: '🎲' },
    { items: ['🌞', '🌙', '⭐', '☁️'], gone: '⭐', extra: '🌈' },
    { items: ['👕', '🧢', '🧦', '🧤'], gone: '🧦', extra: '🧣' },
    { items: ['🥄', '🍵', '🍽️', '🫖'], gone: '🫖', extra: '🥛' },
    { items: ['🐦', '🐸', '🐟', '🦋'], gone: '🐸', extra: '🐝' },
    { items: ['✏️', '📏', '📚', '🎒'], gone: '📏', extra: '🖍️' },
    { items: ['🍞', '🧀', '🥚', '🥛'], gone: '🥚', extra: '🍯' }
  ];

  /* ---------- 5.2 Найди все буквы ---------- */
  var FIND_LETTER = [
    { letters: 'А О У А Ы А О У А И О У', target: 'А', band: 1 },
    { letters: 'М А К О А Р А Т У С А Н', target: 'А', band: 1 },
    { letters: 'А Б В А Г Д А Е Ж А З И', target: 'А', band: 1 },
    { letters: 'О А О А О О А О А О О А', target: 'А', band: 2 },
    { letters: 'Н А П А Р А С А Т А К А', target: 'А', band: 2 },
    { letters: 'Л А Д А Л Д А Л А Д Л А', target: 'А', band: 3 },
    { letters: 'А Я А Я Я А Я А Я А Я А', target: 'А', band: 3 },
    { letters: 'Ш А Щ А Ж А Ш Щ А Ж А Ш', target: 'А', band: 3 }
  ];

  /* ---------- 6.1–6.3 Память ---------- */
  var MEMO_COLORS = ['🔴', '🔵', '🟢', '🟡'];
  var MEMO_WORDS = [
    { show: [['🐱', 'КОТ'], ['🏠', 'ДОМ'], ['🎈', 'ШАР']], askIndex: 1, options: ['ДОМ', 'ЛЕС', 'МЯЧ'], correct: 0 },
    { show: [['🍎', 'ЯБЛОКО'], ['🐟', 'РЫБА'], ['🌞', 'СОЛНЦЕ']], askIndex: 1, options: ['РЫБА', 'ГРИБ', 'ЛУНА'], correct: 0 },
    { show: [['✏️', 'РУЧКА'], ['📚', 'КНИГА'], ['🎒', 'РАНЕЦ']], askIndex: 2, options: ['РАНЕЦ', 'ПАРТА', 'МЕЛ'], correct: 0 },
    { show: [['🌷', 'ЦВЕТОК'], ['🐦', 'ПТИЦА'], ['⭐', 'ЗВЕЗДА'], ['☁️', 'ТУЧА']], askIndex: 3, options: ['ТУЧА', 'ДОЖДЬ', 'ВЕТЕР'], correct: 0, hard: true }
  ];

  /* ---------- 7.1 Скажи наоборот ---------- */
  var OPPOSITES = [
    { word: 'большой', emoji: '🐘', answer: 'маленький', answerEmoji: '🐭', options: ['маленький', 'зелёный', 'круглый'] },
    { word: 'горячий', emoji: '🔥', answer: 'холодный', answerEmoji: '🧊', options: ['холодный', 'вкусный', 'яркий'] },
    { word: 'день', emoji: '🌞', answer: 'ночь', answerEmoji: '🌙', options: ['ночь', 'утро', 'обед'] },
    { word: 'быстрый', emoji: '🐇', answer: 'медленный', answerEmoji: '🐢', options: ['медленный', 'весёлый', 'сильный'] },
    { word: 'весёлый', emoji: '😀', answer: 'грустный', answerEmoji: '😢', options: ['грустный', 'высокий', 'умный'] },
    { word: 'чистый', emoji: '🧼', answer: 'грязный', answerEmoji: '🐷', options: ['грязный', 'мокрый', 'новый'] },
    { word: 'тяжёлый', emoji: '🪨', answer: 'лёгкий', answerEmoji: '🪶', options: ['лёгкий', 'твёрдый', 'большой'] },
    { word: 'мокрый', emoji: '🌧️', answer: 'сухой', answerEmoji: '☀️', options: ['сухой', 'тёплый', 'чистый'] },
    { word: 'открытый', emoji: '📖', answer: 'закрытый', answerEmoji: '📕', options: ['закрытый', 'красивый', 'старый'] },
    { word: 'добрый', emoji: '😇', answer: 'злой', answerEmoji: '😈', options: ['злой', 'смешной', 'тихий'] }
  ];

  /* ---------- 7.2 Продолжи предложение ---------- */
  var FINISH_SENTENCE = [
    { start: 'Зимой идёт…', options: ['снег', 'дождь', 'листопад'], correct: 0 },
    { start: 'Ночью на небе светит…', options: ['луна', 'солнце', 'радуга'], correct: 0 },
    { start: 'Корова даёт…', options: ['молоко', 'мёд', 'яйца'], correct: 0 },
    { start: 'Осенью с деревьев падают…', options: ['листья', 'снежинки', 'цветы'], correct: 0 },
    { start: 'Рыба живёт в…', options: ['воде', 'гнезде', 'норе'], correct: 0 },
    { start: 'Пчёлы делают…', options: ['мёд', 'молоко', 'сыр'], correct: 0 },
    { start: 'Хлеб пекут из…', options: ['муки', 'песка', 'снега'], correct: 0 },
    { start: 'Утром мы говорим…', options: ['«доброе утро»', '«спокойной ночи»', '«до свидания»'], correct: 0 },
    { start: 'Весной на деревьях появляются…', options: ['листочки', 'сугробы', 'сосульки'], correct: 0 },
    { start: 'После лета наступает…', options: ['осень', 'зима', 'весна'], correct: 0 }
  ];

  /* ---------- 7.3 Расскажи по порядку ---------- */
  var STORY_ORDER = [
    { items: [{ id: 'a', emoji: '🌰', label: 'семечко' }, { id: 'b', emoji: '🌱', label: 'росток' }, { id: 'c', emoji: '🌷', label: 'цветок' }],
      story: 'Сначала семечко, потом росток, а потом цветок!' },
    { items: [{ id: 'a', emoji: '🥚', label: 'яйцо' }, { id: 'b', emoji: '🐣', label: 'птенец' }, { id: 'c', emoji: '🐦', label: 'птица' }],
      story: 'Сначала яйцо, потом птенец, а потом птица!' },
    { items: [{ id: 'a', emoji: '☁️', label: 'тучка' }, { id: 'b', emoji: '🌧️', label: 'дождик' }, { id: 'c', emoji: '🌈', label: 'радуга' }],
      story: 'Сначала тучка, потом дождик, а потом радуга!' },
    { items: [{ id: 'a', emoji: '🌅', label: 'утро' }, { id: 'b', emoji: '🌞', label: 'день' }, { id: 'c', emoji: '🌙', label: 'ночь' }],
      story: 'Сначала утро, потом день, а потом ночь!' },
    { items: [{ id: 'a', emoji: '🐛', label: 'гусеница' }, { id: 'b', emoji: '🧵', label: 'кокон' }, { id: 'c', emoji: '🦋', label: 'бабочка' }],
      story: 'Сначала гусеница, потом кокон, а потом бабочка!' },
    { items: [{ id: 'a', emoji: '👶', label: 'малыш' }, { id: 'b', emoji: '🧒', label: 'школьник' }, { id: 'c', emoji: '🧑', label: 'взрослый' }],
      story: 'Сначала малыш, потом школьник, а потом взрослый!' }
  ];

  /* ---------- 8. Инструкции «Слушай и делай» ----------
     shape: circle|square|triangle; color: red|blue|yellow|green;
     size: big|small. steps — что нажать по порядку.
     all: нажать все фигуры формы. not: фигура НЕ формы и НЕ цвета. */
  var SHAPES = {
    circle: { name: 'круг', nameV: 'круг' },
    square: { name: 'квадрат', nameV: 'квадрат' },
    triangle: { name: 'треугольник', nameV: 'треугольник' }
  };
  var COLORS = {
    red: { name: 'красный', css: '#E4574C' },
    blue: { name: 'синий', css: '#3E7BD6' },
    yellow: { name: 'жёлтый', css: '#F2B705' },
    green: { name: 'зелёный', css: '#3E9E5F' }
  };
  var INSTRUCTIONS = [
    { text: 'Нажми на красный круг.', steps: [{ shape: 'circle', color: 'red' }], band: 1 },
    { text: 'Нажми на синий квадрат.', steps: [{ shape: 'square', color: 'blue' }], band: 1 },
    { text: 'Нажми на жёлтый треугольник.', steps: [{ shape: 'triangle', color: 'yellow' }], band: 1 },
    { text: 'Нажми на большой зелёный круг.', steps: [{ shape: 'circle', color: 'green', size: 'big' }], band: 2 },
    { text: 'Нажми на маленький красный квадрат.', steps: [{ shape: 'square', color: 'red', size: 'small' }], band: 2 },
    { text: 'Нажми на маленький синий треугольник.', steps: [{ shape: 'triangle', color: 'blue', size: 'small' }], band: 2 },
    { text: 'Сначала нажми на круг, потом на треугольник.', steps: [{ shape: 'circle' }, { shape: 'triangle' }], band: 3 },
    { text: 'Сначала нажми на синий круг, потом на красный квадрат.', steps: [{ shape: 'circle', color: 'blue' }, { shape: 'square', color: 'red' }], band: 3 },
    { text: 'Сначала нажми на жёлтый треугольник, потом на зелёный круг.', steps: [{ shape: 'triangle', color: 'yellow' }, { shape: 'circle', color: 'green' }], band: 3 },
    { text: 'Сначала нажми на маленький синий треугольник, потом на большой жёлтый круг.', steps: [{ shape: 'triangle', color: 'blue', size: 'small' }, { shape: 'circle', color: 'yellow', size: 'big' }], band: 4 },
    { text: 'Нажми на все круги.', all: 'circle', band: 4 },
    { text: 'Нажми на фигуру, которая не круг и не красная.', not: { shape: 'circle', color: 'red' }, band: 4 }
  ];

  /* ---------- 10. Оценка готовности ---------- */
  var READINESS = {
    reading: { title: 'Чтение', emoji: '📖', prefixes: ['rc', 'ps', 'fs', 'story'] },
    writing: { title: 'Письмо', emoji: '✍️', prefixes: ['ml', 'typo', 'sb', 'write'] },
    math: { title: 'Математика', emoji: '🔢', prefixes: ['nb', 'bond', 'wp', 'add', 'sub', 'line'] },
    logic: { title: 'Логика', emoji: '🧠', prefixes: ['pat', 'odd', 'cmpq', 'opp'] },
    attention: { title: 'Внимание', emoji: '👀', prefixes: ['wg', 'fl', 'instr', 'mc', 'mw', 'md'] }
  };

  /* Позитивные шаблоны рекомендаций: сильная сторона + тренировка */
  var PARENT_TIPS = {
    reading: 'Стоит потренировать чтение с вопросами: после сказки спросите, что герой сделал сначала.',
    writing: 'Стоит потренировать хитрые слоги ЖИ-ШИ — в приложении есть игра «слово-хитрюшка».',
    math: 'Стоит потренировать домики чисел: играйте в «я говорю 6 — ты говоришь 4» по дороге.',
    logic: 'Стоит потренировать «найди лишнее»: пусть ребёнок сам объясняет, почему предмет лишний.',
    attention: 'Стоит потренировать инструкции из двух шагов: «сначала принеси ложку, потом закрой дверь».'
  };

  global.SchoolData = {
    READING: READING,
    PIC_SENTENCE: PIC_SENTENCE,
    MISSING_LETTER: MISSING_LETTER,
    FIND_TYPO: FIND_TYPO,
    SENTENCE_BUILD: SENTENCE_BUILD,
    NEIGHBORS: NEIGHBORS,
    BONDS: BONDS,
    WORD_PROBLEMS: WORD_PROBLEMS,
    PATTERNS: PATTERNS,
    ODD_ONE: ODD_ONE,
    COMPARE: COMPARE,
    WHAT_GONE: WHAT_GONE,
    FIND_LETTER: FIND_LETTER,
    MEMO_COLORS: MEMO_COLORS,
    MEMO_WORDS: MEMO_WORDS,
    OPPOSITES: OPPOSITES,
    FINISH_SENTENCE: FINISH_SENTENCE,
    STORY_ORDER: STORY_ORDER,
    SHAPES: SHAPES,
    COLORS: COLORS,
    INSTRUCTIONS: INSTRUCTIONS,
    READINESS: READINESS,
    PARENT_TIPS: PARENT_TIPS,

    byBand: function (list, band) {
      var out = list.filter(function (x) { return (x.band || 1) === band; });
      return out.length ? out : list;
    }
  };

})(window);
