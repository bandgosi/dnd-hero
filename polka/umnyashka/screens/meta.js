/* =========================================================
   screens/meta.js — игры, прогресс, награды, настройки,
   родительский режим (с защитой от ребёнка).
   ========================================================= */
(function (global) {
  'use strict';

  var el = function () { return UI.el.apply(null, arguments); };

  /* =====================================================
     ХАБ МИНИ-ИГР
     ===================================================== */
  function GamesScreen() {
    var screen = UI.screen('gameshub');
    screen.appendChild(UI.topbar({ title: '🎮 Игры', onBack: function () { Router.reset('home'); } }));

    screen.appendChild(el('div', { class: 'mb4' }, [
      Mascot.say('Выбери игру! В играх мы тоже учимся.', { speak: false })
    ]));

    var grid = el('div', { class: 'games-grid' });
    Games.LIST.forEach(function (g, i) {
      var rec = Store.game(g.id);
      grid.appendChild(el('button', {
        class: 'game-card appear d' + Math.min(6, i + 1), type: 'button',
        onclick: function () { SFX.tap(); Router.go('game', { id: g.id }); }
      }, [
        el('div', { class: 'game-card__ico', text: g.emoji }),
        el('div', { class: 'game-card__title', text: g.title }),
        el('div', { class: 'game-card__sub', text: rec.plays ? 'рекорд: ' + rec.best : g.unit || 'сыграть' })
      ]));
    });
    screen.appendChild(grid);
    return screen;
  }

  /* =====================================================
     ПРОГРЕСС «МОИ УСПЕХИ»
     ===================================================== */
  function ProgressScreen() {
    var screen = UI.screen('progress');
    screen.appendChild(UI.topbar({ title: '⭐ Мои успехи', onBack: function () { Router.reset('home'); } }));

    var lv = Store.level();
    screen.appendChild(el('div', { class: 'card card--tint appear' }, [
      el('div', { class: 'row g3' }, [
        Mascot.avatar(),
        el('div', { class: 'grow' }, [
          el('div', { class: 't-sub', text: (Store.data.name || 'Умняшка') + ', уровень ' + lv.level }),
          el('div', { class: 'mt2' }, [UI.bar(Math.round(lv.pct * 100))]),
          el('div', { class: 't-small mt2', text: Store.data.xp + ' XP · ещё ' + (lv.need - lv.into) + ' до нового уровня' })
        ])
      ])
    ]));

    Curriculum.TRACK_ORDER.forEach(function (track, ti) {
      var meta = Curriculum.trackMeta(track);
      var card = el('div', { class: 'card mt4 appear d' + Math.min(6, ti + 1) + ' ' + meta.theme }, [
        el('div', { class: 't-sub mb2', text: meta.ico + ' ' + meta.title })
      ]);
      var anyRow = false;

      Object.keys(Curriculum.SECTIONS).forEach(function (key) {
        var sec = Curriculum.SECTIONS[key];
        if (sec.track !== track) return;
        var ids = Curriculum.sectionSkills(key);
        if (!ids.length) return;
        var sum = Skills.summary(ids);
        anyRow = true;
        card.appendChild(el('div', { class: 'skillrow' }, [
          el('div', { class: 'skillrow__ico', text: sec.emoji }),
          el('div', { class: 'skillrow__body' }, [
            el('div', { class: 'skillrow__title', text: sec.title }),
            el('div', { class: 'skillrow__bar' }, [UI.bar(sum.percent)])
          ]),
          el('div', { class: 'skillrow__val' }, [UI.stars(sum.stars, false, 5)])
        ]));
      });
      if (anyRow) screen.appendChild(card);
    });

    var st = Store.data.stats;
    screen.appendChild(el('div', { class: 'card mt4 appear d3' }, [
      el('div', { class: 't-sub mb2', text: '📈 Всего' }),
      el('div', { class: 'row wrap g2' }, [
        UI.chip(String(Store.totalStars()), 'sun', '⭐'),
        UI.chip(st.totalCorrect + ' верных', 'grass', '✅'),
        UI.chip(Store.data.streak.count + ' дн. подряд', 'soft', '🔥'),
        UI.chip(Store.data.achievements.length + ' наград', 'sun', '🏆')
      ])
    ]));

    return screen;
  }

  /* =====================================================
     НАГРАДЫ И ГАРДЕРОБ ПЕРСОНАЖА
     ===================================================== */
  function RewardsScreen() {
    var screen = UI.screen('rewards');
    screen.appendChild(UI.topbar({ title: '🎁 Награды', onBack: function () { Router.reset('home'); } }));

    Achievements.checkRewards();

    /* Персонаж с надетыми предметами */
    var preview = el('div', { class: 'card card--tint center appear' }, [
      el('div', { class: 'mascot mascot--big mascot--center' }, [
        Mascot.avatar(),
        el('div', { class: 'mascot__bubble', text: Mascot.current().name })
      ])
    ]);
    screen.appendChild(preview);

    /* Точечное обновление: пересборка всего экрана перезапускала анимации
       и повторно выдавала награды с фанфарами при каждом надевании шапки */
    function refresh() {
      var eq = Store.data.equipped;
      Array.prototype.forEach.call(screen.querySelectorAll('.reward'), function (b) {
        if (!b.dataset.slot) return;
        b.classList.toggle('is-worn', eq[b.dataset.slot] === b.dataset.id);
      });
      var box = preview.querySelector('.mascot');
      if (box) box.replaceChild(Mascot.avatar(), box.firstChild);
    }

    /* Гардероб по слотам */
    var slots = [
      { id: 'hat', title: 'Шапки', ico: '🎩' },
      { id: 'glasses', title: 'Очки', ico: '👓' },
      { id: 'bag', title: 'Рюкзаки', ico: '🎒' },
      { id: 'pet', title: 'Питомцы', ico: '🐤' }
    ];
    var wardrobe = el('div', { class: 'card mt4 appear d1' }, [
      el('div', { class: 't-sub mb2', text: '👕 Гардероб' }),
      el('div', { class: 't-small mb4', text: 'Нажми, чтобы надеть или снять' })
    ]);
    slots.forEach(function (s) {
      var items = Achievements.REWARDS.filter(function (r) { return r.slot === s.id; });
      var row = el('div', { class: 'slotrow mt3' });
      items.forEach(function (r) {
        var have = Store.hasReward(r.id);
        var worn = Store.data.equipped[r.slot] === r.id;
        row.appendChild(el('button', {
          class: 'reward' + (have ? '' : ' is-locked') + (worn ? ' is-worn' : ''),
          type: 'button',
          dataset: { slot: r.slot, id: r.id },
          'aria-label': have ? r.title : (r.title + ' — закрыто'),
          title: have ? r.title : Achievements.needText(r.need),
          onclick: function () {
            if (!have) {
              SFX.tick();
              UI.toast(Achievements.needText(r.need), { emoji: '🔒', duration: 2600 });
              Speech.phrase(Achievements.needText(r.need));
              return;
            }
            SFX.tap();
            Store.equip(r.slot, r.id);
            refresh();
          }
        }, [
          el('span', { text: r.emoji }),
          have ? null : el('span', { class: 'reward__lock', text: '🔒' })
        ]));
      });
      wardrobe.appendChild(el('div', { class: 't-small', text: s.ico + ' ' + s.title }));
      wardrobe.appendChild(row);
    });
    screen.appendChild(wardrobe);

    /* Достижения */
    var opened = Store.data.achievements.length;
    var total = Achievements.LIST.length;
    screen.appendChild(el('div', { class: 'card card--sun mt4 appear d2' }, [
      el('div', { class: 'row g3' }, [
        el('div', { style: { fontSize: '34px' }, text: '🏆' }),
        el('div', { class: 'grow' }, [
          el('div', { class: 't-sub', text: 'Открыто ' + opened + ' из ' + total }),
          el('div', { class: 'mt2' }, [UI.bar(Math.round(opened / total * 100))])
        ])
      ])
    ]));

    var grid = el('div', { class: 'ach-grid mt4' });
    Achievements.LIST.forEach(function (a, i) {
      var on = Store.hasAch(a.id);
      var node = el('div', { class: 'ach ' + (on ? 'is-on' : 'is-off') }, [
        el('div', { class: 'ach__ico', text: on ? a.emoji : '❔' }),
        el('div', { class: 'ach__title', text: a.title }),
        el('div', { class: 'ach__desc', text: a.desc })
      ]);
      node.style.animation = 'appear .45s var(--pop) both';
      node.style.animationDelay = (i * 0.025) + 's';
      grid.appendChild(node);
    });
    screen.appendChild(grid);

    return screen;
  }

  /* =====================================================
     НАСТРОЙКИ
     ===================================================== */
  function SettingsScreen() {
    var screen = UI.screen('settings');
    screen.appendChild(UI.topbar({ title: '⚙️ Настройки', onBack: function () { Router.reset('home'); } }));

    function switchRow(ico, label, key, onToggle) {
      var sw = el('div', { class: 'switch' + (Store.settings[key] ? ' is-on' : '') });
      return el('div', {
        class: 'switch-row', role: 'button', tabindex: '0',
        onclick: toggle,
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }
      }, [
        el('div', { class: 'switch-row__label' }, [
          el('span', { class: 'switch-row__ico', text: ico }),
          el('span', { text: label })
        ]),
        sw
      ]);
      function toggle() {
        var v = !Store.settings[key];
        Store.setSetting(key, v);
        sw.classList.toggle('is-on', v);
        SFX.tap();
        if (onToggle) onToggle(v);
      }
    }

    var nameInput = el('input', {
      class: 'field', type: 'text', maxlength: '16',
      placeholder: 'Имя', value: Store.data.name || '', 'aria-label': 'Имя ребёнка'
    });
    nameInput.addEventListener('change', function () { Store.setName(nameInput.value); });
    nameInput.addEventListener('blur', function () { Store.setName(nameInput.value); });

    var charRow = el('div', { class: 'slotrow mt3' });
    Characters.LIST.forEach(function (c) {
      charRow.appendChild(el('button', {
        class: 'reward' + (Store.data.character === c.id ? ' is-worn' : ''), type: 'button',
        title: c.name,
        onclick: function () {
          SFX.tap();
          Store.setCharacter(c.id);
          Array.prototype.forEach.call(charRow.children, function (n) { n.classList.remove('is-worn'); });
          this.classList.add('is-worn');
          Speech.phrase(c.hello);
        }
      }, [el('span', { text: c.emoji })]));
    });

    screen.appendChild(el('div', { class: 'card appear' }, [
      el('div', { class: 't-sub mb2', text: '👋 Имя' }),
      nameInput,
      el('div', { class: 'divider' }),
      el('div', { class: 't-sub', text: '🦊 Друг' }),
      charRow,
      el('div', { class: 'divider' }),
      switchRow('🔊', 'Звуки кнопок', 'sound'),
      switchRow('🗣️', 'Голос помощника', 'speech', function (v) {
        if (v) Speech.phrase('Голос включён');
        else Speech.stop();
      }),
      switchRow('✨', 'Анимации', 'animations', function (v) {
        document.body.classList.toggle('no-anim', !v);
        FX.setEnabled(v);
      })
    ]));

    /* Скорость речи */
    var rates = [
      { id: 0.7, label: '🐢 Медленно' },
      { id: 0.85, label: '🙂 Обычно' },
      { id: 1, label: '🐇 Быстро' }
    ];
    var seg = el('div', { class: 'seg' });
    rates.forEach(function (r) {
      seg.appendChild(el('button', {
        class: 'seg__btn' + (Math.abs(Store.settings.speechRate - r.id) < 0.01 ? ' is-on' : ''),
        type: 'button',
        onclick: function () {
          Store.setSetting('speechRate', r.id);
          SFX.tap();
          Array.prototype.forEach.call(seg.children, function (n) { n.classList.remove('is-on'); });
          this.classList.add('is-on');
          Speech.phrase('Вот так я говорю');
        }
      }, [el('span', { text: r.label })]));
    });

    screen.appendChild(el('div', { class: 'card mt4 appear d1' }, [
      el('div', { class: 't-sub mb2', text: '🗣️ Скорость речи' }),
      seg,
      !Speech.supported ? el('div', { class: 't-small mt3', text: 'В этом браузере голос недоступен — задания можно читать вслух самим.' }) : null
    ]));

    /* ----- Выбор голоса: качество зависит от установленных на
       устройстве голосов, поэтому даём выбрать и послушать ----- */
    if (Speech.supported) {
      var voiceList = el('div', { class: 'stack g2' });

      function renderVoices() {
        voiceList.innerHTML = '';
        var voices = Speech.voices();
        if (!voices.length) {
          voiceList.appendChild(el('div', { class: 't-small', text: 'Голоса ещё загружаются… Загляни сюда чуть позже.' }));
          return;
        }
        var current = Speech.voiceName();
        voices.slice(0, 6).forEach(function (v) {
          var isOn = v.name === current;
          var row = el('div', {
            class: 'switch-row', role: 'button', tabindex: '0',
            style: isOn ? { borderColor: 'var(--accent)', background: 'var(--accent-tint)' } : null,
            onclick: function () {
              SFX.tap();
              Speech.setVoice(v.name);
              renderVoices();
              // say(), а не phrase(): здесь важно услышать именно
              // выбранный голос синтезатора, а не записанный клип
              Speech.say('Теперь я говорю вот так!');
            }
          }, [
            el('span', { style: { fontSize: '20px' }, text: isOn ? '✅' : '🎙️' }),
            el('div', { class: 'grow' }, [
              el('div', { style: { fontWeight: '800' }, text: prettyVoiceName(v.name) }),
              el('div', { class: 't-small', text: v.localService ? 'работает без интернета' : 'нужен интернет' })
            ]),
            UI.iconBtn('🔊', function (e) {
              e.stopPropagation();
              Speech.sample(v.name);
            }, 'Послушать голос')
          ]);
          voiceList.appendChild(row);
        });
      }
      renderVoices();
      // голоса на iOS/Android подгружаются не сразу
      if (global.speechSynthesis) {
        setTimeout(renderVoices, 600);
        setTimeout(renderVoices, 2000);
      }

      screen.appendChild(el('div', { class: 'card mt4 appear d2' }, [
        el('div', { class: 't-sub mb2', text: '🎙️ Голос' }),
        voiceList,
        el('div', { class: 'mt3' }, [
          UI.btn('Как сделать голос лучше?', {
            variant: 'ghost', small: true, block: true, emoji: '✨',
            onClick: showVoiceHelp
          })
        ])
      ]));
    }

    screen.appendChild(el('div', { class: 'center mt6' }, [
      UI.btn('Родителям', { variant: 'ghost', emoji: '👨‍👩‍👧', onClick: function () { Router.go('parentgate'); } })
    ]));

    return screen;
  }

  /* Имена голосов техничны («Microsoft Svetlana — Russian…») — упрощаем */
  function prettyVoiceName(name) {
    return String(name)
      .replace(/\s*[-—(].*$/, '')
      .replace(/^(Microsoft|Google|Apple)\s*/i, function (m) { return m.trim() + ' '; })
      .slice(0, 28) || name;
  }

  /* Инструкция для родителей: системный голос можно заменить на хороший */
  function showVoiceHelp() {
    var isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    var ios = '<b>iPhone / iPad:</b><br>Настройки → Универсальный доступ → Устный контент → Голоса → Русский → скачайте «Милена (улучшенный)». Потом выберите её здесь в списке.';
    var android = '<b>Android:</b><br>Установите или обновите «Синтезатор речи Google» из Play Маркета. Затем: Настройки → Система → Язык и ввод → Синтез речи → выберите Google и скачайте русский голос для офлайна.';
    UI.modal({
      emoji: '🎙️',
      title: 'Как сделать голос лучше',
      text: 'Приложение говорит голосами, установленными на устройстве. Хороший голос обычно уже есть — его нужно скачать и выбрать:<br><br>' +
        (isIOS ? ios + '<br><br>' + android : android + '<br><br>' + ios) +
        '<br><br>После установки вернитесь сюда и выберите новый голос кнопкой 🔊.',
      actions: [{ label: 'Понятно', variant: 'grass' }]
    });
  }

  /* =====================================================
     ЗАЩИТА РОДИТЕЛЬСКОГО РЕЖИМА
     ===================================================== */
  function ParentGateScreen() {
    var screen = UI.screen('parentgate');
    screen.appendChild(UI.topbar({ title: 'Для родителей', onBack: function () { Router.reset('home'); } }));

    var a = UI.rnd(11, 19), b = UI.rnd(6, 14);
    var answer = a + b;
    var input = el('input', {
      class: 'field field--num', type: 'text', inputmode: 'numeric',
      maxlength: '3', 'aria-label': 'Ответ', placeholder: '?'
    });
    var msg = el('div', { class: 't-small mt3', text: 'Этот раздел для взрослых' });

    function check() {
      if (parseInt(input.value, 10) === answer) {
        SFX.right();
        Router.go('parent', {}, { replace: true });
      } else {
        SFX.almost();
        input.value = '';
        input.classList.add('is-bad');
        msg.textContent = 'Не сходится, попробуйте ещё раз';
        setTimeout(function () { input.classList.remove('is-bad'); }, 500);
      }
    }
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') check(); });

    screen.appendChild(el('div', { class: 'card center-text appear', style: { marginTop: '10vh' } }, [
      el('div', { style: { fontSize: '54px' }, text: '🔐' }),
      el('h2', { class: 't-title mt2', text: 'Решите пример' }),
      el('div', { class: 't-hero mt4', text: a + ' + ' + b + ' = ?' }),
      el('div', { class: 'mt4' }, [input]),
      msg,
      el('div', { class: 'mt5' }, [
        UI.btn('Войти', { variant: 'grass', block: true, onClick: check })
      ])
    ]));

    setTimeout(function () { try { input.focus(); } catch (e) {} }, 300);
    return screen;
  }

  /* =====================================================
     РОДИТЕЛЬСКАЯ ПАНЕЛЬ
     ===================================================== */
  function ParentScreen() {
    var screen = UI.screen('parent');
    screen.appendChild(UI.topbar({ title: '👨‍👩‍👧 Родителям', onBack: function () { Router.reset('home'); } }));

    var st = Store.data.stats;
    var days = last7();
    var weekTasks = days.reduce(function (a, d) { return a + d.tasks; }, 0);
    var weekMin = days.reduce(function (a, d) { return a + d.minutes; }, 0);
    var weekCorrect = days.reduce(function (a, d) { return a + d.correct; }, 0);
    var acc = weekTasks ? Math.round(weekCorrect / weekTasks * 100) : 0;

    /* Сводка */
    screen.appendChild(el('div', { class: 'parent__grid appear' }, [
      stat(Math.round(weekMin) + ' мин', 'за неделю'),
      stat(String(weekTasks), 'заданий'),
      stat(acc + '%', 'верных ответов'),
      stat(String(Store.data.streak.count), 'дней подряд')
    ]));

    /* График недели */
    var maxT = Math.max(1, Math.max.apply(null, days.map(function (d) { return d.tasks; })));
    var week = el('div', { class: 'week mt3' });
    days.forEach(function (d) {
      week.appendChild(el('div', { class: 'week__col' }, [
        el('div', { class: 't-small', text: d.tasks ? String(d.tasks) : '' }),
        el('div', { class: 'week__bar', style: { height: Math.round(d.tasks / maxT * 78) + 4 + 'px' } }),
        el('div', { class: 'week__lab', text: d.label })
      ]));
    });
    screen.appendChild(el('div', { class: 'card mt4 appear d1' }, [
      el('div', { class: 't-sub mb2', text: '📅 Занятия за неделю' }),
      week
    ]));

    /* Что изучали */
    var studied = Curriculum.ALL.filter(function (u) { return Store.unit(u.id).done; });
    var current = Curriculum.TRACK_ORDER.map(function (t) { return Curriculum.next(t); }).filter(Boolean);
    screen.appendChild(el('div', { class: 'card mt4 appear d2' }, [
      el('div', { class: 't-sub mb2', text: '📖 Что изучаем' }),
      el('div', { class: 'row wrap g2' }, current.map(function (u) {
        return UI.chip(u.title, 'soft', u.emoji);
      })),
      el('div', { class: 't-small mt3', text: 'Пройдено уроков: ' + studied.length + ' из ' + Curriculum.ALL.length })
    ]));

    /* Прогресс по разделам */
    var secCard = el('div', { class: 'card mt4 appear d3' }, [
      el('div', { class: 't-sub mb2', text: '📊 Освоение тем' })
    ]);
    Object.keys(Curriculum.SECTIONS).forEach(function (key) {
      var sec = Curriculum.SECTIONS[key];
      var ids = Curriculum.sectionSkills(key);
      if (!ids.length) return;
      var sum = Skills.summary(ids);
      if (!sum.seen) return;
      secCard.appendChild(el('div', { class: 'skillrow' }, [
        el('div', { class: 'skillrow__ico', text: sec.emoji }),
        el('div', { class: 'skillrow__body' }, [
          el('div', { class: 'skillrow__title', text: sec.title }),
          el('div', { class: 'skillrow__bar' }, [UI.bar(sum.percent)])
        ]),
        el('div', { class: 'skillrow__val', text: sum.percent + '%' })
      ]));
    });
    screen.appendChild(secCard);

    /* 🎒 Готовность к школе: сильные стороны + что потренировать.
       Только позитивные формулировки — никаких «отстаёт» и диагнозов. */
    var ready = Screens.readiness ? Screens.readiness() : [];
    var known = ready.filter(function (r) { return r.known; });
    var readyCard = el('div', { class: 'card mt4 appear d3' }, [
      el('div', { class: 't-sub mb2', text: '🎒 Готовность к школе' })
    ]);
    if (!known.length) {
      readyCard.appendChild(el('div', { class: 't-body', text: 'Раздел «Скоро в школу» ещё в самом начале — данные появятся после первых занятий.' }));
    } else {
      known.forEach(function (r) {
        readyCard.appendChild(el('div', { class: 'skillrow' }, [
          el('div', { class: 'skillrow__ico', text: r.emoji }),
          el('div', { class: 'skillrow__body' }, [
            el('div', { class: 'skillrow__title', text: r.title }),
            el('div', { class: 'skillrow__bar' }, [UI.bar(r.percent)])
          ]),
          el('div', { class: 'skillrow__val', text: r.percent + '%' })
        ]));
      });
      var best = known.slice().sort(function (a, b) { return b.percent - a.percent; })[0];
      var worst = known.slice().sort(function (a, b) { return a.percent - b.percent; })[0];
      var lines = [];
      if (best && best.percent >= 60) {
        lines.push({ ico: '✓', text: '<b>' + best.title + '</b> — сильная сторона: уверенные ответы.' });
      }
      if (worst && worst.percent < 80 && worst.key && SchoolData.PARENT_TIPS[worst.key]) {
        lines.push({ ico: '💪', text: SchoolData.PARENT_TIPS[worst.key] });
      }
      if (lines.length) {
        readyCard.appendChild(el('div', { class: 'stack g2 mt3' }, lines.map(function (t) {
          return el('div', { class: 'tip' }, [
            el('span', { class: 'tip__ico', text: t.ico }),
            el('span', { html: t.text })
          ]);
        })));
      }
    }
    screen.appendChild(readyCard);

    /* 🌍 Интересы ребёнка: какие миры выбирает чаще */
    var byTrack = {};
    Curriculum.TRACK_ORDER.forEach(function (t) { byTrack[t] = 0; });
    Object.keys(Store.data.skills).forEach(function (id) {
      var s = Store.data.skills[id];
      if (!s || !s.attempts) return;
      Curriculum.TRACK_ORDER.forEach(function (t) {
        if (Curriculum.trackSkills(t).indexOf(id) !== -1) byTrack[t] += s.attempts;
      });
    });
    var fav = Curriculum.TRACK_ORDER.slice().sort(function (a, b) { return byTrack[b] - byTrack[a]; })
      .filter(function (t) { return byTrack[t] > 0; }).slice(0, 2);
    var cardsOpen = (Store.data.collection || []).length;
    if (fav.length || cardsOpen) {
      screen.appendChild(el('div', { class: 'card mt4 appear d3' }, [
        el('div', { class: 't-sub mb2', text: '🌟 Интересы' }),
        fav.length ? el('div', { class: 't-body', html: 'Чаще всего ребёнок выбирает: ' + fav.map(function (t) {
          var mt = Curriculum.trackMeta(t);
          return mt.ico + ' <b>' + mt.title + '</b>';
        }).join(' и ') + '.' }) : null,
        cardsOpen ? el('div', { class: 't-small mt2', text: '📖 В журнале открытий: ' + cardsOpen + ' карточек.' }) : null
      ]));
    }

    /* Слабые места */
    var weak = Skills.weakest(null, 10);
    var weakCard = el('div', { class: 'card mt4 appear d4' }, [
      el('div', { class: 't-sub mb2', text: '🎯 Требуют внимания' })
    ]);
    if (!weak.length) {
      weakCard.appendChild(el('div', { class: 't-body', text: 'Пока всё даётся ровно. Продолжайте в том же темпе.' }));
    } else {
      var box = el('div', { class: 'weak' });
      weak.forEach(function (id) {
        var s = Skills.get(id);
        box.appendChild(el('span', { class: 'weak__item' }, [
          el('span', { text: skillLabel(id) }),
          el('span', { class: 'weak__pct', text: Math.round(s.accuracy * 100) + '%' })
        ]));
      });
      weakCard.appendChild(box);
    }
    screen.appendChild(weakCard);

    /* Рекомендации */
    screen.appendChild(el('div', { class: 'card mt4 appear d5' }, [
      el('div', { class: 't-sub mb2', text: '💡 Рекомендации' }),
      el('div', { class: 'stack g3' }, advice(weak, days, acc).map(function (t) {
        return el('div', { class: 'tip' }, [
          el('span', { class: 'tip__ico', text: t.ico }),
          el('span', { html: t.text })
        ]);
      }))
    ]));

    /* Управление */
    screen.appendChild(el('div', { class: 'card mt4 appear d6' }, [
      el('div', { class: 't-sub mb2', text: '🛠️ Управление' }),
      el('div', { class: 'stack g3' }, [
        UI.btn('Сохранить отчёт (копия данных)', {
          variant: 'ghost', block: true, small: true, emoji: '📄',
          onClick: function () { downloadReport(); }
        }),
        UI.btn('Сбросить весь прогресс', {
          variant: 'ghost', block: true, small: true, emoji: '🗑️',
          onClick: function () {
            UI.modal({
              emoji: '🗑️', title: 'Начать всё сначала?',
              text: 'Будут удалены звёзды, награды и статистика ребёнка.',
              actions: [
                { label: 'Нет, оставить', variant: 'grass' },
                { label: 'Да, сбросить', variant: 'ghost', onClick: function () {
                    Store.reset();
                    UI.toast('Прогресс сброшен', { emoji: '🧽' });
                    Router.reset('welcome');
                  } }
              ]
            });
          }
        })
      ])
    ]));

    return screen;
  }

  function stat(val, lab) {
    return el('div', { class: 'stat' }, [
      el('div', { class: 'stat__val', text: val }),
      el('div', { class: 'stat__lab', text: lab })
    ]);
  }

  function last7() {
    var names = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    var out = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date();
      d.setDate(d.getDate() - i);
      var key = Store.dayStr(d);
      var rec = Store.data.stats.byDay[key] || { minutes: 0, tasks: 0, correct: 0 };
      out.push({ label: names[d.getDay()], minutes: rec.minutes, tasks: rec.tasks, correct: rec.correct });
    }
    return out;
  }

  /** Человеческое название навыка для родителя. */
  function skillLabel(id) {
    var p = id.split(':'), kind = p[0], v = p[1];
    switch (kind) {
      case 'letter': return 'буква ' + v;
      case 'sound': return 'звук ' + v;
      case 'first': return 'первый звук ' + v;
      case 'write': return 'письмо ' + v;
      case 'syllable': return 'слог ' + v;
      case 'word': return 'слово ' + v;
      case 'sentence': return 'предложение';
      case 'digit': return 'цифра ' + v;
      case 'writeNum': return 'письмо цифры ' + v;
      case 'count': return 'счёт до ' + v;
      case 'compare': return 'сравнение до ' + v;
      case 'add': return 'сложение до ' + v;
      case 'sub': return 'вычитание до ' + v;
      case 'problem': return 'задачи (' + (v === 'add' ? 'сложение' : 'вычитание') + ')';
      case 'line': return 'числовой ряд';
      case 'order': return 'порядок чисел';
      /* новые миры */
      case 'sp': return ({ earth: 'Земля', daynight: 'день и ночь', moon: 'Луна',
        moonphases: 'фазы Луны', sun: 'Солнце', planets: 'планеты', order: 'порядок планет',
        stars: 'звёзды', cosmonaut: 'космонавты', rocket: 'ракета' })[v] || 'космос';
      case 'spp': return 'планета ' + ((global.SpaceData && SpaceData.body(v)) ? SpaceData.body(v).name : v);
      case 'spc': return 'созвездие';
      case 'wa': return 'животное ' + v;
      case 'wc': return 'страна ' + ((global.WorldData && WorldData.country(v)) ? WorldData.country(v).name : v);
      case 'w': return ({ babies: 'мамы и детёныши', odd: 'кто лишний', season: 'времена года',
        plantcycle: 'цикл растения', butterfly: 'цикл бабочки', dress: 'как одеться',
        wlogic: 'погодная логика', sense: 'пять чувств', bodypairs: 'моё тело', habits: 'привычки',
        zone: 'кто где живёт', countries: 'страны', jobs: 'профессии', jobtools: 'инструменты',
        transport: 'транспорт', trodd: 'транспорт: лишнее', city: 'мой город', 'float': 'плавает/тонет',
        magnet: 'магнит', shadow: 'тень', states: 'лёд-вода-пар', whatif: 'что произойдёт' })[v] || 'мой мир';
      case 'rc': return 'чтение с пониманием';
      case 'ps': return 'предложение к картинке';
      case 'ml': return 'вставь букву';
      case 'typo': return 'слово-хитрюшка';
      case 'sb': return 'собери предложение';
      case 'nb': return 'соседи числа';
      case 'bond': return 'состав числа ' + v;
      case 'wp': return 'текстовые задачи';
      case 'pat': return 'продолжи ряд';
      case 'odd': return 'найди лишнее';
      case 'cmpq': return 'сравнения';
      case 'wg': return 'что исчезло';
      case 'fl': return 'найди буквы';
      case 'mc': return 'память: цвета';
      case 'mw': return 'память: слова';
      case 'md': return 'память: цифры';
      case 'opp': return 'скажи наоборот';
      case 'fs': return 'продолжи предложение';
      case 'story': return 'расскажи по порядку';
      case 'instr': return 'инструкции';
      default: return id;
    }
  }

  function advice(weak, days, acc) {
    var out = [];
    var letters = weak.filter(function (id) { return /^(letter|sound|first|write):/.test(id); })
      .map(function (id) { return id.split(':')[1]; });
    var math = weak.filter(function (id) { return /^(add|sub|count|compare|problem):/.test(id); });

    if (letters.length) {
      out.push({ ico: '🔤', text: 'Стоит дополнительно потренировать буквы <b>' +
        letters.slice(0, 4).join(', ') + '</b> — они пока даются труднее остальных.' });
    }
    if (math.length) {
      out.push({ ico: '🔢', text: 'В математике сложнее всего даётся: <b>' +
        math.slice(0, 3).map(skillLabel).join(', ') + '</b>. Полезно вернуться к заданиям с предметами.' });
    }
    var activeDays = days.filter(function (d) { return d.tasks > 0; }).length;
    if (activeDays <= 2) {
      out.push({ ico: '📅', text: 'На этой неделе занятий было немного. Ребёнку 6–7 лет полезнее <b>5–10 минут каждый день</b>, чем час раз в неделю.' });
    } else if (activeDays >= 5) {
      out.push({ ico: '🔥', text: 'Отличная регулярность — ' + activeDays + ' дня из 7. Так навык закрепляется лучше всего.' });
    }
    if (acc >= 85 && days.some(function (d) { return d.tasks > 0; })) {
      out.push({ ico: '🚀', text: 'Точность высокая — ребёнок готов к следующему уровню сложности.' });
    } else if (acc > 0 && acc < 60) {
      out.push({ ico: '🧸', text: 'Много ошибок — вероятно, материал пока сложноват. Стоит вернуться к предыдущим урокам, это нормально.' });
    }
    if (!out.length) {
      out.push({ ico: '🙂', text: 'Пока данных мало. Позанимайтесь несколько дней — здесь появятся подсказки.' });
    }
    out.push({ ico: '👀', text: 'Занимайтесь рядом с ребёнком: проговаривайте задания вслух и хвалите за старание, а не только за верный ответ.' });
    return out;
  }

  function downloadReport() {
    try {
      var blob = new Blob([Store.exportJSON()], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'umnyashka-' + Store.dayStr() + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      UI.toast('Файл сохранён', { emoji: '📄' });
    } catch (e) {
      UI.toast('Не удалось сохранить файл', { emoji: '⚠️' });
    }
  }

  global.Screens = global.Screens || {};
  Screens.Games = GamesScreen;
  Screens.Progress = ProgressScreen;
  Screens.Rewards = RewardsScreen;
  Screens.Settings = SettingsScreen;
  Screens.ParentGate = ParentGateScreen;
  Screens.Parent = ParentScreen;
  Screens.skillLabel = skillLabel;

})(window);
