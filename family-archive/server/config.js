// Настройки из переменных окружения (и файла .env, если он есть).
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1'];

export function loadConfig(env = process.env) {
  const envFile = path.join(ROOT, '.env');
  if (env === process.env && fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const dataDir = path.resolve(ROOT, env.DATA_DIR || 'data');
  const host = env.HOST || '127.0.0.1';
  const loopback = LOCAL_HOSTS.includes(host);
  const num = (v, d) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
  const mb = (v, d) => Math.max(1, num(v, d)) * 1024 * 1024;
  const allowedHosts = (env.ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  // Число — количество доверенных прокси (строку «1» Express понял бы как адрес 0.0.0.1).
  const tp = String(env.TRUST_PROXY || '').trim();
  const trustProxy = /^\d+$/.test(tp) ? Number(tp) || '' : tp === 'true' ? true : tp === 'false' ? '' : tp;
  return {
    host,
    port: num(env.PORT, 3000),
    loopback,
    // Доступен ли сервер из сети: внешний адрес, работа за прокси или явные внешние имена.
    exposed: !loopback || !!trustProxy || allowedHosts.some((h) => !LOCAL_HOSTS.includes(h)),
    dataDir,
    dbFile: path.join(dataDir, 'family.db'),
    photosDir: path.join(dataDir, 'photos'),
    importsDir: path.join(dataDir, 'imports'),
    backupsDir: path.join(dataDir, 'backups'),
    tmpDir: path.join(dataDir, 'tmp'),
    password: env.APP_PASSWORD || '',
    passwordHash: env.APP_PASSWORD_HASH || '',
    sessionDays: num(env.SESSION_DAYS, 30),
    cookieSecure: env.COOKIE_SECURE === '1' || env.COOKIE_SECURE === 'true',
    trustProxy,
    allowedHosts,
    // Фотографии сжимаются в браузере до PHOTO_MAX_SIDE пикселей по длинной стороне (0 — хранить как есть).
    photoMaxSide: Math.max(0, Math.round(num(env.PHOTO_MAX_SIDE, 2048))),
    photoQuality: Math.min(0.95, Math.max(0.5, num(env.PHOTO_QUALITY, 0.85))),
    maxPhotoBytes: mb(env.MAX_PHOTO_MB, 15),
    maxImportBytes: mb(env.MAX_IMPORT_MB, 10),
    maxBackupBytes: mb(env.MAX_BACKUP_MB, 2048),
    autoBackupDays: num(env.AUTO_BACKUP_DAYS, 1),
    autoBackupKeep: Math.max(1, Math.round(num(env.AUTO_BACKUP_KEEP, 3))),
    safetyBackupKeep: Math.max(1, Math.round(num(env.SAFETY_BACKUP_KEEP, 3))),
    diskReserveBytes: Math.max(0, num(env.DISK_RESERVE_MB, 300)) * 1024 * 1024,
    clientDist: path.join(ROOT, 'client', 'dist'),
    appVersion: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
  };
}

// Проверки перед запуском: возвращает список ошибок (пустой — можно запускать).
export function configProblems(config) {
  const errors = [];
  if (config.passwordHash && !/^scrypt:(1024|2048|4096|8192|16384|32768|65536|131072):([1-9]|1[0-6]):[1-4]:[A-Za-z0-9_-]{16,}:[A-Za-z0-9_-]{32,}$/.test(config.passwordHash)) {
    errors.push('APP_PASSWORD_HASH имеет неверный формат. Создайте его командой: npm run hash-password');
  }
  if (config.exposed) {
    if (!config.password && !config.passwordHash) errors.push('Сервер доступен из сети (HOST, TRUST_PROXY или ALLOWED_HOSTS), но пароль не задан. Задайте APP_PASSWORD_HASH (npm run hash-password) или APP_PASSWORD.');
    if (config.password && !config.passwordHash && config.password.length < 10) errors.push('Пароль для доступа из сети должен быть не короче 10 символов.');
    if (!config.allowedHosts.some((h) => !LOCAL_HOSTS.includes(h))) errors.push('Для доступа из сети укажите ALLOWED_HOSTS — доменное имя сайта (например, archive.example.ru).');
  }
  return errors;
}
