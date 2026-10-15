// Точка входа сервера.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, configProblems } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { createBackup, listBackups, changedSinceLastBackup } from './services/backup.js';

const config = loadConfig();

const problems = configProblems(config);
if (problems.length) {
  console.error('\nОтказ запуска — небезопасные или неверные настройки:');
  for (const p of problems) console.error(`  • ${p}`);
  console.error('Подробнее — в README, раздел «Установка на сервер».\n');
  process.exit(1);
}

fs.mkdirSync(config.dataDir, { recursive: true });
// Остатки прерванных операций (перезапуск, сбой): предпросмотры восстановления не переживают
// перезапуск, поэтому загрузки, папки распаковки и незавершённые копии больше не нужны.
const leftovers = [
  ...fs.readdirSync(config.dataDir).filter((f) => /^(restore|trash)-\d+$/.test(f)).map((f) => path.join(config.dataDir, f)),
  ...(fs.existsSync(config.tmpDir) ? fs.readdirSync(config.tmpDir).map((f) => path.join(config.tmpDir, f)) : []),
  // .part может принадлежать копии, которую прямо сейчас делает команда backup, — только старые.
  ...(fs.existsSync(config.backupsDir) ? fs.readdirSync(config.backupsDir).filter((f) => f.endsWith('.part')).map((f) => path.join(config.backupsDir, f)).filter((p) => Date.now() - fs.statSync(p).mtimeMs > 3600000) : []),
];
for (const p of leftovers) fs.rmSync(p, { recursive: true, force: true });
const db = openDb(config.dbFile);
const app = createApp({ db, config });

// Автоматическая резервная копия: раз в AUTO_BACKUP_DAYS дней, если в базе есть данные
// и после прошлой копии что-то изменилось. Хранятся последние AUTO_BACKUP_KEEP копий.
async function autoBackup() {
  if (!config.autoBackupDays) return;
  try {
    const hasData = db.get('SELECT COUNT(*) AS n FROM persons').n > 0;
    if (!hasData || !changedSinceLastBackup(db)) return;
    const last = listBackups(config).find((b) => b.kind === 'auto');
    if (last && Date.now() - new Date(last.modifiedAt).getTime() < config.autoBackupDays * 86400000) return;
    const bk = await createBackup(db, config, { label: 'auto', appVersion: config.appVersion });
    console.log(`Автоматическая резервная копия: ${bk.name}`);
    db.run("DELETE FROM meta WHERE key = 'auto_backup_error'");
  } catch (e) {
    console.error('Не удалось создать автоматическую резервную копию:', e.message);
    // Ошибка видна в разделе «Архив», а не только в журнале службы.
    try {
      db.run("INSERT INTO meta (key, value) VALUES ('auto_backup_error', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify({ at: new Date().toISOString(), message: String(e.message).slice(0, 500) }));
    } catch {
      /* база недоступна — остаётся запись в журнале */
    }
  }
}

// Под systemd порт заранее открывает family-archive.socket и передаёт его как дескриптор 3:
// порт занят всегда, даже во время перезапуска, и его не может перехватить другая программа.
const systemdSocket = process.env.LISTEN_FDS === '1' && Number(process.env.LISTEN_PID) === process.pid;
const listenTarget = systemdSocket ? [{ fd: 3 }] : [config.port, config.host];
const server = app.listen(...listenTarget, () => {
  const shown = config.host === '127.0.0.1' || config.host === '::1' ? 'localhost' : config.host;
  console.log('\n  История нашего рода — семейный архив');
  console.log(systemdSocket ? '  Порт открыт службой systemd (family-archive.socket).' : `  Откройте в браузере: http://${shown}:${config.port}`);
  console.log(`  База данных:  ${config.dbFile}`);
  console.log(`  Фотографии:   ${config.photosDir}`);
  console.log(`  Копии:        ${config.backupsDir}`);
  console.log(config.password || config.passwordHash ? '  Вход по паролю включён.' : '  Доступ только с этого компьютера (пароль не задан).');
  console.log('  Остановить: Ctrl+C\n');
  // Первая проверка — через несколько минут после запуска, а не сразу (не нагружает старт).
  setTimeout(autoBackup, 5 * 60 * 1000).unref();
});
setInterval(autoBackup, 60 * 60 * 1000).unref();
// Большая резервная копия может загружаться дольше стандартных 5 минут: общий предел — 2 часа,
// а соединение без движения данных закрывается через 10 минут.
server.requestTimeout = 2 * 60 * 60 * 1000;
server.timeout = 10 * 60 * 1000;

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
