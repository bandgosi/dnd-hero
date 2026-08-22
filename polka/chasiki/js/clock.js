/* =========================================================
   clock.js — SVG-часы: рисование, анимация стрелок,
   перетаскивание пальцем/мышью, подсветка частей.

   Система углов: 0° = «12 часов», далее по часовой стрелке.
   Часовая стрелка:  угол = (час % 12) * 30 + минуты * 0.5
   Минутная стрелка: угол = минуты * 6
   ========================================================= */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var CX = 120, CY = 120;          // центр в координатах viewBox
  var R_FACE = 98;
  var HOUR_LEN = 50;
  var MIN_LEN = 76;

  function svgEl(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  // Точка на окружности радиуса r под углом deg (0° — вверх)
  function pt(deg, r) {
    var a = (deg - 90) * Math.PI / 180;
    return { x: CX + Math.cos(a) * r, y: CY + Math.sin(a) * r };
  }

  function norm(a) { a %= 360; return a < 0 ? a + 360 : a; }

  // Кратчайшая разница между углами (-180..180) — чтобы стрелка не крутилась лишний круг
  function shortDelta(from, to) {
    return ((to - from) % 360 + 540) % 360 - 180;
  }

  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  /* =======================================================
     Класс Clock
     ======================================================= */
  function Clock(opts) {
    this.o = Object.assign({
      time: { h: 12, m: 0 },
      interactive: false,     // можно ли двигать стрелки
      drag: 'both',           // 'hour' | 'minute' | 'both'
      linkHands: true,        // часовая едет вместе с минутной (как в настоящих часах)
      snap: 1,                // шаг притягивания минут (1 или 5)
      snapHour: false,        // часовая притягивается строго к цифре
      numbers: true,          // цифры 1..12
      minuteNumbers: false,   // мелкие подписи минут (5,10,...)
      ticks: true,            // деления
      showHour: true,
      showMinute: true,
      parts: false,           // включить наведение/клик по частям часов
      onChange: null,
      onPartEnter: null,
      onPartLeave: null,
      onPartClick: null,
      className: ''
    }, opts || {});

    this.h = this.o.time.h;
    this.m = this.o.time.m;
    this._ha = norm((this.h % 12) * 30 + this.m * 0.5);
    this._ma = norm(this.m * 6);
    this._raf = null;
    this._dragging = null;

    this._build();
    this._applyAngles();
  }

  Clock.prototype._build = function () {
    var o = this.o, self = this;

    var root = document.createElement('div');
    root.className = 'clock ' + (o.className || '');
    if (o.interactive) root.classList.add('is-interactive');

    var svg = svgEl('svg', {
      viewBox: '-14 -14 268 268',
      role: 'img',
      'aria-label': 'Аналоговые часы'
    }, root);

    // ---- Тень и корпус ----
    var defs = svgEl('defs', null, svg);
    var grad = svgEl('radialGradient', { id: 'clkFace' + Clock._uid(), cx: '40%', cy: '32%', r: '75%' }, defs);
    svgEl('stop', { offset: '0%', 'stop-color': '#FFFFFF' }, grad);
    svgEl('stop', { offset: '100%', 'stop-color': '#F5FAFF' }, grad);

    svgEl('circle', { cx: CX, cy: CY + 5, r: R_FACE + 8, fill: 'rgba(33,57,91,.10)' }, svg);
    svgEl('circle', { cx: CX, cy: CY, r: R_FACE + 8, fill: '#E4F1FF' }, svg);
    svgEl('circle', { cx: CX, cy: CY, r: R_FACE, fill: 'url(#' + grad.id + ')' }, svg);
    svgEl('circle', { cx: CX, cy: CY, r: R_FACE, class: 'clk-rim-2', 'stroke-width': 5 }, svg);

    // ---- Сектор подсветки (для объяснения половины/четверти) ----
    this.sector = svgEl('path', { class: 'clk-sector', d: '' }, svg);

    // ---- Деления ----
    if (o.ticks) {
      var gTicks = svgEl('g', { class: 'clk-part', 'data-part': 'ticks' }, svg);
      for (var i = 0; i < 60; i++) {
        var big = i % 5 === 0;
        var a = i * 6;
        var p1 = pt(a, big ? 92 : 92), p2 = pt(a, big ? 80 : 86);
        svgEl('line', {
          x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
          class: 'clk-tick' + (big ? ' clk-tick--h' : ''),
          'stroke-width': big ? 5 : 2
        }, gTicks);
      }
      this.gTicks = gTicks;
    }

    // ---- Мелкие подписи минут ----
    if (o.minuteNumbers) {
      var gMin = svgEl('g', { class: 'clk-part', 'data-part': 'minuteNumbers' }, svg);
      for (var k = 0; k < 12; k++) {
        var pm = pt(k * 30, 114);
        var t = svgEl('text', { x: pm.x, y: pm.y, class: 'clk-mnum', 'font-size': 15 }, gMin);
        t.textContent = String(k * 5);
      }
      this.gMinNums = gMin;
    }

    // ---- Цифры 1..12 ----
    if (o.numbers) {
      var gNums = svgEl('g', { class: 'clk-part', 'data-part': 'numbers' }, svg);
      for (var n = 1; n <= 12; n++) {
        var pn = pt(n * 30, 68);
        var tn = svgEl('text', { x: pn.x, y: pn.y, class: 'clk-num', 'font-size': 26 }, gNums);
        tn.textContent = String(n);
      }
      this.gNums = gNums;
    }

    // ---- Минутная стрелка ----
    if (o.showMinute) {
      var gm = svgEl('g', { class: 'clk-part clk-hand clk-minute', 'data-part': 'minute' }, svg);
      svgEl('line', {
        x1: CX, y1: CY + 16, x2: CX, y2: CY - MIN_LEN,
        class: 'clk-hand-line', 'stroke-width': 8
      }, gm);
      // Кончик-капелька, чтобы стрелку было легче «схватить»
      svgEl('circle', { cx: CX, cy: CY - MIN_LEN, r: 7, fill: 'var(--green-dark)' }, gm);
      this.gMin = gm;
    }

    // ---- Часовая стрелка ----
    if (o.showHour) {
      var gh = svgEl('g', { class: 'clk-part clk-hand clk-hour', 'data-part': 'hour' }, svg);
      svgEl('line', {
        x1: CX, y1: CY + 16, x2: CX, y2: CY - HOUR_LEN,
        class: 'clk-hand-line', 'stroke-width': 13
      }, gh);
      svgEl('circle', { cx: CX, cy: CY - HOUR_LEN, r: 8, fill: 'var(--blue-dark)' }, gh);
      this.gHour = gh;
    }

    // ---- Центр ----
    var gc = svgEl('g', { class: 'clk-part', 'data-part': 'center' }, svg);
    svgEl('circle', { cx: CX, cy: CY, r: 11, class: 'clk-cap' }, gc);
    svgEl('circle', { cx: CX, cy: CY, r: 4.5, class: 'clk-cap-2' }, gc);
    this.gCenter = gc;

    // ---- Невидимые «ручки» для перетаскивания ----
    if (o.interactive) {
      if (this.gMin) {
        this.hitMin = svgEl('line', {
          x1: CX, y1: CY, x2: CX, y2: CY - MIN_LEN, class: 'clk-hit'
        }, this.gMin);
      }
      if (this.gHour) {
        this.hitHour = svgEl('line', {
          x1: CX, y1: CY, x2: CX, y2: CY - HOUR_LEN, class: 'clk-hit'
        }, this.gHour);
      }
      this._bindDrag(root, svg);
    }

    // ---- Наведение / клик по частям (экран «Знакомство») ----
    if (o.parts) {
      var partsEls = [this.gHour, this.gMin, this.gNums, this.gCenter, this.gTicks, this.gMinNums];
      partsEls.forEach(function (g) {
        if (!g) return;
        g.style.cursor = 'pointer';
        g.addEventListener('pointerenter', function () {
          if (o.onPartEnter) o.onPartEnter(g.getAttribute('data-part'));
        });
        g.addEventListener('pointerleave', function () {
          if (o.onPartLeave) o.onPartLeave(g.getAttribute('data-part'));
        });
        g.addEventListener('click', function () {
          if (o.onPartClick) o.onPartClick(g.getAttribute('data-part'));
        });
      });
    }

    this.el = root;
    this.svg = svg;
    root.__clock = this;   // ссылка на объект часов прямо из DOM (удобно для отладки)
  };

  Clock._uidN = 0;
  Clock._uid = function () { return ++Clock._uidN; };

  /* ---------- Углы -> DOM ---------- */
  Clock.prototype._applyAngles = function () {
    if (this.gHour) this.gHour.setAttribute('transform', 'rotate(' + this._ha.toFixed(2) + ' ' + CX + ' ' + CY + ')');
    if (this.gMin) this.gMin.setAttribute('transform', 'rotate(' + this._ma.toFixed(2) + ' ' + CX + ' ' + CY + ')');
  };

  /* ---------- Публичные методы ---------- */

  Clock.prototype.getTime = function () { return { h: this.h, m: this.m }; };

  /** Установить время. animate=true — плавный поворот стрелок. */
  Clock.prototype.setTime = function (h, m, animate, duration) {
    h = ((h % 12) + 12) % 12; if (h === 0) h = 12;
    m = ((m % 60) + 60) % 60;
    this.h = h; this.m = m;

    var targetH = norm((h % 12) * 30 + m * 0.5);
    var targetM = norm(m * 6);

    if (!animate || document.body.classList.contains('no-anim') ||
        (global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      this._ha = targetH; this._ma = targetM;
      this._applyAngles();
      return Promise.resolve();
    }

    var self = this;
    var fromH = this._ha, fromM = this._ma;
    var dH = shortDelta(fromH, targetH), dM = shortDelta(fromM, targetM);

    return this._animate(duration || 620, function (t) {
      var e = easeInOut(t);
      self._ha = norm(fromH + dH * e);
      self._ma = norm(fromM + dM * e);
      self._applyAngles();
    });
  };

  /**
   * Плавный «ход» минутной стрелки вперёд на deltaMinutes.
   * Используется в уроке про минуты: круг = 60 минут.
   */
  Clock.prototype.sweepMinutes = function (deltaMinutes, duration, onStep) {
    var self = this;
    // Стартуем от ФАКТИЧЕСКОГО положения стрелки, а не от this.m: если предыдущая
    // анимация была прервана, this.m ещё не обновлён и стрелки бы разъехались.
    var startM = this._ma / 6;
    var startHourAngle = this._ha;
    var lastStep = -1;

    return this._animate(duration || 4000, function (t) {
      var passed = deltaMinutes * t;                     // сколько минут «прошло»
      var totalM = startM + passed;
      self._ma = norm(totalM * 6);
      if (self.o.linkHands) self._ha = norm(startHourAngle + passed * 0.5);
      self._applyAngles();

      var whole = Math.floor(passed);
      if (whole !== lastStep) {
        lastStep = whole;
        if (onStep) onStep(Math.round(totalM) % 60, whole);
      }
    }, function () {
      var end = Math.round(startM + deltaMinutes);
      self.m = ((end % 60) + 60) % 60;
      if (self.o.linkHands) {
        var addH = Math.floor((startM + deltaMinutes) / 60);
        var nh = self.h + addH;
        nh = ((nh - 1) % 12 + 12) % 12 + 1;
        self.h = nh;
      }
    });
  };

  /** Универсальный rAF-аниматор. Возвращает промис. */
  Clock.prototype._animate = function (duration, step, onDone) {
    this.stop();
    var self = this;
    return new Promise(function (resolve) {
      self._resolve = resolve;
      var t0 = performance.now();
      function frame(now) {
        var t = Math.min(1, (now - t0) / duration);
        step(t);
        if (t < 1) {
          self._raf = requestAnimationFrame(frame);
        } else {
          self._raf = null;
          self._resolve = null;
          if (onDone) onDone();
          resolve();
        }
      }
      self._raf = requestAnimationFrame(frame);
    });
  };

  /** Остановить анимацию. Промис при этом резолвится, чтобы await не повис навсегда. */
  Clock.prototype.stop = function () {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    if (this._resolve) { var r = this._resolve; this._resolve = null; r(); }
  };

  /** Подсветить часть часов: 'hour' | 'minute' | 'numbers' | 'center' | 'ticks' | 'minuteNumbers' */
  Clock.prototype.highlight = function (part, on) {
    var map = {
      hour: this.gHour, minute: this.gMin, numbers: this.gNums,
      center: this.gCenter, ticks: this.gTicks, minuteNumbers: this.gMinNums
    };
    var g = map[part];
    if (g) g.classList.toggle('is-hl', on !== false);
  };

  Clock.prototype.clearHighlights = function () {
    ['hour', 'minute', 'numbers', 'center', 'ticks', 'minuteNumbers'].forEach(function (p) {
      this.highlight(p, false);
      this.dim(p, false);
      this.pulse(p, false);
    }, this);
  };

  Clock.prototype.dim = function (part, on) {
    var map = {
      hour: this.gHour, minute: this.gMin, numbers: this.gNums,
      center: this.gCenter, ticks: this.gTicks, minuteNumbers: this.gMinNums
    };
    var g = map[part];
    if (g) g.classList.toggle('is-dim', on !== false);
  };

  /** Пульсация части (привлечь внимание). */
  Clock.prototype.pulse = function (part, on) {
    var map = {
      hour: this.gHour, minute: this.gMin, numbers: this.gNums,
      center: this.gCenter, ticks: this.gTicks, minuteNumbers: this.gMinNums
    };
    var g = map[part];
    if (g) g.classList.toggle('is-pulse', on !== false);
  };

  /** Показать сектор циферблата от минуты a до минуты b (объяснение долей часа). */
  Clock.prototype.showSector = function (fromMin, toMin, color) {
    if (fromMin === null) { this.sector.classList.remove('is-on'); return; }

    var r = R_FACE - 4;
    var a1 = fromMin * 6, a2 = toMin * 6;
    var sweep = norm(a2 - a1);
    var d;

    if (fromMin !== toMin && sweep === 0) {
      // Полный круг: дуга с совпадающими концами по спецификации SVG не рисуется,
      // поэтому собираем окружность из двух полудуг (нужно для «круг = 60 минут»).
      d = 'M ' + CX + ' ' + (CY - r) +
          ' A ' + r + ' ' + r + ' 0 1 1 ' + CX + ' ' + (CY + r) +
          ' A ' + r + ' ' + r + ' 0 1 1 ' + CX + ' ' + (CY - r) + ' Z';
    } else {
      var p1 = pt(a1, r), p2 = pt(a2, r);
      var large = sweep > 180 ? 1 : 0;
      d = 'M ' + CX + ' ' + CY + ' L ' + p1.x + ' ' + p1.y +
          ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + p2.x + ' ' + p2.y + ' Z';
    }

    this.sector.setAttribute('d', d);
    this.sector.style.fill = color || '';   // не «залипает» цвет от прошлого сектора
    this.sector.classList.add('is-on');
  };

  Clock.prototype.setStatus = function (status) {
    this.el.classList.remove('is-correct', 'is-wrong');
    if (status) this.el.classList.add('is-' + status);
  };

  Clock.prototype.setInteractive = function (on) {
    this._locked = !on;
    this.el.classList.toggle('is-interactive', !!on);
  };

  /* ---------- Перетаскивание стрелок ---------- */
  Clock.prototype._bindDrag = function (root, svg) {
    var self = this;

    function pointerAngle(ev) {
      var r = svg.getBoundingClientRect();
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var dx = ev.clientX - cx;
      var dy = ev.clientY - cy;
      // Радиус переводим в координаты viewBox. Масштаб при preserveAspectRatio
      // «meet» определяется меньшей стороной, а не только шириной.
      var scale = Math.min(r.width, r.height) / 268 || 1;
      var dist = Math.sqrt(dx * dx + dy * dy) / scale;
      var ang = norm(Math.atan2(dx, -dy) * 180 / Math.PI);
      return { angle: ang, dist: dist };
    }

    function chooseHand(info) {
      var mode = self.o.drag;
      if (mode === 'hour') return 'hour';
      if (mode === 'minute') return 'minute';
      if (!self.gHour) return 'minute';
      if (!self.gMin) return 'hour';
      // Далеко от центра — точно минутная (часовая короткая)
      if (info.dist > HOUR_LEN + 14) return 'minute';
      var dh = Math.abs(shortDelta(self._ha, info.angle));
      var dm = Math.abs(shortDelta(self._ma, info.angle));
      return dh <= dm ? 'hour' : 'minute';
    }

    function apply(info) {
      var changed = false;
      if (self._dragging === 'hour') {
        var hh;
        if (self.o.snapHour) {
          hh = Math.round(info.angle / 30) % 12;
          if (self.o.snapHour === 'strict' && self.m !== 0) { self.m = 0; changed = true; }
        } else {
          hh = Math.floor(norm(info.angle) / 30) % 12;
        }
        hh = hh === 0 ? 12 : hh;
        if (hh !== self.h) { changed = true; self.h = hh; }
        self._ha = norm((self.h % 12) * 30 + self.m * 0.5);
        self._ma = norm(self.m * 6);
      } else {
        var step = self.o.snap || 1;
        var mm = Math.round(info.angle / 6 / step) * step;
        mm = ((mm % 60) + 60) % 60;
        if (mm !== self.m) { changed = true; self.m = mm; }
        self._ma = norm(self.m * 6);
        if (self.o.linkHands) self._ha = norm((self.h % 12) * 30 + self.m * 0.5);
      }
      self._applyAngles();
      if (changed) {
        if (global.Sound) Sound.notch();
        if (self.o.onChange) self.o.onChange(self.getTime(), self._dragging);
      }
    }

    function down(ev) {
      // isPrimary: второй палец на планшете не должен перехватывать стрелку
      if (self._locked || ev.isPrimary === false) return;
      var info = pointerAngle(ev);
      // Клик далеко за пределами циферблата игнорируем
      if (info.dist > 126) return;
      self.stop();
      self._dragging = chooseHand(info);
      root.classList.add('is-dragging');
      self.highlight(self._dragging, true);
      svg.setPointerCapture && svg.setPointerCapture(ev.pointerId);
      apply(info);
      ev.preventDefault();
    }

    function move(ev) {
      if (!self._dragging) return;
      apply(pointerAngle(ev));
      ev.preventDefault();
    }

    function up(ev) {
      if (!self._dragging) return;
      self.highlight(self._dragging, false);
      self._dragging = null;
      root.classList.remove('is-dragging');
      if (self.o.onRelease) self.o.onRelease(self.getTime());
    }

    svg.addEventListener('pointerdown', down);
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    svg.addEventListener('pointerleave', function (e) { if (self._dragging) up(e); });
  };

  /* ---------- Фабрика маленьких часов (для вариантов ответа) ---------- */
  Clock.face = function (h, m, className, opts) {
    var c = new Clock(Object.assign({
      time: { h: h, m: m },
      interactive: false,
      numbers: true,
      minuteNumbers: false,
      className: className == null ? 'clock--mini' : className
    }, opts || {}));
    return c;
  };

  global.Clock = Clock;

})(window);
