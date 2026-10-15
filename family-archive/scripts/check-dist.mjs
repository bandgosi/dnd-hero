// Проверка, что готовая сборка интерфейса соответствует исходникам (используется установщиком).
import path from 'node:path';
import { distStatus } from './lib/ui-hash.mjs';

const st = distStatus(path.resolve(import.meta.dirname, '..'));
if (!st.ok) {
  console.error(st.reason === 'missing' ? 'Нет собранного интерфейса (client/dist).' : 'Собранный интерфейс не соответствует исходникам.');
  process.exit(1);
}
console.log('Готовая сборка интерфейса соответствует исходникам.');
