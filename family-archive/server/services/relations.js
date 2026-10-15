// Подтверждённые связи: «родитель — ребёнок» и партнёрства.
// Проверки: нельзя связать человека с самим собой, нельзя создать цикл предков;
// необычные возрасты и противоречивые даты дают предупреждения (не запрет).
import { newId, nowIso, cleanText, oneOf, badRequest, notFound, unprocessable, conflict } from '../lib/util.js';
import { validateDateValue, dateBounds, PRECISIONS } from '../../shared/dates.js';
import { logChange } from './history.js';

export const PARENT_KINDS = ['unknown', 'biological', 'adoptive', 'foster', 'step', 'guardian', 'other'];
export const PARENT_KIND_LABELS = {
  unknown: 'тип не указан',
  biological: 'биологический',
  adoptive: 'усыновление',
  foster: 'приёмная семья',
  step: 'отчим / мачеха',
  guardian: 'опекун',
  other: 'другое',
};
export const PARTNER_KINDS = ['unknown', 'marriage', 'civil', 'partners', 'engagement', 'other'];
export const PARTNER_STATUSES = ['unknown', 'ongoing', 'divorced', 'separated', 'widowed', 'ended'];

const nameOf = (db, id) => db.get('SELECT display_name FROM persons WHERE id = ?', id)?.display_name;

export function ancestorsOf(db, id) {
  const rows = db.all(
    `WITH RECURSIVE anc(id) AS (
       SELECT parent_id FROM parent_child WHERE child_id = ?
       UNION SELECT pc.parent_id FROM parent_child pc JOIN anc ON pc.child_id = anc.id
     ) SELECT id FROM anc`,
    id,
  );
  return new Set(rows.map((r) => r.id));
}

function bounds(p, key) {
  return dateBounds({ precision: p[`${key}_precision`], date: p[`${key}_date`], dateEnd: p[`${key}_date_end`] });
}
const years = (a, b) => (a - b) / 10000;

export function validateParentChild(db, { parentId, childId, excludeId = null }) {
  const errors = [];
  const warnings = [];
  if (!parentId || !childId) {
    errors.push('Не выбраны оба человека');
    return { errors, warnings };
  }
  if (parentId === childId) errors.push('Нельзя указать человека родителем самого себя');
  const parent = db.get('SELECT * FROM persons WHERE id = ?', parentId);
  const child = db.get('SELECT * FROM persons WHERE id = ?', childId);
  if (!parent || !child) {
    errors.push('Человек не найден');
    return { errors, warnings };
  }
  if (errors.length) return { errors, warnings };
  const dup = db.get('SELECT id FROM parent_child WHERE parent_id = ? AND child_id = ?', parentId, childId);
  if (dup && dup.id !== excludeId) errors.push(`Связь уже есть: «${parent.display_name}» — родитель «${child.display_name}»`);
  if (ancestorsOf(db, parentId).has(childId)) {
    errors.push(`Нельзя создать цикл предков: «${child.display_name}» уже является предком «${parent.display_name}»`);
  }
  const reverse = db.get('SELECT id FROM parent_child WHERE parent_id = ? AND child_id = ?', childId, parentId);
  if (reverse && !errors.some((e) => e.startsWith('Нельзя создать цикл'))) errors.push('Обратная связь уже указана: выбранный ребёнок отмечен родителем этого человека');
  const existingParents = db.all('SELECT parent_id FROM parent_child WHERE child_id = ? AND id IS NOT ?', childId, excludeId);
  if (existingParents.length >= 2) {
    warnings.push(`У «${child.display_name}» уже указаны родители: ${existingParents.map((r) => `«${nameOf(db, r.parent_id)}»`).join(', ')}. Добавить ещё одного (например, приёмного)?`);
  }
  const partners = db.get('SELECT id FROM partnerships WHERE (person1_id = ? AND person2_id = ?) OR (person1_id = ? AND person2_id = ?)', parentId, childId, childId, parentId);
  if (partners) warnings.push('Эти люди отмечены как партнёры.');
  const pb = bounds(parent, 'birth');
  const cb = bounds(child, 'birth');
  const pd = bounds(parent, 'death');
  if (pb && cb) {
    if (cb.max < pb.min) warnings.push('По датам родитель родился позже ребёнка.');
    else {
      const ageMax = years(cb.max, pb.min);
      const ageMin = years(cb.min, pb.max);
      if (ageMax < 12) warnings.push(`Возраст родителя при рождении ребёнка — меньше 12 лет.`);
      const limit = parent.sex === 'female' ? 55 : 75;
      if (ageMin > limit) warnings.push(`Возраст родителя при рождении ребёнка — больше ${limit} лет.`);
    }
  }
  if (pd && cb) {
    const grace = parent.sex === 'female' ? 0 : 10000; // до года для отца
    if (cb.min > pd.max + grace) warnings.push('Ребёнок родился после даты смерти родителя.');
  }
  return { errors, warnings };
}

export function validatePartnership(db, { person1Id, person2Id, excludeId = null, startDate = null }) {
  const errors = [];
  const warnings = [];
  if (!person1Id || !person2Id) {
    errors.push('Не выбраны оба человека');
    return { errors, warnings };
  }
  if (person1Id === person2Id) {
    errors.push('Нельзя указать человека партнёром самого себя');
    return { errors, warnings };
  }
  const a = db.get('SELECT * FROM persons WHERE id = ?', person1Id);
  const b = db.get('SELECT * FROM persons WHERE id = ?', person2Id);
  if (!a || !b) {
    errors.push('Человек не найден');
    return { errors, warnings };
  }
  const same = db.all('SELECT id, status FROM partnerships WHERE ((person1_id = ? AND person2_id = ?) OR (person1_id = ? AND person2_id = ?)) AND id IS NOT ?', person1Id, person2Id, person2Id, person1Id, excludeId);
  if (same.length) warnings.push('У этих людей уже есть партнёрство. Сохранить ещё одно (например, повторный брак)?');
  if (ancestorsOf(db, person1Id).has(person2Id) || ancestorsOf(db, person2Id).has(person1Id)) {
    warnings.push('По подтверждённым связям один из них — предок другого.');
  }
  if (startDate) {
    for (const p of [a, b]) {
      const bb = bounds(p, 'birth');
      if (bb && startDate.max < bb.min) warnings.push(`Начало партнёрства раньше рождения «${p.display_name}».`);
      else if (bb && years(startDate.max, bb.min) < 14) warnings.push(`«${p.display_name}» на момент начала партнёрства меньше 14 лет.`);
    }
  }
  return { errors, warnings };
}

function guard({ errors, warnings }, force) {
  if (errors.length) throw unprocessable(errors[0], { errors });
  if (warnings.length && !force) throw conflict('Проверьте сведения', { warnings, needsConfirmation: true });
}

// После создания связи отмечаем совпадающие открытые предположения как подтверждённые.
function confirmMatchingHypotheses(db, type, a, b, relationId, now) {
  const rows = type === 'parent_child'
    ? db.all("SELECT * FROM hypotheses WHERE type = 'parent_child' AND person_a = ? AND person_b = ? AND status <> 'confirmed'", a, b)
    : db.all("SELECT * FROM hypotheses WHERE type = 'partnership' AND ((person_a = ? AND person_b = ?) OR (person_a = ? AND person_b = ?)) AND status <> 'confirmed'", a, b, b, a);
  for (const h of rows) {
    db.run("UPDATE hypotheses SET status = 'confirmed', relation_id = ?, decided_at = ?, updated_at = ? WHERE id = ?", relationId, now, now, h.id);
  }
  return rows.map((h) => h.question_id).filter(Boolean);
}

export function createParentChild(db, input, { actor = 'user', force = false, origin = 'user', hypothesisId = null, importId = null } = {}) {
  const parentId = input.parentId;
  const childId = input.childId;
  guard(validateParentChild(db, { parentId, childId }), force);
  const now = nowIso();
  const id = newId();
  const kind = oneOf(input.kind, PARENT_KINDS, 'unknown', 'Тип родительства');
  db.insert('parent_child', {
    id,
    parent_id: parentId,
    child_id: childId,
    kind,
    kind_note: cleanText(input.kindNote, { max: 300 }),
    notes: cleanText(input.notes, { max: 5000 }),
    origin,
    hypothesis_id: hypothesisId,
    import_id: importId,
    created_at: now,
    updated_at: now,
  });
  const qids = confirmMatchingHypotheses(db, 'parent_child', parentId, childId, id, now);
  logChange(db, {
    actor,
    action: 'relation.parent.create',
    entityType: 'parent_child',
    entityId: id,
    summary: `Подтверждена связь: «${nameOf(db, parentId)}» — родитель «${nameOf(db, childId)}»${kind !== 'unknown' ? ` (${PARENT_KIND_LABELS[kind]})` : ''}`,
    details: { parentId, childId, kind, origin, hypothesisId },
    personIds: [parentId, childId],
  });
  return { id, questionIds: qids };
}

export function updateParentChild(db, id, input, { actor = 'user' } = {}) {
  const r = db.get('SELECT * FROM parent_child WHERE id = ?', id);
  if (!r) throw notFound('Связь не найдена');
  const fields = {};
  if ('kind' in input) fields.kind = oneOf(input.kind, PARENT_KINDS, 'unknown', 'Тип родительства');
  if ('kindNote' in input) fields.kind_note = cleanText(input.kindNote, { max: 300 });
  if ('notes' in input) fields.notes = cleanText(input.notes, { max: 5000 });
  db.update('parent_child', id, { ...fields, updated_at: nowIso() });
  logChange(db, {
    actor,
    action: 'relation.parent.update',
    entityType: 'parent_child',
    entityId: id,
    summary: `Изменена связь «${nameOf(db, r.parent_id)}» — родитель «${nameOf(db, r.child_id)}»`,
    details: { before: r, after: fields },
    personIds: [r.parent_id, r.child_id],
  });
}

function partnershipFields(input) {
  const out = {};
  if ('kind' in input) out.kind = oneOf(input.kind, PARTNER_KINDS, 'unknown', 'Вид партнёрства');
  if ('status' in input) out.status = oneOf(input.status, PARTNER_STATUSES, 'unknown', 'Статус партнёрства');
  for (const [key, label] of [['start', 'Начало'], ['end', 'Окончание']]) {
    if (`${key}Precision` in input) {
      const precision = oneOf(input[`${key}Precision`], PRECISIONS, 'unknown', label);
      const date = precision === 'unknown' ? null : cleanText(input[`${key}Date`], { max: 10 });
      const dateEnd = precision === 'range' ? cleanText(input[`${key}DateEnd`], { max: 10 }) : null;
      const err = validateDateValue({ precision, date, dateEnd }, label);
      if (err) throw unprocessable(err);
      out[`${key}_precision`] = precision;
      out[`${key}_date`] = date;
      out[`${key}_date_end`] = dateEnd;
    }
  }
  if ('notes' in input) out.notes = cleanText(input.notes, { max: 5000 });
  return out;
}

export function createPartnership(db, input, { actor = 'user', force = false, origin = 'user', hypothesisId = null, importId = null } = {}) {
  const { person1Id, person2Id } = input;
  const fields = partnershipFields(input);
  const start = fields.start_precision ? dateBounds({ precision: fields.start_precision, date: fields.start_date, dateEnd: fields.start_date_end }) : null;
  guard(validatePartnership(db, { person1Id, person2Id, startDate: start }), force);
  const now = nowIso();
  const id = newId();
  db.insert('partnerships', {
    id,
    person1_id: person1Id,
    person2_id: person2Id,
    kind: 'unknown',
    status: 'unknown',
    start_precision: 'unknown',
    end_precision: 'unknown',
    ...fields,
    origin,
    hypothesis_id: hypothesisId,
    import_id: importId,
    created_at: now,
    updated_at: now,
  });
  const qids = confirmMatchingHypotheses(db, 'partnership', person1Id, person2Id, id, now);
  logChange(db, {
    actor,
    action: 'relation.partner.create',
    entityType: 'partnership',
    entityId: id,
    summary: `Подтверждено партнёрство: «${nameOf(db, person1Id)}» и «${nameOf(db, person2Id)}»`,
    details: { person1Id, person2Id, ...fields, origin, hypothesisId },
    personIds: [person1Id, person2Id],
  });
  return { id, questionIds: qids };
}

export function updatePartnership(db, id, input, { actor = 'user', force = false } = {}) {
  const r = db.get('SELECT * FROM partnerships WHERE id = ?', id);
  if (!r) throw notFound('Партнёрство не найдено');
  const fields = partnershipFields(input);
  const merged = { ...r, ...fields };
  const start = dateBounds({ precision: merged.start_precision, date: merged.start_date, dateEnd: merged.start_date_end });
  const v = validatePartnership(db, { person1Id: r.person1_id, person2Id: r.person2_id, excludeId: id, startDate: start });
  v.warnings = v.warnings.filter((w) => !w.startsWith('У этих людей уже есть') && !w.startsWith('По подтверждённым'));
  guard(v, force);
  db.update('partnerships', id, { ...fields, updated_at: nowIso() });
  logChange(db, {
    actor,
    action: 'relation.partner.update',
    entityType: 'partnership',
    entityId: id,
    summary: `Изменено партнёрство «${nameOf(db, r.person1_id)}» и «${nameOf(db, r.person2_id)}»`,
    details: { before: r, after: fields },
    personIds: [r.person1_id, r.person2_id],
  });
}

// Удаление связи. Если связь появилась из предположения, оно возвращается в работу
// (или помечается отклонённым — по выбору пользователя).
export function deleteRelation(db, type, id, { actor = 'user', hypothesisStatus = 'open' } = {}) {
  const table = type === 'parent_child' ? 'parent_child' : 'partnerships';
  const r = db.get(`SELECT * FROM ${table} WHERE id = ?`, id);
  if (!r) throw notFound('Связь не найдена');
  db.run(`DELETE FROM ${table} WHERE id = ?`, id);
  const now = nowIso();
  const status = hypothesisStatus === 'rejected' ? 'rejected' : 'open';
  const hyps = db.all('SELECT * FROM hypotheses WHERE relation_id = ?', id);
  for (const h of hyps) {
    db.run('UPDATE hypotheses SET status = ?, relation_id = NULL, decided_at = ?, updated_at = ? WHERE id = ?', status, status === 'open' ? null : now, now, h.id);
  }
  const persons = type === 'parent_child' ? [r.parent_id, r.child_id] : [r.person1_id, r.person2_id];
  logChange(db, {
    actor,
    action: type === 'parent_child' ? 'relation.parent.delete' : 'relation.partner.delete',
    entityType: table,
    entityId: id,
    summary: type === 'parent_child'
      ? `Удалена связь: «${nameOf(db, r.parent_id)}» — родитель «${nameOf(db, r.child_id)}»`
      : `Удалено партнёрство: «${nameOf(db, r.person1_id)}» и «${nameOf(db, r.person2_id)}»`,
    details: { relation: r, hypotheses: hyps.map((h) => h.id), hypothesisStatus: status },
    personIds: persons,
  });
  return { questionIds: hyps.map((h) => h.question_id).filter(Boolean) };
}

export function checkRelation(db, input) {
  if (input.type === 'parent_child') return validateParentChild(db, { parentId: input.parentId, childId: input.childId });
  if (input.type === 'partnership') return validatePartnership(db, { person1Id: input.person1Id, person2Id: input.person2Id });
  throw badRequest('Неизвестный тип связи');
}
