/* =========================================================
   core/fx.js — конфетти, салют, дождь наклеек на <canvas>.
   ========================================================= */
(function (global) {
  'use strict';

  var canvas, ctx, raf = null, dpr = 1, enabled = true;
  var parts = [];
  var COLORS = ['#7C5CE0','#17A2B8','#FFB300','#2FB86B','#FF7A66','#4C9AFF','#FFAB7B'];

  function init() {
    canvas = document.getElementById('fx-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    if (!ctx) return;
    resize();
    global.addEventListener('resize', resize);
  }

  function resize() {
    if (!canvas || !ctx) return;
    dpr = Math.min(global.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(global.innerWidth * dpr);
    canvas.height = Math.floor(global.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  function loop() {
    raf = null;
    if (!ctx) return;
    ctx.clearRect(0, 0, global.innerWidth, global.innerHeight);
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.vy += p.g; p.vx *= p.drag; p.vy *= p.drag;
      p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life--;
      ctx.save();
      ctx.globalAlpha = p.life < 30 ? Math.max(0, p.life / 30) : 1;
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      if (p.kind === 'emoji') {
        ctx.font = p.size + 'px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(p.emoji, 0, 0);
      } else if (p.kind === 'circle') {
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = p.color;
        var h = Math.abs(Math.cos(p.rot * 1.6)) * p.size + 2;
        ctx.fillRect(-p.size / 2, -h / 2, p.size, h);
      }
      ctx.restore();
      if (p.life <= 0 || p.y > global.innerHeight + 60) parts.splice(i, 1);
    }
    if (parts.length) raf = requestAnimationFrame(loop);
    else ctx.clearRect(0, 0, global.innerWidth, global.innerHeight);
  }

  function start() {
    if (parts.length > 420) parts.splice(0, parts.length - 420);
    if (!raf && parts.length) raf = requestAnimationFrame(loop);
  }

  var FX = {
    init: init,
    setEnabled: function (v) { enabled = !!v; if (!enabled) FX.clear(); },
    clear: function () { parts.length = 0; if (ctx) ctx.clearRect(0, 0, global.innerWidth, global.innerHeight); },

    confetti: function (o) {
      if (!enabled || !ctx) return;
      o = o || {};
      var n = o.count || 90, w = global.innerWidth, h = global.innerHeight;
      var src = o.sources || [{ x: w * .08, y: h * .85, ax: 1 }, { x: w * .92, y: h * .85, ax: -1 }];
      src.forEach(function (s) {
        for (var i = 0; i < n / src.length; i++) {
          var sp = rnd(9, 19), a = rnd(-Math.PI * .72, -Math.PI * .28);
          parts.push({
            kind: Math.random() < .45 ? 'rect' : 'circle',
            x: s.x, y: s.y,
            vx: Math.cos(a) * sp * (s.ax || 1) * rnd(.6, 1.2), vy: Math.sin(a) * sp,
            g: .32, drag: .985, size: rnd(8, 16), color: pick(o.colors || COLORS),
            rot: rnd(0, 6.28), vr: rnd(-.28, .28), life: rnd(110, 190)
          });
        }
      });
      start();
    },

    burst: function (x, y, o) {
      if (!enabled || !ctx) return;
      o = o || {};
      var n = o.count || 26;
      for (var i = 0; i < n; i++) {
        var a = (Math.PI * 2 * i) / n + rnd(-.16, .16), sp = rnd(4, 11);
        parts.push({
          kind: o.emoji ? 'emoji' : 'circle', emoji: o.emoji,
          x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          g: o.gravity === undefined ? .2 : o.gravity, drag: .96,
          size: o.size || rnd(8, 15), color: pick(o.colors || COLORS),
          rot: 0, vr: rnd(-.2, .2), life: rnd(55, 95)
        });
      }
      start();
    },

    rain: function (emojis, n) {
      if (!enabled || !ctx) return;
      n = n || 20;
      for (var i = 0; i < n; i++) {
        parts.push({
          kind: 'emoji', emoji: pick(emojis),
          x: rnd(0, global.innerWidth), y: rnd(-global.innerHeight * .5, -20),
          vx: rnd(-1.2, 1.2), vy: rnd(1.5, 4.5), g: .045, drag: .999,
          size: rnd(24, 44), color: '#fff', rot: rnd(-.5, .5), vr: rnd(-.05, .05),
          life: rnd(220, 360)
        });
      }
      start();
    },

    fireworks: function (times) {
      if (!enabled || !ctx) return;
      times = times || 5;
      for (var i = 0; i < times; i++) {
        (function (k) {
          setTimeout(function () {
            FX.burst(rnd(global.innerWidth * .15, global.innerWidth * .85),
                     rnd(global.innerHeight * .15, global.innerHeight * .55), { count: 32, size: 11 });
            if (global.SFX) SFX.star(k);
          }, k * 400);
        })(i);
      }
    },

    at: function (elm, emoji) {
      if (!enabled || !elm || !elm.getBoundingClientRect) return;
      var r = elm.getBoundingClientRect();
      FX.burst(r.left + r.width / 2, r.top + r.height / 2,
               { count: 12, emoji: emoji || '✨', size: 22, gravity: .12 });
    }
  };

  global.FX = FX;

})(window);
