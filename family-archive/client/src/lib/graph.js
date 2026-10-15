// Построение узлов и линий для холста.
// «Семейное древо» — только подтверждённые связи (раскладка dagre).
// «Исходная схема Excel» — положение записей по ячейкам, без домысливания родства.
// Предположения добавляются отдельными пунктирными линиями и не влияют на раскладку.
import dagre from '@dagrejs/dagre';
import { splitName } from './format.js';

export const NODE_W = 260;
const AVATAR = 48;
const PAD = 14;
const NAME_FONT = '600 15px "Manrope Variable", "Segoe UI", system-ui, sans-serif';

let ctx = null;
function measure(text) {
  if (!ctx) {
    const c = document.createElement('canvas');
    ctx = c.getContext('2d');
  }
  ctx.font = NAME_FONT;
  return ctx.measureText(text).width;
}

export function countLines(text, maxWidth) {
  if (!text) return 0;
  const words = text.split(/\s+/).filter(Boolean);
  let lines = 1;
  let cur = 0;
  const space = measure(' ');
  for (const w of words) {
    const ww = measure(w);
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
  const textW = width - PAD * 2 - AVATAR - 12;
  const [a, b] = splitName(person);
  const lines = countLines(a, textW) + countLines(b, textW);
  const h = PAD * 2 + lines * 20 + (meta ? 19 : 0) + (chip ? 30 : 0);
  return Math.max(AVATAR + PAD * 2, Math.ceil(h));
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

export function buildTree({ data, index, scope, centerId, collapsedDown, collapsedUp }) {
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
  const unions = [];
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 54, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));

  const partnerOf = new Map();
  for (const p of data.partnerships) {
    if (!visible.has(p.person1_id) || !visible.has(p.person2_id)) continue;
    const u = `u:${p.id}`;
    unions.push({ id: u, kind: 'partnership', partnership: p });
    edges.push({ id: `e:${p.id}:1`, source: p.person1_id, target: u, type: 'partner', sourceHandle: 'b', targetHandle: 't', data: { partnership: p } });
    edges.push({ id: `e:${p.id}:2`, source: p.person2_id, target: u, type: 'partner', sourceHandle: 'b', targetHandle: 't', data: { partnership: p } });
    hasEdge.add(p.person1_id);
    hasEdge.add(p.person2_id);
    const key = [p.person1_id, p.person2_id].sort().join('|');
    if (!partnerOf.has(key) || p.status === 'ongoing' || p.kind === 'marriage') partnerOf.set(key, u);
  }
  const coUnions = new Map();
  for (const c of visible) {
    const parents = (index.parentsOf.get(c) || []).filter((r) => visible.has(r.parent_id));
    if (!parents.length) continue;
    hasEdge.add(c);
    let remaining = [...parents];
    for (let i = 0; i < remaining.length && remaining.length >= 2; i++) {
      for (let j = i + 1; j < remaining.length; j++) {
        const key = [remaining[i].parent_id, remaining[j].parent_id].sort().join('|');
        const u = partnerOf.get(key);
        if (u) {
          edges.push({ id: `pc:${u}:${c}`, source: u, target: c, type: 'parent', sourceHandle: 'b', targetHandle: 't', data: { rels: [remaining[i], remaining[j]] } });
          remaining = remaining.filter((_, k) => k !== i && k !== j);
          i = remaining.length;
          break;
        }
      }
    }
    if (remaining.length === 2) {
      const key = remaining.map((r) => r.parent_id).sort().join('|');
      let u = coUnions.get(key);
      if (!u) {
        u = `c:${key}`;
        coUnions.set(key, u);
        unions.push({ id: u, kind: 'coparents' });
        for (const r of remaining) edges.push({ id: `cp:${u}:${r.parent_id}`, source: r.parent_id, target: u, type: 'coparent', sourceHandle: 'b', targetHandle: 't', data: {} });
      }
      edges.push({ id: `pc:${u}:${c}`, source: u, target: c, type: 'parent', sourceHandle: 'b', targetHandle: 't', data: { rels: remaining } });
      remaining = [];
    }
    for (const r of remaining) {
      edges.push({ id: `pc:${r.id}`, source: r.parent_id, target: c, type: 'parent', sourceHandle: 'b', targetHandle: 't', data: { rels: [r], direct: true } });
    }
    for (const r of parents) hasEdge.add(r.parent_id);
  }

  const connected = [...visible].filter((id) => hasEdge.has(id));
  const isolated = [...visible].filter((id) => !hasEdge.has(id));
  const nodes = [];
  const heights = new Map();
  for (const id of connected) {
    const h = nodeHeight(index.byId.get(id));
    heights.set(id, h);
    g.setNode(id, { width: NODE_W, height: h });
  }
  for (const u of unions) g.setNode(u.id, { width: 26, height: 26 });
  for (const e of edges) {
    const minlen = e.type === 'parent' && e.data.direct ? 2 : 1;
    g.setEdge(e.source, e.target, { minlen, weight: e.type === 'partner' || e.type === 'coparent' ? 3 : 1 });
  }
  let maxY = 0;
  let minX = 0;
  let maxX = 0;
  if (connected.length) {
    dagre.layout(g);
    for (const id of connected) {
      const n = g.node(id);
      nodes.push({ id, type: 'person', position: { x: n.x - NODE_W / 2, y: n.y - n.height / 2 }, data: { personId: id, width: NODE_W, height: n.height } });
      maxY = Math.max(maxY, n.y + n.height / 2);
      maxX = Math.max(maxX, n.x + NODE_W / 2);
      minX = Math.min(minX, n.x - NODE_W / 2);
    }
    for (const u of unions) {
      const n = g.node(u.id);
      nodes.push({ id: u.id, type: 'union', position: { x: n.x - 13, y: n.y - 13 }, data: { kind: u.kind, partnership: u.partnership }, selectable: false });
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
    // Сетка близка по пропорциям к холсту, чтобы карточки оставались читаемыми.
    const cols = Math.min(6, Math.max(1, Math.round(Math.sqrt((isolated.length * 1.45 * 110) / (NODE_W + 28)))));
    const startY = connected.length ? maxY + 110 : 60;
    const startX = connected.length ? minX : 0;
    nodes.push({ id: 'section:isolated', type: 'section', position: { x: startX, y: startY - 46 }, data: { count: isolated.length, hasTree: connected.length > 0 }, selectable: false, draggable: false });
    let y = startY;
    for (let i = 0; i < isolated.length; i += cols) {
      const row = isolated.slice(i, i + cols);
      const hs = row.map((id) => nodeHeight(index.byId.get(id)));
      row.forEach((id, k) => {
        nodes.push({ id, type: 'person', position: { x: startX + k * (NODE_W + 28), y }, data: { personId: id, width: NODE_W, height: hs[k], isolated: true } });
      });
      y += Math.max(...hs) + 28;
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
    for (let c = sp.left; c <= sp.right; c++) w += colW.get(c) || 210;
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
