/* =========================================================
   games/numbers.js — четыре математические мини-игры.

   🎈 balloons  «Лопни ответ»          — сложение и вычитание на скорость выбора
   🚂 train     «Математический поезд» — числовой ряд, пропущенное число
   🚀 rocket    «Запусти ракету»       — 5 примеров подряд, ракета только растёт
   🏎 race      «Гонка примеров»       — 60 секунд, сколько успеешь

   Правила, общие для всех четырёх:
   · задания берутся ТОЛЬКО из MathGen — варианты ответа там уже «похожие»,
     то есть ошибка ребёнка чему-то учит, а не наказывает;
   · слова «неправильно» нет нигде: мягкий SFX.almost(), плитка гаснет, играем дальше;
   · после двух промахов игра сама показывает верный ответ и идёт дальше —
     ни один раунд не может подвесить игру;
   · каждый пример ровно один раз попадает в shell.answer(ok, skill);
   · таймеры только через shell.interval/shell.timeout, кадры rAF снимаются
     в shell.onCleanup — после выхода с экрана игра не живёт.
   ========================================================= */
(function (global) {
  'use strict';

  var el = function () { return UI.el.apply(null, arguments); };

  /* ------------------------------------------------------------------ *
   * Общие помощники
   * ------------------------------------------------------------------ */

  /** Потолок чисел по прогрессу ребёнка: 5 → 10 → 20. */
  function maxFor() {
    if (Store.unit('m-add-3').done) return 20;
    if (Store.unit('m-add-2').done) return 10;
    return 5;
  }

  /** Очередной пример: половина на сложение, половина на вычитание. */
  function example(max) {
    return Math.random() < 0.5 ? MathGen.add({ max: max }) : MathGen.sub({ max: max });
  }

  function say(text) { if (text) Speech.phrase(text); }

  /**
   * Плитка ответа. pointerdown — чтобы срабатывало прямо под пальцем,
   * click — запасной путь для клавиатуры. От двойного тапа защищает
   * замок раунда (onPick сам проверяет, открыт ли раунд).
   */
  function optTile(label, onPick) {
    var b = el('button', {
      class: 'opt gn-opt', type: 'button', 'aria-label': String(label)
    }, [el('span', { text: String(label) })]);
    function fire(e) {
      if (e && e.preventDefault) e.preventDefault();
      if (b.disabled) return;
      onPick(b);
    }
    b.addEventListener('pointerdown', fire);
    b.addEventListener('click', fire);
    return b;
  }

  /** Карточка с примером + кнопка «послушать ещё раз». */
  function promptCard(getTask) {
    var eq = el('div', { class: 'gn-eq grow', text: '' });
    var node = el('div', { class: 'gn-prompt card card--tint' }, [
      eq,
      UI.speakBtn(function () { var t = getTask(); return t ? t.speak : ''; }, 'Ещё раз')
    ]);
    node.setTask = function (t) { eq.textContent = t.prompt; };
    return node;
  }

  /** Сетка из 4 вариантов ответа. */
  function optsGrid() {
    return el('div', { class: 'opts opts--4 gn-opts' });
  }

  /**
   * Раунд с плитками: сам считает промахи, сам показывает ответ
   * после двух ошибок и сам зовёт onDone(solvedFirstTry).
   * Возвращает объект с методом start(task).
   */
  function tileRound(shell, grid, o) {
    var task = null, tiles = [], locked = true, misses = 0;
    var LIMIT = o.limit || 2;

    function clear() {
      grid.innerHTML = '';
      tiles = [];
    }

    function close(firstTry, ok) {
      locked = true;
      tiles.forEach(function (t) { t.disabled = true; });
      shell.answer(!!firstTry, task.skill);
      shell.timeout(function () {
        if (shell.isFinished()) return;
        o.onDone(!!firstTry, !!ok);
      }, firstTry ? (o.okDelay || 700) : (o.helpDelay || 1500));
    }

    function reveal() {
      tiles.forEach(function (t) {
        if (String(t.__value) === String(task.answer)) t.classList.add('is-right');
        else { t.classList.add('is-dim'); }
      });
      say('Верный ответ — ' + task.answer);
      close(false, false);
    }

    function pick(tile) {
      if (locked) return;                         /* двойной тап сюда не пройдёт */
      if (String(tile.__value) === String(task.answer)) {
        tile.classList.add('is-right');
        SFX.right();
        FX.at(tile, '⭐');
        close(misses === 0, true);
        return;
      }
      /* мягкая реакция: звук «почти», плитка гаснет, игра продолжается */
      misses++;
      tile.classList.add('is-almost');
      tile.disabled = true;
      SFX.almost();
      if (misses >= LIMIT) reveal();
    }

    return {
      start: function (t) {
        task = t;
        misses = 0;
        clear();
        t.options.forEach(function (v) {
          var tile = optTile(v, pick);
          tile.__value = v;
          tiles.push(tile);
          grid.appendChild(tile);
        });
        locked = false;
      },
      lock: function () { locked = true; }
    };
  }

  /* ================================================================== *
   * 🎈 balloons — «Лопни ответ»
   * ================================================================== */

  Games.register({
    id: 'balloons', emoji: '🎈', title: 'Лопни ответ', track: 'math',
    rules: 'Лопни шарик с правильным ответом',
    unit: 'Сложение и вычитание',
    build: function (shell) {
      var ROUNDS = 8;
      var max = maxFor();
      var round = 0, score = 0;
      var task = null, balloons = [], roundClosed = true, missed = false;
      var alive = true, rafId = 0, lastTs = 0;

      var prompt = promptCard(function () { return task; });
      var field = el('div', { class: 'gn-sky' });
      shell.area.appendChild(el('div', { class: 'stack g3 grow' }, [prompt, field]));

      shell.setScore(0);

      shell.onCleanup(function () {
        alive = false;
        if (rafId) global.cancelAnimationFrame(rafId);
        rafId = 0;
      });

      /* ---- кадр анимации: шарики плывут снизу вверх ---- */
      function frame(ts) {
        rafId = 0;
        if (!alive || shell.isFinished()) return;
        var dt = lastTs ? Math.min(64, ts - lastTs) : 16;
        lastTs = ts;
        for (var i = 0; i < balloons.length; i++) {
          var b = balloons[i];
          if (b.dead) continue;
          b.p += b.v * dt / 1000;
          b.node.style.bottom = b.p.toFixed(2) + '%';
          if (b.p > 120) {
            b.dead = true;
            b.node.classList.add('is-gone');
            if (b.correct) flewAway();
          }
        }
        if (alive && !shell.isFinished()) rafId = global.requestAnimationFrame(frame);
      }

      function loop() {
        if (!alive || rafId || shell.isFinished()) return;
        lastTs = 0;
        rafId = global.requestAnimationFrame(frame);
      }

      /* ---- шарики раунда: 4 полосы, налезть друг на друга не могут ---- */
      function buildBalloons() {
        field.innerHTML = '';
        balloons = [];
        var opts = task.options;
        for (var i = 0; i < opts.length; i++) {
          (function (i) {
            var v = opts[i];
            var node = el('button', {
              class: 'gn-balloon', type: 'button',
              'aria-label': 'Шарик ' + v,
              style: {
                left: ((i + 0.5) / opts.length * 100).toFixed(2) + '%',
                bottom: '-30%'
              }
            }, [
              el('span', { class: 'gn-balloon__num', text: String(v) }),
              el('span', { class: 'gn-balloon__tail' })
            ]);
            var b = {
              node: node, value: v, correct: v === task.answer,
              p: -30 - i * 14,                 /* лесенкой — так живее */
              v: 19 + (i % 2) * 2,             /* % высоты неба в секунду */
              dead: false
            };
            function fire(e) {
              if (e && e.preventDefault) e.preventDefault();
              pop(b);
            }
            node.addEventListener('pointerdown', fire);
            node.addEventListener('click', fire);
            balloons.push(b);
            field.appendChild(node);
          })(i);
        }
      }

      function pop(b) {
        if (roundClosed || b.dead || shell.isFinished()) return;
        b.dead = true;                          /* второй тап сюда уже не пройдёт */
        b.node.classList.add('is-pop');
        if (b.correct) {
          SFX.pop();
          SFX.right();
          FX.at(b.node, '⭐');
          if (!missed) { score++; shell.setScore(score); }
          closeRound(!missed);
        } else {
          missed = true;
          b.node.classList.add('is-miss');
          SFX.almost();
        }
      }

      function flewAway() {
        if (roundClosed) return;
        SFX.almost();
        say('Ответ — ' + task.answer);
        closeRound(false);
      }

      function closeRound(ok) {
        roundClosed = true;
        shell.answer(!!ok, task.skill);
        shell.timeout(nextRound, ok ? 700 : 1100);
      }

      function nextRound() {
        if (shell.isFinished()) return;
        if (round >= ROUNDS) { finish(); return; }
        round++;
        shell.setExtra(round + ' / ' + ROUNDS, '🎯');
        task = example(max);
        prompt.setTask(task);
        say(task.speak);
        roundClosed = false;
        missed = false;
        buildBalloons();
        loop();
      }

      function finish() {
        alive = false;
        if (rafId) { global.cancelAnimationFrame(rafId); rafId = 0; }
        shell.result(score, ROUNDS);
      }

      nextRound();
    }
  });

  /* ================================================================== *
   * 🚂 train — «Математический поезд»
   * ================================================================== */

  Games.register({
    id: 'train', emoji: '🚂', title: 'Математический поезд', track: 'math',
    rules: 'Паровоз потерял вагон. Поставь в пустое место нужное число',
    unit: 'Числовой ряд',
    build: function (shell) {
      var ROUNDS = 6;
      var max = Math.max(5, maxFor());
      var round = 0, score = 0;
      var task = null, holeCar = null;

      var prompt = promptCard(function () { return task; });
      var train = el('div', { class: 'gn-train' });
      var grid = optsGrid();
      shell.area.appendChild(el('div', { class: 'stack g4 grow' }, [
        prompt,
        el('div', { class: 'gn-rail' }, [train]),
        grid
      ]));

      shell.setScore(0);

      /** Гудок прицепившегося вагона. */
      function horn() { SFX.beep(true); SFX.whoosh(); }

      var rnd = tileRound(shell, grid, {
        onDone: function (firstTry, ok) {
          if (ok) {
            holeCar.textContent = String(task.answer);
            holeCar.classList.remove('gn-car--hole');
            holeCar.classList.add('is-hooked');
            horn();
          } else {
            holeCar.textContent = String(task.answer);
            holeCar.classList.add('is-shown');
          }
          if (firstTry) { score++; shell.setScore(score); }
          shell.timeout(nextRound, 900);
        },
        okDelay: 450,
        helpDelay: 1300
      });

      function drawTrain() {
        train.innerHTML = '';
        train.appendChild(el('span', { class: 'gn-loco', text: '🚂' }));
        holeCar = null;
        task.seq.forEach(function (v) {
          var isHole = v === null;
          var car = el('span', {
            class: 'gn-car' + (isHole ? ' gn-car--hole' : ''),
            text: isHole ? '?' : String(v)
          });
          if (isHole) holeCar = car;
          train.appendChild(car);
        });
      }

      function nextRound() {
        if (shell.isFinished()) return;
        if (round >= ROUNDS) { shell.result(score, ROUNDS); return; }
        round++;
        shell.setExtra(round + ' / ' + ROUNDS, '🚃');
        task = MathGen.numberLine({ max: max, holes: 1 });
        prompt.setTask(task);
        say(task.speak);
        drawTrain();
        rnd.start(task);
      }

      nextRound();
    }
  });

  /* ================================================================== *
   * 🚀 rocket — «Запусти ракету»
   * ================================================================== */

  Games.register({
    id: 'rocket', emoji: '🚀', title: 'Запусти ракету', track: 'math',
    rules: 'Реши пять примеров — и ракета взлетит! Промах не страшен: ракета не падает вниз',
    unit: 'Сложение и вычитание',
    build: function (shell) {
      var STEPS = 5;
      var max = maxFor();
      var level = 0, score = 0, task = null;

      var rocket = el('div', { class: 'gn-rocket', text: '🚀', style: { bottom: '0%' } });
      var ladder = el('div', { class: 'gn-ladder' });
      for (var i = 0; i < STEPS; i++) {
        ladder.appendChild(el('span', { class: 'gn-rung', dataset: { i: String(i) } }));
      }
      var tower = el('div', { class: 'gn-tower' }, [ladder, rocket,
        el('div', { class: 'gn-ground', text: '🌍' })]);

      var prompt = promptCard(function () { return task; });
      var grid = optsGrid();
      shell.area.appendChild(el('div', { class: 'stack g4 grow' }, [tower, prompt, grid]));

      shell.setScore(0);

      function paint() {
        var rungs = ladder.children;
        for (var i = 0; i < rungs.length; i++) {
          rungs[i].classList.toggle('is-on', i < level);
        }
        /* ракета НИКОГДА не опускается — только вверх по ступеням */
        rocket.style.bottom = (level / STEPS * 82) + '%';
        shell.setExtra(level + ' / ' + STEPS, '🪜');
      }

      var rnd = tileRound(shell, grid, {
        onDone: function (firstTry) {
          if (firstTry) { score++; shell.setScore(score); }
          level++;
          paint();
          if (level >= STEPS) shell.timeout(launch, 500);
          else shell.timeout(nextStep, 500);
        },
        okDelay: 600,
        helpDelay: 1500
      });

      function nextStep() {
        if (shell.isFinished()) return;
        task = example(max);
        prompt.setTask(task);
        say(task.speak);
        rnd.start(task);
      }

      function launch() {
        if (shell.isFinished()) return;
        rnd.lock();
        grid.innerHTML = '';
        prompt.classList.add('hidden');
        rocket.classList.add('is-launch');
        SFX.fanfare();
        FX.fireworks(4);
        say('Пуск! Ракета полетела!');
        shell.timeout(function () { shell.result(score, STEPS); }, 1900);
      }

      paint();
      nextStep();
    }
  });

  /* ================================================================== *
   * 🏎 race — «Гонка примеров»
   * ================================================================== */

  Games.register({
    id: 'race', emoji: '🏎', title: 'Гонка примеров', track: 'math',
    rules: 'Минута на трассе! Реши как можно больше примеров',
    unit: 'Счёт на скорость',
    build: function (shell) {
      var SECONDS = 60;
      var max = maxFor();
      var score = 0, solved = 0, task = null;
      /* таймер считаем от дедлайна — тогда он не «плывёт» от лагов */
      var endAt = Date.now() + SECONDS * 1000;
      var shown = SECONDS, over = false;

      var car = el('span', { class: 'gn-racer', text: '🏎', style: { left: '0%' } });
      var road = el('div', { class: 'gn-road' }, [
        car, el('span', { class: 'gn-finish', text: '🏁' })
      ]);

      var prompt = promptCard(function () { return task; });
      var grid = optsGrid();
      shell.area.appendChild(el('div', { class: 'stack g4 grow' }, [road, prompt, grid]));

      shell.setScore(0);
      shell.setTimer(SECONDS);
      shell.onCleanup(function () { shell.setTimer(null); });

      var rnd = tileRound(shell, grid, {
        onDone: function (firstTry, ok) {
          if (ok) {
            score++;
            shell.setScore(score);
          }
          solved++;
          car.style.left = Math.min(88, solved * 6) + '%';
          shell.timeout(nextTask, 150);
        },
        okDelay: 350,
        helpDelay: 1000
      });

      function nextTask() {
        if (shell.isFinished() || over) return;
        task = example(max);
        prompt.setTask(task);
        say(task.speak);
        rnd.start(task);
      }

      function tick() {
        if (over || shell.isFinished()) return;
        var left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
        if (left !== shown) {
          shown = left;
          shell.setTimer(left);
          if (left > 0 && left <= 5) SFX.beep(left <= 3);   /* последние 5 секунд — сигнал */
        }
        if (left <= 0) finish();
      }

      function finish() {
        if (over) return;
        over = true;
        rnd.lock();
        grid.innerHTML = '';
        shell.result(score, 0);
      }

      shell.interval(tick, 200);
      nextTask();
    }
  });

})(window);
