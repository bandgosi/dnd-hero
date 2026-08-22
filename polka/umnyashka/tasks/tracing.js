/* =========================================================
   tasks/tracing.js — обучение письму по траектории.
   Ребёнок ведёт пальцем/мышью/стилусом по «дорожке» буквы.
   Требования: не требовать математической точности —
   6-летний должен получать ощущение успеха.

   Путь сэмплируется собственным парсером (M/L/Q/C/A), а не
   getPointAtLength: одинаковое поведение во всех браузерах
   и возможность протестировать логику без браузера.
   ========================================================= */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var STEP = 1.6;          // шаг сэмплирования пути, единиц
  var TOL = 15;            // допуск попадания в дорожку, единиц
  var TOL_SOFT = 24;       // за этим — просто не засчитываем движение
  var DONE_AT = 0.86;      // доля пройденного штриха, достаточная для зачёта
  var START_R = 18;        // радиус вокруг стартовой точки

  /* ---------------------------------------------------------
     Парсер и сэмплер SVG-пути
     --------------------------------------------------------- */
  function tokenize(d) {
    var re = /([MLQCA])([^MLQCA]*)/gi, m, out = [];
    while ((m = re.exec(d))) {
      var nums = (m[2].match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
      out.push({ cmd: m[1].toUpperCase(), args: nums });
    }
    return out;
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function quad(p0, p1, p2, t) {
    var u = 1 - t;
    return {
      x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y
    };
  }
  function cubic(p0, p1, p2, p3, t) {
    var u = 1 - t;
    return {
      x: u*u*u*p0.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*p3.x,
      y: u*u*u*p0.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*p3.y
    };
  }

  /** Дуга: endpoint → center параметризация по SVG F.6.5 */
  function arcPoints(p0, rx, ry, rot, laf, sf, p1) {
    var pts = [];
    if (rx === 0 || ry === 0) return [p1];
    rx = Math.abs(rx); ry = Math.abs(ry);
    var phi = rot * Math.PI / 180;
    var cosP = Math.cos(phi), sinP = Math.sin(phi);
    var dx2 = (p0.x - p1.x) / 2, dy2 = (p0.y - p1.y) / 2;
    var x1 = cosP * dx2 + sinP * dy2;
    var y1 = -sinP * dx2 + cosP * dy2;

    var l = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if (l > 1) { var s = Math.sqrt(l); rx *= s; ry *= s; }

    var num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    var den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
    var co = Math.sqrt(Math.max(0, num / den));
    if (laf === sf) co = -co;

    var cx1 = co * rx * y1 / ry;
    var cy1 = -co * ry * x1 / rx;
    var cx = cosP * cx1 - sinP * cy1 + (p0.x + p1.x) / 2;
    var cy = sinP * cx1 + cosP * cy1 + (p0.y + p1.y) / 2;

    function ang(ux, uy, vx, vy) {
      var d = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
      var a = Math.acos(Math.max(-1, Math.min(1, d)));
      return (ux * vy - uy * vx < 0) ? -a : a;
    }
    var th1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
    var dth = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
    if (!sf && dth > 0) dth -= 2 * Math.PI;
    if (sf && dth < 0) dth += 2 * Math.PI;

    var n = Math.max(8, Math.ceil(Math.abs(dth) * Math.max(rx, ry) / STEP));
    for (var i = 1; i <= n; i++) {
      var th = th1 + dth * (i / n);
      pts.push({
        x: cosP * rx * Math.cos(th) - sinP * ry * Math.sin(th) + cx,
        y: sinP * rx * Math.cos(th) + cosP * ry * Math.sin(th) + cy
      });
    }
    return pts;
  }

  /** Точки вдоль пути с шагом ~STEP. */
  function samplePath(d) {
    var cmds = tokenize(d), cur = { x: 0, y: 0 }, pts = [];
    cmds.forEach(function (c) {
      var a = c.args;
      if (c.cmd === 'M') {
        cur = { x: a[0], y: a[1] };
        pts.push({ x: cur.x, y: cur.y });
      } else if (c.cmd === 'L') {
        for (var i = 0; i + 1 < a.length; i += 2) {
          var to = { x: a[i], y: a[i + 1] };
          var len = Math.hypot(to.x - cur.x, to.y - cur.y);
          var n = Math.max(1, Math.ceil(len / STEP));
          for (var k = 1; k <= n; k++) pts.push({ x: lerp(cur.x, to.x, k / n), y: lerp(cur.y, to.y, k / n) });
          cur = to;
        }
      } else if (c.cmd === 'Q') {
        for (var j = 0; j + 3 < a.length; j += 4) {
          var p1 = { x: a[j], y: a[j + 1] }, p2 = { x: a[j + 2], y: a[j + 3] };
          var approx = Math.hypot(p1.x - cur.x, p1.y - cur.y) + Math.hypot(p2.x - p1.x, p2.y - p1.y);
          var nq = Math.max(4, Math.ceil(approx / STEP));
          for (var q = 1; q <= nq; q++) pts.push(quad(cur, p1, p2, q / nq));
          cur = p2;
        }
      } else if (c.cmd === 'C') {
        for (var m = 0; m + 5 < a.length; m += 6) {
          var c1 = { x: a[m], y: a[m + 1] }, c2 = { x: a[m + 2], y: a[m + 3] }, e = { x: a[m + 4], y: a[m + 5] };
          var ap = Math.hypot(c1.x - cur.x, c1.y - cur.y) + Math.hypot(c2.x - c1.x, c2.y - c1.y) + Math.hypot(e.x - c2.x, e.y - c2.y);
          var nc = Math.max(6, Math.ceil(ap / STEP));
          for (var t = 1; t <= nc; t++) pts.push(cubic(cur, c1, c2, e, t / nc));
          cur = e;
        }
      } else if (c.cmd === 'A') {
        for (var z = 0; z + 6 < a.length; z += 7) {
          var end = { x: a[z + 5], y: a[z + 6] };
          arcPoints(cur, a[z], a[z + 1], a[z + 2], a[z + 3], a[z + 4], end).forEach(function (p) { pts.push(p); });
          cur = end;
        }
      }
    });
    return pts;
  }

  /* ---------------------------------------------------------
     Виджет письма
     --------------------------------------------------------- */
  function svgEl(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  /**
   * @param {object} o
   *   glyph    — символ для подписи
   *   strokes  — [{d, from}]
   *   onDone   — function(quality 0..1)
   *   onStroke — function(index)
   */
  function TraceWidget(o) {
    var self = {};
    var strokes = o.strokes || [];
    var samples = strokes.map(function (s) { return samplePath(s.d); });

    var idx = 0;                 // текущий штрих
    var progress = 0;            // индекс достигнутой точки
    var drawing = false;
    var offTrack = 0;            // сколько раз ушёл далеко — для подсказки
    var deviations = [];         // качество ведения
    var doneStrokes = [];
    var finished = false;
    var hintTimer = null;
    var demoTimer = null;

    var root = UI.el('div', { class: 'trace' });
    var svg = svgEl('svg', { viewBox: '-6 -6 112 112', class: 'trace__svg' }, root);

    // Разлиновка, как в прописях
    svgEl('rect', { x: -6, y: -6, width: 112, height: 112, rx: 10, fill: '#fff' }, svg);
    [12, 50, 88].forEach(function (y, i) {
      svgEl('line', {
        x1: -2, y1: y, x2: 102, y2: y,
        stroke: i === 1 ? '#F0ECFB' : '#E7E2F6',
        'stroke-width': 1, 'stroke-dasharray': i === 1 ? '4 4' : '0'
      }, svg);
    });

    // Дорожки всех штрихов
    var roads = strokes.map(function (s, i) {
      return svgEl('path', {
        d: s.d, class: 'trace__road', fill: 'none',
        stroke: '#BDB2E4', 'stroke-width': 15, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
      }, svg);
    });
    // Пунктир-подсказка поверх дорожки
    var guides = strokes.map(function (s) {
      return svgEl('path', {
        d: s.d, fill: 'none', stroke: '#6B5BB5', 'stroke-width': 2,
        'stroke-dasharray': '3 6', 'stroke-linecap': 'round'
      }, svg);
    });
    // Нарисованное ребёнком
    var inked = strokes.map(function () {
      return svgEl('path', {
        d: '', fill: 'none', class: 'trace__ink',
        stroke: 'var(--accent)', 'stroke-width': 13,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round'
      }, svg);
    });

    // Стартовая точка и номер штриха
    var startDot = svgEl('circle', { r: 9, class: 'trace__start', fill: '#0F5A31' }, svg);
    var startNum = svgEl('text', {
      class: 'trace__num', 'text-anchor': 'middle', 'dominant-baseline': 'central',
      'font-size': 10, fill: '#fff', 'font-weight': '900'
    }, svg);
    var arrow = svgEl('polygon', { class: 'trace__arrow', fill: '#2FB86B', points: '0,0 0,0 0,0' }, svg);

    function setActive() {
      roads.forEach(function (r, i) {
        r.setAttribute('stroke', i === idx ? '#B8ACE0' : '#E4DFF2');
      });
      guides.forEach(function (g, i) { g.style.opacity = i === idx ? '1' : '.35'; });
      var s = strokes[idx];
      if (!s) { startDot.style.display = 'none'; startNum.style.display = 'none'; arrow.style.display = 'none'; return; }
      startDot.style.display = ''; startNum.style.display = ''; arrow.style.display = '';
      startDot.setAttribute('cx', s.from[0]);
      startDot.setAttribute('cy', s.from[1]);
      startNum.setAttribute('x', s.from[0]);
      startNum.setAttribute('y', s.from[1]);
      startNum.textContent = String(idx + 1);
      drawArrow();
    }

    /** Стрелка направления: смотрит вдоль первых точек штриха. */
    function drawArrow() {
      var pts = samples[idx];
      if (!pts || pts.length < 6) { arrow.setAttribute('points', '0,0 0,0 0,0'); return; }
      var a = pts[Math.min(pts.length - 1, 10)], b = pts[Math.min(pts.length - 1, 22)];
      var ang = Math.atan2(b.y - a.y, b.x - a.x);
      var size = 5;
      var p1 = [b.x + Math.cos(ang) * size, b.y + Math.sin(ang) * size];
      var p2 = [b.x + Math.cos(ang + 2.4) * size, b.y + Math.sin(ang + 2.4) * size];
      var p3 = [b.x + Math.cos(ang - 2.4) * size, b.y + Math.sin(ang - 2.4) * size];
      arrow.setAttribute('points', p1.join(',') + ' ' + p2.join(',') + ' ' + p3.join(','));
    }

    function toSvg(ev) {
      var r = svg.getBoundingClientRect();
      if (!r.width || !r.height) return { x: -999, y: -999 };
      var k = 112 / Math.min(r.width, r.height);
      return {
        x: (ev.clientX - r.left) * k - 6,
        y: (ev.clientY - r.top) * k - 6
      };
    }

    function paint() {
      var pts = samples[idx];
      if (!pts) return;
      var upto = pts.slice(0, Math.max(2, progress + 1));
      var d = upto.map(function (p, i) {
        return (i ? 'L' : 'M') + p.x.toFixed(1) + ',' + p.y.toFixed(1);
      }).join(' ');
      inked[idx].setAttribute('d', d);
    }

    function nearestAhead(p) {
      var pts = samples[idx];
      var best = -1, bestD = 1e9;
      var from = progress, to = Math.min(pts.length - 1, progress + 26);
      for (var i = from; i <= to; i++) {
        var d = Math.hypot(pts[i].x - p.x, pts[i].y - p.y);
        if (d < bestD) { bestD = d; best = i; }
      }
      return { i: best, d: bestD };
    }

    function down(ev) {
      if (finished || !strokes[idx]) return;
      if (ev.isPrimary === false) return;
      var p = toSvg(ev);
      var s = strokes[idx];
      var dStart = Math.hypot(p.x - s.from[0], p.y - s.from[1]);
      // Начинать нужно от зелёной точки — это часть обучения
      if (progress === 0 && dStart > START_R) {
        hintStart();
        ev.preventDefault();
        return;
      }
      drawing = true;
      root.classList.add('is-drawing');
      if (svg.setPointerCapture) { try { svg.setPointerCapture(ev.pointerId); } catch (e) {} }
      clearTimeout(hintTimer);
      move(ev);
      ev.preventDefault();
    }

    function move(ev) {
      if (!drawing || finished) return;
      var p = toSvg(ev);
      var n = nearestAhead(p);
      if (n.i >= 0 && n.d < TOL) {
        if (n.i > progress) {
          progress = n.i;
          deviations.push(n.d);
          paint();
          if (progress % 14 === 0) SFX.draw();
        }
        var pts = samples[idx];
        if (progress >= Math.floor(pts.length * DONE_AT)) completeStroke();
      } else if (n.d > TOL_SOFT) {
        offTrack++;
        if (offTrack === 26) {
          root.classList.add('is-off');
          setTimeout(function () { root.classList.remove('is-off'); }, 600);
          offTrack = 0;
        }
      }
      ev.preventDefault();
    }

    function up() {
      if (!drawing) return;
      drawing = false;
      root.classList.remove('is-drawing');
      var pts = samples[idx];
      if (!pts) return;
      var ratio = progress / (pts.length - 1);
      if (ratio >= DONE_AT) { completeStroke(); return; }
      if (ratio < 0.35) {
        // Совсем немного — начинаем штрих заново, без упрёков
        progress = 0;
        inked[idx].setAttribute('d', '');
      }
      armHint();
    }

    function completeStroke() {
      var pts = samples[idx];
      progress = pts.length - 1;
      paint();
      inked[idx].classList.add('is-done');
      doneStrokes.push(idx);
      SFX.star(idx);
      if (o.onStroke) o.onStroke(idx);
      idx++;
      progress = 0;
      offTrack = 0;
      drawing = false;
      if (idx >= strokes.length) return done();
      setActive();
      armHint();
    }

    function done() {
      finished = true;
      startDot.style.display = 'none';
      startNum.style.display = 'none';
      arrow.style.display = 'none';
      root.classList.add('is-finished');
      var avg = deviations.length
        ? deviations.reduce(function (a, b) { return a + b; }, 0) / deviations.length : TOL;
      var quality = Math.max(0, Math.min(1, 1 - (avg / TOL) * 0.7));
      SFX.right();
      FX.at(root, '✨');
      if (o.onDone) o.onDone(quality);
    }

    /* ---- Подсказки ---- */
    function hintStart() {
      SFX.tick();
      startDot.classList.add('is-ping');
      setTimeout(function () { startDot.classList.remove('is-ping'); }, 900);
      Speech.phrase('Начни с зелёной точки');
    }

    function armHint() {
      clearTimeout(hintTimer);
      hintTimer = setTimeout(function () {
        if (!document.body.contains(root)) return;   // экран уже сменился
        if (!finished && !drawing) startDot.classList.add('is-ping');
      }, 4000);
    }

    /** Показать, как пишется буква: анимированная точка по дорожке. */
    function demo() {
      if (finished) return;
      var pts = samples[idx];
      if (!pts || !pts.length) return;
      if (demoTimer) clearInterval(demoTimer);
      var dot = svgEl('circle', { r: 6, fill: 'var(--sun)', class: 'trace__demo' }, svg);
      var i = 0;
      progress = 0;
      inked[idx].setAttribute('d', '');
      var timer = demoTimer = setInterval(function () {
        if (i >= pts.length || finished || !document.body.contains(root)) {
          clearInterval(timer);
          if (demoTimer === timer) demoTimer = null;
          if (dot.parentNode) dot.parentNode.removeChild(dot);
          progress = 0;
          inked[idx].setAttribute('d', '');
          return;
        }
        dot.setAttribute('cx', pts[i].x);
        dot.setAttribute('cy', pts[i].y);
        progress = i;
        paint();
        i += 3;
      }, 18);
    }

    var usingPointer = !!global.PointerEvent;
    if (usingPointer) {
      svg.addEventListener('pointerdown', down);
      svg.addEventListener('pointermove', move);
      svg.addEventListener('pointerup', up);
      svg.addEventListener('pointercancel', up);
      svg.addEventListener('pointerleave', function (e) { if (drawing) up(e); });
    } else {
      // Старые iOS Safari и Firefox for Android: без этого письмо не работает вовсе
      svg.addEventListener('mousedown', down);
      svg.addEventListener('mousemove', move);
      svg.addEventListener('mouseup', up);
      svg.addEventListener('mouseleave', function (e) { if (drawing) up(e); });
      ['touchstart', 'touchmove', 'touchend'].forEach(function (name, i) {
        svg.addEventListener(name, function (e) {
          var t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
          if (!t) return;
          [down, move, up][i]({
            clientX: t.clientX, clientY: t.clientY, isPrimary: true,
            preventDefault: function () { e.preventDefault(); }
          });
        }, { passive: false });
      });
    }

    setActive();
    armHint();

    self.el = root;
    self.demo = demo;
    self.reset = function () {
      idx = 0; progress = 0; finished = false; deviations = []; doneStrokes = [];
      inked.forEach(function (p) { p.setAttribute('d', ''); p.classList.remove('is-done'); });
      root.classList.remove('is-finished');
      setActive();
    };
    self.isFinished = function () { return finished; };
    self.strokeIndex = function () { return idx; };
    /** Снять все таймеры виджета при уходе с экрана. */
    self.destroy = function () {
      finished = true;
      clearTimeout(hintTimer);
      if (demoTimer) { clearInterval(demoTimer); demoTimer = null; }
    };
    /** Для тестов и подсказок: пройти текущий штрих программно. */
    self.autoStroke = function () { if (!finished) completeStroke(); };

    return self;
  }

  /* ---------------------------------------------------------
     Общий экран задания на письмо
     --------------------------------------------------------- */
  function buildWriteTask(o) {
    // o: {glyph, strokes, prompt, speak, onDone, onSkip}
    var wrap = UI.el('div', { class: 'write' });
    var answered = false;

    var widget = TraceWidget({
      glyph: o.glyph,
      strokes: o.strokes,
      onDone: function (q) {
        if (answered) return;      // «Сначала» после готовой буквы не должно давать второй ответ
        answered = true;
        var stars = q > 0.72 ? 3 : q > 0.45 ? 2 : 1;
        wrap.classList.add('is-done');
        setTimeout(function () { o.onDone(q, stars); }, 420);
      }
    });

    var showBtn = UI.btn('Показать', {
      variant: 'ghost', small: true, emoji: '👀',
      onClick: function () { widget.demo(); Speech.phrase('Смотри, как надо'); }
    });
    var againBtn = UI.btn('Сначала', {
      variant: 'ghost', small: true, emoji: '↩️',
      onClick: function () { if (!answered) widget.reset(); }
    });
    // Выход для ребёнка, у которого пока не получается вести линию:
    // без него задание на письмо было ловушкой
    var skipBtn = UI.btn('Пока трудно', {
      variant: 'ghost', small: true, emoji: '➡️',
      onClick: function () {
        if (answered) return;
        answered = true;
        widget.destroy();
        if (o.onSkip) o.onSkip();
      }
    });

    wrap.appendChild(widget.el);
    wrap.appendChild(UI.el('div', { class: 'center g2 mt4 wrap' }, [showBtn, againBtn, skipBtn]));
    wrap.widget = widget;
    return wrap;
  }

  global.Tracing = {
    samplePath: samplePath,
    TraceWidget: TraceWidget,
    buildWriteTask: buildWriteTask,
    TOL: TOL
  };

  /* ---------------------------------------------------------
     Регистрация типов заданий
     --------------------------------------------------------- */
  function registerWriteTypes() {
    Tasks.register('writeLetter', {
      section: 'writeLetters',
      build: function (skillId) {
        var ch = skillId.split(':')[1];
        var L = Alphabet.byChar(ch);
        if (!L) return null;
        return {
          letter: L,
          prompt: 'Напиши букву <b>' + L.ch + '</b>',
          speak: 'Напиши букву ' + L.name + '. Веди по дорожке от зелёной точки.'
        };
      },
      render: function (data, api) {
        var node = buildWriteTask({
          glyph: data.letter.ch,
          strokes: data.letter.strokes,
          onDone: function (q) {
            // Качество письма влияет на модель навыка: небрежную букву
            // повторим позже, но ребёнку об этом говорим мягко
            if (q >= 0.45) api.answer(true, { node: node });
            else api.answer(true, { node: node, quality: q });
            if (q < 0.45) Speech.phrase(Characters.line('writeAgain'));
          },
          onSkip: function () {
            api.skip({ answerHint: 'Ничего страшного! Вернёмся к этой букве позже.' });
          }
        });
        return node;
      }
    });

    Tasks.register('writeDigit', {
      section: 'writeDigits',
      build: function (skillId) {
        var n = parseInt(skillId.split(':')[1], 10);
        var D = Numbers.byN(n);
        if (!D) return null;
        return {
          digit: D,
          prompt: 'Напиши цифру <b>' + D.n + '</b>',
          speak: 'Напиши цифру ' + D.word + '. Веди по дорожке от зелёной точки.'
        };
      },
      render: function (data, api) {
        var node = buildWriteTask({
          glyph: String(data.digit.n),
          strokes: data.digit.strokes,
          onDone: function (q) {
            api.answer(true, { node: node });
            if (q < 0.45) Speech.phrase(Characters.line('writeAgain'));
          },
          onSkip: function () {
            api.skip({ answerHint: 'Ничего страшного! Вернёмся к этой цифре позже.' });
          }
        });
        return node;
      }
    });
  }

  if (global.Tasks) registerWriteTypes();
  else global.addEventListener('DOMContentLoaded', registerWriteTypes);

})(window);
