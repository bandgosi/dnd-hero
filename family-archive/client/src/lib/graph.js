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

export function nodeHeight(person, width = NODE_W, { meta = true, chip = true } = {}) {
  // − 2 px — рамка карточки.
  const textW = width - PAD * 2 - 2 - AVATAR - 12;
  const [a, b] = splitName(person);
  const lines = countLines(a, textW) + countLines(b, textW);
  const h = PAD * 2 + lines * 20 + (meta ? 19 : 0) + (chip ? 30 : 0);
  return Math.max(AVATAR + PAD * 2, Math.ceil(h));
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
  const heightOf = (id) => (big ? bigNodeHeight(index.byId.get(id), { chip: kinLabel(id) }) : nodeHeight(index.byId.get(id)));
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
  const pairs = new Map(); // ключ «a|b» → { a, b, kind, unions: [{ id, partnership }] }
  const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const partnerOf = new Map();
  for (const p of data.partnerships) {
    if (!visible.has(p.person1_id) || !visible.has(p.person2_id) || p.person1_id === p.person2_id) continue;
    const key = pairKey(p.person1_id, p.person2_id);
    const u = `u:${p.id}`;
    if (!pairs.has(key)) pairs.set(key, { a: p.person1_id, b: p.person2_id, kind: 'partnership', unions: [] });
    pairs.get(key).unions.push({ id: u, partnership: p });
    hasEdge.add(p.person1_id);
    hasEdge.add(p.person2_id);
    if (!partnerOf.has(key) || p.status === 'ongoing' || p.kind === 'marriage') partnerOf.set(key, u);
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
    for (let i = 0; i < remaining.length && remaining.length >= 2; i++) {
      for (let j = i + 1; j < remaining.length; j++) {
        const u = partnerOf.get(pairKey(remaining[i].parent_id, remaining[j].parent_id));
        if (u) {
          addChild(u, 'union', c, [remaining[i], remaining[j]]);
          remaining = remaining.filter((_, k) => k !== i && k !== j);
          i = remaining.length;
          break;
        }
      }
    }
    if (remaining.length === 2 && remaining[0].parent_id !== remaining[1].parent_id) {
      const key = pairKey(remaining[0].parent_id, remaining[1].parent_id);
      if (!pairs.has(key)) pairs.set(key, { a: remaining[0].parent_id, b: remaining[1].parent_id, kind: 'coparents', unions: [{ id: `c:${key}` }] });
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
    const LANE = 10; // шаг уровней горизонтальных линий в промежутке между поколениями
    const LANE_TOP = big ? 22 : 18; // первый уровень — ниже кнопки «свернуть» под карточкой
    const BASE_RANKSEP = big ? 46 : 54;
    const heights = new Map(connected.map((id) => [id, heightOf(id)]));
    // Семейные строки — связные группы пар. Порядок внутри — цепочкой, чтобы каждая пара стояла рядом
    // (человек с двумя партнёрами — между ними).
    const adj = new Map(connected.map((id) => [id, new Set()]));
    for (const pr of pairs.values()) {
      if (!adj.has(pr.a) || !adj.has(pr.b)) continue;
      adj.get(pr.a).add(pr.b);
      adj.get(pr.b).add(pr.a);
    }
    const blockOf = new Map();
    const blocks = [];
    for (const id of connected) {
      if (blockOf.has(id)) continue;
      const members = [];
      const stack = [id];
      blockOf.set(id, null);
      while (stack.length) {
        const x = stack.pop();
        members.push(x);
        for (const y of adj.get(x)) if (!blockOf.has(y)) {
          blockOf.set(y, null);
          stack.push(y);
        }
      }
      const deg = (m) => adj.get(m).size;
      const byDeg = (a, b) => deg(a) - deg(b) || (a < b ? -1 : 1);
      const start = [...members].sort(byDeg)[0];
      const order = [start];
      const seen = new Set(order);
      let cur = start;
      while (order.length < members.length) {
        let next = [...adj.get(cur)].filter((x) => !seen.has(x)).sort(byDeg)[0];
        if (!next) next = members.find((m) => !seen.has(m) && [...adj.get(m)].some((x) => seen.has(x))) || members.find((m) => !seen.has(m));
        order.push(next);
        seen.add(next);
        cur = next;
      }
      const b = { id: `b:${blocks.length}`, order, height: Math.max(...order.map((m) => heights.get(m))) };
      b.width = order.length * W + (order.length - 1) * PAIR_GAP;
      blocks.push(b);
      for (const m of order) blockOf.set(m, b);
    }
    const unionBlock = new Map();
    const pairOfUnion = new Map();
    for (const pr of pairs.values()) {
      for (const u of pr.unions) {
        unionBlock.set(u.id, blockOf.get(pr.a));
        pairOfUnion.set(u.id, pr);
      }
    }
    const sourceBlock = (f) => (f.kind === 'union' ? unionBlock.get(f.source) : blockOf.get(f.source));

    const layoutBlocks = (ranksep) => {
      const g = new dagre.graphlib.Graph();
      g.setGraph({ rankdir: 'TB', nodesep: big ? 24 : 40, ranksep, marginx: 24, marginy: 24 });
      g.setDefaultEdgeLabel(() => ({}));
      for (const b of blocks) g.setNode(b.id, { width: b.width, height: b.height });
      for (const f of families.values()) {
        const from = sourceBlock(f);
        if (!from) continue;
        for (const { child } of f.children) {
          const to = blockOf.get(child);
          if (!to || to === from) continue;
          const e = g.edge(from.id, to.id);
          g.setEdge(from.id, to.id, { minlen: 1, weight: (e?.weight || 0) + 1 });
        }
      }
      dagre.layout(g);
      return g;
    };

    // Размещение людей и значков по раскладке строк; уровни горизонтальных линий.
    const place = (g) => {
      const at = new Map(blocks.map((b) => [b, { ...g.node(b.id) }]));
      const rankOf = (b) => Math.round(at.get(b).y);
      // Крупные карточки одного поколения — одной высоты: ряды ровные.
      const rankH = new Map();
      for (const b of blocks) rankH.set(rankOf(b), Math.max(rankH.get(rankOf(b)) || 0, b.height));
      // Откуда к человеку идут линии от родителей (семьи-источники).
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
        return a && b ? (a.cx + b.cx) / 2 : undefined;
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
        // Значки соседних пар — в промежутке между карточками, по середине; несколько партнёрств
        // одной пары — друг над другом.
        for (let i = 0; i + 1 < b.order.length; i++) {
          const pr = pairs.get(pairKey(b.order[i], b.order[i + 1]));
          if (!pr) continue;
          const l = pos.get(b.order[i]);
          pr.unions.forEach((u, k) => unionPos.set(u.id, { cx: l.x + W + PAIR_GAP / 2, cy: l.cy + (k - (pr.unions.length - 1) / 2) * 30 }));
        }
      };
      // Поколения сверху вниз: братья и сёстры встают в порядке своих пар-родителей (дети второй
      // пары — со стороны второго партнёра), строка разворачивается, если так линии к её родителям
      // короче.
      const ranks = [...new Set(blocks.map(rankOf))].sort((a, b) => a - b);
      for (const rank of ranks) {
        const row = blocks.filter((b) => rankOf(b) === rank).sort((a, b) => at.get(a).x - at.get(b).x);
        const info = new Map(row.map((b) => {
          const fams = b.order.flatMap((m) => incoming.get(m) || []);
          const parentBlocks = [...new Set(fams.map((f) => sourceBlock(f)?.id).filter(Boolean))].sort().join(',');
          const xs = fams.map(sourceX).filter((v) => v != null);
          return [b, { key: parentBlocks, desired: xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null }];
        }));
        for (let i = 0; i < row.length;) {
          let j = i + 1;
          const k = info.get(row[i]).key;
          while (j < row.length && k && info.get(row[j]).key === k && row[j].width === row[i].width) j++;
          if (j - i > 1 && row.slice(i, j).every((b) => info.get(b).desired != null)) {
            const slots = row.slice(i, j).map((b) => at.get(b).x);
            const sorted = row.slice(i, j).sort((a, b) => info.get(a).desired - info.get(b).desired);
            sorted.forEach((b, t) => {
              at.get(b).x = slots[t];
            });
          }
          i = j;
        }
        for (const b of row) {
          if (b.order.length > 1) {
            // Сравнить исходный и обратный порядок по длине линий к родителям.
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
      // Пары, которые не стоят рядом (у человека больше двух партнёров), — значок ниже строки.
      const lanePairs = [];
      for (const pr of pairs.values()) {
        const pa = pos.get(pr.a);
        const pb = pos.get(pr.b);
        if (!pa || !pb) continue;
        const ia = pa.block.order.indexOf(pr.a);
        const ib = pb.block.order.indexOf(pr.b);
        pr.adjacent = pa.block === pb.block && Math.abs(ia - ib) === 1;
        pr.left = pa.cx <= pb.cx ? pr.a : pr.b;
        pr.right = pr.left === pr.a ? pr.b : pr.a;
        if (!pr.adjacent) {
          for (const u of pr.unions) unionPos.delete(u.id);
          lanePairs.push(pr);
        }
      }
      // Уровни горизонтальных линий в промежутке под каждым поколением: отрезки разных семей,
      // которые перекрываются по горизонтали, идут на разной высоте и не сливаются.
      const rankBottom = new Map();
      for (const b of blocks) {
        const n = at.get(b);
        const k = Math.round(n.y);
        rankBottom.set(k, Math.max(rankBottom.get(k) || -Infinity, n.y + (big ? rankH.get(k) : b.height) / 2));
      }
      const items = [];
      for (const pr of lanePairs) {
        const l = pos.get(pr.left);
        const r = pos.get(pr.right);
        items.push({ kind: 'pair', pr, rank: Math.round(l.block && at.get(l.block).y), from: Math.min(l.cx, r.cx), to: Math.max(l.cx, r.cx), minLane: 0 });
      }
      for (const f of families.values()) {
        let sx;
        let rank;
        if (f.kind === 'union') {
          const pr = pairOfUnion.get(f.source);
          if (!pr || !pos.get(pr.a)) continue;
          rank = Math.round(at.get(pos.get(pr.a).block).y);
          sx = pr.adjacent ? unionPos.get(f.source).cx : (pos.get(pr.a).cx + pos.get(pr.b).cx) / 2;
          f.lanePair = pr.adjacent ? null : pr;
        } else {
          const p = pos.get(f.source);
          if (!p) continue;
          rank = Math.round(at.get(p.block).y);
          sx = p.cx;
        }
        const xs = [sx, ...f.children.map(({ child }) => pos.get(child)?.cx).filter((v) => v != null)];
        f.sx = sx;
        items.push({ kind: 'family', f, rank, from: Math.min(...xs), to: Math.max(...xs) });
      }
      const byRank = new Map();
      for (const it of items) {
        if (!byRank.has(it.rank)) byRank.set(it.rank, []);
        byRank.get(it.rank).push(it);
      }
      let maxLanes = 0;
      for (const [rank, list] of byRank) {
        // Сначала линии не соседних пар (их значок — на своём уровне), потом семьи.
        list.sort((a, b) => (a.kind === b.kind ? a.from - b.from : a.kind === 'pair' ? -1 : 1));
        const laneEnd = [];
        const pairLane = new Map();
        for (const it of list) {
          // Значок пары на своём уровне занимает и соседний ниже; линии к её детям — ещё ниже.
          const min = it.kind === 'family' && it.f.lanePair ? (pairLane.get(it.f.lanePair) ?? -2) + 2 : 0;
          let lane = min;
          const busy = (k) => laneEnd[k] != null && laneEnd[k] > it.from - 14;
          while (busy(lane) || (it.kind === 'pair' && busy(lane + 1))) lane++;
          laneEnd[lane] = it.to;
          it.lane = lane;
          if (it.kind === 'pair') {
            pairLane.set(it.pr, lane);
            laneEnd[lane + 1] = Math.max(laneEnd[lane + 1] ?? -Infinity, it.to);
          }
          maxLanes = Math.max(maxLanes, lane + (it.kind === 'pair' ? 2 : 1));
        }
        const base = rankBottom.get(rank) + LANE_TOP;
        for (const it of list) {
          const y = base + it.lane * LANE;
          if (it.kind === 'pair') {
            const cx = (pos.get(it.pr.left).cx + pos.get(it.pr.right).cx) / 2;
            it.pr.laneY = y;
            it.pr.unions.forEach((u, k) => unionPos.set(u.id, { cx: cx + k * 30, cy: y }));
          } else it.f.busY = y;
        }
      }
      return { pos, unionPos, maxLanes };
    };

    let g = layoutBlocks(BASE_RANKSEP);
    let placed = place(g);
    // Уровней много — промежуток между поколениями шире.
    const need = LANE_TOP + (placed.maxLanes - 1) * LANE + LANE_TOP;
    if (need > BASE_RANKSEP) {
      g = layoutBlocks(need);
      placed = place(g);
    }
    const { pos, unionPos } = placed;
    for (const id of connected) {
      const p = pos.get(id);
      nodes.push({ id, type: 'person', position: { x: p.x, y: p.y }, data: { personId: id, width: W, height: p.h, big } });
      maxY = Math.max(maxY, p.y + p.h);
      maxX = Math.max(maxX, p.x + W);
      minX = Math.min(minX, p.x);
    }
    for (const pr of pairs.values()) {
      if (!pos.get(pr.a) || !pos.get(pr.b)) continue;
      pr.unions.forEach((u) => {
        const up = unionPos.get(u.id);
        if (!up) return;
        nodes.push({ id: u.id, type: 'union', position: { x: up.cx - 13, y: up.cy - 13 }, data: { kind: pr.kind, partnership: u.partnership }, selectable: false });
        const type = pr.kind === 'partnership' ? 'partner' : 'coparent';
        const tag = u.partnership ? u.partnership.id : u.id;
        if (pr.adjacent) {
          edges.push({ id: `e:${tag}:1`, source: pr.left, target: u.id, type, sourceHandle: 'r', targetHandle: 'l', data: { partnership: u.partnership } });
          edges.push({ id: `e:${tag}:2`, source: u.id, target: pr.right, type, sourceHandle: 'r', targetHandle: 'l', data: { partnership: u.partnership } });
        } else {
          for (const [i, m] of [pr.left, pr.right].entries()) {
            edges.push({ id: `e:${tag}:${i + 1}`, source: m, target: u.id, type: 'pairLane', sourceHandle: 'b', targetHandle: 't', data: { kind: type, laneY: pr.laneY } });
          }
        }
      });
    }
    for (const f of families.values()) {
      if (f.busY == null) continue;
      for (const { child, rels } of f.children) {
        if (!pos.get(child)) continue;
        const id = f.kind === 'union' ? `pc:${f.source}:${child}` : `pc:${rels[0].id}`;
        edges.push({ id, source: f.source, target: child, type: 'parent', sourceHandle: 'b', targetHandle: 't', data: { rels, busY: f.busY, direct: f.kind === 'person' } });
      }
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
    out.push({
      id: `h:${h.id}`,
      source,
      target,
      sourceHandle,
      targetHandle,
      type: 'hypothesis',
      data: { hypothesis: h, highlight: !!selectedId && (h.person_a === selectedId || h.person_b === selectedId) },
    });
  }
  // Подпись «Предположение» постоянно видна, когда выделенных линий немного; иначе — при наведении.
  const hl = out.filter((e) => e.data.highlight).length;
  for (const e of out) e.data.showWord = e.data.highlight && hl <= 4;
  return out;
}
