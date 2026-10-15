// Разбор data.json резервной копии в отдельном потоке с ограниченной памятью:
// испорченный или подложный файл может исчерпать память только этого потока, а не сервера.
// Остаются только известные таблицы и столбцы, значения — строки, числа или пусто.
import { parentPort, workerData } from 'node:worker_threads';

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

try {
  parentPort.postMessage({ data: clean(workerData) });
} catch (e) {
  parentPort.postMessage({ error: e instanceof BadData ? e.message : 'Файлы резервной копии повреждены' });
}
