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
const { distStatus } = await import('./lib/ui-hash.mjs');
const st = distStatus(root);
if (st.ok) process.exit(0);

const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
if (!fs.existsSync(viteBin)) {
  console.error(st.reason === 'missing'
    ? 'Нет собранного интерфейса (client/dist). Выполните: npm install && npm run build'
    : 'Собранный интерфейс не соответствует исходникам, а сборщика нет. Выполните: npm install && npm run build');
  process.exit(1);
}
console.log('Сборка интерфейса…');
const r = spawnSync(process.execPath, [viteBin, 'build', '--logLevel', 'warn'], { cwd: root, stdio: 'inherit' });
process.exit(r.status ?? 1);
