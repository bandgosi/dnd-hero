// Построение узлов и линий для холста.
// «Семейное древо» — только подтверждённые связи (раскладка dagre).
// «Исходная схема Excel» — положение записей по ячейкам, без домысливания родства.
// Предположения добавляются отдельными пунктирными линиями и не влияют на раскладку.
import dagre from '@dagrejs/dagre';
import { splitName, lifeSpan } from './format.js';

export const NODE_W = 260;
const AVATAR = 48;
const PAD = 14;
const NAME_FONT = '600 15px "Manrope Variable", "Segoe UI", system-ui, sans-serif';
// Крупные карточки полноэкранного просмотра: узкие, фото сверху, имя крупно по центру.
// Числа совпадают со стилями .pnode-big в styles.css.
export const BIG = { width: 200, avatar: 64, padY: 12, padX: 12, gap: 8, nameLine: 23, metaLine: 22, chipLine: 18.2, chipLines: 3, chipFont: '600 14px "Manrope Variable", "Segoe UI", system-ui, sans-serif', font: '600 18px "Manrope Variable", "Segoe UI", system-ui, sans-serif' };
// На крупной карточке длинная подпись дальнего родства сокращается (путь виден в карточке человека).
export const shortKin = (label) => (label && label.startsWith('Родственник по подтверждённым связям') ? 'Дальний родственник' : label);

let ctx = null;
function measure(text, font = NAME_FONT) {
  if (!ctx) {
    const c = document.createElement('canvas');
    ctx = c.getContext('2d');
  }
  ctx.font = font;
  return ctx.measureText(text).width;
}

export function countLines(text, maxWidth, font = NAME_FONT) {
  if (!text) return 0;
  const words = text.split(/\s+/).filter(Boolean);
  let lines = 1;
  let cur = 0;
  const space = measure(' ', font);
  for (const w of words) {
    const ww = measure(w, font);
    if (cur === 0) {
      cur = ww;
      lines += Math.floor(ww / maxWidth);
      if (ww > maxWidth) cur = ww % maxWidth;
    } else if (cur + space + ww <= maxWidth) cur += space + ww;
    else {
      lines += 1;
      cur = ww;
    }
  }
  return lines;
}

const CHIP_FONT = '600 13px "Manrope Variable", "Segoe UI", system-ui, sans-serif';
// Высота обычной карточки (как в стилях .pnode): рамка 2 px, поля 14 px, имя по строкам (20 px), годы
// жизни (13 px × 1,5 + отступ 4), отметки (отступ 4 + 2, строка 16,9 px, не больше трёх строк). chip —
// true (одна строка) или текст отметки.
export function nodeHeight(person, width = NODE_W, { meta = true, chip = true } = {}) {
  const textW = width - PAD * 2 - 2 - AVATAR - 12;
  const [a, b] = splitName(person);
  const lines = countLines(a, textW) + countLines(b, textW);
  const chipLines = !chip ? 0 : chip === true ? 1 : Math.min(3, Math.max(1, countLines(shortKin(chip), textW - 16, CHIP_FONT)));
  const body = lines * 20 + (meta ? 23.5 : 0) + (chip ? 6 + Math.max(24, chipLines * 16.9 + 4) : 0);
  return Math.ceil(2 + PAD * 2 + Math.max(AVATAR, body));
}

// Высота крупной карточки: фото, имя (по строкам), годы жизни — если известны, отметка родства
// (её текст может занять несколько строк) — если выбран центр.
export function bigNodeHeight(person, { chip = null } = {}) {
  const textW = BIG.width - BIG.padX * 2 - 4;
  const [a, b] = splitName(person);
  const lines = Math.max(1, countLines(a, textW, BIG.font) + countLines(b, textW, BIG.font));
  const chipLines = chip ? Math.min(BIG.chipLines, countLines(shortKin(chip), textW - 16, BIG.chipFont)) : 0;
  const chipH = chip ? Math.max(24, Math.ceil(chipLines * BIG.chipLine + 4)) + 4 : 0;
  // + 2 px — рамка карточки (входит в высоту).
  const h = 2 + BIG.padY * 2 + BIG.avatar + BIG.gap + lines * BIG.nameLine + (lifeSpan(person) ? BIG.metaLine + 4 : 0) + chipH;
  return Math.ceil(h);
}

// ---------- Обход подтверждённых связей ----------

function collect(start, step) {
  const out = new Set();
  const stack = [...step(start)];
  while (stack.length) {
    const id = stack.pop();
    if (out.has(id) || id === start) continue;
    out.add(id);
    stack.push(...step(id));
  }
  return out;
}
export const ancestors = (id, index) => collect(id, (x) => (index.parentsOf.get(x) || []).map((r) => r.parent_id));
export const descendants = (id, index) => collect(id, (x) => (index.childrenOf.get(x) || []).map((r) => r.child_id));
const partnersIds = (id, index) => (index.partnersOf.get(id) || []).map((r) => (r.person1_id === id ? r.person2_id : r.person1_id));
const relNeighbors = (id, index) => [
  ...(index.parentsOf.get(id) || []).map((r) => r.parent_id),
  ...(index.childrenOf.get(id) || []).map((r) => r.child_id),
  ...partnersIds(id, index),
];
export function component(id, index) {
  const s = collect(id, (x) => relNeighbors(x, index));
  s.add(id);
  return s;
}
export function siblings(id, index) {
  const out = new Set();
  for (const r of index.parentsOf.get(id) || []) for (const c of index.childrenOf.get(r.parent_id) || []) if (c.child_id !== id) out.add(c.child_id);
  return out;
}

export function scopeSet(scope, centerId, data, index) {
  const all = new Set(data.persons.map((p) => p.id));
  if (!centerId || !index.byId.has(centerId) || scope === 'all') return all;
  if (scope === 'family') return component(centerId, index);
  const s = new Set([centerId]);
  if (scope === 'ancestors') for (const a of ancestors(centerId, index)) s.add(a);
  if (scope === 'descendants') {
    for (const d of descendants(centerId, index)) s.add(d);
    for (const id of [...s]) for (const p of partnersIds(id, index)) s.add(p);
  }
  if (scope === 'close') {
    for (const r of index.parentsOf.get(centerId) || []) s.add(r.parent_id);
    for (const r of index.childrenOf.get(centerId) || []) s.add(r.child_id);
    for (const p of partnersIds(centerId, index)) s.add(p);
    for (const x of siblings(centerId, index)) s.add(x);
  }
  return s;
}

// ---------- Семейное древо ----------

export function buildTree({ data, index, scope, centerId, collapsedDown, collapsedUp, big = false, kinLabel = () => null, gridBox = null }) {
  const W = big ? BIG.width : NODE_W;
  // Высота карточки — по тому, что на ней будет: годы жизни, отметка родства или «Из Excel».
  const heightOf = (id) => {
    const p = index.byId.get(id);
    if (big) return bigNodeHeight(p, { chip: kinLabel(id) });
    const chip = kinLabel(id) || (index.recordsByPerson.get(id)?.some((r) => r.status === 'active') ? 'Из Excel' : null);
    return nodeHeight(p, W, { meta: !!lifeSpan(p), chip });
  };
  const GAP = big ? 20 : 28;
  const included = scopeSet(scope, centerId, data, index);
  // Свёрнутые ветви.
  const hidden = new Set();
  for (const x of collapsedDown) if (included.has(x)) for (const d of descendants(x, index)) hidden.add(d);
  for (const x of collapsedUp) if (included.has(x)) for (const a of ancestors(x, index)) hidden.add(a);
  for (const x of [...collapsedDown, ...collapsedUp]) hidden.delete(x);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of included) {
      if (hidden.has(id) || collapsedDown.has(id) || collapsedUp.has(id)) continue;
      const ns = relNeighbors(id, index).filter((n) => included.has(n));
      if (ns.length && ns.every((n) => hidden.has(n))) {
        hidden.add(id);
        changed = true;
      }
    }
  }
  const visible = new Set([...included].filter((id) => !hidden.has(id)));
  const hasEdge = new Set();
  const edges = [];
  // Пары: партнёрство (значок с кольцами) или двое родителей общего ребёнка без указанного
  // партнёрства (точка). Пара стоит рядом в одной «семейной строке», значок — между ними.
  const pairs = new Map(); // ключ «a|b» → { a, b, kind, unions: [{ id, partnership }], priority }
  const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const partnerOf = new Map();
  for (const p of data.partnerships) {
    if (!visible.has(p.person1_id) || !visible.has(p.person2_id) || p.person1_id === p.person2_id) continue;
    const key = pairKey(p.person1_id, p.person2_id);
    const u = `u:${p.id}`;
    if (!pairs.has(key)) pairs.set(key, { a: p.person1_id, b: p.person2_id, kind: 'partnership', unions: [], priority: 2 });
    const pr = pairs.get(key);
    pr.unions.push({ id: u, partnership: p });
    if (p.status === 'ongoing') pr.priority = 3;
    hasEdge.add(p.person1_id);
    hasEdge.add(p.person2_id);
    if (!partnerOf.has(key) || p.status === 'ongoing' || p.kind === 'marriage') partnerOf.set(key, u);
  }
  // Значок пары с линиями — у основного партнёрства (к нему относятся дети), остальные записи той же
  // пары — значками рядом, без своих линий.
  for (const [key, pr] of pairs) {
    if (pr.kind !== 'partnership') continue;
    const main = partnerOf.get(key);
    pr.unions.sort((x, y) => (x.id === main ? -1 : y.id === main ? 1 : 0));
  }
  // Линии к детям: от значка пары, от точки двух родителей или от единственного родителя.
  const families = new Map(); // источник → { source, kind: 'union'|'person', children: [{ child, rels }] }
  const addChild = (source, kind, child, rels) => {
    if (!families.has(source)) families.set(source, { source, kind, children: [] });
    families.get(source).children.push({ child, rels });
  };
  for (const c of visible) {
    const parents = (index.parentsOf.get(c) || []).filter((r) => visible.has(r.parent_id));
    if (!parents.length) continue;
    hasEdge.add(c);
    let remaining = [...parents];
    // Пары родителей-партнёров (их может быть две: родные и приёмные).
    for (let i = 0; i < remaining.length && remaining.length >= 2; i++) {
      for (let j = i + 1; j < remaining.length; j++) {
        const u = partnerOf.get(pairKey(remaining[i].parent_id, remaining[j].parent_id));
        if (u) {
          addChild(u, 'union', c, [remaining[i], remaining[j]]);
          remaining = remaining.filter((_, k) => k !== i && k !== j);
          i = -1;
          break;
        }
      }
    }
    if (remaining.length === 2 && remaining[0].parent_id !== remaining[1].parent_id) {
      const key = pairKey(remaining[0].parent_id, remaining[1].parent_id);
      if (!pairs.has(key)) pairs.set(key, { a: remaining[0].parent_id, b: remaining[1].parent_id, kind: 'coparents', unions: [{ id: `c:${key}` }], priority: 1 });
      addChild(`c:${key}`, 'union', c, remaining);
      remaining = [];
    }
    for (const r of remaining) addChild(r.parent_id, 'person', c, [r]);
    for (const r of parents) hasEdge.add(r.parent_id);
  }

  const connected = [...visible].filter((id) => hasEdge.has(id));
  const isolated = [...visible].filter((id) => !hasEdge.has(id));
  const nodes = [];
  let maxY = 0;
  let minX = 0;
  let maxX = 0;
  if (connected.length) {
    const PAIR_GAP = big ? 40 : 44; // промежуток между карточками пары — для значка
    const NODESEP = big ? 24 : 40;
    const LANE = 10; // шаг уровней горизонтальных линий в промежутке между поколениями
    const LANE_TOP = big ? 22 : 18; // первый уровень — ниже кнопки «свернуть» под карточкой
    const BASE_RANKSEP = big ? 46 : 54;
    const ENTRY_SHIFT = 22; // смещение входа линии в карточку, если ниже/выше на той же прямой чужая линия
    const heights = new Map(connected.map((id) => [id, heightOf(id)]));
    const connectedSet = new Set(connected);
    const kidsOf = (id) => (index.childrenOf.get(id) || []).map((r) => r.child_id).filter((x) => connectedSet.has(x));
    const pairOfUnion = new Map();
    for (const pr of pairs.values()) for (const u of pr.unions) pairOfUnion.set(u.id, pr);

    // Семейные строки. Пара объединяется в одну строку, только если от этого предок и потомок не
    // окажутся в одном ряду или «выше» друг друга (запутанные данные: брак через поколение и т. п.);
    // иначе пара рисуется отдельно, с линией между рядами.
    const root = new Map(connected.map((id) => [id, id]));
    const members = new Map(connected.map((id) => [id, [id]]));
    const find = (x) => {
      while (root.get(x) !== x) {
        root.set(x, root.get(root.get(x)));
        x = root.get(x);
      }
      return x;
    };
    // Есть ли путь «родитель → ребёнок» от группы from к группе to (через другие группы).
    const reaches = (from, to) => {
      const seen = new Set([from]);
      const queue = [...members.get(from)];
      while (queue.length) {
        const x = queue.pop();
        for (const c of kidsOf(x)) {
          const r = find(c);
          if (r === to) return true;
          if (!seen.has(r)) {
            seen.add(r);
            queue.push(...members.get(r));
          }
        }
      }
      return false;
    };
    const descends = (a, b) => {
      const seen = new Set([a]);
      const queue = [a];
      while (queue.length) for (const c of kidsOf(queue.pop())) {
        if (c === b) return true;
        if (!seen.has(c)) {
          seen.add(c);
          queue.push(c);
        }
      }
      return false;
    };
    const adj = new Map(connected.map((id) => [id, new Map()])); // сосед → приоритет пары
    const pairList = [...pairs.values()].filter((pr) => connectedSet.has(pr.a) && connectedSet.has(pr.b)).sort((x, y) => y.priority - x.priority);
    for (const pr of pairList) {
      const ra = find(pr.a);
      const rb = find(pr.b);
      const ok = ra === rb ? !descends(pr.a, pr.b) && !descends(pr.b, pr.a) : !reaches(ra, rb) && !reaches(rb, ra);
      pr.detached = !ok;
      if (!ok) continue;
      adj.get(pr.a).set(pr.b, pr.priority);
      adj.get(pr.b).set(pr.a, pr.priority);
      if (ra !== rb) {
        root.set(rb, ra);
        members.set(ra, members.get(ra).concat(members.get(rb)));
        members.delete(rb);
      }
    }
    // Порядок в строке — цепочкой, чтобы каждая пара стояла рядом (человек с двумя партнёрами — между
    // ними); при выборе следующего — сначала текущее партнёрство.
    const blockOf = new Map();
    const blocks = [];
    for (const r of [...members.keys()]) {
      const list = members.get(r);
      const deg = (m) => adj.get(m).size;
      const best = (m) => Math.max(0, ...adj.get(m).values());
      const start = [...list].sort((a, b) => deg(a) - deg(b) || best(b) - best(a) || (a < b ? -1 : 1))[0];
      const order = [start];
      const seen = new Set(order);
      let cur = start;
      while (order.length < list.length) {
        let next = [...adj.get(cur).entries()].filter(([x]) => !seen.has(x)).sort((a, b) => b[1] - a[1] || deg(a[0]) - deg(b[0]) || (a[0] < b[0] ? -1 : 1))[0]?.[0];
        if (!next) next = list.find((m) => !seen.has(m) && [...adj.get(m).keys()].some((x) => seen.has(x))) || list.find((m) => !seen.has(m));
        order.push(next);
        seen.add(next);
        cur = next;
      }
      const b = { id: `b:${blocks.length}`, order, height: Math.max(...order.map((m) => heights.get(m))) };
      b.width = order.length * W + (order.length - 1) * PAIR_GAP;
      blocks.push(b);
      for (const m of order) blockOf.set(m, b);
    }
    // Источник линий семьи для раскладки: строка пары (у пары, нарисованной отдельно, — строки обоих).
    const sourceBlocks = (f) => {
      if (f.kind === 'person') return [blockOf.get(f.source)].filter(Boolean);
      const pr = pairOfUnion.get(f.source);
      if (!pr) return [];
      return [...new Set([blockOf.get(pr.a), blockOf.get(pr.b)].filter(Boolean))];
    };

    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'TB', nodesep: NODESEP, ranksep: BASE_RANKSEP, marginx: 24, marginy: 24 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const b of blocks) g.setNode(b.id, { width: b.width, height: b.height });
    for (const f of families.values()) {
      for (const from of sourceBlocks(f)) {
        for (const { child } of f.children) {
          const to = blockOf.get(child);
          if (!to || to === from) continue;
          const e = g.edge(from.id, to.id);
          g.setEdge(from.id, to.id, { minlen: 1, weight: (e?.weight || 0) + 1 });
        }
      }
    }
    dagre.layout(g);
    const rankYs = [...new Set(blocks.map((b) => Math.round(g.node(b.id).y)))].sort((a, b) => a - b);
    const rankIdx = new Map(rankYs.map((y, i) => [y, i]));
    // Промежуточные точки длинных линий (через несколько поколений): x в каждом промежуточном ряду —
    // там dagre оставил свободное место.
    const corridor = new Map(); // «from>to» → Map(индекс ряда → x)
    for (const e of g.edges()) {
      const pts = g.edge(e).points || [];
      const m = new Map();
      for (const p of pts) {
        const k = rankIdx.get(Math.round(p.y));
        if (k != null) m.set(k, p.x);
      }
      corridor.set(`${e.v}>${e.w}`, m);
    }

    // Размещение людей и значков; уровни горизонтальных линий. extra — добавка к промежутку между
    // поколениями (ranksep влияет у dagre только на вертикальные координаты).
    const place = (extra) => {
      const at = new Map(blocks.map((b) => {
        const n = g.node(b.id);
        const k = rankIdx.get(Math.round(n.y));
        return [b, { x: n.x, y: n.y + k * extra, rank: k }];
      }));
      const rankOf = (b) => at.get(b).rank;
      const rankH = new Map();
      for (const b of blocks) rankH.set(rankOf(b), Math.max(rankH.get(rankOf(b)) || 0, b.height));
      const incoming = new Map();
      for (const f of families.values()) {
        for (const { child } of f.children) {
          if (!incoming.has(child)) incoming.set(child, []);
          incoming.get(child).push(f);
        }
      }
      const pos = new Map(); // человек → { x, y, w, h, cx, cy, block }
      const unionPos = new Map(); // значок → { cx, cy }
      const sourceX = (f) => {
        if (f.kind === 'person') return pos.get(f.source)?.cx;
        const up = unionPos.get(f.source);
        if (up) return up.cx;
        const pr = pairOfUnion.get(f.source);
        const a = pr && pos.get(pr.a);
        const b = pr && pos.get(pr.b);
        return a && b ? (a.cx + b.cx) / 2 : a?.cx ?? b?.cx;
      };
      const parentXOf = (m) => {
        const xs = (incoming.get(m) || []).map(sourceX).filter((v) => v != null);
        return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;
      };
      const placeBlock = (b) => {
        const n = at.get(b);
        const rowH = big ? rankH.get(rankOf(b)) : null;
        let x = n.x - b.width / 2;
        for (const m of b.order) {
          const h = rowH || heights.get(m);
          pos.set(m, { x, y: n.y - h / 2, w: W, h, cx: x + W / 2, cy: n.y, block: b });
          x += W + PAIR_GAP;
        }
        // Значки соседних пар — в промежутке между карточками, по середине; другие записи той же пары —
        // выше основного.
        for (let i = 0; i + 1 < b.order.length; i++) {
          const pr = pairs.get(pairKey(b.order[i], b.order[i + 1]));
          if (!pr || pr.detached) continue;
          const l = pos.get(b.order[i]);
          pr.unions.forEach((u, k) => unionPos.set(u.id, { cx: l.x + W + PAIR_GAP / 2, cy: l.cy - k * 32 }));
        }
      };
      // Поколения сверху вниз: братья и сёстры встают в порядке своих пар-родителей (дети второй пары —
      // со стороны второго партнёра); строка разворачивается, если так линии к её родителям короче.
      for (let rank = 0; rank < rankYs.length; rank++) {
        const row = blocks.filter((b) => rankOf(b) === rank).sort((a, b) => at.get(a).x - at.get(b).x);
        const info = new Map(row.map((b) => {
          const fams = b.order.flatMap((m) => incoming.get(m) || []);
          const parents = new Set(fams.flatMap((f) => sourceBlocks(f).map((sb) => sb.id)));
          const xs = fams.map(sourceX).filter((v) => v != null);
          return [b, { parents, desired: xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null }];
        }));
        for (let i = 0; i < row.length;) {
          let j = i + 1;
          while (j < row.length && info.get(row[j]).desired != null && info.get(row[j - 1]).desired != null && [...info.get(row[j]).parents].some((p) => info.get(row[j - 1]).parents.has(p))) j++;
          if (j - i > 1) {
            // Те же места в ряду (от левого края до правого), но в порядке родителей.
            const run = row.slice(i, j);
            const left = Math.min(...run.map((b) => at.get(b).x - b.width / 2));
            const right = Math.max(...run.map((b) => at.get(b).x + b.width / 2));
            const sum = run.reduce((s, b) => s + b.width, 0);
            const gap = run.length > 1 ? Math.max(NODESEP, (right - left - sum) / (run.length - 1)) : 0;
            let x = left;
            for (const b of [...run].sort((a, c) => info.get(a).desired - info.get(c).desired)) {
              at.get(b).x = x + b.width / 2;
              x += b.width + gap;
            }
          }
          i = j;
        }
        for (const b of row) {
          if (b.order.length > 1) {
            const cost = (order) => order.reduce((s, m, t) => {
              const px = parentXOf(m);
              return px == null ? s : s + Math.abs(at.get(b).x - b.width / 2 + t * (W + PAIR_GAP) + W / 2 - px);
            }, 0);
            const rev = [...b.order].reverse();
            if (cost(rev) + 0.5 < cost(b.order)) b.order = rev;
          }
          placeBlock(b);
        }
      }
      const rankBottom = new Map();
      for (const b of blocks) {
        const k = rankOf(b);
        rankBottom.set(k, Math.max(rankBottom.get(k) ?? -Infinity, at.get(b).y + (big ? rankH.get(k) : b.height) / 2));
      }
      const rowCards = new Map(); // ряд → карточки по порядку слева направо
      for (const [id, p] of pos) {
        const k = rankOf(p.block);
        if (!rowCards.has(k)) rowCards.set(k, []);
        rowCards.get(k).push({ id, ...p });
      }
      for (const list of rowCards.values()) list.sort((a, b) => a.x - b.x);
      const unionAt = new Set([...unionPos.values()].map((u) => Math.round(u.cx)));
      // Пары, которые не стоят рядом.
      const lanePairs = [];
      const crossPairs = [];
      for (const pr of pairs.values()) {
        const pa = pos.get(pr.a);
        const pb = pos.get(pr.b);
        if (!pa || !pb) continue;
        const ia = pa.block.order.indexOf(pr.a);
        const ib = pb.block.order.indexOf(pr.b);
        pr.adjacent = !pr.detached && pa.block === pb.block && Math.abs(ia - ib) === 1;
        pr.left = pa.cx <= pb.cx ? pr.a : pr.b;
        pr.right = pr.left === pr.a ? pr.b : pr.a;
        pr.cross = false;
        if (pr.adjacent) continue;
        if (rankOf(pa.block) === rankOf(pb.block)) {
          // Один ряд: значок ниже ряда, в свободном промежутке между карточками (не под чужой карточкой
          // и не на линии другой пары), ближайшем к середине.
          const l = pos.get(pr.left);
          const r = pos.get(pr.right);
          const mid = (l.cx + r.cx) / 2;
          const row = rowCards.get(rankOf(pa.block));
          let cx = mid;
          let bestD = Infinity;
          for (let t = 0; t + 1 < row.length; t++) {
            const gx = (row[t].x + W + row[t + 1].x) / 2;
            if (gx <= l.cx || gx >= r.cx || unionAt.has(Math.round(gx))) continue;
            if (Math.abs(gx - mid) < bestD) {
              bestD = Math.abs(gx - mid);
              cx = gx;
            }
          }
          pr.markX = cx;
          unionAt.add(Math.round(cx)); // следующей такой паре — другой промежуток
          lanePairs.push(pr);
        } else {
          // Разные ряды (запутанные данные): значок сбоку от нижнего партнёра, на середине его карточки.
          const [up, low] = rankOf(pa.block) < rankOf(pb.block) ? [pr.a, pr.b] : [pr.b, pr.a];
          const lp = pos.get(low);
          const row = rowCards.get(rankOf(lp.block));
          const t = row.findIndex((c) => c.id === low);
          const leftRoom = t > 0 ? lp.x - (row[t - 1].x + W) : Infinity;
          const rightRoom = t + 1 < row.length ? row[t + 1].x - (lp.x + W) : Infinity;
          const onRight = rightRoom >= leftRoom;
          const cx = onRight ? lp.x + W + Math.min(PAIR_GAP, rightRoom) / 2 : lp.x - Math.min(PAIR_GAP, leftRoom) / 2;
          pr.cross = true;
          pr.up = up;
          pr.low = low;
          pr.onRight = onRight;
          pr.unions.forEach((u, k) => unionPos.set(u.id, { cx, cy: lp.cy - k * 32 }));
          crossPairs.push(pr);
        }
      }
      // Ряд, под которым идут линии семьи к детям.
      const familyRank = (f) => {
        if (f.kind === 'person') return pos.get(f.source) ? rankOf(pos.get(f.source).block) : null;
        const pr = pairOfUnion.get(f.source);
        if (!pr || !pos.get(pr.a) || !pos.get(pr.b)) return null;
        return pr.cross ? rankOf(pos.get(pr.low).block) : rankOf(pos.get(pr.a).block);
      };
      // Отрезки по горизонтали в промежутках между поколениями. Каждой семье — свой уровень там, где её
      // отрезок перекрывает отрезки других семей; длинные линии (через поколение) идут по свободным
      // местам промежуточных рядов и в каждом промежутке тоже получают свой уровень.
      const items = [];
      for (const pr of lanePairs) {
        const l = pos.get(pr.left);
        const r = pos.get(pr.right);
        items.push({ kind: 'pair', pr, gap: rankOf(l.block), from: l.cx, to: r.cx });
      }
      const routes = []; // { f, child, rels, hops: [{ gap, x1, x2 }] }
      for (const f of families.values()) {
        const rank = familyRank(f);
        if (rank == null) continue;
        let sx;
        if (f.kind === 'person') sx = pos.get(f.source).cx;
        else {
          const pr = pairOfUnion.get(f.source);
          sx = pr.adjacent || pr.cross ? unionPos.get(f.source).cx : pr.markX;
          f.lanePair = !pr.adjacent && !pr.cross ? pr : null;
        }
        f.sx = sx;
        const fromBlocks = sourceBlocks(f);
        const xs = [sx];
        for (const { child, rels } of f.children) {
          const cp = pos.get(child);
          if (!cp) continue;
          const cr = rankOf(cp.block);
          if (cr <= rank) {
            routes.push({ f, child, rels, hops: [], up: true });
            continue;
          }
          // Свободные места в промежуточных рядах.
          let m = null;
          for (const sb of fromBlocks) m = m || corridor.get(`${sb.id}>${cp.block.id}`);
          const route = { f, child, rels, hops: [] };
          let x = sx;
          for (let k = rank + 1; k < cr; k++) {
            const nx = m?.get(k) ?? x;
            route.hops.push({ gap: k - 1, x1: x, x2: nx });
            x = nx;
          }
          route.hops.push({ gap: cr - 1, x1: x, x2: cp.cx });
          routes.push(route);
          xs.push(route.hops[0].x2);
        }
        items.push({ kind: 'family', f, gap: rank, from: Math.min(...xs), to: Math.max(...xs) });
      }
      for (const rt of routes) {
        rt.hops.forEach((h, i) => {
          if (i === 0) return; // первый отрезок — в общем отрезке семьи
          items.push({ kind: 'hop', hop: h, gap: h.gap, from: Math.min(h.x1, h.x2), to: Math.max(h.x1, h.x2) });
        });
      }
      const byGap = new Map();
      for (const it of items) {
        if (!byGap.has(it.gap)) byGap.set(it.gap, []);
        byGap.get(it.gap).push(it);
      }
      let maxLanes = 0;
      const gapBus = new Map(); // промежуток → (уровень → y)
      for (const [gap, list] of byGap) {
        // Сначала пары, которые не стоят рядом (короткие — раньше), потом семьи и продолжения длинных линий.
        list.sort((a, b) => {
          const ka = a.kind === 'pair' ? 0 : 1;
          const kb = b.kind === 'pair' ? 0 : 1;
          return ka - kb || (ka === 0 ? (a.to - a.from) - (b.to - b.from) : a.from - b.from);
        });
        const lanes = [];
        const pairLane = new Map();
        // Отрезки ближе 28 px друг к другу — тоже на разных уровнях, чтобы не читались как одна линия.
        const free = (k, it) => !(lanes[k] || []).some(([f, t]) => f < it.to + 28 && it.from < t + 28);
        for (const it of list) {
          // Значок пары (26 px) на своём уровне занимает и два соседних ниже; линии к её детям — ещё ниже.
          let lane = it.kind === 'family' && it.f.lanePair ? (pairLane.get(it.f.lanePair) ?? -3) + 3 : 0;
          const span = it.kind === 'pair' ? 3 : 1;
          const fits = (k) => {
            for (let d = 0; d < span; d++) if (!free(k + d, it)) return false;
            return true;
          };
          while (!fits(lane)) lane++;
          for (let d = 0; d < span; d++) (lanes[lane + d] ||= []).push([it.from, it.to]);
          if (it.kind === 'pair') pairLane.set(it.pr, lane);
          it.lane = lane;
          maxLanes = Math.max(maxLanes, lane + span);
        }
        const base = rankBottom.get(gap) + LANE_TOP;
        for (const it of list) {
          const y = base + it.lane * LANE;
          if (it.kind === 'pair') {
            it.pr.laneY = y;
            it.pr.unions.forEach((u, k) => unionPos.set(u.id, { cx: it.pr.markX + k * 30, cy: y }));
          } else if (it.kind === 'family') it.f.busY = y;
          else it.hop.y = y;
        }
        gapBus.set(gap, base);
      }
      // Точки линий к детям. Вход в карточку смещается в сторону, если на той же прямой в этом
      // промежутке идёт чужая линия (иначе ребёнок «висел» бы на чужой паре).
      const drops = new Map(); // промежуток → [{ x, f }]
      const addDrop = (gap, x, f) => {
        if (!drops.has(gap)) drops.set(gap, []);
        drops.get(gap).push({ x, f });
      };
      for (const rt of routes) {
        if (rt.up || rt.f.busY == null) continue;
        rt.hops[0].y = rt.f.busY;
        addDrop(rt.hops[0].gap, rt.f.sx, rt.f);
        for (let i = 1; i < rt.hops.length; i++) addDrop(rt.hops[i].gap, rt.hops[i].x1, rt.f); // спуск через ряд
      }
      for (const rt of routes) {
        if (rt.up || rt.f.busY == null) continue;
        const cp = pos.get(rt.child);
        const last = rt.hops[rt.hops.length - 1];
        const foreign = (drops.get(last.gap) || []).filter((d) => d.f !== rt.f && Math.abs(d.x - cp.cx) < 10);
        let tx = cp.cx;
        if (foreign.length) tx = cp.cx + (foreign[0].x <= cp.cx ? ENTRY_SHIFT : -ENTRY_SHIFT);
        last.x2 = tx;
        const pts = [[rt.f.sx, null], [rt.f.sx, rt.hops[0].y]];
        for (const h of rt.hops) {
          pts.push([h.x1, h.y]);
          pts.push([h.x2, h.y]);
        }
        pts.push([tx, cp.y]);
        rt.points = pts;
        rt.tx = tx;
      }
      return { pos, unionPos, maxLanes, routes };
    };

    let placed = place(0);
    // Уровней много — промежуток между поколениями шире.
    const need = LANE_TOP + (placed.maxLanes - 1) * LANE + LANE_TOP;
    if (need > BASE_RANKSEP) placed = place(need - BASE_RANKSEP);
    const { pos, unionPos, routes } = placed;
    for (const id of connected) {
      const p = pos.get(id);
      nodes.push({ id, type: 'person', position: { x: p.x, y: p.y }, data: { personId: id, width: W, height: p.h, big } });
      maxY = Math.max(maxY, p.y + p.h);
      maxX = Math.max(maxX, p.x + W);
      minX = Math.min(minX, p.x);
    }
    for (const pr of pairs.values()) {
      if (!pos.get(pr.a) || !pos.get(pr.b)) continue;
      const type = pr.kind === 'partnership' ? 'partner' : 'coparent';
      pr.unions.forEach((u, k) => {
        const up = unionPos.get(u.id);
        if (!up) return;
        nodes.push({ id: u.id, type: 'union', position: { x: up.cx - 13, y: up.cy - 13 }, data: { kind: pr.kind, partnership: u.partnership }, selectable: false });
        if (k > 0) return; // другие записи той же пары — только значок
        const tag = u.partnership ? u.partnership.id : u.id;
        if (pr.adjacent) {
          edges.push({ id: `e:${tag}:1`, source: pr.left, target: u.id, type, sourceHandle: 'r', targetHandle: 'l', data: { partnership: u.partnership } });
          edges.push({ id: `e:${tag}:2`, source: u.id, target: pr.right, type, sourceHandle: 'r', targetHandle: 'l', data: { partnership: u.partnership } });
        } else if (pr.cross) {
          edges.push(pr.onRight
            ? { id: `e:${tag}:1`, source: pr.low, target: u.id, type, sourceHandle: 'r', targetHandle: 'l', data: { partnership: u.partnership } }
            : { id: `e:${tag}:1`, source: u.id, target: pr.low, type, sourceHandle: 'r', targetHandle: 'l', data: { partnership: u.partnership } });
          edges.push({ id: `e:${tag}:2`, source: pr.up, target: u.id, type, sourceHandle: 'b', targetHandle: 't', data: { partnership: u.partnership } });
        } else {
          for (const [i, m] of [pr.left, pr.right].entries()) {
            edges.push({ id: `e:${tag}:${i + 1}`, source: m, target: u.id, type: 'pairLane', sourceHandle: 'b', targetHandle: 't', data: { kind: type, laneY: pr.laneY } });
          }
        }
      });
    }
    for (const rt of routes) {
      const f = rt.f;
      const id = f.kind === 'union' ? `pc:${f.source}:${rt.child}` : `pc:${rt.rels[0].id}`;
      edges.push({ id, source: f.source, target: rt.child, type: 'parent', sourceHandle: 'b', targetHandle: 't', data: { rels: rt.rels, points: rt.points || null, tdx: rt.points ? rt.tx - pos.get(rt.child).cx : 0, direct: f.kind === 'person' } });
    }
  }
  // Люди без подтверждённых связей — отдельной сеткой, без ложного древа.
  if (isolated.length) {
    const order = (id) => {
      const r = index.recordsByPerson.get(id)?.[0];
      return r ? [0, r.sheet_name, r.row_index, r.col_index] : [1, '', 0, 0];
    };
    isolated.sort((a, b) => {
      const oa = order(a);
      const ob = order(b);
      for (let i = 0; i < 4; i++) if (oa[i] !== ob[i]) return oa[i] < ob[i] ? -1 : 1;
      return index.byId.get(a).display_name.localeCompare(index.byId.get(b).display_name, 'ru');
    });
    // Сетка близка по пропорциям к холсту, чтобы карточки оставались читаемыми. На весь экран — по
    // размеру экрана: целиком, если так имена не мельче 12 px, иначе столько столбцов, сколько
    // помещается крупно (тогда листать только вниз).
    let cols = Math.min(6, Math.max(1, Math.round(Math.sqrt((isolated.length * 1.45 * 110) / (W + GAP)))));
    if (big && gridBox?.w > 0 && gridBox?.h > 0) {
      const avgH = isolated.reduce((s, id) => s + heightOf(id), 0) / isolated.length;
      let best = 1;
      let bestZoom = 0;
      for (let c = 1; c <= Math.min(isolated.length, 12); c++) {
        const rows = Math.ceil(isolated.length / c);
        const z = Math.min((gridBox.w * 0.94) / (c * (W + GAP) - GAP), (gridBox.h * 0.94) / (rows * (avgH + GAP)));
        if (z > bestZoom) {
          bestZoom = z;
          best = c;
        }
      }
      cols = bestZoom * 18 >= 12 ? best : Math.max(1, Math.min(isolated.length, Math.floor(((gridBox.w * 0.94) / (14 / 18) + GAP) / (W + GAP))));
    }
    const startY = connected.length ? maxY + 110 : 60;
    const startX = connected.length ? minX : 0;
    nodes.push({ id: 'section:isolated', type: 'section', position: { x: startX, y: startY - 46 }, data: { count: isolated.length, hasTree: connected.length > 0, width: big ? Math.min(560, Math.max(W, cols * (W + GAP) - GAP)) : undefined }, selectable: false, draggable: false });
    let y = startY;
    for (let i = 0; i < isolated.length; i += cols) {
      const row = isolated.slice(i, i + cols);
      const hs = row.map((id) => heightOf(id));
      row.forEach((id, k) => {
        nodes.push({ id, type: 'person', position: { x: startX + k * (W + GAP), y }, data: { personId: id, width: W, height: hs[k], isolated: true, big } });
      });
      y += Math.max(...hs) + GAP;
    }
  }
  const hiddenCount = (id, dir) => (dir === 'down' ? [...descendants(id, index)] : [...ancestors(id, index)]).filter((x) => hidden.has(x)).length;
  return { nodes, edges, visible, hidden, hiddenCount, connectedCount: connected.length, isolatedCount: isolated.length };
}

// ---------- Исходная схема Excel ----------

export function buildExcel({ data, index, importRow, sheetName }) {
  const geoAll = importRow?.geometry?.geometry || {};
  const sheet = sheetName && geoAll[sheetName] ? sheetName : Object.keys(geoAll)[0];
  const geo = geoAll[sheet];
  if (!geo) return { nodes: [], edges: [], sheet: null, sheets: [] };
  const records = data.sourceRecords.filter((r) => r.import_id === importRow.id && r.sheet_name === sheet);
  const colX = new Map();
  const colW = new Map();
  const HEAD = 30;
  const LEFT = 40;
  let x = LEFT;
  for (const c of geo.columns) {
    const w = Math.max(210, Math.round((c.width || 8.43) * 8.2));
    colX.set(c.index, x);
    colW.set(c.index, w);
    x += w;
  }
  const rowRecords = new Map();
  for (const r of records) {
    if (!rowRecords.has(r.row_index)) rowRecords.set(r.row_index, []);
    rowRecords.get(r.row_index).push(r);
  }
  const spanOf = (r) => {
    const m = r.merged_range ? geo.merges.find((mm) => mm.ref === r.merged_range) : null;
    return m || { top: r.row_index, bottom: r.row_index, left: r.col_index, right: r.col_index };
  };
  const widthOf = (sp) => {
    let w = 0;
    // В сжатой схеме столбцов внутри объединения может не быть — они не добавляют ширины.
    for (let c = sp.left; c <= sp.right; c++) w += colW.get(c) ?? (geo.compact ? 0 : 210);
    return w;
  };
  const rowY = new Map();
  const rowH = new Map();
  let y = HEAD;
  for (const r of geo.rows) {
    const recs = rowRecords.get(r.index) || [];
    let h = 44;
    if (recs.length) {
      h = Math.max(...recs.map((rec) => {
        const p = index.byId.get(rec.person_id);
        return p ? nodeHeight(p, widthOf(spanOf(rec)) - 16, { meta: false }) + 20 : 100;
      }), 108);
    }
    rowY.set(r.index, y);
    rowH.set(r.index, h);
    y += h;
  }
  const nodes = [];
  for (const c of geo.columns) {
    nodes.push({ id: `col:${c.index}`, type: 'gridhead', position: { x: colX.get(c.index), y: 0 }, data: { label: c.letter, width: colW.get(c.index), height: HEAD - 4 }, selectable: false, draggable: false });
  }
  for (const r of geo.rows) {
    nodes.push({ id: `row:${r.index}`, type: 'gridhead', position: { x: 0, y: rowY.get(r.index) }, data: { label: String(r.index), width: LEFT - 6, height: rowH.get(r.index), muted: !r.hasRecords }, selectable: false, draggable: false });
  }
  for (const b of geo.borderedCells) {
    if (!colX.has(b.col) || !rowY.has(b.row)) continue;
    nodes.push({
      id: `cell:${b.ref}`,
      type: 'cellbox',
      position: { x: colX.get(b.col), y: rowY.get(b.row) },
      data: { width: colW.get(b.col), height: rowH.get(b.row), border: b.border, empty: b.empty, ref: b.ref },
      selectable: false,
      draggable: false,
      zIndex: -1,
    });
  }
  const personNode = new Map();
  for (const rec of records) {
    const p = index.byId.get(rec.person_id);
    if (!p) continue;
    const sp = spanOf(rec);
    const w = widthOf(sp) - 16;
    let h = 0;
    for (let rr = sp.top; rr <= sp.bottom; rr++) h += rowH.get(rr) || 0;
    const nodeId = personNode.has(p.id) ? `${p.id}@${rec.cell}` : p.id;
    if (!personNode.has(p.id)) personNode.set(p.id, nodeId);
    const nh = nodeHeight(p, w, { meta: false });
    nodes.push({
      id: nodeId,
      type: 'person',
      position: { x: colX.get(sp.left) + 8, y: rowY.get(sp.top) + Math.max(8, (h - nh) / 2) },
      data: { personId: p.id, width: w, height: nh, cell: rec.merged_range || rec.cell, excel: true, recordStatus: rec.status },
      draggable: false,
    });
  }
  return {
    nodes,
    edges: [],
    sheet,
    sheets: Object.keys(geoAll),
    personNode,
    recordCount: records.length,
  };
}

// ---------- Линии предположений ----------

export function hypothesisEdges(hypotheses, nodes, { selectedId, nodeIdFor = (id) => id }) {
  const pos = new Map(nodes.filter((n) => n.type === 'person').map((n) => [n.id, n]));
  const out = [];
  for (const h of hypotheses) {
    if (h.status !== 'open' && h.status !== 'deferred') continue;
    const a = pos.get(nodeIdFor(h.person_a));
    const b = pos.get(nodeIdFor(h.person_b));
    if (!a || !b) continue;
    const ca = { x: a.position.x + a.data.width / 2, y: a.position.y + a.data.height / 2 };
    const cb = { x: b.position.x + b.data.width / 2, y: b.position.y + b.data.height / 2 };
    let sourceHandle = 'b';
    let targetHandle = 't';
    let source = a.id;
    let target = b.id;
    const vertical = Math.abs(cb.y - ca.y) > Math.max(a.data.height, b.data.height) * 0.6;
    if (vertical) {
      if (cb.y < ca.y) {
        source = b.id;
        target = a.id;
      }
    } else {
      const left = ca.x <= cb.x ? a : b;
      source = left.id;
      target = left === a ? b.id : a.id;
      sourceHandle = 'r';
      targetHandle = 'l';
    }
    // Двое стоят рядом (между ними может быть значок пары) — «?» выше ряда, чтобы не закрыть значок.
    const sideBySide = !vertical && Math.abs(ca.y - cb.y) < 4 && Math.abs(ca.x - cb.x) - (a.data.width + b.data.width) / 2 < 100;
    out.push({
      id: `h:${h.id}`,
      source,
      target,
      sourceHandle,
      targetHandle,
      type: 'hypothesis',
      data: { hypothesis: h, highlight: !!selectedId && (h.person_a === selectedId || h.person_b === selectedId), labelDy: sideBySide ? -(Math.max(a.data.height, b.data.height) / 2 + 18) : 0 },
    });
  }
  // Подпись «Предположение» постоянно видна, когда выделенных линий немного; иначе — при наведении.
  const hl = out.filter((e) => e.data.highlight).length;
  for (const e of out) e.data.showWord = e.data.highlight && hl <= 4;
  return out;
}
