/* =========================================================
   core/speech.js — озвучка.
   Фасад: сначала ищет готовый аудиофайл в реестре CLIPS,
   и только потом синтезирует речь через Web Speech API.
   Чтобы перейти на профессиональную озвучку, достаточно
   заполнить CLIPS — остальной код не меняется.
   ========================================================= */
(function (global) {
  'use strict';

  var CLIPS = {};          // 'letter:М' -> 'audio/letter-m.mp3' (пока пусто)

  /* Взрывные и аффрикаты нельзя тянуть — даём короткое придыхание */
  var PLOSIVE = {
    'к': 'кх', 'п': 'пх', 'т': 'тс', 'б': 'бэ-э', 'д': 'дэ-э', 'г': 'гэ-э',
    'ц': 'ц-ц-ц', 'ч': 'ч-ч-ч'
  };
  /* Буквы, обозначающие два звука: отдельного «звука буквы» у них нет */
  var JOTTED = {
    'Е': 'е. Эта буква поёт два звука: й и э',
    'Ё': 'ё. Эта буква поёт два звука: й и о',
    'Я': 'я. Эта буква поёт два звука: й и а',
    'Ю': 'ю. Эта буква поёт два звука: й и у'
  };
  var audioCache = {};
  var voice = null;
  var ready = false;
  var supported = !!(global.speechSynthesis && global.SpeechSynthesisUtterance);
  var listeners = [];

  /* Выбранный голос — настройка УСТРОЙСТВА, а не профиля ребёнка:
     на другом телефоне этого голоса может не быть. */
  var VOICE_KEY = 'umnyashka.voice';
  function savedVoiceName() {
    try { return localStorage.getItem(VOICE_KEY) || ''; } catch (e) { return ''; }
  }

  function ruVoices() {
    if (!supported) return [];
    var all = global.speechSynthesis.getVoices() || [];
    return all.filter(function (v) { return /^ru/i.test(v.lang); });
  }

  /**
   * Качество голосов различается в разы. Ранжируем:
   * улучшенные/нейросетевые > известные хорошие (Милена, Google) >
   * просто женские > остальные. Локальные чуть выше — работают офлайн.
   */
  function scoreVoice(v) {
    var s = 0, n = v.name || '';
    if (/(enhanced|premium|natural|neural|wavenet|plus|улучшенн)/i.test(n)) s += 40;
    if (/milena|милена/i.test(n)) s += 30;
    if (/google/i.test(n)) s += 25;
    if (/(katya|katia|катя|alena|алёна|tatyana|татьяна|svetlana|светлана)/i.test(n)) s += 10;
    if (/(female|женск)/i.test(n)) s += 5;
    if (/(compact|eloquence|espeak)/i.test(n)) s -= 30;   // заведомо роботы
    if (v.localService) s += 3;
    return s;
  }

  function pickVoice() {
    var ru = ruVoices();
    if (!ru.length) return null;
    var saved = savedVoiceName();
    if (saved) {
      for (var i = 0; i < ru.length; i++) if (ru[i].name === saved) return ru[i];
    }
    ru.sort(function (a, b) { return scoreVoice(b) - scoreVoice(a); });
    return ru[0];
  }

  if (supported) {
    voice = pickVoice();
    ready = !!voice;
    global.speechSynthesis.onvoiceschanged = function () {
      voice = pickVoice();
      ready = !!voice;
    };
  }

  /* Голос управляется только своим переключателем: выключенные звуки кнопок
     не должны лишать нечитающего ребёнка инструкций. */
  function enabled() {
    return !!(global.Store && Store.settings.speech);
  }

  function notify(state) {
    listeners.forEach(function (fn) { try { fn(state); } catch (e) {} });
  }

  /** Проговорить произвольный текст. */
  function speak(text, opts) {
    opts = opts || {};
    if (!text || !enabled()) return Promise.resolve(false);
    if (!supported) return Promise.resolve(false);

    try { global.speechSynthesis.cancel(); } catch (e) {}

    return new Promise(function (resolve) {
      var u = new global.SpeechSynthesisUtterance(String(text));
      u.lang = 'ru-RU';
      if (voice) u.voice = voice;
      u.rate = opts.rate || (Store.settings.speechRate || 0.85);
      u.pitch = opts.pitch === undefined ? 1.15 : opts.pitch;   // чуть выше — звучит дружелюбнее
      u.volume = 1;
      var done = false;
      function finish(ok) {
        if (done) return;
        done = true;
        notify('end');
        resolve(ok);
      }
      u.onend = function () { finish(true); };
      u.onerror = function () { finish(false); };
      notify('start');
      try {
        global.speechSynthesis.speak(u);
      } catch (e) { finish(false); }
      // страховка: если браузер «проглотил» событие
      setTimeout(function () { finish(true); }, Math.max(1800, String(text).length * 130));
    });
  }

  /** Проиграть заранее записанный клип, если он есть. */
  function clip(key) {
    var src = CLIPS[key];
    if (!src || !enabled()) return null;
    var a = audioCache[key] || (audioCache[key] = new Audio(src));
    try { a.currentTime = 0; a.play(); } catch (e) { return null; }
    return a;
  }

  var Speech = {
    supported: supported,
    isReady: function () { return supported; },
    onState: function (fn) { listeners.push(fn); },

    /* ----- выбор голоса (экран настроек) ----- */

    /** Русские голоса устройства, лучшие первыми. */
    voices: function () {
      var ru = ruVoices().slice();
      ru.sort(function (a, b) { return scoreVoice(b) - scoreVoice(a); });
      return ru;
    },
    voiceName: function () { return voice ? voice.name : ''; },
    setVoice: function (name) {
      try { localStorage.setItem(VOICE_KEY, name || ''); } catch (e) {}
      voice = pickVoice();
      return voice;
    },
    /** Короткая проба голоса — для кнопки «Послушать» в настройках. */
    sample: function (name) {
      var keep = voice;
      var ru = ruVoices();
      for (var i = 0; i < ru.length; i++) if (ru[i].name === name) { voice = ru[i]; break; }
      var p = speak('Привет! Я буду читать тебе задания.');
      voice = keep;
      return p;
    },

    /** Зарегистрировать готовую озвучку (задел под аудиофайлы). */
    register: function (map) { Object.assign(CLIPS, map); },

    stop: function () {
      try { global.speechSynthesis.cancel(); } catch (e) {}
      notify('end');
    },

    say: function (text, opts) {
      return speak(text, opts);
    },

    /** Ключ + текст: если для ключа есть клип — играем его. */
    play: function (key, text, opts) {
      if (clip(key)) return Promise.resolve(true);
      return speak(text, opts);
    },

    /**
     * Звук буквы. Тянущиеся согласные повторяем («мммм»), чтобы синтезатор
     * не сказал «эм». Взрывные (К, П, Т, Б, Д, Г) и аффрикаты (Ц, Ч) тянуть
     * физически нельзя — им даём короткое придыхание. Йотированные буквы
     * (Е, Ё, Я, Ю) звука не имеют: объясняем, что буква «поёт два звука».
     */
    letterSound: function (letter) {
      var L = global.Alphabet && Alphabet.byChar(letter);
      if (!L) return speak(letter);
      if (L.type === 'sign') {
        return speak(L.ch === 'Ь' ? 'мягкий знак, он не звучит' : 'твёрдый знак, он не звучит');
      }
      var text;
      if (JOTTED[L.ch]) text = JOTTED[L.ch];
      else if (PLOSIVE[L.sound]) text = PLOSIVE[L.sound];
      else if (L.type === 'vowel') text = L.sound + L.sound;
      else text = L.sound + L.sound + L.sound;
      return Speech.play('sound:' + L.ch, text, { rate: 0.7 });
    },

    /** Название буквы («эм», «бэ») — нужно для алфавита. */
    letterName: function (letter) {
      var L = global.Alphabet && Alphabet.byChar(letter);
      return Speech.play('name:' + letter, L ? L.name : letter);
    },

    word: function (w) {
      return Speech.play('word:' + w, String(w).toLowerCase());
    },

    /** Слово по слогам, затем целиком. */
    syllables: function (parts, whole) {
      var text = parts.join(', ') + '. ' + (whole || parts.join(''));
      return speak(text.toLowerCase(), { rate: 0.65 });
    },

    number: function (n) {
      var w = (global.Numbers && Numbers.word) ? Numbers.word(n) : String(n);
      return Speech.play('num:' + n, w);
    },

    phrase: function (text) { return speak(text); }
  };

  global.Speech = Speech;

})(window);
