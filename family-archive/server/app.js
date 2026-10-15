// HTTP-приложение: API, фотографии и собранный интерфейс.
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { ApiError, asyncHandler, badRequest, notFound, parseJson, cleanText, oneOf, nowIso, newId } from './lib/util.js';
import { createAuth } from './auth.js';
import * as persons from './services/persons.js';
import * as relations from './services/relations.js';
import * as hyps from './services/hypotheses.js';
import * as photos from './services/photos.js';
import * as imports from './services/imports.js';
import * as backup from './services/backup.js';
import { personsCsv, relationsCsv } from './services/exportCsv.js';
import { personHistory, recentChanges, logChange } from './services/history.js';
import { storageUsage, ensureSpace } from './services/storage.js';
import { isPhotoFile, isImportFile, MIME_BY_EXT } from './lib/safety.js';

// Имя загруженного файла: busboy может отдать UTF-8 как latin1.
function uploadName(name, fallback) {
  if (!name) return fallback;
  if (/[^\u0000-\u00ff]/.test(name)) return name;
  const utf = Buffer.from(name, 'latin1').toString('utf8');
  return utf.includes('\ufffd') ? name : utf;
}

export function createApp({ db, config }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  const auth = createAuth(db, config);

  for (const d of [config.photosDir, config.importsDir, config.backupsDir, config.tmpDir]) fs.mkdirSync(d, { recursive: true });

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
    if (config.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
  app.use(auth.guard);
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  // До входа принимаются только маленькие запросы.
  const smallJson = express.json({ limit: '16kb' });
  const json = express.json({ limit: '5mb' });

  const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxPhotoBytes, files: 3, fields: 10 } });
  const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxImportBytes, files: 1, fields: 5 } });
  const backupUpload = multer({ dest: config.tmpDir, limits: { fileSize: config.maxBackupBytes, files: 1, fields: 2 } });
  // Тяжёлые загрузки обрабатываются по нескольку одновременно: памяти на сервере немного.
  const limitConcurrent = (limit) => {
    let busy = 0;
    return (req, res, next) => {
      if (busy >= limit) return res.status(429).json({ error: 'Сервер обрабатывает другие файлы. Повторите через несколько секунд.' });
      busy++;
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          busy--;
        }
      };
      res.on('finish', release);
      res.on('close', release);
      next();
    };
  };
  const photoSlots = limitConcurrent(3);
  const importSlots = limitConcurrent(2);
  const restoreSlots = limitConcurrent(1);

  // ---------- Вход ----------
  app.get('/api/auth/status', auth.status);
  app.post('/api/auth/login', smallJson, auth.login);
  app.post('/api/auth/logout', smallJson, auth.logout);
  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.use('/api', auth.requireAuth);
  app.use('/media', auth.requireAuth);
  app.use('/api', json);
  app.post('/api/auth/logout-all', auth.logoutAll);

  // ---------- Все данные для интерфейса ----------
  app.get('/api/data', (req, res) => {
    const qp = db.all('SELECT * FROM question_persons ORDER BY position');
    const qhyp = db.all('SELECT id, question_id FROM hypotheses WHERE question_id IS NOT NULL');
    const lastBackup = backup.listBackups(config)[0] || null;
    res.json({
      persons: db.all('SELECT * FROM persons ORDER BY display_name').map(persons.serializePerson),
      parentChild: db.all('SELECT * FROM parent_child'),
      partnerships: db.all('SELECT * FROM partnerships'),
      hypotheses: db.all('SELECT * FROM hypotheses').map((h) => ({ ...h, basis: parseJson(h.basis, []) })),
      questions: db.all('SELECT * FROM questions ORDER BY sort_order').map((q) => ({
        ...q,
        notes: parseJson(q.notes, []),
        subjects: qp.filter((x) => x.question_id === q.id && x.role === 'subject').map((x) => x.person_id),
        candidates: qp.filter((x) => x.question_id === q.id && x.role === 'candidate').map((x) => x.person_id),
        hypothesisIds: qhyp.filter((x) => x.question_id === q.id).map((x) => x.id),
      })),
      photos: db.all('SELECT id, person_id, display_file, thumb_file, original_file, original_name, original_width, original_height, crop, caption, created_at FROM photos ORDER BY created_at'),
      sourceRecords: db.all("SELECT id, import_id, person_id, file_name, checksum, sheet_name, cell, row_index, col_index, merged_range, raw_text, parsed, status, created_at FROM source_records WHERE person_id IS NOT NULL AND status <> 'superseded'").map((r) => ({ ...r, parsed: parseJson(r.parsed, {}) })),
      sources: db.all('SELECT * FROM sources ORDER BY created_at'),
      nameReviews: db.all('SELECT * FROM name_reviews ORDER BY created_at').map((r) => ({ ...r, person_ids: parseJson(r.person_ids, []), suggestion: parseJson(r.suggestion, null) })),
      imports: imports.listImports(db),
      meta: {
        appVersion: config.appVersion,
        schemaVersion: db.schemaVersion(),
        backupFormatVersion: backup.BACKUP_FORMAT_VERSION,
        authEnabled: auth.enabled,
        photo: { maxSide: config.photoMaxSide, quality: config.photoQuality, maxUploadBytes: config.maxPhotoBytes },
        backups: { autoKeep: config.autoBackupKeep, safetyKeep: config.safetyBackupKeep, autoDays: config.autoBackupDays },
        storage: { dataDir: config.dataDir, dbFile: config.dbFile, photosDir: config.photosDir, backupsDir: config.backupsDir, importsDir: config.importsDir },
        lastBackup,
        serverTime: nowIso(),
      },
    });
  });

  // ---------- Люди ----------
  app.post('/api/persons', (req, res) => {
    const body = req.body || {};
    const result = db.tx(() => {
      const p = persons.createPerson(db, body.person || body, { force: !!body.force });
      let relationId = null;
      if (body.relation && body.relation.personId) {
        const r = body.relation;
        const opts = { force: !!body.force };
        if (r.type === 'parent') relationId = relations.createParentChild(db, { parentId: p.id, childId: r.personId, kind: r.kind }, opts).id;
        else if (r.type === 'child') relationId = relations.createParentChild(db, { parentId: r.personId, childId: p.id, kind: r.kind }, opts).id;
        else if (r.type === 'partner') relationId = relations.createPartnership(db, { person1Id: r.personId, person2Id: p.id, kind: r.kind, status: r.status }, opts).id;
      }
      return { person: p, relationId };
    });
    res.status(201).json(result);
  });

  app.get('/api/persons/:id', (req, res) => {
    const p = persons.getPerson(db, req.params.id);
    res.json({
      person: p,
      history: personHistory(db, p.id),
    });
  });

  app.put('/api/persons/:id', (req, res) => {
    const body = req.body || {};
    const p = db.tx(() => persons.updatePerson(db, req.params.id, body.person || body, { force: !!body.force }));
    res.json({ person: p });
  });

  app.get('/api/persons/:id/delete-preview', (req, res) => res.json(persons.deletePreview(db, req.params.id)));

  app.delete('/api/persons/:id', (req, res) => {
    const r = db.tx(() => persons.deletePerson(db, req.params.id));
    photos.removePhotoDirs(config, r.photoIds);
    res.json({ ok: true });
  });

  app.get('/api/persons/:id/history', (req, res) => res.json({ history: personHistory(db, req.params.id) }));

  app.post('/api/persons/:id/merge-preview', (req, res) => res.json(persons.mergePreview(db, req.params.id, req.body?.otherId)));
  app.post('/api/persons/:id/merge', (req, res) => {
    const p = db.tx(() => persons.mergePersons(db, req.params.id, req.body?.otherId, req.body?.choices || {}));
    res.json({ person: p });
  });

  // ---------- Связи ----------
  app.post('/api/relations/check', (req, res) => res.json(relations.checkRelation(db, req.body || {})));

  app.post('/api/relations/parent-child', (req, res) => {
    const b = req.body || {};
    const r = db.tx(() => {
      const out = relations.createParentChild(db, b, { force: !!b.force });
      hyps.refreshQuestions(db, out.questionIds);
      return out;
    });
    res.status(201).json(r);
  });
  app.put('/api/relations/parent-child/:id', (req, res) => {
    db.tx(() => relations.updateParentChild(db, req.params.id, req.body || {}));
    res.json({ ok: true });
  });
  app.delete('/api/relations/parent-child/:id', (req, res) => {
    db.tx(() => {
      const out = relations.deleteRelation(db, 'parent_child', req.params.id, { hypothesisStatus: req.query.hypothesis === 'rejected' ? 'rejected' : 'open' });
      hyps.refreshQuestions(db, out.questionIds);
    });
    res.json({ ok: true });
  });

  app.post('/api/relations/partnerships', (req, res) => {
    const b = req.body || {};
    const r = db.tx(() => {
      const out = relations.createPartnership(db, b, { force: !!b.force });
      hyps.refreshQuestions(db, out.questionIds);
      return out;
    });
    res.status(201).json(r);
  });
  app.put('/api/relations/partnerships/:id', (req, res) => {
    const b = req.body || {};
    db.tx(() => relations.updatePartnership(db, req.params.id, b, { force: !!b.force }));
    res.json({ ok: true });
  });
  app.delete('/api/relations/partnerships/:id', (req, res) => {
    db.tx(() => {
      const out = relations.deleteRelation(db, 'partnership', req.params.id, { hypothesisStatus: req.query.hypothesis === 'rejected' ? 'rejected' : 'open' });
      hyps.refreshQuestions(db, out.questionIds);
    });
    res.json({ ok: true });
  });

  // ---------- Предположения и вопросы ----------
  app.post('/api/hypotheses/:id/confirm', (req, res) => {
    const b = req.body || {};
    res.json(db.tx(() => hyps.confirmHypothesis(db, req.params.id, b, { force: !!b.force })));
  });
  app.post('/api/hypotheses/:id/reject', (req, res) => {
    db.tx(() => hyps.rejectHypothesis(db, req.params.id, req.body || {}));
    res.json({ ok: true });
  });
  app.post('/api/hypotheses/:id/reopen', (req, res) => {
    db.tx(() => hyps.reopenHypothesis(db, req.params.id));
    res.json({ ok: true });
  });
  app.post('/api/questions/:id/status', (req, res) => {
    db.tx(() => hyps.setQuestionStatus(db, req.params.id, req.body?.status));
    res.json({ ok: true });
  });
  app.post('/api/name-reviews/:id/status', (req, res) => {
    db.tx(() => hyps.setNameReviewStatus(db, req.params.id, req.body?.status));
    res.json({ ok: true });
  });

  // ---------- Источники ----------
  // Ссылка — только http(s): javascript: и data: в href недопустимы.
  const cleanUrl = (v) => {
    const url = cleanText(v, { max: 2000 });
    if (!url) return url;
    if (!/^https?:\/\/[^\s]+$/i.test(url)) throw badRequest('Ссылка должна начинаться с http:// или https://');
    return url;
  };
  const sourceFields = (b) => ({
    title: cleanText(b.title, { max: 500 }),
    kind: oneOf(b.kind, ['document', 'oral', 'photo', 'archive', 'web', 'excel', 'other'], 'other', 'Вид источника'),
    details: cleanText(b.details, { max: 20000 }),
    url: cleanUrl(b.url),
  });
  app.post('/api/persons/:id/sources', (req, res) => {
    const p = persons.getPerson(db, req.params.id);
    const f = sourceFields(req.body || {});
    if (!f.title) throw badRequest('Укажите название источника');
    const id = newId();
    db.tx(() => {
      const now = nowIso();
      db.insert('sources', { id, person_id: p.id, ...f, created_at: now, updated_at: now });
      db.run('UPDATE persons SET last_manual_edit_at = ?, updated_at = ? WHERE id = ?', now, now, p.id);
      logChange(db, { action: 'source.add', entityType: 'source', entityId: id, summary: `Добавлен источник «${f.title}»`, personIds: [p.id] });
    });
    res.status(201).json({ id });
  });
  app.put('/api/sources/:id', (req, res) => {
    const s = db.get('SELECT * FROM sources WHERE id = ?', req.params.id);
    if (!s) throw notFound('Источник не найден');
    const f = sourceFields(req.body || {});
    if (!f.title) throw badRequest('Укажите название источника');
    db.tx(() => {
      db.update('sources', s.id, { ...f, updated_at: nowIso() });
      logChange(db, { action: 'source.update', entityType: 'source', entityId: s.id, summary: `Изменён источник «${f.title}»`, details: { before: s, after: f }, personIds: [s.person_id] });
    });
    res.json({ ok: true });
  });
  app.delete('/api/sources/:id', (req, res) => {
    const s = db.get('SELECT * FROM sources WHERE id = ?', req.params.id);
    if (!s) throw notFound('Источник не найден');
    db.tx(() => {
      db.run('DELETE FROM sources WHERE id = ?', s.id);
      logChange(db, { action: 'source.delete', entityType: 'source', entityId: s.id, summary: `Удалён источник «${s.title}»`, details: { source: s }, personIds: [s.person_id] });
    });
    res.json({ ok: true });
  });

  // ---------- Фотографии ----------
  const photoFiles = photoUpload.fields([{ name: 'original', maxCount: 1 }, { name: 'display', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]);
  app.post('/api/persons/:id/photos', photoSlots, photoFiles, (req, res) => {
    const f = req.files || {};
    if (!f.original?.[0] || !f.display?.[0] || !f.thumb?.[0]) throw badRequest('Нужны исходный файл, кадрированное фото и миниатюра');
    const ph = photos.addPhoto(db, config, req.params.id, {
      files: { original: f.original[0].buffer, display: f.display[0].buffer, thumb: f.thumb[0].buffer },
      originalName: uploadName(f.original[0].originalname, ''),
      crop: req.body?.crop,
      caption: req.body?.caption,
      replacePhotoId: req.body?.replacePhotoId || null,
    });
    res.status(201).json({ photo: ph });
  });
  app.put('/api/photos/:id', photoSlots, photoFiles, (req, res) => {
    const f = req.files || {};
    const ph = photos.updatePhoto(db, config, req.params.id, {
      files: { display: f.display?.[0]?.buffer, thumb: f.thumb?.[0]?.buffer },
      crop: req.body?.crop,
      caption: req.body?.caption,
    });
    res.json({ photo: ph });
  });
  app.delete('/api/photos/:id', (req, res) => {
    photos.deletePhoto(db, config, req.params.id);
    res.json({ ok: true });
  });
  app.post('/api/persons/:id/primary-photo', (req, res) => {
    photos.setPrimaryPhoto(db, req.params.id, req.body?.photoId);
    res.json({ ok: true });
  });
  app.get('/media/photos/:id/:file', (req, res) => {
    const file = req.params.file;
    if (!isPhotoFile(file)) throw notFound('Фотография не найдена');
    const ph = db.get('SELECT * FROM photos WHERE id = ?', req.params.id);
    if (!ph || ![ph.original_file, ph.display_file, ph.thumb_file].includes(file)) throw notFound('Фотография не найдена');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Disposition', 'inline');
    res.sendFile(file, { root: photos.photoDir(config, ph.id), dotfiles: 'deny', headers: { 'Content-Type': MIME_BY_EXT[file.split('.').pop()] } });
  });

  // ---------- Импорт ----------
  app.post('/api/imports/preview', importSlots, importUpload.single('file'), (req, res) => {
    if (!req.file) throw badRequest('Выберите файл .xlsx');
    const fileName = uploadName(req.file.originalname, 'файл.xlsx');
    res.json(imports.createPreview(db, config, { buffer: req.file.buffer, fileName, includeHidden: req.body?.includeHidden === '1' }));
  });
  app.post('/api/imports/commit', (req, res) => {
    ensureSpace(config, config.maxImportBytes, 'для импорта');
    res.json(imports.commitImport(db, config, req.body || {}));
  });
  app.post('/api/imports/discard', (req, res) => {
    imports.discardPreview(req.body?.previewId);
    res.json({ ok: true });
  });
  app.get('/api/imports', (req, res) => res.json({ imports: imports.listImports(db) }));
  app.get('/api/imports/:id', (req, res) => res.json(imports.getImport(db, req.params.id)));
  app.get('/api/imports/:id/file', (req, res) => {
    const imp = imports.getImport(db, req.params.id);
    if (!isImportFile(imp.stored_file) || !fs.existsSync(path.join(config.importsDir, imp.stored_file))) throw notFound('Исходный файл не сохранён');
    res.download(imp.stored_file, imp.file_name, { root: config.importsDir, dotfiles: 'deny' });
  });
  app.get('/api/imports/:id/rollback-preview', (req, res) => res.json(imports.rollbackPreview(db, req.params.id)));
  app.post('/api/imports/:id/rollback', asyncHandler(async (req, res) => {
    imports.rollbackPreview(db, req.params.id);
    const bk = await backup.createBackup(db, config, { label: 'before-rollback', appVersion: config.appVersion });
    const r = imports.rollbackImport(db, config, req.params.id, { deleteModified: !!req.body?.deleteModified, backupName: bk.name });
    photos.removePhotoDirs(config, r.photoIds);
    res.json({ ...r, backup: bk });
  }));

  // ---------- Резервные копии и экспорт ----------
  app.get('/api/backups', (req, res) => res.json({ backups: backup.listBackups(config) }));
  app.get('/api/storage', (req, res) => res.json(storageUsage(config)));
  app.delete('/api/backups/:name', (req, res) => {
    backup.deleteBackup(db, config, req.params.name);
    res.json({ ok: true });
  });
  app.post('/api/backups', asyncHandler(async (req, res) => {
    const bk = await backup.createBackup(db, config, { label: null, appVersion: config.appVersion });
    res.status(201).json(bk);
  }));
  app.get('/api/backups/:name/download', (req, res) => {
    res.download(backup.backupPath(config, req.params.name), req.params.name);
  });
  // Перед приёмом большого файла проверяем, поместится ли он на диск.
  const roomForUpload = (req, res, next) => {
    const len = Number(req.headers['content-length'] || 0);
    // Без указанного размера место заранее не проверить — такие загрузки не принимаются.
    if (!(len > 0)) return res.status(411).json({ error: 'Не указан размер загружаемого файла' });
    ensureSpace(config, len, 'для загрузки резервной копии');
    next();
  };
  app.post('/api/backups/restore-preview', restoreSlots, roomForUpload, backupUpload.single('file'), asyncHandler(async (req, res) => {
    let file;
    let uploaded = false;
    if (req.file) {
      file = req.file.path;
      uploaded = true;
    } else if (req.body?.name) {
      file = backup.backupPath(config, req.body.name);
    } else throw badRequest('Выберите файл резервной копии');
    try {
      res.json(await backup.restorePreview(db, config, file, { uploaded }));
    } catch (e) {
      if (uploaded) fs.rmSync(file, { force: true });
      throw e;
    }
  }));
  app.post('/api/backups/restore', restoreSlots, asyncHandler(async (req, res) => {
    const token = req.body?.token;
    // Сначала проверка предпросмотра: страховочная копия не создаётся (и не вытесняет старые) впустую.
    if (!backup.hasRestoreToken(token)) throw new ApiError(409, 'Предпросмотр восстановления устарел. Загрузите копию ещё раз.');
    const before = await backup.createBackup(db, config, { label: 'before-restore', appVersion: config.appVersion });
    const r = await backup.restoreBackup(db, config, token);
    res.json({ ...r, backupBefore: before });
  }));

  app.get('/api/export/persons.csv', (req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="persons-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(personsCsv(db));
  });
  app.get('/api/export/relations.csv', (req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="relations-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(relationsCsv(db));
  });

  app.get('/api/changes', (req, res) => {
    const n = Math.trunc(Number(req.query.limit));
    res.json({ changes: recentChanges(db, n >= 1 ? Math.min(500, n) : 100) });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Неизвестный адрес API' }));

  // ---------- Интерфейс ----------
  if (fs.existsSync(path.join(config.clientDist, 'index.html'))) {
    // Файлы сборки с хэшем в имени можно кэшировать надолго.
    app.use('/assets', express.static(path.join(config.clientDist, 'assets'), { index: false, maxAge: '365d', immutable: true, fallthrough: false }));
    app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/|media\/).*/, (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.clientDist, 'index.html'));
    });
  } else {
    app.get('/', (req, res) => res.type('html').send('<meta charset="utf-8"><p style="font-family:sans-serif">Интерфейс ещё не собран. Выполните <code>npm run build</code> или запустите <code>npm start</code>.</p>'));
  }

  // ---------- Ошибки ----------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ApiError) return res.status(err.status).json({ error: err.message, ...err.extra });
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Файл слишком большой' });
      return res.status(400).json({ error: `Ошибка загрузки файла: ${err.message}` });
    }
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Неверный формат запроса' });
    if (err?.code === 'EBADCSRFTOKEN') return res.status(403).json({ error: 'Запрос отклонён' });
    const status = err?.status || err?.statusCode;
    if (status && status >= 400 && status < 500 && err?.type !== 'entity.too.large') return res.status(status).json({ error: status === 404 ? 'Не найдено' : 'Неверный запрос' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Слишком большой запрос' });
    if (err?.code === 'ERR_SQLITE_ERROR' && /constraint/i.test(err.message)) {
      return res.status(422).json({ error: 'Данные нарушают ограничения базы (например, связь человека с самим собой)' });
    }
    console.error('[ошибка]', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера. Данные не изменены — попробуйте ещё раз.' });
  });

  return app;
}
