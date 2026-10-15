// Место на диске: проверка свободного места перед записью и сводка для раздела «Архив».
import fs from 'node:fs';
import path from 'node:path';
import { ApiError } from '../lib/util.js';

export function diskSpace(dir) {
  let d = dir;
  while (!fs.existsSync(d) && path.dirname(d) !== d) d = path.dirname(d);
  const s = fs.statfsSync(d);
  return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
}

export function dirSize(dir) {
  let total = 0;
  let stack;
  try {
    stack = [dir];
  } catch {
    return 0;
  }
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        try {
          total += fs.statSync(p).size;
        } catch {
          /* файл удалён во время подсчёта */
        }
      }
    }
  }
  return total;
}

const mb = (n) => `${Math.max(0, n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} МБ`;

// Бросает ошибку 507, если после записи needBytes останется меньше запаса.
export function ensureSpace(config, needBytes, what) {
  const { free } = diskSpace(config.dataDir);
  if (free - needBytes < config.diskReserveBytes) {
    throw new ApiError(507, `Недостаточно места на диске ${what}: нужно примерно ${mb(needBytes)}, свободно ${mb(free)}, а запас должен оставаться не меньше ${mb(config.diskReserveBytes)}. Удалите ненужные резервные копии в разделе «Архив» (предварительно скачав нужные).`, { needBytes, free, reserve: config.diskReserveBytes });
  }
}

export function storageUsage(config) {
  const { free, total } = diskSpace(config.dataDir);
  const dbSize = ['', '-wal', '-shm'].reduce((n, s) => {
    try {
      return n + fs.statSync(config.dbFile + s).size;
    } catch {
      return n;
    }
  }, 0);
  return {
    free,
    total,
    reserve: config.diskReserveBytes,
    db: dbSize,
    photos: dirSize(config.photosDir),
    backups: dirSize(config.backupsDir),
    imports: dirSize(config.importsDir),
    tmp: dirSize(config.tmpDir),
    autoBackupKeep: config.autoBackupKeep,
    safetyBackupKeep: config.safetyBackupKeep,
  };
}
