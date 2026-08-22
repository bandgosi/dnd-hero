/* =========================================================
   audio.js — все звуки синтезируются через Web Audio API.
   Никаких внешних файлов: приложение работает офлайн.
   ========================================================= */
(function (global) {
  'use strict';

  var ctx = null;
  var master = null;
  var enabled = true;
  var tickTimer = null;

  /** Ленивое создание аудио-контекста (браузеры требуют жест пользователя). */
  function ensure() {
    if (ctx) return ctx;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
    return ctx;
  }

  function now() { return ctx ? ctx.currentTime : 0; }

  /**
   * Один тон с плавной огибающей.
   * @param {object} o freq, to (глиссандо), type, at (задержка), dur, vol
   */
  function tone(o) {
    if (!enabled) return;
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();

    var t0 = now() + (o.at || 0);
    var dur = o.dur || 0.18;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();

    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t0 + dur);

    var vol = (o.vol === undefined ? 0.5 : o.vol);
    // Мягкая атака и затухание, чтобы не было щелчков
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.03, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  /** Короткий шумовой всплеск — для «лопания» шарика. */
  function noise(o) {
    if (!enabled || !ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    var dur = o.dur || 0.12;
    var t0 = now() + (o.at || 0);
    var frames = Math.floor(ctx.sampleRate * dur);
    var buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < frames; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, 2);
    }
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = o.freq || 1200;
    filter.Q.value = 0.9;
    var g = ctx.createGain();
    g.gain.value = (o.vol === undefined ? 0.4 : o.vol);
    src.connect(filter); filter.connect(g); g.connect(master);
    src.start(t0);
  }

  /** Аккорд/мелодия из списка нот. */
  function melody(notes, opts) {
    opts = opts || {};
    notes.forEach(function (n, i) {
      tone({
        freq: n.f,
        to: n.to,
        at: (n.at !== undefined ? n.at : i * (opts.step || 0.1)),
        dur: n.dur || opts.dur || 0.22,
        type: opts.type || 'triangle',
        vol: n.vol || opts.vol || 0.42
      });
    });
  }

  // Частоты нот (для читаемости мелодий)
  var N = {
    C4: 261.6, D4: 293.7, E4: 329.6, F4: 349.2, G4: 392.0, A4: 440.0, B4: 493.9,
    C5: 523.3, D5: 587.3, E5: 659.3, F5: 698.5, G5: 784.0, A5: 880.0, B5: 987.8,
    C6: 1046.5, D6: 1174.7, E6: 1318.5, G6: 1568.0
  };

  var Sound = {
    /** Разблокировка звука по первому касанию экрана. */
    unlock: function () {
      ensure();
      if (ctx && ctx.state === 'suspended') ctx.resume();
    },

    setEnabled: function (v) {
      enabled = !!v;
      if (!enabled) Sound.stopTicking();
    },

    isEnabled: function () { return enabled; },

    /** Нажатие кнопки. */
    click: function () {
      tone({ freq: 620, to: 780, dur: 0.07, type: 'triangle', vol: 0.25 });
    },

    /** Мягкое «тук» при перетаскивании стрелки на деление. */
    notch: function () {
      tone({ freq: 900, dur: 0.035, type: 'square', vol: 0.09 });
    },

    /** Верный ответ — весёлое трезвучие вверх. */
    success: function () {
      melody([
        { f: N.C5 }, { f: N.E5 }, { f: N.G5 }, { f: N.C6, dur: 0.34 }
      ], { step: 0.075, type: 'triangle', vol: 0.4 });
    },

    /** Неверный ответ — не обидный, мягкий «пум-пум». */
    error: function () {
      melody([
        { f: N.E4, dur: 0.16 }, { f: N.C4, dur: 0.26 }
      ], { step: 0.13, type: 'sine', vol: 0.3 });
    },

    /** Появление награды — «блеск». */
    reward: function () {
      melody([
        { f: N.G5 }, { f: N.B5 }, { f: N.D6 }, { f: N.G6, dur: 0.5 }
      ], { step: 0.085, type: 'sine', vol: 0.34 });
      tone({ freq: 2400, to: 3600, at: 0.1, dur: 0.5, type: 'sine', vol: 0.06 });
    },

    /** Новый уровень. */
    levelUp: function () {
      melody([
        { f: N.C5 }, { f: N.D5 }, { f: N.E5 }, { f: N.G5 }, { f: N.C6, dur: 0.45 }
      ], { step: 0.09, type: 'triangle', vol: 0.4 });
    },

    /** Финальные фанфары. */
    fanfare: function () {
      melody([
        { f: N.C5, dur: 0.2 }, { f: N.C5, dur: 0.16 }, { f: N.C5, dur: 0.16 },
        { f: N.C5, dur: 0.34 }, { f: N.G4, dur: 0.34 }, { f: N.A4, dur: 0.2 },
        { f: N.C5, dur: 0.2 }, { f: N.A4, dur: 0.16 }, { f: N.C5, dur: 0.7 }
      ], { step: 0.19, type: 'triangle', vol: 0.42 });
    },

    /** Лопнувший шарик. */
    pop: function () {
      noise({ freq: 1500, dur: 0.11, vol: 0.4 });
      tone({ freq: 380, to: 120, dur: 0.1, type: 'sine', vol: 0.22 });
    },

    /** Полёт/переход. */
    whoosh: function () {
      tone({ freq: 200, to: 900, dur: 0.22, type: 'sine', vol: 0.12 });
    },

    /** Звёздочка. */
    star: function (i) {
      var f = [N.C5, N.E5, N.G5][i % 3];
      tone({ freq: f, to: f * 2, dur: 0.32, type: 'sine', vol: 0.3 });
    },

    /** Гудок паровоза. */
    train: function () {
      tone({ freq: 180, dur: 0.5, type: 'sawtooth', vol: 0.14 });
      tone({ freq: 240, at: 0.05, dur: 0.45, type: 'sine', vol: 0.16 });
    },

    /** Одиночный тик часов. */
    tick: function () {
      tone({ freq: 1400, dur: 0.02, type: 'square', vol: 0.07 });
    },

    /** Непрерывное тиканье (используется в анимациях объяснений). */
    startTicking: function (intervalMs) {
      Sound.stopTicking();
      if (!enabled) return;
      tickTimer = setInterval(Sound.tick, intervalMs || 1000);
    },

    stopTicking: function () {
      if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    },

    /** Обратный отсчёт в играх на время. */
    beep: function (last) {
      tone({ freq: last ? 880 : 520, dur: last ? 0.4 : 0.12, type: 'square', vol: 0.2 });
    }
  };

  global.Sound = Sound;

  // Первое касание/клик разблокирует аудио-контекст
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
    global.addEventListener(ev, function once() {
      Sound.unlock();
      global.removeEventListener(ev, once);
    }, { passive: true });
  });

})(window);
