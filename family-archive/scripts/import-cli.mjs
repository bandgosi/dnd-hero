// Импорт Excel из командной строки: npm run import -- "путь/к/файлу.xlsx" [--dry-run]
// Люди импортируются без подтверждённых связей; предположения сохраняются как вопросы.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../server/config.js';
import { openDb } from '../server/db.js';
import { createPreview, commitImport } from '../server/services/imports.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const dry = args.includes('--dry-run');
if (!file) {
  console.error('Использование: npm run import -- "путь/к/файлу.xlsx" [--dry-run]');
  process.exit(1);
}
const config = loadConfig();
const db = openDb(config.dbFile);
const buffer = fs.readFileSync(file);
const preview = await createPreview(db, config, { buffer, fileName: path.basename(file) });
console.log(`Файл: ${preview.fileName}`);
console.log(`SHA-256: ${preview.checksum}`);
for (const c of preview.checks) console.log(` • ${c.text}`);
console.log(`Записей: ${preview.records.length}, предположений: ${preview.hypotheses.length}, вопросов: ${preview.questions.length}`);
if (preview.mode === 'duplicate') {
  console.log(`Этот файл уже импортирован ${preview.duplicateOf.created_at}. Дубли не создаются.`);
  process.exit(0);
}
if (preview.mode === 'update') {
  console.log('Найдена предыдущая версия файла. Для сверки различий используйте интерфейс («Импорт из Excel») — там видны конфликты с ручными правками.');
  process.exit(2);
}
if (dry) {
  console.log('Пробный запуск: ничего не сохранено.');
  process.exit(0);
}
const r = commitImport(db, config, { previewId: preview.previewId });
console.log(`Сохранено: людей ${r.summary.persons}, исходных записей ${r.summary.records}, предположений ${r.summary.hypotheses}, вопросов ${r.summary.questions}, подтверждённых связей ${r.summary.confirmed}.`);
db.close();
