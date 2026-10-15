// Безопасность и экономия места: пароль, сеансы, адреса, файлы, резервные копии, место на диске.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { crc32 as zlibCrc } from 'node:zlib';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { startServer, photoForm, makePng, xlsxForm } from '../helpers/harness.js';
import { fixtureXlsx, buildXlsx } from '../helpers/fixture.js';
import { loadConfig, configProblems } from '../../server/config.js';
import { hashPassword, clientKey, netKey } from '../../server/auth.js';
import { stripImageMetadata } from '../../server/lib/imagemeta.js';
import { sniffImage } from '../../server/services/photos.js';
import { createBackup, listBackups, changedSinceLastBackup, removeStaleTemp } from '../../server/services/backup.js';

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

test('вход: одновременные попытки не обходят ограничение числа попыток', async () => {
  const s = await startServer({ env: { APP_PASSWORD_HASH: await hashPassword('верный-пароль-789') } });
  try {
    const burst = await Promise.all(Array.from({ length: 20 }, () => s.post('/api/auth/login', { password: 'неверный-пароль' })));
    const wrong = burst.filter((r) => r.status === 401).length;
    // Без предварительного учёта все 20 одновременных попыток проверили бы пароль.
    assert.ok(wrong >= 1 && wrong <= 10, `проверено из 20 одновременных: ${wrong}`);
    assert.equal(burst.filter((r) => r.status === 429).length, 20 - wrong);
    let total = wrong;
    for (let i = 0; i < 12; i++) if ((await s.post('/api/auth/login', { password: 'неверный-пароль' })).status === 401) total++;
    assert.equal(total, 10, 'не больше 10 неудачных проверок пароля с одного адреса');
    assert.equal((await s.post('/api/auth/login', { password: 'верный-пароль-789' })).status, 429);
  } finally {
    await s.close();
  }
});

// Дешёвый хэш (N=1024) — чтобы тест на много попыток шёл быстро.
function cheapHash(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 32, { N: 1024, r: 8, p: 1 });
  return `scrypt:1024:8:1:${salt.toString('base64url')}:${key.toString('base64url')}`;
}

test('вход: подбор с разных адресов включает строгий режим, но не запирает семью', async () => {
  const s = await startServer({ env: { APP_PASSWORD_HASH: cheapHash('семейный-пароль-1'), TRUST_PROXY: 'loopback', ALLOWED_HOSTS: 'archive.example.ru' } });
  const login = (ip, password, cookie = '') => fetch(`${s.url}/api/auth/login`, {
    method: 'POST',
    headers: { 'X-Requested-With': 'family-archive', 'Content-Type': 'application/json', 'X-Forwarded-For': ip, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ password }),
  });
  try {
    const first = await login('203.0.113.10', 'семейный-пароль-1');
    assert.equal(first.status, 200);
    const device = first.headers.getSetCookie().find((c) => c.startsWith('fa_device=')).split(';')[0];
    // 50 неудачных попыток с пяти адресов (по 10) — срабатывает общий предел.
    const attempts = ['198.51.100.1', '198.51.101.1', '198.51.102.1', '198.51.103.1', '198.51.104.1'].flatMap((ip) => Array(10).fill(ip));
    for (let i = 0; i < attempts.length; i += 4) {
      const r = await Promise.all(attempts.slice(i, i + 4).map((ip) => login(ip, 'неверный-пароль')));
      assert.ok(r.every((x) => x.status === 401));
    }
    // Строгий режим: с нового адреса — только 3 попытки (поддельная метка устройства не помогает)…
    for (let i = 0; i < 3; i++) assert.equal((await login('203.0.113.30', 'неверный-пароль')).status, 401);
    assert.equal((await login('203.0.113.30', 'семейный-пароль-1')).status, 429);
    assert.equal((await login('203.0.113.30', 'семейный-пароль-1', 'fa_device=1700000000000.' + 'A'.repeat(43))).status, 429, 'поддельная метка не помогает');
    // …знакомое устройство с того же адреса входит, и семья с нового устройства тоже может войти.
    assert.equal((await login('203.0.113.30', 'семейный-пароль-1', device)).status, 200, 'знакомое устройство входит');
    assert.equal((await login('203.0.113.40', 'семейный-пароль-1')).status, 200, 'полной блокировки нет');
    // Много адресов одной сети /24: не больше 30 неудач за 15 минут на всю сеть.
    let netRejected = 0;
    for (let i = 1; i <= 36; i += 4) {
      const r = await Promise.all([0, 1, 2, 3].map((k) => login(`192.0.2.${i + k}`, 'неверный-пароль')));
      netRejected += r.filter((x) => x.status === 429).length;
    }
    assert.ok(netRejected >= 4, `отклонено в сети: ${netRejected}`);
    // IPv6: адреса одной сети /64 считаются одним клиентом, сеть /48 — общий предел.
    assert.equal(clientKey('2001:db8:1:2::a'), clientKey('2001:db8:1:2:ffff::b'));
    assert.notEqual(clientKey('2001:db8:1:2::a'), clientKey('2001:db8:1:3::a'));
    assert.equal(netKey('2001:db8:1:2::a'), netKey('2001:db8:1:ffff::b'));
    assert.equal(netKey('192.0.2.7'), netKey('192.0.2.200'));
  } finally {
    await s.close();
  }
});

test('защита запросов: путь в любом регистре, прокси без пароля, TRUST_PROXY, копии без служебных данных', async () => {
  const s = await startServer({ env: { APP_PASSWORD_HASH: cheapHash('семейный-пароль-2') } });
  try {
    assert.equal((await s.post('/api/auth/login', { password: 'семейный-пароль-2' })).status, 200);
    const cookie = (await fetch(`${s.url}/api/auth/login`, { method: 'POST', headers: { 'X-Requested-With': 'family-archive', 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'семейный-пароль-2' }) })).headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    for (const p of ['/API/backups', '/Api/auth/logout-all']) {
      const r = await fetch(s.url + p, { method: 'POST', headers: { Cookie: cookie, Origin: 'https://evil.example' } });
      assert.equal(r.status, 403, p);
    }
    const r = await fetch(`${s.url}/API/backups`, { method: 'POST', headers: { Cookie: cookie, 'X-Requested-With': 'family-archive', Origin: 'https://evil.example' } });
    assert.equal(r.status, 403, 'чужой Origin');
    // Резервная копия не содержит служебной таблицы meta (отпечаток пароля), а секрет — вне базы.
    const b = await createBackup(s.db, loadConfig({ DATA_DIR: s.dir }));
    const zip = unzipSync(new Uint8Array(fs.readFileSync(path.join(s.dir, 'backups', b.name))));
    assert.equal(JSON.parse(strFromU8(zip['data.json'])).meta, undefined);
    assert.ok(!Object.keys(zip).some((n) => n.includes('auth.key')));
    assert.equal((fs.statSync(path.join(s.dir, 'auth.key')).mode & 0o777).toString(8), '600');
  } finally {
    await s.close();
  }
  const open = await startServer();
  try {
    assert.equal((await rawGet(open.url, '/api/health')).status, 200);
    assert.equal((await rawGet(open.url, '/api/health', { 'X-Forwarded-For': '203.0.113.5' })).status, 403, 'без пароля через прокси нельзя');
    assert.equal((await rawGet(open.url, '/', { Via: '1.1 tunnel' })).status, 403);
  } finally {
    await open.close();
  }
  assert.equal(loadConfig({ DATA_DIR: os.tmpdir(), TRUST_PROXY: '1' }).trustProxy, 1);
  assert.equal(loadConfig({ DATA_DIR: os.tmpdir(), TRUST_PROXY: 'loopback' }).trustProxy, 'loopback');
  assert.equal(loadConfig({ DATA_DIR: os.tmpdir(), TRUST_PROXY: 'false' }).trustProxy, '');
});

test('источники: ссылка только http(s)', async () => {
  const s = await startServer();
  try {
    const { persons } = await seed(s);
    const add = (url) => s.post(`/api/persons/${persons[0].id}/sources`, { title: 'Письмо', kind: 'document', url });
    assert.equal((await add('javascript:alert(1)')).status, 400);
    assert.equal((await add('data:text/html,<script>1</script>')).status, 400);
    assert.equal((await add('https://example.org/letter')).status, 201);
    assert.equal((await add('')).status, 201);
  } finally {
    await s.close();
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

test('восстановление: выбранная копия не удаляется очисткой, лишние файлы не распаковываются, подложные данные не роняют сервер', async () => {
  const s = await startServer({ env: { SAFETY_BACKUP_KEEP: '1' } });
  try {
    await seed(s);
    const config = loadConfig({ DATA_DIR: s.dir, SAFETY_BACKUP_KEEP: '1' });
    const old = await createBackup(s.db, config, { label: 'before-rollback' });
    // Устаревший предпросмотр: отказ без создания страховочной копии.
    const before = fs.readdirSync(path.join(s.dir, 'backups')).length;
    assert.equal((await s.post('/api/backups/restore', { token: 'нет-такого' })).status, 409);
    assert.equal(fs.readdirSync(path.join(s.dir, 'backups')).length, before);
    // Самая старая страховочная копия (хранится одна) восстанавливается, хотя новая страховочная её вытеснила бы.
    const pv = await s.post('/api/backups/restore-preview', { name: old.name });
    assert.equal(pv.status, 200, JSON.stringify(pv.data));
    const r = await s.post('/api/backups/restore', { token: pv.data.token });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    // Файлы, на которые не ссылаются данные, не распаковываются.
    const manifest = { format: 'family-archive-backup', formatVersion: 1, createdAt: new Date().toISOString() };
    const stray = '22222222-2222-4222-8222-222222222222';
    const real = unzipSync(new Uint8Array(fs.readFileSync(path.join(s.dir, 'backups', (await createBackup(s.db, config)).name))));
    for (let i = 0; i < 50; i++) real[`photos/${stray}/thumb-${1000000000 + i}.jpg`] = new Uint8Array(0);
    const zip = zipSync(real);
    const fd = new FormData();
    fd.append('file', new Blob([zip], { type: 'application/zip' }), 'copy.zip');
    const pv2 = await s.form('/api/backups/restore-preview', fd);
    assert.equal(pv2.status, 200, JSON.stringify(pv2.data));
    assert.equal((await s.post('/api/backups/restore', { token: pv2.data.token })).status, 200);
    assert.ok(!fs.existsSync(path.join(s.dir, 'photos', stray)), 'посторонние файлы не распакованы');
    assert.deepEqual(fs.readdirSync(s.dir).filter((f) => /^(restore|trash)-/.test(f)), []);
    // data.json из миллионов пустых объектов: отказ, сервер продолжает работать.
    const bomb = `{"persons":[${'{},'.repeat(3000000)}{}],"parent_child":[],"partnerships":[],"photos":[],"hypotheses":[]}`;
    const zb = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), 'data.json': strToU8(bomb) });
    const fd3 = new FormData();
    fd3.append('file', new Blob([zb], { type: 'application/zip' }), 'bomb.zip');
    const r3 = await s.form('/api/backups/restore-preview', fd3);
    assert.equal(r3.status, 422);
    assert.equal((await s.get('/api/health')).status, 200);
    // Отмена предпросмотра удаляет загруженный файл.
    const fd4 = new FormData();
    fd4.append('file', new Blob([zip], { type: 'application/zip' }), 'copy.zip');
    const pv4 = await s.form('/api/backups/restore-preview', fd4);
    assert.equal(fs.readdirSync(path.join(s.dir, 'tmp')).length, 1);
    await s.post('/api/backups/restore-discard', { token: pv4.data.token });
    assert.deepEqual(fs.readdirSync(path.join(s.dir, 'tmp')), []);
    // Одновременные копии создаются по очереди, без конфликтов.
    const both = await Promise.all([s.post('/api/backups'), s.post('/api/backups', { label: 'x' })]);
    assert.ok(both.every((x) => x.status === 201 || x.status === 200), JSON.stringify(both.map((x) => x.status)));
    assert.notEqual(both[0].data.name, both[1].data.name);
    // Загрузка без указания размера не принимается (место нельзя проверить заранее).
    const chunked = await fetch(`${s.url}/api/backups/restore-preview`, {
      method: 'POST',
      headers: { 'X-Requested-With': 'family-archive', 'Content-Type': 'application/octet-stream' },
      body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(10)); c.close(); } }),
      duplex: 'half',
    });
    assert.equal(chunked.status, 411);
  } finally {
    await s.close();
  }
});

test('копии: повторно импортированный файл, длинное имя; ориентация фото сохраняется без прочего EXIF', async () => {
  // EXIF с ориентацией 6 (портрет с телефона), маркой телефона и GPS — остаётся только ориентация.
  const tiff = Buffer.alloc(8 + 2 + 3 * 12 + 4 + 6);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(3, 8);
  const entry = (k, tag, type, count, value) => {
    const o = 10 + k * 12;
    tiff.writeUInt16LE(tag, o);
    tiff.writeUInt16LE(type, o + 2);
    tiff.writeUInt32LE(count, o + 4);
    tiff.writeUInt32LE(value, o + 8);
  };
  entry(0, 0x010f, 2, 6, 8 + 2 + 36 + 4); // Make → «Phone»
  entry(1, 0x0112, 3, 1, 6); // Orientation
  entry(2, 0x8825, 4, 1, 0); // GPS
  tiff.write('Phone\0', 8 + 2 + 36 + 4, 'latin1');
  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(app1.length + 2);
  const base = fakeJpeg();
  const jpg = Buffer.concat([base.subarray(0, 2), Buffer.from([0xff, 0xe1]), len, app1, base.subarray(2)]);
  const out = stripImageMetadata(jpg, 'image/jpeg');
  assert.ok(!out.includes(Buffer.from('Phone')), 'марка телефона удалена');
  const at = out.indexOf(Buffer.from('Exif\0\0', 'latin1'));
  assert.ok(at > 0, 'EXIF с ориентацией есть');
  assert.equal(out.readUInt16LE(at + 6 + 8 + 2 + 8), 6, 'ориентация 6');

  const s = await startServer();
  try {
    const x = fixtureXlsx();
    const first = await s.form('/api/imports/preview', xlsxForm(x));
    const imp = await s.post('/api/imports/commit', { previewId: first.data.previewId });
    assert.equal((await s.post(`/api/imports/${imp.data.importId}/rollback`, {})).status, 200);
    const again = await s.form('/api/imports/preview', xlsxForm(x));
    assert.equal((await s.post('/api/imports/commit', { previewId: again.data.previewId })).status, 200);
    await s.post('/api/persons', { person: { display_name: 'Я'.repeat(400) }, force: true });
    const bk = await s.post('/api/backups');
    const pv = await s.post('/api/backups/restore-preview', { name: bk.data.name });
    assert.equal(pv.status, 200, JSON.stringify(pv.data));
    const r = await s.post('/api/backups/restore', { token: pv.data.token });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok((await s.get('/api/data')).data.persons.some((p) => p.display_name.length === 400));
  } finally {
    await s.close();
  }
});

// PNG с дополнительным блоком, где встречаются сигнатуры ZIP (PK…): такие байты бывают и в обычных фото.
function pngWithZipSignatures(w = 8, h = 8) {
  const png = makePng(w, h, [120, 90, 60]);
  const body = Buffer.concat([Buffer.from('zzZz', 'latin1'), Buffer.from('PK\x07\x08PK\x01\x02PK\x03\x04PK\x05\x06', 'latin1')]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length - 4);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlibCrc(body));
  const iend = png.length - 12;
  return Buffer.concat([png.subarray(0, iend), len, body, crc, png.subarray(iend)]);
}

test('восстановление возвращает файлы байт в байт (Excel внутри копии, фото с сигнатурами PK)', async () => {
  const s = await startServer();
  try {
    const data = await seed(s);
    const png = pngWithZipSignatures();
    const fd = new FormData();
    for (const k of ['original', 'display', 'thumb']) fd.append(k, new Blob([png], { type: 'image/png' }), `${k}.png`);
    assert.equal((await s.form(`/api/persons/${data.persons[0].id}/photos`, fd)).status, 201);
    const hashes = () => {
      const out = {};
      for (const sub of ['photos', 'imports']) {
        for (const f of fs.readdirSync(path.join(s.dir, sub), { recursive: true })) {
          const p = path.join(s.dir, sub, f);
          if (fs.statSync(p).isFile()) out[`${sub}/${f}`] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
        }
      }
      return out;
    };
    const before = hashes();
    assert.ok(Object.keys(before).some((k) => k.startsWith('imports/')) && Object.keys(before).some((k) => k.startsWith('photos/')));
    const bk = await s.post('/api/backups');
    const pv = await s.post('/api/backups/restore-preview', { name: bk.data.name });
    assert.deepEqual(pv.data.missingPhotos, []);
    assert.equal((await s.post('/api/backups/restore', { token: pv.data.token })).status, 200);
    assert.deepEqual(hashes(), before);
    // Имя сохранённого файла Excel — его контрольная сумма: файл цел.
    for (const [k, h] of Object.entries(before)) if (k.startsWith('imports/')) assert.equal(`imports/${h}.xlsx`, k);
  } finally {
    await s.close();
  }
});

test('копии: нехватка места не уничтожает последние копии; остатки прерванных копий убираются', async () => {
  const s = await startServer();
  try {
    await seed(s);
    const config = loadConfig({ DATA_DIR: s.dir });
    await createBackup(s.db, config, { label: 'auto' });
    s.db.run("INSERT INTO meta (key, value) VALUES ('x', '1') ON CONFLICT(key) DO UPDATE SET value = '2'");
    await createBackup(s.db, config, { label: 'auto' });
    const autos = listBackups(config).filter((b) => b.kind === 'auto').map((b) => b.name);
    assert.equal(autos.length, 2);
    // Места не хватит даже после удаления всех автоматических копий — они остаются на месте.
    const tight = loadConfig({ DATA_DIR: s.dir, DISK_RESERVE_MB: String(1024 * 1024 * 1024) });
    await assert.rejects(createBackup(s.db, tight, { label: 'auto' }), (e) => e.status === 507);
    assert.deepEqual(listBackups(config).filter((b) => b.kind === 'auto').map((b) => b.name), autos);
    // Временные файлы: чужой живой процесс — не трогаем, умерший — удаляем.
    const dir = path.join(s.dir, 'backups');
    const dead = path.join(dir, 'family-archive-20200101-000000.zip.999999999.part');
    const alive = path.join(dir, `family-archive-20200101-000001.zip.${process.pid}.part`);
    const deadSnap = path.join(dir, 'family-archive-20200101-000000.zip.999999999.snap');
    fs.writeFileSync(dead, 'x');
    fs.writeFileSync(alive, 'x');
    fs.mkdirSync(deadSnap);
    removeStaleTemp(config);
    assert.ok(!fs.existsSync(dead) && !fs.existsSync(deadSnap) && fs.existsSync(alive));
    fs.rmSync(alive);
    assert.deepEqual(fs.readdirSync(dir).filter((f) => /\.(part|snap)$/.test(f)), [], 'после копий не остаётся временных файлов');
  } finally {
    await s.close();
  }
});

test('во время восстановления изменения отклоняются (запись в базу заблокирована)', async () => {
  const s = await startServer();
  try {
    s.db.writeBlock = () => Object.assign(new Error('Идёт восстановление из резервной копии'), { status: 409 });
    const r = await s.post('/api/persons', { person: { display_name: 'Петров' } });
    assert.equal(r.status, 409);
    s.db.writeBlock = null;
    assert.equal((await s.post('/api/persons', { person: { display_name: 'Петров' } })).status, 201);
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

// Подменяет XML первого листа в готовой книге.
function patchSheet(xlsx, patch) {
  const files = unzipSync(new Uint8Array(xlsx));
  files['xl/worksheets/sheet1.xml'] = strToU8(patch(strFromU8(files['xl/worksheets/sheet1.xml'])));
  return Buffer.from(zipSync(files));
}

test('импорт: гигантские диапазоны в крошечном файле не роняют сервер', async () => {
  const s = await startServer();
  try {
    const base = buildXlsx([{ name: 'Лист1', cells: { A1: { v: 'Кахе' }, B2: { v: 'Зураб' } } }]);
    const started = Date.now();
    // 500 описаний столбцов на весь лист — хранятся диапазонами, импорт проходит.
    const cols = patchSheet(base, (x) => x.replace(/<cols>.*<\/cols>/, `<cols>${'<col min="1" max="16384" width="9"/>'.repeat(500)}</cols>`));
    const ok = await s.form('/api/imports/preview', xlsxForm(cols));
    assert.equal(ok.status, 200);
    assert.equal(ok.data.records.length, 2);
    const cases = [
      [(x) => x.replace('</sheetData>', '</sheetData><mergeCells count="1"><mergeCell ref="A3:ZZZ1048576"/></mergeCells>'), /недопустимый объединённый диапазон/],
      [(x) => x.replace('</sheetData>', '</sheetData><mergeCells count="1"><mergeCell ref="C3:XFD1048576"/></mergeCells>'), /Объединённые диапазоны .* слишком большие/],
      [(x) => x.replace('<row r="1">', '<row r="0">'), /недопустимый адрес/],
      // Узлы, которые не являются элементами, тоже считаются: инструкции, CDATA, атрибуты.
      [(x) => x.replace('<sheetData>', `${'<?a?>'.repeat(200000)}<sheetData>`), /слишком большой или сложный/],
      [(x) => x.replace('<sheetData>', `<x>${'<![CDATA[]]>'.repeat(200000)}</x><sheetData>`), /слишком большой или сложный/],
      [(x) => x.replace('<sheetData>', `<x ${Array.from({ length: 250000 }, (_, i) => `a${i}="1"`).join(' ')}/><sheetData>`), /слишком большой или сложный/],
      [(x) => x.replace('<sheetData>', `<x${' y'.repeat(300000)}/><sheetData>`), /слишком большой или сложный/],
      // Кавычка внутри комментария или CDATA не прячет следующие узлы; атрибуты без пробелов тоже считаются.
      [(x) => x.replace('</sheetData>', `</sheetData><!--'-->${'<x><y/></x>'.repeat(100000)}<!--'-->`), /слишком большой или сложный/],
      [(x) => x.replace('</sheetData>', `</sheetData><t><![CDATA[']]></t>${'<x><y/></x>'.repeat(100000)}`), /слишком большой или сложный/],
      [(x) => x.replace('<sheetData>', `<x ${Array.from({ length: 250000 }, (_, i) => `a${i}=""`).join('')}/><sheetData>`), /слишком большой или сложный/],
      [(x) => x.replace('<sheetData>', `<x ${'a' + '=a'.repeat(1e6)}/><sheetData>`), /слишком большой или сложный/],
      // То, что не ловит быстрый подсчёт, останавливает предел памяти отдельного процесса разбора.
      [(x) => x.replace('<sheetData>', `<x${'\t'.repeat(7.6 * 1024 * 1024)}/><sheetData>`), /слишком большой или сложный/],
      [(x) => x.replace('<sheetData>', `<x ${Array.from({ length: 250000 }, (_, i) => `a${i}= ""`).join(' ')}/><sheetData>`), /слишком большой или сложный/],
    ];
    for (const [patch, error] of cases) {
      const r = await s.form('/api/imports/preview', xlsxForm(patchSheet(base, patch)));
      assert.equal(r.status, 422, String(error));
      assert.match(r.data.error, error);
    }
    // Запись в самом низу листа: схема показывается сжато, импорт проходит.
    const far = await s.form('/api/imports/preview', xlsxForm(patchSheet(base, (x) => x.replace('</sheetData>', '<row r="1048576"><c r="A1048576" t="inlineStr"><is><t>Зоя</t></is></c></row></sheetData>'))));
    assert.equal(far.status, 200);
    assert.equal(far.data.geometry['Лист1'].compact, true);
    assert.equal(far.data.records.length, 3);
    // Записи далеко друг от друга по вертикали — тоже сжатая схема (не 100 000 строк).
    const tall = await s.form('/api/imports/preview', xlsxForm(buildXlsx([{ name: 'Лист1', cells: { A1: { v: 'Кахе' }, A2: { v: 'Зураб' }, A100000: { v: 'Зоя' } } }])));
    assert.equal(tall.status, 200);
    assert.equal(tall.data.geometry['Лист1'].compact, true);
    assert.ok(tall.data.geometry['Лист1'].rows.length <= 6);
    // Длинный список и широкая строка имён — допустимы.
    const list = {};
    for (let i = 1; i <= 2100; i++) list[`A${i}`] = { v: `Петров ${i}` };
    assert.equal((await s.form('/api/imports/preview', xlsxForm(buildXlsx([{ name: 'Лист1', cells: list }])))).status, 200);
    // Сотни одинаковых имён: предположения ограничены, разбор быстрый.
    const same = {};
    for (let i = 1; i <= 400; i++) same[`A${i}`] = { v: 'Петров Пётр' };
    const t0 = Date.now();
    const sp = await s.form('/api/imports/preview', xlsxForm(buildXlsx([{ name: 'Лист1', cells: same }])));
    assert.equal(sp.status, 200);
    assert.ok(Date.now() - t0 < 8000, `одинаковые имена: ${Date.now() - t0} мс`);
    assert.ok(sp.data.checks.some((c) => c.code === 'same_cut'));
    // Очень длинная ячейка не импортируется, но называется в отдельном предупреждении.
    const longText = await s.form('/api/imports/preview', xlsxForm(buildXlsx([{ name: 'Лист1', cells: { A1: { v: 'Кахе' }, A2: { v: `Зураб ${'пометка '.repeat(800)}` } } }])));
    assert.equal(longText.data.records.length, 1);
    assert.match(longText.data.checks.find((c) => c.code === 'long_text').text, /Лист1!A2/);
    assert.ok(Date.now() - started < 30000, 'разбор быстрый');
    assert.equal((await s.get('/api/health')).status, 200, 'сервер жив');
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
    // Любые изменения при почти заполненном диске отклоняются понятным сообщением…
    const add = await tight.post('/api/persons', { person: { display_name: 'Проверка места' } });
    assert.equal(add.status, 507);
    assert.match(add.data.error, /Недостаточно места/);
    const ph = await tight.form('/api/persons/00000000-0000-4000-8000-000000000000/photos', photoForm());
    assert.equal(ph.status, 507);
    const bk = await tight.post('/api/backups');
    assert.equal(bk.status, 507);
    assert.match(bk.data.error, /Недостаточно места/);
    // …а удаление, отмена загрузок и выход на всех устройствах разрешены.
    assert.equal((await tight.post('/api/auth/logout-all')).status, 200);
    assert.equal((await tight.post('/api/backups/restore-discard', { token: 'x' })).status, 200);
    assert.equal((await tight.raw('DELETE', '/api/backups/family-archive-20200101-000000.zip')).status === 507, false);
  } finally {
    await tight.close();
  }
});

test('CSV, слияние, журнал: значения, похожие на формулы, экранируются; лишние данные не сохраняются', async () => {
  const s = await startServer();
  try {
    await s.post('/api/persons', { person: { display_name: '=HYPERLINK("http://example.com","x")' } });
    await s.post('/api/persons', { person: { display_name: 'Петров', birth_place: 'a,=1+1,b' } });
    const csv = await s.get('/api/export/persons.csv');
    assert.match(csv.data, /"'=HYPERLINK/);
    assert.match(csv.data, /"a,'=1\+1,b"/, 'формула после запятой тоже экранируется, значение в кавычках');
    // Выбор при слиянии сохраняется только из известных полей; предел журнала не бывает отрицательным.
    const a = (await s.post('/api/persons', { person: { display_name: 'Зоя' }, force: true })).data.person.id;
    const b = (await s.post('/api/persons', { person: { display_name: 'Зоя' }, force: true })).data.person.id;
    assert.equal((await s.post(`/api/persons/${a}/merge`, { otherId: b, choices: { display_name: 'secondary', junk: 'x'.repeat(10000) } })).status, 200);
    const merge = s.db.get("SELECT details FROM change_log WHERE action LIKE '%merge%' ORDER BY id DESC LIMIT 1");
    assert.ok(merge && !merge.details.includes('junk'));
    const total = s.db.get('SELECT COUNT(*) AS n FROM change_log').n;
    assert.equal((await s.get('/api/changes?limit=-1')).data.changes.length, Math.min(total, 100));
    assert.throws(() => s.db.update('persons', a, { 'display_name = 1, notes': 'x' }), /Недопустимое имя/);
  } finally {
    await s.close();
  }
});
