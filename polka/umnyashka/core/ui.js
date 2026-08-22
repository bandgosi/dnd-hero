/* =========================================================
   core/ui.js — базовые элементы интерфейса.
   ========================================================= */
(function (global) {
  'use strict';

  /** el('div', {class:'card', onclick:fn}, [дети]) */
  function el(tag, props, kids) {
    var e = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    });
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  function btn(label, o) {
    o = o || {};
    var cls = 'btn' + (o.variant ? ' btn--' + o.variant : '') +
      (o.huge ? ' btn--huge' : '') + (o.block ? ' btn--block' : '') +
      (o.small ? ' btn--sm' : '') + (o.pulse ? ' btn--pulse' : '') + (o.class ? ' ' + o.class : '');
    return el('button', {
      class: cls, type: 'button',
      onclick: function (e) { SFX.tap(); if (o.onClick) o.onClick(e); }
    }, [
      o.emoji ? el('span', { class: 'btn__emoji', text: o.emoji }) : null,
      el('span', { text: label })
    ]);
  }

  function iconBtn(emoji, onClick, title) {
    return el('button', {
      class: 'icon-btn', type: 'button', title: title || '', 'aria-label': title || emoji,
      onclick: function (e) { SFX.tap(); onClick && onClick(e); }
    }, [document.createTextNode(emoji)]);
  }

  /** Кнопка «Послушать» — обязательна в каждом задании. */
  function speakBtn(getText, label) {
    var b = el('button', {
      class: 'speak-btn', type: 'button', 'aria-label': 'Послушать задание',
      onclick: function () {
        SFX.tap();
        var t = typeof getText === 'function' ? getText() : getText;
        b.classList.add('is-playing');
        Promise.resolve(Speech.phrase(t)).then(function () { b.classList.remove('is-playing'); });
        setTimeout(function () { b.classList.remove('is-playing'); }, 4000);
      }
    }, [
      el('span', { class: 'speak-btn__ico', text: '🔊' }),
      el('span', { text: label || 'Послушать' })
    ]);
    return b;
  }

  function chip(text, mod, emoji) {
    return el('span', { class: 'chip' + (mod ? ' chip--' + mod : '') }, [
      emoji ? el('span', { text: emoji }) : null,
      el('span', { text: text })
    ]);
  }

  function bar(percent, big) {
    var fill = el('span', { class: 'bar__fill', style: { width: Math.max(0, Math.min(100, percent)) + '%' } });
    var b = el('div', { class: 'bar' + (big ? ' bar--lg' : '') }, [fill]);
    b.setPercent = function (p) { fill.style.width = Math.max(0, Math.min(100, p)) + '%'; };
    return b;
  }

  function stars(n, big, max) {
    max = max || 3;
    var w = el('div', { class: 'stars' + (big ? ' stars--big' : '') });
    for (var i = 0; i < max; i++) {
      w.appendChild(el('span', { class: 'star' + (i < n ? ' is-on' : ''), text: '⭐' }));
    }
    return w;
  }

  /* ---------------- Экран ---------------- */
  function screen(cls) { return el('div', { class: 'screen ' + (cls || '') }); }

  function topbar(o) {
    o = o || {};
    var kids = [];
    if (o.back !== false) kids.push(iconBtn('←', o.onBack || function () { Router.back(); }, 'Назад'));
    if (o.title) kids.push(el('div', { class: 'topbar__title grow nowrap', text: o.title }));
    else kids.push(el('div', { class: 'grow' }));
    (o.right || []).forEach(function (r) { kids.push(r); });
    return el('div', { class: 'topbar' }, kids);
  }

  /* ---------------- Тосты ---------------- */
  function toast(text, o) {
    o = o || {};
    var root = document.getElementById('toast-root');
    var t = el('div', { class: 'toast' + (o.type ? ' toast--' + o.type : '') }, [
      o.emoji ? el('span', { text: o.emoji, style: { fontSize: '22px' } }) : null,
      el('span', { text: text })
    ]);
    root.appendChild(t);
    setTimeout(function () {
      t.classList.add('is-out');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
    }, o.duration || 2400);
    return t;
  }

  /* ---------------- Модалки ---------------- */
  var modalLocked = false;

  function modal(o) {
    var root = document.getElementById('modal-root');
    root.innerHTML = '';
    modalLocked = o.dismissable === false;
    var box = el('div', {
      class: 'modal__box', role: 'dialog', 'aria-modal': 'true',
      'aria-label': o.title || 'Окно'
    }, [
      o.emoji ? el('div', { style: { fontSize: '62px', lineHeight: '1' }, text: o.emoji }) : null,
      o.title ? el('h2', { class: 't-title mt2', text: o.title }) : null,
      o.text ? el('p', { class: 't-body mt2', html: o.text }) : null,
      o.content || null,
      el('div', { class: 'stack g3 mt6' }, (o.actions || []).map(function (a) {
        return btn(a.label, {
          variant: a.variant, block: true, emoji: a.emoji,
          onClick: function () { if (a.close !== false) closeModal(true); a.onClick && a.onClick(); }
        });
      }))
    ]);
    root.appendChild(el('div', {}, [
      el('div', { class: 'modal__bd', onclick: function () { closeModal(); } }),
      box
    ]));
    root.classList.add('is-open');
    if (o.speak) Speech.phrase(o.speak);
    var first = box.querySelector('button');
    if (first) setTimeout(function () { try { first.focus(); } catch (e) {} }, 40);
    return box;
  }

  /** force=true нужен кнопкам самого окна; обычный вызов не закроет окно правил. */
  function closeModal(force) {
    if (modalLocked && !force) return;
    modalLocked = false;
    var root = document.getElementById('modal-root');
    root.classList.remove('is-open');
    root.innerHTML = '';
  }

  /* ---------------- Обратная связь ---------------- */
  var fbNode = null;
  var PRAISE = ['Отлично!', 'Молодец!', 'Супер!', 'Верно!', 'Здорово!', 'Получилось!', 'Так держать!', 'Красота!'];
  var SOFT = ['Почти! Давай попробуем ещё раз.', 'Хорошая попытка! Посмотри внимательно.',
              'Уже близко! Попробуй ещё разок.', 'Ничего страшного, пробуем снова.'];
  var HAPPY = ['🎉', '🌟', '🥳', '👏', '💫', '🎈', '🏅'];

  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  function feedback(o) {
    hideFeedback(true);
    var title = o.title || (o.ok ? pick(PRAISE) : pick(SOFT));
    fbNode = el('div', { class: 'feedback ' + (o.ok ? 'feedback--ok' : 'feedback--try'), role: 'status' }, [
      el('div', { class: 'feedback__text' }, [
        el('span', { class: 'feedback__emoji', text: o.ok ? pick(HAPPY) : '🤔' }),
        el('span', {}, [
          el('span', { text: title }),
          o.hint ? el('span', { class: 'feedback__hint', html: o.hint }) : null
        ])
      ]),
      btn(o.buttonLabel || (o.ok ? 'Дальше' : 'Понятно'), {
        variant: o.ok ? 'grass' : 'sun',
        onClick: function () { hideFeedback(); o.onNext && o.onNext(); }
      })
    ]);
    document.body.appendChild(fbNode);
    // Подсказка — это и есть методика («показывай пальчиком каждое яблоко»).
    // Ребёнок ещё не читает, поэтому произносим её вместе с заголовком.
    if (o.speak !== false) {
      var voice = title + (o.hint ? '. ' + String(o.hint).replace(/<[^>]*>/g, '') : '');
      Speech.phrase(voice);
    }
    return fbNode;
  }

  function hideFeedback(instant) {
    if (!fbNode) return;
    var n = fbNode; fbNode = null;
    if (instant) { if (n.parentNode) n.parentNode.removeChild(n); return; }
    n.classList.add('is-out');
    setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 220);
  }

  /* ---------------- Мелочи ---------------- */
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function rnd(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /** Обёртка «сработает один раз» — защита от двойного тапа. */
  function once(fn) {
    var used = false;
    return function () { if (used) return; used = true; return fn.apply(this, arguments); };
  }

  function achievementToast(a) {
    SFX.reward();
    FX.rain([a.emoji, '⭐', '✨'], 14);
    toast('Новая награда: ' + a.title, { type: 'gold', emoji: a.emoji, duration: 3200 });
    Speech.phrase('Новая награда! ' + a.title);
  }

  global.UI = {
    el: el, btn: btn, iconBtn: iconBtn, speakBtn: speakBtn, chip: chip, bar: bar, stars: stars,
    screen: screen, topbar: topbar, toast: toast, modal: modal, closeModal: closeModal,
    feedback: feedback, hideFeedback: hideFeedback,
    shuffle: shuffle, rnd: rnd, delay: delay, once: once, pick: pick,
    achievementToast: achievementToast
  };

})(window);
