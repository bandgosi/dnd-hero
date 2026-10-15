// Разбор data.json резервной копии в отдельном процессе с ограниченной памятью
// (запускается из backup.js с --max-old-space-size): испорченный или подложный файл может
// исчерпать память только этого процесса, а не сервера. data.json читается из архива здесь же,
// основной процесс его содержимого не касается. Остаются только известные таблицы и столбцы,
// значения — строки, числа или пусто. Результат — очищенный JSON-текст.
import { readZipFile } from './zip.js';

class BadData extends Error {}

function clean({ text, columns, maxRows }) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BadData('Файлы резервной копии повреждены (не удалось прочитать JSON)');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new BadData('Файлы резервной копии повреждены');
  const out = {};
  let rows = 0;
  for (const [table, cols] of Object.entries(columns)) {
    const list = data[table];
    if (list === undefined) continue;
    if (!Array.isArray(list)) throw new BadData(`Таблица ${table} в копии повреждена`);
    rows += list.length;
    if (rows > maxRows) throw new BadData('В копии слишком много записей');
    const known = new Set(cols);
    for (const row of list) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new BadData(`Таблица ${table} в копии повреждена`);
      let kept = 0;
      for (const k of Object.keys(row)) {
        const v = row[k];
        if (!known.has(k)) delete row[k];
        else if (v === null || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) kept++;
        else if (typeof v === 'boolean') {
          row[k] = v ? 1 : 0;
          kept++;
        } else throw new BadData(`Таблица ${table} в копии повреждена`);
      }
      if (!kept) throw new BadData(`Таблица ${table} в копии повреждена`);
    }
    out[table] = list;
  }
  return out;
}

process.once('message', async ({ zipFile, columns, maxRows, maxText }) => {
  let reply;
  try {
    const { texts } = await readZipFile(zipFile, { allowed: (n) => n === 'data.json', wantText: (n) => n === 'data.json', maxText, stopAfter: ['data.json'] });
    if (!texts['data.json']) throw new BadData('Это не резервная копия «Истории нашего рода»: нет data.json');
    const text = texts['data.json'].toString('utf8');
    delete texts['data.json'];
    reply = { data: JSON.stringify(clean({ text, columns, maxRows })) };
  } catch (e) {
    reply = { error: e instanceof BadData || e?.status ? e.message : 'Файлы резервной копии повреждены' };
  }
  process.send(reply, () => process.exit(0));
});
