/* =========================================================
   tasks/world.js — типы заданий мира «Мой мир».
   Принцип: «Увидел → Исследовал → Поиграл → Проверил себя».
   Карточки открытий добавляются в коллекцию через Store.addCard.
   ========================================================= */
(function (global) {
  'use strict';

  var el = function () { return UI.el.apply(null, arguments); };
  var K = function () { return global.TaskKit; };
  var W = function () { return global.WorldData; };

  function part(id) { return String(id).split(':').slice(1).join(':'); }
  function kind(id) { return String(id).split(':')[0]; }
  function rot(list, skillId) { return list[Skills.get(skillId).attempts % list.length]; }

  function choiceBoard(api, opts, hint, fillBig) {
    return K().answerBoard(api, opts, {
      isRight: function (o) { return !!o.ok; },
      fill: fillBig ? function (o, tile) { tile.appendChild(el('span', { class: 'ck-big', text: o.label })); }
                    : (opts.some(function (o) { return o.emoji; }) ? K().fillEmojiText : K().fillText),
      hint: hint || '', wide: !fillBig
    });
  }
  function fromIndexed(item) {
    return UI.shuffle(item.options.map(function (t, i) { return { label: t, ok: i === item.answer }; }));
  }

  function register() {

    /* ---------- Знакомство (teach) ---------- */
    Tasks.register('learnWorld', {
      teach: true,
      build: function (skillId) {
        var k = kind(skillId), p = part(skillId);

        if (k === 'wa') {
          var a = W().animal(p);
          if (!a) return null;
          if (global.Store && Store.addCard) Store.addCard('animal:' + a.name);
          var rows = [
            { ico: W().HABITATS[a.habitat] || '🏠', text: 'Живёт: ' + a.habitat + '.' },
            { ico: W().EATS[a.eats] || '🍽️', text: 'Любит есть: ' + a.eats + '.' }
          ];
          if (a.baby) rows.push({ ico: '👶', text: 'Детёныш — ' + a.baby + '.' });
          return { prompt: a.emoji + ' ' + a.name, speak: a.name + '. Живёт: ' + a.habitat + '. ' + a.fact,
                   teach: { emoji: a.emoji, rows: rows, fact: a.fact } };
        }
        if (k === 'wc') {
          var c = W().country(p);
          if (!c) return null;
          if (global.Store && Store.addCard) Store.addCard('country:' + c.id);
          return { prompt: c.flag + ' ' + c.name, speak: c.name + '. ' + c.fact,
                   teach: { emoji: c.flag, rows: [
                     { ico: '🏛️', text: c.place },
                     { ico: '🐾', text: c.animal },
                     { ico: '🍽️', text: c.dish }
                   ], fact: c.fact } };
        }

        var T = {
          'w:season': function () {
            return { prompt: 'Времена года', speak: 'Смотри, как меняется одно и то же место в разные времена года! Нажимай на кнопки.',
                     scene: 'seasons' };
          },
          'w:dress': function () {
            // окно из 4 видов погоды сдвигается с каждым знакомством — за
            // пару уроков ребёнок увидит все семь
            var all = W().WEATHER, n = Skills.get(skillId).attempts;
            var w4 = [0, 1, 2, 3].map(function (i) { return all[(n + i) % all.length]; });
            return { prompt: 'Какая бывает погода', speak: w4.map(function (x) { return x.line; }).join(' '),
                     teach: { emoji: '🌦️', rows: w4.map(function (x) { return { ico: x.emoji, text: x.line }; }) } };
          },
          'w:sense': function () {
            return { prompt: 'Пять чувств-помощников', speak: 'У нас пять чувств-помощников! ' +
                     W().SENSES.map(function (s) { return s.organ + ' — мы ' + s.verb; }).join('. '),
                     teach: { emoji: '🧍', rows: W().SENSES.map(function (s) {
                       return { ico: s.emoji, text: s.sense + ': мы ' + s.verb + '.' };
                     }) } };
          },
          'w:bodypairs': function () {
            var all = W().BODY, n = Skills.get(skillId).attempts;
            var rows = [0, 1, 2, 3, 4].map(function (i) { return all[(n + i) % all.length]; });
            return { prompt: 'Моё тело', speak: 'Каждая часть тела нам помогает!',
                     teach: { emoji: '🧍', rows: rows.map(function (b) {
                       return { ico: b.emoji, text: b.line };
                     }) } };
          },
          'w:habits': function () {
            var h = rot(W().HABITS, skillId);
            return { prompt: 'Полезная привычка', speak: h.habit + '. ' + h.why,
                     teach: { emoji: h.emoji, rows: [{ ico: '✅', text: h.habit + '.' }], fact: h.why } };
          },
          'w:zone': function () {
            return { prompt: 'Наша планета', speak: W().PLANET_FACTS.map(function (f) { return f.fact; }).join(' '),
                     teach: { emoji: '🌎', rows: W().PLANET_FACTS.map(function (f) {
                       return { ico: f.emoji, text: f.fact };
                     }) } };
          },
          'w:jobs': function () {
            var j = rot(W().JOBS, skillId);
            if (global.Store && Store.addCard) Store.addCard('job:' + j.name);
            return { prompt: j.emoji + ' ' + j.name, speak: j.name + '. ' + j.does,
                     teach: { emoji: j.emoji, rows: [
                       { ico: '💬', text: j.does },
                       { ico: j.tool, text: 'Главный помощник — вот такой!' }
                     ] } };
          },
          'w:transport': function () {
            var t = rot(W().TRANSPORT, skillId);
            if (global.Store && Store.addCard) Store.addCard('tr:' + t.name);
            return { prompt: t.emoji + ' ' + t.name, speak: t.name + ' передвигается там: ' + t.env + '.',
                     teach: { emoji: t.emoji, rows: [
                       { ico: W().ENVS[t.env], text: 'Где: ' + t.env + '.' }
                     ] } };
          },
          'w:city': function () {
            var b = rot(W().CITY, skillId);
            return { prompt: b.emoji + ' ' + b.name, speak: b.name + '. ' + b.why,
                     teach: { emoji: b.emoji, rows: [
                       { ico: '💬', text: b.why },
                       { ico: '🧑', text: 'Здесь работает ' + b.who + '.' }
                     ] } };
          },
          'w:float': function () {
            if (global.Store && Store.addCard) Store.addCard('sci:float');
            return { prompt: '🛁 Плавает или тонет?', speak: 'Лёгкое и с воздухом внутри — плавает. Тяжёлое — тонет. Проверим?',
                     teach: { emoji: '🛁', rows: [
                       { ico: '🏐', text: 'Лёгкое и с воздухом — плавает.' },
                       { ico: '🪨', text: 'Тяжёлое — тонет на дно.' }
                     ] } };
          },
          'w:magnet': function () {
            if (global.Store && Store.addCard) Store.addCard('sci:magnet');
            return { prompt: '🧲 Волшебный магнит', speak: 'Магнит притягивает железные предметы. А дерево, бумагу и пластик — нет.',
                     teach: { emoji: '🧲', rows: [
                       { ico: '📎', text: 'Железное — притягивается!' },
                       { ico: '📄', text: 'Дерево, бумага, пластик — нет.' }
                     ] } };
          },
          'w:shadow': function () {
            if (global.Store && Store.addCard) Store.addCard('sci:shadow');
            return { prompt: '🌗 Тень', speak: W().EXP_SHADOW.principle,
                     teach: { emoji: '🌳', rows: [
                       { ico: '🌅', text: 'Солнце низко — тень длинная.' },
                       { ico: '🌞', text: 'Солнце высоко — тень короткая.' },
                       { ico: '🌑', text: 'Без света тени не бывает.' }
                     ] } };
          },
          'w:states': function () {
            if (global.Store && Store.addCard) Store.addCard('sci:states');
            return { prompt: '💧 Вода-волшебница', speak: 'Лёд, вода и пар — это одна и та же вода! Холодно — лёд. Тепло — вода. Очень жарко — пар.',
                     teach: { emoji: '💧', rows: [
                       { ico: '🧊', text: 'Очень холодно — лёд.' },
                       { ico: '💧', text: 'Тепло — вода.' },
                       { ico: '♨️', text: 'Очень жарко — пар.' }
                     ] } };
          },
          'w:whatif': function () {
            if (global.Store && Store.addCard) Store.addCard('sci:cause');
            return { prompt: '💡 Что произойдёт?', speak: 'Сначала бывает причина, а потом — что случилось. Угадаешь, что будет дальше?',
                     teach: { emoji: '💡', rows: [
                       { ico: '🌧️', text: 'Полил дождик — выросли цветы.' },
                       { ico: '☀️', text: 'Пригрело солнце — растаял снег.' }
                     ] } };
          }
        };
        var fn = T[skillId];
        return fn ? fn() : null;
      },
      render: function (data) {
        if (data.scene === 'seasons') return seasonScene();
        return K().teachCard(data.teach);
      }
    });

    /* Интерактивная сцена «Времена года» */
    function seasonScene() {
      var current = 0;
      var scene = el('div', { class: 'wd-season__scene' });
      var line = el('div', { class: 'ck-cap center-text', style: { fontSize: '15px' } });
      function show(i) {
        current = i;
        var s = W().SEASONS[i];
        scene.textContent = s.tree + ' ' + s.weather + ' ' + s.clothes + ' ' + s.activity;
        line.textContent = s.line;
        Array.prototype.forEach.call(btns.children, function (b, n) {
          b.classList.toggle('is-on', n === i);
        });
      }
      var btns = el('div', { class: 'ck-pool' });
      W().SEASONS.forEach(function (s, i) {
        var b = el('button', { class: 'ck-tile', type: 'button' }, [
          el('span', { class: 'ck-big', text: s.emoji }),
          el('span', { class: 'ck-cap', text: s.name })
        ]);
        b.addEventListener('click', function () { SFX.tap(); show(i); Speech.phrase(W().SEASONS[i].name + '. ' + W().SEASONS[i].line); });
        btns.appendChild(b);
      });
      var wrap = el('div', { class: 'wd-season' }, [scene, line, btns]);
      show(0);
      return wrap;
    }

    /* ---------- Викторина о животном ---------- */
    Tasks.register('wAnimalQuiz', {
      build: function (skillId, level) {
        var a = W().animal(part(skillId));
        if (!a) return null;
        var forms = [];
        forms.push(function () {   // где живёт
          var wrong = UI.shuffle(Object.keys(W().HABITATS).filter(function (h) { return h !== a.habitat; })).slice(0, 2);
          return {
            prompt: a.emoji + ' Где живёт ' + a.name.toLowerCase() + '?',
            speak: 'Где живёт ' + a.name + '?',
            options: UI.shuffle([{ label: a.habitat, emoji: W().HABITATS[a.habitat], ok: true }].concat(
              wrong.map(function (h) { return { label: h, emoji: W().HABITATS[h] }; })))
          };
        });
        forms.push(function () {   // что ест
          // «всё» пересекается с любым ответом, «мясо»/«рыба» — друг с другом:
          // такие пары не предлагаем как неверные варианты
          var confuse = { 'мясо': ['рыба'], 'рыба': ['мясо'] };
          var banned = ['всё'].concat(confuse[a.eats] || []);
          var wrong = UI.shuffle(Object.keys(W().EATS).filter(function (e) {
            return e !== a.eats && banned.indexOf(e) === -1;
          })).slice(0, 2);
          return {
            prompt: a.emoji + ' Что любит есть ' + a.name.toLowerCase() + '?',
            speak: 'Что любит есть ' + a.name + '?',
            options: UI.shuffle([{ label: a.eats, emoji: W().EATS[a.eats], ok: true }].concat(
              wrong.map(function (e) { return { label: e, emoji: W().EATS[e] }; })))
          };
        });
        forms.push(function () {   // кто это по факту
          var wrong = UI.shuffle(W().ANIMALS.filter(function (x) { return x.name !== a.name && x.cat === a.cat; }))
            .slice(0, 2);
          if (wrong.length < 2) wrong = UI.shuffle(W().ANIMALS.filter(function (x) { return x.name !== a.name; })).slice(0, 2);
          return {
            prompt: a.fact + '<br>Кто это?',
            speak: a.fact + '. Кто это?',
            options: UI.shuffle([{ label: a.name, emoji: a.emoji, ok: true }].concat(
              wrong.map(function (x) { return { label: x.name, emoji: x.emoji }; })))
          };
        });
        return forms[Skills.get(skillId).attempts % forms.length]();
      },
      render: function (data, api) {
        return choiceBoard(api, data.options, 'Вспомни карточку зверя!');
      }
    });

    /* ---------- Мама и детёныш ---------- */
    Tasks.register('wBabies', {
      build: function (skillId) {
        var pairs = UI.shuffle(W().BABIES).slice(0, 4).map(function (p) {
          return { a: { emoji: p.momE, label: p.mom }, b: { emoji: p.babyE, label: p.baby } };
        });
        return { prompt: 'Найди маму каждому детёнышу!', speak: 'Соедини маму и детёныша!', pairs: pairs };
      },
      render: function (data, api) {
        return K().pairBoard(api, { pairs: data.pairs, hint: 'У кошки — котёнок, у коровы — телёнок…' });
      }
    });

    /* ---------- Кто лишний (животные и транспорт) ---------- */
    function oddType(name, listGetter, prompt) {
      Tasks.register(name, {
        build: function (skillId) {
          var it = rot(listGetter(), skillId);
          return { prompt: prompt, speak: prompt, item: it };
        },
        render: function (data, api) {
          var it = data.item;
          // Перемешиваем: лишний не должен угадываться по позиции
          var opts = UI.shuffle(it.set.map(function (e) { return { label: e, ok: e === it.answer }; }));
          return K().answerBoard(api, opts, {
            isRight: function (o) { return !!o.ok; },
            fill: function (o, tile) { tile.appendChild(el('span', { class: 'ck-big', text: o.label })); },
            hint: 'Назови каждого. Кто не подходит к остальным?',
            answerHint: 'Лишний — потому что ' + it.reason + '.',
            onRight: function () { Speech.phrase('Верно! Лишний, потому что ' + it.reason + '.'); }
          });
        }
      });
    }
    oddType('wOdd', function () { return W().ODD_ONE; }, 'Кто здесь лишний?');
    oddType('wTransportOdd', function () { return W().TRANSPORT_ODD; }, 'Что здесь лишнее?');

    /* ---------- Какое время года? ---------- */
    Tasks.register('wSeason', {
      build: function (skillId) {
        var it = rot(W().SEASON_QUIZ, skillId);
        return { prompt: 'Какое это время года?', speak: 'Посмотри на подсказки. Какое это время года?', item: it };
      },
      render: function (data, api) {
        var opts = W().SEASONS.map(function (s) {
          return { label: s.name, emoji: s.emoji, ok: s.name === data.item.answer };
        });
        return el('div', { class: 'stack g4' }, [
          el('div', { class: 'center', style: { fontSize: '48px', letterSpacing: '10px' }, text: data.item.hints.join(' ') }),
          choiceBoard(api, opts, 'Когда так бывает на улице?')
        ]);
      }
    });

    /* ---------- Циклы природы ---------- */
    Tasks.register('wCycle', {
      build: function (skillId) {
        var isPlant = skillId === 'w:plantcycle';
        var items = isPlant ? W().PLANT_CYCLE : W().BUTTERFLY_CYCLE;
        return {
          prompt: isPlant ? 'Как растёт растение? Расставь по порядку!' : 'Как появляется бабочка? Расставь по порядку!',
          speak: isPlant ? 'Расставь по порядку: как из семечка вырастает плод.' : 'Расставь по порядку: как гусеница становится бабочкой.',
          items: items,
          story: items.map(function (x) { return x.line; }).join(' ')
        };
      },
      render: function (data, api) {
        var fakeApi = Object.create(api);
        fakeApi.answer = function (ok, o) {
          if (ok) Speech.phrase(data.story);
          api.answer(ok, o);
        };
        return K().orderBoard(fakeApi, {
          items: data.items,
          hint: 'С чего всё начинается? С самого маленького!',
          answerHint: data.story
        });
      }
    });

    /* ---------- Погода ---------- */
    Tasks.register('wDress', {
      build: function (skillId) {
        var it = rot(W().DRESS_QUIZ, skillId);
        return { prompt: it.weather + '. Что выберешь?', speak: 'За окном ' + it.weather + '. Что выберешь?', item: it };
      },
      render: function (data, api) {
        return choiceBoard(api, fromIndexed(data.item), 'Подумай: тепло сейчас или холодно?');
      }
    });

    Tasks.register('wWeatherLogic', {
      build: function (skillId) {
        var it = rot(W().WEATHER_LOGIC, skillId);
        return { prompt: 'Что будет дальше?', speak: 'Посмотри на небо. Что будет дальше?', item: it };
      },
      render: function (data, api) {
        var it = data.item;
        var opts = UI.shuffle(it.options.map(function (o) { return { label: o, ok: o === it.answer }; }));
        return el('div', { class: 'stack g4' }, [
          el('div', { class: 'center', style: { fontSize: '44px', letterSpacing: '6px' }, text: it.seq.join(' → ') + ' → ❓' }),
          K().answerBoard(api, opts, {
            isRight: function (o) { return !!o.ok; },
            fill: function (o, tile) { tile.appendChild(el('span', { class: 'ck-big', text: o.label })); },
            hint: 'Вспомни, как бывает на улице.',
            answerHint: it.line,
            onRight: function () { Speech.phrase(it.line); }
          })
        ]);
      }
    });

    /* ---------- Тело и чувства ---------- */
    Tasks.register('wSense', {
      build: function (skillId) {
        var it = rot(W().SENSE_QUIZ, skillId);
        return { prompt: it.q, speak: it.q, item: it };
      },
      render: function (data, api) {
        var right = data.item.answer;
        var senses = W().SENSES;
        var wrong = UI.shuffle(senses.filter(function (s) { return s.emoji !== right; })).slice(0, 2);
        var opts = UI.shuffle([{ label: senseName(right), emoji: right, ok: true }].concat(
          wrong.map(function (s) { return { label: s.organ, emoji: s.emoji }; })));
        function senseName(e) {
          for (var i = 0; i < senses.length; i++) if (senses[i].emoji === e) return senses[i].organ;
          return '';
        }
        return choiceBoard(api, opts, 'Какой помощник тут нужен?');
      }
    });

    Tasks.register('wBodyPairs', {
      build: function () {
        var pool = UI.shuffle(W().SENSES).slice(0, 4).map(function (s) {
          return { a: { emoji: s.emoji, label: s.organ }, b: { emoji: '💭', label: s.verb } };
        });
        return { prompt: 'Соедини помощника и его работу!', speak: 'Чем мы что делаем? Соедини!', pairs: pool };
      },
      render: function (data, api) {
        return K().pairBoard(api, { pairs: data.pairs, hint: 'Глазами видим, ушами слышим…' });
      }
    });

    /* ---------- Планета: где живёт? ---------- */
    Tasks.register('wZone', {
      build: function (skillId) {
        var it = rot(W().ZONE_QUIZ, skillId);
        return { prompt: it.animal + ' — где он живёт?', speak: it.animal + '. Где он живёт?', item: it };
      },
      render: function (data, api) {
        var right = data.item.answer;
        var wrong = UI.shuffle(Object.keys(W().HABITATS).filter(function (h) { return h !== right && h !== 'дом' && h !== 'небо'; })).slice(0, 2);
        var opts = UI.shuffle([{ label: right, emoji: W().HABITATS[right], ok: true }].concat(
          wrong.map(function (h) { return { label: h, emoji: W().HABITATS[h] }; })));
        return choiceBoard(api, opts, 'Вспомни: жарко там или холодно?');
      }
    });

    /* ---------- Страны ---------- */
    Tasks.register('wCountryQuiz', {
      build: function (skillId) {
        var it = rot(W().COUNTRY_QUIZ, skillId);
        return { prompt: it.q, speak: it.q, item: it };
      },
      render: function (data, api) {
        var it = data.item;
        var opts = UI.shuffle(it.options.map(function (f) {
          var c = W().COUNTRIES.filter(function (x) { return x.flag === f; })[0];
          return { label: c ? c.name : '', emoji: f, ok: f === it.answer };
        }));
        return choiceBoard(api, opts, 'Вспомни карточки стран!');
      }
    });

    /* ---------- Профессии ---------- */
    Tasks.register('wJobQuiz', {
      build: function (skillId) {
        var it = rot(W().JOB_QUIZ, skillId);
        var job = W().JOBS.filter(function (j) { return j.name === it.answer; })[0];
        var wrong = UI.shuffle(W().JOBS.filter(function (j) { return j.name !== it.answer; })).slice(0, 2);
        return {
          prompt: it.q, speak: it.q, jobName: job.name,
          options: UI.shuffle([{ label: job.name, emoji: job.emoji, ok: true }].concat(
            wrong.map(function (j) { return { label: j.name, emoji: j.emoji }; })))
        };
      },
      render: function (data, api) {
        // верный ответ открывает карточку профессии в журнале
        var proxy = Object.create(api);
        proxy.answer = function (ok, o) {
          if (ok && global.Store && Store.addCard) Store.addCard('job:' + data.jobName);
          api.answer(ok, o);
        };
        return choiceBoard(proxy, data.options, 'Кто чем занимается?');
      }
    });

    Tasks.register('wJobTools', {
      build: function () {
        var pairs = UI.shuffle(W().JOB_TOOLS).slice(0, 4);
        return { prompt: 'Кому что нужно для работы?', speak: 'Соедини профессию и её помощника!', pairs: pairs };
      },
      render: function (data, api) {
        return K().pairBoard(api, { pairs: data.pairs, hint: 'Повару — сковородка, врачу — трубочка…' });
      }
    });

    /* ---------- Транспорт ---------- */
    Tasks.register('wTransportQuiz', {
      build: function (skillId) {
        var t = rot(W().TRANSPORT, skillId);
        return {
          prompt: t.emoji + ' ' + t.name + ' — где он движется?',
          speak: t.name + '. Где он движется?',
          t: t
        };
      },
      render: function (data, api) {
        var right = data.t.env;
        // небо и космос слишком похожи для шестилетки — не сталкиваем их
        var confuse = { 'космос': ['небо'], 'небо': ['космос'] };
        var banned = confuse[right] || [];
        var wrong = UI.shuffle(Object.keys(W().ENVS).filter(function (e) {
          return e !== right && banned.indexOf(e) === -1;
        })).slice(0, 2);
        var opts = UI.shuffle([{ label: right, emoji: W().ENVS[right], ok: true }].concat(
          wrong.map(function (e) { return { label: e, emoji: W().ENVS[e] }; })));
        // верный ответ открывает карточку транспорта в «Гараже»
        var proxy = Object.create(api);
        proxy.answer = function (ok, o) {
          if (ok && global.Store && Store.addCard) Store.addCard('tr:' + data.t.name);
          api.answer(ok, o);
        };
        return choiceBoard(proxy, opts, 'Колёса, крылья или паруса?');
      }
    });

    /* ---------- Город ---------- */
    Tasks.register('wCityQuiz', {
      build: function (skillId) {
        var it = rot(W().CITY_QUIZ, skillId);
        return { prompt: it.q, speak: it.q, item: it };
      },
      render: function (data, api) {
        return choiceBoard(api, fromIndexed(data.item), 'Подумай, где это делают.');
      }
    });

    /* ---------- Эксперименты ---------- */
    function predictType(name, listGetter, yesLabel, noLabel, key, hintText, lineFn) {
      Tasks.register(name, {
        build: function (skillId) {
          var it = rot(listGetter(), skillId);
          return { prompt: it.emoji + ' ' + it.item + ' — ' + hintText, speak: it.item + '. ' + hintText, item: it };
        },
        render: function (data, api) {
          var it = data.item;
          var stage = el('div', { class: 'center', style: { fontSize: '64px', transition: 'transform .8s ease' }, text: it.emoji });
          var fakeApi = Object.create(api);
          fakeApi.answer = function (ok, o) {
            // маленькая «симуляция»: предмет падает/притягивается
            stage.style.transform = it[key] ? 'translateY(-14px)' : 'translateY(26px)';
            if (ok) Speech.phrase(lineFn(it));
            api.answer(ok, o);
          };
          var opts = [
            { label: yesLabel.l, emoji: yesLabel.e, ok: !!it[key] },
            { label: noLabel.l, emoji: noLabel.e, ok: !it[key] }
          ];
          return el('div', { class: 'stack g4' }, [
            stage,
            K().answerBoard(fakeApi, opts, {
              isRight: function (o) { return !!o.ok; },
              fill: K().fillEmojiText,
              hint: 'Подумай: тяжёлый он или лёгкий? Из чего сделан?'
            })
          ]);
        }
      });
    }
    predictType('wFloat', function () { return W().EXP_FLOAT; },
      { l: 'Плавает', e: '🛟' }, { l: 'Тонет', e: '⬇️' }, 'floats', 'плавает или тонет?',
      function (it) { return it.item + (it.floats ? ' плавает! Он лёгкий.' : ' тонет! Он тяжёлый.'); });
    predictType('wMagnet', function () { return W().EXP_MAGNET; },
      { l: 'Притянется', e: '🧲' }, { l: 'Нет', e: '🙅' }, 'attracts', 'притянется к магниту?',
      function (it) { return it.item + (it.attracts ? ' притянулся! Он железный.' : ' не притянулся. Он не железный.'); });

    Tasks.register('wShadow', {
      build: function (skillId) {
        var it = rot(W().EXP_SHADOW.quiz, skillId);
        return { prompt: it.q, speak: it.q, item: it };
      },
      render: function (data, api) {
        return choiceBoard(api, fromIndexed(data.item), W().EXP_SHADOW.principle);
      }
    });

    Tasks.register('wStates', {
      build: function (skillId) {
        var n = Skills.get(skillId).attempts;
        if (n % 3 === 0) {
          return { prompt: 'Расставь от холодного к горячему!', speak: 'Расставь по порядку: от самого холодного к самому горячему.',
                   order: W().EXP_STATES.order };
        }
        var it = W().EXP_STATES.quiz[n % W().EXP_STATES.quiz.length];
        return { prompt: it.q, speak: it.q, item: it };
      },
      render: function (data, api) {
        if (data.order) {
          return K().orderBoard(api, { items: data.order, hint: 'Лёд самый холодный, пар самый горячий!' });
        }
        return choiceBoard(api, fromIndexed(data.item), 'Вспомни про лёд, воду и пар.');
      }
    });

    Tasks.register('wWhatIf', {
      build: function (skillId) {
        var it = rot(W().EXP_WHATIF, skillId);
        return { prompt: it.q, speak: it.q, item: it };
      },
      render: function (data, api) {
        return choiceBoard(api, fromIndexed(data.item), 'Представь, что это случилось по-настоящему.');
      }
    });
  }

  register();
  global.WorldTasks = { registered: true };

})(window);
