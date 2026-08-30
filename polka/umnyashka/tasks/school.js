/* =========================================================
   tasks/school.js — типы заданий мира «Готов к первому классу».

   Правила учителя закреплены в data/school.js. Здесь важно:
   — «слово-хитрюшка»: правильное написание ПОКАЗЫВАЕТСЯ
     крупно после любого ответа;
   — память: показ не быстрее секунды на элемент;
   — инструкции можно переслушивать без ограничений;
   — таймеров нет нигде, кроме показа в «памяти».
   ========================================================= */
(function (global) {
  'use strict';

  var el = function () { return UI.el.apply(null, arguments); };
  var K = function () { return global.TaskKit; };
  var D = function () { return global.SchoolData; };

  function part(id) { return String(id).split(':')[1] || ''; }
  function band(id) { var n = parseInt(part(id), 10); return isFinite(n) ? n : 1; }
  function rot(list, skillId) {
    return list[Skills.get(skillId).attempts % list.length];
  }
  function textOpts(item) {
    var opts = item.options.map(function (t, i) { return { label: t, ok: i === item.correct }; });
    return UI.shuffle(opts);
  }
  function board(api, opts, hint, wide, answerHint) {
    return K().answerBoard(api, opts, {
      isRight: function (o) { return !!o.ok; },
      fill: opts.some(function (o) { return o.emoji; }) ? K().fillEmojiText : K().fillText,
      hint: hint || '', answerHint: answerHint || hint || '', wide: wide !== false
    });
  }
  function bigText(t) {
    return el('div', {
      class: 'card card--tint center-text',
      style: { fontSize: '24px', fontWeight: '900', letterSpacing: '1px', lineHeight: '1.6' },
      text: t
    });
  }

  function register() {

    /* ---------- 📖 Чтение с пониманием ---------- */
    Tasks.register('schReading', {
      build: function (skillId) {
        var it = rot(D().byBand(D().READING, band(skillId)), skillId);
        return { prompt: it.q, speak: it.text + '. ' + it.q, item: it };
      },
      render: function (data, api) {
        return el('div', { class: 'stack g4' }, [
          bigText(data.item.text),
          board(api, textOpts(data.item), 'Прочитай ещё раз — ответ прячется в тексте.')
        ]);
      }
    });

    Tasks.register('schPicSentence', {
      build: function (skillId) {
        var it = rot(D().PIC_SENTENCE, skillId);
        return { prompt: 'Какое предложение подходит к картинке?', speak: 'Какое предложение подходит к картинке?', item: it };
      },
      render: function (data, api) {
        return el('div', { class: 'stack g4' }, [
          el('div', { class: 'center', style: { fontSize: '64px', letterSpacing: '8px' }, text: data.item.scene }),
          board(api, textOpts(data.item), 'Посмотри на картинку: что тут происходит?')
        ]);
      }
    });

    /* ---------- ✍️ Письмо и правописание ---------- */
    Tasks.register('schMissingLetter', {
      build: function (skillId) {
        var it = rot(D().byBand(D().MISSING_LETTER, band(skillId)), skillId);
        return { prompt: 'Какая буква спряталась?', speak: 'Какая буква спряталась в слове ' + it.full + '?', item: it };
      },
      render: function (data, api) {
        var it = data.item;
        var opts = UI.shuffle(it.options.map(function (l, i) { return { label: l, ok: i === it.correct }; }));
        return el('div', { class: 'stack g4' }, [
          el('div', { class: 'center', style: { fontSize: '54px' }, text: it.hint }),
          bigText(it.word.replace('_', ' _ ')),
          K().answerBoard(api, opts, {
            isRight: function (o) { return !!o.ok; },
            fill: K().fillText,
            hint: 'Скажи слово вслух и послушай звук.',
            answerHint: 'Правильно: ' + it.full,
            onRight: function () { Speech.phrase(it.full + '!'); }
          })
        ]);
      }
    });

    Tasks.register('schFindTypo', {
      build: function (skillId) {
        var it = rot(D().FIND_TYPO, skillId);
        return { prompt: 'Одно слово — хитрюшка! Найди его.', speak: 'Одно слово написано неправильно. Найди хитрюшку!', item: it };
      },
      render: function (data, api) {
        var it = data.item;
        // Правильное написание показывается ПОСЛЕ любого ответа — образ
        // ошибки не должен оставаться последним увиденным (правило учителя)
        var fix = el('div', {
          class: 'card card--sun center-text hidden',
          style: { fontSize: '22px', fontWeight: '900' }
        }, [
          el('div', { text: '✅ ' + it.correctWord }),
          el('div', { class: 't-small mt2', text: it.rule })
        ]);
        function showFix() { fix.classList.remove('hidden'); Speech.phrase('Правильно пишется: ' + it.correctWord); }
        var opts = it.words.map(function (w, i) { return { label: w, ok: i === it.wrongIndex }; });
        return el('div', { class: 'stack g4' }, [
          el('div', { class: 'center', style: { fontSize: '48px' }, text: it.hint }),
          K().answerBoard(api, opts, {
            isRight: function (o) { return !!o.ok; },
            fill: K().fillText, wide: true,
            hint: 'Прочитай каждое слово по слогам.',
            answerHint: it.rule,
            onRight: showFix, onReveal: showFix
          }),
          fix
        ]);
      }
    });

    Tasks.register('schSentenceBuild', {
      build: function (skillId) {
        var it = rot(D().byBand(D().SENTENCE_BUILD, band(skillId)), skillId);
        return {
          prompt: 'Слова рассыпались! Собери предложение.',
          speak: 'Слова рассыпались! Поставь их по порядку: ' + it.cards.join(' ') + '.',
          item: it
        };
      },
      render: function (data, api) {
        var items = data.item.cards.map(function (w, i) { return { id: 'w' + i, label: w }; });
        return K().orderBoard(api, {
          items: items, words: true,
          hint: 'С какого слова начинаем? Оно про того, кто действует!',
          answerHint: 'Правильно так: ' + data.item.cards.join(' ') + '.'
        });
      }
    });

    /* ---------- 🔢 Математическая готовность ---------- */
    Tasks.register('schNeighbors', {
      build: function (skillId, level) {
        var list = D().NEIGHBORS[part(skillId)] || D().NEIGHBORS.easy;
        var n = rot(list, skillId);
        var after = Skills.get(skillId).attempts % 2 === 1;
        var answer = after ? n + 1 : n - 1;
        return {
          prompt: 'Какое число стоит ' + (after ? 'ПОСЛЕ числа ' : 'ПЕРЕД числом ') + n + '?',
          speak: 'Какое число стоит ' + (after ? 'после числа ' : 'перед числом ') + n + '?',
          n: n, answer: answer, after: after, level: level
        };
      },
      render: function (data, api) {
        var row = el('div', { class: 'center g2', style: { fontSize: '34px', fontWeight: '900' } }, [
          el('span', { style: { opacity: data.after ? '1' : '.35' }, text: data.after ? String(data.n) : '❓' }),
          el('span', { text: '·' }),
          el('span', { style: { color: 'var(--accent)' }, text: data.after ? '❓' : String(data.n) })
        ]);
        // показываем ряд-опору на первом уровне
        var support = data.level <= 1
          ? el('div', { class: 'center t-small', text: '1 2 3 4 5 6 7 8 9 10' })
          : null;
        var opts = UI.shuffle([data.answer, data.answer + 1, Math.max(1, data.answer - 1)]
          .filter(function (v, i, a) { return a.indexOf(v) === i; })
          .map(function (v) { return { label: String(v), ok: v === data.answer }; }));
        while (opts.length < 3) opts.push({ label: String(data.answer + opts.length), ok: false });
        return el('div', { class: 'stack g4' }, [
          data.after ? row : row, support,
          board(api, opts, 'Посчитай по порядку: ' + Math.max(1, data.n - 2) + ', ' + Math.max(1, data.n - 1) + '…', false)
        ]);
      }
    });

    Tasks.register('schBonds', {
      build: function (skillId, level) {
        var n = parseInt(part(skillId), 10) || 5;
        var pairs = D().BONDS.pairs(n);
        var pair = pairs[Skills.get(skillId).attempts % pairs.length];
        var hide = Skills.get(skillId).attempts % 2;   // какое слагаемое прячем
        var shown = hide === 0 ? pair[0] : pair[1];
        var answer = hide === 0 ? pair[1] : pair[0];
        return {
          prompt: 'Домик числа ' + n + ': ' + n + ' = ' + (hide === 0 ? shown + ' + ❓' : '❓ + ' + shown),
          speak: 'Число ' + n + ' — это ' + shown + ' и сколько ещё?',
          n: n, shown: shown, answer: answer, level: level
        };
      },
      render: function (data, api) {
        var house = el('div', { class: 'stack center g2' }, [
          el('div', {
            style: { fontSize: '40px', fontWeight: '900', color: 'var(--accent)' },
            text: '🏠 ' + data.n
          }),
          data.level <= 1 ? el('div', { style: { fontSize: '26px', letterSpacing: '3px' },
            text: '🔵'.repeat(data.shown) + '⚪'.repeat(data.answer) }) : null
        ]);
        var vals = [data.answer, Math.min(9, data.answer + 1), Math.max(1, data.answer - 1)]
          .filter(function (v, i, a) { return a.indexOf(v) === i; });
        for (var extra = 2; vals.length < 3 && extra < 9; extra++) {
          if (vals.indexOf(data.answer + extra) === -1 && data.answer + extra <= 9) vals.push(data.answer + extra);
        }
        var opts = UI.shuffle(vals.map(function (v) { return { label: String(v), ok: v === data.answer }; }));
        return el('div', { class: 'stack g4' }, [
          house,
          board(api, opts, 'Посчитай, сколько не хватает до ' + data.n + '.', false)
        ]);
      }
    });

    Tasks.register('schProblem', {
      build: function (skillId) {
        var it = rot(D().byBand(D().WORD_PROBLEMS, band(skillId)), skillId);
        return { prompt: it.text, speak: it.text, item: it };
      },
      render: function (data, api) {
        var it = data.item;
        var pics;
        if (it.op === '+') {
          pics = it.emoji.repeat ? it.emoji.repeat(it.a) + ' + ' + it.emoji.repeat(it.b) : '';
        } else {
          pics = it.emoji.repeat(it.answer) + '·' + it.emoji.repeat(it.b);
        }
        var opts = UI.shuffle([it.answer, it.answer + 1, it.b === it.answer ? it.a : it.b]
          .filter(function (v, i, a) { return a.indexOf(v) === i && v > 0; })
          .map(function (v) { return { label: String(v), ok: v === it.answer }; }));
        while (opts.length < 3) opts.push({ label: String(it.answer + opts.length), ok: false });
        return el('div', { class: 'stack g4' }, [
          el('div', { class: 'center-text', style: { fontSize: '30px', lineHeight: '1.5', wordBreak: 'break-word' }, text: pics }),
          board(api, UI.shuffle(opts), 'Пересчитай картинки пальчиком!', false)
        ]);
      }
    });

    /* ---------- 🧠 Логика ---------- */
    Tasks.register('schPattern', {
      build: function (skillId) {
        var it = rot(D().byBand(D().PATTERNS, band(skillId)), skillId);
        return { prompt: 'Что будет дальше?', speak: 'Посмотри внимательно. Что будет дальше?', item: it };
      },
      render: function (data, api) {
        var it = data.item;
        var opts = UI.shuffle(it.options.map(function (o) { return { label: o, ok: o === it.answer }; }));
        return el('div', { class: 'stack g4' }, [
          el('div', { class: 'center-text', style: { fontSize: '40px', letterSpacing: '4px' }, text: it.seq.join(' ') + ' ❓' }),
          K().answerBoard(api, opts, {
            isRight: function (o) { return !!o.ok; },
            fill: function (o, tile) { tile.appendChild(el('span', { class: 'ck-big', text: o.label })); },
            hint: 'Скажи ряд вслух — услышишь закономерность!'
          })
        ]);
      }
    });

    Tasks.register('schOddOne', {
      build: function (skillId) {
        var it = rot(D().byBand(D().ODD_ONE, band(skillId)), skillId);
        return { prompt: 'Что здесь лишнее?', speak: 'Посмотри на картинки. Что здесь лишнее?', item: it };
      },
      render: function (data, api) {
        var it = data.item;
        // Перемешиваем: лишний не должен угадываться по позиции
        var opts = UI.shuffle(it.items.map(function (e, i) { return { label: e, ok: i === it.oddIndex }; }));
        return K().answerBoard(api, opts, {
          isRight: function (o) { return !!o.ok; },
          fill: function (o, tile) { tile.appendChild(el('span', { class: 'ck-big', text: o.label })); },
          hint: 'Назови каждую картинку. Что не подходит к остальным?',
          answerHint: 'Лишнее — потому что ' + it.why + '.',
          onRight: function () { Speech.phrase('Верно! Это лишнее, потому что ' + it.why + '.'); }
        });
      }
    });

    Tasks.register('schCompare', {
      build: function (skillId) {
        var it = rot(D().COMPARE, skillId);
        return { prompt: it.q, speak: it.q, item: it };
      },
      render: function (data, api) {
        var it = data.item;
        var opts = it.pair.map(function (e, i) { return { label: e, ok: i === it.correct }; });
        return K().answerBoard(api, opts, {
          isRight: function (o) { return !!o.ok; },
          fill: function (o, tile) {
            tile.appendChild(el('span', { style: { fontSize: '56px' }, text: o.label }));
          },
          hint: 'Представь их рядом в жизни!'
        });
      }
    });

    /* ---------- 👀 Внимание ---------- */
    Tasks.register('schWhatGone', {
      build: function (skillId) {
        var it = rot(D().WHAT_GONE, skillId);
        return { prompt: 'Запомни картинки!', speak: 'Запомни картинки! Одна сейчас спрячется.', item: it };
      },
      render: function (data, api) {
        var it = data.item;
        return K().memoryShow(api, {
          items: it.items,
          showMs: 3200,
          after: function () {
            var remain = it.items.filter(function (x) { return x !== it.gone; });
            var opts = UI.shuffle([
              { label: it.gone, ok: true },
              { label: remain[0], ok: false },
              { label: it.extra, ok: false }
            ]);
            var wrap = el('div', { class: 'stack g3 center' }, [
              el('div', { class: 't-sub', text: 'Кто спрятался?' }),
              el('div', { class: 'center', style: { fontSize: '34px', letterSpacing: '6px' }, text: remain.join(' ') }),
              K().answerBoard(api, opts, {
                isRight: function (o) { return !!o.ok; },
                fill: function (o, tile) { tile.appendChild(el('span', { class: 'ck-big', text: o.label })); },
                hint: 'Вспомни, что было в начале.'
              })
            ]);
            Speech.phrase('Кто спрятался?');
            return wrap;
          }
        });
      }
    });

    Tasks.register('schFindLetter', {
      build: function (skillId) {
        var it = rot(D().byBand(D().FIND_LETTER, band(skillId)), skillId);
        return {
          prompt: 'Найди все буквы ' + it.target + '!',
          speak: 'Найди и нажми все буквы ' + it.target + '.',
          item: it
        };
      },
      render: function (data, api) {
        var it = data.item;
        var symbols = it.letters.split(' ').map(function (ch) {
          return { ch: ch, target: ch === it.target };
        });
        return K().findAll(api, { symbols: symbols, hint: 'Смотри внимательно: есть похожие буквы-обманки!' });
      }
    });

    /* ---------- 🧠 Память ---------- */
    Tasks.register('schMemoColors', {
      build: function (skillId, level) {
        var len = level <= 1 ? 3 : level === 2 ? 4 : 5;
        var seq = [];
        for (var i = 0; i < len; i++) seq.push(UI.pick(D().MEMO_COLORS));
        return { prompt: 'Запомни цвета по порядку!', speak: 'Запомни цвета по порядку. Потом повтори!', seq: seq };
      },
      render: function (data, api) {
        // показ не быстрее 1 секунды на элемент — требование учителя
        return K().memoryShow(api, {
          items: data.seq,
          showMs: Math.max(3000, data.seq.length * 1100),
          after: function () {
            var pos = 0, missed = false, judged = false;
            var progress = el('div', { class: 'ck-cap', text: 'Повтори: ' + data.seq.length + ' цветов' });
            var row = el('div', { class: 'ck-pool' });
            D().MEMO_COLORS.forEach(function (c) {
              var b = el('button', { class: 'ck-tile', type: 'button' }, [el('span', { class: 'ck-big', text: c })]);
              b.addEventListener('click', function () {
                if (judged) return;   // пока открыт фидбек — поле заморожено
                if (c === data.seq[pos]) {
                  SFX.tick(); pos++;
                  progress.textContent = 'Ещё ' + (data.seq.length - pos);
                  if (pos === data.seq.length && !judged) {
                    judged = true;
                    api.answer(!missed, missed ? { hint: 'Было так: ' + data.seq.join(' ') } : { node: row });
                  }
                } else {
                  SFX.almost();
                  if (!missed && !judged) {
                    missed = true; judged = true;
                    api.answer(false, {
                      hint: 'Начни сначала. Было так: ' + data.seq.join(' '),
                      onRetry: function () { judged = false; pos = 0; progress.textContent = 'Сначала!'; }
                    });
                  }
                }
              });
              row.appendChild(b);
            });
            Speech.phrase('Теперь повтори по порядку!');
            return el('div', { class: 'stack g3 center' }, [progress, row]);
          }
        });
      }
    });

    Tasks.register('schMemoWords', {
      build: function (skillId, level) {
        var list = D().MEMO_WORDS.filter(function (w) { return level >= 3 || !w.hard; });
        var it = rot(list, skillId);
        return { prompt: 'Запомни слова!', speak: 'Запомни слова на карточках!', item: it };
      },
      render: function (data, api) {
        var it = data.item;
        return K().memoryShow(api, {
          items: it.show.map(function (p) { return p[0] + ' ' + p[1]; }),
          showMs: 4200,
          after: function () {
            var opts = textOpts(it);
            Speech.phrase('Какое слово ты видел?');
            return el('div', { class: 'stack g3 center' }, [
              el('div', { class: 't-sub', text: 'Какое слово ты видел?' }),
              board(api, opts, 'Вспомни карточки!')
            ]);
          }
        });
      }
    });

    Tasks.register('schMemoDigits', {
      build: function (skillId, level) {
        var len = level >= 3 ? 4 : 3;
        var seq = [];
        for (var i = 0; i < len; i++) seq.push(UI.rnd(1, 9));
        return { prompt: 'Запомни цифры!', speak: 'Запомни цифры по порядку!', seq: seq };
      },
      render: function (data, api) {
        return K().memoryShow(api, {
          items: data.seq.map(String),
          showMs: Math.max(3000, data.seq.length * 1100),
          after: function () {
            var pos = 0, missed = false, judged = false;
            var typed = el('div', { style: { fontSize: '30px', fontWeight: '900', minHeight: '38px', letterSpacing: '6px' } });
            var pad = el('div', { class: 'ck-find', style: { gridTemplateColumns: 'repeat(3,1fr)', width: 'min(260px,100%)' } });
            for (var d = 1; d <= 9; d++) (function (d) {
              var b = el('button', { class: 'ck-find__cell', type: 'button' }, [el('span', { text: String(d) })]);
              b.addEventListener('click', function () {
                if (judged) return;   // пока открыт фидбек — поле заморожено
                if (d === data.seq[pos]) {
                  SFX.tick(); typed.textContent += String(d) + ' '; pos++;
                  if (pos === data.seq.length && !judged) {
                    judged = true;
                    api.answer(!missed, missed ? { hint: 'Было: ' + data.seq.join(' ') } : { node: pad });
                  }
                } else {
                  SFX.almost();
                  if (!missed && !judged) {
                    missed = true; judged = true;
                    api.answer(false, {
                      hint: 'Было: ' + data.seq.join(' ') + '. Попробуй сначала!',
                      onRetry: function () { judged = false; pos = 0; typed.textContent = ''; }
                    });
                  }
                }
              });
              pad.appendChild(b);
            })(d);
            Speech.phrase('Набери цифры по порядку!');
            return el('div', { class: 'stack g3 center' }, [typed, pad]);
          }
        });
      }
    });

    /* ---------- 🗣️ Речь ---------- */
    Tasks.register('schOpposite', {
      build: function (skillId) {
        var half = part(skillId) === '2' ? D().OPPOSITES.slice(5) : D().OPPOSITES.slice(0, 5);
        var it = rot(half, skillId);
        return {
          prompt: 'Скажи наоборот: <b>' + it.word.toUpperCase() + '</b>',
          speak: 'Я говорю ' + it.word + ' — а ты говоришь…?',
          item: it
        };
      },
      render: function (data, api) {
        var it = data.item;
        var opts = UI.shuffle(it.options.map(function (o) { return { label: o, ok: o === it.answer }; }));
        return el('div', { class: 'stack g4' }, [
          el('div', { class: 'center', style: { fontSize: '56px' }, text: it.emoji }),
          K().answerBoard(api, opts, {
            isRight: function (o) { return !!o.ok; },
            fill: K().fillText, wide: true,
            hint: 'Наоборот — это совсем-совсем другое!',
            onRight: function () { Speech.phrase(it.word + ' — ' + it.answer + '! ' + it.answerEmoji); }
          })
        ]);
      }
    });

    Tasks.register('schFinishSentence', {
      build: function (skillId) {
        var half = part(skillId) === '2' ? D().FINISH_SENTENCE.slice(5) : D().FINISH_SENTENCE.slice(0, 5);
        var it = rot(half, skillId);
        return { prompt: it.start, speak: it.start.replace('…', '… что?'), item: it };
      },
      render: function (data, api) {
        return board(api, textOpts(data.item), 'Подумай, как бывает на самом деле.');
      }
    });

    Tasks.register('schStoryOrder', {
      build: function (skillId) {
        var it = rot(D().STORY_ORDER, skillId);
        return { prompt: 'Расставь картинки по порядку!', speak: 'Расставь картинки по порядку. Что было сначала?', item: it };
      },
      render: function (data, api) {
        var it = data.item;
        var fakeApi = Object.create(api);
        fakeApi.answer = function (ok, o) {
          if (ok) Speech.phrase(it.story + ' Расскажи эту историю маме или папе!');
          api.answer(ok, o);
        };
        return K().orderBoard(fakeApi, {
          items: it.items,
          hint: 'Что бывает в самом начале?',
          answerHint: it.story
        });
      }
    });

    /* ---------- 🎯 Инструкции «Слушай и делай» ---------- */
    function shapeNode(item) {
      var size = item.size === 'small' ? 40 : 62;
      var css = D().COLORS[item.color].css;
      var s = el('span', { class: 'sch-shape', 'aria-hidden': 'true' });
      if (item.shape === 'circle') {
        Object.assign(s.style, { width: size + 'px', height: size + 'px', borderRadius: '50%', background: css });
      } else if (item.shape === 'square') {
        Object.assign(s.style, { width: size + 'px', height: size + 'px', borderRadius: '8px', background: css });
      } else {
        Object.assign(s.style, {
          width: '0', height: '0', background: 'transparent',
          borderLeft: (size / 2) + 'px solid transparent',
          borderRight: (size / 2) + 'px solid transparent',
          borderBottom: size + 'px solid ' + css
        });
      }
      return s;
    }

    function matches(item, cond) {
      if (cond.shape && item.shape !== cond.shape) return false;
      if (cond.color && item.color !== cond.color) return false;
      if (cond.size && item.size !== cond.size) return false;
      return true;
    }

    /** Собрать поле так, чтобы у каждого шага был ровно один верный ответ. */
    function buildField(inst) {
      var shapes = ['circle', 'square', 'triangle'];
      var colors = ['red', 'blue', 'yellow', 'green'];
      var field = [];

      function randItem() {
        return {
          shape: UI.pick(shapes), color: UI.pick(colors),
          size: inst.band >= 2 ? UI.pick(['big', 'small']) : 'big'
        };
      }
      function conflicts(item) {
        if (inst.steps) {
          return inst.steps.some(function (st) { return matches(item, st); });
        }
        if (inst.all) return item.shape === inst.all;
        if (inst.not) return !(matches(item, { shape: inst.not.shape }) || matches(item, { color: inst.not.color }));
        return false;
      }

      if (inst.steps) {
        inst.steps.forEach(function (st) {
          field.push({
            shape: st.shape || UI.pick(shapes),
            color: st.color || UI.pick(colors),
            size: st.size || (inst.band >= 2 ? 'big' : 'big'),
            targetStep: field.filter(function (f) { return f.targetStep !== undefined; }).length
          });
        });
      } else if (inst.all) {
        for (var i = 0; i < 3; i++) {
          field.push({ shape: inst.all, color: UI.pick(colors), size: 'big', targetStep: 0 });
        }
      } else if (inst.not) {
        // единственная фигура не той формы и не того цвета
        var okShapes = shapes.filter(function (s) { return s !== inst.not.shape; });
        var okColors = colors.filter(function (c) { return c !== inst.not.color; });
        field.push({ shape: UI.pick(okShapes), color: UI.pick(okColors), size: 'big', targetStep: 0 });
      }

      var guard = 0;
      while (field.length < 7 && guard < 200) {
        guard++;
        var it = randItem();
        if (!conflicts(it)) field.push(it);
      }
      return UI.shuffle(field);
    }

    Tasks.register('schInstruction', {
      build: function (skillId) {
        var b = band(skillId);
        var list = D().INSTRUCTIONS.filter(function (x) { return x.band === b; });
        if (!list.length) list = D().INSTRUCTIONS;
        var inst = rot(list, skillId);
        return { prompt: inst.text, speak: inst.text, inst: inst, field: buildField(inst) };
      },
      render: function (data, api) {
        var inst = data.inst;
        var expectStep = 0, missed = false, judged = false, doneCount = 0;
        var totalTargets = inst.all ? 3 : (inst.steps ? inst.steps.length : 1);

        var grid = el('div', { class: 'ck-pool', style: { minHeight: '120px', alignItems: 'center' } });
        data.field.forEach(function (item) {
          var b = el('button', {
            class: 'ck-tile', type: 'button',
            style: { minWidth: '84px', minHeight: '84px' },
            'aria-label': D().COLORS[item.color].name + ' ' + D().SHAPES[item.shape].name,
            dataset: { step: item.targetStep !== undefined ? String(item.targetStep) : '' }
          }, [shapeNode(item)]);
          b.addEventListener('click', function () {
            if (judged) return;   // пока открыт фидбек — поле заморожено
            if (b.classList.contains('is-done')) return;
            var ok;
            if (inst.steps) ok = item.targetStep === expectStep;
            else ok = item.targetStep !== undefined;
            if (ok) {
              SFX.right();
              b.classList.add('is-done');
              expectStep++;
              doneCount++;
              if (doneCount === totalTargets && !judged) {
                judged = true;
                api.answer(!missed, missed ? { hint: inst.text } : { node: grid });
              }
            } else {
              SFX.almost();
              b.classList.add('is-almost');
              setTimeout(function () { b.classList.remove('is-almost'); }, 450);
              if (!missed && !judged) {
                missed = true; judged = true;
                api.answer(false, {
                  hint: 'Послушай ещё раз: ' + inst.text,
                  onRetry: function () { judged = false; expectStep = 0; doneCount = 0;
                    Array.prototype.forEach.call(grid.children, function (n) { n.classList.remove('is-done'); }); }
                });
              }
            }
          });
          grid.appendChild(b);
        });
        return grid;
      }
    });
  }

  register();
  global.SchoolTasks = { registered: true };

})(window);
