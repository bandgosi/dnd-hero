// Отдельный процесс для data.json резервной копии (запускается из backup.js с собственным
// пределом памяти --max-old-space-size): испорченный или подложный файл может исчерпать память
// только этого процесса. data.json читается из архива здесь же; основной процесс его содержимого
// не касается.
//   summary — разобрать, очистить, проверить и вернуть сводку (числа записей, нужные файлы);
//   restore — то же и заменить данные базы содержимым копии (своё соединение с базой).
import { readZipFile } from './zip.js';
import { Db } from '../db.js';
import { BACKUP_TABLES, cleanData, validateBackupData, summarize, insertData } from '../services/backup-data.js';

async function run({ mode, zipFile, dbFile, maxRows, maxText, manifest }) {
  const db = new Db(dbFile);
  try {
    const columns = {};
    for (const table of BACKUP_TABLES) columns[table] = db.all(`PRAGMA table_info(${table})`).map((c) => c.name);
    const { texts } = await readZipFile(zipFile, { allowed: (n) => n === 'data.json', wantText: (n) => n === 'data.json', maxText });
    if (!texts['data.json']) throw Object.assign(new Error('Это не резервная копия «Истории нашего рода»: нет data.json'), { status: 422 });
    let text = texts['data.json'].toString('utf8');
    delete texts['data.json'];
    const data = cleanData(text, columns, maxRows);
    text = null;
    validateBackupData(data);
    const summary = summarize(data);
    if (mode === 'restore') insertData(db, data, manifest);
    return { summary };
  } finally {
    db.close();
  }
}

process.once('message', async (msg) => {
  let reply;
  try {
    reply = await run(msg);
  } catch (e) {
    const constraint = String(e?.code || '').startsWith('ERR_SQLITE');
    reply = { error: e?.status ? e.message : constraint ? 'Данные копии нарушают ограничения базы — восстановление отменено, данные не изменены' : 'Файлы резервной копии повреждены' };
  }
  process.send(reply, () => process.exit(0));
});
