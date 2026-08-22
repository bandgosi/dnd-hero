/* =========================================================
   fx.js — конфетти, звёзды и салют на <canvas>.
   Без библиотек: физика частиц + requestAnimationFrame.
   ========================================================= */
(function (global) {
  'use strict';

  var canvas, ctx, raf = null, dpr = 1;
  var particles = [];
  var enabled = true;

  var COLORS = ['#3DA9FC', '#35C77B', '#FFC93C', '#A78BFA', '#FF9F45', '#6FE3C4', '#FF8FA3'];

  function init() {
    canvas = document.getElementById('fx-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    resize();
    global.addEventListener('resize', resize);
  }

  function resize() {
    if (!canvas) return;
    dpr = Math.min(global.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(global.innerWidth * dpr);
    canvas.height = Math.floor(global.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function loop() {
    raf = null;
    if (!ctx) return;
    ctx.clearRect(0, 0, global.innerWidth, global.innerHeight);

    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.vy += p.g;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.life -= 1;

      var alpha = p.life < 30 ? Math.max(0, p.life / 30) : 1;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);

      if (p.kind === 'emoji') {
        ctx.font = p.size + 'px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.emoji, 0, 0);
      } else if (p.kind === 'circle') {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'ribbon') {
        ctx.fillStyle = p.color;
        // «Лента» — прямоугольник, который сплющивается при вращении
        var h = Math.abs(Math.cos(p.rot * 1.6)) * p.size + 2;
        ctx.fillRect(-p.size / 2, -h / 2, p.size, h);
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      }
      ctx.restore();

      if (p.life <= 0 || p.y > global.innerHeight + 60) particles.splice(i, 1);
    }

    if (particles.length) {
      raf = requestAnimationFrame(loop);
    } else {
      ctx.clearRect(0, 0, global.innerWidth, global.innerHeight);
    }
  }

  function start() {
    if (!raf && particles.length) raf = requestAnimationFrame(loop);
  }

  /** Ограничиваем число частиц, чтобы не проседал слабый планшет. */
  function cap() {
    if (particles.length > 400) particles.splice(0, particles.length - 400);
  }

  var FX = {
    init: init,

    setEnabled: function (v) {
      enabled = !!v;
      if (!enabled) FX.clear();
    },

    clear: function () {
      particles.length = 0;
      if (ctx) ctx.clearRect(0, 0, global.innerWidth, global.innerHeight);
    },

    /** Классическое конфетти сверху вниз (по умолчанию — из двух углов). */
    confetti: function (opts) {
      if (!enabled || !ctx) return;
      opts = opts || {};
      var count = opts.count || 90;
      var w = global.innerWidth, h = global.innerHeight;
      var sources = opts.sources || [
        { x: w * 0.08, y: h * 0.85, ax: 1 },
        { x: w * 0.92, y: h * 0.85, ax: -1 }
      ];

      sources.forEach(function (s) {
        for (var i = 0; i < count / sources.length; i++) {
          var speed = rnd(9, 19);
          var angle = rnd(-Math.PI * 0.72, -Math.PI * 0.28);
          particles.push({
            kind: Math.random() < 0.3 ? 'ribbon' : (Math.random() < 0.5 ? 'rect' : 'circle'),
            x: s.x, y: s.y,
            vx: Math.cos(angle) * speed * (s.ax || 1) * rnd(0.6, 1.2),
            vy: Math.sin(angle) * speed,
            g: 0.32, drag: 0.985,
            size: rnd(8, 16),
            color: pick(opts.colors || COLORS),
            rot: rnd(0, Math.PI * 2), vr: rnd(-0.28, 0.28),
            life: rnd(110, 190)
          });
        }
      });
      cap(); start();
    },

    /** Салют из точки (например, из центра часов). */
    burst: function (x, y, opts) {
      if (!enabled || !ctx) return;
      opts = opts || {};
      var count = opts.count || 30;
      for (var i = 0; i < count; i++) {
        var a = (Math.PI * 2 * i) / count + rnd(-0.16, 0.16);
        var sp = rnd(4, 12);
        particles.push({
          kind: opts.emoji ? 'emoji' : 'circle',
          emoji: opts.emoji,
          x: x, y: y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          g: opts.gravity === undefined ? 0.22 : opts.gravity,
          drag: 0.96,
          size: opts.size || rnd(8, 15),
          color: pick(opts.colors || COLORS),
          rot: 0, vr: rnd(-0.2, 0.2),
          life: rnd(60, 100)
        });
      }
      cap(); start();
    },

    /** Дождь из эмодзи-наклеек сверху. */
    rain: function (emojis, count) {
      if (!enabled || !ctx) return;
      count = count || 24;
      for (var i = 0; i < count; i++) {
        particles.push({
          kind: 'emoji',
          emoji: pick(emojis),
          x: rnd(0, global.innerWidth),
          y: rnd(-global.innerHeight * 0.5, -20),
          vx: rnd(-1.2, 1.2), vy: rnd(1.5, 4.5),
          g: 0.045, drag: 0.999,
          size: rnd(24, 44),
          color: '#fff',
          rot: rnd(-0.5, 0.5), vr: rnd(-0.05, 0.05),
          life: rnd(220, 360)
        });
      }
      cap(); start();
    },

    /** Салют по всему экрану — для финального экзамена. */
    fireworks: function (times) {
      if (!enabled || !ctx) return;
      times = times || 5;
      for (var i = 0; i < times; i++) {
        (function (n) {
          setTimeout(function () {
            FX.burst(
              rnd(global.innerWidth * 0.15, global.innerWidth * 0.85),
              rnd(global.innerHeight * 0.15, global.innerHeight * 0.55),
              { count: 34, size: 11 }
            );
            if (global.Sound) Sound.star(n);
          }, n * 420);
        })(i);
      }
    },

    /** Маленький всплеск звёздочек у элемента. */
    sparkleAt: function (elm, emoji) {
      if (!enabled || !elm) return;
      var r = elm.getBoundingClientRect();
      FX.burst(r.left + r.width / 2, r.top + r.height / 2, {
        count: 12, emoji: emoji || '✨', size: 22, gravity: 0.12
      });
    }
  };

  global.FX = FX;

})(window);
