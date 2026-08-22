/* data/sentences.js — простые предложения для сборки.
 *
 * Уровень предложения — ступень сборки фразы, а не уровень словаря:
 *   1 — 2 слова,  буквы order ≤ 18 (по букву Д включительно)
 *   2 — 2–3 слова, буквы order ≤ 26 (по букву Ю включительно)
 *   3 — 3–4 слова, любые буквы
 * Причина: в русском языке нет глагольных форм из букв уровня 1–2
 * (А М О У С Х Ш Р Ы Л Н К Т) — без Т/И/Д/П предложение не построить,
 * поэтому сборка фраз стартует после того, как пройден блок И П З В Д.
 * Ограничение по буквам при этом сохранено и проверяется валидатором.
 */
(function (global) {
  'use strict';

  var SENTENCES = [
    { id: 1, words: ['МАМА', 'ДОМА'], text: 'МАМА ДОМА.', emoji: '🏠', level: 1 },
    { id: 2, words: ['КОТ', 'СПИТ'], text: 'КОТ СПИТ.', emoji: '😴', level: 1 },
    { id: 3, words: ['ЛИСА', 'СИДИТ'], text: 'ЛИСА СИДИТ.', emoji: '🦊', level: 1 },
    { id: 4, words: ['ШАР', 'ВИСИТ'], text: 'ШАР ВИСИТ.', emoji: '🎈', level: 1 },
    { id: 5, words: ['ЛУНА', 'ВЫСОКО'], text: 'ЛУНА ВЫСОКО.', emoji: '🌙', level: 1 },
    { id: 6, words: ['ЗИМА', 'ПРИШЛА'], text: 'ЗИМА ПРИШЛА.', emoji: '❄️', level: 1 },
    { id: 7, words: ['ПАПА', 'СМОТРИТ'], text: 'ПАПА СМОТРИТ.', emoji: '👀', level: 1 },
    { id: 8, words: ['МАМА', 'ЗВОНИТ'], text: 'МАМА ЗВОНИТ.', emoji: '📞', level: 1 },
    { id: 9, words: ['ПАПА', 'ИДЁТ'], text: 'ПАПА ИДЁТ.', emoji: '👨', level: 2 },
    { id: 10, words: ['РЫБА', 'ПЛЫВЁТ'], text: 'РЫБА ПЛЫВЁТ.', emoji: '🐠', level: 2 },
    { id: 11, words: ['ЖУК', 'ПОЛЗЁТ'], text: 'ЖУК ПОЛЗЁТ.', emoji: '🪲', level: 2 },
    { id: 12, words: ['СОБАКА', 'ЛАЕТ'], text: 'СОБАКА ЛАЕТ.', emoji: '🐕', level: 2 },
    { id: 13, words: ['ВОЛК', 'БЕЖИТ'], text: 'ВОЛК БЕЖИТ.', emoji: '🐺', level: 2 },
    { id: 14, words: ['МАМА', 'ВАРИТ', 'СУП'], text: 'МАМА ВАРИТ СУП.', emoji: '🍲', level: 2 },
    { id: 15, words: ['ПАПА', 'ЕДЕТ', 'ДОМОЙ'], text: 'ПАПА ЕДЕТ ДОМОЙ.', emoji: '🚗', level: 2 },
    { id: 16, words: ['МАЛЫШ', 'ЕСТ', 'БАНАН'], text: 'МАЛЫШ ЕСТ БАНАН.', emoji: '🍌', level: 2 },
    { id: 17, words: ['КОТ', 'ЛОВИТ', 'МЯЧ'], text: 'КОТ ЛОВИТ МЯЧ.', emoji: '⚽', level: 3 },
    { id: 18, words: ['ЩЕНОК', 'ЕСТ', 'ХЛЕБ'], text: 'ЩЕНОК ЕСТ ХЛЕБ.', emoji: '🍞', level: 3 },
    { id: 19, words: ['ЛИСА', 'ВИДИТ', 'СЫР'], text: 'ЛИСА ВИДИТ СЫР.', emoji: '🧀', level: 3 },
    { id: 20, words: ['ЁЖ', 'НЕСЁТ', 'ЯБЛОКО'], text: 'ЁЖ НЕСЁТ ЯБЛОКО.', emoji: '🦔', level: 3 },
    { id: 21, words: ['МАЛЫШ', 'РИСУЕТ', 'ЦВЕТОК'], text: 'МАЛЫШ РИСУЕТ ЦВЕТОК.', emoji: '🌸', level: 3 },
    { id: 22, words: ['ПАПА', 'ЧИНИТ', 'СТУЛ'], text: 'ПАПА ЧИНИТ СТУЛ.', emoji: '🪑', level: 3 },
    { id: 23, words: ['МАМА', 'ПОКУПАЕТ', 'БОЛЬШОЙ', 'ТОРТ'], text: 'МАМА ПОКУПАЕТ БОЛЬШОЙ ТОРТ.', emoji: '🎂', level: 3 },
    { id: 24, words: ['ЖИРАФ', 'ЕСТ', 'ЗЕЛЁНЫЙ', 'ЛИСТ'], text: 'ЖИРАФ ЕСТ ЗЕЛЁНЫЙ ЛИСТ.', emoji: '🦒', level: 3 }
  ];

  function byLevel(lvl) {
    return SENTENCES.filter(function (x) { return x.level === lvl; });
  }

  global.Sentences = {
    SENTENCES: SENTENCES,

    byLevel: byLevel,
    upToLevel: function (lvl) {
      return SENTENCES.filter(function (x) { return x.level <= lvl; });
    },

    random: function (lvl) {
      var pool = (lvl == null) ? SENTENCES : byLevel(lvl);
      if (!pool.length) return null;
      return pool[Math.floor(Math.random() * pool.length)];
    }
  };
})(window);
