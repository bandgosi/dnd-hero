/* =========================================================
   core/router.js — экраны и переходы.
   Маршруты зарегистрированы статически: попасть в несуществующий
   экран невозможно, неизвестный маршрут ведёт на главный.
   ========================================================= */
(function (global) {
  'use strict';

  var routes = {};
  var stack = [];
  var current = null;
  var root = null;
  var addT = null, removeT = null;
  var pending = null;   // экран, построенный, но ещё не вставленный в документ
  var seq = 0;          // защита от экрана, который сам уводит нас дальше

  /** Уборка перед постройкой нового экрана. */
  function prepare() {
    if (global.Speech) Speech.stop();
    if (global.UI) { UI.hideFeedback(true); UI.closeModal(true); }
  }

  /** Дать экрану прибраться за собой (снять таймеры игры, записать время урока). */
  function leave(node) {
    if (node && typeof node.__onLeave === 'function') {
      var f = node.__onLeave;
      node.__onLeave = null;
      try { f(); } catch (e) { console.error('Ошибка при уходе с экрана', e); }
    }
  }

  function mount(node) {
    if (!root) root = document.getElementById('app');
    clearTimeout(addT); clearTimeout(removeT);

    // Двойной тап: предыдущий экран мог не успеть смонтироваться —
    // без этого его таймеры оставались жить без экрана
    if (pending && pending !== node) leave(pending);
    pending = node;

    var olds = Array.prototype.slice.call(root.children);
    olds.forEach(leave);

    if (olds.length) {
      olds.forEach(function (o) { o.classList.add('screen--out'); });
      addT = setTimeout(function () { pending = null; root.appendChild(node); }, 110);
      removeT = setTimeout(function () {
        olds.forEach(function (o) { if (o.parentNode) o.parentNode.removeChild(o); });
      }, 180);
    } else {
      pending = null;
      root.appendChild(node);
    }
    global.scrollTo(0, 0);
  }

  var Router = {
    define: function (name, fn) { routes[name] = fn; },

    has: function (name) { return !!routes[name]; },

    go: function (name, params, opts) {
      opts = opts || {};
      if (!routes[name]) {
        console.warn('Неизвестный экран:', name, '— уходим на главный');
        name = 'home'; params = {};
      }
      if (current && !opts.replace) stack.push(current);
      if (stack.length > 30) stack.splice(0, stack.length - 30);
      current = { name: name, params: params || {} };
      if (!opts.silent && global.SFX) SFX.whoosh();
      prepare();
      var token = ++seq;
      var node = routes[name](params || {});
      // Экран сам увёл нас дальше (например, не нашёл урок) — пустышку не монтируем,
      // иначе ребёнок получал белый экран без единой кнопки
      if (token !== seq) return;
      mount(node);
    },

    back: function () {
      var prev = stack.pop();
      if (prev) {
        current = prev;
        prepare();
        var token = ++seq;
        var node = routes[prev.name](prev.params || {});
        if (token !== seq) return;
        mount(node);
      } else {
        Router.go('home', {}, { replace: true });
      }
    },

    /** Сбросить стек и уйти на экран (для «домой»). */
    reset: function (name, params) {
      stack.length = 0;
      current = null;
      Router.go(name, params, { replace: true });
    },

    current: function () { return current; }
  };

  global.Router = Router;

})(window);
