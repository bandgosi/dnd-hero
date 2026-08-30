/* =========================================================
   screens/main.js — приветствие, главный экран,
   дневная тренировка, карта юнитов.
   ========================================================= */
(function (global) {
  'use strict';

  var el = function () { return UI.el.apply(null, arguments); };

  /* =====================================================
     ПРИВЕТСТВИЕ: выбор персонажа и имени
     ===================================================== */
  function WelcomeScreen() {
    var screen = UI.screen('welcome');
    var chosen = Store.data.character || 'fox';

    var title = el('h1', { class: 't-hero welcome__title' });
    'Умняшка'.split('').forEach(function (ch, i) {
      var s = el('span', { text: ch });
      s.style.animationDelay = (0.08 + i * 0.06) + 's';
      s.style.color = ['#7C5CE0', '#17A2B8', '#FFB300', '#2FB86B', '#FF7A66', '#4C9AFF'][i % 6];
      title.appendChild(s);
    });

    var grid = el('div', { class: 'chars mt5' });
    Characters.LIST.forEach(function (c) {
      var node = el('button', {
        class: 'char' + (c.id === chosen ? ' is-on' : ''), type: 'button',
        onclick: function () {
          SFX.tap();
          chosen = c.id;
          Store.setCharacter(c.id);
          Array.prototype.forEach.call(grid.children, function (n) { n.classList.remove('is-on'); });
          node.classList.add('is-on');
          Speech.phrase(c.hello);
        }
      }, [
        el('div', { class: 'char__ico', text: c.emoji }),
        el('div', { class: 'char__name', text: c.name })
      ]);
      grid.appendChild(node);
    });

    var nameInput = el('input', {
      class: 'field mt4', type: 'text', maxlength: '16',
      placeholder: 'Как тебя зовут?', value: Store.data.name || '',
      'aria-label': 'Имя ребёнка'
    });

    screen.appendChild(el('div', { class: 'center stack g3', style: { flex: '1', justifyContent: 'center' } }, [
      el('div', { class: 'welcome__logo float', text: '🎒' }),
      title,
      el('p', { class: 't-body center-text', text: 'Учимся читать и считать' }),
      el('div', { class: 't-sub mt5', text: 'Выбери друга' }),
      grid,
      el('div', { style: { width: 'min(420px,100%)' } }, [nameInput]),
      el('div', { class: 'mt5', style: { width: 'min(420px,100%)' } }, [
        UI.btn(Store.isNew() ? 'Начать!' : 'Продолжить', {
          variant: 'grass', huge: true, block: true, pulse: true, emoji: '▶️',
          onClick: function () {
            Store.setName(nameInput.value);
            Router.reset('home');
          }
        })
      ])
    ]));

    setTimeout(function () {
      if (document.body.contains(screen)) {
        Speech.phrase(Store.isNew()
          ? 'Привет! Выбери друга и напиши своё имя.'
          : 'С возвращением! Нажми «Продолжить».');
      }
    }, 500);

    return screen;
  }

  /* =====================================================
     ГЛАВНЫЙ ЭКРАН
     ===================================================== */
  function HomeScreen() {
    var screen = UI.screen('home');
    var lv = Store.level();

    /* Шапка: персонаж, приветствие, XP и серия */
    var hello = Store.data.name
      ? Characters.line('greetBack', { name: Store.data.name })
      : 'Привет! Чем займёмся?';

    screen.appendChild(el('div', { class: 'topbar' }, [
      el('div', { class: 'grow' }),
      UI.chip(String(lv.level), 'soft', '🚀'),
      UI.chip(Store.data.xp + ' XP', 'sun', '💎'),
      Store.data.streak.count > 0 ? UI.chip(String(Store.data.streak.count), 'grass', '🔥') : null,
      UI.iconBtn('⚙️', function () { Router.go('settings'); }, 'Настройки')
    ]));

    screen.appendChild(el('div', { class: 'home__hello' }, [Mascot.say(hello, { speak: true })]));

    /* Пять образовательных миров */
    var cards = el('div', { class: 'home__cards' });
    Curriculum.TRACK_ORDER.forEach(function (track, i) {
      var b = Curriculum.trackMeta(track);
      var pct = Curriculum.trackPercent(track);
      var stars = Curriculum.trackStars(track);
      var lvl = Curriculum.trackLevel(track);
      var card = el('button', {
        class: 'bigcard ' + b.theme + ' appear d' + Math.min(6, i + 1), type: 'button',
        onclick: function () { SFX.tap(); Router.go('path', { track: track }); }
      }, [
        el('div', { class: 'bigcard__ico', text: b.ico }),
        el('div', { class: 'bigcard__body' }, [
          el('div', { class: 'bigcard__title', text: b.title }),
          el('div', { class: 'bigcard__meta' }, [
            UI.chip('Уровень ' + lvl, 'soft', '🎯'),
            UI.chip(String(stars), 'sun', '⭐')
          ]),
          el('div', { class: 'mt2' }, [UI.bar(pct)])
        ]),
        el('div', { class: 'bigcard__go', text: '▶' })
      ]);
      cards.appendChild(card);
    });
    screen.appendChild(cards);

    /* Тренировка дня */
    screen.appendChild(dailyCard());

    /* Быстрые плитки */
    var tiles = el('div', { class: 'home__tiles' });
    [
      { ico: '🎮', label: 'Игры',      go: 'games' },
      { ico: '🎁', label: 'Награды',   go: 'rewards' },
      { ico: '⭐', label: 'Успехи',    go: 'progress' },
      { ico: '👨‍👩‍👧', label: 'Родителям', go: 'parentgate' }
    ].forEach(function (t, i) {
      tiles.appendChild(el('button', {
        class: 'tile appear d' + Math.min(6, i + 1), type: 'button',
        onclick: function () { SFX.tap(); Router.go(t.go); }
      }, [
        el('div', { class: 'tile__ico', text: t.ico }),
        el('div', { class: 'tile__label', text: t.label })
      ]));
    });
    screen.appendChild(tiles);

    return screen;
  }

  /* ---------- Карточка «Моя тренировка сегодня» ---------- */
  function buildDailyPlan() {
    var plan = [];
    var r = Curriculum.next('reading');
    var m = Curriculum.next('math');
    var games = Games.ids();

    if (r) plan.push({ id: 'd-read', ico: r.emoji, title: r.title, sub: 'Чтение и письмо',
                       action: { screen: 'lesson', params: { unitId: r.id, size: 6, daily: 'd-read' } } });
    if (m) plan.push({ id: 'd-math', ico: m.emoji, title: m.title, sub: 'Математика',
                       action: { screen: 'lesson', params: { unitId: m.id, size: 6, daily: 'd-math' } } });

    /* Третий пункт чередуется между новыми мирами по дням, а не валит
       все категории сразу: сегодня космос, завтра школа, потом мой мир.
       Если в каком-то мире накопились слабые навыки — он идёт вне очереди. */
    var extraTracks = ['space', 'school', 'world'];
    var weakTrack = null;
    extraTracks.forEach(function (t) {
      if (weakTrack) return;
      if (Skills.weakest(Curriculum.trackSkills(t), 3).length >= 3) weakTrack = t;
    });
    var dayN = Math.floor(Date.now() / 86400000);
    var pick = weakTrack || extraTracks[dayN % extraTracks.length];
    var extra = Curriculum.next(pick);
    var subNames = { space: 'Космос', school: 'Скоро в школу', world: 'Мой мир' };
    if (extra) plan.push({ id: 'd-extra', ico: extra.emoji, title: extra.title, sub: subNames[pick],
                           action: { screen: 'lesson', params: { unitId: extra.id, size: 5, daily: 'd-extra' } } });

    // Письмо — отдельным пунктом, если такой юнит открыт
    var write = Curriculum.ALL.filter(function (u) {
      return (u.section === 'writeLetters' || u.section === 'writeDigits') && Curriculum.isOpen(u.id);
    })[0];
    if (write) plan.push({ id: 'd-write', ico: '✍️', title: 'Пишем', sub: write.title,
                           action: { screen: 'lesson', params: { unitId: write.id, size: 3, daily: 'd-write' } } });

    if (games.length) {
      var g = Games.byId(games[UI.rnd(0, games.length - 1)]);
      plan.push({ id: 'd-game', ico: g.emoji, title: g.title, sub: 'Мини-игра',
                  action: { screen: 'game', params: { id: g.id } } });
    }
    return plan;
  }

  function dailyCard() {
    if (!Store.dailyFresh() || !Store.daily().plan.length) {
      Store.setDaily(buildDailyPlan());
    }
    var daily = Store.daily();
    var done = daily.done || [];
    var allDone = daily.plan.length > 0 && daily.plan.every(function (p) { return done.indexOf(p.id) !== -1; });

    if (allDone) Store.unlockAch('daily-1');

    var list = el('div', { class: 'daily mt3' });
    daily.plan.forEach(function (p) {
      var isDone = done.indexOf(p.id) !== -1;
      list.appendChild(el('button', {
        class: 'daily__item' + (isDone ? ' is-done' : ''), type: 'button',
        onclick: function () {
          SFX.tap();
          Router.go(p.action.screen, p.action.params);
        }
      }, [
        el('div', { class: 'daily__ico', text: p.ico }),
        el('div', { class: 'daily__txt' }, [
          el('div', { text: p.title }),
          el('div', { class: 'daily__sub', text: p.sub })
        ]),
        el('div', { class: 'daily__mark', text: isDone ? '✓' : '›' })
      ]));
    });

    return el('div', { class: 'card card--sun mt5 appear d3' }, [
      el('div', { class: 'row g3' }, [
        el('div', { style: { fontSize: '34px' }, text: allDone ? '🎉' : '⚡' }),
        el('div', { class: 'grow' }, [
          el('div', { class: 't-sub', text: allDone ? 'Тренировка закончена!' : 'Моя тренировка сегодня' }),
          el('div', { class: 't-small', text: allDone ? 'Ты молодец!' : 'Всего 5 минут' })
        ]),
        UI.chip(done.length + '/' + daily.plan.length, 'grass', '✅')
      ]),
      list
    ]);
  }

  /* =====================================================
     КАРТА ЮНИТОВ БЛОКА
     ===================================================== */
  function PathScreen(params) {
    var track = Curriculum.TRACKS[params.track] && !Curriculum.TRACKS[params.track].hidden
      ? params.track : 'reading';
    var meta = Curriculum.trackMeta(track);
    var screen = UI.screen('pathscreen ' + meta.theme);
    var list = Curriculum.byTrack(track);
    var nextUnit = Curriculum.next(track);

    screen.appendChild(UI.topbar({
      title: meta.ico + ' ' + meta.title,
      onBack: function () { Router.reset('home'); },
      right: [UI.chip(String(Curriculum.trackStars(track)), 'sun', '⭐')]
    }));

    /* Особые блоки мира: миссии космоса, школьный день, журнал открытий */
    if (Screens.trackExtras) {
      var extras = Screens.trackExtras(track);
      if (extras) screen.appendChild(extras);
    }

    var pct = Curriculum.trackPercent(track);
    screen.appendChild(el('div', { class: 'card card--tint appear' }, [
      el('div', { class: 'row g3' }, [
        el('div', { style: { fontSize: '32px' }, text: '🗺️' }),
        el('div', { class: 'grow' }, [
          el('div', { class: 't-sub', text: 'Пройдено ' + pct + '%' }),
          el('div', { class: 'mt2' }, [UI.bar(pct)])
        ])
      ])
    ]));

    // Космос рисуем на тёмном звёздном небе — атмосфера, но текст читаемый
    var path = el('div', { class: 'path' + (track === 'space' ? ' space-sky' : '') });
    list.forEach(function (u, i) {
      var open = Curriculum.isOpen(u.id);
      var rec = Store.unit(u.id);
      var isNow = nextUnit && u.id === nextUnit.id && open;

      var node = el('div', {
        class: 'unit ' + (i % 2 ? 'unit--r' : 'unit--l') +
          (rec.done ? ' is-done' : '') + (isNow ? ' is-now' : '') + (open ? ' is-open' : ' is-locked')
      });

      node.appendChild(el('div', { class: 'unit__in' }, [
        el('button', {
          class: 'unit__btn', type: 'button',
          'aria-label': u.title + (open ? '' : ' — закрыто'),
          onclick: function () {
            if (!open) {
              SFX.tick();
              UI.toast('Сначала пройди предыдущий урок', { emoji: '🔒' });
              Speech.phrase('Этот урок пока закрыт. Сначала пройди предыдущий.');
              return;
            }
            SFX.tap();
            Router.go('lesson', { unitId: u.id });
          }
        }, [
          el('span', { text: open ? u.emoji : '🔒' }),
          rec.done ? el('span', { class: 'unit__badge', text: '✓' }) : null
        ]),
        el('div', { class: 'unit__label', text: u.title }),
        el('div', { class: 'unit__desc', text: u.desc || '' }),
        rec.done ? UI.stars(rec.stars) : null
      ]));
      path.appendChild(node);
    });
    screen.appendChild(path);

    return screen;
  }

  global.Screens = global.Screens || {};
  Screens.Welcome = WelcomeScreen;
  Screens.Home = HomeScreen;
  Screens.Path = PathScreen;
  Screens.buildDailyPlan = buildDailyPlan;

})(window);
