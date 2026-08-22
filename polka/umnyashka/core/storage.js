/* =========================================================
   core/storage.js — адаптер хранилища.
   Единственное место, знающее про LocalStorage. Чтобы перейти
   на backend, достаточно заменить реализацию трёх методов.
   ========================================================= */
(function (global) {
  'use strict';

  var warned = false;
  var memory = {};          // запасное хранилище, если localStorage недоступен
  var available = (function () {
    try {
      var k = '__umn_test__';
      global.localStorage.setItem(k, '1');
      global.localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  })();

  function warnOnce(e) {
    if (warned) return;
    warned = true;
    console.warn('Прогресс сохраняется только на время сеанса:', e && e.message);
  }

  global.Storage2 = {
    available: available,

    get: function (key, fallback) {
      try {
        // Память — всегда актуальный кеш: иначе после сбоя записи
        // чтение возвращало бы устаревшие данные
        var raw = Object.prototype.hasOwnProperty.call(memory, key)
          ? memory[key]
          : (available ? global.localStorage.getItem(key) : null);
        if (raw === null || raw === undefined) return fallback;
        return JSON.parse(raw);
      } catch (e) {
        warnOnce(e);
        return fallback;
      }
    },

    set: function (key, value) {
      var raw;
      try { raw = JSON.stringify(value); }
      catch (e) { warnOnce(e); return false; }
      memory[key] = raw;
      if (!available) return false;
      try {
        global.localStorage.setItem(key, raw);
        return true;
      } catch (e) {
        // Не гасим хранилище навсегда: место могло освободиться,
        // пробуем снова при следующей записи
        warnOnce(e);
        if (Storage2.onFail) Storage2.onFail(e);
        return false;
      }
    },

    remove: function (key) {
      try {
        if (available) global.localStorage.removeItem(key);
        delete memory[key];
      } catch (e) { warnOnce(e); }
    }
  };

})(window);
