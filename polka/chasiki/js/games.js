/* =========================================================
   games.js — пять мини-игр:
   🎈 Лопни время   🚂 Часовой поезд   🧩 Собери часы
   🎯 Попади стрелкой   🏁 Гонка со временем
   ========================================================= */
(function (global) {
  'use strict';

  var el = UI.el, btn = UI.btn, shuffle = UI.shuffle, rnd = UI.rnd, delay = UI.delay;

  var LIST = [
    { id: 'balloons', emoji: '🎈', title: 'Лопни время',   rules: 'Лопни шарик, на котором написано время с часов', unit: 'очков' },
    { id: 'train',    emoji: '🚂', title: 'Часовой поезд',  rules: 'Прицепи вагончик с правильным временем',        unit: 'вагонов' },
    { id: 'puzzle',   emoji: '🧩', title: 'Собери часы',    rules: 'Поставь цифры на свои места',                   unit: 'цифр' },
    { id: 'target',   emoji: '🎯', title: 'Попади стрелкой',rules: 'Поставь минутную стрелку как можно точнее',     unit: 'очков' },
    { id: 'race',     emoji: '🏁', title: 'Гонка со временем', rules: 'Ответь на как можно больше вопросов за 60 секунд', unit: 'ответов' }
  ];

  var GAME_IDS = LIST.map(function (g) { return g.id; });

  /* =======================================================
     Общий каркас мини-игры
     ======================================================= */
  function shell(game, opts) {
    opts = opts || {};
    var screen = UI.screen('game');
    // Роутер вызовет эту уборку при любой смене экрана — даже если ребёнок
    // ушёл системной кнопкой или дважды тапнул по карточке игры
    screen.__onExit = opts.onExit || null;
    var scoreChip = el('div', { class: 'chip' }, [
      el('span', { class: 'chip__emoji', text: '⭐' }),
      el('span', { text: '0' })
    ]);
    var extraChip = el('div', { class: 'chip hidden' }, [
      el('span', { class: 'chip__emoji', text: '📍' }),
      el('span', { text: '' })
    ]);
    var timerChip = el('div', { class: 'timer hidden' }, [
      el('span', { text: '⏳' }), el('span', { text: '60' })
    ]);

    var hud = el('div', { class: 'game__hud' }, [
      UI.iconBtn('←', function () { Router.go('map', {}, { replace: true }); }, 'Назад'),
      el('div', { class: 't-sub nowrap', text: game.emoji + ' ' + game.title }),
      el('div', { class: 'grow' }),
      extraChip, scoreChip, timerChip
    ]);

    var area = el('div', { class: 'stack grow gap-12' });
    screen.appendChild(hud);
    screen.appendChild(area);

    return {
      screen: screen,
      area: area,
      setScore: function (v) { scoreChip.lastChild.textContent = String(v); },
      setExtra: function (v, emoji) {
        extraChip.classList.toggle('hidden', v === null);
        if (v !== null) {
          extraChip.lastChild.textContent = String(v);
          if (emoji) extraChip.firstChild.textContent = emoji;
        }
      },
      setTimer: function (sec) {
        timerChip.classList.toggle('hidden', sec === null);
        if (sec !== null) {
          timerChip.lastChild.textContent = String(sec);
          timerChip.classList.toggle('is-low', sec <= 10);
        }
      }
    };
  }

  /** Экран результата мини-игры. */
  function result(game, score, max, area) {
    var prevBest = Progress.game(game.id).best;
    var rec = Progress.gameResult(game.id, score);
    var isBest = score > prevBest && score > 0;
    // Опыт нормируем: раньше «Попади стрелкой» с её сотнями очков выдавала
    // 800 XP за партию, обесценивая все остальные игры и уроки
    var norm = max ? score / max : Math.min(1, score / 15);
    var xp = Math.max(5, Math.round(norm * 25));
    Progress.addXP(xp);

    if (Progress.playedAllGames(GAME_IDS)) Progress.unlock('allgames');
    if (game.id === 'race' && score >= 12) Progress.unlock('speedy');

    Sound.reward();
    FX.confetti({ count: score > 0 ? 100 : 40 });

    area.innerHTML = '';
    area.appendChild(el('div', { class: 'card card--yellow t-center appear', style: { marginTop: '10px' } }, [
      el('div', { style: { fontSize: '68px' }, text: game.emoji }),
      el('h2', { class: 't-title mt-8', text: isBest ? 'Новый рекорд!' : 'Отличная игра!' }),
      el('div', { class: 'center gap-10 mt-16 wrap' }, [
        el('span', { class: 'pill pill--green', text: '⭐ ' + score + (max ? ' из ' + max : '') + ' ' + game.unit }),
        el('span', { class: 'pill', text: '💎 +' + xp + ' XP' }),
        el('span', { class: 'pill pill--yellow', text: '🏅 рекорд: ' + rec.best })
      ]),
      el('div', { class: 'stack gap-10 mt-24' }, [
        btn('Сыграть ещё', { variant: 'green', block: true, onClick: function () { Router.go('game', { id: game.id }, { replace: true }); } }),
        btn('На карту', { variant: 'ghost', block: true, small: true, onClick: function () { Router.go('map', {}, { replace: true }); } })
      ])
    ]));
  }

  /** Стартовое окно с правилами. */
  function intro(game, onStart) {
    UI.modal({
      emoji: game.emoji,
      title: game.title,
      text: game.rules,
      dismissable: false,
      actions: [
        { label: 'Начать!', variant: 'green', emoji: '▶️', onClick: onStart },
        { label: 'Назад', variant: 'ghost', onClick: function () { Router.go('map', {}, { replace: true }); } }
      ]
    });
  }

  function randTime() { return Curriculum.Gen.byDifficulty(Progress.settings.difficulty); }

  /* =======================================================
     🎈 ИГРА 1: ЛОПНИ ПРАВИЛЬНОЕ ВРЕМЯ
     ======================================================= */
  function BalloonGame(game) {
    var ROUNDS = 8;
    var COLORS = ['#3DA9FC', '#35C77B', '#FFC93C', '#A78BFA', '#FF9F45', '#FF8FA3', '#6FE3C4'];

    var s = shell(game, { onExit: stop });
    var prompt = el('div', { class: 'game__prompt', text: 'Найди эти часы!' });
    var clockWrap = el('div', { class: 'center' });
    var field = el('div', { class: 'balloons' });

    s.area.appendChild(prompt);
    s.area.appendChild(clockWrap);
    s.area.appendChild(field);

    var round = 0, score = 0, running = false, raf = null;
    var balloons = [];
    var target = null;
    var lastT = 0;
    var spawnT = null, finT = null;

    function stop() {
      running = false;
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      clearTimeout(spawnT); clearTimeout(finT);
    }

    function spawnRound(attempt) {
      // Поле может быть ещё не смонтировано — тогда ширина 0 и шарики слипаются.
      // Ждём раскладку, но не бесконечно: иначе игра просто не начнётся.
      attempt = attempt || 0;
      var w = field.clientWidth || Math.round(field.getBoundingClientRect().width);
      if (!w) {
        if (attempt < 20) {
          spawnT = setTimeout(function () { spawnRound(attempt + 1); }, 50);
          return;
        }
        w = Math.max(280, global.innerWidth - 32);
      }

      field.innerHTML = '';
      balloons = [];
      target = randTime();

      clockWrap.innerHTML = '';
      var c = Clock.face(target.h, target.m, 'clock--mini');
      clockWrap.appendChild(c.el);

      var opts = shuffle(Curriculum.makeOptions(target, 3));
      var h = field.clientHeight || 400;
      var BW = w < 420 ? 70 : 88;               // ширина шарика из CSS
      var lane = w / opts.length;
      var myRound = round;

      opts.forEach(function (t, i) {
        var node = el('div', { class: 'balloon' }, [
          el('div', {
            class: 'balloon__body',
            style: { background: COLORS[i % COLORS.length], color: COLORS[i % COLORS.length] },
            text: Curriculum.fmt(t)
          }),
          el('div', { class: 'balloon__string' })
        ]);
        // Держим шарик целиком внутри поля, чтобы его не срезало краем
        var x = lane * i + (lane - BW) / 2 + rnd(-5, 5);
        x = Math.max(2, Math.min(w - BW - 2, x));
        var b = {
          node: node, time: t, round: myRound,
          x: x,
          y: h + rnd(10, 90),
          vy: rnd(55, 80) / 60,          // пикселей за кадр (~60 fps)
          phase: Math.random() * Math.PI * 2,
          alive: true
        };
        node.addEventListener('pointerdown', function (ev) {
          ev.preventDefault();
          hit(b);
        });
        field.appendChild(node);
        balloons.push(b);
      });
      lastT = performance.now();
    }

    function hit(b) {
      if (!b.alive || !running || b.round !== round) return;
      b.alive = false;
      var ok = b.time.h === target.h && b.time.m === target.m;
      // Промах не должен выглядеть как успешное попадание
      b.node.classList.add(ok ? 'is-pop' : 'is-miss');
      if (ok) {
        Sound.pop(); Sound.success();
        score++;
        s.setScore(score);
        Progress.answer(true);
        var r = b.node.getBoundingClientRect();
        FX.burst(r.left + r.width / 2, r.top + r.height / 2, { count: 18, emoji: '✨', size: 18 });
        nextRound();
      } else {
        Sound.error();
        Progress.answer(false);
      }
    }

    function nextRound() {
      round++;
      if (round >= ROUNDS) {
        s.setExtra(ROUNDS + '/' + ROUNDS, '🎈');
        stop();
        running = false;
        finT = setTimeout(function () { result(game, score, ROUNDS, s.area); }, 700);
        return;
      }
      s.setExtra((round + 1) + '/' + ROUNDS, '🎈');
      spawnT = setTimeout(function () { if (running) spawnRound(); }, 550);
    }

    function loop(now) {
      if (!running) return;
      var dt = Math.min(3, (now - lastT) / 16.7);
      lastT = now;
      var h = field.clientHeight || 400;
      var allGone = true;

      balloons.forEach(function (b) {
        if (!b.alive) return;
        allGone = false;
        b.y -= b.vy * dt * 1.6;
        b.phase += 0.02 * dt;
        var sway = Math.sin(b.phase) * 12;
        b.node.style.transform = 'translate(' + (b.x + sway) + 'px,' + b.y + 'px)';
        if (b.y < -140) {
          b.alive = false;
          b.node.style.display = 'none';
          // Улетел правильный шарик — раунд пропущен
          if (b.time.h === target.h && b.time.m === target.m) {
            Sound.error();
            Progress.answer(false);
            nextRound();
          }
        }
      });

      if (allGone && running && balloons.length) { /* ждём следующего раунда */ }
      raf = requestAnimationFrame(loop);
    }

    intro(game, function () {
      stop();
      running = true;
      round = 0; score = 0;
      s.setScore(0); s.setExtra('1/' + ROUNDS, '🎈');
      spawnRound();
      lastT = performance.now();
      raf = requestAnimationFrame(loop);
    });

    return s.screen;
  }

  /* =======================================================
     🚂 ИГРА 2: ЧАСОВОЙ ПОЕЗД
     ======================================================= */
  function TrainGame(game) {
    var COUNT = 6;
    var finT = null;
    var s = shell(game, { onExit: function () { clearTimeout(finT); } });
    var prompt = el('div', { class: 'game__prompt', text: 'Прицепи вагончик с нужным временем' });
    var track = el('div', { class: 'train__track' });
    var cardsWrap = el('div', { class: 'cards' });

    s.area.appendChild(prompt);
    s.area.appendChild(el('div', { class: 'train' }, [track, cardsWrap]));

    var times = [], slots = [], filled = 0, score = 0, mistakes = 0;

    function build() {
      times = [];
      var seen = {};
      while (times.length < COUNT) {
        var t = randTime();
        var k = t.h + ':' + t.m;
        if (seen[k]) continue;
        seen[k] = true;
        times.push(t);
      }

      track.innerHTML = '';
      track.appendChild(el('div', { class: 'train__engine', text: '🚂' }));
      slots = [];
      times.forEach(function (t, i) {
        var c = Clock.face(t.h, t.m, 'clock--tiny');
        var slot = el('div', { class: 'wagon is-slot' }, [
          el('span', { class: 'wagon__num', text: String(i + 1) }),
          c.el
        ]);
        track.appendChild(slot);
        slots.push({ node: slot, time: t, done: false });
      });

      cardsWrap.innerHTML = '';
      shuffle(times).forEach(function (t) {
        var card = el('div', {
          class: 'time-card', role: 'button',
          onclick: function () { place(card, t); }
        }, [el('span', { text: Curriculum.fmt(t) })]);
        cardsWrap.appendChild(card);
      });

      highlightNext();
    }

    function currentSlot() {
      for (var i = 0; i < slots.length; i++) if (!slots[i].done) return slots[i];
      return null;
    }

    function highlightNext() {
      slots.forEach(function (sl) { sl.node.classList.remove('is-target'); });
      var cur = currentSlot();
      if (cur) {
        cur.node.style.boxShadow = 'inset 0 0 0 4px var(--yellow)';
        cur.node.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }

    function place(card, t) {
      var cur = currentSlot();
      if (!cur || card.classList.contains('is-used')) return;

      if (cur.time.h === t.h && cur.time.m === t.m) {
        Sound.train();
        cur.done = true;
        cur.node.classList.remove('is-slot');
        cur.node.classList.add('is-filled');
        cur.node.style.boxShadow = '';
        cur.node.innerHTML = '';
        cur.node.appendChild(el('div', { style: { fontSize: '30px' }, text: '🚃' }));
        cur.node.appendChild(el('div', { style: { fontSize: '20px', fontWeight: '900' }, text: Curriculum.fmt(t) }));
        card.classList.add('is-used');
        filled++;
        score++;
        s.setScore(score);
        s.setExtra(filled + '/' + COUNT, '🚃');
        Progress.answer(true);
        FX.sparkleAt(cur.node, '⭐');
        highlightNext();

        if (filled === COUNT) {
          Sound.train();
          finT = setTimeout(function () { result(game, score, COUNT, s.area); }, 800);
        }
      } else {
        Sound.error();
        mistakes++;
        Progress.answer(false);
        // Отдельный класс ошибки: синяя «выбрана» читалась как успех
        card.classList.add('is-bad');
        cur.node.classList.add('is-bad');
        setTimeout(function () {
          card.classList.remove('is-bad');
          cur.node.classList.remove('is-bad');
        }, 450);
        UI.toast('Посмотри на стрелки внимательнее', { emoji: '🤔', duration: 1500 });
      }
    }

    intro(game, function () {
      score = 0; filled = 0;
      s.setScore(0); s.setExtra('0/' + COUNT, '🚃');
      build();
    });

    return s.screen;
  }

  /* =======================================================
     🧩 ИГРА 3: СОБЕРИ ЧАСЫ
     ======================================================= */
  function PuzzleGame(game) {
    var MISSING = 6;
    var finT = null, finClock = null;
    var s = shell(game, {
      onExit: function () { clearTimeout(finT); if (finClock) finClock.stop(); }
    });
    var prompt = el('div', { class: 'game__prompt', text: 'Поставь цифры на свои места' });
    var stage = el('div', { class: 'puzzle__stage' });
    var piecesWrap = el('div', { class: 'puzzle__pieces' });

    s.area.appendChild(prompt);
    s.area.appendChild(el('div', { class: 'puzzle' }, [stage, piecesWrap]));

    var selected = null, placed = 0, score = 0, missing = [];

    function build() {
      // Круг циферблата
      stage.innerHTML = '';
      stage.style.borderRadius = '50%';
      stage.style.background = 'radial-gradient(circle at 40% 35%, #FFFFFF, #F2F8FF)';
      stage.style.boxShadow = 'inset 0 0 0 10px #E4F1FF, 0 10px 0 rgba(33,57,91,.08), 0 20px 40px rgba(33,57,91,.12)';

      missing = shuffle([1,2,3,4,5,6,7,8,9,10,11,12]).slice(0, MISSING);

      for (var n = 1; n <= 12; n++) {
        var a = (n * 30 - 90) * Math.PI / 180;
        var left = 50 + Math.cos(a) * 34;
        var top = 50 + Math.sin(a) * 34;
        var isMissing = missing.indexOf(n) !== -1;
        var slot = el('div', {
          class: 'puzzle__slot' + (isMissing ? '' : ' is-filled'),
          style: { left: left + '%', top: top + '%' },
          dataset: { num: String(n) },
          text: isMissing ? '' : String(n)
        });
        if (isMissing) {
          (function (slotNode, num) {
            slotNode.addEventListener('click', function () { drop(slotNode, num); });
          })(slot, n);
        }
        stage.appendChild(slot);
      }

      // Центр
      stage.appendChild(el('div', {
        style: {
          position: 'absolute', left: '50%', top: '50%', width: '18px', height: '18px',
          marginLeft: '-9px', marginTop: '-9px', borderRadius: '50%', background: 'var(--ink)'
        }
      }));

      piecesWrap.innerHTML = '';
      shuffle(missing).forEach(function (n) {
        var p = el('div', {
          class: 'piece', role: 'button', dataset: { num: String(n) },
          onclick: function () {
            if (p.classList.contains('is-used')) return;
            Sound.click();
            if (selected) selected.classList.remove('is-sel');
            selected = p;
            p.classList.add('is-sel');
          }
        }, [el('span', { text: String(n) })]);
        piecesWrap.appendChild(p);
      });
    }

    function drop(slotNode, num) {
      if (slotNode.classList.contains('is-filled')) return;   // повторный тап — не ошибка
      if (!selected) {
        UI.toast('Сначала выбери цифру внизу', { emoji: '👇', duration: 1400 });
        return;
      }
      var val = parseInt(selected.dataset.num, 10);
      if (val === num) {
        Sound.star(placed);
        slotNode.textContent = String(num);
        slotNode.classList.add('is-filled');
        selected.classList.add('is-used');
        selected.classList.remove('is-sel');
        selected = null;
        placed++; score++;
        s.setScore(score);
        s.setExtra(placed + '/' + MISSING, '🧩');
        FX.sparkleAt(slotNode, '✨');
        Progress.answer(true);
        if (placed === MISSING) finish();
      } else {
        Sound.error();
        Progress.answer(false);
        slotNode.animate(
          [{ transform: 'translate(-50%,-50%) scale(1)' },
           { transform: 'translate(-50%,-50%) scale(1.15) rotate(6deg)' },
           { transform: 'translate(-50%,-50%) scale(1)' }],
          { duration: 320 }
        );
        UI.toast('Эта цифра стоит в другом месте', { emoji: '🤔', duration: 1400 });
      }
    }

    function finish() {
      // Показываем «оживший» циферблат со стрелками
      var c = new Clock({ time: { h: 12, m: 0 }, interactive: false, minuteNumbers: false });
      finClock = c;
      stage.innerHTML = '';
      stage.style.boxShadow = 'none';
      stage.style.background = 'none';
      stage.appendChild(c.el);
      Sound.success();
      var t = randTime();
      c.setTime(t.h, t.m, true, 1400);
      finT = setTimeout(function () { result(game, score, MISSING, s.area); }, 1700);
    }

    intro(game, function () {
      score = 0; placed = 0;
      s.setScore(0); s.setExtra('0/' + MISSING, '🧩');
      build();
    });

    return s.screen;
  }

  /* =======================================================
     🎯 ИГРА 4: ПОПАДИ СТРЕЛКОЙ
     ======================================================= */
  function TargetGame(game) {
    var ROUNDS = 5;
    var s = shell(game, { onExit: function () { if (clock) clock.stop(); } });
    var prompt = el('div', { class: 'game__prompt' });
    var clockWrap = el('div', { class: 'center' });
    var accWrap = el('div', { class: 'center stack gap-8' });
    var actions = el('div', { class: 'center mt-16' });

    s.area.appendChild(prompt);
    s.area.appendChild(clockWrap);
    s.area.appendChild(accWrap);
    s.area.appendChild(actions);

    var round = 0, score = 0, perfect = 0, targetM = 0, clock = null, stepM = 5;

    function newRound() {
      round++;
      if (round > ROUNDS) {
        if (perfect === ROUNDS) Progress.unlock('sniper');
        result(game, score, ROUNDS * 100, s.area);
        return;
      }
      s.setExtra(round + '/' + ROUNDS, '🎯');

      // Шаг цели и шаг притягивания стрелки должны совпадать, иначе точное
      // попадание требует ювелирной точности и «Снайпер» недостижим
      stepM = Progress.settings.difficulty === 'hard' ? 1 : 5;
      targetM = rnd(1, 59 / stepM | 0) * stepM;

      prompt.innerHTML = '';
      prompt.appendChild(el('span', { text: 'Поставь стрелку на ' }));
      prompt.appendChild(el('span', { class: 'accent-green', text: targetM + ' минут' }));

      clockWrap.innerHTML = '';
      clock = new Clock({
        time: { h: 12, m: (targetM + 30) % 60 },
        interactive: true, drag: 'minute', snap: stepM,
        showHour: false, minuteNumbers: true, linkHands: false
      });
      clockWrap.appendChild(clock.el);

      accWrap.innerHTML = '';
      var live = el('div', { class: 'minute-counter' }, [
        el('span', { text: String(clock.getTime().m) }), el('small', { text: 'минут' })
      ]);
      clock.o.onChange = function (t) { live.innerHTML = ''; live.appendChild(el('span', { text: String(t.m) })); live.appendChild(el('small', { text: 'минут' })); };
      accWrap.appendChild(live);

      actions.innerHTML = '';
      actions.appendChild(btn('Готово!', {
        variant: 'green', huge: true, emoji: '🎯',
        onClick: check
      }));
    }

    function check() {
      var got = clock.getTime().m;
      // Минимальная разница по кругу
      var diff = Math.min(Math.abs(got - targetM), 60 - Math.abs(got - targetM));
      // Считаем промах в делениях: ошибка на одно деление — 80 очков, а не ноль
      var pts = Math.max(0, 100 - Math.round(diff / stepM) * 20);
      score += pts;
      s.setScore(score);
      clock.setInteractive(false);

      var bar = el('div', { class: 'accuracy' }, [el('div', { class: 'accuracy__fill' })]);
      accWrap.appendChild(bar);
      setTimeout(function () { bar.firstChild.style.width = pts + '%'; }, 30);

      if (diff === 0) {
        perfect++;
        Sound.success();
        FX.sparkleAt(clock.el, '🎯');
        Progress.answer(true);
      } else {
        Sound.notch();
        Progress.answer(false);
        clock.setTime(12, targetM, true, 700);
      }

      actions.innerHTML = '';
      actions.appendChild(btn(diff === 0 ? 'Точно в цель! Дальше' : 'Дальше (+' + pts + ')', {
        variant: diff === 0 ? 'green' : 'yellow',
        onClick: newRound
      }));
    }

    intro(game, function () {
      round = 0; score = 0; perfect = 0;
      s.setScore(0);
      newRound();
    });

    return s.screen;
  }

  /* =======================================================
     🏁 ИГРА 5: ГОНКА СО ВРЕМЕНЕМ
     ======================================================= */
  function RaceGame(game) {
    var TOTAL = 60;
    var s = shell(game, { onExit: stop });
    var prompt = el('div', { class: 'game__prompt', text: 'Сколько времени?' });
    var stage = el('div', { class: 'task' });
    s.area.appendChild(prompt);
    s.area.appendChild(stage);

    var left = TOTAL, score = 0, timer = null, locked = false;

    function stop() { if (timer) clearInterval(timer); timer = null; }

    function tick() {
      left--;
      s.setTimer(left);
      if (left <= 5 && left > 0) Sound.beep(false);
      if (left <= 0) {
        stop();
        Sound.beep(true);
        result(game, score, null, s.area);
      }
    }

    function question() {
      locked = false;
      var t = randTime();
      var opts = Curriculum.makeOptions(t, 3);

      stage.innerHTML = '';
      var clock = Clock.face(t.h, t.m, '', { minuteNumbers: true });
      clock.el.style.maxWidth = '240px';

      var grid = el('div', { class: 'options options--4' });
      opts.forEach(function (o) {
        var b = el('button', {
          class: 'opt', type: 'button',
          onclick: function () {
            if (locked || !timer) return;
            locked = true;
            var ok = o.h === t.h && o.m === t.m;
            b.classList.add(ok ? 'is-correct' : 'is-wrong');
            if (ok) {
              score++; s.setScore(score);
              Sound.success(); Progress.answer(true);
            } else {
              Sound.error(); Progress.answer(false);
              // показываем правильный вариант
              Array.prototype.forEach.call(grid.children, function (c, i) {
                if (opts[i].h === t.h && opts[i].m === t.m) c.classList.add('is-correct');
              });
            }
            setTimeout(function () { if (timer) question(); }, ok ? 330 : 900);
          }
        }, [el('span', { text: Curriculum.fmt(o) })]);
        grid.appendChild(b);
      });

      stage.appendChild(el('div', { class: 'task__body' }, [clock.el, grid]));
    }

    intro(game, function () {
      stop();                       // не оставляем второй интервал: таймер шёл бы вдвое быстрее
      left = TOTAL; score = 0; s.setScore(0); s.setTimer(TOTAL);
      question();
      timer = setInterval(tick, 1000);
    });

    return s.screen;
  }

  /* =======================================================
     Диспетчер
     ======================================================= */
  var BUILDERS = {
    balloons: BalloonGame,
    train: TrainGame,
    puzzle: PuzzleGame,
    target: TargetGame,
    race: RaceGame
  };

  function GameScreen(params) {
    var game = LIST.filter(function (g) { return g.id === params.id; })[0];
    if (!game) { return UI.screen('game'); }
    return BUILDERS[game.id](game);
  }

  global.Games = {
    LIST: LIST,
    IDS: GAME_IDS,
    Screen: GameScreen
  };

})(window);
