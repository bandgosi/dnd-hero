// Настройки из переменных окружения (и файла .env, если он есть).
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');

export function loadConfig(env = process.env) {
  const envFile = path.join(ROOT, '.env');
  if (env === process.env && fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const dataDir = path.resolve(ROOT, env.DATA_DIR || 'data');
  const host = env.HOST || '127.0.0.1';
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(host);
  const mb = (v, d) => Math.max(1, Number(v) || d) * 1024 * 1024;
  return {
    host,
    port: Number(env.PORT) || 3000,
    loopback,
    dataDir,
    dbFile: path.join(dataDir, 'family.db'),
    photosDir: path.join(dataDir, 'photos'),
    importsDir: path.join(dataDir, 'imports'),
    backupsDir: path.join(dataDir, 'backups'),
    tmpDir: path.join(dataDir, 'tmp'),
    password: env.APP_PASSWORD || '',
    sessionDays: Number(env.SESSION_DAYS) || 30,
    cookieSecure: env.COOKIE_SECURE === '1' || env.COOKIE_SECURE === 'true',
    trustProxy: env.TRUST_PROXY || '',
    allowedHosts: (env.ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    maxPhotoBytes: mb(env.MAX_PHOTO_MB, 25),
    maxImportBytes: mb(env.MAX_IMPORT_MB, 10),
    maxBackupBytes: mb(env.MAX_BACKUP_MB, 4096),
    autoBackupDays: Number(env.AUTO_BACKUP_DAYS ?? 1),
    clientDist: path.join(ROOT, 'client', 'dist'),
    appVersion: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
  };
}
