// Интеграционные тесты API на синтетических данных во временном каталоге.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, photoForm, xlsxForm, makePng } from '../helpers/harness.js';
import { fixtureXlsx, FIXTURE_RECORDS } from '../helpers/fixture.js';

async function importFixture(s, opts) {
  const pv = await s.form('/api/imports/preview', xlsxForm(fixtureXlsx(opts)));
  assert.equal(pv.status, 200, JSON.stringify(pv.data));
  return pv.data;
}

const byCell = (data, cell) => {
  const r = data.sourceRecords.find((x) => x.cell === cell && x.status === 'active');
  return data.persons.find((p) => p.id === r.person_id);
};

test('импорт: 21 запись, без связей, неизвестные значения не заполняются, повтор без дублей', async () => {
  const s = await startServer();
  try {
    const pv = await importFixture(s);
    assert.equal(pv.mode, 'new');
    assert.equal(pv.records.length, FIXTURE_RECORDS);
    const c = await s.post('/api/imports/commit', { previewId: pv.previewId });
    assert.equal(c.status, 200, JSON.stringify(c.data));
    assert.equal(c.data.summary.persons, FIXTURE_RECORDS);
    assert.equal(c.data.summary.confirmed, 0);
    const { data } = await s.get('/api/data');
    assert.equal(data.persons.length, FIXTURE_RECORDS);
    assert.equal(data.parentChild.length, 0, 'нет подтверждённых связей родитель — ребёнок');
    assert.equal(data.partnerships.length, 0, 'нет подтверждённых партнёрств');
    assert.ok(data.hypotheses.length > 0 && data.hypotheses.every((h) => h.status === 'open'));
    for (const p of data.persons) {
      assert.equal(p.birth_precision, 'unknown');
      assert.equal(p.death_precision, 'unknown');
      assert.equal(p.life_status, 'unknown');
      assert.equal(p.sex, null);
    }
    // Исходная строка и координаты сохранены.
    const rec = data.sourceRecords.find((r) => r.cell === 'B1');
    assert.equal(rec.raw_text, 'Петров Иван  ');
    assert.equal(rec.sheet_name, 'Лист1');
    assert.equal(rec.file_name, 'Семейное древо .xlsx');
    assert.equal(byCell(data, 'B1').display_name, 'Петров Иван');
    assert.equal(data.sourceRecords.find((r) => r.cell === 'B4').merged_range, 'B4:D4');
    const zoya = byCell(data, 'G4');
    assert.equal(zoya.surname, null);
    assert.equal(zoya.patronymic, null);
    // Повторный импорт того же файла (под другим именем) — дублей нет.
    const pv2 = await s.form('/api/imports/preview', xlsxForm(fixtureXlsx(), 'копия.xlsx'));
    assert.equal(pv2.data.mode, 'duplicate');
    const c2 = await s.post('/api/imports/commit', { previewId: pv2.data.previewId });
    assert.equal(c2.status, 409);
    let after = await s.get('/api/data');
    assert.equal(after.data.persons.length, FIXTURE_RECORDS);
    // Тот же набор записей, но пересохранённый файл (другая контрольная сумма): новых людей нет.
    const pv3 = await importFixture(s, { mtime: '2021-06-01T10:00:00Z' });
    assert.equal(pv3.mode, 'update');
    assert.ok(pv3.diff.entries.every((e) => e.status === 'unchanged') && pv3.diff.removed.length === 0);
    const c3 = await s.post('/api/imports/commit', { previewId: pv3.previewId });
    assert.equal(c3.status, 200, JSON.stringify(c3.data));
    assert.equal(c3.data.summary.persons, 0);
    after = await s.get('/api/data');
    assert.equal(after.data.persons.length, FIXTURE_RECORDS);
    assert.equal(after.data.sourceRecords.filter((r) => r.status === 'active').length, FIXTURE_RECORDS);
  } finally {
    await s.close();
  }
});

test('связи: один родитель не назначает второго и не создаёт пару; цикл и связь с собой запрещены; исправление подтверждения', async () => {
  const s = await startServer();
  try {
    const pv = await importFixture(s);
    await s.post('/api/imports/commit', { previewId: pv.previewId });
    let { data } = await s.get('/api/data');
    const ivan = byCell(data, 'B1');
    const alexey = byCell(data, 'B4');
    const hyp = data.hypotheses.find((h) => h.type === 'parent_child' && h.person_a === ivan.id && h.person_b === alexey.id);
    assert.ok(hyp, 'есть предположение по отчеству');
    const r = await s.post(`/api/hypotheses/${hyp.id}/confirm`, { kind: 'biological' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    ({ data } = await s.get('/api/data'));
    assert.equal(data.parentChild.length, 1);
    assert.equal(data.parentChild.filter((x) => x.child_id === alexey.id).length, 1, 'второй родитель не назначен');
    assert.equal(data.partnerships.length, 0, 'брак не создан');
    // Цикл предков.
    const cyc = await s.post('/api/relations/parent-child', { parentId: alexey.id, childId: ivan.id });
    assert.equal(cyc.status, 422);
    assert.match(cyc.data.error, /цикл/);
    const grand = byCell(data, 'B6');
    await s.post('/api/relations/parent-child', { parentId: alexey.id, childId: grand.id });
    const cyc2 = await s.post('/api/relations/parent-child', { parentId: grand.id, childId: ivan.id });
    assert.equal(cyc2.status, 422, 'цикл через поколение тоже запрещён');
    const self = await s.post('/api/relations/parent-child', { parentId: ivan.id, childId: ivan.id });
    assert.equal(self.status, 422);
    const selfP = await s.post('/api/relations/partnerships', { person1Id: ivan.id, person2Id: ivan.id });
    assert.equal(selfP.status, 422);
    // Исправление ошибочного подтверждения: связь удаляется, предположение снова открыто.
    const rel = data.parentChild.find((x) => x.child_id === alexey.id);
    const d = await s.del(`/api/relations/parent-child/${rel.id}`);
    assert.equal(d.status, 200);
    ({ data } = await s.get('/api/data'));
    assert.equal(data.hypotheses.find((h) => h.id === hyp.id).status, 'open');
    // Добавить нового человека и связать с существующим.
    const add = await s.post('/api/persons', { person: { surname: 'Петров', given_name: 'Никита' }, relation: { type: 'child', personId: alexey.id } });
    assert.equal(add.status, 201, JSON.stringify(add.data));
    assert.equal(add.data.person.display_name, 'Петров Никита');
    ({ data } = await s.get('/api/data'));
    assert.ok(data.parentChild.some((x) => x.parent_id === alexey.id && x.child_id === add.data.person.id));
    // Предупреждение о датах требует подтверждения, а не молчаливой правки.
    const bad = await s.put(`/api/persons/${ivan.id}`, { person: { birth_precision: 'year', birth_date: '1950', death_precision: 'year', death_date: '1940' } });
    assert.equal(bad.status, 409);
    assert.ok(bad.data.warnings.length);
    const forced = await s.put(`/api/persons/${ivan.id}`, { person: { birth_precision: 'year', birth_date: '1950', death_precision: 'year', death_date: '1940' }, force: true });
    assert.equal(forced.status, 200);
    assert.equal(forced.data.person.birth_date, '1950');
    const wrong = await s.put(`/api/persons/${ivan.id}`, { person: { birth_precision: 'exact', birth_date: '1950' } });
    assert.equal(wrong.status, 422, 'неполная «полная дата» отклоняется');
    // Запрос без служебного заголовка отклоняется.
    const res = await fetch(`${s.url}/api/persons`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 403);
  } finally {
    await s.close();
  }
});

test('один ли это человек: объединение только по решению, исходные ячейки сохраняются', async () => {
  const s = await startServer();
  try {
    const pv = await importFixture(s);
    await s.post('/api/imports/commit', { previewId: pv.previewId });
    let { data } = await s.get('/api/data');
    const a = byCell(data, 'F2');
    const b = byCell(data, 'F3');
    assert.notEqual(a.id, b.id, 'до решения — две записи');
    const h = data.hypotheses.find((x) => x.type === 'same_person');
    const r = await s.post(`/api/hypotheses/${h.id}/confirm`, { primaryId: b.id });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    ({ data } = await s.get('/api/data'));
    assert.equal(data.persons.length, FIXTURE_RECORDS - 1);
    const merged = data.persons.find((p) => p.id === b.id);
    assert.ok(merged.other_names.includes('Орлов Олег'));
    assert.deepEqual(data.sourceRecords.filter((x) => x.person_id === b.id).map((x) => x.cell).sort(), ['F2', 'F3']);
  } finally {
    await s.close();
  }
});

test('фото, сохранение после перезапуска, резервная копия и восстановление', async () => {
  let s = await startServer();
  const dir = s.dir;
  try {
    const pv = await importFixture(s);
    await s.post('/api/imports/commit', { previewId: pv.previewId });
    let { data } = await s.get('/api/data');
    const p = byCell(data, 'D1');
    // Недопустимый файл отклоняется.
    const badForm = new FormData();
    badForm.append('original', new Blob([Buffer.from('это не картинка')], { type: 'image/png' }), 'x.png');
    badForm.append('display', new Blob([makePng()], { type: 'image/png' }), 'd.png');
    badForm.append('thumb', new Blob([makePng()], { type: 'image/png' }), 't.png');
    const bad = await s.form(`/api/persons/${p.id}/photos`, badForm);
    assert.equal(bad.status, 422);
    const up = await s.form(`/api/persons/${p.id}/photos`, photoForm());
    assert.equal(up.status, 201, JSON.stringify(up.data));
    const photo = up.data.photo;
    const file = path.join(dir, 'photos', photo.id, photo.original_file);
    assert.ok(fs.existsSync(file), 'фото сохранено файлом');
    await s.put(`/api/persons/${p.id}`, { person: { biography: 'Пример биографии', birth_precision: 'about', birth_date: '1931' } });
    // Перезапуск: та же папка данных.
    await s.close({ keep: true });
    s = await startServer({ dataDir: dir });
    ({ data } = await s.get('/api/data'));
    const again = data.persons.find((x) => x.id === p.id);
    assert.equal(again.biography, 'Пример биографии');
    assert.equal(again.birth_precision, 'about');
    assert.equal(again.birth_date, '1931');
    assert.equal(again.primary_photo_id, photo.id);
    const img = await s.raw('GET', `/media/photos/${photo.id}/${photo.thumb_file}`);
    assert.equal(img.status, 200);
    // Резервная копия.
    const bk = await s.post('/api/backups');
    assert.equal(bk.status, 201, JSON.stringify(bk.data));
    assert.equal(bk.data.counts.photos, 1);
    // Изменения после копии: удаляем фото и человека.
    await s.del(`/api/photos/${photo.id}`);
    assert.ok(!fs.existsSync(file));
    const victim = byCell(data, 'E4');
    await s.del(`/api/persons/${victim.id}`);
    // Восстановление из сохранённой копии.
    const fd = new FormData();
    fd.append('name', bk.data.name);
    const prev = await s.form('/api/backups/restore-preview', fd);
    assert.equal(prev.status, 200, JSON.stringify(prev.data));
    assert.equal(prev.data.manifest.formatVersion, 1);
    const rs = await s.post('/api/backups/restore', { token: prev.data.token });
    assert.equal(rs.status, 200, JSON.stringify(rs.data));
    ({ data } = await s.get('/api/data'));
    assert.equal(data.persons.length, FIXTURE_RECORDS);
    assert.ok(data.persons.find((x) => x.id === victim.id), 'удалённый человек восстановлен');
    assert.ok(fs.existsSync(file), 'файл фотографии восстановлен');
    assert.equal(data.persons.find((x) => x.id === p.id).birth_date, '1931', 'точность даты сохранена');
    assert.equal(data.sourceRecords.find((r) => r.cell === 'B1').raw_text, 'Петров Иван  ', 'исходная строка сохранена');
    // CSV.
    const csv = await s.get('/api/export/persons.csv');
    assert.match(csv.data, /"Петров Иван  "/);
    assert.match(csv.data, /рождение_точность/);
    const rcsv = await s.get('/api/export/relations.csv');
    assert.equal(rcsv.status, 200);
  } finally {
    await s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('новая версия файла: сверка различий, ручные правки не перезаписываются, откат с предпросмотром', async () => {
  const s = await startServer();
  try {
    const pv = await importFixture(s);
    const c1 = await s.post('/api/imports/commit', { previewId: pv.previewId });
    let { data } = await s.get('/api/data');
    const nina = byCell(data, 'E4');
    await s.put(`/api/persons/${nina.id}`, { person: { display_name: 'Сидорова Нина (моя правка)' } });
    const pv2 = await importFixture(s, { variant: 'changed' });
    assert.equal(pv2.mode, 'update');
    const st = Object.fromEntries(pv2.diff.entries.map((e) => [e.key, e]));
    assert.equal(st['Лист1!E4'].status, 'changed');
    assert.equal(st['Лист1!E4'].personEdited, true);
    assert.equal(st['Лист1!E4'].defaultAction, 'keep');
    assert.equal(st['Лист1!A9'].status, 'new');
    assert.ok(pv2.diff.removed.some((r) => r.key === 'Лист1!D9'));
    const c2 = await s.post('/api/imports/commit', { previewId: pv2.previewId });
    assert.equal(c2.status, 200, JSON.stringify(c2.data));
    ({ data } = await s.get('/api/data'));
    assert.equal(data.persons.find((p) => p.id === nina.id).display_name, 'Сидорова Нина (моя правка)');
    assert.equal(data.persons.length, FIXTURE_RECORDS + 1, 'добавлена только новая запись');
    assert.equal(data.sourceRecords.find((r) => r.cell === 'D9').status, 'removed');
    // Откат второго импорта.
    const rp = await s.get(`/api/imports/${c2.data.importId}/rollback-preview`);
    assert.equal(rp.status, 200);
    assert.equal(rp.data.personsToDelete.length, 1);
    const rb = await s.post(`/api/imports/${c2.data.importId}/rollback`, {});
    assert.equal(rb.status, 200, JSON.stringify(rb.data));
    ({ data } = await s.get('/api/data'));
    assert.equal(data.persons.length, FIXTURE_RECORDS);
    assert.equal(data.sourceRecords.find((r) => r.cell === 'D9').status, 'active', 'запись прежней версии восстановлена');
    // Откат первого: человек с ручной правкой по умолчанию сохраняется.
    const rp1 = await s.get(`/api/imports/${c1.data.importId}/rollback-preview`);
    assert.ok(rp1.data.personsModified.some((m) => m.person.id === nina.id));
    await s.post(`/api/imports/${c1.data.importId}/rollback`, {});
    ({ data } = await s.get('/api/data'));
    assert.deepEqual(data.persons.map((p) => p.id), [nina.id]);
  } finally {
    await s.close();
  }
});

test('доступ по паролю', async () => {
  const s = await startServer({ env: { APP_PASSWORD: 'тестовый-пароль' } });
  try {
    assert.equal((await s.get('/api/data')).status, 401);
    assert.equal((await s.post('/api/auth/login', { password: 'неверно' })).status, 401);
    assert.equal((await s.post('/api/auth/login', { password: 'тестовый-пароль' })).status, 200);
    assert.equal((await s.get('/api/data')).status, 200);
  } finally {
    await s.close();
  }
});
