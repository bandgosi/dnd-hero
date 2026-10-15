// Готовая сборка интерфейса (client/dist) хранится в репозитории, чтобы сервер с малой
// памятью не собирал её сам. Тест падает, если исходники изменены без пересборки.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { distStatus } from '../../scripts/lib/ui-hash.mjs';

test('client/dist соответствует исходникам интерфейса', () => {
  const st = distStatus(path.resolve(import.meta.dirname, '../..'));
  assert.ok(st.ok, `Сборка интерфейса устарела или отсутствует (${st.reason}). Выполните npm run build и добавьте client/dist в коммит.`);
});
