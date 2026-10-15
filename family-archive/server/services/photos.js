// Фотографии: проверка формата и размера, хранение файлами в data/photos/<id>/.
import fs from 'node:fs';
import path from 'node:path';
import { newId, nowIso, sha256, badRequest, notFound, unprocessable, cleanText } from '../lib/util.js';
import { logChange } from './history.js';

// Определение формата по сигнатуре и чтение размеров из заголовка — без внешних библиотек.
export function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mime: 'image/jpeg', ext: 'jpg', height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    return { mime: 'image/jpeg', ext: 'jpg', width: null, height: null };
  }
  if (b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ext: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8 ' && b.length >= 30) return { mime: 'image/webp', ext: 'webp', width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L' && b.length >= 25) {
      const bits = b.readUInt32LE(21);
      return { mime: 'image/webp', ext: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X' && b.length >= 30) return { mime: 'image/webp', ext: 'webp', width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
    return { mime: 'image/webp', ext: 'webp', width: null, height: null };
  }
  const head = b.toString('ascii', 0, 6);
  if (head === 'GIF87a' || head === 'GIF89a') return { mime: 'image/gif', ext: 'gif', width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  if (b.toString('ascii', 4, 8) === 'ftyp' && /^(heic|heix|hevc|mif1|msf1|heim|heis|avif)/.test(b.toString('ascii', 8, 12))) {
    return { mime: 'image/heic', ext: 'heic', unsupported: true };
  }
  return null;
}

function checkImage(buf, { label, maxBytes, allowed, maxSide = 20000 }) {
  if (!buf || !buf.length) throw badRequest(`${label}: файл пустой`);
  if (buf.length > maxBytes) throw unprocessable(`${label}: файл больше ${Math.round(maxBytes / 1024 / 1024)} МБ`);
  const info = sniffImage(buf);
  if (!info) throw unprocessable(`${label}: формат не распознан. Поддерживаются JPEG, PNG, WebP и GIF.`);
  if (info.unsupported) throw unprocessable(`${label}: формат HEIC/AVIF не поддерживается браузером для обработки. Сохраните фото как JPEG.`);
  if (!allowed.includes(info.mime)) throw unprocessable(`${label}: недопустимый формат ${info.mime}`);
  if (!info.width || !info.height) throw unprocessable(`${label}: не удалось определить размеры изображения — файл повреждён?`);
  if (info.width > maxSide || info.height > maxSide) throw unprocessable(`${label}: слишком большое разрешение (${info.width}×${info.height})`);
  return info;
}

function writeAtomic(file, buf) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
}

export function photoDir(config, id) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw badRequest('Неверный идентификатор фото');
  return path.join(config.photosDir, id);
}

export function removePhotoDirs(config, ids) {
  for (const id of ids) {
    try {
      fs.rmSync(photoDir(config, id), { recursive: true, force: true });
    } catch {
      /* каталог уже удалён */
    }
  }
}

function parseCrop(v) {
  if (!v) return null;
  try {
    const c = typeof v === 'string' ? JSON.parse(v) : v;
    const out = {};
    for (const k of ['x', 'y', 'w', 'h']) {
      const n = Number(c[k]);
      if (!Number.isFinite(n) || n < 0) return null;
      out[k] = Math.round(n);
    }
    return out;
  } catch {
    return null;
  }
}

// files: { original, display, thumb } — Buffer'ы; display/thumb подготовлены в браузере (кадрирование).
export function addPhoto(db, config, personId, { files, originalName, crop, caption, replacePhotoId = null }) {
  const person = db.get('SELECT * FROM persons WHERE id = ?', personId);
  if (!person) throw notFound('Человек не найден');
  const orig = checkImage(files.original, { label: 'Исходное фото', maxBytes: config.maxPhotoBytes, allowed: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] });
  const disp = checkImage(files.display, { label: 'Кадрированное фото', maxBytes: 10 * 1024 * 1024, allowed: ['image/jpeg', 'image/webp', 'image/png'], maxSide: 4096 });
  const thumb = checkImage(files.thumb, { label: 'Миниатюра', maxBytes: 2 * 1024 * 1024, allowed: ['image/jpeg', 'image/webp', 'image/png'], maxSide: 1024 });
  const id = newId();
  const dir = photoDir(config, id);
  fs.mkdirSync(dir, { recursive: true });
  const names = { original: `original.${orig.ext}`, display: `display.${disp.ext}`, thumb: `thumb.${thumb.ext}` };
  try {
    writeAtomic(path.join(dir, names.original), files.original);
    writeAtomic(path.join(dir, names.display), files.display);
    writeAtomic(path.join(dir, names.thumb), files.thumb);
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error(`Не удалось сохранить файлы фотографии: ${e.message}`);
  }
  const now = nowIso();
  let removedIds = [];
  try {
    db.tx(() => {
      db.insert('photos', {
        id,
        person_id: personId,
        original_file: names.original,
        original_name: cleanText(originalName, { max: 255 }),
        original_mime: orig.mime,
        original_size: files.original.length,
        original_width: orig.width,
        original_height: orig.height,
        display_file: names.display,
        display_width: disp.width,
        display_height: disp.height,
        thumb_file: names.thumb,
        crop: parseCrop(crop) ? JSON.stringify(parseCrop(crop)) : null,
        caption: cleanText(caption, { max: 1000 }),
        sha256: sha256(files.original),
        created_at: now,
        updated_at: now,
      });
      if (replacePhotoId) {
        const old = db.get('SELECT * FROM photos WHERE id = ? AND person_id = ?', replacePhotoId, personId);
        if (old) {
          db.run('DELETE FROM photos WHERE id = ?', old.id);
          removedIds.push(old.id);
        }
      }
      if (!person.primary_photo_id || replacePhotoId === person.primary_photo_id || removedIds.includes(person.primary_photo_id)) {
        db.run('UPDATE persons SET primary_photo_id = ?, updated_at = ?, last_manual_edit_at = ? WHERE id = ?', id, now, now, personId);
      } else {
        db.run('UPDATE persons SET updated_at = ?, last_manual_edit_at = ? WHERE id = ?', now, now, personId);
      }
      logChange(db, {
        action: replacePhotoId ? 'photo.replace' : 'photo.add',
        entityType: 'photo',
        entityId: id,
        summary: replacePhotoId ? 'Фотография заменена' : 'Добавлена фотография',
        details: { originalName, size: files.original.length, width: orig.width, height: orig.height, replaced: removedIds },
        personIds: [personId],
      });
    });
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  removePhotoDirs(config, removedIds);
  return db.get('SELECT * FROM photos WHERE id = ?', id);
}

// Повторное кадрирование и подпись.
export function updatePhoto(db, config, photoId, { files = {}, crop, caption }) {
  const ph = db.get('SELECT * FROM photos WHERE id = ?', photoId);
  if (!ph) throw notFound('Фотография не найдена');
  const dir = photoDir(config, photoId);
  const fields = { updated_at: nowIso() };
  if (files.display || files.thumb) {
    if (!files.display || !files.thumb) throw badRequest('Нужны и кадрированное фото, и миниатюра');
    const disp = checkImage(files.display, { label: 'Кадрированное фото', maxBytes: 10 * 1024 * 1024, allowed: ['image/jpeg', 'image/webp', 'image/png'], maxSide: 4096 });
    const thumb = checkImage(files.thumb, { label: 'Миниатюра', maxBytes: 2 * 1024 * 1024, allowed: ['image/jpeg', 'image/webp', 'image/png'], maxSide: 1024 });
    const dn = `display-${Date.now()}.${disp.ext}`;
    const tn = `thumb-${Date.now()}.${thumb.ext}`;
    writeAtomic(path.join(dir, dn), files.display);
    writeAtomic(path.join(dir, tn), files.thumb);
    fields.display_file = dn;
    fields.display_width = disp.width;
    fields.display_height = disp.height;
    fields.thumb_file = tn;
    const c = parseCrop(crop);
    fields.crop = c ? JSON.stringify(c) : null;
  }
  if (caption !== undefined) fields.caption = cleanText(caption, { max: 1000 });
  db.tx(() => {
    db.update('photos', photoId, fields);
    db.run('UPDATE persons SET updated_at = ?, last_manual_edit_at = ? WHERE id = ?', fields.updated_at, fields.updated_at, ph.person_id);
    logChange(db, { action: 'photo.update', entityType: 'photo', entityId: photoId, summary: fields.display_file ? 'Фотография перекадрирована' : 'Изменена подпись к фотографии', personIds: [ph.person_id] });
  });
  for (const old of [fields.display_file && ph.display_file, fields.thumb_file && ph.thumb_file].filter(Boolean)) {
    fs.rmSync(path.join(dir, old), { force: true });
  }
  return db.get('SELECT * FROM photos WHERE id = ?', photoId);
}

export function deletePhoto(db, config, photoId) {
  const ph = db.get('SELECT * FROM photos WHERE id = ?', photoId);
  if (!ph) throw notFound('Фотография не найдена');
  db.tx(() => {
    db.run('DELETE FROM photos WHERE id = ?', photoId);
    const person = db.get('SELECT * FROM persons WHERE id = ?', ph.person_id);
    const now = nowIso();
    if (person.primary_photo_id === photoId) {
      const next = db.get('SELECT id FROM photos WHERE person_id = ? ORDER BY created_at DESC LIMIT 1', ph.person_id);
      db.run('UPDATE persons SET primary_photo_id = ?, updated_at = ?, last_manual_edit_at = ? WHERE id = ?', next?.id || null, now, now, ph.person_id);
    }
    logChange(db, { action: 'photo.delete', entityType: 'photo', entityId: photoId, summary: 'Фотография удалена', details: { originalName: ph.original_name }, personIds: [ph.person_id] });
  });
  removePhotoDirs(config, [photoId]);
}

export function setPrimaryPhoto(db, personId, photoId) {
  const ph = db.get('SELECT * FROM photos WHERE id = ? AND person_id = ?', photoId, personId);
  if (!ph) throw notFound('Фотография не найдена');
  const now = nowIso();
  db.tx(() => {
    db.run('UPDATE persons SET primary_photo_id = ?, updated_at = ?, last_manual_edit_at = ? WHERE id = ?', photoId, now, now, personId);
    logChange(db, { action: 'photo.primary', entityType: 'photo', entityId: photoId, summary: 'Выбрана основная фотография', personIds: [personId] });
  });
}
