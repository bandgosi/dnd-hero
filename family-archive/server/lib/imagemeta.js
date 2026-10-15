// Удаление метаданных из изображений без их декодирования: EXIF (в том числе
// координаты GPS), XMP, IPTC, комментарии. Сами пиксели не меняются.
// Битая структура файла — ошибка (такой файл не сохраняется).

export class ImageMetaError extends Error {}

function stripJpeg(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new ImageMetaError('Неверный JPEG');
  const parts = [buf.subarray(0, 2)];
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw new ImageMetaError('Повреждённая структура JPEG');
    let marker = buf[i + 1];
    while (marker === 0xff && i + 2 < buf.length) {
      i += 1;
      marker = buf[i + 1];
    }
    if (marker === undefined) throw new ImageMetaError('Повреждённая структура JPEG');
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (marker === 0xd9) {
      parts.push(buf.subarray(i, i + 2));
      break;
    }
    if (i + 4 > buf.length) throw new ImageMetaError('Повреждённая структура JPEG');
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) throw new ImageMetaError('Повреждённая структура JPEG');
    const seg = buf.subarray(i, i + 2 + len);
    if (marker === 0xda) {
      // Начало данных изображения: всё остальное копируется как есть.
      parts.push(buf.subarray(i));
      break;
    }
    const isApp = marker >= 0xe0 && marker <= 0xef;
    let keep = true;
    if (marker === 0xfe) keep = false; // комментарий
    if (isApp) {
      const id = seg.subarray(4, 18).toString('latin1');
      // Оставляем JFIF (APP0), цветовой профиль ICC (APP2) и Adobe (APP14, влияет на цвета).
      keep = marker === 0xe0 || (marker === 0xe2 && id.startsWith('ICC_PROFILE')) || (marker === 0xee && id.startsWith('Adobe'));
    }
    if (keep) parts.push(seg);
    i += 2 + len;
  }
  return Buffer.concat(parts);
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

function stripPng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new ImageMetaError('Неверный PNG');
  const parts = [PNG_SIG];
  let i = 8;
  let ended = false;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    const end = i + 12 + len;
    if (end > buf.length) throw new ImageMetaError('Повреждённая структура PNG');
    if (!PNG_DROP.has(type)) parts.push(buf.subarray(i, end));
    i = end;
    if (type === 'IEND') {
      ended = true;
      break;
    }
  }
  if (!ended) throw new ImageMetaError('Повреждённая структура PNG');
  return Buffer.concat(parts);
}

function stripWebp(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') throw new ImageMetaError('Неверный WebP');
  const parts = [];
  let i = 12;
  while (i + 8 <= buf.length) {
    const type = buf.toString('latin1', i, i + 4);
    const len = buf.readUInt32LE(i + 4);
    const end = i + 8 + len + (len % 2);
    if (i + 8 + len > buf.length) throw new ImageMetaError('Повреждённая структура WebP');
    if (type !== 'EXIF' && type !== 'XMP ') {
      const chunk = Buffer.from(buf.subarray(i, Math.min(end, buf.length)));
      if (type === 'VP8X' && chunk.length > 8) chunk[8] &= ~(0x08 | 0x04); // флаги EXIF и XMP
      parts.push(chunk);
    }
    i = end;
  }
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(body.length + 4, 4);
  head.write('WEBP', 8, 'ascii');
  return Buffer.concat([head, body]);
}

export function stripImageMetadata(buf, mime) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (mime === 'image/jpeg') return stripJpeg(b);
  if (mime === 'image/png') return stripPng(b);
  if (mime === 'image/webp') return stripWebp(b);
  return b;
}
