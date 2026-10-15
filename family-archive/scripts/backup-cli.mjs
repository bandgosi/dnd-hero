// Резервная копия из командной строки (используется командой «family-archive backup»
// и перед обновлением на сервере). Пишет имя копии в стандартный вывод.
//   node scripts/backup-cli.mjs [--label before-update]
import { loadConfig } from '../server/config.js';
import { openDb } from '../server/db.js';
import { createBackup } from '../server/services/backup.js';

const i = process.argv.indexOf('--label');
const label = i > 0 ? process.argv[i + 1] : null;
const config = loadConfig();
const db = openDb(config.dbFile);
try {
  const hasData = db.get('SELECT COUNT(*) AS n FROM persons').n > 0;
  if (!hasData && label) {
    console.log('Архив пуст — копия не нужна.');
  } else {
    const bk = await createBackup(db, config, { label, appVersion: config.appVersion });
    console.log(`Резервная копия создана: ${config.backupsDir}/${bk.name} (${Math.round(bk.size / 1024)} КБ)`);
  }
} catch (e) {
  console.error(`Не удалось создать копию: ${e.message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
