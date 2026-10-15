// Чтение ZIP по центральному каталогу: большие архивы fflate, повреждения, недопустимые пути.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { readZipFile, safeUnzipSync } from '../../server/lib/zip.js';

const tmp = (name, data) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-zip-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, data);
  return file;
};

test('zip: больше 65535 файлов (fflate пишет число по модулю 65536) читаются все', async () => {
  const files = {};
  for (let i = 0; i < 65540; i++) files[`f/${i}`] = new Uint8Array([i & 255]);
  const zip = Buffer.from(zipSync(files, { level: 0 }));
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.equal(zip.readUInt16LE(eocd + 10), 65540 % 65536, 'в записи — остаток от деления');
  const { entries } = await readZipFile(tmp('big.zip', zip), { maxEntries: 100000 });
  assert.equal(entries.length, 65540);
  assert.equal(safeUnzipSync(zip, { want: () => false, maxEntryBytes: 1, maxTotalBytes: 1, maxEntries: 100000 }).names.length, 65540);
});

test('zip: подмена числа файлов, порча данных и недопустимые пути отклоняются', async () => {
  const zip = Buffer.from(zipSync({ 'a.txt': strToU8('привет'), 'b.txt': strToU8('мир') }, { level: 0 }));
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const wrongCount = Buffer.from(zip);
  wrongCount.writeUInt16LE(5, eocd + 10);
  await assert.rejects(readZipFile(tmp('count.zip', wrongCount), { wantText: () => true }), (e) => e.status === 422);
  // Испорченный байт данных — несовпадение контрольной суммы.
  const bad = Buffer.from(zip);
  bad[bad.indexOf(Buffer.from('мир')) + 1] ^= 0xff;
  await assert.rejects(readZipFile(tmp('crc.zip', bad), { wantText: () => true }), (e) => e.status === 422);
  assert.throws(() => safeUnzipSync(bad, { maxEntryBytes: 1e6, maxTotalBytes: 1e6 }), /контрольная сумма|Повреждённые/);
  // Выход за пределы папки.
  const evil = Buffer.from(zipSync({ '../x.txt': strToU8('x') }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-zip-out-'));
  await assert.rejects(readZipFile(tmp('evil.zip', evil), { extractTo: dir, accept: () => true }), /недопустимые пути/);
  assert.deepEqual(fs.readdirSync(dir), []);
  // Не ZIP вовсе.
  await assert.rejects(readZipFile(tmp('no.zip', Buffer.from('просто текст'))), (e) => e.status === 422);
  // Нормальное чтение.
  const ok = await readZipFile(tmp('ok.zip', zip), { wantText: () => true });
  assert.equal(ok.texts['b.txt'].toString(), 'мир');
});
