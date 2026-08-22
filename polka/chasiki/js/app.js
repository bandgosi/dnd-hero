/* =========================================================
   app.js — экраны приложения и запуск.
   Приветствие • Карта • Знакомство с часами • Настройки •
   Достижения • Диплом
   ========================================================= */
(function (global) {
  'use strict';

  var el = UI.el, btn = UI.btn;

  /* =======================================================
     ЭКРАН 1: ПРИВЕТСТВИЕ
     ======================================================= */
  function WelcomeScreen() {
    var screen = UI.screen('welcome');

    var clock = new Clock({
      time: { h: 10, m: 10 },
      interactive: false,
      minuteNumbers: false,
      className: 'welcome__clock'
    });

    // Стрелки медленно «оживают», пока экран приветствия на виду.
    // Считаем время в минутах от 10:10, иначе часовая прыгает назад.
    (function idle() {
      var total = 10 * 60 + 10;
      var timer = setInterval(function () {
        if (!document.body.contains(clock.el)) { clearInterval(timer); return; }
        total += 5;
        clock.setTime(Math.floor(total / 60) % 12 || 12, total % 60, true, 900);
      }, 2600);
    })();

    var title = el('h1', { class: 't-huge welcome__title' });
    'Часики'.split('').forEach(function (ch, i) {
      var s = el('span', { text: ch });
      s.style.animationDelay = (0.1 + i * 0.07) + 's';
      s.style.color = ['#3DA9FC', '#35C77B', '#FFC93C', '#A78BFA', '#FF9F45', '#3DA9FC'][i % 6];
      title.appendChild(s);
    });

    var started = Progress.data.xp > 0 || Object.keys(Progress.data.lessons).length > 0;
    var name = Progress.data.name;

    screen.appendChild(el('div', { class: 'center stack', style: { flex: '1', justifyContent: 'center' } }, [
      clock.el,
      title,
      el('p', { class: 't-body t-center mt-8', text: name ? ('Привет, ' + name + '! Учимся понимать время') : 'Учимся понимать время' }),
      el('div', { class: 'welcome__actions' }, [
        btn(started ? 'Продолжить' : 'Начать играть', {
          variant: 'green', huge: true, block: true, pulse: true, emoji: '▶️',
          onClick: function () { Router.reset('map'); }
        }),
        el('div', { class: 'welcome__mini' }, [
          btn('Как устроены часы', { variant: 'ghost', small: true, emoji: '🔎', onClick: function () { Router.go('explore'); } }),
          btn('Награды', { variant: 'ghost', small: true, emoji: '🏆', onClick: function () { Router.go('achievements'); } }),
          btn('Настройки', { variant: 'ghost', small: true, emoji: '⚙️', onClick: function () { Router.go('settings'); } })
        ])
      ])
    ]));

    return screen;
  }

  /* =======================================================
     ЭКРАН 2: КАРТА УРОВНЕЙ
     ======================================================= */
  function MapScreen() {
    var screen = UI.screen('map');
    screen.appendChild(UI.topbar({}));

    var pct = Progress.percent(Curriculum.LESSON_IDS);
    var totalStars = Progress.totalStars();
    var nextId = Curriculum.nextLessonId();

    // Карточка общего прогресса
    screen.appendChild(el('div', { class: 'card card--blue appear' }, [
      el('div', { class: 'row gap-12' }, [
        el('div', { style: { fontSize: '42px' }, text: '🗺️' }),
        el('div', { class: 'grow' }, [
          el('div', { class: 't-sub', text: 'Пройдено ' + pct + '%' }),
          el('div', { class: 'progress mt-8' }, [
            el('span', { class: 'progress__fill', style: { width: pct + '%' } })
          ])
        ]),
        el('div', { class: 'stack center' }, [
          el('div', { style: { fontSize: '26px' }, text: '⭐' }),
          el('div', { class: 't-sub', text: String(totalStars) })
        ])
      ])
    ]));

    // Дорожка уровней
    var path = el('div', { class: 'path' });
    Curriculum.LESSONS.forEach(function (lesson, i) {
      var open = Curriculum.isUnlocked(lesson.id);
      var done = Progress.isDone(lesson.id);
      var current = lesson.id === nextId && open;
      var rec = Progress.lesson(lesson.id);

      var node = el('div', {
        class: 'node ' + (i % 2 ? 'node--r' : 'node--l') +
          (done ? ' is-done' : '') + (current ? ' is-current' : '') +
          (open ? ' is-open' : ' is-locked')
      });

      var button = el('button', {
        class: 'node__btn', type: 'button',
        onclick: function () {
          if (!open) {
            // Замок должен отвечать: молчащая кнопка ребёнка сбивает с толку
            Sound.notch();
            UI.toast('Сначала пройди предыдущий уровень', { emoji: '🔒' });
            return;
          }
          Sound.click();
          startLesson(lesson);
        }
      }, [
        el('span', { text: open ? lesson.emoji : '🔒' }),
        done ? el('span', { class: 'node__badge', text: '✓' }) : null
      ]);

      node.appendChild(el('div', { class: 'node__inner' }, [
        button,
        el('div', { class: 'node__label', text: lesson.num + '. ' + lesson.title }),
        done ? UI.stars(rec.best) : null
      ]));
      path.appendChild(node);
    });
    screen.appendChild(path);

    // Мини-игры
    screen.appendChild(el('h2', { class: 't-sub mt-24 mb-8', text: '🎮 Мини-игры' }));
    var grid = el('div', { class: 'games-grid' });
    Games.LIST.forEach(function (g, i) {
      var rec = Progress.game(g.id);
      grid.appendChild(el('button', {
        class: 'game-card game-card--' + (i + 1), type: 'button',
        onclick: function () { Sound.click(); Router.go('game', { id: g.id }); }
      }, [
        el('div', { class: 'game-card__emoji', text: g.emoji }),
        el('div', { class: 'game-card__title', text: g.title }),
        el('div', { class: 'game-card__best', text: rec.plays ? ('рекорд: ' + rec.best) : 'сыграть' })
      ]));
    });
    screen.appendChild(grid);

    // Наклейки
    if (Progress.data.stickers.length) {
      screen.appendChild(el('h2', { class: 't-sub mt-24 mb-8', text: '✨ Мои наклейки' }));
      screen.appendChild(el('div', { class: 'row wrap gap-10' },
        Progress.data.stickers.map(function (s) { return el('div', { class: 'sticker', text: s }); })
      ));
    }

    screen.appendChild(el('div', { class: 'row gap-10 wrap mt-24' }, [
      btn('Как устроены часы', { variant: 'ghost', small: true, emoji: '🔎', onClick: function () { Router.go('explore'); } }),
      btn('Награды', { variant: 'ghost', small: true, emoji: '🏆', onClick: function () { Router.go('achievements'); } })
    ]));

    return screen;
  }

  function startLesson(lesson) {
    if (lesson.isExam) {
      UI.modal({
        emoji: '🎓',
        title: 'Финальный экзамен',
        text: '20 заданий. За <b>14</b> правильных ответов ты получишь <b>диплом</b>, а за <b>18</b> — ещё и <b>золотую медаль</b>!',
        actions: [
          { label: 'Я готов!', variant: 'green', emoji: '💪', onClick: function () { Router.go('lesson', { id: lesson.id }); } },
          { label: 'Ещё потренируюсь', variant: 'ghost' }
        ]
      });
    } else {
      Router.go('lesson', { id: lesson.id });
    }
  }

  /* =======================================================
     ЭКРАН 3: ЗНАКОМСТВО С ЧАСАМИ
     ======================================================= */
  var PARTS = {
    hour: {
      emoji: '🔵', title: 'Часовая стрелка',
      text: 'Она <b>короткая</b> и толстая. Показывает, сколько сейчас <b>часов</b>. Двигается очень медленно: один круг за 12 часов.'
    },
    minute: {
      emoji: '🟢', title: 'Минутная стрелка',
      text: 'Она <b>длинная</b>. Показывает <b>минуты</b>. Один полный круг — это <b>60 минут</b>, то есть целый час.'
    },
    numbers: {
      emoji: '🔢', title: 'Цифры 1–12',
      text: 'По ним читаем <b>час</b>. А ещё каждая цифра — это <b>5 минут</b> для длинной стрелки.'
    },
    minuteNumbers: {
      emoji: '🟩', title: 'Минутные числа',
      text: 'Зелёные числа снаружи помогают считать минуты: 5, 10, 15, 20…'
    },
    ticks: {
      emoji: '➖', title: 'Чёрточки',
      text: 'Маленькие чёрточки — это <b>минуты</b>. Их ровно 60 вокруг всего циферблата.'
    },
    center: {
      emoji: '⚙️', title: 'Центр часов',
      text: 'Здесь <b>крепятся обе стрелки</b>. Отсюда они начинают свой путь по кругу.'
    }
  };

  function ExploreScreen() {
    var screen = UI.screen('explore');
    screen.appendChild(UI.topbar({ back: true, title: 'Как устроены часы' }));

    var info = el('div', { class: 'explore__info' });
    var chips = el('div', { class: 'explore__chips' });
    var current = null;

    var clock = new Clock({
      time: { h: 10, m: 8 },
      interactive: false,
      minuteNumbers: true,
      parts: true,
      className: 'explore__clock',
      onPartEnter: function (p) { show(p, false); },
      onPartLeave: function () { if (current) show(current, false); else showDefault(); },
      onPartClick: function (p) { show(p, true); }
    });

    function showDefault() {
      clock.clearHighlights();
      info.innerHTML = '';
      info.appendChild(UI.mascot(
        'Нажми на любую часть часов — я расскажу, что это такое!', '🕰️'
      ));
      Array.prototype.forEach.call(chips.children, function (c) { c.classList.remove('is-on'); });
    }

    function show(part, sticky) {
      var p = PARTS[part];
      if (!p) return;
      if (sticky) {
        current = current === part ? null : part;
        if (!current) { showDefault(); return; }
        Sound.click();
      }
      clock.clearHighlights();
      Object.keys(PARTS).forEach(function (k) { if (k !== part) clock.dim(k, true); });
      clock.highlight(part, true);
      clock.pulse(part === 'hour' || part === 'minute' ? part : 'center', false);

      info.innerHTML = '';
      info.appendChild(el('div', { class: 'card card--yellow appear' }, [
        el('div', { class: 'row gap-12' }, [
          el('div', { style: { fontSize: '38px' }, text: p.emoji }),
          el('div', {}, [
            el('div', { class: 't-sub', text: p.title }),
            el('div', { class: 't-body mt-4', html: p.text })
          ])
        ])
      ]));

      // Подсвечиваем чип закреплённой части, а не той, над которой просто мышь
      var active = current || part;
      Array.prototype.forEach.call(chips.children, function (c) {
        c.classList.toggle('is-on', c.dataset.part === active && !!current);
      });
    }

    Object.keys(PARTS).forEach(function (k) {
      var c = el('button', {
        class: 'explore__chip', type: 'button', dataset: { part: k },
        onclick: function () { show(k, true); }
      }, [el('span', { text: PARTS[k].emoji + ' ' + PARTS[k].title })]);
      chips.appendChild(c);
    });

    screen.appendChild(el('div', { class: 'explore__stage' }, [
      clock.el, chips, info
    ]));

    screen.appendChild(el('div', { class: 'center gap-10 wrap mt-24' }, [
      btn('Сколько сейчас времени?', {
        variant: 'purple', emoji: '⏰',
        onClick: function () {
          var d = new Date();
          clock.setTime(d.getHours() % 12 || 12, d.getMinutes(), true, 900);
          Sound.reward();
          UI.toast('Сейчас ' + UI.fmt(d.getHours(), d.getMinutes()), { type: 'green', emoji: '⏰' });
        }
      }),
      btn('Пусть идут!', {
        variant: 'ghost', emoji: '▶️',
        onClick: function () {
          Sound.startTicking(500);
          clock.sweepMinutes(60, 12000, function () {}).then(function () { Sound.stopTicking(); });
        }
      })
    ]));

    screen.appendChild(el('div', { class: 'center mt-24' }, [
      btn('Играть!', { variant: 'green', huge: true, emoji: '🎮', onClick: function () { Router.reset('map'); } })
    ]));

    showDefault();
    return screen;
  }

  /* =======================================================
     ЭКРАН: НАСТРОЙКИ
     ======================================================= */
  function SettingsScreen() {
    var screen = UI.screen('settings');
    screen.appendChild(UI.topbar({ back: true, title: 'Настройки', settings: false }));

    function switchRow(emoji, label, key, onToggle) {
      var sw = el('div', { class: 'switch' + (Progress.settings[key] ? ' is-on' : '') });
      var row = el('div', {
        class: 'switch-row', role: 'button',
        onclick: function () {
          var v = !Progress.settings[key];
          Progress.setSetting(key, v);
          sw.classList.toggle('is-on', v);
          Sound.click();
          if (onToggle) onToggle(v);
        }
      }, [
        el('div', { class: 'switch-row__label' }, [
          el('span', { class: 'switch-row__emoji', text: emoji }),
          el('span', { text: label })
        ]),
        sw
      ]);
      return row;
    }

    var nameInput = el('input', {
      class: 'field', type: 'text', maxlength: '16',
      placeholder: 'Как тебя зовут?', value: Progress.data.name || ''
    });
    nameInput.addEventListener('change', function () { Progress.setName(nameInput.value); });
    nameInput.addEventListener('blur', function () { Progress.setName(nameInput.value); });

    var diffSeg = el('div', { class: 'seg' });
    [
      { id: 'easy', label: '🐣 Просто' },
      { id: 'normal', label: '🙂 Обычно' },
      { id: 'hard', label: '🔥 Сложно' }
    ].forEach(function (d) {
      diffSeg.appendChild(el('button', {
        class: 'seg__btn' + (Progress.settings.difficulty === d.id ? ' is-on' : ''),
        type: 'button',
        onclick: function () {
          Progress.setSetting('difficulty', d.id);
          Sound.click();
          Array.prototype.forEach.call(diffSeg.children, function (c) { c.classList.remove('is-on'); });
          this.classList.add('is-on');
        }
      }, [el('span', { text: d.label })]));
    });

    screen.appendChild(el('div', { class: 'card appear' }, [
      el('div', { class: 't-sub mb-8', text: '👋 Имя' }),
      nameInput,
      el('div', { class: 'divider' }),
      switchRow('🔊', 'Звуки', 'sound', function (v) {
        Sound.setEnabled(v);
        if (v) Sound.success();
      }),
      switchRow('✨', 'Анимации', 'animations', function (v) {
        document.body.classList.toggle('no-anim', !v);
        FX.setEnabled(v);
      }),
      switchRow('🔓', 'Открыть все уровни', 'unlockAll'),
      el('div', { class: 'divider' }),
      el('div', { class: 't-sub mb-8', text: '🎚️ Сложность' }),
      diffSeg,
      el('div', { class: 't-body mt-8', text: 'Просто — целые часы и полчаса. Обычно — шаг 5 минут. Сложно — любое время.' })
    ]));

    screen.appendChild(el('div', { class: 'card mt-16 appear d2' }, [
      el('div', { class: 't-sub mb-8', text: '📊 Статистика' }),
      el('div', { class: 'row wrap gap-8' }, [
        el('span', { class: 'pill', text: '💎 ' + Progress.data.xp + ' XP' }),
        el('span', { class: 'pill pill--purple', text: '🚀 уровень ' + Progress.level().level }),
        el('span', { class: 'pill pill--green', text: '✅ верных: ' + Progress.data.totalCorrect }),
        el('span', { class: 'pill pill--yellow', text: '🔥 серия: ' + Progress.data.bestCombo }),
        el('span', { class: 'pill', text: '📅 дней подряд: ' + Progress.data.streak.count })
      ])
    ]));

    screen.appendChild(el('div', { class: 'center mt-24' }, [
      btn('Сбросить весь прогресс', {
        variant: 'ghost', small: true, emoji: '🗑️',
        onClick: function () {
          UI.modal({
            emoji: '🗑️',
            title: 'Начать всё сначала?',
            text: 'Все звёзды, награды и уровни будут удалены.',
            actions: [
              { label: 'Нет, оставить', variant: 'green' },
              {
                label: 'Да, сбросить', variant: 'ghost',
                onClick: function () {
                  Progress.reset();
                  applySettings();
                  UI.toast('Прогресс сброшен', { emoji: '🧽' });
                  Router.reset('welcome');
                }
              }
            ]
          });
        }
      })
    ]));

    screen.appendChild(el('div', { class: 't-body t-center mt-16', text: 'Часики • обучающая игра для детей 6–7 лет' }));
    return screen;
  }

  /* =======================================================
     ЭКРАН: ДОСТИЖЕНИЯ
     ======================================================= */
  function AchievementsScreen() {
    var screen = UI.screen('achievements');
    screen.appendChild(UI.topbar({ back: true, title: 'Награды' }));

    var opened = Progress.data.achievements.length;
    var total = Progress.ACHIEVEMENTS.length;

    screen.appendChild(el('div', { class: 'card card--yellow appear' }, [
      el('div', { class: 'row gap-12' }, [
        el('div', { style: { fontSize: '44px' }, text: '🏆' }),
        el('div', { class: 'grow' }, [
          el('div', { class: 't-sub', text: 'Открыто ' + opened + ' из ' + total }),
          el('div', { class: 'progress mt-8' }, [
            el('span', { class: 'progress__fill', style: { width: Math.round(opened / total * 100) + '%' } })
          ])
        ])
      ])
    ]));

    var grid = el('div', { class: 'ach-grid mt-16' });
    Progress.ACHIEVEMENTS.forEach(function (a, i) {
      var on = Progress.has(a.id);
      var node = el('div', { class: 'ach ' + (on ? 'is-on' : 'is-off') }, [
        el('div', { class: 'ach__emoji', text: on ? a.emoji : '❔' }),
        el('div', { class: 'ach__title', text: a.title }),
        el('div', { class: 'ach__desc', text: a.desc })
      ]);
      node.style.animation = 'appear .5s var(--ease-pop) both';
      node.style.animationDelay = (i * 0.03) + 's';
      grid.appendChild(node);
    });
    screen.appendChild(grid);

    if (Progress.data.stickers.length) {
      screen.appendChild(el('h2', { class: 't-sub mt-24 mb-8', text: '✨ Наклейки' }));
      screen.appendChild(el('div', { class: 'row wrap gap-10' },
        Progress.data.stickers.map(function (s) { return el('div', { class: 'sticker', text: s }); })
      ));
    }

    if (Progress.data.exam.passed) {
      screen.appendChild(el('div', { class: 'center mt-24' }, [
        btn('Мой диплом', { variant: 'yellow', emoji: '🎓', onClick: function () { Router.go('diploma'); } })
      ]));
    }

    return screen;
  }

  /* =======================================================
     ЭКРАН: ДИПЛОМ
     ======================================================= */
  function DiplomaScreen() {
    var screen = UI.screen('diploma-screen');
    screen.appendChild(UI.topbar({ back: true, title: 'Диплом', settings: false }));

    var name = Progress.data.name || 'Юный часовщик';
    var d = new Date();
    var months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
    var dateStr = d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();

    var clock = Clock.face(12, 0, 'clock--mini');

    screen.appendChild(el('div', { class: 'diploma appear' }, [
      el('div', { class: 'diploma__ribbon', text: 'ДИПЛОМ' }),
      el('div', { class: 'center mt-24' }, [el('div', { class: 'medal', text: '🥇' })]),
      el('div', { class: 't-sub mt-16', text: 'награждается' }),
      el('div', { class: 'diploma__name', text: name }),
      el('div', { class: 't-body' , html: 'за отличное знание часов и умение <b>читать время</b>' }),
      el('div', { class: 'center mt-16' }, [clock.el]),
      el('div', { class: 'center gap-10 mt-16 wrap' }, [
        el('span', { class: 'pill pill--green', text: '⭐ звёзд: ' + Progress.totalStars() }),
        el('span', { class: 'pill', text: '💎 ' + Progress.data.xp + ' XP' }),
        el('span', { class: 'pill pill--yellow', text: '🎓 экзамен: ' + Progress.data.exam.best + '/20' })
      ]),
      el('div', { class: 't-body mt-16', text: dateStr }),
      el('div', { class: 'diploma__seal', text: '⏰' })
    ]));

    screen.appendChild(el('div', { class: 'center gap-10 wrap mt-24' }, [
      btn('Распечатать', { variant: 'ghost', emoji: '🖨️', onClick: function () { global.print(); } }),
      btn('На карту', { variant: 'green', emoji: '🗺️', onClick: function () { Router.reset('map'); } })
    ]));

    setTimeout(function () {
      Sound.fanfare();
      FX.confetti({ count: 140 });
      FX.rain(['🎓', '⭐', '🎉', '🥇'], 18);
      clock.setTime(3, 25, true, 1600);
    }, 250);

    return screen;
  }

  /* =======================================================
     ЗАПУСК
     ======================================================= */
  /* =========================================================
     Связь с общим оглавлением «Детская полка».
     Модуль необязателен: если «Часики» открыли отдельно,
     всё работает как раньше.
     ========================================================= */
  function syncWithHub() {
    if (!global.KidHub) return;

    var shared = KidHub.get();
    if (shared.name && shared.name !== Progress.data.name) Progress.setName(shared.name);

    KidHub.addHomeButton('../index.html');

    function pushSummary() {
      KidHub.setSummary('chasiki', {
        percent: Curriculum.LESSON_IDS
          ? Progress.percent(Curriculum.LESSON_IDS) : 0,
        stars: Progress.totalStars(),
        label: 'Уровень ' + Progress.level().level
      });
    }
    pushSummary();

    var lastName = Progress.data.name;
    Progress.onChange(function (d) {
      if (d.name !== lastName) { lastName = d.name; KidHub.setName(d.name); }
      pushSummary();
    });
  }

  function applySettings() {
    var s = Progress.settings;
    // Системная настройка «уменьшить движение» тоже должна глушить конфетти
    var reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    Sound.setEnabled(s.sound);
    FX.setEnabled(s.animations && !reduce);
    document.body.classList.toggle('no-anim', !s.animations || !!reduce);
  }

  function boot() {
    // Подписка ДО init(): иначе награда за серию дней выдаётся молча
    Progress.onAchievement = UI.achievementToast;

    try {
      Progress.init();
    } catch (e) {
      // Повреждённая запись в хранилище не должна оставлять ребёнка с белым экраном
      console.warn('Прогресс повреждён, начинаем заново', e);
      Progress.reset();
    }

    syncWithHub();

    FX.init();
    applySettings();

    Router.define('welcome', WelcomeScreen);
    Router.define('map', MapScreen);
    Router.define('explore', ExploreScreen);
    Router.define('settings', SettingsScreen);
    Router.define('achievements', AchievementsScreen);
    Router.define('diploma', DiplomaScreen);
    Router.define('lesson', Lessons.Screen);
    Router.define('game', Games.Screen);

    Router.go('welcome', {}, { silent: true });

    // Серия дней: приветствие при первом заходе за день
    if (Progress.data.streak.count > 1) {
      setTimeout(function () {
        UI.toast('Ты играешь ' + Progress.data.streak.count + ' дня подряд!', { type: 'gold', emoji: '🔥', duration: 3000 });
      }, 1200);
    }

    // Esc закрывает только модальное окно. Панель обратной связи трогать нельзя:
    // в заданиях с вариантами ответа её кнопка — единственный путь дальше.
    global.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') UI.closeModal();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.App = { applySettings: applySettings };

})(window);
