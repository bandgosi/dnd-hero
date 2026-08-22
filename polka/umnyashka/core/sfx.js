/* =========================================================
   core/sfx.js — звуковые эффекты через Web Audio API.
   Без внешних файлов: приложение работает офлайн.
   ========================================================= */
(function (global) {
  'use strict';

  var ctx = null, master = null;

  function ensure() {
    if (ctx) return ctx;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.3;
    master.connect(ctx.destination);
    return ctx;
  }

  function on() { return !!(global.Store && Store.settings.sound); }

  function tone(o) {
    if (!on() || !ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    var t0 = ctx.currentTime + (o.at || 0);
    var dur = o.dur || 0.18;
    var osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t0 + dur);
    var vol = Math.max(0.0001, o.vol === undefined ? 0.5 : o.vol);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.03, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  function noise(o) {
    if (!on() || !ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    var dur = o.dur || 0.12, t0 = ctx.currentTime + (o.at || 0);
    var n = Math.floor(ctx.sampleRate * dur);
    var buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    var src = ctx.createBufferSource(); src.buffer = buf;
    var f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = o.freq || 1200;
    var g = ctx.createGain(); g.gain.value = o.vol === undefined ? 0.35 : o.vol;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0);
  }

  function mel(notes, o) {
    o = o || {};
    notes.forEach(function (n, i) {
      tone({
        freq: n.f, to: n.to, at: n.at !== undefined ? n.at : i * (o.step || 0.09),
        dur: n.dur || o.dur || 0.22, type: o.type || 'triangle', vol: n.vol || o.vol || 0.4
      });
    });
  }

  var N = { C4:261.6,D4:293.7,E4:329.6,F4:349.2,G4:392,A4:440,B4:493.9,
            C5:523.3,D5:587.3,E5:659.3,G5:784,A5:880,B5:987.8,C6:1046.5,D6:1174.7,E6:1318.5,G6:1568 };

  var SFX = {
    unlock: function () { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
    tap:    function () { tone({ freq: 620, to: 780, dur: .07, type: 'triangle', vol: .22 }); },
    tick:   function () { tone({ freq: 900, dur: .035, type: 'square', vol: .09 }); },
    right:  function () { mel([{f:N.C5},{f:N.E5},{f:N.G5},{f:N.C6,dur:.32}], {step:.07, vol:.38}); },
    almost: function () { mel([{f:N.E4,dur:.15},{f:N.C4,dur:.24}], {step:.12, type:'sine', vol:.28}); },
    reward: function () {
      mel([{f:N.G5},{f:N.B5},{f:N.D6},{f:N.G6,dur:.46}], {step:.08, type:'sine', vol:.32});
      tone({ freq: 2400, to: 3600, at:.1, dur:.45, type:'sine', vol:.05 });
    },
    levelUp:function () { mel([{f:N.C5},{f:N.D5},{f:N.E5},{f:N.G5},{f:N.C6,dur:.42}], {step:.085, vol:.38}); },
    fanfare:function () {
      mel([{f:N.C5,dur:.2},{f:N.C5,dur:.16},{f:N.C5,dur:.16},{f:N.C5,dur:.32},
           {f:N.G4,dur:.32},{f:N.A4,dur:.2},{f:N.C5,dur:.2},{f:N.A4,dur:.16},{f:N.C5,dur:.66}],
          {step:.18, vol:.4});
    },
    star:   function (i) { var f=[N.C5,N.E5,N.G5][(i||0)%3]; tone({freq:f, to:f*2, dur:.3, type:'sine', vol:.28}); },
    pop:    function () { noise({freq:1500, dur:.11, vol:.38}); tone({freq:380, to:120, dur:.1, type:'sine', vol:.2}); },
    whoosh: function () { tone({ freq:200, to:900, dur:.2, type:'sine', vol:.1 }); },
    draw:   function () { tone({ freq: 1200, dur:.02, type:'sine', vol:.05 }); },
    beep:   function (last) { tone({ freq:last?880:520, dur:last?.4:.12, type:'square', vol:.18 }); }
  };

  global.SFX = SFX;

  ['pointerdown','keydown','touchstart'].forEach(function (ev) {
    global.addEventListener(ev, function once() {
      SFX.unlock();
      global.removeEventListener(ev, once);
    }, { passive: true });
  });

})(window);
