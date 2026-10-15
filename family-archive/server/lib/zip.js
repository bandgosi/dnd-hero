// Чтение ZIP по центральному каталогу: точные размеры и смещения каждого файла, проверка
// контрольной суммы CRC-32, распаковка встроенным zlib. Потоковый разбор «по сигнатурам» не
// годится: внутри данных (например, в .xlsx — он сам zip — или в пикселях фото) может встретиться
// сигнатура PK, и файл обрезается. Заявленным размерам при распаковке не доверяем — объём
// считается по факту (защита от «zip-бомб»).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { unprocessable } from './util.js';

export class ZipLimitError extends Error {}
export class ZipFormatError extends Error {}

const EOCD = 0x06054b50;
const EOCD64 = 0x06064b50;
const EOCD64_LOCATOR = 0x07064b50;
const CDH = 0x02014b50;
const LFH = 0x04034b50;
const MAX_CD_BYTES = 64 * 1024 * 1024;

const u64 = (b, o) => {
  const v = b.readBigUInt64LE(o);
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipFormatError('Слишком большое значение в ZIP64');
  return Number(v);
};

// Разбор центрального каталога. readAt(позиция, длина) возвращает Buffer.
function readCentralDirectory(readAt, size, { maxEntries = Infinity } = {}) {
  if (size < 22) throw new ZipFormatError('Это не ZIP-архив');
  const tailLen = Math.min(size, 65535 + 22);
  const tail = readAt(size - tailLen, tailLen);
  let at = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD && i + 22 + tail.readUInt16LE(i + 20) <= tail.length) {
      at = i;
      break;
    }
  }
  if (at < 0) throw new ZipFormatError('Это не ZIP-архив');
  const eocdPos = size - tailLen + at;
  let count = tail.readUInt16LE(at + 10);
  let cdSize = tail.readUInt32LE(at + 12);
  let cdOffset = tail.readUInt32LE(at + 16);
  let cdEnd = eocdPos;
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    if (eocdPos < 20) throw new ZipFormatError('Повреждённый ZIP64');
    const loc = readAt(eocdPos - 20, 20);
    if (loc.readUInt32LE(0) !== EOCD64_LOCATOR) throw new ZipFormatError('Повреждённый ZIP64');
    const recPos = u64(loc, 8);
    if (recPos + 56 > eocdPos - 20) throw new ZipFormatError('Повреждённый ZIP64');
    const rec = readAt(recPos, 56);
    if (rec.readUInt32LE(0) !== EOCD64) throw new ZipFormatError('Повреждённый ZIP64');
    count = u64(rec, 32);
    cdSize = u64(rec, 40);
    cdOffset = u64(rec, 48);
    cdEnd = recPos;
  }
  if (count > maxEntries) throw new ZipLimitError('В архиве слишком много файлов');
  if (cdSize > MAX_CD_BYTES || cdOffset + cdSize > cdEnd) throw new ZipFormatError('Повреждённый каталог ZIP');
  const cd = readAt(cdOffset, cdSize);
  const entries = [];
  let p = 0;
  for (let k = 0; k < count; k++) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== CDH) throw new ZipFormatError('Повреждённый каталог ZIP');
    const flags = cd.readUInt16LE(p + 8);
    const method = cd.readUInt16LE(p + 10);
    const crc = cd.readUInt32LE(p + 16);
    let csize = cd.readUInt32LE(p + 20);
    let usize = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    let offset = cd.readUInt32LE(p + 42);
    const end = p + 46 + nameLen + extraLen + commentLen;
    if (end > cd.length) throw new ZipFormatError('Повреждённый каталог ZIP');
    const rawName = cd.subarray(p + 46, p + 46 + nameLen);
    const name = rawName.toString(flags & 0x800 ? 'utf8' : 'latin1');
    // ZIP64: настоящие размеры и смещение — в дополнительном поле 0x0001.
    if (usize === 0xffffffff || csize === 0xffffffff || offset === 0xffffffff) {
      let x = p + 46 + nameLen;
      const xEnd = x + extraLen;
      let found = false;
      while (x + 4 <= xEnd) {
        const id = cd.readUInt16LE(x);
        const len = cd.readUInt16LE(x + 2);
        if (x + 4 + len > xEnd) break;
        if (id === 0x0001) {
          let q = x + 4;
          const take = () => {
            if (q + 8 > x + 4 + len) throw new ZipFormatError('Повреждённый ZIP64');
            const v = u64(cd, q);
            q += 8;
            return v;
          };
          if (usize === 0xffffffff) usize = take();
          if (csize === 0xffffffff) csize = take();
          if (offset === 0xffffffff) offset = take();
          found = true;
          break;
        }
        x += 4 + len;
      }
      if (!found) throw new ZipFormatError('Повреждённый ZIP64');
    }
    entries.push({ name, flags, method, crc, csize, usize, offset });
    p = end;
  }
  return { entries, cdOffset };
}

// Начало данных файла: после локального заголовка (его длины полей могут отличаться от каталога).
function dataStart(readAt, e, cdOffset) {
  if (e.offset + 30 > cdOffset) throw new ZipFormatError('Повреждённый ZIP');
  const h = readAt(e.offset, 30);
  if (h.readUInt32LE(0) !== LFH) throw new ZipFormatError('Повреждённый ZIP');
  const start = e.offset + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
  if (start + e.csize > cdOffset) throw new ZipFormatError('Повреждённый ZIP');
  if (e.flags & 0x1) throw new ZipFormatError('Зашифрованные архивы не поддерживаются');
  if (e.method !== 0 && e.method !== 8) throw new ZipFormatError('Неподдерживаемый способ сжатия');
  if (e.method === 0 && e.csize !== e.usize) throw new ZipFormatError('Повреждённый ZIP');
  return start;
}

const unsafeName = (name) => name.includes('..') || path.isAbsolute(name) || name.includes('\\') || name.includes('\0');

// Книга Excel и другие небольшие архивы в памяти (буфер уже ограничен по размеру).
export function safeUnzipSync(buffer, { want = () => true, maxEntryBytes, maxTotalBytes, maxEntries = 5000 }) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const readAt = (pos, len) => {
    if (pos < 0 || pos + len > buf.length) throw new ZipFormatError('Повреждённый ZIP');
    return buf.subarray(pos, pos + len);
  };
  const { entries, cdOffset } = readCentralDirectory(readAt, buf.length, { maxEntries });
  const files = {};
  const names = entries.map((e) => e.name);
  let total = 0;
  for (const e of entries) {
    if (!want(e.name) || files[e.name]) continue;
    const start = dataStart(readAt, e, cdOffset);
    const raw = buf.subarray(start, start + e.csize);
    const room = Math.min(maxEntryBytes, maxTotalBytes - total);
    let out;
    if (e.method === 0) {
      if (raw.length > room) throw new ZipLimitError('Файл содержит слишком большие внутренние элементы');
      out = Buffer.from(raw);
    } else {
      try {
        out = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, room) });
      } catch (err) {
        if (err?.code === 'ERR_BUFFER_TOO_LARGE' || err instanceof RangeError) throw new ZipLimitError('Файл содержит слишком большие внутренние элементы');
        throw new ZipFormatError('Повреждённые данные в архиве');
      }
    }
    if ((zlib.crc32(out) >>> 0) !== e.crc) throw new ZipFormatError('Повреждённые данные в архиве (контрольная сумма)');
    total += out.length;
    files[e.name] = new Uint8Array(out.buffer, out.byteOffset, out.length);
  }
  return { files, names };
}

// Поток данных одного файла архива с подсчётом объёма и проверкой CRC.
async function streamEntry(file, start, e, onChunk) {
  let crc = 0;
  let size = 0;
  if (e.csize > 0) {
    const src = fs.createReadStream(file, { start, end: start + e.csize - 1, highWaterMark: 256 * 1024 });
    const stages = e.method === 8 ? [src, zlib.createInflateRaw()] : [src];
    // pipeline заменяет ошибку из приёмника на AbortError — исходная сохраняется здесь.
    let own = null;
    try {
      await pipeline(...stages, async (source) => {
        for await (const chunk of source) {
          size += chunk.length;
          crc = zlib.crc32(chunk, crc);
          try {
            onChunk(chunk, size);
          } catch (err) {
            own = err;
            throw err;
          }
        }
      });
    } catch (err) {
      throw own || err;
    }
  } else if (e.method === 8) {
    throw new ZipFormatError('Повреждённые данные в архиве');
  }
  if ((crc >>> 0) !== e.crc || size !== e.usize) throw new ZipFormatError('Повреждённые данные в архиве (контрольная сумма)');
}

// Резервная копия с диска: нужные тексты — в память (с пределом), выбранные файлы — на диск
// (с пределами), остальные даже не читаются. Память не зависит от размера архива.
// allowed — какие имена учитываются (остальные пропускаются), entries — список учтённых имён.
export async function readZipFile(file, { allowed = () => true, wantText = () => false, extractTo = null, accept = () => false, maxText = 32 * 1024 * 1024, maxTotal = Infinity, maxFile = Infinity, maxEntries = Infinity } = {}) {
  const fd = fs.openSync(file, 'r');
  let parsed;
  try {
    const size = fs.fstatSync(fd).size;
    const readAt = (pos, len) => {
      if (pos < 0 || pos + len > size) throw new ZipFormatError('Повреждённый ZIP');
      const b = Buffer.alloc(len);
      let got = 0;
      while (got < len) {
        const n = fs.readSync(fd, b, got, len - got, pos + got);
        if (!n) throw new ZipFormatError('Повреждённый ZIP');
        got += n;
      }
      return b;
    };
    parsed = readCentralDirectory(readAt, size, { maxEntries });
    for (const e of parsed.entries) if (!unsafeName(e.name) && allowed(e.name)) e.start = dataStart(readAt, e, parsed.cdOffset);
  } catch (err) {
    fs.closeSync(fd);
    if (err instanceof ZipLimitError) throw unprocessable(err.message);
    if (err instanceof ZipFormatError) throw unprocessable('Архив повреждён или не является резервной копией');
    throw err;
  }
  fs.closeSync(fd);

  const texts = {};
  const entries = [];
  const seen = new Set();
  let total = 0;
  try {
    for (const e of parsed.entries) {
      if (unsafeName(e.name)) throw unprocessable('Архив содержит недопустимые пути');
      // Посторонние файлы, папки и повторы одного имени (бывали в старых копиях) пропускаются.
      if (e.name.endsWith('/') || !allowed(e.name) || seen.has(e.name)) continue;
      seen.add(e.name);
      entries.push(e.name);
      if (wantText(e.name)) {
        const chunks = [];
        await streamEntry(file, e.start, e, (chunk, size) => {
          if (size > maxText) throw unprocessable('Файл данных в архиве слишком большой');
          chunks.push(chunk);
        });
        texts[e.name] = Buffer.concat(chunks);
      } else if (extractTo && accept(e.name)) {
        const target = path.join(extractTo, e.name);
        if (!path.resolve(target).startsWith(path.resolve(extractTo) + path.sep)) throw unprocessable('Архив содержит недопустимые пути');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const out = fs.openSync(target, 'wx');
        try {
          await streamEntry(file, e.start, e, (chunk, size) => {
            total += chunk.length;
            if (size > maxFile || total > maxTotal) throw unprocessable('Распакованные данные архива слишком большие или на диске недостаточно места');
            fs.writeSync(out, chunk);
          });
        } finally {
          fs.closeSync(out);
        }
      }
    }
  } catch (err) {
    if (err?.status) throw err;
    throw unprocessable('Архив повреждён или не является резервной копией');
  }
  return { texts, entries };
}
