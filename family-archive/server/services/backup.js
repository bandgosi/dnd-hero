// Резервные копии: один .zip-файл с данными (JSON) и всеми фотографиями.
// Формат: manifest.json (версия формата), data.json (все таблицы), photos/<id>/…, imports/<контрольная сумма>.xlsx
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Zip, ZipDeflate, ZipPassThrough, Unzip, UnzipInflate } from 'fflate';
import { nowIso, badRequest, notFound, unprocessable, conflict } from '../lib/util.js';
import { logChange } from './history.js';

export const BACKUP_FORMAT = 'family-archive-backup';
export const BACKUP_FORMAT_VERSION = 1;

// Порядок важен для вставки при восстановлении.
export const BACKUP_TABLES = [
  'persons', 'imports', 'source_records', 'parent_child', 'partnerships', 'photos', 'sources',
  'questions', 'question_persons', 'hypotheses', 'name_reviews', 'change_log', 'change_log_persons', 'meta',
];

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');

export function readAllData(db) {
  db.exec('BEGIN');
  try {
    const data = {};
    for (const t of BACKUP_TABLES) data[t] = db.all(`SELECT * FROM ${t}`);
    return data;
  } finally {
    db.exec('COMMIT');
  }
}

function countsOf(data) {
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

export async function createBackup(db, config, { label = null, appVersion = '1.0.0' } = {}) {
  fs.mkdirSync(config.backupsDir, { recursive: true });
  const data = readAllData(db);
  const name = `family-archive-${stamp()}${label ? '-' + label.replace(/[^a-z0-9-]/gi, '').slice(0, 30) : ''}.zip`;
  const file = path.join(config.backupsDir, name);
  const tmp = `${file}.part`;
  const manifest = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion,
    schemaVersion: db.schemaVersion(),
    createdAt: nowIso(),
    label,
    counts: countsOf(data),
    note: 'Резервная копия «История нашего рода». Даты хранятся без времени, исходные строки Excel — без изменений.',
  };
  const out = fs.createWriteStream(tmp);
  const done = new Promise((resolve, reject) => {
    out.on('finish', resolve);
    out.on('error', reject);
  });
  let zipError = null;
  const zip = new Zip((err, chunk, final) => {
    if (err) {
      zipError = err;
      out.destroy(err);
      return;
    }
    out.write(Buffer.from(chunk));
    if (final) out.end();
  });
  const addText = (n, text) => {
    const f = new ZipDeflate(n, { level: 6 });
    zip.add(f);
    f.push(new TextEncoder().encode(text), true);
  };
  const addFile = (n, filePath) => {
    const f = new ZipPassThrough(n);
    zip.add(f);
    f.push(new Uint8Array(fs.readFileSync(filePath)), true);
  };
  addText('manifest.json', JSON.stringify(manifest, null, 2));
  addText('data.json', JSON.stringify(data));
  const missing = [];
  for (const ph of data.photos) {
    for (const k of ['original_file', 'display_file', 'thumb_file']) {
      const p = path.join(config.photosDir, ph.id, ph[k]);
      if (fs.existsSync(p)) addFile(`photos/${ph.id}/${ph[k]}`, p);
      else missing.push(`${ph.id}/${ph[k]}`);
    }
  }
  for (const imp of data.imports) {
    if (!imp.stored_file) continue;
    const p = path.join(config.importsDir, imp.stored_file);
    if (fs.existsSync(p)) addFile(`imports/${imp.stored_file}`, p);
  }
  zip.end();
  await done;
  if (zipError) throw zipError;
  fs.renameSync(tmp, file);
  const size = fs.statSync(file).size;
  logChange(db, { actor: 'system', action: 'backup.create', summary: `Создана резервная копия ${name}`, details: { name, size, counts: manifest.counts, missing } });
  return { name, size, createdAt: manifest.createdAt, counts: manifest.counts, missing };
}

export function listBackups(config) {
  if (!fs.existsSync(config.backupsDir)) return [];
  return fs.readdirSync(config.backupsDir)
    .filter((f) => f.endsWith('.zip'))
    .map((f) => {
      const st = fs.statSync(path.join(config.backupsDir, f));
      return { name: f, size: st.size, modifiedAt: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.name < b.name ? 1 : -1));
}

export function backupPath(config, name) {
  if (!/^[\w.-]+\.zip$/.test(name)) throw badRequest('Неверное имя файла копии');
  const p = path.join(config.backupsDir, name);
  if (!fs.existsSync(p)) throw notFound('Резервная копия не найдена');
  return p;
}

// Потоковое чтение архива: onEntry(name) решает, что делать с файлом.
function readZip(file, { wantText = () => false, extractTo = null, accept = () => false }) {
  return new Promise((resolve, reject) => {
    const texts = {};
    const entries = [];
    const pending = [];
    let failed = null;
    const uz = new Unzip((stream) => {
      const name = stream.name;
      if (name.includes('..') || path.isAbsolute(name) || name.includes('\\')) {
        failed = unprocessable('Архив содержит недопустимые пути');
        return;
      }
      entries.push(name);
      if (stream.name.endsWith('/')) return;
      if (wantText(name)) {
        const chunks = [];
        stream.ondata = (err, chunk, final) => {
          if (err) {
            failed = err;
            return;
          }
          chunks.push(chunk);
          if (final) texts[name] = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
        };
        stream.start();
      } else if (extractTo && accept(name)) {
        const target = path.join(extractTo, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const fd = fs.openSync(target, 'w');
        pending.push(fd);
        stream.ondata = (err, chunk, final) => {
          if (err) {
            failed = err;
            return;
          }
          fs.writeSync(fd, chunk);
          if (final) fs.closeSync(fd);
        };
        stream.start();
      }
    });
    uz.register(UnzipInflate);
    const rs = fs.createReadStream(file, { highWaterMark: 1 << 20 });
    rs.on('data', (chunk) => {
      try {
        uz.push(new Uint8Array(chunk));
      } catch (e) {
        failed = e;
        rs.destroy();
      }
    });
    rs.on('error', reject);
    rs.on('close', () => {
      try {
        if (!failed) uz.push(new Uint8Array(0), true);
      } catch (e) {
        failed = e;
      }
      if (failed) reject(failed instanceof Error && failed.status ? failed : unprocessable('Архив повреждён или не является резервной копией'));
      else resolve({ texts, entries });
    });
  });
}

const restoreTokens = new Map();

export async function restorePreview(db, config, zipFile) {
  const { texts, entries } = await readZip(zipFile, { wantText: (n) => n === 'manifest.json' || n === 'data.json' });
  if (!texts['manifest.json'] || !texts['data.json']) throw unprocessable('Это не резервная копия «Истории нашего рода»: нет manifest.json или data.json');
  let manifest;
  let data;
  try {
    manifest = JSON.parse(texts['manifest.json']);
    data = JSON.parse(texts['data.json']);
  } catch {
    throw unprocessable('Файлы резервной копии повреждены (не удалось прочитать JSON)');
  }
  if (manifest.format !== BACKUP_FORMAT) throw unprocessable('Неизвестный формат резервной копии');
  if (!Number.isInteger(manifest.formatVersion) || manifest.formatVersion > BACKUP_FORMAT_VERSION) {
    throw unprocessable(`Версия формата копии (${manifest.formatVersion}) новее, чем поддерживает приложение (${BACKUP_FORMAT_VERSION}). Обновите приложение.`);
  }
  for (const t of ['persons', 'parent_child', 'partnerships', 'photos', 'hypotheses']) {
    if (!Array.isArray(data[t])) throw unprocessable(`В копии нет таблицы ${t}`);
  }
  const entrySet = new Set(entries);
  const missingPhotos = [];
  for (const ph of data.photos) {
    for (const k of ['original_file', 'display_file', 'thumb_file']) {
      if (!entrySet.has(`photos/${ph.id}/${ph[k]}`)) missingPhotos.push(`${ph.id}/${ph[k]}`);
    }
  }
  const ids = new Set(data.persons.map((p) => p.id));
  const broken = [...data.parent_child.filter((r) => !ids.has(r.parent_id) || !ids.has(r.child_id)), ...data.partnerships.filter((r) => !ids.has(r.person1_id) || !ids.has(r.person2_id))].length;
  if (broken) throw unprocessable(`Копия повреждена: ${broken} связей ссылаются на отсутствующих людей`);
  const token = crypto.randomUUID();
  restoreTokens.set(token, { zipFile, data, manifest, createdAt: Date.now() });
  return {
    token,
    manifest,
    counts: countsOf(data),
    missingPhotos,
    current: countsOf({
      persons: db.all('SELECT id FROM persons'),
      parent_child: db.all('SELECT id FROM parent_child'),
      partnerships: db.all('SELECT id FROM partnerships'),
      photos: db.all('SELECT id FROM photos'),
      hypotheses: db.all('SELECT id FROM hypotheses'),
      questions: db.all('SELECT id FROM questions'),
      sources: db.all('SELECT id FROM sources'),
      imports: db.all('SELECT id FROM imports'),
      source_records: db.all('SELECT id FROM source_records'),
    }),
  };
}

export async function restoreBackup(db, config, token) {
  const t = restoreTokens.get(token);
  if (!t) throw conflict('Предпросмотр восстановления устарел. Загрузите копию ещё раз.');
  const work = path.join(config.dataDir, `restore-${Date.now()}`);
  fs.mkdirSync(work, { recursive: true });
  try {
    await readZip(t.zipFile, { extractTo: work, accept: (n) => n.startsWith('photos/') || n.startsWith('imports/') });
    const columns = {};
    for (const table of BACKUP_TABLES) columns[table] = new Set(db.all(`PRAGMA table_info(${table})`).map((c) => c.name));
    db.tx(() => {
      db.exec('PRAGMA defer_foreign_keys = ON');
      for (const table of [...BACKUP_TABLES].reverse()) db.exec(`DELETE FROM ${table}`);
      db.exec("DELETE FROM sqlite_sequence WHERE name = 'change_log'");
      for (const table of BACKUP_TABLES) {
        for (const row of t.data[table] || []) {
          const r = {};
          for (const [k, v] of Object.entries(row)) if (columns[table].has(k)) r[k] = v;
          if (Object.keys(r).length) db.insert(table, r);
        }
      }
      logChange(db, { actor: 'system', action: 'backup.restore', summary: `Данные восстановлены из резервной копии от ${t.manifest.createdAt}`, details: { counts: countsOf(t.data), manifest: t.manifest } });
    });
    // Подмена каталогов файлов после успешной записи базы.
    const trash = path.join(config.dataDir, `trash-${Date.now()}`);
    fs.mkdirSync(trash, { recursive: true });
    for (const [dir, sub] of [[config.photosDir, 'photos'], [config.importsDir, 'imports']]) {
      if (fs.existsSync(dir)) fs.renameSync(dir, path.join(trash, sub));
      const src = path.join(work, sub);
      if (fs.existsSync(src)) fs.renameSync(src, dir);
      else fs.mkdirSync(dir, { recursive: true });
    }
    fs.rmSync(trash, { recursive: true, force: true });
    restoreTokens.delete(token);
    if (path.resolve(t.zipFile).startsWith(path.resolve(config.tmpDir) + path.sep)) fs.rmSync(t.zipFile, { force: true });
    return { counts: countsOf(t.data), manifest: t.manifest };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
