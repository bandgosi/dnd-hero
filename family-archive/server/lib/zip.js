// Распаковка ZIP в память с подсчётом фактически распакованных байт
// (заявленным в архиве размерам не доверяем — защита от «zip-бомб»).
import fs from 'node:fs';
import path from 'node:path';
import { Unzip, UnzipInflate } from 'fflate';
import { unprocessable } from './util.js';

export class ZipLimitError extends Error {}

export function safeUnzipSync(buffer, { want = () => true, maxEntryBytes, maxTotalBytes, maxEntries = 5000 }) {
  const out = {};
  const names = [];
  let total = 0;
  let error = null;
  const uz = new Unzip((file) => {
    if (error) return;
    names.push(file.name);
    if (names.length > maxEntries) {
      error = new ZipLimitError('В файле слишком много внутренних элементов');
      return;
    }
    if (!want(file.name)) return;
    const chunks = [];
    let size = 0;
    file.ondata = (err, chunk, final) => {
      if (error) return;
      if (err) {
        error = err;
        return;
      }
      size += chunk.length;
      total += chunk.length;
      if (size > maxEntryBytes || total > maxTotalBytes) {
        error = new ZipLimitError('Файл содержит слишком большие внутренние элементы');
        return;
      }
      chunks.push(chunk);
      if (final) {
        const buf = new Uint8Array(size);
        let o = 0;
        for (const c of chunks) {
          buf.set(c, o);
          o += c.length;
        }
        out[file.name] = buf;
      }
    };
    file.start();
  });
  uz.register(UnzipInflate);
  const data = new Uint8Array(buffer);
  // Небольшими порциями: распакованный кусок одной порции ограничен (~16 МБ даже при максимальном сжатии).
  const STEP = 16 * 1024;
  for (let i = 0; i < data.length && !error; i += STEP) uz.push(data.subarray(i, i + STEP), i + STEP >= data.length);
  if (error) throw error;
  return { files: out, names };
}

// Потоковое чтение ZIP-файла с диска: нужные тексты — в память (с пределом), выбранные файлы —
// на диск (с пределами), остальное прокачивается вхолостую. Память не зависит от размера архива.
const ZIP_SLICE = 4 * 1024;

// stopAfter — имена файлов, после прочтения которых дальше архив не читается (они в начале копии).
export function readZipFile(file, { allowed = () => true, wantText = () => false, extractTo = null, accept = () => false, maxText = 32 * 1024 * 1024, maxTotal = Infinity, maxFile = Infinity, maxSkipped = Infinity, maxEntries = Infinity, stopAfter = null }) {
  return new Promise((resolve, reject) => {
    const texts = {};
    const seen = new Set();
    let stopped = false;
    const entries = [];
    let failed = null;
    let total = 0;
    let skipped = 0;
    const fail = (e) => {
      if (!failed) failed = e;
    };
    // Ненужные элементы прокачиваются вхолостую: иначе fflate копит их содержимое в памяти
    // (на случай позднего start()), и восстановление большой копии исчерпало бы ОЗУ.
    const skip = (stream) => {
      stream.ondata = (err, chunk) => {
        if (err) return fail(err);
        skipped += chunk.length;
        if (skipped > maxSkipped) fail(unprocessable('Архив слишком большой'));
      };
      stream.start();
    };
    const uz = new Unzip((stream) => {
      const name = stream.name;
      if (name.includes('..') || path.isAbsolute(name) || name.includes('\\') || name.includes('\0')) {
        fail(unprocessable('Архив содержит недопустимые пути'));
        return;
      }
      // Посторонние файлы и повторы одного имени (бывали в старых копиях) пропускаются.
      if (failed || name.endsWith('/') || !allowed(name) || seen.has(name)) return skip(stream);
      seen.add(name);
      if (entries.length >= maxEntries) {
        fail(unprocessable('В архиве слишком много файлов'));
        return skip(stream);
      }
      entries.push(name);
      if (wantText(name)) {
        const chunks = [];
        let size = 0;
        stream.ondata = (err, chunk, final) => {
          if (err) return fail(err);
          size += chunk.length;
          if (size > maxText) return fail(unprocessable('Файл данных в архиве слишком большой'));
          chunks.push(chunk);
          // Куски от fflate — новые массивы, копировать их не нужно; текст остаётся байтами.
          if (final) {
            texts[name] = Buffer.concat(chunks);
            if (stopAfter && stopAfter.every((n) => texts[n])) stopped = true;
          }
        };
        stream.start();
      } else if (extractTo && accept(name)) {
        const target = path.join(extractTo, name);
        if (!path.resolve(target).startsWith(path.resolve(extractTo) + path.sep)) return fail(unprocessable('Архив содержит недопустимые пути'));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const fd = fs.openSync(target, 'wx');
        let size = 0;
        let closed = false;
        stream.ondata = (err, chunk, final) => {
          if (err || failed) {
            if (!closed) {
              closed = true;
              fs.closeSync(fd);
            }
            if (err) fail(err);
            return;
          }
          size += chunk.length;
          total += chunk.length;
          if (size > maxFile || total > maxTotal) {
            closed = true;
            fs.closeSync(fd);
            return fail(unprocessable('Распакованные данные архива слишком большие или на диске недостаточно места'));
          }
          fs.writeSync(fd, chunk);
          if (final) {
            closed = true;
            fs.closeSync(fd);
          }
        };
        stream.start();
      } else skip(stream);
    });
    uz.register(UnzipInflate);
    const rs = fs.createReadStream(file, { highWaterMark: 1 << 20 });
    rs.on('data', (chunk) => {
      if (failed || stopped) {
        rs.destroy();
        return;
      }
      try {
        // Небольшими порциями: распакованный кусок одной порции не превышает ~4 МБ даже для «zip-бомбы».
        const data = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.length);
        for (let i = 0; i < data.length && !failed && !stopped; i += ZIP_SLICE) uz.push(data.subarray(i, i + ZIP_SLICE));
      } catch (e) {
        fail(e);
        rs.destroy();
      }
    });
    rs.on('error', reject);
    rs.on('close', () => {
      try {
        if (!failed && !stopped) uz.push(new Uint8Array(0), true);
      } catch (e) {
        fail(e);
      }
      if (failed) reject(failed instanceof Error && failed.status ? failed : unprocessable('Архив повреждён или не является резервной копией'));
      else resolve({ texts, entries });
    });
  });
}
