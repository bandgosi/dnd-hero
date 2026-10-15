// Резервные копии: один .zip-файл с данными (JSON) и всеми фотографиями.
// Формат: manifest.json (версия формата), data.json (все таблицы), photos/<id>/…, imports/<контрольная сумма>.xlsx
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Zip, ZipDeflate, ZipPassThrough, Unzip, UnzipInflate } from 'fflate';
import { nowIso, badRequest, notFound, unprocessable, conflict } from '../lib/util.js';
import { logChange } from './history.js';
import { isUuid, isPhotoFile, isImportFile, isBackupName } from '../lib/safety.js';
import { ensureSpace, diskSpace } from './storage.js';

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

const fileSize = (p) => {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
};

// Файлы, которые войдут в копию (только допустимые имена — защита от выхода за пределы папок).
function backupFiles(config, data) {
  const files = [];
  const missing = [];
  for (const ph of data.photos) {
    for (const k of ['original_file', 'display_file', 'thumb_file']) {
      if (!isUuid(ph.id) || !isPhotoFile(ph[k])) {
        missing.push(`${ph.id}/${ph[k]}`);
        continue;
      }
      const p = path.join(config.photosDir, ph.id, ph[k]);
      if (fs.existsSync(p)) files.push({ name: `photos/${ph.id}/${ph[k]}`, path: p, size: fileSize(p) });
      else missing.push(`${ph.id}/${ph[k]}`);
    }
  }
  for (const imp of data.imports) {
    if (!isImportFile(imp.stored_file)) continue;
    const p = path.join(config.importsDir, imp.stored_file);
    if (fs.existsSync(p)) files.push({ name: `imports/${imp.stored_file}`, path: p, size: fileSize(p) });
  }
  return { files, missing };
}

export async function createBackup(db, config, { label = null, appVersion = '1.0.0' } = {}) {
  fs.mkdirSync(config.backupsDir, { recursive: true });
  const data = readAllData(db);
  const cleanLabel = label ? String(label).toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^[^a-z]+/, '').slice(0, 30) : '';
  const base = `family-archive-${stamp()}`;
  let name = `${base}${cleanLabel ? '-' + cleanLabel : ''}.zip`;
  for (let n = 2; fs.existsSync(path.join(config.backupsDir, name)) && n < 1000; n++) name = `${base}-${n}${cleanLabel ? '-' + cleanLabel : ''}.zip`;
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
  const json = JSON.stringify(data);
  const { files, missing } = backupFiles(config, data);
  // Проверка места до записи: фотографии хранятся в копии без сжатия.
  ensureSpace(config, files.reduce((n, f) => n + f.size, 0) + json.length + 1024 * 1024, 'для резервной копии');
  try {
    addText('manifest.json', JSON.stringify(manifest, null, 2));
    addText('data.json', json);
    for (const f of files) addFile(f.name, f.path);
    zip.end();
    await done;
    if (zipError) throw zipError;
    fs.renameSync(tmp, file);
  } catch (e) {
    out.destroy();
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  const size = fs.statSync(file).size;
  const logId = logChange(db, { actor: 'system', action: 'backup.create', summary: `Создана резервная копия ${name}`, details: { name, size, counts: manifest.counts, missing } });
  db.run("INSERT INTO meta (key, value) VALUES ('last_backup_log_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(logId));
  pruneBackups(config);
  return { name, size, createdAt: manifest.createdAt, counts: manifest.counts, missing };
}

// Были ли изменения после последней копии (чтобы не плодить одинаковые автоматические копии).
export function changedSinceLastBackup(db) {
  const last = Number(db.get("SELECT value FROM meta WHERE key = 'last_backup_log_id'")?.value || 0);
  const max = db.get('SELECT MAX(id) AS m FROM change_log')?.m || 0;
  return max > last;
}

// Хранение: последние N автоматических и N «страховочных» (перед откатом/восстановлением) копий.
// Копии, созданные вручную, удаляются только вручную.
export function pruneBackups(config) {
  const list = listBackups(config);
  const removed = [];
  const groups = [
    [list.filter((b) => b.kind === 'auto'), config.autoBackupKeep],
    [list.filter((b) => b.kind === 'safety'), config.safetyBackupKeep],
  ];
  for (const [items, keep] of groups) {
    for (const b of items.slice(keep)) {
      fs.rmSync(path.join(config.backupsDir, b.name), { force: true });
      removed.push(b.name);
    }
  }
  return removed;
}

export function deleteBackup(db, config, name) {
  const p = backupPath(config, name);
  fs.rmSync(p, { force: true });
  logChange(db, { actor: 'user', action: 'backup.delete', summary: `Удалена резервная копия ${name}` });
}

export function listBackups(config) {
  if (!fs.existsSync(config.backupsDir)) return [];
  return fs.readdirSync(config.backupsDir)
    .filter(isBackupName)
    .map((f) => {
      const st = fs.statSync(path.join(config.backupsDir, f));
      const kind = f.endsWith('-auto.zip') ? 'auto' : /-before-[a-z-]+\.zip$/.test(f) ? 'safety' : 'manual';
      return { name: f, size: st.size, modifiedAt: st.mtime.toISOString(), kind };
    })
    .sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : a.modifiedAt > b.modifiedAt ? -1 : a.name < b.name ? 1 : -1));
}

export function backupPath(config, name) {
  if (!isBackupName(name)) throw badRequest('Неверное имя файла копии');
  const p = path.join(config.backupsDir, name);
  if (!fs.existsSync(p)) throw notFound('Резервная копия не найдена');
  return p;
}

// Допустимые элементы архива резервной копии.
const ENTRY_RE = /^(manifest\.json|data\.json|photos\/[0-9a-f-]{36}\/[a-z0-9.-]+|imports\/[0-9a-f]{64}\.xlsx)$/;
function allowedEntry(name) {
  if (!ENTRY_RE.test(name)) return false;
  const parts = name.split('/');
  if (parts[0] === 'photos') return isUuid(parts[1]) && isPhotoFile(parts[2]);
  if (parts[0] === 'imports') return isImportFile(parts[1]);
  return true;
}

// Потоковое чтение архива с ограничениями: только допустимые имена, ограничение объёма
// распакованных данных (защита от «zip-бомб»), тексты — не больше maxText байт.
function readZip(file, { wantText = () => false, extractTo = null, accept = () => false, maxText = 32 * 1024 * 1024, maxTotal = Infinity, maxFile = Infinity }) {
  return new Promise((resolve, reject) => {
    const texts = {};
    const entries = [];
    let failed = null;
    let total = 0;
    const fail = (e) => {
      if (!failed) failed = e;
    };
    const uz = new Unzip((stream) => {
      const name = stream.name;
      if (name.includes('..') || path.isAbsolute(name) || name.includes('\\') || name.includes('\0')) {
        fail(unprocessable('Архив содержит недопустимые пути'));
        return;
      }
      if (name.endsWith('/')) return;
      if (!allowedEntry(name)) return; // посторонние файлы игнорируются
      entries.push(name);
      if (wantText(name)) {
        const chunks = [];
        let size = 0;
        stream.ondata = (err, chunk, final) => {
          if (err) return fail(err);
          size += chunk.length;
          if (size > maxText) return fail(unprocessable('Файл данных в архиве слишком большой'));
          chunks.push(chunk);
          if (final) texts[name] = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
        };
        stream.start();
      } else if (extractTo && accept(name)) {
        const target = path.join(extractTo, name);
        if (!path.resolve(target).startsWith(path.resolve(extractTo) + path.sep)) return fail(unprocessable('Архив содержит недопустимые пути'));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const fd = fs.openSync(target, 'wx');
        let size = 0;
        let closed = false;
        stream.ondata = (err, chunk, final) => {
          if (err || failed) {
            if (!closed) {
              closed = true;
              fs.closeSync(fd);
            }
            if (err) fail(err);
            return;
          }
          size += chunk.length;
          total += chunk.length;
          if (size > maxFile || total > maxTotal) {
            closed = true;
            fs.closeSync(fd);
            return fail(unprocessable('Распакованные данные архива слишком большие или на диске недостаточно места'));
          }
          fs.writeSync(fd, chunk);
          if (final) {
            closed = true;
            fs.closeSync(fd);
          }
        };
        stream.start();
      }
    });
    uz.register(UnzipInflate);
    const rs = fs.createReadStream(file, { highWaterMark: 1 << 20 });
    rs.on('data', (chunk) => {
      if (failed) {
        rs.destroy();
        return;
      }
      try {
        uz.push(new Uint8Array(chunk));
      } catch (e) {
        fail(e);
        rs.destroy();
      }
    });
    rs.on('error', reject);
    rs.on('close', () => {
      try {
        if (!failed) uz.push(new Uint8Array(0), true);
      } catch (e) {
        fail(e);
      }
      if (failed) reject(failed instanceof Error && failed.status ? failed : unprocessable('Архив повреждён или не является резервной копией'));
      else resolve({ texts, entries });
    });
  });
}

const isStr = (v) => typeof v === 'string' && v.length > 0 && v.length < 300;

// Проверка содержимого копии до восстановления.
function validateBackupData(data) {
  for (const t of ['persons', 'parent_child', 'partnerships', 'photos', 'hypotheses']) {
    if (!Array.isArray(data[t])) throw unprocessable(`В копии нет таблицы ${t}`);
  }
  for (const t of BACKUP_TABLES) {
    if (data[t] !== undefined && !Array.isArray(data[t])) throw unprocessable(`Таблица ${t} в копии повреждена`);
    for (const row of data[t] || []) if (!row || typeof row !== 'object' || Array.isArray(row)) throw unprocessable(`Таблица ${t} в копии повреждена`);
  }
  if (!data.persons.every((p) => isStr(p.id) && isStr(p.display_name))) throw unprocessable('Копия повреждена: неверные записи людей');
  for (const ph of data.photos) {
    if (!isUuid(ph.id) || !isStr(ph.person_id) || !['original_file', 'display_file', 'thumb_file'].every((k) => isPhotoFile(ph[k]))) {
      throw unprocessable('Копия содержит недопустимые имена файлов фотографий');
    }
  }
  for (const imp of data.imports || []) {
    if (imp.stored_file != null && !isImportFile(imp.stored_file)) throw unprocessable('Копия содержит недопустимые имена файлов импорта');
  }
}

const restoreTokens = new Map();
const TOKEN_TTL_MS = 60 * 60 * 1000;

// Старые предпросмотры восстановления забываются, загруженные для них файлы удаляются.
function cleanupRestoreTokens(config, keepLatest = 2) {
  const now = Date.now();
  const list = [...restoreTokens.entries()].sort((a, b) => b[1].createdAt - a[1].createdAt);
  list.forEach(([token, t], i) => {
    if (now - t.createdAt > TOKEN_TTL_MS || i >= keepLatest) {
      restoreTokens.delete(token);
      if (t.uploaded) fs.rmSync(t.zipFile, { force: true });
    }
  });
}

export async function restorePreview(db, config, zipFile, { uploaded = false } = {}) {
  cleanupRestoreTokens(config);
  const { texts, entries } = await readZip(zipFile, { wantText: (n) => n === 'manifest.json' || n === 'data.json' });
  if (texts['manifest.json'] && texts['manifest.json'].length > 1024 * 1024) throw unprocessable('Неверный manifest.json');
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
  validateBackupData(data);
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
  restoreTokens.set(token, { zipFile, data, manifest, uploaded, createdAt: Date.now() });
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
    // Распаковка не должна занять весь диск: предел — свободное место за вычетом запаса.
    const room = Math.max(0, diskSpace(config.dataDir).free - config.diskReserveBytes);
    await readZip(t.zipFile, {
      extractTo: work,
      accept: (n) => n.startsWith('photos/') || n.startsWith('imports/'),
      maxTotal: Math.min(room, config.maxBackupBytes * 2),
      maxFile: Math.max(config.maxPhotoBytes, config.maxImportBytes) * 2,
    });
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
    if (t.uploaded) fs.rmSync(t.zipFile, { force: true });
    return { counts: countsOf(t.data), manifest: t.manifest };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
