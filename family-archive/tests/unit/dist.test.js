// Готовая сборка интерфейса (client/dist) хранится в репозитории, чтобы сервер с малой
// памятью не собирал её сам. Тест падает, если исходники изменены без пересборки.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { distStatus, TEXT_FILE_RE } from '../../scripts/lib/ui-hash.mjs';

test('client/dist соответствует исходникам интерфейса', () => {
  const st = distStatus(path.resolve(import.meta.dirname, '../..'));
  assert.ok(st.ok, `Сборка интерфейса устарела или отсутствует (${st.reason}). Выполните npm run build и добавьте client/dist в коммит.`);
});

test('все текстовые исходники интерфейса нормализуются по переводам строк (копия в Windows)', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = ['client/src', 'client/public', 'shared'].flatMap((d) => walk(path.join(root, d)));
  // Текстовый файл — без нулевых байтов; картинки (PNG, ICO, WebP) git не преобразует.
  const missed = files.filter((f) => !fs.readFileSync(f).includes(0) && !TEXT_FILE_RE.test(f)).map((f) => path.relative(root, f));
  assert.deepEqual(missed, [], 'добавьте расширение в TEXT_FILE_RE (scripts/lib/ui-hash.mjs)');
});
