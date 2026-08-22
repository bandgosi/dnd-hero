/* data/alphabet.js — русский алфавит: звуки, слова-примеры, траектории письма */
(function (global) {
  'use strict';

  /**
   * Система координат траекторий: квадрат 100x100, ось Y направлена вниз (SVG).
   * Тело буквы: y = 12 (верх) .. 88 (низ), x ≈ 20..80 (широкие буквы — до 12..88).
   * Один элемент strokes = одно непрерывное движение руки (1..4 на букву).
   */
  var LETTERS = [
    {
      ch: 'А', low: 'а', name: 'а', sound: 'а',
      type: 'vowel', voiced: null, hard: null,
      word: 'АРБУЗ', emoji: '🍉', order: 1,
      strokes: [
        { d: 'M50,12 L22,88', from: [50, 12] },
        { d: 'M50,12 L78,88', from: [50, 12] },
        { d: 'M33,64 L67,64', from: [33, 64] }
      ]
    },
    {
      ch: 'Б', low: 'б', name: 'бэ', sound: 'б',
      type: 'consonant', voiced: true, hard: null,
      word: 'БАНАН', emoji: '🍌', order: 19,
      strokes: [
        { d: 'M28,12 L28,88', from: [28, 12] },
        { d: 'M28,12 L70,12', from: [28, 12] },
        { d: 'M28,48 L58,48 Q76,48 76,68 Q76,88 58,88 L28,88', from: [28, 48] }
      ]
    },
    {
      ch: 'В', low: 'в', name: 'вэ', sound: 'в',
      type: 'consonant', voiced: true, hard: null,
      word: 'ВОЛК', emoji: '🐺', order: 17,
      strokes: [
        { d: 'M28,12 L28,88', from: [28, 12] },
        { d: 'M28,12 L58,12 Q72,12 72,30 Q72,48 58,48 L28,48', from: [28, 12] },
        { d: 'M28,48 L60,48 Q76,48 76,68 Q76,88 60,88 L28,88', from: [28, 48] }
      ]
    },
    {
      ch: 'Г', low: 'г', name: 'гэ', sound: 'г',
      type: 'consonant', voiced: true, hard: null,
      word: 'ГРИБ', emoji: '🍄', order: 20,
      strokes: [
        { d: 'M28,12 L72,12', from: [28, 12] },
        { d: 'M28,12 L28,88', from: [28, 12] }
      ]
    },
    {
      ch: 'Д', low: 'д', name: 'дэ', sound: 'д',
      type: 'consonant', voiced: true, hard: null,
      word: 'ДОМ', emoji: '🏡', order: 18,
      strokes: [
        { d: 'M36,12 L70,12 L70,74', from: [36, 12] },
        { d: 'M36,12 Q36,52 22,74', from: [36, 12] },
        { d: 'M26,90 L26,74 L74,74 L74,90', from: [26, 90] }
      ]
    },
    {
      ch: 'Е', low: 'е', name: 'е', sound: 'йэ',
      type: 'vowel', voiced: null, hard: null,
      word: 'ЕНОТ', emoji: '🦝', order: 23,
      strokes: [
        { d: 'M72,12 L28,12 L28,88 L72,88', from: [72, 12] },
        { d: 'M28,50 L66,50', from: [28, 50] }
      ]
    },
    {
      ch: 'Ё', low: 'ё', name: 'ё', sound: 'йо',
      type: 'vowel', voiced: null, hard: null,
      word: 'ЁЖИК', emoji: '🦔', order: 24,
      strokes: [
        { d: 'M72,26 L28,26 L28,88 L72,88', from: [72, 26] },
        { d: 'M28,58 L66,58', from: [28, 58] },
        { d: 'M40,12 A2,2 0 1 0 40.1,12', from: [40, 12] },
        { d: 'M60,12 A2,2 0 1 0 60.1,12', from: [60, 12] }
      ]
    },
    {
      ch: 'Ж', low: 'ж', name: 'жэ', sound: 'ж',
      type: 'consonant', voiced: true, hard: 'always-hard',
      word: 'ЖУК', emoji: '🪲', order: 21,
      strokes: [
        { d: 'M14,12 L50,50 L14,88', from: [14, 12] },
        { d: 'M50,12 L50,88', from: [50, 12] },
        { d: 'M86,12 L50,50 L86,88', from: [86, 12] }
      ]
    },
    {
      ch: 'З', low: 'з', name: 'зэ', sound: 'з',
      type: 'consonant', voiced: true, hard: null,
      word: 'ЗОНТ', emoji: '☂️', order: 16,
      strokes: [
        { d: 'M26,24 Q28,12 50,12 Q72,12 72,30 Q72,50 50,50 Q74,50 74,70 Q74,88 50,88 Q28,88 26,76', from: [26, 24] }
      ]
    },
    {
      ch: 'И', low: 'и', name: 'и', sound: 'и',
      type: 'vowel', voiced: null, hard: null,
      word: 'ИГЛА', emoji: '🪡', order: 14,
      strokes: [
        { d: 'M28,12 L28,88', from: [28, 12] },
        { d: 'M72,12 L28,88', from: [72, 12] },
        { d: 'M72,12 L72,88', from: [72, 12] }
      ]
    },
    {
      ch: 'Й', low: 'й', name: 'и краткое', sound: 'й',
      type: 'consonant', voiced: true, hard: 'always-soft',
      word: 'ЙОГУРТ', emoji: '🥛', order: 22,
      strokes: [
        { d: 'M28,26 L28,88', from: [28, 26] },
        { d: 'M72,26 L28,88', from: [72, 26] },
        { d: 'M72,26 L72,88', from: [72, 26] },
        { d: 'M36,13 Q50,25 64,13', from: [36, 13] }
      ]
    },
    {
      ch: 'К', low: 'к', name: 'ка', sound: 'к',
      type: 'consonant', voiced: false, hard: null,
      word: 'КОТ', emoji: '🐱', order: 12,
      strokes: [
        { d: 'M28,12 L28,88', from: [28, 12] },
        { d: 'M72,12 L34,50 L72,88', from: [72, 12] }
      ]
    },
    {
      ch: 'Л', low: 'л', name: 'эль', sound: 'л',
      type: 'consonant', voiced: true, hard: null,
      word: 'ЛИСА', emoji: '🦊', order: 10,
      strokes: [
        { d: 'M36,12 L20,88', from: [36, 12] },
        { d: 'M36,12 L72,12', from: [36, 12] },
        { d: 'M72,12 L72,88', from: [72, 12] }
      ]
    },
    {
      ch: 'М', low: 'м', name: 'эм', sound: 'м',
      type: 'consonant', voiced: true, hard: null,
      word: 'МЫШКА', emoji: '🐭', order: 2,
      strokes: [
        { d: 'M24,12 L24,88', from: [24, 12] },
        { d: 'M24,12 L50,54 L76,12', from: [24, 12] },
        { d: 'M76,12 L76,88', from: [76, 12] }
      ]
    },
    {
      ch: 'Н', low: 'н', name: 'эн', sound: 'н',
      type: 'consonant', voiced: true, hard: null,
      word: 'НОСОК', emoji: '🧦', order: 11,
      strokes: [
        { d: 'M28,12 L28,88', from: [28, 12] },
        { d: 'M72,12 L72,88', from: [72, 12] },
        { d: 'M28,50 L72,50', from: [28, 50] }
      ]
    },
    {
      ch: 'О', low: 'о', name: 'о', sound: 'о',
      type: 'vowel', voiced: null, hard: null,
      word: 'ОБЛАКО', emoji: '☁️', order: 3,
      strokes: [
        { d: 'M50,12 A30,38 0 1 0 50.1,12', from: [50, 12] }
      ]
    },
    {
      ch: 'П', low: 'п', name: 'пэ', sound: 'п',
      type: 'consonant', voiced: false, hard: null,
      word: 'ПТИЦА', emoji: '🐦', order: 15,
      strokes: [
        { d: 'M26,12 L26,88', from: [26, 12] },
        { d: 'M26,12 L74,12', from: [26, 12] },
        { d: 'M74,12 L74,88', from: [74, 12] }
      ]
    },
    {
      ch: 'Р', low: 'р', name: 'эр', sound: 'р',
      type: 'consonant', voiced: true, hard: null,
      word: 'РЫБА', emoji: '🐠', order: 8,
      strokes: [
        { d: 'M28,12 L28,88', from: [28, 12] },
        { d: 'M28,12 L58,12 Q74,12 74,32 Q74,52 58,52 L28,52', from: [28, 12] }
      ]
    },
    {
      ch: 'С', low: 'с', name: 'эс', sound: 'с',
      type: 'consonant', voiced: false, hard: null,
      word: 'СЛОН', emoji: '🐘', order: 5,
      strokes: [
        { d: 'M71,23 A30,38 0 1 0 71,77', from: [71, 23] }
      ]
    },
    {
      ch: 'Т', low: 'т', name: 'тэ', sound: 'т',
      type: 'consonant', voiced: false, hard: null,
      word: 'ТИГР', emoji: '🐯', order: 13,
      strokes: [
        { d: 'M24,12 L76,12', from: [24, 12] },
        { d: 'M50,12 L50,88', from: [50, 12] }
      ]
    },
    {
      ch: 'У', low: 'у', name: 'у', sound: 'у',
      type: 'vowel', voiced: null, hard: null,
      word: 'УТКА', emoji: '🦆', order: 4,
      strokes: [
        { d: 'M26,12 L50,52', from: [26, 12] },
        { d: 'M74,12 L50,52 L36,88', from: [74, 12] }
      ]
    },
    {
      ch: 'Ф', low: 'ф', name: 'эф', sound: 'ф',
      type: 'consonant', voiced: false, hard: null,
      word: 'ФОНАРЬ', emoji: '🔦', order: 29,
      strokes: [
        { d: 'M50,12 L50,88', from: [50, 12] },
        { d: 'M50,26 A26,22 0 1 0 50.1,26', from: [50, 26] }
      ]
    },
    {
      ch: 'Х', low: 'х', name: 'ха', sound: 'х',
      type: 'consonant', voiced: false, hard: null,
      word: 'ХЛЕБ', emoji: '🍞', order: 6,
      strokes: [
        { d: 'M24,12 L76,88', from: [24, 12] },
        { d: 'M76,12 L24,88', from: [76, 12] }
      ]
    },
    {
      ch: 'Ц', low: 'ц', name: 'цэ', sound: 'ц',
      type: 'consonant', voiced: false, hard: 'always-hard',
      word: 'ЦВЕТОК', emoji: '🌷', order: 28,
      strokes: [
        { d: 'M28,12 L28,80', from: [28, 12] },
        { d: 'M72,12 L72,80', from: [72, 12] },
        { d: 'M28,80 L76,80 L76,92', from: [28, 80] }
      ]
    },
    {
      ch: 'Ч', low: 'ч', name: 'че', sound: 'ч',
      type: 'consonant', voiced: false, hard: 'always-soft',
      word: 'ЧАСЫ', emoji: '⌚', order: 27,
      strokes: [
        { d: 'M28,12 L28,50 L72,50', from: [28, 12] },
        { d: 'M72,12 L72,88', from: [72, 12] }
      ]
    },
    {
      ch: 'Ш', low: 'ш', name: 'ша', sound: 'ш',
      type: 'consonant', voiced: false, hard: 'always-hard',
      word: 'ШАР', emoji: '🎈', order: 7,
      strokes: [
        { d: 'M14,12 L14,88', from: [14, 12] },
        { d: 'M50,12 L50,88', from: [50, 12] },
        { d: 'M86,12 L86,88', from: [86, 12] },
        { d: 'M14,88 L86,88', from: [14, 88] }
      ]
    },
    {
      ch: 'Щ', low: 'щ', name: 'ща', sound: 'щ',
      type: 'consonant', voiced: false, hard: 'always-soft',
      word: 'ЩЕНОК', emoji: '🐶', order: 31,
      strokes: [
        { d: 'M14,12 L14,80', from: [14, 12] },
        { d: 'M48,12 L48,80', from: [48, 12] },
        { d: 'M82,12 L82,80', from: [82, 12] },
        { d: 'M14,80 L86,80 L86,92', from: [14, 80] }
      ]
    },
    {
      ch: 'Ъ', low: 'ъ', name: 'твёрдый знак', sound: '',
      type: 'sign', voiced: null, hard: null,
      word: 'ПОДЪЁМ', emoji: '🧗', order: 33,
      strokes: [
        { d: 'M22,12 L46,12', from: [22, 12] },
        { d: 'M46,12 L46,88', from: [46, 12] },
        { d: 'M46,48 L64,48 Q80,48 80,68 Q80,88 64,88 L46,88', from: [46, 48] }
      ]
    },
    {
      ch: 'Ы', low: 'ы', name: 'ы', sound: 'ы',
      type: 'vowel', voiced: null, hard: null,
      word: 'СЫР', emoji: '🧀', order: 9,
      strokes: [
        { d: 'M22,12 L22,88', from: [22, 12] },
        { d: 'M22,48 L42,48 Q58,48 58,68 Q58,88 42,88 L22,88', from: [22, 48] },
        { d: 'M78,12 L78,88', from: [78, 12] }
      ]
    },
    {
      ch: 'Ь', low: 'ь', name: 'мягкий знак', sound: '',
      type: 'sign', voiced: null, hard: null,
      word: 'КОНЬ', emoji: '🐴', order: 32,
      strokes: [
        { d: 'M32,12 L32,88', from: [32, 12] },
        { d: 'M32,48 L54,48 Q70,48 70,68 Q70,88 54,88 L32,88', from: [32, 48] }
      ]
    },
    {
      ch: 'Э', low: 'э', name: 'э', sound: 'э',
      type: 'vowel', voiced: null, hard: null,
      word: 'ЭСКИМО', emoji: '🍡', order: 30,
      strokes: [
        { d: 'M29,23 A30,38 0 1 1 29,77', from: [29, 23] },
        { d: 'M46,50 L72,50', from: [46, 50] }
      ]
    },
    {
      ch: 'Ю', low: 'ю', name: 'ю', sound: 'йу',
      type: 'vowel', voiced: null, hard: null,
      word: 'ЮЛА', emoji: '🪀', order: 26,
      strokes: [
        { d: 'M22,12 L22,88', from: [22, 12] },
        { d: 'M22,50 L40,50', from: [22, 50] },
        { d: 'M64,12 A24,38 0 1 0 64.1,12', from: [64, 12] }
      ]
    },
    {
      ch: 'Я', low: 'я', name: 'я', sound: 'йа',
      type: 'vowel', voiced: null, hard: null,
      word: 'ЯБЛОКО', emoji: '🍎', order: 25,
      strokes: [
        { d: 'M72,12 L72,88', from: [72, 12] },
        { d: 'M72,12 L44,12 Q28,12 28,30 Q28,48 44,48 L72,48', from: [72, 12] },
        { d: 'M48,48 L24,88', from: [48, 48] }
      ]
    }
  ];

  global.Alphabet = {
    LETTERS: LETTERS,

    /** Поиск буквы по заглавному символу (регистр не важен). */
    byChar: function (ch) {
      if (!ch) return null;
      var up = String(ch).toUpperCase();
      for (var i = 0; i < LETTERS.length; i++) {
        if (LETTERS[i].ch === up) return LETTERS[i];
      }
      return null;
    },

    /** Первые n букв по порядку ИЗУЧЕНИЯ (order). Без аргумента — все 33. */
    inOrder: function (n) {
      var sorted = LETTERS.slice().sort(function (a, b) { return a.order - b.order; });
      if (typeof n !== 'number' || n < 0) return sorted;
      return sorted.slice(0, n);
    },

    /** Только гласные, в алфавитном порядке. */
    vowels: function () {
      return LETTERS.filter(function (l) { return l.type === 'vowel'; });
    },

    /** Только согласные, в алфавитном порядке. */
    consonants: function () {
      return LETTERS.filter(function (l) { return l.type === 'consonant'; });
    }
  };
})(window);
