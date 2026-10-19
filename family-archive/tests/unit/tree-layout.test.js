// Раскладка «Семейного древа» на ВЫМЫШЛЕННЫХ семьях: партнёры стоят рядом, значок пары — между ними,
// линии разных семей не сливаются и не проходят сквозь чужие карточки, ни одна связь не теряется.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Ширина текста для расчёта высоты карточек (в браузере — canvas).
globalThis.document ??= { createElement: () => ({ getContext: () => ({ font: '', measureText: (t) => ({ width: String(t).length * 8 }) }) }) };
const { buildTree, NODE_W } = await import('../../client/src/lib/graph.js');

function builder() {
  const data = { persons: [], parentChild: [], partnerships: [], sourceRecords: [], hypotheses: [] };
  const p = (id, surname, given) => data.persons.push({ id, surname, given_name: given, display_name: `${surname} ${given}` });
  const pc = (parent, child, kind = 'biological') => data.parentChild.push({ id: `pc-${parent}-${child}`, parent_id: parent, child_id: child, kind });
  const pt = (a, b, status = 'ongoing', id = `pt-${a}-${b}`) => data.partnerships.push({ id, person1_id: a, person2_id: b, kind: 'marriage', status });
  return { data, p, pc, pt };
}

function family() {
  const { data, p, pc, pt } = builder();
  p('ivan', 'Старов', 'Иван'); p('anna', 'Старова', 'Анна'); pt('ivan', 'anna');
  p('petr', 'Белов', 'Пётр'); p('maria', 'Белова', 'Мария'); pt('petr', 'maria');
  p('semen', 'Кравцов', 'Семён');
  p('olga', 'Старова', 'Ольга'); pc('ivan', 'olga'); pc('anna', 'olga');
  p('nina', 'Белова', 'Нина'); pc('petr', 'nina'); pc('maria', 'nina');
  p('vera', 'Белова', 'Вера'); pc('petr', 'vera'); pc('maria', 'vera');
  p('oleg', 'Кравцов', 'Олег'); pc('semen', 'oleg');
  pt('oleg', 'olga');
  p('timur', 'Ахметов', 'Тимур'); pt('timur', 'nina');
  p('gogi', 'Давиташвили', 'Гоги'); pt('vera', 'gogi');
  p('roman', 'Зуев', 'Роман'); p('lida', 'Кох', 'Лидия');
  p('alla', 'Кравцова', 'Алла'); pc('oleg', 'alla'); pc('olga', 'alla');
  p('irina', 'Ахметова', 'Ирина'); pc('timur', 'irina'); pc('nina', 'irina');
  p('maya', 'Давиташвили', 'Майя'); pc('vera', 'maya'); pc('gogi', 'maya');
  p('ksenia', 'Зуева', 'Ксения'); pc('roman', 'ksenia'); pc('lida', 'ksenia'); // двое родителей без партнёрства
  p('misha', 'Кузин', 'Михаил');
  pt('misha', 'alla', 'divorced'); pt('misha', 'irina'); // два партнёра
  p('georgy', 'Чхеидзе', 'Георгий'); pt('maya', 'georgy');
  p('luka', 'Кузин', 'Лука'); pc('misha', 'luka'); pc('alla', 'luka');
  p('david', 'Кузин', 'Давид'); pc('misha', 'david'); pc('alla', 'david');
  p('eva', 'Кузина', 'Ева'); pc('misha', 'eva'); pc('irina', 'eva');
  p('pata', 'Чхеидзе', 'Пата'); pc('maya', 'pata'); pc('georgy', 'pata');
  // Три партнёра — не все пары могут стоять рядом.
  p('viktor', 'Ланской', 'Виктор');
  for (const [w, c] of [['w1', 'c1'], ['w2', 'c2'], ['w3', 'c3']]) {
    p(w, 'Ланская', w.toUpperCase());
    pt('viktor', w, w === 'w3' ? 'ongoing' : 'divorced');
    p(c, 'Ланской', c.toUpperCase()); pc('viktor', c); pc(w, c);
  }
  // Родные и приёмные родители (две пары у одного ребёнка).
  p('bd', 'Родной', 'Отец'); p('bm', 'Родная', 'Мать'); pt('bd', 'bm', 'divorced');
  p('ad', 'Приёмный', 'Отец'); p('am', 'Приёмная', 'Мать'); pt('ad', 'am');
  p('kid', 'Найдёнов', 'Ребёнок'); pc('bd', 'kid'); pc('bm', 'kid'); pc('ad', 'kid', 'adoptive'); pc('am', 'kid', 'adoptive');
  // Две записи партнёрства у одной пары (брак, развод и снова брак).
  p('rem1', 'Повторов', 'Муж'); p('rem2', 'Повторова', 'Жена');
  pt('rem1', 'rem2', 'divorced', 'pt-rem-a'); pt('rem1', 'rem2', 'ongoing', 'pt-rem-b');
  p('remkid', 'Повторов', 'Сын'); pc('rem1', 'remkid'); pc('rem2', 'remkid');
  p('lonely', 'Одинокова', 'Зоя'); // без связей — отдельной сеткой
  return data;
}

// Запутанные данные: «сам себе дедушка» и брак с дочерью партнёрши.
function tangled() {
  const { data, p, pc, pt } = builder();
  p('x', 'Икс', 'Отец'); p('xw', 'Икс', 'Мать'); pt('x', 'xw', 'ended');
  p('w', 'Вэ', 'Отец'); p('wx', 'Вэ', 'Мать'); pt('w', 'wx', 'ended');
  p('z', 'Икс', 'Сын'); pc('x', 'z'); pc('xw', 'z');
  p('y', 'Вэ', 'Дочь'); pc('w', 'y'); pc('wx', 'y');
  pt('x', 'y'); pt('z', 'w');
  p('m', 'Эм', 'Муж'); p('mw', 'Эм', 'Жена'); pt('m', 'mw', 'divorced');
  p('md', 'Эм', 'Дочь жены'); pc('mw', 'md'); pt('m', 'md');
  return data;
}

function indexOf(data) {
  const byId = new Map(data.persons.map((x) => [x.id, x]));
  const parentsOf = new Map();
  const childrenOf = new Map();
  for (const r of data.parentChild) {
    if (!parentsOf.has(r.child_id)) parentsOf.set(r.child_id, []);
    parentsOf.get(r.child_id).push(r);
    if (!childrenOf.has(r.parent_id)) childrenOf.set(r.parent_id, []);
    childrenOf.get(r.parent_id).push(r);
  }
  const partnersOf = new Map();
  for (const r of data.partnerships) for (const pid of [r.person1_id, r.person2_id]) {
    if (!partnersOf.has(pid)) partnersOf.set(pid, []);
    partnersOf.get(pid).push(r);
  }
  return { byId, parentsOf, childrenOf, partnersOf, recordsByPerson: new Map() };
}

function layoutOf(data, big) {
  const layout = buildTree({ data, index: indexOf(data), scope: 'all', centerId: null, collapsedDown: new Set(), collapsedUp: new Set(), big });
  const node = new Map(layout.nodes.map((n) => [n.id, n]));
  const box = (id) => {
    const n = node.get(id);
    const w = n.type === 'union' ? 26 : n.data.width;
    const h = n.type === 'union' ? 26 : n.data.height;
    return { x: n.position.x, y: n.position.y, w, h, cx: n.position.x + w / 2, cy: n.position.y + h / 2 };
  };
  // Точки линии к ребёнку, как их рисует холст (начало — низ значка или карточки, конец — верх карточки).
  const pathOf = (e) => {
    const s = box(e.source);
    const t = box(e.target);
    const pts = e.data.points.map((q) => [...q]);
    pts[0] = [s.cx, s.y + s.h];
    pts[1][0] = s.cx;
    pts[pts.length - 2][0] = t.cx + (e.data.tdx || 0);
    pts[pts.length - 1] = [t.cx + (e.data.tdx || 0), t.y];
    return pts;
  };
  return { layout, node, box, pathOf };
}

const segmentsOf = (pts) => pts.slice(1).map((q, i) => ({ x1: pts[i][0], y1: pts[i][1], x2: q[0], y2: q[1] }));

for (const big of [false, true]) {
  test(`древо${big ? ' (крупные карточки)' : ''}: пары рядом, линии семей не сливаются и не теряются`, () => {
    const data = family();
    const { layout, node, box, pathOf } = layoutOf(data, big);
    const W = layout.nodes.find((n) => n.type === 'person').data.width;
    if (!big) assert.equal(W, NODE_W);
    for (const n of layout.nodes) assert.ok(Number.isFinite(n.position.x) && Number.isFinite(n.position.y), `координаты ${n.id}`);
    for (const e of layout.edges) assert.ok(node.has(e.source) && node.has(e.target), `линия ${e.id} ведёт к существующим узлам`);
    // Ни одна связь не потеряна (в том числе у ребёнка с родными и приёмными родителями).
    const drawn = new Set(layout.edges.filter((e) => e.type === 'parent').flatMap((e) => e.data.rels.map((r) => r.id)));
    for (const r of data.parentChild) assert.ok(drawn.has(r.id), `связь ${r.parent_id} → ${r.child_id} нарисована`);
    assert.ok(layout.edges.some((e) => e.source === 'u:pt-ad-am' && e.target === 'kid'), 'линия от приёмных родителей');
    // Пары рядом: на одной высоте, вплотную через промежуток со значком.
    for (const [a, b] of [['ivan', 'anna'], ['petr', 'maria'], ['oleg', 'olga'], ['timur', 'nina'], ['vera', 'gogi'], ['maya', 'georgy'], ['roman', 'lida'], ['misha', 'alla'], ['misha', 'irina'], ['viktor', 'w3']]) {
      const ca = box(a);
      const cb = box(b);
      assert.ok(Math.abs(ca.cy - cb.cy) < 0.5, `${a}–${b} на одной высоте`);
      const gap = Math.abs(ca.cx - cb.cx) - W;
      assert.ok(gap > 20 && gap < 60, `${a}–${b} стоят рядом (промежуток ${gap.toFixed(0)})`);
    }
    // Значок пары — между партнёрами, на середине карточек.
    const u = box('u:pt-misha-irina');
    const [l, r] = [box('misha'), box('irina')].sort((x, y) => x.cx - y.cx);
    assert.ok(u.cx > l.x + W && u.cx < r.x && Math.abs(u.cy - l.cy) < 0.5, 'значок между партнёрами');
    // Человек с двумя партнёрами — между ними.
    const xs = ['alla', 'misha', 'irina'].map((id) => box(id).cx);
    assert.ok((xs[1] - xs[0]) * (xs[2] - xs[1]) > 0, 'Михаил между Аллой и Ириной');
    // Двое родителей без партнёрства — рядом, с точкой между ними.
    assert.ok(node.has('c:lida|roman') && layout.edges.some((e) => e.type === 'coparent'));
    // Значок пары, которая не стоит рядом, — не под чужой карточкой.
    const persons = layout.nodes.filter((n) => n.type === 'person');
    for (const e of layout.edges.filter((x) => x.type === 'pairLane')) {
      const ub = box(e.target);
      for (const pn of persons) {
        const pb = box(pn.id);
        if (ub.y < pb.y + pb.h + 40 && ub.y > pb.y) assert.ok(ub.cx < pb.x - 1 || ub.cx > pb.x + pb.w + 1, `значок ${e.target} под карточкой ${pn.id}`);
      }
    }
    // Две записи партнёрства одной пары: линии только у основной.
    assert.equal(layout.edges.filter((e) => e.type === 'partner' && (e.source === 'u:pt-rem-a' || e.target === 'u:pt-rem-a')).length, 0);
    assert.equal(layout.edges.filter((e) => e.type === 'partner' && (e.source === 'u:pt-rem-b' || e.target === 'u:pt-rem-b')).length, 2);
    // Дети ниже родителей.
    for (const rel of data.parentChild) {
      const par = box(rel.parent_id);
      const ch = box(rel.child_id);
      assert.ok(ch.y > par.y + par.h, `${rel.child_id} ниже ${rel.parent_id}`);
    }
    const parentEdges = layout.edges.filter((e) => e.type === 'parent');
    const paths = parentEdges.map((e) => ({ e, pts: pathOf(e) }));
    // Горизонтальные участки: у разных семей на одном уровне не перекрываются.
    const horiz = paths.flatMap(({ e, pts }) => segmentsOf(pts).filter((s) => Math.abs(s.y1 - s.y2) < 0.5 && Math.abs(s.x1 - s.x2) > 0.5).map((s) => ({ src: e.source, y: s.y1, from: Math.min(s.x1, s.x2), to: Math.max(s.x1, s.x2) })));
    for (let i = 0; i < horiz.length; i++) {
      for (let j = i + 1; j < horiz.length; j++) {
        const a = horiz[i];
        const b = horiz[j];
        if (a.src === b.src || Math.abs(a.y - b.y) > 0.5) continue;
        assert.ok(a.to <= b.from + 1 || b.to <= a.from + 1, `линии семей ${a.src} и ${b.src} сливаются на уровне ${a.y}`);
      }
    }
    // Линии не проходят сквозь чужие карточки.
    for (const { e, pts } of paths) {
      for (const s of segmentsOf(pts)) {
        for (const pn of persons) {
          if (pn.id === e.target || pn.id === e.source) continue;
          const pb = box(pn.id);
          const vert = Math.abs(s.x1 - s.x2) < 0.5;
          const hit = vert
            ? s.x1 > pb.x + 1 && s.x1 < pb.x + pb.w - 1 && Math.max(s.y1, s.y2) > pb.y + 1 && Math.min(s.y1, s.y2) < pb.y + pb.h - 1
            : s.y1 > pb.y + 1 && s.y1 < pb.y + pb.h - 1 && Math.max(s.x1, s.x2) > pb.x + 1 && Math.min(s.x1, s.x2) < pb.x + pb.w - 1;
          assert.ok(!hit, `линия ${e.id} проходит сквозь карточку ${pn.id}`);
        }
      }
    }
    // Спуск от одной пары не продолжает вход в карточку ребёнка другой пары (на одной прямой).
    for (const a of paths) {
      const drop = { x: a.pts[0][0], y2: a.pts[1][1] };
      for (const b of paths) {
        if (a.e.source === b.e.source) continue;
        const n = b.pts.length;
        const entry = { x: b.pts[n - 1][0], y1: b.pts[n - 2][1], y2: b.pts[n - 1][1] };
        const sameGap = drop.y2 < entry.y2 && drop.y2 > entry.y1 - 60;
        assert.ok(!sameGap || Math.abs(drop.x - entry.x) >= 6, `спуск ${a.e.source} на одной прямой со входом в ${b.e.target}`);
      }
    }
    assert.equal(node.get('lonely').data.isolated, true);
  });
}

test('запутанные данные: дети всё равно ниже родителей, линии не уходят вверх', () => {
  for (const big of [false, true]) {
    const data = tangled();
    const { layout, box } = layoutOf(data, big);
    for (const rel of data.parentChild) {
      assert.ok(box(rel.child_id).y > box(rel.parent_id).y + box(rel.parent_id).h, `${rel.child_id} ниже ${rel.parent_id}`);
    }
    for (const pr of data.partnerships) {
      const u = `u:${pr.id}`;
      assert.ok(layout.nodes.some((n) => n.id === u), `значок пары ${pr.id}`);
      assert.equal(layout.edges.filter((e) => e.source === u || e.target === u).filter((e) => e.type !== 'parent').length, 2, `две линии пары ${pr.id}`);
    }
  }
});
