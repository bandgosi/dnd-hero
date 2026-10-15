// Импорт Excel: предпросмотр, сверка версий, атомарное сохранение и откат.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readWorkbook, XlsxError } from '../xlsx/reader.js';
import { analyzeWorkbook } from '../import/analyze.js';
import { newId, nowIso, sha256, badRequest, notFound, unprocessable, conflict, cleanText, parseJson } from '../lib/util.js';
import { searchKey, parseFullName } from '../../shared/names.js';
import { logChange } from './history.js';
import { createParentChild, createPartnership } from './relations.js';
import { refreshQuestions } from './hypotheses.js';
import { deletePerson } from './persons.js';

const previews = new Map();
const NAME_REVERT_FIELDS = ['display_name', 'surname', 'given_name', 'patronymic', 'name_fields_status'];
const PREVIEW_TTL_MS = 60 * 60 * 1000;

export function fileNameKey(name) {
  return String(name || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\.(xlsx|xlsm|xls)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const PREVIEWS_KEEP = 3;

// Предпросмотры держат файл в памяти: устаревшие удаляются, свежих хранится не больше нескольких.
function cleanupPreviews() {
  const now = Date.now();
  for (const [id, p] of previews) if (now - p.createdAt > PREVIEW_TTL_MS) previews.delete(id);
  while (previews.size >= PREVIEWS_KEEP) previews.delete(previews.keys().next().value);
}

function personBrief(db, id) {
  if (!id) return null;
  const p = db.get('SELECT id, display_name, last_manual_edit_at, name_fields_status FROM persons WHERE id = ?', id);
  return p || null;
}

// Поиск предыдущей версии того же файла: по совпадению записей (лист, ячейка, текст) и имени файла.
function findPrevious(db, records, nameKey) {
  const imports = db.all("SELECT * FROM imports WHERE status = 'completed' ORDER BY created_at DESC");
  let best = null;
  for (const imp of imports) {
    const old = db.all("SELECT sheet_name, cell, raw_text FROM source_records WHERE import_id = ? AND status = 'active'", imp.id);
    if (!old.length) continue;
    const oldSet = new Set(old.map((r) => `${r.sheet_name}!${r.cell}|${r.raw_text.trim()}`));
    const matched = records.filter((r) => oldSet.has(`${r.key}|${r.text}`)).length;
    const score = matched / Math.max(records.length, old.length);
    const sameName = imp.file_name_key === nameKey;
    if ((score >= 0.5 || (sameName && score >= 0.2)) && (!best || score > best.score)) best = { imp, score };
  }
  return best?.imp || null;
}

function buildDiff(db, previous, records) {
  const old = db.all("SELECT * FROM source_records WHERE import_id = ? AND status = 'active'", previous.id);
  const oldByKey = new Map(old.map((r) => [`${r.sheet_name}!${r.cell}`, r]));
  const newKeys = new Set(records.map((r) => r.key));
  const usedOld = new Set();
  const entries = [];
  for (const r of records) {
    const o = oldByKey.get(r.key);
    if (o) {
      usedOld.add(o.id);
      const person = personBrief(db, o.person_id);
      if (!person) {
        entries.push({ key: r.key, status: 'person_deleted', old: { id: o.id, raw: o.raw_text }, defaultAction: 'skip', actions: ['skip', 'create'] });
      } else if (o.raw_text.trim() === r.text) {
        entries.push({ key: r.key, status: 'unchanged', old: { id: o.id, raw: o.raw_text }, person, defaultAction: 'link', actions: ['link'], whitespaceOnly: o.raw_text !== r.raw });
      } else {
        const edited = !!(person.last_manual_edit_at && person.last_manual_edit_at > o.created_at) || person.display_name !== o.raw_text.trim();
        entries.push({
          key: r.key,
          status: 'changed',
          old: { id: o.id, raw: o.raw_text },
          person,
          personEdited: edited,
          defaultAction: edited ? 'keep' : 'update_name',
          actions: ['update_name', 'keep', 'create'],
        });
      }
    } else {
      entries.push({ key: r.key, status: 'new', defaultAction: 'create', actions: ['create', 'link', 'skip'] });
    }
  }
  // Перемещённые записи: тот же текст в другой ячейке.
  for (const e of entries.filter((x) => x.status === 'new')) {
    const r = records.find((x) => x.key === e.key);
    const o = old.find((x) => !usedOld.has(x.id) && !newKeys.has(`${x.sheet_name}!${x.cell}`) && x.raw_text.trim() === r.text);
    if (o) {
      usedOld.add(o.id);
      const person = personBrief(db, o.person_id);
      if (person) Object.assign(e, { status: 'moved', old: { id: o.id, raw: o.raw_text, cell: `${o.sheet_name}!${o.cell}` }, person, defaultAction: 'link', actions: ['link', 'create'] });
      else usedOld.delete(o.id);
    }
  }
  const removed = old.filter((o) => !usedOld.has(o.id)).map((o) => ({ key: `${o.sheet_name}!${o.cell}`, status: 'removed', old: { id: o.id, raw: o.raw_text }, person: personBrief(db, o.person_id) }));
  return { previousImportId: previous.id, entries, removed };
}

export function createPreview(db, config, { buffer, fileName, includeHidden = false }) {
  cleanupPreviews();
  if (!buffer?.length) throw badRequest('Файл пустой');
  if (buffer.length > config.maxImportBytes) throw unprocessable(`Файл больше ${Math.round(config.maxImportBytes / 1024 / 1024)} МБ`);
  const checksum = sha256(buffer);
  let wb;
  try {
    wb = readWorkbook(buffer);
  } catch (e) {
    if (e instanceof XlsxError) throw unprocessable(e.message);
    throw unprocessable('Не удалось прочитать файл Excel. Убедитесь, что это файл .xlsx.');
  }
  let analysis;
  try {
    analysis = analyzeWorkbook(wb, { includeHidden });
  } catch (e) {
    if (e instanceof XlsxError) throw unprocessable(e.message);
    throw e;
  }
  const nameKey = fileNameKey(fileName);
  const duplicate = db.get("SELECT * FROM imports WHERE checksum = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 1", checksum);
  let mode = 'new';
  let previous = null;
  let diff = null;
  if (duplicate) mode = 'duplicate';
  else {
    previous = findPrevious(db, analysis.records, nameKey);
    if (previous) {
      mode = 'update';
      diff = buildDiff(db, previous, analysis.records);
    }
  }
  // Возможные дубли среди уже существующих людей — только для проверки, без слияния.
  const index = new Map();
  for (const p of db.all('SELECT id, display_name, other_names FROM persons')) {
    for (const n of [p.display_name, ...parseJson(p.other_names, [])]) {
      const k = searchKey(n);
      if (!index.has(k)) index.set(k, []);
      if (!index.get(k).some((x) => x.id === p.id)) index.get(k).push({ id: p.id, display_name: p.display_name });
    }
  }
  for (const r of analysis.records) r.possibleDuplicates = index.get(searchKey(r.text)) || [];

  const id = crypto.randomUUID();
  previews.set(id, { createdAt: Date.now(), buffer, fileName, checksum, analysis, mode, previous, diff, includeHidden });
  return {
    previewId: id,
    fileName,
    checksum,
    size: buffer.length,
    mode,
    duplicateOf: duplicate ? { id: duplicate.id, created_at: duplicate.created_at, file_name: duplicate.file_name } : null,
    previous: previous ? { id: previous.id, created_at: previous.created_at, file_name: previous.file_name } : null,
    sheets: analysis.sheets,
    checks: analysis.checks,
    records: analysis.records,
    skipped: analysis.skipped,
    geometry: analysis.geometry,
    hypotheses: analysis.suggestions.hypotheses,
    questions: analysis.suggestions.questions,
    nameReviews: analysis.nameReviews,
    diff,
  };
}

export function discardPreview(id) {
  previews.delete(id);
}

function nameFieldsFromDecision(record, dec) {
  const parse = record.parse || parseFullName(record.text);
  const f = dec?.fields || {};
  const pick = (k) => (Object.prototype.hasOwnProperty.call(f, k) ? cleanText(f[k], { max: 500 }) : parse[k] ?? null);
  const fields = {
    display_name: Object.prototype.hasOwnProperty.call(f, 'display_name') && cleanText(f.display_name, { max: 500 }) ? cleanText(f.display_name, { max: 500 }) : record.text,
    surname: pick('surname'),
    given_name: pick('given_name'),
    patronymic: pick('patronymic'),
  };
  const edited = ['surname', 'given_name', 'patronymic'].some((k) => fields[k] !== (parse[k] ?? null));
  return { fields, status: edited ? 'confirmed' : 'suggested', edited: edited || fields.display_name !== record.text };
}

function findHypothesis(db, type, a, b) {
  return type === 'parent_child'
    ? db.get('SELECT * FROM hypotheses WHERE type = ? AND person_a = ? AND person_b = ?', type, a, b)
    : db.get('SELECT * FROM hypotheses WHERE type = ? AND ((person_a = ? AND person_b = ?) OR (person_a = ? AND person_b = ?))', type, a, b, b, a);
}

function relationExists(db, type, a, b) {
  if (type === 'parent_child') return !!db.get('SELECT id FROM parent_child WHERE parent_id = ? AND child_id = ?', a, b);
  if (type === 'partnership') return !!db.get('SELECT id FROM partnerships WHERE (person1_id = ? AND person2_id = ?) OR (person1_id = ? AND person2_id = ?)', a, b, b, a);
  return false;
}

export function commitImport(db, config, { previewId, records: decisions = {}, confirm = [] }) {
  const pv = previews.get(previewId);
  if (!pv) throw conflict('Предпросмотр устарел или уже использован. Загрузите файл ещё раз.');
  if (pv.mode === 'duplicate') throw conflict('Этот файл уже импортирован. Повторный импорт не создаёт дублей.');
  const { analysis, checksum, fileName, buffer } = pv;
  if (!analysis.records.length) throw unprocessable('В файле не найдено ни одной записи для импорта');
  const confirmSet = new Set(Array.isArray(confirm) ? confirm : []);
  for (const tmp of confirmSet) {
    const h = analysis.suggestions.hypotheses.find((x) => x.id === tmp);
    if (!h) throw badRequest('Неизвестное предположение в списке подтверждений');
    if (h.type === 'same_person') throw badRequest('Объединение записей выполняется после импорта, в разделе «Уточнить связи»');
  }

  // Исходный файл хранится рядом с базой (по контрольной сумме) — для истории и сверки.
  fs.mkdirSync(config.importsDir, { recursive: true });
  const storedName = `${checksum}.xlsx`;
  const storedPath = path.join(config.importsDir, storedName);
  if (!fs.existsSync(storedPath)) fs.writeFileSync(storedPath, buffer);

  const result = db.tx(() => {
    const importId = newId();
    const now = nowIso();
    db.insert('imports', {
      id: importId,
      file_name: fileName,
      file_name_key: fileNameKey(fileName),
      checksum,
      file_size: buffer.length,
      stored_file: storedName,
      mode: pv.mode === 'update' ? 'update' : 'new',
      previous_import_id: pv.previous?.id || null,
      status: 'completed',
      summary: '{}',
      geometry: JSON.stringify({ sheets: analysis.sheets, geometry: analysis.geometry }),
      applied_changes: '[]',
      created_at: now,
    });
    const applied = [];
    const createdPersonIds = [];
    const keyToPerson = new Map();
    const counts = { persons: 0, linked: 0, updated: 0, kept: 0, skipped: 0, removed: 0, records: 0 };

    const insertRecord = (r, personId, status = 'active') => {
      db.insert('source_records', {
        id: newId(),
        import_id: importId,
        person_id: personId,
        file_name: fileName,
        checksum,
        sheet_name: r.sheet,
        cell: r.cell,
        row_index: r.row,
        col_index: r.col,
        merged_range: r.mergedRange,
        raw_text: r.raw,
        parsed: JSON.stringify(r.parse),
        status,
        created_at: now,
      });
      counts.records += 1;
    };
    const createFromRecord = (r, dec) => {
      const { fields, status } = nameFieldsFromDecision(r, dec);
      const id = newId();
      db.insert('persons', {
        id,
        ...fields,
        other_names: '[]',
        name_fields_status: status,
        sex: null,
        life_status: 'unknown',
        birth_precision: 'unknown',
        death_precision: 'unknown',
        origin: 'import',
        created_at: now,
        updated_at: now,
      });
      createdPersonIds.push(id);
      counts.persons += 1;
      logChange(db, {
        actor: 'import',
        action: 'person.import',
        entityType: 'person',
        entityId: id,
        summary: `Создан из файла «${fileName}», ${r.sheet}!${r.cell}`,
        details: { importId, raw: r.raw, parse: r.parse },
        personIds: [id],
      });
      return id;
    };
    const supersede = (oldId) => {
      db.run("UPDATE source_records SET status = 'superseded' WHERE id = ? AND status = 'active'", oldId);
      applied.push({ type: 'supersede', recordId: oldId });
    };

    const diffByKey = new Map((pv.diff?.entries || []).map((e) => [e.key, e]));
    for (const r of analysis.records) {
      const dec = decisions[r.key] || {};
      const entry = diffByKey.get(r.key);
      const allowed = entry ? entry.actions : ['create', 'link', 'skip'];
      const action = dec.action || entry?.defaultAction || 'create';
      if (!allowed.includes(action)) throw badRequest(`Недопустимое действие для ${r.key}`);
      if (action === 'skip') {
        insertRecord(r, null, 'skipped');
        counts.skipped += 1;
        continue;
      }
      if (action === 'create') {
        const pid = createFromRecord(r, dec);
        insertRecord(r, pid);
        keyToPerson.set(r.key, pid);
        if (entry?.old && entry.status !== 'person_deleted') {
          db.run("UPDATE source_records SET status = 'removed' WHERE id = ? AND status = 'active'", entry.old.id);
          applied.push({ type: 'remove', recordId: entry.old.id });
        }
        continue;
      }
      // Связать с уже существующим человеком.
      let personId = entry?.person?.id || null;
      if (!entry || entry.status === 'new') {
        if (!dec.personId || !db.get('SELECT id FROM persons WHERE id = ?', dec.personId)) throw badRequest(`Для ${r.key} не выбран существующий человек`);
        personId = dec.personId;
      }
      if (!db.get('SELECT id FROM persons WHERE id = ?', personId)) throw conflict(`Человек для ${r.key} больше не существует. Загрузите файл ещё раз.`);
      if (entry?.old) supersede(entry.old.id);
      insertRecord(r, personId);
      keyToPerson.set(r.key, personId);
      if (action === 'update_name') {
        const before = db.get('SELECT display_name, surname, given_name, patronymic, name_fields_status FROM persons WHERE id = ?', personId);
        const after = { display_name: r.text };
        if (before.name_fields_status === 'suggested') {
          after.surname = r.parse.surname;
          after.given_name = r.parse.given_name;
          after.patronymic = r.parse.patronymic;
        }
        db.update('persons', personId, { ...after, updated_at: now });
        applied.push({ type: 'person_update', personId, before, after });
        counts.updated += 1;
        logChange(db, {
          actor: 'import',
          action: 'person.import_update',
          entityType: 'person',
          entityId: personId,
          summary: `Имя обновлено по новой версии файла: «${before.display_name}» → «${r.text}»`,
          details: { importId, before, after },
          personIds: [personId],
        });
      } else if (action === 'keep') {
        counts.kept += 1;
      } else {
        counts.linked += 1;
      }
    }
    for (const rem of pv.diff?.removed || []) {
      db.run("UPDATE source_records SET status = 'removed' WHERE id = ? AND status = 'active'", rem.old.id);
      applied.push({ type: 'remove', recordId: rem.old.id });
      counts.removed += 1;
      if (rem.person) {
        logChange(db, { actor: 'import', action: 'record.removed', entityType: 'source_record', entityId: rem.old.id, summary: `Ячейка ${rem.key} отсутствует в новой версии файла; человек сохранён`, personIds: [rem.person.id] });
      }
    }

    // Предположения (без создания связей).
    const tmpToReal = new Map();
    const inserted = new Set();
    for (const h of analysis.suggestions.hypotheses) {
      const pa = keyToPerson.get(h.a);
      const pb = keyToPerson.get(h.b);
      if (!pa || !pb || pa === pb) continue;
      const existing = findHypothesis(db, h.type, pa, pb);
      if (existing) {
        tmpToReal.set(h.id, existing.id);
        continue;
      }
      if (relationExists(db, h.type, pa, pb)) continue;
      const id = newId();
      db.insert('hypotheses', {
        id,
        question_id: null,
        import_id: importId,
        type: h.type,
        person_a: pa,
        person_b: pb,
        strength: h.strength,
        basis: JSON.stringify(h.basis),
        status: 'open',
        created_at: now,
        updated_at: now,
      });
      tmpToReal.set(h.id, id);
      inserted.add(id);
    }
    let questionsCreated = 0;
    const baseOrder = db.get('SELECT COALESCE(MAX(sort_order), 0) AS m FROM questions').m;
    for (const q of analysis.suggestions.questions) {
      const subjects = [...new Set(q.subjects.map((k) => keyToPerson.get(k)).filter(Boolean))];
      const candidates = [...new Set(q.candidates.map((k) => keyToPerson.get(k)).filter(Boolean))].filter((x) => !subjects.includes(x));
      if (!subjects.length) continue;
      const key = `${q.kind}:${[...subjects].sort().join(',')}`;
      const hypIds = q.hypothesisIds.map((t) => tmpToReal.get(t)).filter((x) => x && inserted.has(x));
      const existing = db.get('SELECT id FROM questions WHERE key = ?', key);
      if (existing) {
        for (const hid of hypIds) db.run('UPDATE hypotheses SET question_id = ? WHERE id = ? AND question_id IS NULL', existing.id, hid);
        continue;
      }
      if (!hypIds.length && q.kind !== 'same_person') continue;
      const qid = newId();
      db.insert('questions', {
        id: qid,
        import_id: importId,
        key,
        kind: q.kind,
        family: q.family,
        title: q.title,
        prompt: q.prompt,
        notes: JSON.stringify(q.notes || []),
        sort_order: baseOrder + q.order,
        status: 'open',
        created_at: now,
        updated_at: now,
      });
      subjects.forEach((pid, i) => db.run('INSERT OR IGNORE INTO question_persons (question_id, person_id, role, position) VALUES (?, ?, ?, ?)', qid, pid, 'subject', i));
      candidates.forEach((pid, i) => db.run('INSERT OR IGNORE INTO question_persons (question_id, person_id, role, position) VALUES (?, ?, ?, ?)', qid, pid, 'candidate', 100 + i));
      for (const hid of hypIds) db.run('UPDATE hypotheses SET question_id = ? WHERE id = ?', qid, hid);
      questionsCreated += 1;
    }

    // Подтверждения, выбранные пользователем при импорте.
    let confirmed = 0;
    const touchedQuestions = [];
    for (const tmp of confirmSet) {
      const real = tmpToReal.get(tmp);
      if (!real) continue;
      const h = db.get('SELECT * FROM hypotheses WHERE id = ?', real);
      if (!h || h.status === 'confirmed') continue;
      try {
        const opts = { actor: 'user', force: true, origin: 'import', hypothesisId: h.id, importId };
        const res = h.type === 'parent_child'
          ? createParentChild(db, { parentId: h.person_a, childId: h.person_b }, opts)
          : createPartnership(db, { person1Id: h.person_a, person2Id: h.person_b }, opts);
        db.run("UPDATE hypotheses SET status = 'confirmed', relation_id = ?, decided_at = ?, updated_at = ? WHERE id = ?", res.id, now, now, h.id);
        touchedQuestions.push(h.question_id, ...res.questionIds);
        confirmed += 1;
      } catch (e) {
        throw unprocessable(`Не удалось подтвердить связь при импорте: ${e.message}`);
      }
    }
    refreshQuestions(db, touchedQuestions);

    // Необязательная проверка написания.
    let reviews = 0;
    for (const nr of analysis.nameReviews) {
      const pids = [...new Set(nr.records.map((k) => keyToPerson.get(k)).filter(Boolean))];
      if (!pids.length) continue;
      const key = `${nr.code}:${[...pids].sort().join(',')}:${nr.suggestion?.value || ''}`;
      if (db.get('SELECT id FROM name_reviews WHERE key = ?', key)) continue;
      db.insert('name_reviews', {
        id: newId(),
        import_id: importId,
        key,
        code: nr.code,
        person_ids: JSON.stringify(pids),
        message: nr.message,
        suggestion: nr.suggestion ? JSON.stringify(nr.suggestion) : null,
        status: 'open',
        created_at: now,
      });
      reviews += 1;
    }

    const summary = {
      ...counts,
      hypotheses: inserted.size,
      questions: questionsCreated,
      confirmed,
      nameReviews: reviews,
      totalRecordsInFile: analysis.records.length,
      createdPersonIds,
      checks: analysis.checks,
    };
    db.run('UPDATE imports SET summary = ?, applied_changes = ? WHERE id = ?', JSON.stringify(summary), JSON.stringify(applied), importId);
    logChange(db, {
      actor: 'import',
      action: 'import.commit',
      entityType: 'import',
      entityId: importId,
      summary: `Импорт «${fileName}»: людей создано ${counts.persons}, записей ${counts.records}, предположений ${inserted.size}, вопросов ${questionsCreated}`,
      details: { importId, counts },
    });
    return { importId, summary };
  });
  previews.delete(previewId);
  return result;
}

// ---------- Откат ----------

function personTouchReasons(db, personId, importId) {
  const reasons = [];
  const p = db.get('SELECT * FROM persons WHERE id = ?', personId);
  if (!p) return null;
  if (p.last_manual_edit_at) reasons.push('изменены сведения');
  if (db.get('SELECT COUNT(*) AS n FROM photos WHERE person_id = ?', personId).n) reasons.push('есть фотографии');
  if (db.get('SELECT COUNT(*) AS n FROM sources WHERE person_id = ?', personId).n) reasons.push('есть источники');
  const rel = db.get(
    `SELECT COUNT(*) AS n FROM (
       SELECT id FROM parent_child WHERE (parent_id = ?1 OR child_id = ?1) AND NOT (origin = 'import' AND import_id = ?2)
       UNION ALL
       SELECT id FROM partnerships WHERE (person1_id = ?1 OR person2_id = ?1) AND NOT (origin = 'import' AND import_id = ?2)
     )`,
    personId, importId,
  ).n;
  if (rel) reasons.push(`подтверждённых связей добавлено позже: ${rel}`);
  if (db.get("SELECT COUNT(*) AS n FROM source_records WHERE person_id = ? AND import_id <> ? AND status = 'active'", personId, importId).n) reasons.push('связан с записями другого импорта');
  return { person: { id: p.id, display_name: p.display_name }, reasons };
}

export function rollbackPreview(db, importId) {
  const imp = db.get('SELECT * FROM imports WHERE id = ?', importId);
  if (!imp) throw notFound('Импорт не найден');
  if (imp.status === 'rolled_back') throw conflict('Этот импорт уже отменён');
  const summary = parseJson(imp.summary, {});
  const toDelete = [];
  const modified = [];
  let missing = 0;
  for (const pid of summary.createdPersonIds || []) {
    const t = personTouchReasons(db, pid, importId);
    if (!t) {
      missing += 1;
      continue;
    }
    if (t.reasons.length) modified.push(t);
    else toDelete.push(t.person);
  }
  const applied = parseJson(imp.applied_changes, []);
  const nameReverts = [];
  for (const ch of applied.filter((a) => a.type === 'person_update')) {
    const p = db.get('SELECT * FROM persons WHERE id = ?', ch.personId);
    if (!p) continue;
    const same = Object.entries(ch.after).every(([k, v]) => p[k] === v);
    nameReverts.push({ person: { id: p.id, display_name: p.display_name }, before: ch.before.display_name, revertible: same });
  }
  const count = (sql) => db.get(sql, importId).n;
  return {
    import: { id: imp.id, file_name: imp.file_name, created_at: imp.created_at, mode: imp.mode },
    personsToDelete: toDelete,
    personsModified: modified,
    personsAlreadyDeleted: missing,
    importRelations: count("SELECT (SELECT COUNT(*) FROM parent_child WHERE import_id = ?1 AND origin = 'import') + (SELECT COUNT(*) FROM partnerships WHERE import_id = ?1 AND origin = 'import') AS n"),
    hypotheses: count('SELECT COUNT(*) AS n FROM hypotheses WHERE import_id = ?'),
    decidedHypotheses: count("SELECT COUNT(*) AS n FROM hypotheses WHERE import_id = ? AND status IN ('confirmed', 'rejected')"),
    questions: count('SELECT COUNT(*) AS n FROM questions WHERE import_id = ?'),
    nameReviews: count('SELECT COUNT(*) AS n FROM name_reviews WHERE import_id = ?'),
    restoredRecords: applied.filter((a) => a.type === 'supersede' || a.type === 'remove').length,
    nameReverts,
  };
}

export function rollbackImport(db, config, importId, { deleteModified = false, backupName = null } = {}) {
  const preview = rollbackPreview(db, importId);
  const photoIds = [];
  const res = db.tx(() => {
    const now = nowIso();
    db.run("DELETE FROM parent_child WHERE import_id = ? AND origin = 'import'", importId);
    db.run("DELETE FROM partnerships WHERE import_id = ? AND origin = 'import'", importId);
    db.run('UPDATE parent_child SET hypothesis_id = NULL WHERE hypothesis_id IN (SELECT id FROM hypotheses WHERE import_id = ?)', importId);
    db.run('UPDATE partnerships SET hypothesis_id = NULL WHERE hypothesis_id IN (SELECT id FROM hypotheses WHERE import_id = ?)', importId);
    db.run('DELETE FROM hypotheses WHERE import_id = ?', importId);
    db.run('UPDATE hypotheses SET question_id = NULL WHERE question_id IN (SELECT id FROM questions WHERE import_id = ?)', importId);
    db.run('DELETE FROM questions WHERE import_id = ?', importId);
    db.run('DELETE FROM name_reviews WHERE import_id = ?', importId);
    const imp = db.get('SELECT * FROM imports WHERE id = ?', importId);
    const applied = parseJson(imp.applied_changes, []);
    const conflicts = [];
    for (const ch of [...applied].reverse()) {
      if (ch.type === 'person_update') {
        const p = db.get('SELECT * FROM persons WHERE id = ?', ch.personId);
        if (!p) continue;
        if (Object.entries(ch.after || {}).every(([k, v]) => p[k] === v)) {
          // Возвращаются только поля имени (данные журнала могли прийти из восстановленной копии).
          const before = {};
          for (const k of NAME_REVERT_FIELDS) if (ch.before && Object.hasOwn(ch.before, k)) before[k] = ch.before[k] ?? null;
          db.update('persons', ch.personId, { ...before, updated_at: now });
          logChange(db, { actor: 'import', action: 'person.import_revert', entityType: 'person', entityId: ch.personId, summary: `Откат импорта: имя возвращено к «${ch.before.display_name}»`, personIds: [ch.personId] });
        } else {
          conflicts.push(p.display_name);
        }
      } else if (ch.type === 'supersede' || ch.type === 'remove') {
        db.run("UPDATE source_records SET status = 'active' WHERE id = ? AND status IN ('superseded', 'removed')", ch.recordId);
      }
    }
    db.run("UPDATE source_records SET status = 'rolled_back' WHERE import_id = ? AND status IN ('active', 'skipped')", importId);
    const del = [...preview.personsToDelete, ...(deleteModified ? preview.personsModified.map((m) => m.person) : [])];
    for (const p of del) {
      if (!db.get('SELECT id FROM persons WHERE id = ?', p.id)) continue;
      const r = deletePerson(db, p.id, { actor: 'import', reason: 'откат импорта' });
      photoIds.push(...r.photoIds);
    }
    const rollbackSummary = {
      deletedPersons: del.length,
      keptModified: deleteModified ? 0 : preview.personsModified.length,
      nameConflicts: conflicts,
      backupName,
    };
    db.run("UPDATE imports SET status = 'rolled_back', rolled_back_at = ?, rollback_summary = ? WHERE id = ?", now, JSON.stringify(rollbackSummary), importId);
    logChange(db, {
      action: 'import.rollback',
      entityType: 'import',
      entityId: importId,
      summary: `Импорт «${imp.file_name}» отменён: удалено людей ${del.length}, сохранено изменённых ${rollbackSummary.keptModified}`,
      details: rollbackSummary,
    });
    return rollbackSummary;
  });
  return { ...res, photoIds };
}

export function listImports(db) {
  return db.all('SELECT id, file_name, checksum, file_size, mode, status, summary, created_at, rolled_back_at, rollback_summary, previous_import_id FROM imports ORDER BY created_at DESC').map((r) => {
    const s = parseJson(r.summary, {});
    delete s.createdPersonIds;
    return { ...r, summary: s, rollback_summary: parseJson(r.rollback_summary, null) };
  });
}

export function getImport(db, id) {
  const r = db.get('SELECT * FROM imports WHERE id = ?', id);
  if (!r) throw notFound('Импорт не найден');
  const s = parseJson(r.summary, {});
  return {
    ...r,
    summary: s,
    geometry: parseJson(r.geometry, {}),
    applied_changes: parseJson(r.applied_changes, []),
    rollback_summary: parseJson(r.rollback_summary, null),
    records: db.all('SELECT sr.*, p.display_name AS person_name FROM source_records sr LEFT JOIN persons p ON p.id = sr.person_id WHERE sr.import_id = ? ORDER BY sr.row_index, sr.col_index', id),
  };
}
