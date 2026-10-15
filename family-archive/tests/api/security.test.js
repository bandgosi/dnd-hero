// Безопасность и экономия места: пароль, сеансы, адреса, файлы, резервные копии, место на диске.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { zipSync, strToU8 } from 'fflate';
import { startServer, photoForm, makePng, xlsxForm } from '../helpers/harness.js';
import { fixtureXlsx, buildXlsx } from '../helpers/fixture.js';
import { loadConfig, configProblems } from '../../server/config.js';
import { hashPassword } from '../../server/auth.js';
import { stripImageMetadata } from '../../server/lib/imagemeta.js';
import { sniffImage } from '../../server/services/photos.js';
import { createBackup, listBackups, changedSinceLastBackup } from '../../server/services/backup.js';

const ROOT = path.resolve(import.meta.dirname, '../..');

// Минимальный JPEG со служебными сегментами: APP0, APP1 (EXIF с «GPS»), комментарий, SOF0, SOS.
function fakeJpeg(w = 4, h = 4) {
  const seg = (marker, body) => {
    const len = Buffer.alloc(2);
    len.writeUInt16BE(body.length + 2);
    return Buffer.concat([Buffer.from([0xff, marker]), len, body]);
  };
  const sof = Buffer.from([8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    seg(0xe1, Buffer.from('Exif\0\0GPSLatitude=55.75;GPSLongitude=37.61', 'latin1')),
    seg(0xfe, Buffer.from('секретный комментарий')),
    seg(0xc0, sof),
    seg(0xda, Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0])),
    Buffer.from([0x12, 0x34, 0x56, 0xff, 0x00, 0x78]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

async function seed(s) {
  const pv = await s.form('/api/imports/preview', xlsxForm(fixtureXlsx()));
  await s.post('/api/imports/commit', { previewId: pv.data.previewId });
  return (await s.get('/api/data')).data;
}

function rawGet(url, pathName, headers = {}) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path: pathName, method: 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('настройки: доступ из сети без пароля и без ALLOWED_HOSTS запрещён', async () => {
  const hash = await hashPassword('очень-длинный-пароль');
  const c = (env) => configProblems(loadConfig({ DATA_DIR: os.tmpdir(), ...env }));
  assert.equal(c({}).length, 0, 'локальный режим без пароля допустим');
  assert.ok(c({ HOST: '0.0.0.0' }).some((e) => /пароль не задан/.test(e)));
  assert.ok(c({ TRUST_PROXY: 'loopback', ALLOWED_HOSTS: 'archive.example.ru' }).some((e) => /пароль не задан/.test(e)), 'работа за прокси = доступ из сети');
  assert.ok(c({ HOST: '0.0.0.0', APP_PASSWORD: 'короткий' }).some((e) => /не короче 10/.test(e)));
  assert.ok(c({ HOST: '0.0.0.0', APP_PASSWORD_HASH: hash }).some((e) => /ALLOWED_HOSTS/.test(e)));
  assert.equal(c({ TRUST_PROXY: 'loopback', ALLOWED_HOSTS: 'archive.example.ru', APP_PASSWORD_HASH: hash, COOKIE_SECURE: '1' }).length, 0);
  assert.ok(c({ APP_PASSWORD_HASH: 'plain-text' }).some((e) => /неверный формат/.test(e)));
  // Сервер действительно отказывается запускаться.
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: ROOT, env: { ...process.env, HOST: '0.0.0.0', PORT: '0', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'fa-')), APP_PASSWORD: '', APP_PASSWORD_HASH: '' }, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Отказ запуска/);
});

test('вход по хэшу пароля; смена пароля и «завершить все сеансы» сбрасывают входы; чужой Host отклоняется', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-auth-'));
  const hashA = await hashPassword('первый-пароль-123');
  let s = await startServer({ dataDir: dir, env: { APP_PASSWORD_HASH: hashA } });
  try {
    assert.equal((await s.get('/api/data')).status, 401);
    assert.equal((await s.post('/api/auth/login', { password: 'неверный-пароль' })).status, 401);
    assert.equal((await s.post('/api/auth/login', { password: 'первый-пароль-123' })).status, 200);
    assert.equal((await s.get('/api/data')).status, 200);
    const cookie = (await s.raw('GET', '/api/auth/status')).headers.get('set-cookie');
    assert.equal(cookie, null, 'cookie не переустанавливается без входа');
    // Подмена Host (DNS rebinding) отклоняется.
    const bad = await rawGet(s.url, '/api/health', { Host: 'evil.example.com' });
    assert.equal(bad.status, 421);
    // Фото и данные без входа недоступны.
    assert.equal((await rawGet(s.url, '/api/data')).status, 401);
    // Смена пароля: тот же каталог, другой хэш — прежний вход недействителен.
    const db = s.db;
    const sessionsBefore = db.get('SELECT COUNT(*) AS n FROM sessions').n;
    assert.equal(sessionsBefore, 1);
    await s.close({ keep: true });
    s = await startServer({ dataDir: dir, env: { APP_PASSWORD_HASH: await hashPassword('второй-пароль-456') } });
    assert.equal(s.db.get('SELECT COUNT(*) AS n FROM sessions').n, 0);
    assert.equal((await s.post('/api/auth/login', { password: 'второй-пароль-456' })).status, 200);
    assert.equal((await s.post('/api/auth/logout-all')).status, 200);
    assert.equal((await s.get('/api/data')).status, 401);
  } finally {
    await s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('фото: метаданные (EXIF, GPS, комментарии) удаляются; неуменьшенное фото отклоняется', async () => {
  const jpg = fakeJpeg();
  const stripped = stripImageMetadata(jpg, 'image/jpeg');
  assert.ok(!stripped.includes(Buffer.from('GPSLatitude')));
  assert.ok(!stripped.includes(Buffer.from('секретный')));
  assert.ok(stripped.includes(Buffer.from('JFIF')));
  assert.deepEqual([sniffImage(stripped).width, sniffImage(stripped).height], [4, 4]);
  const s = await startServer();
  try {
    const data = await seed(s);
    const p = data.persons[0];
    const fd = new FormData();
    for (const k of ['original', 'display', 'thumb']) fd.append(k, new Blob([jpg], { type: 'image/jpeg' }), `${k}.jpg`);
    const up = await s.form(`/api/persons/${p.id}/photos`, fd);
    assert.equal(up.status, 201, JSON.stringify(up.data));
    const file = path.join(s.dir, 'photos', up.data.photo.id, up.data.photo.original_file);
    const saved = fs.readFileSync(file);
    assert.ok(!saved.includes(Buffer.from('GPSLatitude')), 'координаты съёмки не сохранены');
    // Слишком большое (не сжатое) фото — отказ.
    const big = await s.form(`/api/persons/${p.id}/photos`, photoForm(makePng(3000, 8)));
    assert.equal(big.status, 422);
    // Повреждённая структура — отказ.
    const broken = Buffer.concat([jpg.subarray(0, 30), Buffer.from([0xff, 0xe1, 0xff, 0xff])]);
    const fd2 = new FormData();
    for (const k of ['original', 'display', 'thumb']) fd2.append(k, new Blob([k === 'original' ? broken : jpg], { type: 'image/jpeg' }), `${k}.jpg`);
    assert.equal((await s.form(`/api/persons/${p.id}/photos`, fd2)).status, 422);
    // Попытка выйти за пределы папки фотографий.
    for (const evil of ['..%2F..%2Ffamily.db', '..%2Ffamily.db', '%2E%2E%2Ffamily.db', 'original.jpg%00.png']) {
      const r = await rawGet(s.url, `/media/photos/${up.data.photo.id}/${evil}`);
      assert.equal(r.status, 404, evil);
    }
    const ok = await s.raw('GET', `/media/photos/${up.data.photo.id}/${up.data.photo.thumb_file}`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'image/jpeg');
    assert.match(ok.headers.get('content-security-policy'), /sandbox/);
  } finally {
    await s.close();
  }
});

test('восстановление: подложные имена файлов и пути в копии отклоняются', async () => {
  const s = await startServer();
  try {
    await seed(s);
    const manifest = { format: 'family-archive-backup', formatVersion: 1, createdAt: new Date().toISOString() };
    const mk = (data, extra = {}) => {
      const zip = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), 'data.json': strToU8(JSON.stringify(data)), ...extra });
      const fd = new FormData();
      fd.append('file', new Blob([zip], { type: 'application/zip' }), 'copy.zip');
      return fd;
    };
    const person = { id: 'p1', display_name: 'Тест' };
    const base = { persons: [person], parent_child: [], partnerships: [], hypotheses: [], imports: [] };
    const evilPhoto = { ...base, photos: [{ id: '11111111-1111-4111-8111-111111111111', person_id: 'p1', original_file: '../../../../etc/passwd', display_file: 'display.jpg', thumb_file: 'thumb.jpg' }] };
    const r1 = await s.form('/api/backups/restore-preview', mk(evilPhoto));
    assert.equal(r1.status, 422);
    assert.match(r1.data.error, /недопустимые имена/);
    const evilImport = { ...base, photos: [], imports: [{ id: 'i1', stored_file: '../family.db' }] };
    assert.equal((await s.form('/api/backups/restore-preview', mk(evilImport))).status, 422);
    const evilEntry = await s.form('/api/backups/restore-preview', mk({ ...base, photos: [] }, { '../escape.txt': strToU8('x') }));
    assert.equal(evilEntry.status, 422);
    assert.ok(!fs.existsSync(path.join(s.dir, '..', 'escape.txt')));
    // Временные загрузки отклонённых копий удаляются.
    assert.deepEqual(fs.readdirSync(path.join(s.dir, 'tmp')), []);
  } finally {
    await s.close();
  }
});

test('импорт: «zip-бомба» в xlsx отклоняется, не распаковываясь целиком', async () => {
  const s = await startServer();
  try {
    const huge = 'А'.repeat(40 * 1024 * 1024);
    const xlsx = buildXlsx([{ name: 'Лист1', cells: { A1: { v: huge } } }]);
    assert.ok(xlsx.length < 2 * 1024 * 1024, 'файл маленький, но распаковывается в десятки МБ');
    const r = await s.form('/api/imports/preview', xlsxForm(xlsx));
    assert.equal(r.status, 422);
    assert.match(r.data.error, /слишком большие/);
  } finally {
    await s.close();
  }
});

test('резервные копии: хранение последних N, пропуск копий без изменений, удаление, проверка места', async () => {
  const s = await startServer({ env: { AUTO_BACKUP_KEEP: '2', SAFETY_BACKUP_KEEP: '1' } });
  try {
    await seed(s);
    for (let i = 0; i < 3; i++) await createBackup(s.db, s.config, { label: 'auto' });
    for (let i = 0; i < 2; i++) await createBackup(s.db, s.config, { label: 'before-restore' });
    const manual = await createBackup(s.db, s.config, {});
    const list = listBackups(s.config);
    assert.equal(list.filter((b) => b.kind === 'auto').length, 2);
    assert.equal(list.filter((b) => b.kind === 'safety').length, 1);
    assert.ok(list.some((b) => b.name === manual.name && b.kind === 'manual'));
    assert.equal(new Set(list.map((b) => b.name)).size, list.length, 'имена копий не совпадают');
    assert.equal(changedSinceLastBackup(s.db), false);
    const p = (await s.get('/api/data')).data.persons[0];
    await s.put(`/api/persons/${p.id}`, { person: { notes: 'изменение' } });
    assert.equal(changedSinceLastBackup(s.db), true);
    assert.equal((await s.del(`/api/backups/${manual.name}`)).status, 200);
    assert.equal((await s.del('/api/backups/..%2Ffamily.db')).status, 400);
    assert.ok(fs.existsSync(s.config.dbFile));
    const st = await s.get('/api/storage');
    assert.ok(st.data.free > 0 && st.data.backups > 0);
  } finally {
    await s.close();
  }
  const tight = await startServer({ env: { DISK_RESERVE_MB: String(1024 * 1024 * 1024) } });
  try {
    const imp = await tight.form('/api/imports/preview', xlsxForm(fixtureXlsx()));
    assert.equal((await tight.post('/api/imports/commit', { previewId: imp.data.previewId })).status, 507);
    const person = (await tight.post('/api/persons', { person: { display_name: 'Проверка места' } })).data.person;
    const ph = await tight.form(`/api/persons/${person.id}/photos`, photoForm());
    assert.equal(ph.status, 507);
    const bk = await tight.post('/api/backups');
    assert.equal(bk.status, 507);
    assert.match(bk.data.error, /Недостаточно места/);
  } finally {
    await tight.close();
  }
});

test('CSV: значения, похожие на формулы, экранируются', async () => {
  const s = await startServer();
  try {
    await s.post('/api/persons', { person: { display_name: '=HYPERLINK("http://example.com","x")' } });
    const csv = await s.get('/api/export/persons.csv');
    assert.match(csv.data, /"'=HYPERLINK/);
  } finally {
    await s.close();
  }
});
