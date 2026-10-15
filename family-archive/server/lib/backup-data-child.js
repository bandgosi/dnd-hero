// Отдельный процесс для данных резервной копии (запускается из backup.js с собственным пределом
// памяти --max-old-space-size): испорченный или подложный файл может исчерпать память только
// этого процесса. data.json, список файлов архива и сами файлы читаются здесь; основному процессу
// возвращаются только числа.
//   summary — разобрать, очистить, проверить; вернуть числа записей и недостающие фото;
//   restore — то же, распаковать нужные файлы в рабочую папку и заменить данные базы (своё
//             соединение, одна транзакция).
import { readZipFile } from './zip.js';
import { Db } from '../db.js';
import { BACKUP_TABLES, allowedEntry, cleanData, validateBackupData, summarize, referencedFiles, insertData } from '../services/backup-data.js';

async function run({ mode, zipFile, dbFile, maxRows, maxText, maxEntries, manifest, restoreId, extract }) {
  const db = new Db(dbFile);
  try {
    const columns = {};
    for (const table of BACKUP_TABLES) columns[table] = db.all(`PRAGMA table_info(${table})`).map((c) => c.name);
    const { texts, entries } = await readZipFile(zipFile, { allowed: allowedEntry, wantText: (n) => n === 'data.json', maxText, maxEntries });
    if (!texts['data.json']) throw Object.assign(new Error('Это не резервная копия «Истории нашего рода»: нет data.json'), { status: 422 });
    let text = texts['data.json'].toString('utf8');
    delete texts['data.json'];
    const data = cleanData(text, columns, maxRows);
    text = null;
    validateBackupData(data);
    if (mode !== 'restore') return summarize(data, entries);
    const wanted = referencedFiles(data);
    await readZipFile(zipFile, { allowed: allowedEntry, extractTo: extract.dir, accept: (n) => wanted.has(n), maxTotal: extract.maxTotal, maxFile: extract.maxFile, maxEntries });
    insertData(db, data, manifest, restoreId);
    return { counts: summarize(data, []).counts };
  } finally {
    db.close();
  }
}

// Ошибки SQLite различаются по коду: нарушение ограничений, занятая база, нехватка места.
function sqliteMessage(e) {
  const code = (e?.errcode ?? 0) & 0xff;
  if (code === 19) return 'Данные копии нарушают ограничения базы — восстановление отменено, данные не изменены';
  if (code === 5 || code === 6) return 'База занята другой операцией — повторите восстановление чуть позже. Данные не изменены';
  if (code === 13) return 'На диске не хватило места — восстановление отменено, данные не изменены';
  return null;
}

process.once('message', async (msg) => {
  let reply;
  try {
    reply = { result: await run(msg) };
  } catch (e) {
    reply = { error: e?.status ? e.message : sqliteMessage(e) || 'Файлы резервной копии повреждены' };
  }
  process.send(reply, () => process.exit(0));
});
