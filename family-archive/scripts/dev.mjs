// Режим разработки: сервер API (с перезапуском) и Vite с горячей перезагрузкой.
import { spawn } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const procs = [
  spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--watch-path=server', '--watch-path=shared', 'server/index.js'], { cwd: root, stdio: 'inherit' }),
  spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')], { cwd: root, stdio: 'inherit' }),
];
const stop = () => {
  for (const p of procs) p.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
console.log('Интерфейс разработки: http://localhost:5173 (API на порту из PORT, по умолчанию 3000)');
