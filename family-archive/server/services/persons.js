// Люди: создание, изменение, удаление с предпросмотром последствий, объединение дублей.
import { newId, nowIso, cleanText, oneOf, badRequest, notFound, unprocessable, conflict, parseJson } from '../lib/util.js';
import { validateDateValue, dateBounds, PRECISIONS } from '../../shared/dates.js';
import { normalizeSpaces } from '../../shared/names.js';
import { logChange } from './history.js';
import { ancestorsOf } from './relations.js';

export const TEXT_FIELDS = ['display_name', 'surname', 'given_name', 'patronymic', 'birth_surname', 'birth_place', 'death_place', 'birth_date_note', 'death_date_note'];
export const LONG_FIELDS = ['biography', 'notes'];
const DATE_GROUPS = [
  { key: 'birth', label: 'Дата рождения' },
  { key: 'death', label: 'Дата смерти' },
];

export const FIELD_LABELS = {
  display_name: 'Отображаемое имя',
  surname: 'Фамилия',
  given_name: 'Имя',
  patronymic: 'Отчество',
  birth_surname: 'Фамилия при рождении',
  other_names: 'Другие имена',
  sex: 'Пол',
  life_status: 'Жизненный статус',
  birth_precision: 'Точность даты рождения',
  birth_date: 'Дата рождения',
  birth_date_end: 'Дата рождения (конец диапазона)',
  birth_date_note: 'Пояснение к дате рождения',
  death_precision: 'Точность даты смерти',
  death_date: 'Дата смерти',
  death_date_end: 'Дата смерти (конец диапазона)',
  death_date_note: 'Пояснение к дате смерти',
  birth_place: 'Место рождения',
  death_place: 'Место смерти',
  biography: 'Биография',
  notes: 'Заметки',
  name_fields_status: 'Разбор ФИО',
};

export function serializePerson(row) {
  if (!row) return row;
  return { ...row, other_names: parseJson(row.other_names, []) };
}

export function getPerson(db, id) {
  const row = db.get('SELECT * FROM persons WHERE id = ?', id);
  if (!row) throw notFound('Человек не найден');
  return serializePerson(row);
}

// Приводит ввод формы к полям таблицы. partial=true — изменяются только переданные поля.
export function normalizePersonInput(input, { partial = false, existing = null } = {}) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k);
  for (const f of TEXT_FIELDS) if (!partial || has(f)) out[f] = cleanText(input[f], { max: 500 });
  for (const f of LONG_FIELDS) if (!partial || has(f)) out[f] = cleanText(input[f], { max: 100000 });
  if (!partial || has('other_names')) {
    const arr = Array.isArray(input.other_names) ? input.other_names : typeof input.other_names === 'string' ? input.other_names.split('\n') : [];
    const seen = new Set();
    const clean = [];
    for (const v of arr) {
      const t = cleanText(v, { max: 300 });
      if (t && !seen.has(t)) {
        seen.add(t);
        clean.push(t);
      }
    }
    out.other_names = JSON.stringify(clean);
  }
  if (!partial || has('sex')) out.sex = oneOf(input.sex, ['male', 'female', 'other'], null, 'Пол');
  if (!partial || has('life_status')) out.life_status = oneOf(input.life_status, ['unknown', 'alive', 'deceased'], 'unknown', 'Жизненный статус');
  for (const g of DATE_GROUPS) {
    const pk = `${g.key}_precision`;
    if (!partial || has(pk) || has(`${g.key}_date`)) {
      const precision = oneOf(input[pk], PRECISIONS, 'unknown', g.label);
      const date = precision === 'unknown' ? null : cleanText(input[`${g.key}_date`], { max: 10 });
      const dateEnd = precision === 'range' ? cleanText(input[`${g.key}_date_end`], { max: 10 }) : null;
      const err = validateDateValue({ precision, date, dateEnd }, g.label);
      if (err) throw unprocessable(err, { field: `${g.key}_date` });
      out[pk] = precision;
      out[`${g.key}_date`] = date;
      out[`${g.key}_date_end`] = dateEnd;
    }
  }
  if (has('name_fields_status')) out.name_fields_status = oneOf(input.name_fields_status, ['suggested', 'confirmed', 'manual'], 'manual', 'Разбор ФИО');

  // Отображаемое имя: если не указано, собирается из частей; без имени сохранять нельзя.
  const merged = { ...(existing || {}), ...out };
  if (!partial || has('display_name') || !merged.display_name) {
    if (!merged.display_name) {
      const composed = normalizeSpaces([merged.surname, merged.given_name, merged.patronymic].filter(Boolean).join(' '));
      if (!composed) throw unprocessable('Укажите хотя бы отображаемое имя или одну из частей ФИО', { field: 'display_name' });
      out.display_name = composed;
    }
  }
  return out;
}

// Предупреждения о противоречиях: данные сохраняются, если пользователь подтвердит.
export function personWarnings(p) {
  const w = [];
  const b = dateBounds({ precision: p.birth_precision, date: p.birth_date, dateEnd: p.birth_date_end });
  const d = dateBounds({ precision: p.death_precision, date: p.death_date, dateEnd: p.death_date_end });
  const today = Number(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
  if (b && d && d.max < b.min) w.push('Дата смерти раньше даты рождения.');
  if (b && b.min > today) w.push('Дата рождения в будущем.');
  if (d && d.min > today) w.push('Дата смерти в будущем.');
  if (d && p.life_status === 'alive') w.push('Указана дата смерти, а жизненный статус — «жив».');
  if (b && p.life_status === 'alive' && (today - b.max) / 10000 > 115) w.push('Возраст больше 115 лет при статусе «жив».');
  if (b && d && (d.min - b.max) / 10000 > 115) w.push('Продолжительность жизни больше 115 лет.');
  return w;
}

export function createPerson(db, input, { actor = 'user', force = false, origin = 'user' } = {}) {
  const fields = normalizePersonInput(input);
  const warnings = personWarnings(fields);
  if (warnings.length && !force) throw conflict('Проверьте сведения', { warnings, needsConfirmation: true });
  const id = newId();
  const now = nowIso();
  const row = {
    id,
    ...fields,
    name_fields_status: fields.name_fields_status || 'manual',
    origin,
    last_manual_edit_at: actor === 'user' ? now : null,
    created_at: now,
    updated_at: now,
  };
  db.insert('persons', row);
  if (actor === 'user') {
    logChange(db, { actor, action: 'person.create', entityType: 'person', entityId: id, summary: `Добавлен человек «${row.display_name}»`, details: { after: fields }, personIds: [id] });
  }
  return getPerson(db, id);
}

export function updatePerson(db, id, input, { actor = 'user', force = false } = {}) {
  const before = getPerson(db, id);
  const beforeRow = db.get('SELECT * FROM persons WHERE id = ?', id);
  const fields = normalizePersonInput(input, { partial: true, existing: beforeRow });
  // Изменение частей ФИО пользователем = разбор подтверждён.
  if (actor === 'user' && ['surname', 'given_name', 'patronymic'].some((k) => k in fields && fields[k] !== beforeRow[k]) && !('name_fields_status' in fields)) {
    fields.name_fields_status = 'confirmed';
  }
  const after = { ...beforeRow, ...fields };
  const warnings = personWarnings(after);
  if (warnings.length && !force) throw conflict('Проверьте сведения', { warnings, needsConfirmation: true });
  const changed = {};
  for (const [k, v] of Object.entries(fields)) if (beforeRow[k] !== v) changed[k] = { before: beforeRow[k], after: v };
  if (!Object.keys(changed).length) return before;
  const now = nowIso();
  db.update('persons', id, { ...fields, updated_at: now, ...(actor === 'user' ? { last_manual_edit_at: now } : {}) });
  logChange(db, {
    actor,
    action: 'person.update',
    entityType: 'person',
    entityId: id,
    summary: `Изменены сведения: ${Object.keys(changed).map((k) => FIELD_LABELS[k] || k).join(', ')}`,
    details: { changes: changed },
    personIds: [id],
  });
  return getPerson(db, id);
}

export function deletePreview(db, id) {
  const p = getPerson(db, id);
  const name = (pid) => db.get('SELECT display_name FROM persons WHERE id = ?', pid)?.display_name;
  const parents = db.all('SELECT * FROM parent_child WHERE child_id = ?', id).map((r) => ({ id: r.id, type: 'parent', person: name(r.parent_id) }));
  const children = db.all('SELECT * FROM parent_child WHERE parent_id = ?', id).map((r) => ({ id: r.id, type: 'child', person: name(r.child_id) }));
  const partners = db.all('SELECT * FROM partnerships WHERE person1_id = ? OR person2_id = ?', id, id).map((r) => ({ id: r.id, type: 'partner', person: name(r.person1_id === id ? r.person2_id : r.person1_id) }));
  return {
    person: { id: p.id, display_name: p.display_name },
    relations: [...parents, ...children, ...partners],
    photos: db.get('SELECT COUNT(*) AS n FROM photos WHERE person_id = ?', id).n,
    sources: db.get('SELECT COUNT(*) AS n FROM sources WHERE person_id = ?', id).n,
    hypotheses: db.get('SELECT COUNT(*) AS n FROM hypotheses WHERE person_a = ? OR person_b = ?', id, id).n,
    sourceRecords: db.all("SELECT sheet_name, cell FROM source_records WHERE person_id = ? AND status = 'active'", id).map((r) => `${r.sheet_name}!${r.cell}`),
  };
}

// Удаление. Возвращает список каталогов фотографий, которые нужно удалить после фиксации.
export function deletePerson(db, id, { actor = 'user', reason = null } = {}) {
  const preview = deletePreview(db, id);
  const snapshot = {
    person: db.get('SELECT * FROM persons WHERE id = ?', id),
    parentChild: db.all('SELECT * FROM parent_child WHERE parent_id = ? OR child_id = ?', id, id),
    partnerships: db.all('SELECT * FROM partnerships WHERE person1_id = ? OR person2_id = ?', id, id),
    sources: db.all('SELECT * FROM sources WHERE person_id = ?', id),
  };
  const photoIds = db.all('SELECT id FROM photos WHERE person_id = ?', id).map((r) => r.id);
  const related = [
    ...snapshot.parentChild.map((r) => (r.parent_id === id ? r.child_id : r.parent_id)),
    ...snapshot.partnerships.map((r) => (r.person1_id === id ? r.person2_id : r.person1_id)),
  ];
  db.run("UPDATE source_records SET status = 'person_deleted' WHERE person_id = ? AND status = 'active'", id);
  const questionIds = db.all('SELECT question_id FROM question_persons WHERE person_id = ?', id).map((r) => r.question_id);
  db.run('DELETE FROM persons WHERE id = ?', id);
  // Вопросы, у которых не осталось предположений и людей, теряют смысл.
  for (const qid of questionIds) {
    const left = db.get('SELECT COUNT(*) AS n FROM question_persons WHERE question_id = ?', qid).n;
    const hyps = db.get('SELECT COUNT(*) AS n FROM hypotheses WHERE question_id = ?', qid).n;
    if (left < 2 && hyps === 0) db.run('DELETE FROM questions WHERE id = ?', qid);
  }
  logChange(db, {
    actor,
    action: 'person.delete',
    entityType: 'person',
    entityId: id,
    summary: `Удалён человек «${preview.person.display_name}»${reason ? ` (${reason})` : ''}; связей удалено: ${preview.relations.length}`,
    details: { snapshot },
    personIds: [id, ...related],
  });
  return { photoIds, preview };
}

// ---------- Объединение дублей ----------

const MERGE_FIELDS = ['display_name', 'surname', 'given_name', 'patronymic', 'birth_surname', 'sex', 'birth_place', 'death_place', 'biography', 'notes'];
const MERGE_GROUPS = {
  birth: ['birth_precision', 'birth_date', 'birth_date_end', 'birth_date_note'],
  death: ['death_precision', 'death_date', 'death_date_end', 'death_date_note'],
};

function isEmptyValue(field, v) {
  if (field.endsWith('_precision')) return !v || v === 'unknown';
  return v == null || v === '';
}

export function mergePreview(db, primaryId, secondaryId) {
  if (primaryId === secondaryId) throw badRequest('Нельзя объединить человека с самим собой');
  const a = db.get('SELECT * FROM persons WHERE id = ?', primaryId);
  const b = db.get('SELECT * FROM persons WHERE id = ?', secondaryId);
  if (!a || !b) throw notFound('Человек не найден');
  const blockers = [];
  const direct = db.get('SELECT id FROM parent_child WHERE (parent_id = ? AND child_id = ?) OR (parent_id = ? AND child_id = ?)', primaryId, secondaryId, secondaryId, primaryId);
  if (direct) blockers.push('Между записями подтверждена связь «родитель — ребёнок». Сначала удалите её, если это действительно один человек.');
  else if (ancestorsOf(db, primaryId).has(secondaryId) || ancestorsOf(db, secondaryId).has(primaryId)) {
    blockers.push('Одна запись является предком другой по подтверждённым связям — объединение создало бы цикл предков.');
  }
  const conflicts = [];
  for (const f of MERGE_FIELDS) {
    if (!isEmptyValue(f, a[f]) && !isEmptyValue(f, b[f]) && a[f] !== b[f]) conflicts.push({ field: f, label: FIELD_LABELS[f], primary: a[f], secondary: b[f] });
  }
  for (const [g, fields] of Object.entries(MERGE_GROUPS)) {
    const pa = fields.map((f) => a[f]);
    const pb = fields.map((f) => b[f]);
    if (!isEmptyValue(fields[0], a[fields[0]]) && !isEmptyValue(fields[0], b[fields[0]]) && JSON.stringify(pa) !== JSON.stringify(pb)) {
      conflicts.push({ field: g, label: g === 'birth' ? 'Дата рождения' : 'Дата смерти', primary: pa, secondary: pb });
    }
  }
  if (a.life_status !== 'unknown' && b.life_status !== 'unknown' && a.life_status !== b.life_status) {
    conflicts.push({ field: 'life_status', label: FIELD_LABELS.life_status, primary: a.life_status, secondary: b.life_status });
  }
  const count = (sql, ...p) => db.get(sql, ...p).n;
  return {
    primary: serializePerson(a),
    secondary: serializePerson(b),
    blockers,
    conflicts,
    moves: {
      parentChild: count('SELECT COUNT(*) AS n FROM parent_child WHERE parent_id = ? OR child_id = ?', secondaryId, secondaryId),
      partnerships: count('SELECT COUNT(*) AS n FROM partnerships WHERE person1_id = ? OR person2_id = ?', secondaryId, secondaryId),
      photos: count('SELECT COUNT(*) AS n FROM photos WHERE person_id = ?', secondaryId),
      sources: count('SELECT COUNT(*) AS n FROM sources WHERE person_id = ?', secondaryId),
      sourceRecords: count('SELECT COUNT(*) AS n FROM source_records WHERE person_id = ?', secondaryId),
    },
  };
}

// Выбор при слиянии: только известные поля и значения «primary»/«secondary».
function cleanChoices(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const k of [...MERGE_FIELDS, ...Object.keys(MERGE_GROUPS), 'life_status']) {
    if (input[k] === 'primary' || input[k] === 'secondary') out[k] = input[k];
  }
  return out;
}

export function mergePersons(db, primaryId, secondaryId, rawChoices = {}, { hypothesisId = null } = {}) {
  const choices = cleanChoices(rawChoices);
  const preview = mergePreview(db, primaryId, secondaryId);
  if (preview.blockers.length) throw unprocessable(preview.blockers[0], { blockers: preview.blockers });
  const a = db.get('SELECT * FROM persons WHERE id = ?', primaryId);
  const b = db.get('SELECT * FROM persons WHERE id = ?', secondaryId);
  const upd = {};
  for (const f of MERGE_FIELDS) {
    if (isEmptyValue(f, a[f]) && !isEmptyValue(f, b[f])) upd[f] = b[f];
    else if (!isEmptyValue(f, a[f]) && !isEmptyValue(f, b[f]) && a[f] !== b[f] && choices[f] === 'secondary') upd[f] = b[f];
  }
  for (const [g, fields] of Object.entries(MERGE_GROUPS)) {
    const takeB = (isEmptyValue(fields[0], a[fields[0]]) && !isEmptyValue(fields[0], b[fields[0]])) || choices[g] === 'secondary';
    if (takeB) for (const f of fields) upd[f] = b[f];
  }
  if (a.life_status === 'unknown' && b.life_status !== 'unknown') upd.life_status = b.life_status;
  else if (choices.life_status === 'secondary') upd.life_status = b.life_status;
  // Варианты имени сохраняются как «другие имена».
  const names = new Set([...parseJson(a.other_names, []), ...parseJson(b.other_names, [])]);
  const finalDisplay = upd.display_name || a.display_name;
  for (const n of [a.display_name, b.display_name]) if (n && n !== finalDisplay) names.add(n);
  upd.other_names = JSON.stringify([...names]);
  if (!a.primary_photo_id && b.primary_photo_id) upd.primary_photo_id = b.primary_photo_id;
  const now = nowIso();
  upd.updated_at = now;
  upd.last_manual_edit_at = now;
  if (a.name_fields_status === 'suggested' && b.name_fields_status !== 'suggested') upd.name_fields_status = b.name_fields_status;
  db.update('persons', primaryId, upd);

  // Связи «родитель — ребёнок».
  for (const r of db.all('SELECT * FROM parent_child WHERE parent_id = ?', secondaryId)) {
    const dup = db.get('SELECT id FROM parent_child WHERE parent_id = ? AND child_id = ?', primaryId, r.child_id);
    if (dup || r.child_id === primaryId) db.run('DELETE FROM parent_child WHERE id = ?', r.id);
    else db.run('UPDATE parent_child SET parent_id = ?, updated_at = ? WHERE id = ?', primaryId, now, r.id);
  }
  for (const r of db.all('SELECT * FROM parent_child WHERE child_id = ?', secondaryId)) {
    const dup = db.get('SELECT id FROM parent_child WHERE parent_id = ? AND child_id = ?', r.parent_id, primaryId);
    if (dup || r.parent_id === primaryId) db.run('DELETE FROM parent_child WHERE id = ?', r.id);
    else db.run('UPDATE parent_child SET child_id = ?, updated_at = ? WHERE id = ?', primaryId, now, r.id);
  }
  // Партнёрства.
  for (const r of db.all('SELECT * FROM partnerships WHERE person1_id = ? OR person2_id = ?', secondaryId, secondaryId)) {
    const other = r.person1_id === secondaryId ? r.person2_id : r.person1_id;
    if (other === primaryId) {
      db.run('DELETE FROM partnerships WHERE id = ?', r.id);
      continue;
    }
    const col = r.person1_id === secondaryId ? 'person1_id' : 'person2_id';
    db.run(`UPDATE partnerships SET ${col} = ?, updated_at = ? WHERE id = ?`, primaryId, now, r.id);
  }
  // Предположения.
  for (const h of db.all('SELECT * FROM hypotheses WHERE person_a = ? OR person_b = ?', secondaryId, secondaryId)) {
    const na = h.person_a === secondaryId ? primaryId : h.person_a;
    const nb = h.person_b === secondaryId ? primaryId : h.person_b;
    if (na === nb) {
      db.run('DELETE FROM hypotheses WHERE id = ?', h.id);
      continue;
    }
    const dup = h.type === 'parent_child'
      ? db.get('SELECT id FROM hypotheses WHERE type = ? AND person_a = ? AND person_b = ? AND id <> ?', h.type, na, nb, h.id)
      : db.get('SELECT id FROM hypotheses WHERE type = ? AND ((person_a = ? AND person_b = ?) OR (person_a = ? AND person_b = ?)) AND id <> ?', h.type, na, nb, nb, na, h.id);
    if (dup) db.run('DELETE FROM hypotheses WHERE id = ?', h.id);
    else db.run('UPDATE hypotheses SET person_a = ?, person_b = ?, updated_at = ? WHERE id = ?', na, nb, now, h.id);
  }
  for (const qp of db.all('SELECT * FROM question_persons WHERE person_id = ?', secondaryId)) {
    db.run('INSERT OR IGNORE INTO question_persons (question_id, person_id, role, position) VALUES (?, ?, ?, ?)', qp.question_id, primaryId, qp.role, qp.position);
  }
  db.run('UPDATE photos SET person_id = ? WHERE person_id = ?', primaryId, secondaryId);
  db.run('UPDATE sources SET person_id = ? WHERE person_id = ?', primaryId, secondaryId);
  db.run('UPDATE source_records SET person_id = ? WHERE person_id = ?', primaryId, secondaryId);
  db.run('INSERT OR IGNORE INTO change_log_persons (log_id, person_id) SELECT log_id, ? FROM change_log_persons WHERE person_id = ?', primaryId, secondaryId);
  db.run('DELETE FROM persons WHERE id = ?', secondaryId);
  logChange(db, {
    action: 'person.merge',
    entityType: 'person',
    entityId: primaryId,
    summary: `Записи «${a.display_name}» и «${b.display_name}» объединены в одну`,
    details: { primary: a, secondary: b, choices, hypothesisId },
    personIds: [primaryId, secondaryId],
  });
  return getPerson(db, primaryId);
}
