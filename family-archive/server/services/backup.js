// Резервные копии: один .zip-файл с данными (JSON) и всеми фотографиями.
// Формат: manifest.json (версия формата), data.json (все таблицы), photos/<id>/…, imports/<контрольная сумма>.xlsx
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fork } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { readZipFile } from '../lib/zip.js';
import { ApiError, nowIso, badRequest, notFound, unprocessable, conflict } from '../lib/util.js';
import { logChange } from './history.js';
import { BACKUP_TABLES, countsOf, allowedEntry } from './backup-data.js';
import { isUuid, isPhotoFile, isImportFile, isBackupName } from '../lib/safety.js';
import { ensureSpace, hasSpace, diskSpace } from './storage.js';

export const BACKUP_FORMAT = 'family-archive-backup';
export const BACKUP_FORMAT_VERSION = 1;

export { BACKUP_TABLES };

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');

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
  // Один и тот же файл Excel может принадлежать нескольким импортам (откат и повторный импорт).
  const added = new Set();
  for (const ph of data.photos) {
    for (const k of ['original_file', 'display_file', 'thumb_file']) {
      if (!isUuid(ph.id) || !isPhotoFile(ph[k])) {
        missing.push(`${ph.id}/${ph[k]}`);
        continue;
      }
      const p = path.join(config.photosDir, ph.id, ph[k]);
      if (fs.existsSync(p) && !added.has(p)) {
        added.add(p);
        files.push({ name: `photos/${ph.id}/${ph[k]}`, path: p, size: fileSize(p) });
      }
      else missing.push(`${ph.id}/${ph[k]}`);
    }
  }
  for (const imp of data.imports) {
    if (!isImportFile(imp.stored_file)) continue;
    const p = path.join(config.importsDir, imp.stored_file);
    if (fs.existsSync(p) && !added.has(p)) {
      added.add(p);
      files.push({ name: `imports/${imp.stored_file}`, path: p, size: fileSize(p) });
    }
  }
  return { files, missing };
}

// Копии создаются строго по одной: одновременные запросы не проверят место «дважды»
// и не будут вместе занимать память и диск.
let backupQueue = Promise.resolve();
export function createBackup(db, config, opts = {}) {
  const run = backupQueue.then(() => createBackupNow(db, config, opts));
  backupQueue = run.catch(() => {});
  return run;
}

// Построчное чтение (если версия node:sqlite его поддерживает).
function* rowsOf(conn, sql) {
  const st = conn.prepare(sql);
  if (typeof st.iterate === 'function') yield* st.iterate();
  else yield* st.all();
}

async function createBackupNow(db, config, { label = null, appVersion = '1.0.0' } = {}) {
  fs.mkdirSync(config.backupsDir, { recursive: true });
  const cleanLabel = label ? String(label).toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^[^a-z]+/, '').slice(0, 30) : '';
  const base = `family-archive-${stamp()}`;
  let name = `${base}${cleanLabel ? '-' + cleanLabel : ''}.zip`;
  for (let n = 2; fs.existsSync(path.join(config.backupsDir, name)) && n < 1000; n++) name = `${base}-${n}${cleanLabel ? '-' + cleanLabel : ''}.zip`;
  const file = path.join(config.backupsDir, name);
  // В имени временных файлов — номер процесса: после сбоя их можно отличить от копии,
  // которую прямо сейчас делает другой процесс (например, команда backup).
  removeStaleTemp(config);
  const tmp = `${file}.${process.pid}.part`;
  const snap = `${file}.${process.pid}.snap`;
  // Отдельное соединение только для чтения: снимок базы на начало копии (WAL), пока приложение
  // продолжает работать; таблицы читаются построчно и сразу пишутся в архив.
  const separate = db.file && db.file !== ':memory:';
  const rd = separate ? new DatabaseSync(db.file, { readOnly: true }) : db.raw;
  let inTx = false;
  try {
    rd.exec('BEGIN');
    inTx = true;
    const count = (t) => rd.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    // Последняя запись журнала, вошедшая в снимок: правки во время записи копии в неё не попадут.
    const snapshotLogId = rd.prepare('SELECT MAX(id) AS m FROM change_log').get().m || 0;
    const counts = {
      persons: count('persons'), parentChild: count('parent_child'), partnerships: count('partnerships'), photos: count('photos'),
      hypotheses: count('hypotheses'), questions: count('questions'), sources: count('sources'), imports: count('imports'), sourceRecords: count('source_records'),
    };
    const manifest = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      appVersion,
      schemaVersion: db.schemaVersion(),
      createdAt: nowIso(),
      label,
      counts,
      note: 'Резервная копия «История нашего рода». Даты хранятся без времени, исходные строки Excel — без изменений.',
    };
    const { files, missing } = backupFiles(config, {
      photos: rd.prepare('SELECT id, original_file, display_file, thumb_file FROM photos').all(),
      imports: rd.prepare('SELECT stored_file FROM imports').all(),
    });
    // Место: фото хранятся в копии без сжатия, данные — не больше размера базы.
    const need = files.reduce((n, f) => n + f.size, 0) + fileSize(db.file) + fileSize(`${db.file}-wal`) + 1024 * 1024;
    // fflate пишет архивы без ZIP64: копия больше 4 ГБ была бы повреждена.
    if (need > 4 * 1024 ** 3 - 64 * 1024 * 1024) throw new ApiError(507, 'Архив стал больше 4 ГБ — такая резервная копия не поддерживается. Скачайте фотографии отдельно или разделите архив.');
    if (cleanLabel === 'auto') makeRoomForAuto(config, need);
    ensureSpace(config, need, 'для резервной копии');
    // Снимок файлов жёсткими ссылками (мгновенно, без копирования) в момент снимка базы:
    // фото, заменённое или удалённое во время записи копии, в ней останется целым.
    fs.mkdirSync(snap, { recursive: true });
    files.forEach((f, i) => {
      const link = path.join(snap, String(i));
      try {
        fs.linkSync(f.path, link);
        f.path = link;
      } catch {
        /* файловая система без жёстких ссылок — файл читается из исходного места */
      }
    });

    const out = fs.createWriteStream(tmp);
    const done = new Promise((resolve, reject) => {
      out.on('finish', resolve);
      out.on('error', reject);
    });
    done.catch(() => {}); // ошибка записи обрабатывается ниже через await done
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
    const waitDrain = () =>
      out.writableNeedDrain
        ? new Promise((resolve, reject) => {
            const onError = (e) => {
              out.off('drain', onDrain);
              reject(e);
            };
            const onDrain = () => {
              out.off('error', onError);
              resolve();
            };
            out.once('drain', onDrain);
            out.once('error', onError);
          })
        : null;
    // Файлы читаются кусками и ждут, пока предыдущие запишутся на диск:
    // память не растёт с размером архива (важно для сервера с 1 ГБ ОЗУ).
    const addFile = async (n, filePath) => {
      const f = new ZipPassThrough(n);
      zip.add(f);
      for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })) {
        f.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.length), false);
        if (zipError) throw zipError;
        await waitDrain();
      }
      f.push(new Uint8Array(0), true);
    };
    // data.json пишется по частям: {"persons":[…],"imports":[…],…}
    let dataBytes = 0;
    let dataRows = 0;
    const addData = async () => {
      const f = new ZipDeflate('data.json', { level: 6 });
      zip.add(f);
      const enc = new TextEncoder();
      let buf = '{';
      const flush = async (final) => {
        const bytes = enc.encode(buf);
        dataBytes += bytes.length;
        f.push(bytes, final);
        buf = '';
        if (zipError) throw zipError;
        await waitDrain();
      };
      for (let i = 0; i < BACKUP_TABLES.length; i++) {
        buf += `${i ? ',' : ''}${JSON.stringify(BACKUP_TABLES[i])}:[`;
        let first = true;
        for (const row of rowsOf(rd, `SELECT * FROM ${BACKUP_TABLES[i]}`)) {
          dataRows++;
          buf += (first ? '' : ',') + JSON.stringify(row);
          first = false;
          if (buf.length > 256 * 1024) await flush(false);
        }
        buf += ']';
      }
      buf += '}';
      await flush(true);
    };
    try {
      const m = new ZipDeflate('manifest.json', { level: 6 });
      zip.add(m);
      m.push(new TextEncoder().encode(JSON.stringify(manifest, null, 2)), true);
      await addData();
      rd.exec('COMMIT');
      inTx = false;
      for (const f of files) {
        // Фото, удалённое уже во время создания копии, пропускается.
        if (fs.existsSync(f.path)) await addFile(f.name, f.path);
        else missing.push(f.name.replace(/^photos\//, ''));
      }
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
    logChange(db, { actor: 'system', action: 'backup.create', summary: `Создана резервная копия ${name}`, details: { name, size, counts, missing } });
    db.run("INSERT INTO meta (key, value) VALUES ('last_backup_log_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(snapshotLogId));
    pruneBackups(config);
    // Копия, которую это приложение не сможет восстановить, — повод предупредить сразу, а не при восстановлении.
    let warning = null;
    if (dataBytes > MAX_DATA_JSON || dataRows > MAX_BACKUP_ROWS) {
      warning = `Данных стало больше, чем приложение может восстановить из копии (${Math.round(dataBytes / 1048576)} МБ при пределе ${Math.round(MAX_DATA_JSON / 1048576)} МБ). Копия сохранена — фото и данные в ней целы, но восстановить её через приложение не получится.`;
      db.run("INSERT INTO meta (key, value) VALUES ('backup_warning', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify({ at: nowIso(), message: warning }));
    } else db.run("DELETE FROM meta WHERE key = 'backup_warning'");
    return { name, size, createdAt: manifest.createdAt, counts, missing, warning };
  } finally {
    if (inTx) {
      try {
        rd.exec('ROLLBACK');
      } catch {
        /* транзакция уже закрыта */
      }
    }
    if (separate) rd.close();
    fs.rmSync(snap, { recursive: true, force: true });
  }
}

const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

// Остатки прерванных копий (.part и снимки .snap): процесс, который их создал, больше не работает.
export function removeStaleTemp(config) {
  if (!fs.existsSync(config.backupsDir)) return;
  for (const f of fs.readdirSync(config.backupsDir)) {
    const m = /\.(\d+)\.(part|snap)$/.exec(f);
    const p = path.join(config.backupsDir, f);
    if (m ? !pidAlive(Number(m[1])) : f.endsWith('.part') && Date.now() - fs.statSync(p).mtimeMs > 3600000) fs.rmSync(p, { recursive: true, force: true });
  }
}

// Перед автоматической копией при нехватке места удаляются самые старые автоматические копии —
// но только если этого хватит; иначе ничего не удаляется (последние копии важнее).
function makeRoomForAuto(config, need) {
  if (hasSpace(config, need)) return;
  const inUse = filesInRestore();
  const autos = listBackups(config).filter((b) => b.kind === 'auto' && !inUse.has(path.resolve(config.backupsDir, b.name)));
  const { free } = diskSpace(config.dataDir);
  let freed = 0;
  let count = 0;
  for (let i = autos.length - 1; i >= 0 && free + freed - need < config.diskReserveBytes; i--) {
    freed += autos[i].size;
    count++;
  }
  if (free + freed - need < config.diskReserveBytes) return;
  for (const b of autos.slice(autos.length - count)) fs.rmSync(path.join(config.backupsDir, b.name), { force: true });
}

// Были ли изменения после последней копии (чтобы не плодить одинаковые автоматические копии).
export function changedSinceLastBackup(db) {
  const last = Number(db.get("SELECT value FROM meta WHERE key = 'last_backup_log_id'")?.value || 0);
  // Создание и удаление копий данные не меняют.
  const max = db.get("SELECT MAX(id) AS m FROM change_log WHERE action NOT IN ('backup.create', 'backup.delete')")?.m || 0;
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
  const inUse = filesInRestore();
  for (const [items, keep] of groups) {
    for (const b of items.slice(keep)) {
      if (inUse.has(path.resolve(config.backupsDir, b.name))) continue;
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

// Чтение архива копии: только разрешённые имена (см. allowedEntry).
const readZip = (file, opts) => readZipFile(file, { allowed: allowedEntry, ...opts });

const restoreTokens = new Map();
const TOKEN_TTL_MS = 30 * 60 * 1000;
export const MAX_BACKUP_ROWS = 400000;
export const MAX_DATA_JSON = 32 * 1024 * 1024;
const CHILD_HEAP_MB = 200;
const MAX_ZIP_ENTRIES = 200000;

// Старые предпросмотры восстановления забываются, загруженные для них файлы удаляются.
function cleanupRestoreTokens(config, keepLatest = 1) {
  const now = Date.now();
  const list = [...restoreTokens.entries()].sort((a, b) => b[1].createdAt - a[1].createdAt);
  list.forEach(([token, t], i) => {
    if (now - t.createdAt > TOKEN_TTL_MS || i >= keepLatest) {
      restoreTokens.delete(token);
      if (t.uploaded) fs.rmSync(t.zipFile, { force: true });
    }
  });
}

export const hasRestoreToken = (token) => restoreTokens.has(token);

// Отмена восстановления: загруженный файл сразу удаляется.
export function discardRestore(token) {
  const t = restoreTokens.get(token);
  if (!t) return;
  restoreTokens.delete(token);
  if (t.uploaded) fs.rmSync(t.zipFile, { force: true });
}
// Забытые предпросмотры (вкладку закрыли) не держат загруженные копии на диске.
setInterval(() => cleanupRestoreTokens(null), 5 * 60 * 1000).unref();

// Файлы, выбранные для восстановления, не удаляются при очистке старых копий.
const filesInRestore = () => new Set([...restoreTokens.values()].map((t) => path.resolve(t.zipFile)));

// Восстановление идёт: изменения данных временно отклоняются (иначе они попали бы в базу,
// которую вот-вот заменят, или их файлы исчезли бы при подмене папок).
let restoring = false;
export const isRestoring = () => restoring;

// Данные копии разбираются, проверяются и при восстановлении записываются отдельным процессом
// с пределом памяти (см. backup-data-child.js): сюда возвращаются только числа.
function runDataChild(db, zipFile, mode, extra = {}) {
  return new Promise((resolve, reject) => {
    const child = fork(new URL('../lib/backup-data-child.js', import.meta.url), [], {
      execArgv: ['--disable-warning=ExperimentalWarning', `--max-old-space-size=${CHILD_HEAP_MB}`],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      serialization: 'advanced',
    });
    let settled = false;
    const finish = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.exitCode === null) child.kill('SIGKILL');
      fn(v);
    };
    const timer = setTimeout(() => finish(reject, unprocessable('Обработка резервной копии заняла слишком много времени')), 10 * 60 * 1000);
    child.once('message', (m) => (m?.error ? finish(reject, unprocessable(m.error)) : finish(resolve, m.result)));
    child.once('error', () => finish(reject, unprocessable('Не удалось проверить резервную копию')));
    // 'close' — после получения всех сообщений от процесса (в отличие от 'exit').
    child.once('close', () => finish(reject, unprocessable('Файл данных в копии слишком большой или повреждён')));
    child.send({ mode, zipFile: path.resolve(zipFile), dbFile: db.file, maxRows: MAX_BACKUP_ROWS, maxText: MAX_DATA_JSON, maxEntries: MAX_ZIP_ENTRIES, ...extra });
  });
}

// manifest.json (читается здесь; данные и список файлов — только в отдельном процессе).
async function readManifest(zipFile) {
  if (!fs.existsSync(zipFile)) throw conflict('Файл резервной копии больше не существует. Выберите копию ещё раз.');
  const { texts, entries } = await readZip(zipFile, { allowed: (n) => n === 'manifest.json' || n === 'data.json', wantText: (n) => n === 'manifest.json', maxText: 1024 * 1024, maxEntries: MAX_ZIP_ENTRIES });
  if (!texts['manifest.json'] || !entries.includes('data.json')) throw unprocessable('Это не резервная копия «Истории нашего рода»: нет manifest.json или data.json');
  let manifest;
  try {
    manifest = JSON.parse(texts['manifest.json'].toString('utf8'));
  } catch {
    throw unprocessable('Файлы резервной копии повреждены (не удалось прочитать JSON)');
  }
  if (!manifest || manifest.format !== BACKUP_FORMAT) throw unprocessable('Неизвестный формат резервной копии');
  if (!Number.isInteger(manifest.formatVersion) || manifest.formatVersion > BACKUP_FORMAT_VERSION) {
    throw unprocessable(`Версия формата копии (${manifest.formatVersion}) новее, чем поддерживает приложение (${BACKUP_FORMAT_VERSION}). Обновите приложение.`);
  }
  return { manifest };
}

export async function restorePreview(db, config, zipFile, { uploaded = false } = {}) {
  cleanupRestoreTokens(config);
  const { manifest } = await readManifest(zipFile);
  const summary = await runDataChild(db, zipFile, 'summary');
  const token = crypto.randomUUID();
  const counts = summary.counts;
  restoreTokens.set(token, { zipFile, manifest, counts, uploaded, createdAt: Date.now() });
  return {
    token,
    manifest,
    counts,
    missingPhotos: summary.missingSample,
    missingCount: summary.missingCount,
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
  if (restoring) throw conflict('Восстановление уже идёт.');
  const { manifest } = await readManifest(t.zipFile);
  const work = path.join(config.dataDir, `restore-${Date.now()}`);
  const restoreId = crypto.randomUUID();
  restoring = true;
  db.writeBlock = () => conflict('Идёт восстановление из резервной копии — изменения временно недоступны. Повторите через минуту.');
  fs.mkdirSync(work, { recursive: true });
  try {
    // Распаковка нужных файлов и запись в базу — в отдельном процессе. Распаковка не должна занять
    // весь диск: предел — свободное место за вычетом запаса.
    const room = Math.max(0, diskSpace(config.dataDir).free - config.diskReserveBytes);
    const extract = {
      dir: work,
      maxTotal: Math.min(room, config.maxBackupBytes * 2),
      // Не зависит от текущего MAX_PHOTO_MB: раньше могли приниматься файлы крупнее.
      maxFile: Math.max(200 * 1024 * 1024, config.maxPhotoBytes * 2, config.maxImportBytes * 2),
    };
    let counts;
    try {
      ({ counts } = await runDataChild(db, t.zipFile, 'restore', { manifest, restoreId, extract }));
    } catch (e) {
      // Процесс мог завершиться уже после записи базы (например, при перезапуске службы):
      // тогда данные заменены, и подмену папок нужно довести до конца.
      if (db.get("SELECT value FROM meta WHERE key = 'last_restore_id'")?.value !== restoreId) throw e;
      counts = t.counts;
    }
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
    return { counts, manifest };
  } finally {
    restoring = false;
    db.writeBlock = null;
    fs.rmSync(work, { recursive: true, force: true });
  }
}
