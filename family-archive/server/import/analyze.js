// Разбор прочитанной книги Excel в записи и ПРЕДПОЛОЖЕНИЯ.
//
// Принципы:
// * каждая непустая текстовая ячейка (основная ячейка объединения) — отдельная запись;
// * исходная строка сохраняется полностью, отображаемое имя — та же строка
//   без пробелов по краям; написание не исправляется;
// * никакие связи не создаются: формируются только гипотезы с объяснением
//   основания и вопросы для пользователя.
import { hasBorder, cellRef, indexToCol } from '../xlsx/reader.js';
import {
  parseFullName, patronymicMatchesName, surnameStem, searchKey, familyLabel,
  doubleLetterSuggestion, patronymicGenderForm, surnameGenderForm,
} from '../../shared/names.js';

const quote = (s) => `«${s}»`;
const lowerNoYo = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');

export function analyzeWorkbook(wb, { includeHidden = false } = {}) {
  const sheets = [];
  const records = [];
  const skipped = [];
  const geometry = {};

  for (const sheet of wb.sheets) {
    const included = sheet.kind === 'worksheet' && (sheet.state === 'visible' || includeHidden);
    const mergeAt = new Map();
    for (const m of sheet.merges) {
      for (let r = m.top; r <= m.bottom; r++) for (let c = m.left; c <= m.right; c++) mergeAt.set(cellRef(r, c), m);
    }
    const sheetRecords = [];
    let nonText = 0;
    for (const c of sheet.cells) {
      const m = mergeAt.get(c.ref);
      const isMaster = !m || (m.top === c.row && m.left === c.col);
      const hasValue = c.value != null && c.value !== '';
      if (!isMaster) {
        if (hasValue) skipped.push({ sheet: sheet.name, cell: c.ref, raw: c.value, reason: `Значение внутри объединённого диапазона ${m.ref}, но не в основной ячейке — не читается` });
        continue;
      }
      if (!hasValue) continue;
      if (c.type !== 'string') {
        nonText += 1;
        skipped.push({ sheet: sheet.name, cell: c.ref, raw: c.value, reason: c.formula ? 'Формула с нетекстовым результатом' : 'Нетекстовое значение (число, дата или логическое)' });
        continue;
      }
      if (!c.value.trim()) {
        skipped.push({ sheet: sheet.name, cell: c.ref, raw: c.value, reason: 'Ячейка содержит только пробелы' });
        continue;
      }
      if (!included) continue;
      const span = m ? { top: m.top, left: m.left, bottom: m.bottom, right: m.right } : { top: c.row, left: c.col, bottom: c.row, right: c.col };
      const text = c.value.trim();
      sheetRecords.push({
        key: `${sheet.name}!${c.ref}`,
        sheet: sheet.name,
        sheetIndex: sheet.index,
        cell: c.ref,
        row: c.row,
        col: c.col,
        mergedRange: m ? m.ref : null,
        span,
        raw: c.value,
        text,
        trailingSpaces: c.value.length - c.value.replace(/\s+$/, '').length,
        leadingSpaces: c.value.length - c.value.replace(/^\s+/, '').length,
        fromFormula: c.formula,
        parse: parseFullName(text),
      });
    }
    sheetRecords.sort((a, b) => a.row - b.row || a.col - b.col);
    records.push(...sheetRecords);

    if (included) geometry[sheet.name] = buildGeometry(sheet, sheetRecords, mergeAt);
    sheets.push({
      name: sheet.name,
      index: sheet.index,
      state: sheet.state,
      kind: sheet.kind,
      included,
      declaredDimension: sheet.declaredDimension,
      recordCount: sheetRecords.length,
      mergeCount: sheet.merges.length,
      formulas: sheet.formulas,
      comments: sheet.comments,
      tables: sheet.tables,
      drawing: sheet.drawing,
      nonText,
      valueCount: sheet.cells.filter((c) => c.value != null && c.value !== '').length,
    });
  }

  const suggestions = buildSuggestions(records, geometry);
  const nameReviews = buildNameReviews(records, suggestions.parentCandidates);
  delete suggestions.parentCandidates;
  const checks = buildChecks(sheets, records, skipped, geometry);
  return { sheets, records, skipped, geometry, suggestions, nameReviews, checks };
}

// ---------- Геометрия: ширины, высоты, границы, рамки ----------

function buildGeometry(sheet, recs, mergeAt) {
  const cellMap = new Map(sheet.cells.map((c) => [c.ref, c]));
  const bordered = sheet.cells.filter((c) => hasBorder(c.border));
  const all = [...recs.map((r) => r.span), ...bordered.map((c) => ({ top: c.row, left: c.col, bottom: c.row, right: c.col }))];
  const minCol = all.length ? Math.min(...all.map((s) => s.left)) : 1;
  const maxCol = all.length ? Math.max(...all.map((s) => s.right)) : 1;
  const minRow = 1;
  const maxRow = all.length ? Math.max(...all.map((s) => s.bottom)) : 1;
  const colWidth = new Map(sheet.columns.map((c) => [c.index, c]));
  const rowHeight = new Map(sheet.rows.map((r) => [r.index, r]));
  const columns = [];
  for (let c = minCol; c <= maxCol; c++) {
    const def = colWidth.get(c);
    columns.push({ index: c, letter: indexToCol(c), width: def?.width ?? sheet.defaultColWidth, hidden: !!def?.hidden });
  }
  const rows = [];
  const recordRows = new Set();
  for (const r of recs) for (let i = r.span.top; i <= r.span.bottom; i++) recordRows.add(i);
  for (let r = minRow; r <= maxRow; r++) {
    const def = rowHeight.get(r);
    rows.push({ index: r, height: def?.height ?? sheet.defaultRowHeight, hidden: !!def?.hidden, hasRecords: recordRows.has(r) });
  }
  const borderOf = (r, c) => cellMap.get(cellRef(r, c))?.border || {};
  // Есть ли линия между (r,c) и соседней ячейкой.
  const edge = {
    top: (r, c) => !!(borderOf(r, c).top || borderOf(r - 1, c).bottom),
    bottom: (r, c) => !!(borderOf(r, c).bottom || borderOf(r + 1, c).top),
    left: (r, c) => !!(borderOf(r, c).left || borderOf(r, c - 1).right),
    right: (r, c) => !!(borderOf(r, c).right || borderOf(r, c + 1).left),
  };
  const borderedCells = bordered.map((c) => {
    const m = mergeAt.get(c.ref);
    return {
      ref: c.ref,
      row: c.row,
      col: c.col,
      border: c.border,
      empty: c.value == null || c.value === '',
      inMerge: m ? m.ref : null,
    };
  });
  const frames = detectFrames(recs, sheet.merges, edge, { minCol, maxCol, maxRow });
  return {
    declaredDimension: sheet.declaredDimension,
    minCol, maxCol, minRow, maxRow,
    columns, rows,
    merges: sheet.merges,
    borderedCells,
    frames,
    emptyRows: rows.filter((r) => !r.hasRecords && r.index >= Math.min(...[...recordRows], Infinity) && r.index <= Math.max(...[...recordRows], -Infinity)).map((r) => r.index),
  };
}

// Рамки: прямоугольники до 3×3 ячеек, периметр которых очерчен границами
// полностью или почти полностью (≥ 75 %). Рамка — лишь оформление и может
// служить пояснением к гипотезе, но не подтверждает родство.
function detectFrames(recs, merges, edge, { minCol, maxCol, maxRow }) {
  const found = [];
  const crossesMerge = (t, l, b, r) => merges.some((m) => {
    const inter = !(m.right < l || m.left > r || m.bottom < t || m.top > b);
    const inside = m.left >= l && m.right <= r && m.top >= t && m.bottom <= b;
    return inter && !inside;
  });
  for (let t = 1; t <= maxRow; t++) {
    for (let b = t; b <= Math.min(maxRow, t + 2); b++) {
      for (let l = minCol; l <= maxCol; l++) {
        for (let r = l; r <= Math.min(maxCol, l + 2); r++) {
          if (crossesMerge(t, l, b, r)) continue;
          const inside = recs.filter((x) => x.span.top >= t && x.span.bottom <= b && x.span.left >= l && x.span.right <= r);
          if (!inside.length) continue;
          let total = 0;
          let got = 0;
          for (let c = l; c <= r; c++) {
            total += 2;
            if (edge.top(t, c)) got++;
            if (edge.bottom(b, c)) got++;
          }
          for (let rr = t; rr <= b; rr++) {
            total += 2;
            if (edge.left(rr, l)) got++;
            if (edge.right(rr, r)) got++;
          }
          const coverage = got / total;
          const complete = got === total;
          if (complete || (coverage >= 0.75 && inside.length >= 2)) {
            found.push({ ref: `${cellRef(t, l)}:${cellRef(b, r)}`, top: t, left: l, bottom: b, right: r, coverage, complete, records: inside.map((x) => x.key) });
          }
        }
      }
    }
  }
  const contains = (a, b) => a.top <= b.top && a.left <= b.left && a.bottom >= b.bottom && a.right >= b.right && a !== b;
  const overlaps = (a, b) => !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
  const complete = found.filter((f) => f.complete);
  // Полная рамка, разделённая внутри на полные рамки, заменяется ими (H3:J4 → H3:H4 и I3:J4).
  const keptComplete = complete.filter((g) => {
    const inner = complete.filter((f) => contains(g, f));
    if (!inner.length) return true;
    const covered = new Set(inner.flatMap((f) => f.records));
    return !g.records.every((k) => covered.has(k));
  });
  const partial = found.filter((f) => !f.complete && !complete.some((g) => overlaps(g, f)));
  const keptPartial = partial.filter((f) => !partial.some((g) => contains(g, f) && g.coverage >= f.coverage && g.records.length >= f.records.length));
  const kept = [...keptComplete, ...keptPartial];
  // Среди одинаковых по составу рамок оставляем самую полную.
  const byRecords = new Map();
  for (const f of kept) {
    const k = f.records.join('|');
    const prev = byRecords.get(k);
    if (!prev || f.coverage > prev.coverage) byRecords.set(k, f);
  }
  return [...byRecords.values()].sort((a, b) => a.top - b.top || a.left - b.left);
}

// ---------- Гипотезы и вопросы ----------

function buildSuggestions(records, geometry) {
  const hypotheses = [];
  const questions = [];
  let seq = 0;
  const hid = () => `h${++seq}`;
  const parentCandidates = new Map();

  const surnameFreq = new Map();
  for (const r of records) {
    const st = surnameStem(r.parse.surname);
    if (st) surnameFreq.set(st, (surnameFreq.get(st) || 0) + 1);
  }

  const bySheet = new Map();
  for (const r of records) {
    if (!bySheet.has(r.sheet)) bySheet.set(r.sheet, []);
    bySheet.get(r.sheet).push(r);
  }

  for (const [sheetName, recs] of bySheet) {
    const geo = geometry[sheetName];
    const area = (f) => (f.bottom - f.top + 1) * (f.right - f.left + 1);
    const frames = [...(geo?.frames || [])].sort((a, b) => area(a) - area(b));
    const info = new Map();
    for (const r of recs) {
      info.set(r.key, {
        r,
        sStem: surnameStem(r.parse.surname),
        pc: [],
        pcAll: [],
        gen: 0,
      });
    }
    const I = (r) => info.get(r.key);
    const label = (r) => `${quote(r.text)} (${r.cell})`;
    const colsOverlap = (a, b) => !(a.span.right < b.span.left || a.span.left > b.span.right);
    const sameFrame = (a, b) => frames.find((f) => f.records.includes(a.key) && f.records.includes(b.key));
    const siblingsLike = (a, b) => {
      const ia = I(a), ib = I(b);
      return !!(ia.sStem && ia.sStem === ib.sStem && a.parse.patronymic && b.parse.patronymic &&
        searchKey(a.parse.patronymic).replace(/(ич|на)$/, '').replace(/ов$|ев$/, '') ===
        searchKey(b.parse.patronymic).replace(/(ич|на)$/, '').replace(/ов$|ев$/, ''));
    };
    const sorted = [...recs].sort((a, b) => a.span.top - b.span.top || a.span.left - b.span.left);

    // 1. Возможные родители по отчеству (только записи выше).
    for (const x of sorted) {
      const ix = I(x);
      if (x.parse.patronymic) {
        const cands = recs.filter((y) => y !== x && y.span.bottom < x.span.top && y.parse.given_name && patronymicMatchesName(x.parse.patronymic, y.parse.given_name));
        ix.pcAll = cands;
        let chosen = cands.filter((y) => I(y).sStem && I(y).sStem === ix.sStem);
        if (!chosen.length) chosen = cands;
        if (chosen.length) {
          const closest = Math.max(...chosen.map((y) => y.span.bottom));
          chosen = chosen.filter((y) => y.span.bottom === closest);
        }
        ix.pc = chosen;
      }
      // Условное «поколение» — только для отбора гипотез, нигде не показывается как факт.
      if (ix.pc.length) {
        ix.gen = Math.max(...ix.pc.map((p) => I(p).gen)) + 1;
      } else {
        const upper = recs.filter((u) => u.span.bottom + 1 === x.span.top && colsOverlap(u, x));
        ix.gen = upper.length ? I(upper[0]).gen : 0;
      }
      parentCandidates.set(x.key, ix.pcAll.map((p) => p.key));
    }

    // 2. Возможно, один и тот же человек: совпадают фамилия и имя.
    const samePairs = [];
    for (let i = 0; i < recs.length; i++) {
      for (let j = i + 1; j < recs.length; j++) {
        const a = recs[i], b = recs[j];
        const ia = I(a), ib = I(b);
        if (!ia.sStem || ia.sStem !== ib.sStem) continue;
        if (!a.parse.given_name || searchKey(a.parse.given_name) !== searchKey(b.parse.given_name)) continue;
        const pa = a.parse.patronymic, pb = b.parse.patronymic;
        if (pa && pb && searchKey(pa) !== searchKey(pb)) continue;
        const [first, second] = a.span.top <= b.span.top ? [a, b] : [b, a];
        samePairs.push([first, second]);
      }
    }

    // 3. Возможные пары: записи вплотную одна под другой.
    const pairHyps = [];
    for (const u of sorted) {
      for (const l of sorted) {
        if (u.span.bottom + 1 !== l.span.top || !colsOverlap(u, l)) continue;
        const iu = I(u), il = I(l);
        if (il.pcAll.includes(u) || iu.pcAll.includes(l)) continue;
        if (siblingsLike(u, l)) continue;
        if (iu.gen !== il.gen) continue;
        if (samePairs.some(([a, b]) => (a === u && b === l) || (a === l && b === u))) continue;
        const frame = sameFrame(u, l);
        const basis = [
          { code: 'adjacent', text: `Записи ${u.cell} и ${l.cell} стоят в наброске вплотную одна под другой.` },
        ];
        if (frame) basis.push({ code: 'frame', text: `Обе записи внутри ${frame.complete ? 'общей рамки' : 'общей неполной рамки'} ${frame.ref}.` });
        basis.push({ code: 'caveat', text: 'Так в наброске иногда обозначают пару, но расположение и рамка не подтверждают родство.' });
        const h = { id: hid(), type: 'partnership', a: u.key, b: l.key, strength: frame ? 'frame' : 'position', basis };
        hypotheses.push(h);
        pairHyps.push({ h, u, l });
      }
    }

    // 4. Возможные родители по отчеству и возможные «вторые родители» по расположению.
    const groups = new Map();
    for (const x of sorted) {
      const ix = I(x);
      if (!ix.pc.length) continue;
      const k = ix.pc.map((p) => p.key).sort().join('|');
      if (!groups.has(k)) groups.set(k, { pcs: ix.pc, children: [] });
      groups.get(k).children.push(x);
    }

    const sameQuestions = [];
    for (const [a, b] of samePairs) {
      const h = {
        id: hid(),
        type: 'same_person',
        a: a.key,
        b: b.key,
        strength: 'name',
        basis: [
          { code: 'same_name', text: `Совпадают фамилия и имя: ${label(a)} и ${label(b)}.` },
          { code: 'caveat', text: 'Совпадение имени не доказывает, что это один человек. До вашего решения записи остаются отдельными.' },
        ],
      };
      hypotheses.push(h);
      sameQuestions.push({ a, b, hyps: [h] });
    }

    const parentHyp = (p, x, strength, basis) => {
      const h = { id: hid(), type: 'parent_child', a: p.key, b: x.key, strength, basis };
      hypotheses.push(h);
      return h;
    };

    for (const g of groups.values()) {
      const { pcs, children } = g;
      const hyps = [];
      for (const x of children) {
        const ix = I(x);
        for (const p of pcs) {
          const basis = [
            { code: 'patronymic', text: `Отчество ${quote(x.parse.patronymic)} может быть образовано от имени ${quote(p.parse.given_name)} (${p.cell}).` },
          ];
          if (I(p).sStem && I(p).sStem === ix.sStem) basis.push({ code: 'surname', text: `Совпадает основа фамилии: ${quote(p.parse.surname)} и ${quote(x.parse.surname)}.` });
          else if (p.parse.surname && x.parse.surname) basis.push({ code: 'surname_diff', text: `Фамилии различаются: ${quote(p.parse.surname)} и ${quote(x.parse.surname)}.` });
          basis.push({ code: 'above', text: `Запись ${p.cell} расположена выше записи ${x.cell}; положение само по себе родство не подтверждает.` });
          const others = ix.pcAll.filter((y) => !pcs.includes(y));
          if (others.length) basis.push({ code: 'other_same_name', text: `Подходящее имя есть и в записях: ${others.map(label).join(', ')} — выбрана ближайшая запись выше${others.some((y) => I(y).sStem !== ix.sStem) ? ' с той же фамилией' : ''}.` });
          hyps.push(parentHyp(p, x, 'patronymic', basis));
        }
      }
      // Возможные вторые родители: записи, стоящие в возможной паре с родителем по отчеству.
      const coparents = [];
      for (const p of pcs) {
        for (const ph of pairHyps) {
          const other = ph.u === p ? ph.l : ph.l === p ? ph.u : null;
          if (other && !pcs.includes(other) && !children.includes(other) && !coparents.includes(other)) coparents.push(other);
        }
      }
      for (const q of coparents) {
        const partnerOf = pcs.find((p) => pairHyps.some((ph) => (ph.u === p && ph.l === q) || (ph.l === p && ph.u === q)));
        for (const x of children) {
          const basis = [
            { code: 'coparent', text: `Запись ${q.cell} стоит рядом с ${partnerOf.cell} — это отдельное предположение о паре.` },
            { code: 'patronymic_ref', text: `${x.cell}: по отчеству предполагается родитель ${partnerOf.cell}.` },
            { code: 'caveat', text: 'Даже если пара подтвердится, это не делает запись родителем автоматически.' },
          ];
          if (coparents.length > 1) basis.push({ code: 'no_columns', text: `Возможные вторые родители (${coparents.map((c) => c.cell).join(', ')}) предложены для всех детей одинаково — без распределения по столбцам.` });
          hyps.push(parentHyp(q, x, 'position', basis));
        }
      }
      // Вопрос о родителе единственной записи, которая может совпадать с родителем, объединяем с вопросом «один ли это человек».
      const sq = children.length === 1 && pcs.length === 1 ? sameQuestions.find((s) => (s.a === pcs[0] && s.b === children[0]) || (s.b === pcs[0] && s.a === children[0])) : null;
      if (sq) {
        sq.hyps.push(...hyps);
        sq.extraPersons = coparents;
        continue;
      }
      const notes = [];
      const adjacentChildren = children.some((a) => children.some((b) => a !== b && a.span.bottom + 1 === b.span.top && colsOverlap(a, b)));
      if (adjacentChildren) notes.push('Записи стоят одна под другой, но это не означает цепочку поколений: у них общее по смыслу отчество, поэтому они рассматриваются как возможные братья и сёстры, а не родители и дети.');
      if (coparents.length > 1) notes.push(`Возможные вторые родители (${coparents.map(label).join(', ')}) не распределяются по столбцам; дети не считаются заранее полнородными братьями и сёстрами.`);
      if (children.length > 1) notes.push('Подтверждайте каждого родителя отдельно: подтверждение одного родителя не назначает второго и не создаёт пару.');
      const names = children.map(label);
      const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}` : names[0];
      questions.push({
        kind: 'parents',
        sheet: sheetName,
        subjects: children.map((c) => c.key),
        candidates: [...pcs, ...coparents].map((c) => c.key),
        title: `Кто родители: ${list}?`,
        prompt: `Отчество указывает на возможного родителя: ${pcs.map(label).join(', ')}.` +
          (coparents.length ? ` Рядом в наброске: ${coparents.map(label).join(', ')} — их можно рассмотреть как второго родителя.` : '') +
          ' Ни одна связь не создана — подтвердите известные или укажите свои.',
        notes,
        hypothesisIds: hyps.map((h) => h.id),
        minRow: Math.min(...children.map((c) => c.span.top)),
      });
    }

    for (const s of sameQuestions) {
      const hasParent = s.hyps.some((h) => h.type === 'parent_child');
      questions.push({
        kind: 'same_person',
        sheet: sheetName,
        subjects: [s.a.key, s.b.key],
        candidates: (s.extraPersons || []).map((c) => c.key),
        title: `${label(s.a)} и ${label(s.b)}: один это человек или разные?`,
        prompt: 'Совпадают фамилия и имя.' + (hasParent ? ` Отчество ${quote(s.b.parse.patronymic)} допускает и другое прочтение: ${s.a.cell} может быть отцом ${s.b.cell}.` : '') +
          ' До вашего решения это две отдельные записи.',
        notes: ['Если это один человек, записи можно объединить — исходные ячейки при этом сохранятся.'],
        hypothesisIds: s.hyps.map((h) => h.id),
        minRow: Math.min(s.a.span.top, s.b.span.top),
      });
    }

    // Вопросы о парах: группируем по верхней записи.
    const byUpper = new Map();
    for (const ph of pairHyps) {
      if (!byUpper.has(ph.u.key)) byUpper.set(ph.u.key, []);
      byUpper.get(ph.u.key).push(ph);
    }
    for (const list of byUpper.values()) {
      const u = list[0].u;
      const lows = list.map((x) => x.l);
      const frame = list.map((x) => sameFrame(x.u, x.l)).find(Boolean);
      const title = lows.length === 1
        ? `Кем приходятся друг другу ${label(u)} и ${label(lows[0])}?`
        : `${label(u)}, ${lows.map(label).join(' и ')}: какие отношения между ними?`;
      questions.push({
        kind: 'pair',
        sheet: sheetName,
        subjects: [u.key, ...lows.map((l) => l.key)],
        candidates: [],
        title,
        prompt: `В наброске ${lows.length === 1 ? 'записи стоят' : 'записи стоят'} вплотную одна под другой${frame ? `, внутри рамки ${frame.ref}` : ''}. Это может означать пару, но может означать и другое родство — или ничего.`,
        notes: lows.length > 1 ? ['Каждое отношение указывается отдельно; несколько партнёрств допустимы.'] : [],
        hypothesisIds: list.map((x) => x.h.id),
        minRow: u.span.top,
      });
    }
  }

  // Подпись семьи и порядок вопросов.
  const recByKey = new Map(records.map((r) => [r.key, r]));
  const famOrder = new Map();
  for (const q of questions) {
    const subj = q.subjects.map((k) => recByKey.get(k));
    const counts = new Map();
    for (const r of subj) {
      const st = surnameStem(r.parse.surname);
      if (st) counts.set(st, (counts.get(st) || 0) + 1);
    }
    let best = null;
    for (const [st, n] of counts) {
      if (!best || n > best.n || (n === best.n && (surnameFreq.get(st) || 0) > (surnameFreq.get(best.st) || 0))) best = { st, n };
    }
    const rep = best ? records.find((r) => surnameStem(r.parse.surname) === best.st && !/(а|я)$/i.test(r.parse.surname)) || records.find((r) => surnameStem(r.parse.surname) === best.st) : null;
    q.family = rep ? familyLabel(rep.parse.surname) : 'Без фамилии';
    const minCol = Math.min(...records.filter((r) => best && surnameStem(r.parse.surname) === best.st).map((r) => r.col), 9999);
    if (!famOrder.has(q.family)) famOrder.set(q.family, minCol);
  }
  const kindOrder = { same_person: 0, pair: 1, parents: 2 };
  questions.sort((a, b) => famOrder.get(a.family) - famOrder.get(b.family) || a.minRow - b.minRow || kindOrder[a.kind] - kindOrder[b.kind]);
  questions.forEach((q, i) => {
    q.id = `q${i + 1}`;
    q.order = i + 1;
  });
  for (const q of questions) for (const id of q.hypothesisIds) {
    const h = hypotheses.find((x) => x.id === id);
    if (h && !h.questionId) h.questionId = q.id;
  }
  return { hypotheses, questions, parentCandidates };
}

// ---------- Необязательная проверка написания ----------

function buildNameReviews(records, parentCandidates) {
  const out = [];
  for (const r of records) {
    for (const field of ['surname', 'given_name', 'patronymic']) {
      const v = r.parse[field];
      if (!v) continue;
      const sug = doubleLetterSuggestion(v);
      if (sug) {
        out.push({
          code: 'double_letter',
          records: [r.key],
          message: `${quote(v)} (${r.cell}) — встречается также написание ${quote(sug)}. Исходное написание сохранено и меняется только по вашему решению.`,
          suggestion: { field, value: sug },
        });
      }
    }
    const sg = surnameGenderForm(r.parse.surname);
    const pg = patronymicGenderForm(r.parse.patronymic);
    if (sg && pg && sg !== pg) {
      out.push({
        code: 'gender_form',
        records: [r.key],
        message: `${quote(r.text)} (${r.cell}): фамилия ${quote(r.parse.surname)} записана в ${sg === 'm' ? 'мужской' : 'женской'} форме, а отчество ${quote(r.parse.patronymic)} — в ${pg === 'm' ? 'мужской' : 'женской'}. Проверьте написание; пол автоматически не определяется.`,
        suggestion: null,
      });
    }
  }
  // Разное написание отчеств, предположительно образованных от одного имени.
  const byParent = new Map();
  for (const r of records) {
    for (const pk of parentCandidates.get(r.key) || []) {
      if (!byParent.has(pk)) byParent.set(pk, []);
      byParent.get(pk).push(r);
    }
  }
  const seen = new Set();
  const recByKey = new Map(records.map((r) => [r.key, r]));
  for (const [pk, kids] of byParent) {
    const parent = recByKey.get(pk);
    const forms = new Map();
    for (const k of kids) {
      const base = lowerNoYo(k.parse.patronymic).replace(/(ич|на)$/, '');
      if (!forms.has(base)) forms.set(base, []);
      forms.get(base).push(k);
    }
    if (forms.size < 2) continue;
    const keySet = kids.map((k) => k.key).sort().join('|');
    if (seen.has(keySet)) continue;
    seen.add(keySet);
    out.push({
      code: 'patronymic_variants',
      records: kids.map((k) => k.key),
      message: `Отчества, которые могут происходить от имени ${quote(parent.parse.given_name)}, записаны по-разному: ${kids.map((k) => `${quote(k.parse.patronymic)} (${k.cell})`).join(', ')}. Это может быть разным написанием или разными людьми.`,
      suggestion: null,
    });
  }
  return out;
}

// ---------- Сводка проверок для предпросмотра ----------

function buildChecks(sheets, records, skipped, geometry) {
  const checks = [];
  const visible = sheets.filter((s) => s.state === 'visible');
  const hidden = sheets.filter((s) => s.state !== 'visible');
  checks.push({
    code: 'sheets',
    level: 'info',
    text: `Листов в книге: ${sheets.length} (${sheets.map((s) => `${quote(s.name)} — ${s.state === 'visible' ? 'видимый' : s.state === 'hidden' ? 'скрытый' : 'очень скрытый'}`).join(', ')}).`,
  });
  if (hidden.length) checks.push({ code: 'hidden', level: 'warn', text: `Скрытые листы не импортируются по умолчанию: ${hidden.map((s) => quote(s.name)).join(', ')}.` });
  checks.push({ code: 'records', level: records.length ? 'ok' : 'warn', text: `Найдено записей с именами: ${records.length}.` });
  for (const s of visible) {
    const g = geometry[s.name];
    if (!g) continue;
    if (s.declaredDimension) checks.push({ code: 'dimension', level: 'info', text: `${quote(s.name)}: заявленная область листа ${s.declaredDimension}; записи занимают ${g.columns.length ? `${g.columns[0].letter}${g.minRow}:${g.columns[g.columns.length - 1].letter}${g.maxRow}` : '—'}.` });
    if (g.merges.length) checks.push({ code: 'merges', level: 'ok', text: `Объединённые диапазоны (${g.merges.length}): ${g.merges.map((m) => m.ref).join(', ')} — каждый прочитан один раз по основной ячейке.` });
    const emptyB = g.borderedCells.filter((c) => c.empty);
    const emptyOutside = emptyB.filter((c) => !c.inMerge);
    if (emptyB.length) checks.push({ code: 'borders', level: 'info', text: `Пустых ячеек с границами: ${emptyB.length} (вне объединений: ${emptyOutside.map((c) => c.ref).join(', ') || 'нет'}). Они учтены в схеме и не создают записей.` });
    if (g.frames.length) checks.push({ code: 'frames', level: 'info', text: `Рамки из границ: ${g.frames.map((f) => `${f.ref}${f.complete ? '' : ' (неполная)'}`).join(', ')}. Рамка — оформление, а не подтверждение родства.` });
    if (g.emptyRows.length) checks.push({ code: 'empty_rows', level: 'info', text: `Пустые строки между записями: ${g.emptyRows.join(', ')}.` });
    if (s.formulas || s.comments || s.tables || s.drawing.anchors) {
      checks.push({ code: 'objects', level: 'warn', text: `Дополнительные объекты: формул ${s.formulas}, комментариев ${s.comments}, таблиц ${s.tables}, рисунков ${s.drawing.anchors} (соединителей ${s.drawing.connectors}). Они не используются как подтверждение связей.` });
    } else {
      checks.push({ code: 'objects', level: 'ok', text: 'Формул, комментариев, таблиц Excel, рисунков и графических соединителей нет.' });
    }
  }
  const trailing = records.filter((r) => r.trailingSpaces > 0);
  if (trailing.length) checks.push({ code: 'spaces', level: 'info', text: `Значения с пробелами в конце: ${trailing.length}${trailing.some((r) => r.trailingSpaces > 1) ? ` (в том числе с несколькими пробелами: ${trailing.filter((r) => r.trailingSpaces > 1).map((r) => r.cell).join(', ')})` : ''}. Исходные строки сохраняются полностью, в отображаемом имени пробелы по краям убраны.` });
  checks.push({ code: 'no_header', level: 'info', text: 'Строка заголовков не определяется: каждая непустая ячейка считается отдельной записью, строки и столбцы — не поколениями и не семьями.' });
  if (skipped.length) checks.push({ code: 'skipped', level: 'warn', text: `Пропущено ячеек: ${skipped.length} — ${skipped.slice(0, 5).map((s) => `${s.cell}: ${s.reason}`).join('; ')}${skipped.length > 5 ? '…' : ''}.` });
  const keys = new Set(records.map((r) => r.key));
  if (keys.size !== records.length) checks.push({ code: 'dup_keys', level: 'error', text: 'Обнаружены повторяющиеся координаты записей.' });
  return checks;
}
