// Данные резервной копии (data.json): очистка, проверка, сводка и запись в базу.
// Используется дочерним процессом (backup-data-child.js), чтобы разбор чужого файла и все его
// записи никогда не попадали в память основного процесса сервера.
import { unprocessable } from '../lib/util.js';
import { isUuid, isPhotoFile, isImportFile } from '../lib/safety.js';
import { logChange } from './history.js';

// Порядок важен для вставки при восстановлении.
export const BACKUP_TABLES = [
  'persons', 'imports', 'source_records', 'parent_child', 'partnerships', 'photos', 'sources',
  'questions', 'question_persons', 'hypotheses', 'name_reviews', 'change_log', 'change_log_persons',
];

// Допустимые элементы архива резервной копии (имена файлов — по белому списку).
const ENTRY_RE = /^(manifest\.json|data\.json|photos\/[0-9a-f-]{36}\/[a-z0-9.-]+|imports\/[0-9a-f]{64}\.xlsx)$/;
export function allowedEntry(name) {
  if (!ENTRY_RE.test(name)) return false;
  const parts = name.split('/');
  if (parts[0] === 'photos') return isUuid(parts[1]) && isPhotoFile(parts[2]);
  if (parts[0] === 'imports') return isImportFile(parts[1]);
  return true;
}

export function countsOf(data) {
  return {
    persons: data.persons?.length || 0,
    parentChild: data.parent_child?.length || 0,
    partnerships: data.partnerships?.length || 0,
    photos: data.photos?.length || 0,
    hypotheses: data.hypotheses?.length || 0,
    questions: data.questions?.length || 0,
    sources: data.sources?.length || 0,
    imports: data.imports?.length || 0,
    sourceRecords: data.source_records?.length || 0,
  };
}

// Разбор и очистка: только известные таблицы и столбцы, значения — строки, числа или пусто.
export function cleanData(text, columns, maxRows) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw unprocessable('Файлы резервной копии повреждены (не удалось прочитать JSON)');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw unprocessable('Файлы резервной копии повреждены');
  const out = {};
  let rows = 0;
  for (const [table, cols] of Object.entries(columns)) {
    const list = data[table];
    if (list === undefined) continue;
    if (!Array.isArray(list)) throw unprocessable(`Таблица ${table} в копии повреждена`);
    rows += list.length;
    if (rows > maxRows) throw unprocessable('В копии слишком много записей');
    const known = new Set(cols);
    for (const row of list) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw unprocessable(`Таблица ${table} в копии повреждена`);
      let kept = 0;
      for (const k of Object.keys(row)) {
        const v = row[k];
        if (!known.has(k)) delete row[k];
        else if (v === null || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) kept++;
        else if (typeof v === 'boolean') {
          row[k] = v ? 1 : 0;
          kept++;
        } else throw unprocessable(`Таблица ${table} в копии повреждена`);
      }
      if (!kept) throw unprocessable(`Таблица ${table} в копии повреждена`);
    }
    out[table] = list;
  }
  return out;
}

const isStr = (v) => typeof v === 'string' && v.length > 0 && v.length < 300;

// Проверка содержимого копии до восстановления.
export function validateBackupData(data) {
  for (const t of ['persons', 'parent_child', 'partnerships', 'photos', 'hypotheses']) {
    if (!Array.isArray(data[t])) throw unprocessable(`В копии нет таблицы ${t}`);
  }
  // Длина имени — как допускает само приложение (импорт и карточка), с запасом.
  if (!data.persons.every((p) => isStr(p.id) && typeof p.display_name === 'string' && p.display_name.length > 0 && p.display_name.length <= 5000)) {
    throw unprocessable('Копия повреждена: неверные записи людей');
  }
  for (const ph of data.photos) {
    if (!isUuid(ph.id) || !isStr(ph.person_id) || !['original_file', 'display_file', 'thumb_file'].every((k) => isPhotoFile(ph[k]))) {
      throw unprocessable('Копия содержит недопустимые имена файлов фотографий');
    }
  }
  for (const imp of data.imports || []) {
    if (imp.stored_file != null && !isImportFile(imp.stored_file)) throw unprocessable('Копия содержит недопустимые имена файлов импорта');
  }
  const ids = new Set(data.persons.map((p) => p.id));
  const broken = [...data.parent_child.filter((r) => !ids.has(r.parent_id) || !ids.has(r.child_id)), ...data.partnerships.filter((r) => !ids.has(r.person1_id) || !ids.has(r.person2_id))].length;
  if (broken) throw unprocessable(`Копия повреждена: ${broken} связей ссылаются на отсутствующих людей`);
}

// Файлы архива, на которые ссылаются данные: только они распаковываются при восстановлении.
export function referencedFiles(data) {
  const set = new Set();
  for (const ph of data.photos) for (const k of ['original_file', 'display_file', 'thumb_file']) set.add(`photos/${ph.id}/${ph[k]}`);
  for (const imp of data.imports || []) if (imp.stored_file) set.add(`imports/${imp.stored_file}`);
  return set;
}

// Сводка для предпросмотра: числа записей и (не больше 100) недостающих в архиве файлов фото.
export function summarize(data, entries) {
  const have = new Set(entries);
  const missing = [];
  let missingCount = 0;
  for (const ph of data.photos) {
    for (const k of ['original_file', 'display_file', 'thumb_file']) {
      if (have.has(`photos/${ph.id}/${ph[k]}`)) continue;
      missingCount++;
      if (missing.length < 100) missing.push(`${ph.id}/${ph[k]}`);
    }
  }
  return { counts: countsOf(data), missingCount, missingSample: missing };
}

// Полная замена данных базы содержимым копии (одна транзакция). restoreId записывается в той же
// транзакции: по нему основной процесс узнаёт, что запись состоялась, даже если ответ потерян.
export function insertData(db, data, manifest, restoreId = null) {
  db.tx(() => {
    db.exec('PRAGMA defer_foreign_keys = ON');
    for (const table of [...BACKUP_TABLES].reverse()) db.exec(`DELETE FROM ${table}`);
    db.exec("DELETE FROM sqlite_sequence WHERE name = 'change_log'");
    // Счётчик журнала начинается заново — отметка последней копии больше не действует.
    db.run("DELETE FROM meta WHERE key = 'last_backup_log_id'");
    if (restoreId) db.run("INSERT INTO meta (key, value) VALUES ('last_restore_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", restoreId);
    for (const table of BACKUP_TABLES) for (const row of data[table] || []) db.insert(table, row);
    logChange(db, { actor: 'system', action: 'backup.restore', summary: `Данные восстановлены из резервной копии от ${manifest.createdAt}`, details: { counts: countsOf(data), manifest } });
  });
}
