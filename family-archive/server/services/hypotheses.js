// Предположения и вопросы для уточнения.
import { nowIso, notFound, badRequest, cleanText, oneOf, parseJson } from '../lib/util.js';
import { createParentChild, createPartnership, deleteRelation } from './relations.js';
import { mergePersons } from './persons.js';
import { logChange } from './history.js';

const nameOf = (db, id) => db.get('SELECT display_name FROM persons WHERE id = ?', id)?.display_name;

export function describeHypothesis(db, h) {
  const a = nameOf(db, h.person_a);
  const b = nameOf(db, h.person_b);
  if (h.type === 'parent_child') return `«${a}» — родитель «${b}»`;
  if (h.type === 'partnership') return `«${a}» и «${b}» — пара`;
  return `«${a}» и «${b}» — один человек`;
}

// Автоматическое состояние вопроса: решён, когда по всем предположениям принято решение.
export function refreshQuestions(db, questionIds) {
  const now = nowIso();
  for (const qid of new Set(questionIds.filter(Boolean))) {
    const q = db.get('SELECT * FROM questions WHERE id = ?', qid);
    if (!q) continue;
    const open = db.get("SELECT COUNT(*) AS n FROM hypotheses WHERE question_id = ? AND status IN ('open', 'deferred')", qid).n;
    const total = db.get('SELECT COUNT(*) AS n FROM hypotheses WHERE question_id = ?', qid).n;
    if (total > 0 && open === 0 && q.status !== 'resolved') {
      db.run("UPDATE questions SET status = 'resolved', status_note = 'auto', updated_at = ? WHERE id = ?", now, qid);
    } else if (open > 0 && q.status === 'resolved' && q.status_note === 'auto') {
      db.run("UPDATE questions SET status = 'open', status_note = NULL, updated_at = ? WHERE id = ?", now, qid);
    }
  }
}

function getHyp(db, id) {
  const h = db.get('SELECT * FROM hypotheses WHERE id = ?', id);
  if (!h) throw notFound('Предположение не найдено');
  return h;
}

export function confirmHypothesis(db, id, input = {}, { force = false } = {}) {
  const h = getHyp(db, id);
  if (h.status === 'confirmed') throw badRequest('Предположение уже подтверждено');
  let res;
  if (h.type === 'parent_child') {
    res = createParentChild(db, { parentId: h.person_a, childId: h.person_b, kind: input.kind, kindNote: input.kindNote, notes: input.notes }, { force, origin: 'hypothesis', hypothesisId: h.id });
  } else if (h.type === 'partnership') {
    res = createPartnership(db, { person1Id: h.person_a, person2Id: h.person_b, kind: input.kind, status: input.status, notes: input.notes }, { force, origin: 'hypothesis', hypothesisId: h.id });
  } else {
    // «Один и тот же человек»: объединение записей.
    const primary = input.primaryId === h.person_b ? h.person_b : h.person_a;
    const secondary = primary === h.person_a ? h.person_b : h.person_a;
    const now = nowIso();
    db.run("UPDATE hypotheses SET status = 'confirmed', decided_at = ?, updated_at = ? WHERE id = ?", now, now, h.id);
    mergePersons(db, primary, secondary, input.choices || {}, { hypothesisId: h.id });
    // Предположения между объединёнными записями теряют смысл и удаляются при объединении,
    // поэтому вопрос отмечается решённым явно.
    if (h.question_id) db.run("UPDATE questions SET status = 'resolved', status_note = 'auto', updated_at = ? WHERE id = ?", now, h.question_id);
    return { mergedInto: primary };
  }
  // Связь могла подтвердить и это, и совпадающие предположения.
  db.run("UPDATE hypotheses SET status = 'confirmed', relation_id = ?, decided_at = ?, updated_at = ?, decision_note = ? WHERE id = ?", res.id, nowIso(), nowIso(), cleanText(input.note, { max: 2000 }), h.id);
  refreshQuestions(db, [h.question_id, ...res.questionIds]);
  return { relationId: res.id };
}

export function rejectHypothesis(db, id, { note } = {}) {
  const h = getHyp(db, id);
  if (h.status === 'confirmed' && h.relation_id) throw badRequest('Предположение подтверждено. Сначала отмените подтверждение.');
  const now = nowIso();
  db.run("UPDATE hypotheses SET status = 'rejected', decided_at = ?, decision_note = ?, updated_at = ? WHERE id = ?", now, cleanText(note, { max: 2000 }), now, id);
  logChange(db, {
    action: 'hypothesis.reject',
    entityType: 'hypothesis',
    entityId: id,
    summary: `Отклонено предположение: ${describeHypothesis(db, h)}`,
    personIds: [h.person_a, h.person_b],
  });
  refreshQuestions(db, [h.question_id]);
}

// Вернуть предположение в работу: для подтверждённого — удалить созданную связь.
export function reopenHypothesis(db, id) {
  const h = getHyp(db, id);
  const now = nowIso();
  if (h.status === 'confirmed' && h.relation_id) {
    const pc = db.get('SELECT id FROM parent_child WHERE id = ?', h.relation_id);
    const type = pc ? 'parent_child' : 'partnership';
    deleteRelation(db, type, h.relation_id, { hypothesisStatus: 'open' });
  } else {
    db.run("UPDATE hypotheses SET status = 'open', relation_id = NULL, decided_at = NULL, decision_note = NULL, updated_at = ? WHERE id = ?", now, id);
    logChange(db, {
      action: 'hypothesis.reopen',
      entityType: 'hypothesis',
      entityId: id,
      summary: `Предположение возвращено в работу: ${describeHypothesis(db, h)}`,
      personIds: [h.person_a, h.person_b],
    });
  }
  refreshQuestions(db, [h.question_id]);
}

export function setQuestionStatus(db, id, status) {
  const q = db.get('SELECT * FROM questions WHERE id = ?', id);
  if (!q) throw notFound('Вопрос не найден');
  const st = oneOf(status, ['open', 'deferred', 'resolved'], null, 'Статус вопроса');
  if (!st) throw badRequest('Не указан статус');
  db.run('UPDATE questions SET status = ?, status_note = ?, updated_at = ? WHERE id = ?', st, 'manual', nowIso(), id);
  const persons = db.all('SELECT person_id FROM question_persons WHERE question_id = ?', id).map((r) => r.person_id);
  const label = { open: 'возвращён в работу', deferred: 'отложен', resolved: 'отмечен решённым' }[st];
  logChange(db, { action: 'question.status', entityType: 'question', entityId: id, summary: `Вопрос ${label}: ${q.title}`, personIds: persons });
}

export function setNameReviewStatus(db, id, status) {
  const r = db.get('SELECT * FROM name_reviews WHERE id = ?', id);
  if (!r) throw notFound('Задача не найдена');
  const st = oneOf(status, ['open', 'kept', 'changed', 'dismissed'], null, 'Статус');
  if (!st) throw badRequest('Не указан статус');
  db.run('UPDATE name_reviews SET status = ?, decided_at = ? WHERE id = ?', st, st === 'open' ? null : nowIso(), id);
  logChange(db, {
    action: 'name_review.status',
    entityType: 'name_review',
    entityId: id,
    summary: st === 'kept' ? 'Написание оставлено как в источнике' : st === 'changed' ? 'Написание исправлено' : st === 'open' ? 'Проверка написания возвращена' : 'Проверка написания скрыта',
    personIds: parseJson(r.person_ids, []),
  });
}
