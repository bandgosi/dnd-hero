/* =========================================================
   ui.js — маленький UI-слой: создание элементов, экраны,
   роутер, всплывашки, модалки, панель обратной связи.
   ========================================================= */
(function (global) {
  'use strict';

  /* ---------------- Базовые помощники ---------------- */

  /**
   * Создать элемент.
   * el('div', {class:'card', onclick:fn, html:'...'}, [child1, child2])
   */
  function el(tag, props, children) {
    var e = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') e.className = v;
        else if (k === 'html') e.innerHTML = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(e.dataset, v);
        else e.setAttribute(k, v);
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  function frag(children) {
    var f = document.createDocumentFragment();
    (children || []).forEach(function (c) { if (c) f.appendChild(c); });
    return f;
  }

  /** Кнопка со звуком нажатия. */
  function btn(label, opts) {
    opts = opts || {};
    var cls = 'btn' + (opts.variant ? ' btn--' + opts.variant : '') +
      (opts.huge ? ' btn--huge' : '') + (opts.block ? ' btn--block' : '') +
      (opts.small ? ' btn--sm' : '') + (opts.pulse ? ' btn--pulse' : '') +
      (opts.class ? ' ' + opts.class : '');
    var kids = [];
    if (opts.emoji) kids.push(el('span', { class: 'btn__emoji', text: opts.emoji }));
    kids.push(el('span', { text: label }));
    return el('button', {
      class: cls,
      type: 'button',
      onclick: function (e) {
        if (global.Sound) Sound.click();
        if (opts.onClick) opts.onClick(e);
      }
    }, kids);
  }

  function iconBtn(emoji, onClick, title) {
    return el('button', {
      class: 'icon-btn', type: 'button', title: title || '', 'aria-label': title || emoji,
      onclick: function (e) { if (global.Sound) Sound.click(); onClick && onClick(e); }
    }, [document.createTextNode(emoji)]);
  }

  /* ---------------- Формат времени ---------------- */

  function fmt(h, m) {
    h = ((h % 12) + 12) % 12; if (h === 0) h = 12;
    return h + ':' + (m < 10 ? '0' + m : m);
  }

  /** Цифровое табло. */
  function digital(h, m, small) {
    return el('div', { class: 'digital' + (small ? ' digital--sm' : '') }, [
      el('span', { text: String(((h % 12) + 12) % 12 === 0 ? 12 : ((h % 12) + 12) % 12) }),
      el('span', { class: 'digital__colon', text: ':' }),
      el('span', { text: (m < 10 ? '0' + m : String(m)) })
    ]);
  }

  /* ---------------- Звёзды ---------------- */
  function stars(count, big) {
    var wrap = el('div', { class: 'stars' + (big ? ' stars--big' : '') });
    for (var i = 0; i < 3; i++) {
      wrap.appendChild(el('span', { class: 'star' + (i < count ? ' is-on' : ''), text: '⭐' }));
    }
    return wrap;
  }

  /* ---------------- Маскот ---------------- */
  function mascot(text, emoji) {
    return el('div', { class: 'mascot' }, [
      el('div', { class: 'mascot__face', text: emoji || '🕰️' }),
      el('div', { class: 'mascot__bubble', html: text })
    ]);
  }

  /* ---------------- Экраны и роутер ---------------- */

  var appRoot = null;
  var routes = {};
  var stack = [];
  var current = null;

  function screen(className) {
    return el('div', { class: 'screen ' + (className || '') });
  }

  var mountAddT = null, mountRemoveT = null;

  /**
   * Показать экран. Важно: убираем ВСЕ предыдущие экраны и отменяем незавершённый
   * переход — иначе при быстрых повторных нажатиях (дети тапают дважды всегда)
   * в DOM оставались два живых экрана друг под другом.
   */
  function mount(node) {
    if (!appRoot) appRoot = document.getElementById('app');
    clearTimeout(mountAddT);
    clearTimeout(mountRemoveT);

    var olds = Array.prototype.slice.call(appRoot.children);

    // Экран может попросить прибраться за собой (остановить таймеры игры и т.п.)
    olds.forEach(function (o) {
      if (typeof o.__onExit === 'function') { var f = o.__onExit; o.__onExit = null; f(); }
    });

    hideFeedback(true);

    if (olds.length) {
      olds.forEach(function (o) { o.classList.add('screen--out'); });
      mountAddT = setTimeout(function () { appRoot.appendChild(node); }, 120);
      mountRemoveT = setTimeout(function () {
        olds.forEach(function (o) { if (o.parentNode) o.parentNode.removeChild(o); });
      }, 180);
    } else {
      appRoot.appendChild(node);
    }
    global.scrollTo(0, 0);
  }

  /**
   * Уборка перед постройкой нового экрана. Обязательно ДО вызова routes[name](),
   * иначе остановка анимаций погасила бы анимацию только что созданного урока.
   */
  function prepareNavigation() {
    if (global.Sound) Sound.stopTicking();
    if (global.Lessons) Lessons.stopAnims();
  }

  var Router = {
    define: function (name, fn) { routes[name] = fn; },
    go: function (name, params, opts) {
      opts = opts || {};
      if (!routes[name]) { console.error('Нет экрана:', name); return; }
      if (current && !opts.replace) stack.push(current);
      current = { name: name, params: params };
      if (global.Sound && !opts.silent) Sound.whoosh();
      prepareNavigation();
      var node = routes[name](params || {});
      mount(node);
    },
    back: function () {
      var prev = stack.pop();
      if (prev) {
        current = prev;
        prepareNavigation();
        mount(routes[prev.name](prev.params || {}));
      } else {
        Router.go('map', {}, { replace: true });
      }
    },
    reset: function (name, params) {
      stack.length = 0;
      current = null;
      Router.go(name, params, { replace: true });
    },
    current: function () { return current; }
  };

  /* ---------------- Верхняя панель ---------------- */

  function topbar(opts) {
    opts = opts || {};
    var lv = Progress.level();
    var kids = [];

    if (opts.back) {
      kids.push(iconBtn('←', opts.onBack || function () { Router.back(); }, 'Назад'));
    }
    if (opts.title) {
      kids.push(el('div', { class: 't-sub grow nowrap', text: opts.title }));
    } else {
      kids.push(el('div', { class: 'chip chip--level' }, [
        el('span', { class: 'chip__emoji', text: '🚀' }),
        el('span', { text: String(lv.level) }),
        el('span', { class: 'xpbar' }, [
          el('span', { class: 'xpbar__fill', style: { width: Math.round(lv.pct * 100) + '%' } })
        ])
      ]));
      kids.push(el('div', { class: 'chip chip--xp' }, [
        el('span', { class: 'chip__emoji', text: '💎' }),
        el('span', { text: Progress.data.xp + ' XP' })
      ]));
      if (Progress.data.streak.count > 0) {
        kids.push(el('div', { class: 'chip chip--streak' }, [
          el('span', { class: 'chip__emoji', text: '🔥' }),
          el('span', { text: String(Progress.data.streak.count) })
        ]));
      }
      kids.push(el('div', { class: 'grow' }));
    }

    if (opts.settings !== false) {
      kids.push(iconBtn('⚙️', function () { Router.go('settings'); }, 'Настройки'));
    }
    return el('div', { class: 'topbar' }, kids);
  }

  /* ---------------- Всплывающие сообщения ---------------- */

  function toast(text, opts) {
    opts = opts || {};
    var root = document.getElementById('toast-root');
    var t = el('div', { class: 'toast' + (opts.type ? ' toast--' + opts.type : '') }, [
      opts.emoji ? el('span', { text: opts.emoji, style: { fontSize: '22px' } }) : null,
      el('span', { text: text })
    ]);
    root.appendChild(t);
    setTimeout(function () {
      t.classList.add('is-out');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
    }, opts.duration || 2400);
    return t;
  }

  /* ---------------- Модальные окна ---------------- */

  function modal(opts) {
    var root = document.getElementById('modal-root');
    root.innerHTML = '';
    var box = el('div', { class: 'modal__box' }, [
      opts.emoji ? el('div', { style: { fontSize: '64px', lineHeight: '1' }, text: opts.emoji }) : null,
      opts.title ? el('h2', { class: 't-title mt-8', text: opts.title }) : null,
      opts.text ? el('p', { class: 't-body mt-8', html: opts.text }) : null,
      opts.content || null,
      el('div', { class: 'stack gap-10 mt-24' }, (opts.actions || []).map(function (a) {
        return btn(a.label, {
          variant: a.variant, block: true, emoji: a.emoji,
          onClick: function () { if (a.close !== false) closeModal(); a.onClick && a.onClick(); }
        });
      }))
    ]);
    var wrap = el('div', {}, [
      el('div', {
        class: 'modal__backdrop',
        onclick: function () { if (opts.dismissable !== false) closeModal(); }
      }),
      box
    ]);
    root.appendChild(wrap);
    root.classList.add('is-open');
    return box;
  }

  function closeModal() {
    var root = document.getElementById('modal-root');
    root.classList.remove('is-open');
    root.innerHTML = '';
  }

  /* ---------------- Панель обратной связи ---------------- */

  var fbNode = null;

  /**
   * Показать нижнюю панель: правильно / попробуй ещё.
   * @param {object} o {ok, title, hint, buttonLabel, onNext}
   */
  function feedback(o) {
    hideFeedback(true);
    var praise = o.title || (o.ok ? pickPraise() : 'Попробуй ещё раз');
    fbNode = el('div', { class: 'feedback ' + (o.ok ? 'feedback--ok' : 'feedback--try') }, [
      el('div', { class: 'feedback__text' }, [
        el('span', { class: 'feedback__emoji', text: o.ok ? pickHappy() : '🤔' }),
        el('span', {}, [
          el('span', { text: praise }),
          o.hint ? el('span', { class: 'feedback__hint', html: o.hint }) : null
        ])
      ]),
      btn(o.buttonLabel || (o.ok ? 'Дальше' : 'Понятно'), {
        variant: o.ok ? 'green' : 'yellow',
        onClick: function () { hideFeedback(); o.onNext && o.onNext(); }
      })
    ]);
    document.body.appendChild(fbNode);
    return fbNode;
  }

  function hideFeedback(instant) {
    if (!fbNode) return;
    var n = fbNode; fbNode = null;
    if (instant) { if (n.parentNode) n.parentNode.removeChild(n); return; }
    n.classList.add('is-out');
    setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 240);
  }

  // Формулировки без родовых окончаний — подходят и мальчику, и девочке
  var PRAISE = ['Отлично!', 'Молодец!', 'Супер!', 'Верно!', 'Здорово!', 'Так держать!', 'Получилось!', 'Класс!'];
  var HAPPY = ['🎉', '🌟', '🥳', '👏', '💫', '🎈', '🏅'];
  function pickPraise() { return PRAISE[Math.floor(Math.random() * PRAISE.length)]; }
  function pickHappy() { return HAPPY[Math.floor(Math.random() * HAPPY.length)]; }

  /* ---------------- Прогресс урока ---------------- */

  function lessonBar(opts) {
    var fill = el('span', { class: 'progress__fill', style: { width: (opts.percent || 0) + '%' } });
    var bar = el('div', { class: 'lesson-bar' }, [
      iconBtn('✕', opts.onExit, 'Выйти'),
      el('div', { class: 'progress' }, [fill]),
      el('div', { class: 'chip', style: { height: '38px', padding: '0 12px' } }, [
        el('span', { class: 'chip__emoji', text: '⭐' }),
        el('span', { text: String(opts.score || 0) })
      ])
    ]);
    bar.setPercent = function (p) { fill.style.width = p + '%'; };
    bar.setScore = function (s) { bar.querySelector('.chip span:last-child').textContent = String(s); };
    return bar;
  }

  /* ---------------- Прочее ---------------- */

  /** Перемешать массив (алгоритм Фишера—Йетса). */
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function rnd(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /** Показать награду за достижение. */
  function achievementToast(ach) {
    if (global.Sound) Sound.reward();
    if (global.FX) FX.rain([ach.emoji, '⭐', '✨'], 14);
    toast('Новое достижение: ' + ach.title, { type: 'gold', emoji: ach.emoji, duration: 3200 });
  }

  global.UI = {
    el: el, frag: frag, btn: btn, iconBtn: iconBtn,
    screen: screen, mount: mount, topbar: topbar,
    toast: toast, modal: modal, closeModal: closeModal,
    feedback: feedback, hideFeedback: hideFeedback,
    digital: digital, stars: stars, mascot: mascot, lessonBar: lessonBar,
    fmt: fmt, shuffle: shuffle, rnd: rnd, delay: delay,
    achievementToast: achievementToast,
    Router: Router
  };
  global.Router = Router;

})(window);
