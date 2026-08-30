/* =========================================================
   screens/worlds.js — экраны новых миров:
   — блоки-шапки карт (миссии космоса, школьный день, журнал);
   — режим «Школьный день» (4 урока + перемены);
   — «Журнал открытий» (коллекция карточек);
   — «Моя готовность» (рюкзачок с 5 категориями).
   ========================================================= */
(function (global) {
  'use strict';

  var el = function () { return UI.el.apply(null, arguments); };

  /* =====================================================
     Готовность к школе: проценты по категориям.
     Показываем категорию только после 5+ попыток (правило
     учителя: «Мы ещё знакомимся»).
     ===================================================== */
  function readiness() {
    var out = [];
    Object.keys(SchoolData.READINESS).forEach(function (key) {
      var cat = SchoolData.READINESS[key];
      var attempts = 0, accSum = 0, accN = 0;
      Object.keys(Store.data.skills).forEach(function (id) {
        var prefix = id.split(':')[0];
        if (cat.prefixes.indexOf(prefix) === -1) return;
        var s = Store.data.skills[id];
        if (!s || !s.attempts) return;
        attempts += s.attempts;
        accSum += s.accuracy; accN++;
      });
      out.push({
        key: key, title: cat.title, emoji: cat.emoji,
        known: attempts >= 5,
        percent: accN ? Math.round(accSum / accN * 100) : 0
      });
    });
    return out;
  }

  function readinessCard() {
    var rows = readiness();
    var anyKnown = rows.some(function (r) { return r.known; });
    return el('div', { class: 'card card--tint appear d2' }, [
      el('div', { class: 'row g3' }, [
        el('div', { style: { fontSize: '30px' }, text: '🎒' }),
        el('div', { class: 'grow' }, [
          el('div', { class: 't-sub', text: 'Мой рюкзачок готовности' }),
          el('div', { class: 't-small', text: anyKnown ? 'Так растут твои суперсилы' : 'Мы ещё знакомимся 🙂' })
        ])
      ]),
      el('div', { class: 'stack g2 mt3' }, rows.map(function (r) {
        return el('div', { class: 'ready-row' }, [
          el('span', { class: 'ready-row__ico', text: r.emoji }),
          el('span', { class: 'ready-row__name', text: r.title }),
          el('div', { class: 'grow' }, [UI.bar(r.known ? r.percent : 0)]),
          el('span', { class: 'ready-row__pct', text: r.known ? r.percent + '%' : '…' })
        ]);
      }))
    ]);
  }

  /* =====================================================
     Особые блоки над картой мира
     ===================================================== */
  function trackExtras(track) {
    if (track === 'space') return spaceMissions();
    if (track === 'school') return schoolExtras();
    if (track === 'world') return worldExtras();
    return null;
  }

  /* Значки-миссии космоса: горят, когда пройдены их уровни */
  function spaceMissions() {
    var row = el('div', { class: 'center g2 wrap' });
    SpaceData.MISSIONS.forEach(function (ms) {
      var done = ms.units.every(function (id) { return Store.unit(id).done; });
      var chip = UI.chip(ms.title, done ? 'sun' : 'soft', ms.emoji);
      if (!done) chip.style.opacity = '0.55';
      row.appendChild(chip);
    });
    return el('div', { class: 'card appear' }, [
      el('div', { class: 't-sub center-text', text: '🏅 Космические миссии' }),
      el('div', { class: 'mt2' }, [row])
    ]);
  }

  function schoolExtras() {
    var sd = Store.schoolDay();
    var doneAll = sd.done.length >= Curriculum.SCHOOLDAY.length;
    return el('div', { class: 'stack g3' }, [
      el('button', {
        class: 'sd-item is-next appear', type: 'button',
        onclick: function () { SFX.tap(); Router.go('schoolday'); }
      }, [
        el('span', { class: 'sd-item__ico', text: doneAll ? '🎉' : '🔔' }),
        el('div', { class: 'grow' }, [
          el('div', { class: 'sd-item__title', text: 'Школьный день' }),
          el('div', { class: 'sd-item__sub', text: doneAll ? 'Сегодня уже пройден. Молодец!' : '4 урока с переменами — как в настоящей школе' })
        ]),
        el('span', { class: 'sd-item__mark', text: '›' })
      ]),
      readinessCard()
    ]);
  }

  function worldExtras() {
    var total = 0, open = 0;
    WorldData.allAlbums().forEach(function (a) {
      a.cards.forEach(function (c) { total++; if (Store.hasCard(c.id)) open++; });
    });
    return el('button', {
      class: 'sd-item is-next appear', type: 'button',
      onclick: function () { SFX.tap(); Router.go('collection'); }
    }, [
      el('span', { class: 'sd-item__ico', text: '📖' }),
      el('div', { class: 'grow' }, [
        el('div', { class: 'sd-item__title', text: 'Журнал исследователя' }),
        el('div', { class: 'sd-item__sub', text: 'Открыто карточек: ' + open + ' из ' + total })
      ]),
      el('span', { class: 'sd-item__mark', text: '›' })
    ]);
  }

  /* =====================================================
     ШКОЛЬНЫЙ ДЕНЬ: расписание из 4 уроков и перемен
     ===================================================== */
  function SchoolDayScreen() {
    var screen = UI.screen('t-school');
    var sd = Store.schoolDay();

    screen.appendChild(UI.topbar({
      title: '🔔 Школьный день',
      onBack: function () { Router.go('path', { track: 'school' }, { replace: true }); }
    }));

    var lessons = Curriculum.SCHOOLDAY;
    var recess = [
      { id: 'rec-1', title: 'Перемена: игра!', sub: 'Разомнись в мини-игре', game: true },
      { id: 'rec-2', title: 'Перемена: игра!', sub: 'Ещё одна разминка', game: true }
    ];
    /* расписание: урок → перемена → урок → урок → перемена → урок */
    var timeline = [lessons[0], recess[0], lessons[1], lessons[2], recess[1], lessons[3]];

    var doneCount = lessons.filter(function (u) { return sd.done.indexOf(u.id) !== -1; }).length;
    var allDone = doneCount >= lessons.length;
    if (allDone) {
      Store.unlockAch('sch-day');
      // школьный день закрывает пункт дневной миссии, только если сегодня
      // «миром дня» была именно школа
      var extra = Store.daily().plan.filter(function (x) { return x.id === 'd-extra'; })[0];
      if (extra && extra.sub === 'Скоро в школу') Store.markDaily('d-extra');
    }

    screen.appendChild(el('div', { class: 'card card--sun appear' }, [
      el('div', { class: 'row g3' }, [
        el('div', { style: { fontSize: '34px' }, text: allDone ? '🎉' : '🏫' }),
        el('div', { class: 'grow' }, [
          el('div', { class: 't-sub', text: allDone ? 'Учебный день завершён!' : 'Расписание на сегодня' }),
          el('div', { class: 't-small', text: allDone ? 'Ты настоящий школьник!' : 'Уроки идут по порядку, между ними — перемены' })
        ]),
        UI.chip(doneCount + '/' + lessons.length, 'grass', '⭐')
      ])
    ]));

    var firstOpen = null;
    var list = el('div', { class: 'sd-list mt4' });
    timeline.forEach(function (item) {
      if (item.game) {
        var gameIds = Games.ids();
        var g = gameIds.length ? Games.byId(gameIds[UI.rnd(0, gameIds.length - 1)]) : null;
        list.appendChild(el('button', {
          class: 'sd-item', type: 'button',
          onclick: function () {
            if (!g) return;
            SFX.tap();
            Router.go('game', { id: g.id });
          }
        }, [
          el('span', { class: 'sd-item__ico', text: '🎲' }),
          el('div', { class: 'grow' }, [
            el('div', { class: 'sd-item__title', text: item.title }),
            el('div', { class: 'sd-item__sub', text: item.sub })
          ]),
          el('span', { class: 'sd-item__mark', text: '🎈' })
        ]));
        return;
      }
      var done = sd.done.indexOf(item.id) !== -1;
      var isNext = !done && !firstOpen;
      if (isNext) firstOpen = item;
      list.appendChild(el('button', {
        class: 'sd-item' + (done ? ' is-done' : isNext ? ' is-next' : ' is-wait'), type: 'button',
        onclick: function () {
          if (done) { UI.toast('Этот урок сегодня уже пройден!', { emoji: '✅' }); return; }
          SFX.tap();
          Router.go('lesson', { unitId: item.id, school: item.id, newLimit: 3 });
        }
      }, [
        el('span', { class: 'sd-item__ico', text: item.emoji }),
        el('div', { class: 'grow' }, [
          el('div', { class: 'sd-item__title', text: item.title }),
          el('div', { class: 'sd-item__sub', text: done ? 'Пройден' : 'Несколько коротких заданий' })
        ]),
        el('span', { class: 'sd-item__mark', text: done ? '✓' : '›' })
      ]));
    });
    screen.appendChild(list);

    if (allDone) {
      screen.appendChild(el('div', { class: 'center mt4' }, [
        Mascot.say(Characters.line('unitDone'), { center: true })
      ]));
      setTimeout(function () {
        if (document.body.contains(screen)) FX.confetti({ count: 80 });
      }, 400);
    }

    return screen;
  }

  /* =====================================================
     ЖУРНАЛ ИССЛЕДОВАТЕЛЯ: коллекция карточек
     ===================================================== */
  function CollectionScreen() {
    var screen = UI.screen('t-world');
    screen.appendChild(UI.topbar({
      title: '📖 Журнал исследователя',
      onBack: function () { Router.back(); }
    }));

    var totalOpen = 0;
    WorldData.allAlbums().forEach(function (album) {
      var openCount = album.cards.filter(function (c) { return Store.hasCard(c.id); }).length;
      totalOpen += openCount;
      if (!album.cards.length) return;

      screen.appendChild(el('div', { class: 'section-title mt4' }, [
        el('span', { text: album.emoji + ' ' + album.name + ' · ' + openCount + '/' + album.cards.length })
      ]));
      var grid = el('div', { class: 'col-grid mt2' });
      album.cards.forEach(function (c) {
        var has = Store.hasCard(c.id);
        var card = el('button', {
          class: 'col-card' + (has ? '' : ' is-locked'), type: 'button',
          'aria-label': has ? c.name : 'Ещё не найдено',
          onclick: function () {
            SFX.tap();
            if (has) {
              UI.modal({ emoji: c.emoji, title: c.name, text: c.fact,
                         actions: [{ label: 'Здорово!', variant: 'grass' }] });
              Speech.phrase(c.name + '. ' + c.fact);
            } else {
              UI.toast('Эта карточка ещё не найдена. Исследуй мир!', { emoji: '🔍' });
            }
          }
        }, [
          el('div', { class: 'col-card__ico', text: has ? c.emoji : '❓' }),
          el('div', { class: 'col-card__name', text: has ? c.name : '???' })
        ]);
        grid.appendChild(card);
      });
      screen.appendChild(grid);
    });

    /* звание коллекционера */
    var rank = totalOpen >= 40 ? '🏆 Знаток мира' : totalOpen >= 20 ? '🧭 Путешественник' : totalOpen >= 5 ? '🌱 Юный натуралист' : '👣 Первые шаги';
    screen.insertBefore(el('div', { class: 'card card--tint appear' }, [
      el('div', { class: 'row g3' }, [
        el('div', { style: { fontSize: '30px' }, text: '🎖️' }),
        el('div', { class: 'grow' }, [
          el('div', { class: 't-sub', text: rank }),
          el('div', { class: 't-small', text: 'Открыто карточек: ' + totalOpen })
        ])
      ])
    ]), screen.children[1]);

    return screen;
  }

  global.Screens = global.Screens || {};
  Screens.trackExtras = trackExtras;
  Screens.SchoolDay = SchoolDayScreen;
  Screens.Collection = CollectionScreen;
  Screens.readiness = readiness;

})(window);
