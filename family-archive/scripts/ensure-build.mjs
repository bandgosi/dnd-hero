// Собирает интерфейс перед запуском, если сборки нет или исходники новее.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`Нужен Node.js 22.13 или новее (установлен ${process.versions.node}). Скачайте LTS-версию с https://nodejs.org/`);
  process.exit(1);
}

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'client', 'dist', 'index.html');

function newest(dir) {
  let t = 0;
  if (!fs.existsSync(dir)) return t;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
  }
  return t;
}

const srcTime = Math.max(newest(path.join(root, 'client', 'src')), newest(path.join(root, 'shared')), newest(path.join(root, 'client', 'public')), fs.statSync(path.join(root, 'client', 'index.html')).mtimeMs);
const distTime = fs.existsSync(dist) ? fs.statSync(dist).mtimeMs : 0;
if (distTime >= srcTime) process.exit(0);

const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
if (!fs.existsSync(viteBin)) {
  console.error('Не найден сборщик интерфейса. Выполните сначала: npm install');
  process.exit(1);
}
console.log('Сборка интерфейса…');
const r = spawnSync(process.execPath, [viteBin, 'build', '--logLevel', 'warn'], { cwd: root, stdio: 'inherit' });
process.exit(r.status ?? 1);
