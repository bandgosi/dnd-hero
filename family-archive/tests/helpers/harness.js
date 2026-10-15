// Запуск приложения во временном каталоге данных — для тестов и проверки файла.
// Реальные данные (каталог data/) не затрагиваются.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { loadConfig } from '../../server/config.js';
import { openDb } from '../../server/db.js';
import { createApp } from '../../server/app.js';

export async function startServer({ dataDir, env = {} } = {}) {
  const dir = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'family-archive-test-'));
  const config = loadConfig({ DATA_DIR: dir, PORT: '0', HOST: '127.0.0.1', AUTO_BACKUP_DAYS: '0', ...env });
  fs.mkdirSync(config.dataDir, { recursive: true });
  const db = openDb(config.dbFile);
  const app = createApp({ db, config });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, p, body, { form = false, headers = {}, raw = false } = {}) => {
    const h = { 'X-Requested-With': 'family-archive', ...headers };
    if (cookie) h.Cookie = cookie;
    let payload;
    if (body !== undefined) {
      if (form) payload = body;
      else {
        h['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }
    }
    const res = await fetch(url + p, { method, headers: h, body: payload });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    if (raw) return res;
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data };
  };
  return {
    url,
    dir,
    config,
    db,
    get: (p, o) => call('GET', p, undefined, o),
    post: (p, b, o) => call('POST', p, b ?? {}, o),
    put: (p, b, o) => call('PUT', p, b ?? {}, o),
    del: (p, o) => call('DELETE', p, undefined, o),
    form: (p, fd, method = 'POST') => call(method, p, fd, { form: true }),
    raw: (method, p, o) => call(method, p, undefined, { ...o, raw: true }),
    async close({ keep = false } = {}) {
      await new Promise((r) => server.close(r));
      db.close();
      if (!keep && !dataDir) fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// Небольшой корректный PNG (заданного размера, один цвет) — для проверки фотографий.
export function makePng(w = 4, h = 4, rgb = [33, 78, 66]) {
  const crc = (buf) => zlib.crc32(buf);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td) >>> 0);
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < h; y++) {
    rows.push(Buffer.from([0]));
    for (let x = 0; x < w; x++) rows.push(Buffer.from(rgb));
  }
  const idat = zlib.deflateSync(Buffer.concat(rows));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

export function photoForm(png = makePng(), name = 'фото.png') {
  const fd = new FormData();
  fd.append('original', new Blob([png], { type: 'image/png' }), name);
  fd.append('display', new Blob([png], { type: 'image/png' }), 'display.png');
  fd.append('thumb', new Blob([png], { type: 'image/png' }), 'thumb.png');
  fd.append('crop', JSON.stringify({ x: 0, y: 0, w: 4, h: 4 }));
  return fd;
}

export function xlsxForm(buffer, name = 'Семейное древо .xlsx') {
  const fd = new FormData();
  fd.append('file', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
  return fd;
}
