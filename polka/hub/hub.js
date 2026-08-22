/* =========================================================
   hub.js — оглавление «Детская полка».
   Три приложения в одном месте: сказки, часики, умняшка.
   Работает офлайн, открывается двойным кликом.
   ========================================================= */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------
     Каталог приложений. Чтобы добавить четвёртое, достаточно
     дописать сюда запись и положить папку рядом.
     --------------------------------------------------------- */
  var APPS = [
    {
      id: 'skazki', emoji: '📖', tint: 'tale',
      title: 'Сказки', sub: 'Про Луку и Давида',
      path: 'skazki/index.html',
      speak: 'Сказки про Луку и Давида. Шесть историй с картинками.',
      fallback: '6 историй'
    },
    {
      id: 'chasiki', emoji: '🕐', tint: 'time',
      title: 'Часики', sub: 'Учимся понимать время',
      path: 'chasiki/index.html',
      speak: 'Часики. Учимся понимать время и читать стрелки.',
      fallback: '10 уровней'
    },
    {
      id: 'umnyashka', emoji: '🎒', tint: 'learn',
      title: 'Умняшка', sub: 'Буквы, чтение, письмо и счёт',
      path: 'umnyashka/index.html',
      speak: 'Умняшка. Буквы, чтение, письмо и математика.',
      fallback: '33 урока'
    }
  ];

  var CHARS = [
    { id: 'fox',   emoji: '🦊', name: 'Лисёнок' },
    { id: 'owl',   emoji: '🦉', name: 'Совёнок' },
    { id: 'cat',   emoji: '🐱', name: 'Котёнок' },
    { id: 'robot', emoji: '🤖', name: 'Робот' }
  ];

  /* Состояние наличия папок: подтверждается файлами app.info.js */
  var found = {};
  var cardNodes = {};

  /* ---------------------------------------------------------
     Мелкие помощники
     --------------------------------------------------------- */
  function el(tag, props, kids) {
    var e = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    });
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  function say(text) {
    if (!text) return;
    try {
      if (!global.speechSynthesis || !global.SpeechSynthesisUtterance) return;
      global.speechSynthesis.cancel();
      var u = new global.SpeechSynthesisUtterance(text);
      u.lang = 'ru-RU';
      u.rate = 0.9;
      u.pitch = 1.12;
      var voices = global.speechSynthesis.getVoices() || [];
      var ru = voices.filter(function (v) { return /^ru/i.test(v.lang); })[0];
      if (ru) u.voice = ru;
      global.speechSynthesis.speak(u);
    } catch (e) { /* без голоса приложение работает так же */ }
  }

  function note(text, emoji) {
    var old = document.querySelector('.note');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var n = el('div', { class: 'note', role: 'status' }, [
      emoji ? el('span', { text: emoji, style: 'font-size:20px' }) : null,
      el('span', { text: text })
    ]);
    document.body.appendChild(n);
    setTimeout(function () {
      n.classList.add('is-out');
      setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 260);
    }, 4200);
  }

  /* ---------------------------------------------------------
     Карточка приложения
     --------------------------------------------------------- */
  function makeCard(app, i) {
    var sum = global.KidHub ? KidHub.getSummary(app.id) : null;

    var meta = el('div', { class: 'card__meta' });
    if (sum && (sum.percent > 0 || sum.stars > 0)) {
      if (sum.label) meta.appendChild(el('span', { class: 'chip', text: sum.label }));
      if (sum.stars > 0) meta.appendChild(el('span', { class: 'chip chip--sun', text: '⭐ ' + sum.stars }));
      if (sum.percent > 0) meta.appendChild(el('span', { class: 'chip chip--grass', text: sum.percent + '%' }));
    } else {
      meta.appendChild(el('span', { class: 'chip', text: app.fallback }));
    }

    var body = el('div', { class: 'card__body' }, [
      el('div', { class: 'card__title', text: app.title }),
      el('div', { class: 'card__sub', text: app.sub }),
      meta
    ]);
    if (sum && sum.percent > 0) {
      body.appendChild(el('div', { class: 'bar' }, [
        el('div', { class: 'bar__fill', style: 'width:' + sum.percent + '%' })
      ]));
    }

    var card = el('a', {
      class: 'card card--' + app.tint + ' card--' + (i + 1),
      href: global.KidHub ? KidHub.linkTo(app.path) : app.path,
      'aria-label': app.title + '. ' + app.sub,
      onclick: function (ev) {
        if (found[app.id] === false) {
          ev.preventDefault();
          // Ребёнку — понятная просьба, родителю — точная подсказка в сообщении
          say('Эта игра пока не установлена. Позови взрослого.');
          note('Папка «' + app.id + '» не найдена рядом с оглавлением', '📁');
          return;
        }
        // имя могло быть введено только что — обновляем адрес перед переходом
        if (global.KidHub) card.href = KidHub.linkTo(app.path);
      }
    }, [
      el('div', { class: 'card__ico', 'aria-hidden': 'true', text: app.emoji }),
      body,
      el('div', { class: 'card__go', 'aria-hidden': 'true', text: '▶' })
    ]);

    // Кнопка «послушать»: ребёнок ещё не читает
    var sayBtn = el('button', {
      class: 'say', type: 'button', 'aria-label': 'Послушать: ' + app.title,
      onclick: function (ev) { ev.preventDefault(); ev.stopPropagation(); say(app.speak); }
    }, [document.createTextNode('🔊')]);
    card.appendChild(sayBtn);

    cardNodes[app.id] = card;
    return card;
  }

  function applyFound(id) {
    var card = cardNodes[id];
    if (!card) return;
    var missing = found[id] === false;
    card.classList.toggle('is-missing', missing);
    if (!missing) return;

    var app = APPS.filter(function (a) { return a.id === id; })[0] || { title: '' };
    var sub = card.querySelector('.card__sub');
    if (sub) sub.textContent = 'Папка не найдена — положи её рядом';

    // Убираем старый прогресс: карточка не должна хвастаться тем,
    // чего сейчас нет
    var meta = card.querySelector('.card__meta');
    if (meta) meta.textContent = '';
    var bar = card.querySelector('.bar');
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);

    // Ссылку убираем совсем: иначе «открыть в новой вкладке» ведёт в никуда
    card.removeAttribute('href');
    card.setAttribute('role', 'button');
    card.setAttribute('aria-disabled', 'true');
    card.setAttribute('aria-label', app.title + '. Папка не найдена — положи её рядом с оглавлением');
  }

  /* ---------------------------------------------------------
     «Кто играет»: общий профиль
     --------------------------------------------------------- */
  function makeWho() {
    var current = global.KidHub ? KidHub.get() : { name: '', character: 'fox' };

    var input = el('input', {
      class: 'field', type: 'text', maxlength: '16',
      placeholder: 'Как тебя зовут?', value: current.name,
      'aria-label': 'Имя ребёнка'
    });

    function saveName() {
      if (!global.KidHub) return;
      var before = KidHub.name();
      var after = KidHub.setName(input.value);
      input.value = after;
      refreshLinks();
      if (after && after !== before) {
        say('Привет, ' + after + '!');
        greet();
      }
    }
    input.addEventListener('change', saveName);
    input.addEventListener('blur', saveName);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { input.blur(); } });

    var grid = el('div', { class: 'chars' });
    CHARS.forEach(function (c) {
      var b = el('button', {
        class: 'char' + (c.id === current.character ? ' is-on' : ''),
        type: 'button', 'aria-label': c.name,
        onclick: function () {
          if (global.KidHub) KidHub.setCharacter(c.id);
          Array.prototype.forEach.call(grid.children, function (n) { n.classList.remove('is-on'); });
          b.classList.add('is-on');
          say(c.name + ' с тобой!');
          refreshLinks();
        }
      }, [
        el('div', { class: 'char__ico', 'aria-hidden': 'true', text: c.emoji }),
        el('div', { class: 'char__name', text: c.name })
      ]);
      grid.appendChild(b);
    });

    return el('section', { class: 'who' }, [
      el('div', { class: 'who__title', text: '👋 Кто играет?' }),
      el('div', { class: 'who__hint', text: 'Имя и друг будут во всех играх' }),
      input,
      grid
    ]);
  }

  /** Перестроить ссылки, чтобы профиль ушёл в приложение через адрес. */
  function refreshLinks() {
    if (!global.KidHub) return;
    APPS.forEach(function (app) {
      var card = cardNodes[app.id];
      if (card) card.href = KidHub.linkTo(app.path);
    });
  }

  var greetNode = null;
  function greet() {
    if (!greetNode) return;
    var name = global.KidHub ? KidHub.name() : '';
    greetNode.textContent = name ? ('Привет, ' + name + '! Что выберешь?') : 'Выбери, чем займёмся';
  }

  /* ---------------------------------------------------------
     Сборка страницы
     --------------------------------------------------------- */
  function build() {
    var root = document.getElementById('hub');
    if (!root) return;

    // Заголовок разбит на буквы ради анимации, поэтому вслух читаем его целиком:
    // иначе экранный диктор произносит «Д-е-т-с-к-а-я»
    var title = el('h1', { class: 'head__title', 'aria-label': 'Детская полка' });
    'Детская полка'.split('').forEach(function (ch, i) {
      // Пробел внутри inline-block схлопывается в ноль — ставим неразрывный
      var s = el('span', { text: ch === ' ' ? '\u00A0' : ch, 'aria-hidden': 'true' });
      s.style.animationDelay = (0.06 + i * 0.05) + 's';
      s.style.color = ['#E0651F', '#2B7FD4', '#7C5CE0', '#177A45', '#B37A00'][i % 5];
      title.appendChild(s);
    });

    greetNode = el('p', { class: 'head__sub' });

    root.appendChild(el('header', { class: 'head' }, [
      el('div', { class: 'head__logo', 'aria-hidden': 'true', text: '🧸' }),
      title,
      greetNode
    ]));
    greet();

    var cards = el('div', { class: 'cards' });
    APPS.forEach(function (app, i) {
      cards.appendChild(makeCard(app, i));
      applyFound(app.id);
    });
    root.appendChild(cards);

    root.appendChild(makeWho());

    root.appendChild(el('p', { class: 'foot' }, [
      el('span', { text: 'Все игры работают без интернета. ' }),
      el('span', { text: 'Прогресс сохраняется в браузере.' })
    ]));

    // Приветствие голосом — только после первого касания,
    // браузеры не дают говорить до действия пользователя
    var greeted = false;
    function first(ev) {
      if (greeted) return;
      // Ребёнок сразу ткнул в игру — не мешаем ему приглашением выбрать
      if (ev && ev.target && ev.target.closest && ev.target.closest('.card')) { greeted = true; return; }
      greeted = true;
      var name = global.KidHub ? KidHub.name() : '';
      say(name ? ('Привет, ' + name + '! Выбери, чем займёмся.') : 'Выбери, чем займёмся.');
      document.removeEventListener('pointerdown', first);
      document.removeEventListener('keydown', first);
    }
    document.addEventListener('pointerdown', first, { passive: true });
    document.addEventListener('keydown', first);
  }

  /* ---------------------------------------------------------
     Проверка наличия папок.
     Каждое приложение кладёт рядом app.info.js и вызывает
     Hub.ready(). Если файла нет, срабатывает onerror у <script>
     — это единственный способ проверить наличие файла, когда
     страница открыта как файл (fetch там запрещён).
     --------------------------------------------------------- */
  var Hub = {
    ready: function (id, info) {
      found[id] = true;
      if (info && info.summary && global.KidHub) KidHub.setSummary(id, info.summary);
      applyFound(id);
    },
    missing: function (id) {
      found[id] = false;
      applyFound(id);
    },
    APPS: APPS
  };

  global.Hub = Hub;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }

})(window);
