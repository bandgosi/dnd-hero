/* =========================================================
   shared/profile.js — общий профиль ребёнка для всех приложений
   «Детской полки»: имя, персонаж и краткие сводки прогресса
   для карточек оглавления.

   Почему два канала передачи:
   • адрес (?kid=…&ch=…) — работает всегда, в том числе когда
     страницы открыты как файлы и браузер не даёт им общее
     хранилище (так ведёт себя Safari с file://);
   • localStorage — чтобы имя не терялось при следующем запуске.

   Модуль необязателен: если файл не подключён, приложения
   работают как раньше. Все обращения к нему делаются через
   проверку `if (window.KidHub)`.
   ========================================================= */
(function (global) {
  'use strict';

  var KEY = 'kidhub.profile.v1';
  var SUM_PREFIX = 'kidhub.summary.';

  /* ---------- Хранилище с мягким отказом ---------- */
  function read(key, fallback) {
    try {
      var raw = global.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { global.localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  /* ---------- Разбор адреса ---------- */
  function query() {
    var out = {};
    var s = String(global.location.search || '').replace(/^\?/, '');
    if (!s) return out;
    s.split('&').forEach(function (pair) {
      if (!pair) return;
      var i = pair.indexOf('=');
      var k = i < 0 ? pair : pair.slice(0, i);
      var v = i < 0 ? '' : pair.slice(i + 1);
      try { out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); }
      catch (e) { out[k] = v; }
    });
    return out;
  }

  /**
   * Имя может прийти из адреса — вычищаем всё, что похоже на разметку.
   * Обрезка по 16 символам не должна разрывать эмодзи пополам: «половинка»
   * суррогатной пары ломает encodeURIComponent и роняет оглавление.
   */
  function clean(name) {
    return String(name || '')
      .replace(/[<>&"'`\\]/g, '')
      .trim()
      .slice(0, 16)
      .replace(/[\uD800-\uDBFF]$/, '')
      .trim();
  }

  /** Кодирование, которое не падает даже на испорченной строке. */
  function enc(s) {
    try { return encodeURIComponent(s); } catch (e) { return ''; }
  }

  var stored = read(KEY, null) || {};
  var q = query();

  var profile = {
    // Пустой параметр в адресе не должен стирать сохранённое имя
    name: clean(q.kid) || clean(stored.name) || '',
    character: String(q.ch || stored.character || 'fox').replace(/[^a-z]/gi, '').slice(0, 12) || 'fox',
    updatedAt: stored.updatedAt || 0
  };

  // Имя, пришедшее из оглавления, сразу закрепляем в хранилище
  if ((q.kid && profile.name) || (q.ch && profile.character)) save();

  function save() {
    profile.updatedAt = Date.now();
    write(KEY, profile);
  }

  var KidHub = {
    KEY: KEY,

    /** Текущий профиль (копия, менять напрямую нельзя). */
    get: function () {
      return { name: profile.name, character: profile.character, updatedAt: profile.updatedAt };
    },

    name: function () { return profile.name; },
    character: function () { return profile.character; },

    setName: function (n) {
      var v = clean(n);
      if (v === profile.name) return profile.name;
      profile.name = v;
      save();
      return profile.name;
    },

    setCharacter: function (id) {
      var v = String(id || '').replace(/[^a-z]/gi, '').slice(0, 12);
      if (!v || v === profile.character) return profile.character;
      profile.character = v;
      save();
      return profile.character;
    },

    /** Ссылка на приложение с передачей профиля через адрес. */
    linkTo: function (path) {
      var q = [];
      if (profile.name) { var k = enc(profile.name); if (k) q.push('kid=' + k); }
      if (profile.character) { var c = enc(profile.character); if (c) q.push('ch=' + c); }
      return path + (q.length ? '?' + q.join('&') : '');
    },

    /* ---------- Сводки прогресса для карточек оглавления ---------- */

    /**
     * @param {string} appId  'skazki' | 'chasiki' | 'umnyashka'
     * @param {object} data   { percent, stars, label }
     */
    setSummary: function (appId, data) {
      if (!appId || !data) return;
      write(SUM_PREFIX + appId, {
        percent: Math.max(0, Math.min(100, Math.round(Number(data.percent) || 0))),
        stars: Math.max(0, Math.round(Number(data.stars) || 0)),
        label: String(data.label || '').slice(0, 40),
        updatedAt: Date.now()
      });
    },

    /** Читаем с проверкой: чужая или устаревшая запись не должна ломать карточку. */
    getSummary: function (appId) {
      var s = read(SUM_PREFIX + appId, null);
      if (!s || typeof s !== 'object' || Object.prototype.toString.call(s) === '[object Array]') return null;
      return {
        percent: Math.max(0, Math.min(100, Math.round(Number(s.percent) || 0))),
        stars: Math.max(0, Math.round(Number(s.stars) || 0)),
        label: String(s.label || '').slice(0, 40)
      };
    },

    /* ---------- Кнопка возврата в оглавление ---------- */

    /**
     * Добавить плавающую кнопку «домой». Ребёнок всегда должен
     * иметь понятный выход из приложения.
     * @param {string} href путь к оглавлению (по умолчанию ../index.html)
     */
    addHomeButton: function (href) {
      if (document.getElementById('kidhub-home')) return;
      var url = href || '../index.html';

      var css = document.createElement('style');
      css.textContent =
        // z-index 60: выше содержимого, но НИЖЕ модальных окон и панели ответа,
        // иначе кнопка нажималась сквозь затемнение и перекрывала обратную связь
        '#kidhub-home{position:fixed;left:max(10px,env(safe-area-inset-left));' +
        'bottom:calc(10px + env(safe-area-inset-bottom,0px));z-index:60;' +
        'width:56px;height:56px;border-radius:50%;display:flex;align-items:center;' +
        'justify-content:center;font-size:26px;text-decoration:none;background:#fff;' +
        'color:#2B2350;box-shadow:0 4px 0 rgba(43,35,80,.18),0 8px 20px rgba(43,35,80,.22),' +
        '0 0 0 3px #6B6390;' +   // обводка: белый круг на светлом фоне иначе не виден
        'transition:transform .16s ease;-webkit-tap-highlight-color:transparent;' +
        'touch-action:manipulation}' +
        '#kidhub-home:active{transform:translateY(4px);box-shadow:0 1px 0 rgba(43,35,80,.18),0 0 0 3px #6B6390}' +
        '#kidhub-home:focus-visible{outline:3px solid #2B2350;outline-offset:3px;' +
        'box-shadow:0 0 0 7px #FFB300}' +
        // Освобождаем место в нижних панелях приложений: до этой правки
        // кнопка «Проверить» пряталась под домиком на телефоне
        '@media (max-width:600px){' +
        '.actions,.task__actions,.feedback,.controls{' +
        'padding-left:calc(76px + env(safe-area-inset-left,0px))!important}}' +
        '@media print{#kidhub-home{display:none}}';
      document.head.appendChild(css);

      var a = document.createElement('a');
      a.id = 'kidhub-home';
      a.href = url;
      a.title = 'Ко всем играм';
      a.setAttribute('aria-label', 'Вернуться ко всем играм');
      a.textContent = '🏠';

      // Посреди урока выход должен спрашивать подтверждение: приложение
      // ставит KidHub.homeGuard и само решает, отпускать ли ребёнка
      a.addEventListener('click', function (ev) {
        var guard = KidHub.homeGuard;
        if (typeof guard !== 'function') return;
        ev.preventDefault();
        guard(function () { global.location.href = url; });
      });

      document.body.appendChild(a);
      return a;
    },

    /** Приложение может поставить сюда функцию-охранника: guard(go). */
    homeGuard: null
  };

  global.KidHub = KidHub;

})(window);
