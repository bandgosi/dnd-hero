/* =========================================================
   core/mascot.js — персонаж-помощник.
   Говорит, радуется, поддерживает. Носит награды-предметы.
   ========================================================= */
(function (global) {
  'use strict';

  var el = function () { return UI.el.apply(null, arguments); };

  function avatar(opts) {
    opts = opts || {};
    var ch = Characters.byId(Store.data.character);
    var eq = Store.data.equipped || {};
    var kids = [document.createTextNode(ch.emoji)];

    if (!opts.plain) {
      ['hat', 'glasses', 'bag', 'pet'].forEach(function (slot) {
        var id = eq[slot];
        if (!id) return;
        var r = Achievements.rewardById(id);
        if (r) kids.push(el('span', { class: 'mascot__item mascot__item--' + slot, text: r.emoji }));
      });
    }
    return el('div', { class: 'mascot__ava', 'aria-hidden': 'true' }, kids);
  }

  /**
   * Персонаж с репликой.
   * @param {string} text  что говорит
   * @param {object} o     {center, big, speak, actions}
   */
  function say(text, o) {
    o = o || {};
    var ava = avatar();
    // Только текст: в реплику подставляется имя ребёнка, а оно не должно
    // толковаться как разметка
    var textSpan = el('span', { text: stripTags(text) });
    var bubble = el('div', { class: 'mascot__bubble' }, [
      textSpan,
      o.actions ? el('div', { class: 'row g2 mt3 wrap' }, o.actions) : null
    ]);
    var node = el('div', {
      class: 'mascot' + (o.center ? ' mascot--center' : '') + (o.big ? ' mascot--big' : '')
    }, o.center ? [ava, bubble] : [ava, bubble]);

    node.ava = ava;
    node.setText = function (t) { textSpan.textContent = stripTags(t); };
    node.react = function (kind) {
      ava.classList.remove('is-happy', 'is-think');
      if (kind) ava.classList.add('is-' + kind);
      if (kind === 'happy') setTimeout(function () { ava.classList.remove('is-happy'); }, 1400);
    };

    if (o.speak !== false) {
      // Небольшая пауза: реплика не должна перебивать звук перехода
      setTimeout(function () {
        if (document.body.contains(node)) Speech.phrase(stripTags(text));
      }, o.delay === undefined ? 260 : o.delay);
    }
    return node;
  }

  function stripTags(s) { return String(s).replace(/<[^>]*>/g, ''); }

  var Mascot = {
    avatar: avatar,
    say: say,
    line: function (key, vars) { return Characters.line(key, vars); },

    /** Короткая реплика по ключу. */
    speakLine: function (key, vars) {
      var t = Characters.line(key, vars);
      if (t) Speech.phrase(t);
      return t;
    },

    current: function () { return Characters.byId(Store.data.character); }
  };

  global.Mascot = Mascot;

})(window);
