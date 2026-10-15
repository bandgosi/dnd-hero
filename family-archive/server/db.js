// База данных SQLite (встроенный модуль node:sqlite) и миграции.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS_DIR = path.join(import.meta.dirname, 'migrations');

// Значения для привязки: undefined → NULL, логические → 0/1, объекты → JSON.
function bindValue(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'object' && !(v instanceof Uint8Array)) return JSON.stringify(v);
  return v;
}

function bindParams(params) {
  if (params.length === 1 && params[0] && typeof params[0] === 'object' && !Array.isArray(params[0]) && !(params[0] instanceof Uint8Array)) {
    const o = {};
    for (const [k, v] of Object.entries(params[0])) o[k] = bindValue(v);
    return [o];
  }
  return params.map(bindValue);
}

const plain = (row) => (row ? { ...row } : row);

export class Db {
  constructor(file) {
    this.file = file;
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;');
    this.depth = 0;
    this.cache = new Map();
  }

  stmt(sql) {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  all(sql, ...params) {
    return this.stmt(sql).all(...bindParams(params)).map(plain);
  }

  get(sql, ...params) {
    return plain(this.stmt(sql).get(...bindParams(params)));
  }

  run(sql, ...params) {
    return this.stmt(sql).run(...bindParams(params));
  }

  exec(sql) {
    this.raw.exec(sql);
  }

  // Атомарная операция. Вложенные вызовы используют точки сохранения.
  tx(fn) {
    if (this.depth > 0) {
      const sp = `sp${this.depth}`;
      this.raw.exec(`SAVEPOINT ${sp}`);
      this.depth++;
      try {
        const r = fn();
        this.raw.exec(`RELEASE ${sp}`);
        return r;
      } catch (e) {
        this.raw.exec(`ROLLBACK TO ${sp}; RELEASE ${sp}`);
        throw e;
      } finally {
        this.depth--;
      }
    }
    this.raw.exec('BEGIN IMMEDIATE');
    this.depth++;
    try {
      const r = fn();
      if (r && typeof r.then === 'function') throw new Error('Транзакция не может быть асинхронной');
      this.raw.exec('COMMIT');
      return r;
    } catch (e) {
      try {
        this.raw.exec('ROLLBACK');
      } catch {
        /* транзакция уже откатилась */
      }
      throw e;
    } finally {
      this.depth--;
    }
  }

  // Имена таблиц и столбцов попадают в текст SQL — допускаются только простые идентификаторы.
  checkKeys(table, keys) {
    for (const k of [table, ...keys]) if (!/^[a-z_][a-z0-9_]*$/.test(k)) throw new Error(`Недопустимое имя в запросе: ${String(k).slice(0, 40)}`);
  }

  insert(table, row) {
    const keys = Object.keys(row);
    this.checkKeys(table, keys);
    const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((k) => ':' + k).join(', ')})`;
    return this.run(sql, row);
  }

  update(table, id, fields) {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    this.checkKeys(table, keys);
    const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = :${k}`).join(', ')} WHERE id = :__id`;
    return this.run(sql, { ...fields, __id: id });
  }

  close() {
    this.cache.clear();
    this.raw.close();
  }

  schemaVersion() {
    return this.get('SELECT MAX(version) AS v FROM schema_migrations')?.v || 0;
  }
}

export function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const applied = new Set(db.all('SELECT version FROM schema_migrations').map((r) => r.version));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  for (const f of files) {
    const version = Number(f.split('_')[0]);
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    db.tx(() => {
      db.exec(sql);
      db.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', version, f, new Date().toISOString());
    });
  }
}

export function openDb(file) {
  const db = new Db(file);
  migrate(db);
  return db;
}
