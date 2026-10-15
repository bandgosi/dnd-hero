// Журнал изменений: каждое действие пользователя, импорта или системы.
import { nowIso } from '../lib/util.js';

// Журнал только показывается и не служит для восстановления значений, поэтому длинные тексты
// (биография, заметки) хранятся в нём сокращёнными: журнал не разрастается от каждой правки.
const MAX_DETAIL_CHARS = 2000;
const MAX_DETAILS_JSON = 64 * 1024;
// Хранятся последние 50 000 записей журнала: история за годы работы, но без бесконечного роста.
const MAX_LOG_ENTRIES = 50000;
function compact(v, depth = 0) {
  if (typeof v === 'string') return v.length > MAX_DETAIL_CHARS ? `${v.slice(0, 1000)}… (сокращено, всего ${v.length} символов)` : v;
  if (v === null || typeof v !== 'object') return v;
  if (depth > 6) return '…';
  if (Array.isArray(v)) return v.slice(0, 500).map((x) => compact(x, depth + 1));
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = compact(x, depth + 1);
  return out;
}

export function logChange(db, { actor = 'user', action, entityType = null, entityId = null, summary, details = {}, personIds = [] }) {
  let json = JSON.stringify(compact(details));
  if (json.length > MAX_DETAILS_JSON) json = JSON.stringify({ truncated: true });
  const info = db.run(
    'INSERT INTO change_log (at, actor, action, entity_type, entity_id, summary, details) VALUES (?, ?, ?, ?, ?, ?, ?)',
    nowIso(), actor, action, entityType, entityId, String(summary ?? '').slice(0, 1000), json,
  );
  const logId = Number(info.lastInsertRowid);
  if (logId % 200 === 0 && logId > MAX_LOG_ENTRIES) db.run('DELETE FROM change_log WHERE id <= ?', logId - MAX_LOG_ENTRIES);
  for (const pid of new Set(personIds.filter(Boolean))) {
    db.run('INSERT OR IGNORE INTO change_log_persons (log_id, person_id) VALUES (?, ?)', logId, pid);
  }
  return logId;
}

export function personHistory(db, personId, limit = 200) {
  return db.all(
    `SELECT cl.* FROM change_log cl JOIN change_log_persons p ON p.log_id = cl.id
     WHERE p.person_id = ? ORDER BY cl.id DESC LIMIT ?`,
    personId, limit,
  ).map((r) => ({ ...r, details: JSON.parse(r.details || '{}') }));
}

export function recentChanges(db, limit = 100) {
  return db.all('SELECT * FROM change_log ORDER BY id DESC LIMIT ?', limit).map((r) => ({ ...r, details: JSON.parse(r.details || '{}') }));
}
