// Отпечаток исходников интерфейса. Записывается в client/dist/build-info.json при сборке;
// по нему запуск и установщик понимают, что готовая сборка соответствует коду.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function listFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

export function uiSourceHash(root) {
  const files = [
    ...listFiles(path.join(root, 'client', 'src')),
    ...listFiles(path.join(root, 'client', 'public')),
    ...listFiles(path.join(root, 'shared')),
    path.join(root, 'client', 'index.html'),
    path.join(root, 'vite.config.js'),
  ].map((p) => path.relative(root, p).split(path.sep).join('/')).sort();
  const h = crypto.createHash('sha256');
  for (const rel of files) {
    let buf = fs.readFileSync(path.join(root, rel));
    if (/\.(js|jsx|css|html|json|svg|mjs)$/.test(rel)) buf = Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'));
    h.update(rel + '\0');
    h.update(buf);
    h.update('\0');
  }
  // Версии библиотек интерфейса (только зависимости для разработки и сборки).
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const dev = Object.entries(lock.packages || {}).filter(([k, v]) => k.startsWith('node_modules/') && v.dev).map(([k, v]) => `${k}@${v.version}`).sort();
  h.update(dev.join('\n'));
  return h.digest('hex');
}

export function distStatus(root) {
  const infoFile = path.join(root, 'client', 'dist', 'build-info.json');
  if (!fs.existsSync(path.join(root, 'client', 'dist', 'index.html')) || !fs.existsSync(infoFile)) return { ok: false, reason: 'missing' };
  let info;
  try {
    info = JSON.parse(fs.readFileSync(infoFile, 'utf8'));
  } catch {
    return { ok: false, reason: 'broken' };
  }
  const current = uiSourceHash(root);
  return { ok: info.sourceHash === current, reason: info.sourceHash === current ? 'ok' : 'stale', current, built: info.sourceHash };
}
