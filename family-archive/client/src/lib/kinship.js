// Родственные подписи. Вычисляются ТОЛЬКО по подтверждённым связям
// (parent_child и partnerships). Предположения здесь не используются.

export const NOT_ENOUGH = 'Недостаточно подтверждённых сведений';

const bySex = (sex, m, f, n) => (sex === 'male' ? m : sex === 'female' ? f : n);
const ENDED = new Set(['divorced', 'separated', 'ended']);

function neighbors(id, index) {
  const out = [];
  for (const r of index.parentsOf.get(id) || []) out.push({ id: r.parent_id, step: 'P', rel: r });
  for (const r of index.childrenOf.get(id) || []) out.push({ id: r.child_id, step: 'C', rel: r });
  for (const r of index.partnersOf.get(id) || []) out.push({ id: r.person1_id === id ? r.person2_id : r.person1_id, step: 'S', rel: r });
  return out;
}

export function findPath(fromId, toId, index, maxDepth = 10) {
  if (fromId === toId) return [];
  const prev = new Map([[fromId, null]]);
  let frontier = [fromId];
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const next = [];
    for (const id of frontier) {
      for (const n of neighbors(id, index)) {
        if (prev.has(n.id)) continue;
        prev.set(n.id, { from: id, step: n.step, rel: n.rel });
        if (n.id === toId) {
          const path = [];
          let cur = toId;
          while (prev.get(cur)) {
            const p = prev.get(cur);
            path.unshift({ id: cur, ...p });
            cur = p.from;
          }
          return path;
        }
        next.push(n.id);
      }
    }
    frontier = next;
  }
  return null;
}

const pra = (n) => 'пра'.repeat(Math.max(0, n));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function siblingLabel(centerId, target, index) {
  const pa = new Set((index.parentsOf.get(centerId) || []).map((r) => r.parent_id));
  const pb = new Set((index.parentsOf.get(target.id) || []).map((r) => r.parent_id));
  const shared = [...pa].filter((x) => pb.has(x));
  const base = bySex(target.sex, 'Брат', 'Сестра', 'Брат или сестра');
  if (shared.length >= 2) return base;
  const otherA = [...pa].filter((x) => !pb.has(x));
  const otherB = [...pb].filter((x) => !pa.has(x));
  if (shared.length === 1 && (otherA.length || otherB.length)) {
    const sp = index.byId.get(shared[0]);
    if (sp?.sex === 'male') return bySex(target.sex, 'Единокровный брат', 'Единокровная сестра', 'Брат или сестра по отцу');
    if (sp?.sex === 'female') return bySex(target.sex, 'Единоутробный брат', 'Единоутробная сестра', 'Брат или сестра по матери');
    return `${base} по одному из родителей`;
  }
  return `${base} (известен один общий родитель)`;
}

export function kinshipLabel(centerId, targetId, index) {
  if (!centerId || !targetId) return null;
  if (centerId === targetId) return { label: 'Центральный человек', path: [] };
  const target = index.byId.get(targetId);
  const center = index.byId.get(centerId);
  if (!target || !center) return null;
  const path = findPath(centerId, targetId, index);
  if (!path) return { label: NOT_ENOUGH, path: null, unknown: true };
  const pat = path.map((p) => p.step).join('');
  const g = target.sex;
  const last = path[path.length - 1];
  const kindNote = (rel) => (rel && rel.kind && !['biological', 'unknown'].includes(rel.kind) ? ({ adoptive: ' (усыновление)', foster: ' (приёмная семья)', step: ' (отчим/мачеха)', guardian: ' (опекун)', other: '' }[rel.kind] || '') : '');
  let label = null;
  if (/^P+$/.test(pat)) {
    const n = pat.length;
    if (n === 1) label = bySex(g, 'Отец', 'Мать', 'Родитель') + kindNote(last.rel);
    else if (n === 2) label = bySex(g, 'Дедушка', 'Бабушка', 'Дедушка или бабушка');
    else label = cap(pra(n - 2) + bySex(g, 'дедушка', 'бабушка', 'дедушка или ' + pra(n - 2) + 'бабушка'));
  } else if (/^C+$/.test(pat)) {
    const n = pat.length;
    if (n === 1) label = bySex(g, 'Сын', 'Дочь', 'Ребёнок') + kindNote(last.rel);
    else if (n === 2) label = bySex(g, 'Внук', 'Внучка', 'Внук или внучка');
    else label = cap(pra(n - 2) + bySex(g, 'внук', 'внучка', 'внук или ' + pra(n - 2) + 'внучка'));
  } else if (pat === 'PC') label = siblingLabel(centerId, target, index);
  else if (pat === 'PPC') label = bySex(g, 'Дядя', 'Тётя', 'Дядя или тётя');
  else if (pat === 'PPPC') label = bySex(g, 'Двоюродный дедушка', 'Двоюродная бабушка', 'Двоюродный дедушка или бабушка');
  else if (pat === 'PCC') label = bySex(g, 'Племянник', 'Племянница', 'Племянник или племянница');
  else if (pat === 'PCCC') label = bySex(g, 'Внучатый племянник', 'Внучатая племянница', 'Внучатый племянник или племянница');
  else if (pat === 'PPCC') label = bySex(g, 'Двоюродный брат', 'Двоюродная сестра', 'Двоюродный брат или сестра');
  else if (pat === 'PPPCCC') label = bySex(g, 'Троюродный брат', 'Троюродная сестра', 'Троюродный брат или сестра');
  else if (pat === 'S') {
    const rel = last.rel;
    const ended = ENDED.has(rel.status) ? 'Бывш. ' : '';
    const base = rel.kind === 'marriage' ? bySex(g, 'муж', 'жена', 'супруг(а)') : bySex(g, 'партнёр', 'партнёрша', 'партнёр(ша)');
    label = ended ? ended + base : cap(base);
  } else if (pat === 'SP') {
    const married = path[0].rel.kind === 'marriage';
    if (married && center.sex === 'male') label = bySex(g, 'Тесть', 'Тёща', 'Родитель жены');
    else if (married && center.sex === 'female') label = bySex(g, 'Свёкор', 'Свекровь', 'Родитель мужа');
    else label = 'Родитель партнёра(ши)';
  } else if (pat === 'CS') label = bySex(g, 'Зять', 'Невестка', 'Супруг(а) или партнёр(ша) ребёнка');
  else if (pat === 'PS') label = last.rel.kind === 'marriage' ? bySex(g, 'Отчим', 'Мачеха', 'Супруг(а) родителя') : 'Партнёр(ша) родителя';
  else if (pat === 'SC') label = bySex(g, 'Пасынок', 'Падчерица', 'Ребёнок партнёра(ши)');
  else if (pat === 'PSC') label = bySex(g, 'Сводный брат', 'Сводная сестра', 'Сводный брат или сестра');
  else if (pat === 'PCS') label = 'Супруг(а) или партнёр(ша) брата/сестры';
  else if (pat === 'SPC') label = 'Брат или сестра партнёра(ши)';
  else if (pat === 'SPP') label = 'Дедушка или бабушка партнёра(ши)';
  else if (pat === 'CCS') label = 'Супруг(а) внука или внучки';
  if (!label) {
    const via = path.slice(0, -1).map((p) => index.byId.get(p.id)?.display_name).filter(Boolean);
    label = `Родственник по подтверждённым связям${via.length ? ` — через ${via.join(' → ')}` : ''}`;
  }
  return { label, path, pattern: pat };
}
