// Раскладка «Семейного древа» на ВЫМЫШЛЕННОЙ семье: партнёры стоят рядом, значок пары — между ними,
// линии разных семей не сливаются (горизонтальные участки не накладываются на одном уровне).
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Ширина текста для расчёта высоты карточек (в браузере — canvas).
globalThis.document ??= { createElement: () => ({ getContext: () => ({ font: '', measureText: (t) => ({ width: String(t).length * 8 }) }) }) };
const { buildTree, NODE_W } = await import('../../client/src/lib/graph.js');

function family() {
  const persons = [];
  const parentChild = [];
  const partnerships = [];
  const p = (id, surname, given) => persons.push({ id, surname, given_name: given, display_name: `${surname} ${given}` });
  const pc = (parent, child) => parentChild.push({ id: `pc-${parent}-${child}`, parent_id: parent, child_id: child, kind: 'biological' });
  const pt = (a, b, status = 'ongoing') => partnerships.push({ id: `pt-${a}-${b}`, person1_id: a, person2_id: b, kind: 'marriage', status });
  // Первое поколение
  p('ivan', 'Старов', 'Иван'); p('anna', 'Старова', 'Анна'); pt('ivan', 'anna');
  p('petr', 'Белов', 'Пётр'); p('maria', 'Белова', 'Мария'); pt('petr', 'maria');
  p('semen', 'Кравцов', 'Семён');
  // Второе
  p('olga', 'Старова', 'Ольга'); pc('ivan', 'olga'); pc('anna', 'olga');
  p('nina', 'Белова', 'Нина'); pc('petr', 'nina'); pc('maria', 'nina');
  p('vera', 'Белова', 'Вера'); pc('petr', 'vera'); pc('maria', 'vera');
  p('oleg', 'Кравцов', 'Олег'); pc('semen', 'oleg');
  pt('oleg', 'olga');
  p('timur', 'Ахметов', 'Тимур'); pt('timur', 'nina');
  p('gogi', 'Давиташвили', 'Гоги'); pt('vera', 'gogi');
  p('roman', 'Зуев', 'Роман'); p('lida', 'Кох', 'Лидия');
  // Третье
  p('alla', 'Кравцова', 'Алла'); pc('oleg', 'alla'); pc('olga', 'alla');
  p('irina', 'Ахметова', 'Ирина'); pc('timur', 'irina'); pc('nina', 'irina');
  p('maya', 'Давиташвили', 'Майя'); pc('vera', 'maya'); pc('gogi', 'maya');
  p('ksenia', 'Зуева', 'Ксения'); pc('roman', 'ksenia'); pc('lida', 'ksenia'); // двое родителей без партнёрства
  p('misha', 'Кузин', 'Михаил');
  pt('misha', 'alla', 'divorced'); pt('misha', 'irina'); // два партнёра
  p('georgy', 'Чхеидзе', 'Георгий'); pt('maya', 'georgy');
  // Четвёртое
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
  p('lonely', 'Одинокова', 'Зоя'); // без связей — отдельной сеткой
  return { persons, parentChild, partnerships, sourceRecords: [], hypotheses: [] };
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

for (const big of [false, true]) {
  test(`древо${big ? ' (крупные карточки)' : ''}: пары рядом, линии семей не сливаются`, () => {
    const data = family();
    const layout = buildTree({ data, index: indexOf(data), scope: 'all', centerId: null, collapsedDown: new Set(), collapsedUp: new Set(), big });
    const node = new Map(layout.nodes.map((n) => [n.id, n]));
    const W = layout.nodes.find((n) => n.type === 'person').data.width;
    if (!big) assert.equal(W, NODE_W);
    for (const n of layout.nodes) assert.ok(Number.isFinite(n.position.x) && Number.isFinite(n.position.y), `координаты ${n.id}`);
    for (const e of layout.edges) assert.ok(node.has(e.source) && node.has(e.target), `линия ${e.id} ведёт к существующим узлам`);
    const center = (id) => {
      const n = node.get(id);
      return n.type === 'union' ? { x: n.position.x + 13, y: n.position.y + 13 } : { x: n.position.x + n.data.width / 2, y: n.position.y + n.data.height / 2 };
    };
    // Пары рядом: на одной высоте, вплотную через промежуток со значком.
    for (const [a, b] of [['ivan', 'anna'], ['petr', 'maria'], ['oleg', 'olga'], ['timur', 'nina'], ['vera', 'gogi'], ['maya', 'georgy'], ['roman', 'lida'], ['misha', 'alla'], ['misha', 'irina']]) {
      const ca = center(a);
      const cb = center(b);
      assert.ok(Math.abs(ca.y - cb.y) < 0.5, `${a}–${b} на одной высоте`);
      const gap = Math.abs(ca.x - cb.x) - W;
      assert.ok(gap > 20 && gap < 60, `${a}–${b} стоят рядом (промежуток ${gap.toFixed(0)})`);
    }
    // Значок пары — между партнёрами, на середине карточек.
    const u = center('u:pt-misha-irina');
    const [l, r] = [center('misha'), center('irina')].sort((x, y) => x.x - y.x);
    assert.ok(u.x > l.x + W / 2 && u.x < r.x - W / 2 && Math.abs(u.y - l.y) < 0.5, 'значок между партнёрами');
    // Человек с двумя партнёрами — между ними.
    const xs = ['alla', 'misha', 'irina'].map((id) => center(id).x);
    assert.ok((xs[1] - xs[0]) * (xs[2] - xs[1]) > 0, 'Михаил между Аллой и Ириной');
    // Двое родителей без партнёрства — рядом, с точкой между ними.
    assert.ok(node.has('c:lida|roman') && layout.edges.some((e) => e.type === 'coparent'));
    // Дети ниже родителей.
    for (const rel of data.parentChild) {
      const par = node.get(rel.parent_id);
      const ch = node.get(rel.child_id);
      assert.ok(ch.position.y > par.position.y + par.data.height, `${rel.child_id} ниже ${rel.parent_id}`);
    }
    // Горизонтальные участки линий к детям: у разных семей на одном уровне не перекрываются.
    const segs = layout.edges.filter((e) => e.type === 'parent').map((e) => {
      const s = center(e.source);
      const t = center(e.target);
      return { src: e.source, y: e.data.busY, from: Math.min(s.x, t.x), to: Math.max(s.x, t.x) };
    });
    for (const s of segs) assert.ok(Number.isFinite(s.y), 'у линии есть свой уровень');
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const a = segs[i];
        const b = segs[j];
        if (a.src === b.src || Math.abs(a.y - b.y) > 0.5) continue;
        assert.ok(a.to <= b.from + 1 || b.to <= a.from + 1, `линии семей ${a.src} и ${b.src} сливаются на уровне ${a.y}`);
      }
    }
    // Уровни линий — между поколениями: ниже карточек родителей и выше карточек детей.
    for (const e of layout.edges.filter((x) => x.type === 'parent')) {
      const src = node.get(e.source);
      const srcBottom = src.type === 'union' ? src.position.y + 26 : src.position.y + src.data.height;
      assert.ok(e.data.busY > srcBottom && e.data.busY < node.get(e.target).position.y, `уровень линии ${e.id} между поколениями`);
    }
    // Без связей — отдельно.
    assert.equal(node.get('lonely').data.isolated, true);
  });
}
