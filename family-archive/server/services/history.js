// Журнал изменений: каждое действие пользователя, импорта или системы.
import { nowIso } from '../lib/util.js';

export function logChange(db, { actor = 'user', action, entityType = null, entityId = null, summary, details = {}, personIds = [] }) {
  const info = db.run(
    'INSERT INTO change_log (at, actor, action, entity_type, entity_id, summary, details) VALUES (?, ?, ?, ?, ?, ?, ?)',
    nowIso(), actor, action, entityType, entityId, summary, JSON.stringify(details),
  );
  const logId = Number(info.lastInsertRowid);
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
