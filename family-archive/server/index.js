// Точка входа сервера.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { createBackup, listBackups } from './services/backup.js';

const config = loadConfig();

if (!config.loopback && !config.password) {
  console.error('\nОтказ запуска: сервер настроен на адрес %s, но не задан APP_PASSWORD.', config.host);
  console.error('Для доступа из сети обязательно задайте пароль (см. .env.example) и используйте HTTPS.\n');
  process.exit(1);
}

fs.mkdirSync(config.dataDir, { recursive: true });
// Временные загрузки старше суток (например, непрошедшее восстановление) удаляются.
try {
  for (const f of fs.readdirSync(config.tmpDir)) {
    const p = path.join(config.tmpDir, f);
    if (Date.now() - fs.statSync(p).mtimeMs > 86400000) fs.rmSync(p, { recursive: true, force: true });
  }
} catch {
  /* папки ещё нет */
}
const db = openDb(config.dbFile);
const app = createApp({ db, config });

// Автоматическая резервная копия: раз в AUTO_BACKUP_DAYS дней, если в базе есть данные.
// Хранятся последние 10 автоматических копий.
async function autoBackup() {
  if (!config.autoBackupDays) return;
  try {
    const hasData = db.get('SELECT COUNT(*) AS n FROM persons').n > 0;
    if (!hasData) return;
    const autos = listBackups(config).filter((b) => b.name.includes('-auto'));
    const last = autos[0];
    if (last && Date.now() - new Date(last.modifiedAt).getTime() < config.autoBackupDays * 86400000) return;
    const bk = await createBackup(db, config, { label: 'auto', appVersion: config.appVersion });
    console.log(`Автоматическая резервная копия: ${bk.name}`);
    for (const old of listBackups(config).filter((b) => b.name.includes('-auto')).slice(10)) {
      fs.rmSync(path.join(config.backupsDir, old.name), { force: true });
    }
  } catch (e) {
    console.error('Не удалось создать автоматическую резервную копию:', e.message);
  }
}

const server = app.listen(config.port, config.host, () => {
  const shown = config.host === '127.0.0.1' || config.host === '::1' ? 'localhost' : config.host;
  console.log('\n  История нашего рода — семейный архив');
  console.log(`  Откройте в браузере: http://${shown}:${config.port}`);
  console.log(`  База данных:  ${config.dbFile}`);
  console.log(`  Фотографии:   ${config.photosDir}`);
  console.log(`  Копии:        ${config.backupsDir}`);
  console.log(config.password ? '  Вход по паролю включён.' : '  Доступ только с этого компьютера (пароль не задан).');
  console.log('  Остановить: Ctrl+C\n');
  autoBackup();
});
setInterval(autoBackup, 60 * 60 * 1000).unref();

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Порт ${config.port} занят. Укажите другой: PORT=3001 npm start`);
  else console.error(e);
  process.exit(1);
});

function shutdown() {
  server.close(() => {
    try {
      db.close();
    } catch {
      /* база уже закрыта */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
