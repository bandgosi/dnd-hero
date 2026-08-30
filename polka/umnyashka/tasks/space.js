/* =========================================================
   tasks/space.js — типы заданий мира «Космос».

   Методика (из дизайн-документа, менять осторожно):
   — формат «Узнай → Посмотри → Поиграй → Проверь себя»:
     сначала teach-карточка, потом игровые типы;
   — научные формулировки закреплены в data/space.js;
   — level 1 — два варианта ответа, level 2+ — три;
   — контент вопроса выбирается по числу попыток навыка,
     чтобы подряд не выпадал один и тот же вопрос.
   ========================================================= */
(function (global) {
  'use strict';

  var el = function () { return UI.el.apply(null, arguments); };
  var K = function () { return global.TaskKit; };

  function skillBody(skillId) {
    var p = String(skillId).split(':');
    return p[0] === 'spp' ? SpaceData.body(p[1]) : null;
  }

  function rotate(list, skillId) {
    var n = Skills.get(skillId).attempts;
    return list[n % list.length];
  }

  function optCount(level) { return level <= 1 ? 2 : 3; }

  /** Кружок-планета для плиток и сцен. */
  function planetDot(body, size) {
    return el('span', {
      class: 'ck-planet-dot',
      style: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: (size || 54) + 'px', height: (size || 54) + 'px', borderRadius: '50%',
        background: 'radial-gradient(circle at 35% 30%, #ffffff55, transparent 45%), ' + body.color,
        boxShadow: 'inset -6px -8px 12px rgba(0,0,0,.25)',
        fontSize: Math.round((size || 54) * 0.5) + 'px'
      },
      text: body.id === 'saturn' ? '🪐' : (body.id === 'earth' ? '🌍' : '')
    });
  }

  function registerSpaceTypes() {

    /* ---------- Знакомство с темой ---------- */
    Tasks.register('learnSpace', {
      teach: true,
      build: function (skillId) {
        // созвездиям своя тема не нужна — знакомим со «Звёздами»
        var fallback = String(skillId).indexOf('spc:') === 0 ? 'sp:stars' : 'sp:planets';
        var t = SpaceData.TEACH[skillId] || SpaceData.TEACH[fallback];
        return { prompt: t.title, speak: t.rows.map(function (r) { return r.text; }).join(' ') +
                 (t.fact ? ' ' + t.fact : ''), teach: t };
      },
      render: function (data) {
        var t = data.teach;
        var big = null;
        if (t.scene === 'earth') big = earthScene();
        return K().teachCard({ emoji: t.emoji, big: big, title: null, rows: t.rows, fact: t.fact });
      }
    });

    /* Интерактивная Земля: тап — Земля поворачивается, день и ночь меняются */
    function earthScene() {
      if (global.Store && Store.addCard) Store.addCard('planet:earth');
      var day = true;
      var shade = el('div', { class: 'sp-earth__shade', style: { opacity: '0' } });
      var globe = el('button', {
        class: 'sp-earth', type: 'button', 'aria-label': 'Покрутить Землю',
        style: { border: 'none', cursor: 'pointer' }
      }, [el('span', { text: '🌍' }), shade]);
      var cap = el('div', { class: 'ck-cap', style: { fontSize: '18px' }, text: '☀️ Сейчас день. Нажми — покрути Землю!' });
      globe.addEventListener('click', function () {
        day = !day;
        SFX.tap();
        globe.style.transform = 'rotate(' + (day ? 0 : 180) + 'deg)';
        globe.style.transition = 'transform .6s ease';
        shade.style.opacity = day ? '0' : '1';
        cap.textContent = day ? '☀️ Наша сторона смотрит на Солнце — день!' : '🌙 Земля отвернулась — у нас ночь!';
        Speech.phrase(day ? 'День! Наша сторона Земли смотрит на Солнце.' : 'Ночь! Наша сторона отвернулась от Солнца.');
      });
      return el('div', { class: 'sp-earth-scene' }, [globe, cap]);
    }

    /* ---------- Знакомство с планетой ---------- */
    Tasks.register('learnPlanet', {
      teach: true,
      build: function (skillId) {
        var b = skillBody(skillId);
        if (!b) {
          var t = SpaceData.TEACH['sp:planets'];
          return { prompt: t.title, speak: t.rows.map(function (r) { return r.text; }).join(' '), teach: t };
        }
        return {
          prompt: b.name, body: b,
          speak: b.name + '. ' + b.desc + ' ' + b.fact
        };
      },
      render: function (data) {
        if (data.teach) {
          return K().teachCard({ emoji: data.teach.emoji, rows: data.teach.rows, fact: data.teach.fact });
        }
        var b = data.body;
        if (global.Store && Store.addCard) Store.addCard('planet:' + b.id);
        return K().teachCard({
          big: el('div', { class: 'center' }, [planetDot(b, 120)]),
          title: null,
          rows: [
            { ico: '💬', text: b.desc },
            { ico: '📏', text: 'Размер: ' + b.size + '.' },
            { ico: '🌡️', text: 'Там ' + b.temp + '.' }
          ],
          fact: b.fact
        });
      }
    });

    /* ---------- Викторина ---------- */
    Tasks.register('spQuiz', {
      build: function (skillId, level) {
        var b = skillBody(skillId);
        if (b) return buildPlanetQuestion(b, level);
        var list = SpaceData.QUIZ[skillId];
        if (!list || !list.length) return null;
        var item = rotate(list, skillId);
        if (item.order) {
          return { prompt: item.q, speak: item.q, order: item.items, hint: item.hint };
        }
        var opts = item.options.slice();
        var right = opts.filter(function (o) { return o.ok; })[0];
        var wrong = UI.shuffle(opts.filter(function (o) { return !o.ok; })).slice(0, optCount(level) - 1);
        return { prompt: item.q, speak: item.q, options: UI.shuffle([right].concat(wrong)), hint: item.hint };
      },
      render: function (data, api) {
        if (data.order) {
          return K().orderBoard(api, { items: data.order, hint: data.hint });
        }
        var hasEmoji = data.options.some(function (o) { return o.emoji; });
        return K().answerBoard(api, data.options, {
          isRight: function (o) { return !!o.ok; },
          fill: hasEmoji ? K().fillEmojiText : K().fillText,
          hint: data.hint || 'Послушай вопрос ещё раз.',
          wide: !hasEmoji
        });
      }
    });

    /* Вопрос по карточке планеты: «О какой планете это?» */
    function buildPlanetQuestion(body, level) {
      var others = UI.shuffle(SpaceData.planets().filter(function (p) { return p.id !== body.id; }))
        .slice(0, optCount(level) - 1);
      var opts = UI.shuffle([{ label: body.name, emoji: body.emoji, ok: true }].concat(
        others.map(function (p) { return { label: p.name, emoji: p.emoji }; })
      ));
      return {
        prompt: body.fact + '<br>О какой планете это?',
        speak: body.fact + '. О какой планете это?',
        options: opts,
        hint: body.desc
      };
    }

    /* ---------- День или ночь? ---------- */
    Tasks.register('dayNight', {
      build: function (skillId) {
        var it = rotate(SpaceData.DAYNIGHT, skillId);
        return { prompt: 'День или ночь?', speak: it.text + '. День или ночь?', item: it };
      },
      render: function (data, api) {
        var it = data.item;
        var wrap = el('div', { class: 'stack g4 center' }, [
          el('div', { style: { fontSize: '72px' }, text: it.emoji }),
          el('div', { class: 't-body center-text', style: { fontWeight: '800' }, text: it.text })
        ]);
        wrap.appendChild(K().answerBoard(api, [
          { id: 'day', label: 'День', emoji: '☀️', ok: it.answer === 'day' },
          { id: 'night', label: 'Ночь', emoji: '🌙', ok: it.answer === 'night' }
        ], {
          isRight: function (o) { return !!o.ok; },
          fill: K().fillEmojiText,
          hint: 'Подумай: что делают в это время?'
        }));
        return wrap;
      }
    });

    /* ---------- Собери Луну (фазы по порядку) ---------- */
    Tasks.register('moonOrder', {
      build: function (skillId, level) {
        var ph = SpaceData.MOON_PHASES;
        var items = level <= 1 ? [ph[0], ph[2], ph[4]] : level === 2 ? [ph[0], ph[1], ph[2], ph[4]] : ph;
        return {
          prompt: 'Расставь фазы Луны по порядку!',
          speak: 'Расставь фазы Луны по порядку: от невидимки до круглого блина.',
          items: items
        };
      },
      render: function (data, api) {
        return K().orderBoard(api, {
          items: data.items,
          hint: 'Луна «растёт»: от тёмной — к круглой.',
          answerHint: 'Сначала невидимка, потом серпик, потом блин!'
        });
      }
    });

    /* ---------- Расставь планеты от Солнца ---------- */
    Tasks.register('planetOrder', {
      build: function (skillId, level) {
        var all = SpaceData.planets();
        var items = level <= 1 ? all.slice(0, 3) : level === 2 ? all.slice(0, 4) : all.slice(4, 8);
        return {
          prompt: '☀️ Расставь планеты от Солнца!',
          speak: 'Расставь планеты по порядку от Солнца.',
          items: items.map(function (p) { return { id: p.id, emoji: p.emoji, label: p.name }; }),
          far: level >= 3
        };
      },
      render: function (data, api) {
        var wrap = el('div', { class: 'stack g3 center' }, [
          el('div', { class: 'ck-cap', text: data.far ? 'Это дальние планеты-великаны' : 'Это ближние планеты' })
        ]);
        wrap.appendChild(K().orderBoard(api, {
          items: data.items,
          hint: 'Кто ближе всех к Солнцу — тот первый.',
          answerHint: 'Меркурий, Венера, Земля, Марс — а дальше великаны!'
        }));
        return wrap;
      }
    });

    /* ---------- Найди планету на карте ---------- */
    Tasks.register('findPlanet', {
      build: function (skillId, level) {
        var b = skillBody(skillId);
        var target = b || UI.pick(SpaceData.planets());
        return {
          prompt: 'Найди планету ' + target.name + '!',
          speak: 'Найди на карте планету ' + target.name + '.',
          target: target,
          showNames: level <= 1
        };
      },
      render: function (data, api) {
        var values = SpaceData.planets();
        return K().answerBoard(api, values, {
          isRight: function (p) { return p.id === data.target.id; },
          fill: function (p, tile) {
            tile.appendChild(planetDot(p, 50));
            if (data.showNames) tile.appendChild(el('span', { class: 'ck-cap', text: p.name }));
          },
          class: 'opts--4',
          wide: true,
          hint: data.target.desc,
          answerHint: data.target.name + ' — ' + data.target.desc
        });
      }
    });

    /* ---------- Собери космонавта ---------- */
    Tasks.register('buildCosmonaut', {
      build: function () {
        return {
          prompt: 'Собери космонавта в полёт!',
          speak: 'Выбери четыре вещи, которые нужны космонавту.',
          good: SpaceData.COSMONAUT.good,
          bad: SpaceData.COSMONAUT.bad
        };
      },
      render: function (data, api) {
        var items = UI.shuffle(data.good.map(function (g) { return { it: g, target: true }; })
          .concat(data.bad.map(function (b) { return { it: b, target: false }; })));
        var found = 0, missed = false, judged = false;
        var grid = el('div', { class: 'ck-pool' });
        items.forEach(function (x) {
          var b = el('button', { class: 'ck-tile', type: 'button', dataset: { ok: x.target ? '1' : '0' } }, [
            el('span', { class: 'ck-big', text: x.it.emoji }),
            el('span', { class: 'ck-cap', text: x.it.label })
          ]);
          b.addEventListener('click', function () {
            if (judged) return;   // пока открыт фидбек — поле заморожено
            if (b.classList.contains('is-done') || b.classList.contains('is-used')) return;
            if (x.target) {
              b.classList.add('is-done');
              SFX.right();
              found++;
              if (found === data.good.length && !judged) {
                judged = true;
                api.answer(!missed, missed ? { hint: 'Космонавту нужны шлем, скафандр, перчатки и воздух.' } : { node: grid });
              }
            } else {
              b.classList.add('is-almost');
              SFX.almost();
              Speech.phrase(x.it.label + ' — ' + x.it.why + '!');
              setTimeout(function () { b.classList.remove('is-almost'); b.classList.add('is-used'); }, 600);
              if (!missed && !judged) {
                missed = true; judged = true;
                api.answer(false, {
                  hint: 'В космосе ' + x.it.label + ' ' + x.it.why + '! Выбирай то, что помогает дышать и защищает.',
                  onRetry: function () { judged = false; }
                });
              }
            }
          });
          grid.appendChild(b);
        });
        return grid;
      }
    });

    /* ---------- Соедини звёзды ---------- */
    Tasks.register('connectStars', {
      build: function (skillId) {
        var c = SpaceData.constellation(skillId) || SpaceData.CONSTELLATIONS[0];
        return {
          prompt: 'Соедини звёзды по номерам!',
          speak: 'Соединяй звёзды по порядку: один, два, три… Получится созвездие ' + c.name + '.',
          c: c
        };
      },
      render: function (data, api) {
        var c = data.c;
        var next = 0, missed = false, judged = false;
        var NS = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');

        function lineBetween(a, b, cls) {
          var ln = document.createElementNS(NS, 'line');
          ln.setAttribute('x1', c.stars[a][0]); ln.setAttribute('y1', c.stars[a][1]);
          ln.setAttribute('x2', c.stars[b][0]); ln.setAttribute('y2', c.stars[b][1]);
          if (cls) ln.setAttribute('class', cls);
          svg.appendChild(ln);
        }

        var starNodes = [];
        c.stars.forEach(function (s, i) {
          var g = document.createElementNS(NS, 'g');
          g.setAttribute('data-i', String(i));
          var halo = document.createElementNS(NS, 'circle');
          halo.setAttribute('cx', s[0]); halo.setAttribute('cy', s[1]); halo.setAttribute('r', 8);
          halo.setAttribute('class', 'halo');
          var st = document.createElementNS(NS, 'circle');
          st.setAttribute('cx', s[0]); st.setAttribute('cy', s[1]); st.setAttribute('r', 3);
          st.setAttribute('class', 'star');
          var num = document.createElementNS(NS, 'text');
          num.setAttribute('x', s[0]); num.setAttribute('y', s[1] - 6);
          num.setAttribute('text-anchor', 'middle');
          num.setAttribute('style', 'fill:#EDEBFF;font-size:7px;font-weight:800');
          num.textContent = String(i + 1);
          g.appendChild(halo); g.appendChild(st); g.appendChild(num);
          function tap() {
            if (judged) return;   // пока открыт фидбек — поле заморожено
            if (i === next) {
              SFX.tick();
              st.classList.add('is-on');
              if (next > 0) lineBetween(next - 1, next);
              next++;
              if (next === c.stars.length) {
                // дорисовываем фигуру целиком
                c.lines.forEach(function (l) { lineBetween(l[0], l[1]); });
                if (!judged) { judged = true; api.answer(!missed, missed ? { hint: data.c.hint } : { node: svg }); }
                Speech.phrase('Это созвездие ' + c.name + '!');
              }
            } else if (i > next) {
              SFX.almost();
              if (!missed && !judged) {
                missed = true; judged = true;
                api.answer(false, {
                  hint: 'Ищи звезду с номером ' + (next + 1) + '.',
                  onRetry: function () { judged = false; }
                });
              }
            }
          }
          g.addEventListener('click', tap);
          svg.appendChild(g);
          starNodes.push(st);
        });

        return el('div', { class: 'sp-const' }, [
          svg,
          el('div', { class: 'ck-cap center-text', style: { marginTop: '8px' }, text: c.hint })
        ]);
      }
    });

    /* ---------- Запуск ракеты ---------- */
    Tasks.register('rocketLaunch', {
      build: function () {
        return {
          prompt: 'Подготовь ракету к старту!',
          speak: 'Расставь шаги подготовки по порядку — и ракета взлетит!',
          items: SpaceData.LAUNCH
        };
      },
      render: function (data, api) {
        var rocket = el('div', { class: 'sp-rocket', text: '🚀' });
        var count = el('div', { class: 'sp-count', 'aria-live': 'polite' });
        var stage = el('div', { class: 'sp-launch' }, [rocket, count]);

        var fakeApi = Object.create(api);
        fakeApi.answer = function (ok, o) {
          if (!ok) return api.answer(ok, o);
          // правильная последовательность → обратный отсчёт → старт → потом фидбек
          var n = 3;
          SFX.tick();
          var iv = setInterval(function () {
            if (!document.body.contains(stage)) { clearInterval(iv); return; }
            if (n > 0) {
              count.textContent = String(n);
              Speech.phrase(String(n));
              SFX.tick();
              n--;
            } else {
              clearInterval(iv);
              count.textContent = 'ПУСК! 🚀';
              Speech.phrase('Пуск!');
              SFX.reward();
              rocket.classList.add('is-go');
              FX.confetti({ count: 80 });
              setTimeout(function () {
                // ребёнок мог уйти с экрана, пока ракета летела
                if (document.body.contains(stage)) api.answer(true, o);
              }, 1500);
            }
          }, 700);
        };

        var board = K().orderBoard(fakeApi, {
          items: data.items,
          hint: 'Сначала скафандр, в конце — отсчёт!',
          answerHint: 'Скафандр → в ракету → пристегнуться → отсчёт!'
        });
        return el('div', { class: 'stack g4' }, [stage, board]);
      }
    });
  }

  registerSpaceTypes();
  global.SpaceTasks = { registered: true };

})(window);
