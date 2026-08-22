/* =========================================================
   lessons.js — движок уроков: показ шагов, проверка ответов,
   обучающие анимации, подсчёт звёзд и наград.
   ========================================================= */
(function (global) {
  'use strict';

  var el = UI.el, btn = UI.btn, delay = UI.delay, shuffle = UI.shuffle;

  /* Токен анимации: при смене шага старая анимация сама останавливается */
  var animToken = 0;

  /**
   * Обёртка «сработает только один раз». Дети тапают дважды почти всегда,
   * а панель обратной связи живёт ещё 240 мс после нажатия — без этой защиты
   * второй тап пролистывал следующее задание мимо ребёнка.
   */
  function once(fn) {
    var used = false;
    return function () {
      if (used) return;
      used = true;
      return fn.apply(this, arguments);
    };
  }

  /** Дождаться, пока узел действительно окажется в документе. */
  function waitMounted(node, cb, tries) {
    tries = tries === undefined ? 40 : tries;
    if (document.body.contains(node)) { cb(); return; }
    if (tries <= 0) return;
    requestAnimationFrame(function () { waitMounted(node, cb, tries - 1); });
  }

  /* =======================================================
     Экран урока
     ======================================================= */
  function LessonScreen(params) {
    var lesson = Curriculum.byId(params.id);
    var steps = lesson.build();
    var idx = 0;
    var correctCount = 0;      // решено заданий (в том числе со второй попытки)
    var firstTryCount = 0;     // решено с первой попытки — от этого зависят звёзды
    var mistakes = 0;
    var attempts = 0;
    var xpEarned = 0;
    var taskTotal = steps.filter(isTask).length;
    var taskDone = 0;

    var screen = UI.screen('lesson');

    // Кнопка «домой» из общего оглавления спрашивает подтверждение:
    // одно случайное касание не должно прерывать урок
    if (global.KidHub) {
      KidHub.homeGuard = function (go) {
        UI.modal({
          emoji: '🏠', title: 'Выйти ко всем играм?',
          text: 'Урок не закончен — он не сохранится.',
          actions: [
            { label: 'Остаться', variant: 'green' },
            { label: 'Выйти', variant: 'ghost', onClick: go }
          ]
        });
      };
      screen.__onExit = function () { KidHub.homeGuard = null; };
    }

    var bar = UI.lessonBar({
      percent: 0,
      score: 0,
      onExit: confirmExit
    });

    var body = el('div', { class: 'task' });
    var actions = el('div', { class: 'task__actions' });

    screen.appendChild(bar);
    screen.appendChild(body);
    screen.appendChild(actions);

    function isTask(s) { return s.type !== 'teach'; }

    function confirmExit() {
      UI.modal({
        emoji: '🚪',
        title: 'Выйти из урока?',
        text: 'Прогресс этого урока не сохранится.',
        actions: [
          { label: 'Остаться', variant: 'green' },
          { label: 'Выйти', variant: 'ghost', onClick: function () { animToken++; UI.hideFeedback(true); Router.go('map', {}, { replace: true }); } }
        ]
      });
    }

    function updateBar() {
      // Шаги-объяснения тоже двигают полоску, иначе первые два экрана урока
      // ребёнок видит нулевой прогресс и думает, что ничего не происходит
      var teachSeen = steps.slice(0, idx + 1).filter(function (s) { return s.type === 'teach'; }).length;
      var teachTotal = steps.length - taskTotal;
      var p = Math.round((taskDone + teachSeen) / (taskTotal + teachTotal) * 100);
      bar.setPercent(Math.min(100, p));
      bar.setScore(correctCount);
    }

    /* ---------------- Переходы между шагами ---------------- */
    function next() {
      idx++;
      if (idx >= steps.length) return finish();
      render();
    }

    function render() {
      animToken++;
      attempts = 0;
      UI.hideFeedback(true);
      body.innerHTML = '';
      actions.innerHTML = '';
      actions.classList.remove('hidden');
      updateBar();

      var step = steps[idx];
      switch (step.type) {
        case 'teach':   renderTeach(step); break;
        case 'set':     renderSet(step); break;
        case 'read':    renderRead(step); break;
        case 'pick':    renderPick(step); break;
        case 'minutes': renderMinutes(step); break;
        case 'match':   renderMatch(step); break;
        default: next();
      }
    }

    /* ---------------- Реакция на ответ ---------------- */

    function award(firstTry) {
      var gain = firstTry ? 10 : 5;
      xpEarned += gain;
      var up = Progress.addXP(gain);
      if (up) {
        Sound.levelUp();
        UI.toast('Новый уровень: ' + Progress.level().level + '!', { type: 'gold', emoji: '🚀' });
        FX.confetti({ count: 60 });
      }
    }

    /**
     * Общая обработка ответа.
     * @param {boolean} ok        верно ли
     * @param {object}  o         { hint, reveal, node }
     */
    function judge(ok, o) {
      o = o || {};
      attempts++;
      var exam = !!lesson.isExam;

      if (ok) {
        correctCount++;
        if (attempts === 1) firstTryCount++;
        taskDone++;
        Progress.answer(true);
        award(attempts === 1);
        Sound.success();
        if (o.node) FX.sparkleAt(o.node, '✨');
        if (Progress.data.combo > 0 && Progress.data.combo % 5 === 0) {
          FX.confetti({ count: 40 });
          UI.toast(Progress.data.combo + ' подряд!', { type: 'green', emoji: '🔥' });
        }
        updateBar();
        UI.feedback({
          ok: true,
          onNext: once(next)
        });
        return;
      }

      // Ответ неверный
      mistakes++;
      Sound.error();

      var lastChance = exam || attempts >= 2;
      if (lastChance) {
        Progress.answer(false);     // в статистику попадает итог задания, а не каждая попытка
        taskDone++;
        updateBar();
        if (o.reveal) o.reveal();
        UI.feedback({
          ok: false,
          title: 'Смотри, как правильно',
          hint: o.answerHint || '',
          buttonLabel: 'Понятно',
          onNext: once(next)
        });
      } else {
        Progress.resetCombo();      // серия верных ответов прерывается сразу
        UI.feedback({
          ok: false,
          hint: o.hint || 'Попробуй ещё раз 🙂',
          buttonLabel: 'Попробую',
          onNext: once(function () {
            // Возвращаем кнопку «Проверить» (если она есть) и сбрасываем подсветку
            if (actions.children.length) actions.classList.remove('hidden');
            if (o.onRetry) o.onRetry();
          })
        });
      }
    }

    /* =====================================================
       ШАГ: ОБЪЯСНЕНИЕ
       ===================================================== */
    function renderTeach(step) {
      var token = animToken;

      var clock = new Clock({
        time: step.clock || { h: 12, m: 0 },
        interactive: false,
        minuteNumbers: step.minuteNumbers !== false,
        className: ''
      });

      var digitalWrap = el('div', { class: 'center' });
      var counter = el('div', { class: 'minute-counter hidden' }, [
        el('span', { text: '0' }), el('small', { text: 'минут' })
      ]);

      var points = el('div', { class: 'teach__points' },
        (step.points || []).map(function (p, i) {
          var node = el('div', { class: 'teach__point' }, [
            el('span', { class: 'teach__point-emoji', text: p.emoji }),
            el('span', { html: p.html })
          ]);
          node.style.animationDelay = (0.15 + i * 0.12) + 's';
          return node;
        })
      );

      body.appendChild(el('div', { class: 'teach' }, [
        el('h2', { class: 't-title t-center', text: step.title || '' }),
        clock.el,
        counter,
        digitalWrap,
        points
      ]));

      actions.appendChild(btn('Дальше', {
        variant: 'green', huge: false, emoji: '👉',
        onClick: once(function () { animToken++; next(); })
      }));

      // Первый шаг урока строится ДО того, как роутер вставит экран в документ,
      // а анимация останавливается проверкой document.body.contains(clock.el).
      // Поэтому ждём монтирования — иначе объяснение показывалось статичной картинкой.
      waitMounted(clock.el, function () {
        if (token !== animToken) return;
        runTeachAnim(step, clock, { counter: counter, digital: digitalWrap }, token);
      });
    }

    /* =====================================================
       ШАГ: ПОСТАВЬ СТРЕЛКИ
       ===================================================== */
    function renderSet(step) {
      var target = step.target;
      var dragMode = step.drag || 'both';
      var snap = step.snap || (Progress.settings.difficulty === 'hard' ? 1 : 5);

      // Начальное положение стрелок — заведомо не ответ
      var startH = ((target.h + 5 - 1) % 12) + 1;
      var startM = dragMode === 'hour' ? target.m : (target.m + 20) % 60;
      startM = Math.round(startM / snap) * snap % 60;
      if (dragMode === 'minute') startH = target.h;

      var live = el('div', { class: 'center gap-10' });

      var clock = new Clock({
        time: { h: startH, m: startM },
        interactive: true,
        drag: dragMode,
        snap: snap,
        snapHour: dragMode === 'hour' ? 'strict' : false,
        linkHands: dragMode !== 'hour',
        showHour: !step.showMinutesOnly,
        minuteNumbers: true,
        onChange: function (t) { updateLive(t); }
      });

      function updateLive(t) {
        live.innerHTML = '';
        if (step.showMinutesOnly) {
          live.appendChild(el('div', { class: 'minute-counter' }, [
            el('span', { text: String(t.m) }), el('small', { text: 'минут' })
          ]));
        } else {
          live.appendChild(UI.digital(t.h, t.m, true));
        }
      }
      updateLive(clock.getTime());

      body.appendChild(el('div', { class: 'task__body' }, [
        el('h2', { class: 'task__question' }, [
          el('span', { text: step.question || 'Поставь время' })
        ]),
        step.hint ? el('div', { class: 'task__hint', text: step.hint }) : null,
        clock.el,
        live
      ]));

      var checked = false;
      var checkBtn = btn('Проверить', {
        variant: 'green', block: true,
        onClick: function () {
          if (checked) return;      // второй тап не должен давать лишний XP
          checked = true;
          var t = clock.getTime();
          var ok = (dragMode === 'hour') ? (t.h === target.h)
                 : (dragMode === 'minute') ? (t.m === target.m)
                 : (t.h === target.h && t.m === target.m);

          actions.classList.add('hidden');
          clock.setStatus(ok ? 'correct' : 'wrong');
          if (!ok) {
            judge(false, {
              hint: hintForSet(step, t, target, dragMode),
              answerHint: 'Правильно: <b>' + Curriculum.fmt(target) + '</b>',
              onRetry: function () { checked = false; clock.setStatus(null); },
              reveal: function () {
                clock.setInteractive(false);
                clock.setTime(target.h, target.m, true);
                clock.setStatus('correct');
                clock.pulse(dragMode === 'minute' ? 'minute' : 'hour', true);
              }
            });
          } else {
            clock.setInteractive(false);
            judge(true, { node: clock.el });
          }
        }
      });
      actions.appendChild(checkBtn);
    }

    function hintForSet(step, got, target, mode) {
      if (mode === 'hour') {
        // Считаем по кругу: от 11 до 1 ближе вперёд, а не назад через весь циферблат
        var dh = ((target.h - got.h) % 12 + 12) % 12;
        if (dh === 0) return 'Почти! Проверь ещё раз 🙂';
        if (dh <= 6) return dh <= 2 ? 'Чуть-чуть вперёд ➡️' : 'Двигай вперёд ➡️';
        return (12 - dh) <= 2 ? 'Чуть-чуть назад ⬅️' : 'Двигай назад ⬅️';
      }
      if (mode === 'minute') {
        var d = ((target.m - got.m) + 60) % 60;
        return d <= 30 ? 'Двигай стрелку вперёд ➡️' : 'Двигай стрелку назад ⬅️';
      }
      if (got.h !== target.h && got.m === target.m) return 'Минуты верно! Поправь <b>короткую</b> стрелку 🔵';
      if (got.h === target.h && got.m !== target.m) return 'Час верно! Поправь <b>длинную</b> стрелку 🟢';
      return 'Сначала поставь минуты 🟢, потом час 🔵';
    }

    /* =====================================================
       ШАГ: ПРОЧИТАЙ ВРЕМЯ (варианты — цифровые)
       ===================================================== */
    function renderRead(step) {
      var clock = new Clock({
        time: step.time,
        interactive: false,
        minuteNumbers: !step.hideMinutes,
        showMinute: !step.hideMinutes
      });

      var grid = el('div', { class: 'options options--4' });
      var answered = false;

      step.options.forEach(function (opt) {
        var b = el('button', {
          class: 'opt', type: 'button',
          onclick: function () {
            if (answered) return;
            var ok = opt.h === step.time.h && opt.m === step.time.m;
            if (ok) {
              answered = true;
              b.classList.add('is-correct');
              actions.classList.add('hidden');
              judge(true, { node: b });
            } else {
              b.classList.add('is-wrong');
              actions.classList.add('hidden');
              judge(false, {
                hint: 'Посмотри на <b>короткую</b> стрелку — какой это час? 🔵',
                answerHint: 'Здесь <b>' + Curriculum.fmt(step.time) + '</b>',
                onRetry: function () { b.classList.remove('is-wrong'); b.classList.add('is-muted'); },
                reveal: function () {
                  answered = true;
                  Array.prototype.forEach.call(grid.children, function (c, i) {
                    var o = step.options[i];
                    if (o.h === step.time.h && o.m === step.time.m) c.classList.add('is-correct');
                    else c.classList.add('is-muted');
                  });
                  clock.pulse('hour', true);
                }
              });
            }
          }
        }, [el('span', { text: Curriculum.fmt(opt) })]);
        grid.appendChild(b);
      });

      body.appendChild(el('div', { class: 'task__body' }, [
        el('h2', { class: 'task__question', text: step.question || 'Сколько времени?' }),
        clock.el,
        grid
      ]));
      actions.classList.add('hidden');
    }

    /* =====================================================
       ШАГ: НАЙДИ ЧАСЫ (варианты — циферблаты)
       ===================================================== */
    function renderPick(step) {
      var grid = el('div', { class: 'options options--clocks' });
      var answered = false;
      var clocks = [];

      step.options.forEach(function (opt) {
        var c = Clock.face(opt.h, opt.m, 'clock--mini');
        clocks.push(c);
        var b = el('button', {
          class: 'opt', type: 'button', style: { padding: '10px' },
          onclick: function () {
            if (answered) return;
            var ok = opt.h === step.time.h && opt.m === step.time.m;
            if (ok) {
              answered = true;
              b.classList.add('is-correct');
              judge(true, { node: b });
            } else {
              b.classList.add('is-wrong');
              judge(false, {
                hint: 'Проверь, куда смотрит <b>длинная</b> стрелка 🟢',
                answerHint: 'Правильные часы подсвечены',
                onRetry: function () { b.classList.remove('is-wrong'); b.classList.add('is-muted'); },
                reveal: function () {
                  answered = true;
                  Array.prototype.forEach.call(grid.children, function (ch, i) {
                    var o = step.options[i];
                    if (o.h === step.time.h && o.m === step.time.m) ch.classList.add('is-correct');
                    else ch.classList.add('is-muted');
                  });
                }
              });
            }
          }
        }, [c.el]);
        grid.appendChild(b);
      });

      body.appendChild(el('div', { class: 'task__body' }, [
        el('h2', { class: 'task__question', text: step.question || 'Найди эти часы' }),
        UI.digital(step.time.h, step.time.m),
        grid
      ]));
      actions.classList.add('hidden');
    }

    /* =====================================================
       ШАГ: СКОЛЬКО МИНУТ?
       ===================================================== */
    function renderMinutes(step) {
      var clock = new Clock({
        time: { h: 12, m: step.m },
        interactive: false,
        showHour: false,
        minuteNumbers: true
      });

      var grid = el('div', { class: 'options options--4' });
      var answered = false;

      step.options.forEach(function (val) {
        var b = el('button', {
          class: 'opt', type: 'button',
          onclick: function () {
            if (answered) return;
            if (val === step.m) {
              answered = true;
              b.classList.add('is-correct');
              judge(true, { node: b });
            } else {
              b.classList.add('is-wrong');
              judge(false, {
                hint: 'Считай по 5: 5, 10, 15, 20…',
                answerHint: 'Это <b>' + step.m + '</b> минут',
                onRetry: function () {
                  b.classList.remove('is-wrong'); b.classList.add('is-muted');
                  clock.showSector(0, 5); setTimeout(function () { clock.showSector(null); }, 900);
                },
                reveal: function () {
                  answered = true;
                  Array.prototype.forEach.call(grid.children, function (c, i) {
                    if (step.options[i] === step.m) c.classList.add('is-correct');
                    else c.classList.add('is-muted');
                  });
                  clock.showSector(0, step.m);
                }
              });
            }
          }
        }, [el('span', { text: String(val) })]);
        grid.appendChild(b);
      });

      body.appendChild(el('div', { class: 'task__body' }, [
        el('h2', { class: 'task__question', text: step.question || 'Сколько минут?' }),
        clock.el,
        grid
      ]));
      actions.classList.add('hidden');
    }

    /* =====================================================
       ШАГ: СОЕДИНИ ПАРЫ
       ===================================================== */
    function renderMatch(step) {
      var pairs = step.pairs;
      var left = shuffle(pairs);
      var right = shuffle(pairs);
      var selected = null;   // выбранный элемент слева
      var done = 0;
      var wrongTries = 0;

      var colL = el('div', { class: 'match__col' });
      var colR = el('div', { class: 'match__col' });

      left.forEach(function (t) {
        var c = Clock.face(t.h, t.m, 'clock--tiny');
        var item = el('div', {
          class: 'match__item', role: 'button',
          onclick: function () {
            if (item.classList.contains('is-done')) return;
            Sound.click();
            if (selected) selected.node.classList.remove('is-sel');
            selected = { node: item, time: t };
            item.classList.add('is-sel');
          }
        }, [c.el]);
        colL.appendChild(item);
      });

      right.forEach(function (t) {
        var item = el('div', {
          class: 'match__item', role: 'button',
          onclick: function () {
            if (item.classList.contains('is-done')) return;
            if (!selected) {
              Sound.click();
              item.classList.add('is-bad');
              setTimeout(function () { item.classList.remove('is-bad'); }, 460);
              return;
            }
            if (selected.time.h === t.h && selected.time.m === t.m) {
              Sound.star(done);
              FX.sparkleAt(item, '⭐');
              selected.node.classList.remove('is-sel');
              selected.node.classList.add('is-done');
              item.classList.add('is-done');
              selected = null;
              done++;
              if (done === pairs.length) {
                setTimeout(function () {
                  // Пары всегда в итоге собраны — но за ошибки даём меньше опыта
                  attempts = wrongTries > 0 ? 1 : 0;
                  judge(true, { node: colR });
                }, 380);
              }
            } else {
              wrongTries++;
              Sound.error();
              item.classList.add('is-bad');
              selected.node.classList.remove('is-sel');
              selected = null;
              setTimeout(function () { item.classList.remove('is-bad'); }, 460);
            }
          }
        }, [el('div', { class: 'match__digital', text: Curriculum.fmt(t) })]);
        colR.appendChild(item);
      });

      body.appendChild(el('div', { class: 'task__body' }, [
        el('h2', { class: 'task__question', text: step.question || 'Соедини пары' }),
        el('div', { class: 'task__hint', text: 'Нажми на часы, потом на нужное время' }),
        el('div', { class: 'match' }, [colL, colR])
      ]));
      actions.classList.add('hidden');
    }

    /* =====================================================
       ЗАВЕРШЕНИЕ УРОКА
       ===================================================== */
    function finish() {
      animToken++;
      UI.hideFeedback(true);
      body.innerHTML = '';
      actions.innerHTML = '';
      bar.setPercent(100);

      var total = taskTotal || 1;
      // Звёзды — за ответы с ПЕРВОЙ попытки, иначе три звезды доставались и при ошибке в каждом задании
      var accuracy = firstTryCount / total;
      var stars = accuracy >= 0.95 ? 3 : accuracy >= 0.7 ? 2 : 1;

      // Бонус за завершение урока
      var bonus = 20 + stars * 10;
      xpEarned += bonus;
      Progress.addXP(bonus);

      var passed = !lesson.isExam || correctCount >= Math.ceil(total * 0.7);

      if (lesson.isExam) {
        Progress.setExam(correctCount, total);
      }
      Progress.completeLesson(lesson.id, stars);
      if (lesson.achievement) Progress.unlock(lesson.achievement);
      // Трофейную наклейку за экзамен даём только тем, кто его действительно сдал
      if (lesson.sticker && passed) Progress.addSticker(lesson.sticker);

      Sound.reward();
      FX.confetti({ count: 130 });
      if (stars === 3) FX.rain(['⭐', '🎉', lesson.sticker || '✨'], 16);

      var card = el('div', { class: 'card card--yellow t-center appear' }, [
        el('div', { style: { fontSize: '72px' }, text: passed ? (lesson.isExam ? '🥇' : lesson.emoji) : '💪' }),
        el('h2', { class: 't-title mt-8', text: passed ? 'Урок пройден!' : 'Почти получилось!' }),
        el('div', { class: 'center mt-16' }, [UI.stars(stars, true)]),
        el('div', { class: 'center gap-10 mt-16 wrap' }, [
          el('span', { class: 'pill pill--green', text: '✅ ' + correctCount + ' из ' + total }),
          el('span', { class: 'pill', text: '💎 +' + xpEarned + ' XP' }),
          lesson.sticker ? el('span', { class: 'pill pill--yellow', text: 'Наклейка ' + lesson.sticker }) : null
        ])
      ]);

      body.appendChild(card);

      if (lesson.isExam && passed) {
        Sound.fanfare();
        FX.fireworks(6);
        body.appendChild(el('div', { class: 'mt-16 center' }, [
          btn('Получить диплом', { variant: 'yellow', huge: true, emoji: '🎓', onClick: function () { Router.go('diploma'); } })
        ]));
      }

      var nextId = Curriculum.nextLessonId();
      actions.appendChild(el('div', { class: 'stack gap-10', style: { width: 'min(440px,100%)' } }, [
        btn('Продолжить', {
          variant: 'green', block: true,
          onClick: function () { Router.go('map', {}, { replace: true }); }
        }),
        btn('Пройти ещё раз', {
          variant: 'ghost', block: true, small: true,
          onClick: function () { Router.go('lesson', { id: lesson.id }, { replace: true }); }
        })
      ]));
    }

    render();
    return screen;
  }

  /* =======================================================
     ОБУЧАЮЩИЕ АНИМАЦИИ
     ======================================================= */
  function setDigital(wrap, h, m) {
    wrap.innerHTML = '';
    wrap.appendChild(UI.digital(h, m));
  }

  function setCounter(node, value, label) {
    node.classList.remove('hidden');
    node.innerHTML = '';
    node.appendChild(el('span', { text: String(value) }));
    node.appendChild(el('small', { text: label || 'минут' }));
  }

  async function runTeachAnim(step, clock, ui, token) {
    var alive = function () { return token === animToken && document.body.contains(clock.el); };

    switch (step.anim) {

      /* Знакомство: по очереди подсвечиваем стрелки */
      case 'introHands':
        while (alive()) {
          clock.pulse('hour', true); clock.dim('minute', true);
          Sound.tick();
          await delay(1500); if (!alive()) return;
          clock.pulse('hour', false); clock.dim('minute', false);
          clock.pulse('minute', true); clock.dim('hour', true);
          Sound.tick();
          await delay(1500); if (!alive()) return;
          clock.pulse('minute', false); clock.dim('hour', false);
          await delay(400);
        }
        break;

      /* Часовая стрелка обходит круг: 1, 2, 3 … 12 */
      case 'hourWalk':
        clock.dim('minute', true);
        clock.highlight('hour', true);
        while (alive()) {
          for (var h = 1; h <= 12; h++) {
            if (!alive()) return;
            await clock.setTime(h, 0, true, 420);
            setDigital(ui.digital, h, 0);
            Sound.tick();
            await delay(280);
          }
          await delay(700);
        }
        break;

      /* Минутная стрелка проходит полный круг = 60 минут */
      case 'minuteSweep':
        clock.dim('hour', true);
        clock.highlight('minute', true);
        while (alive()) {
          clock.setTime(12, 0, false);
          setCounter(ui.counter, 0);
          await clock.sweepMinutes(60, 6000, function (m, passed) {
            if (!alive()) { clock.stop(); return; }   // не тикаем на покинутом экране
            setCounter(ui.counter, passed >= 60 ? 60 : passed);
            if (passed % 5 === 0) Sound.notch();
            if (passed >= 60) clock.showSector(0, 60);
          });
          if (!alive()) return;
          setCounter(ui.counter, 60);
          clock.showSector(0, 60);
          Sound.success();
          await delay(1800);
          clock.showSector(null);
        }
        break;

      /* Шаги по 5 минут с показом сектора */
      case 'fiveSteps':
        clock.dim('hour', true);
        clock.highlight('minute', true);
        while (alive()) {
          clock.setTime(12, 0, false);
          clock.showSector(null);
          setCounter(ui.counter, 0);
          for (var i = 1; i <= 12; i++) {
            if (!alive()) return;
            await clock.setTime(12, i * 5 % 60, true, 340);
            clock.showSector(0, i * 5);
            setCounter(ui.counter, i * 5);
            Sound.star(i);
            await delay(360);
          }
          await delay(1200);
          clock.showSector(null);
        }
        break;

      /* Показ списка времён по кругу */
      case 'showList':
        var list = step.list || [step.clock];
        var j = 0;
        while (alive()) {
          var t = list[j % list.length];
          await clock.setTime(t.h, t.m, true, 620);
          setDigital(ui.digital, t.h, t.m);
          Sound.notch();
          await delay(1500);
          j++;
        }
        break;

      /* Половина круга */
      case 'halfSector':
        while (alive()) {
          clock.setTime(step.clock.h, 0, false);
          clock.showSector(null);
          setDigital(ui.digital, step.clock.h, 0);
          await delay(900); if (!alive()) return;
          await clock.sweepMinutes(30, 2200, function (m, passed) {
            if (!alive()) { clock.stop(); return; }
            clock.showSector(0, passed);
            setCounter(ui.counter, passed);
          });
          if (!alive()) return;
          clock.showSector(0, 30);
          setCounter(ui.counter, 30);
          setDigital(ui.digital, step.clock.h, 30);
          Sound.success();
          await delay(2200);
        }
        break;

      /* Четверть круга */
      case 'quarterSector':
      case 'quarter3Sector':
        var end = step.anim === 'quarterSector' ? 15 : 45;
        while (alive()) {
          clock.setTime(step.clock.h, 0, false);
          clock.showSector(null);
          setDigital(ui.digital, step.clock.h, 0);
          await delay(800); if (!alive()) return;
          await clock.sweepMinutes(end, end * 70, function (m, passed) {
            if (!alive()) { clock.stop(); return; }
            clock.showSector(0, passed);
            setCounter(ui.counter, passed);
          });
          if (!alive()) return;
          clock.showSector(0, end);
          setCounter(ui.counter, end);
          setDigital(ui.digital, step.clock.h, end);
          Sound.success();
          await delay(2000);
        }
        break;

      /* Считаем минуты по пять до нужного времени */
      case 'countBy5':
        var target = step.clock;
        while (alive()) {
          clock.setTime(target.h, 0, false);
          setCounter(ui.counter, 0);
          setDigital(ui.digital, target.h, 0);
          await delay(700);
          for (var k = 5; k <= target.m; k += 5) {
            if (!alive()) return;
            await clock.setTime(target.h, k, true, 300);
            setCounter(ui.counter, k);
            Sound.star(k / 5);
            await delay(320);
          }
          if (!alive()) return;
          setDigital(ui.digital, target.h, target.m);
          Sound.success();
          await delay(1800);
        }
        break;

      /* Аналоговые = цифровые */
      case 'analogDigital':
        var times = [{ h: 3, m: 15 }, { h: 7, m: 30 }, { h: 10, m: 45 }, { h: 5, m: 0 }];
        var q = 0;
        while (alive()) {
          var tt = times[q % times.length];
          await clock.setTime(tt.h, tt.m, true, 620);
          setDigital(ui.digital, tt.h, tt.m);
          clock.pulse('minute', true);
          Sound.notch();
          await delay(900);
          clock.pulse('minute', false);
          await delay(700);
          q++;
        }
        break;

      /* Подсказка: сначала минуты, потом час */
      case 'setHint':
        while (alive()) {
          clock.setTime(12, 0, false);
          setDigital(ui.digital, 12, 0);
          await delay(700); if (!alive()) return;
          clock.highlight('minute', true);
          await clock.setTime(12, step.clock.m, true, 800);
          setDigital(ui.digital, 12, step.clock.m);
          await delay(800); if (!alive()) return;
          clock.highlight('minute', false);
          clock.highlight('hour', true);
          await clock.setTime(step.clock.h, step.clock.m, true, 800);
          setDigital(ui.digital, step.clock.h, step.clock.m);
          Sound.success();
          await delay(1500); if (!alive()) return;
          clock.highlight('hour', false);
        }
        break;

      default:
        if (step.clock) setDigital(ui.digital, step.clock.h, step.clock.m);
    }
  }

  global.Lessons = {
    Screen: LessonScreen,
    stopAnims: function () { animToken++; }
  };

})(window);
