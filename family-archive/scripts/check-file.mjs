// Проверка готовности на реальном файле Excel во ВРЕМЕННОЙ папке данных.
// Рабочая база (data/) не затрагивается. Имена в коде не используются —
// только координаты и общие правила.
//
//   npm run check:file -- "путь/к/файлу.xlsx" [--expect=30] [--report]
import fs from 'node:fs';
import path from 'node:path';
import { startServer, photoForm, xlsxForm } from '../tests/helpers/harness.js';
import { readWorkbook } from '../server/xlsx/reader.js';
import { surnameStem, patronymicStem, searchKey } from '../shared/names.js';
import { kinshipLabel, NOT_ENOUGH } from '../client/src/lib/kinship.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const expect = Number((args.find((a) => a.startsWith('--expect=')) || '').split('=')[1]) || null;
const showReport = args.includes('--report');
if (!file) {
  console.error('Использование: npm run check:file -- "путь/к/файлу.xlsx" [--expect=30] [--report]');
  process.exit(1);
}

const results = [];
const check = (n, title, ok, details = '') => {
  results.push({ n, title, ok, details });
  console.log(`${ok ? '✓' : '✗'} ${n}. ${title}${details ? ` — ${details}` : ''}`);
};

function indexFrom(data) {
  const m = (list, key) => {
    const out = new Map();
    for (const r of list) {
      if (!out.has(r[key])) out.set(r[key], []);
      out.get(r[key]).push(r);
    }
    return out;
  };
  const partnersOf = new Map();
  for (const r of data.partnerships) for (const id of [r.person1_id, r.person2_id]) {
    if (!partnersOf.has(id)) partnersOf.set(id, []);
    partnersOf.get(id).push(r);
  }
  return { byId: new Map(data.persons.map((p) => [p.id, p])), parentsOf: m(data.parentChild, 'child_id'), childrenOf: m(data.parentChild, 'parent_id'), partnersOf };
}

const buffer = fs.readFileSync(file);
const wb = readWorkbook(buffer);
let s = await startServer();
const dir = s.dir;
try {
  const pv = (await s.form('/api/imports/preview', xlsxForm(buffer, path.basename(file)))).data;
  if (pv.error) throw new Error(pv.error);
  const visible = wb.sheets.filter((x) => x.state === 'visible');
  check(1, 'Найден один видимый лист и ожидаемое число записей', visible.length === 1 && (!expect || pv.records.length === expect),
    `листов: ${wb.sheets.length} (видимых ${visible.length}: ${visible.map((x) => `«${x.name}»`).join(', ')}), записей: ${pv.records.length}${expect ? ` (ожидалось ${expect})` : ''}`);

  const commit = (await s.post('/api/imports/commit', { previewId: pv.previewId })).data;
  let { data } = await s.get('/api/data');
  const recs = data.sourceRecords.filter((r) => r.status === 'active');
  const personOf = (cell) => recs.find((r) => r.cell === cell)?.person_id;

  const nonMaster = new Set();
  for (const sh of visible) for (const m of sh.merges) for (let r = m.top; r <= m.bottom; r++) for (let c = m.left; c <= m.right; c++) if (r !== m.top || c !== m.left) nonMaster.add(`${sh.name}!${String.fromCharCode(64 + c)}${r}`);
  const inNonMaster = recs.filter((r) => nonMaster.has(`${r.sheet_name}!${r.cell}`));
  const mergeCount = visible.reduce((n, x) => n + x.merges.length, 0);
  check(2, 'Объединённые диапазоны не создают дополнительных людей', inNonMaster.length === 0 && data.persons.length === pv.records.length,
    `объединений: ${mergeCount}; людей: ${data.persons.length}; записей из неосновных ячеек: ${inNonMaster.length}`);

  let rawOk = 0;
  for (const r of recs) {
    const sh = wb.sheets.find((x) => x.name === r.sheet_name);
    const cell = sh.cells.find((c) => c.ref === r.cell);
    if (cell && cell.value === r.raw_text) rawOk++;
  }
  check(3, 'Координаты и полные исходные строки сохранены', rawOk === recs.length, `совпадает ${rawOk} из ${recs.length} (включая конечные пробелы)`);

  const single = data.persons.filter((p) => {
    const r = recs.find((x) => x.person_id === p.id);
    return r && r.raw_text.trim().split(/\s+/).length === 1;
  });
  check(4, 'Запись из одного слова — без выдуманной фамилии и отчества', single.every((p) => p.surname === null && p.patronymic === null),
    single.map((p) => `${recs.find((x) => x.person_id === p.id).cell}: фамилия ${p.surname ?? 'неизвестна'}, отчество ${p.patronymic ?? 'неизвестно'}`).join('; ') || 'таких записей нет');

  const distinct = new Set(recs.map((r) => r.person_id)).size === recs.length;
  const sameQ = data.hypotheses.filter((h) => h.type === 'same_person');
  check(5, 'Записи с совпадающими фамилией и именем остаются разными людьми до решения', distinct && sameQ.every((h) => h.status === 'open'),
    `совпадений, вынесенных в вопросы: ${sameQ.length} (${sameQ.map((h) => `${recs.find((r) => r.person_id === h.person_a)?.cell}/${recs.find((r) => r.person_id === h.person_b)?.cell}`).join(', ')})`);

  const corrected = data.persons.filter((p) => {
    const r = recs.find((x) => x.person_id === p.id);
    return r && p.display_name !== r.raw_text.trim();
  });
  check(6, 'Написание не исправлено автоматически (отображаемое имя = исходная строка без краевых пробелов)', corrected.length === 0, `расхождений: ${corrected.length}`);

  const similar = [];
  for (let i = 0; i < data.persons.length; i++) for (let j = i + 1; j < data.persons.length; j++) {
    const a = data.persons[i];
    const b = data.persons[j];
    if (!a.given_name || !b.given_name || a.given_name === b.given_name) continue;
    const ka = searchKey(a.given_name);
    const kb = searchKey(b.given_name);
    if (ka.startsWith(kb) || kb.startsWith(ka)) similar.push(`${recs.find((r) => r.person_id === a.id)?.cell}/${recs.find((r) => r.person_id === b.id)?.cell}`);
  }
  check(7, 'Похожие имена не объединены', distinct, `пары похожих имён остаются отдельными записями: ${similar.join(', ') || 'нет'}`);

  check(8, 'Даты, пол и жизненный статус остаются неизвестными', data.persons.every((p) => p.birth_precision === 'unknown' && p.death_precision === 'unknown' && p.life_status === 'unknown' && p.sex === null));
  check(9, 'До подтверждения нет подтверждённых семейных связей', data.parentChild.length === 0 && data.partnerships.length === 0,
    `предположений: ${data.hypotheses.length}, вопросов: ${data.questions.length}`);

  // 20. Гипотезы не участвуют в вычислении родства.
  const idx0 = indexFrom(data);
  const someHyp = data.hypotheses.find((h) => h.type === 'parent_child');
  const label0 = someHyp ? kinshipLabel(someHyp.person_b, someHyp.person_a, idx0)?.label : NOT_ENOUGH;
  check(20, 'Предположения не участвуют в вычислении родства', label0 === NOT_ENOUGH, `подпись для пары из предположения: «${label0}»`);

  // 10. Подтверждение одного родителя.
  const target = data.hypotheses.find((h) => h.type === 'parent_child' && h.strength === 'patronymic');
  await s.post(`/api/hypotheses/${target.id}/confirm`, {});
  ({ data } = await s.get('/api/data'));
  const childParents = data.parentChild.filter((r) => r.child_id === target.person_b);
  check(10, 'Подтверждение одного родителя не назначает второго и не создаёт брак', data.parentChild.length === 1 && childParents.length === 1 && data.partnerships.length === 0,
    `подтверждено: ${recs.find((r) => r.person_id === target.person_a)?.cell} → ${recs.find((r) => r.person_id === target.person_b)?.cell}; связей родитель—ребёнок: ${data.parentChild.length}, партнёрств: ${data.partnerships.length}`);
  const idx1 = indexFrom(data);
  const kin = kinshipLabel(target.person_b, target.person_a, idx1)?.label;

  // 11. Записи одна под другой с общим отчеством не становятся поколениями.
  const stacks = [];
  for (const a of recs) for (const b of recs) {
    if (a.col_index !== b.col_index || b.row_index !== a.row_index + 1) continue;
    const pa = data.persons.find((p) => p.id === a.person_id);
    const pb = data.persons.find((p) => p.id === b.person_id);
    if (pa.patronymic && pb.patronymic && patronymicStem(pa.patronymic) === patronymicStem(pb.patronymic) && surnameStem(pa.surname) === surnameStem(pb.surname)) stacks.push([a, b]);
  }
  const chained = stacks.filter(([a, b]) => data.hypotheses.some((h) => h.type === 'parent_child' && ((h.person_a === a.person_id && h.person_b === b.person_id) || (h.person_a === b.person_id && h.person_b === a.person_id))));
  check(11, 'Записи одна под другой с общим отчеством не превращаются в поколения', chained.length === 0,
    `пар одна под другой: ${stacks.map(([a, b]) => `${a.cell}/${b.cell}`).join(', ') || 'нет'}; связанных как родитель—ребёнок: ${chained.length}`);

  // 12. Возможные вторые родители не распределяются по столбцам.
  let unequal = 0;
  const groups = [];
  for (const q of data.questions.filter((x) => x.kind === 'parents')) {
    const hs = data.hypotheses.filter((h) => h.question_id === q.id && h.strength === 'position');
    const cos = [...new Set(hs.map((h) => h.person_a))];
    if (cos.length < 2) continue;
    groups.push(`${cos.map((c) => recs.find((r) => r.person_id === c)?.cell).join('+')} → ${q.subjects.map((c) => recs.find((r) => r.person_id === c)?.cell).join(',')}`);
    for (const c of cos) for (const ch of q.subjects) if (!hs.some((h) => h.person_a === c && h.person_b === ch)) unequal++;
  }
  const confirmedMothers = data.parentChild.filter((r) => data.hypotheses.some((h) => h.relation_id === r.id && h.strength === 'position')).length;
  check(12, 'Матери (вторые родители) не назначаются по расположению', unequal === 0 && confirmedMothers === 0, `группы: ${groups.join('; ') || 'нет'}`);

  // 13. Повторный импорт.
  const again = (await s.form('/api/imports/preview', xlsxForm(buffer, 'другое имя.xlsx'))).data;
  const c2 = await s.post('/api/imports/commit', { previewId: again.previewId });
  ({ data } = await s.get('/api/data'));
  check(13, 'Повторный импорт того же файла не создаёт дублей', again.mode === 'duplicate' && c2.status === 409 && data.persons.length === pv.records.length, `режим: ${again.mode}, людей: ${data.persons.length}`);

  // 14. Ручные изменения и фото после перезапуска.
  const somebody = data.persons[0];
  await s.put(`/api/persons/${somebody.id}`, { person: { biography: 'Проверочная запись', birth_precision: 'month', birth_date: '1938-03' } });
  const up = await s.form(`/api/persons/${somebody.id}/photos`, photoForm());
  await s.close({ keep: true });
  s = await startServer({ dataDir: dir });
  ({ data } = await s.get('/api/data'));
  const p2 = data.persons.find((p) => p.id === somebody.id);
  const photoFile = path.join(dir, 'photos', up.data.photo.id, up.data.photo.original_file);
  check(14, 'Ручные изменения и фотографии сохраняются после перезапуска', p2.biography === 'Проверочная запись' && p2.birth_date === '1938-03' && p2.primary_photo_id === up.data.photo.id && fs.existsSync(photoFile));

  // 15. Добавить человека, выбрать существующего родственника, исправить связь.
  const anchor = data.persons[1];
  const add = await s.post('/api/persons', { person: { given_name: 'Проверочный' }, relation: { type: 'child', personId: anchor.id } });
  ({ data } = await s.get('/api/data'));
  const rel = data.parentChild.find((r) => r.child_id === add.data.person.id);
  const delRel = await s.del(`/api/relations/parent-child/${rel.id}`);
  const fix = await s.post('/api/relations/partnerships', { person1Id: anchor.id, person2Id: add.data.person.id });
  check(15, 'Можно добавить человека, выбрать существующего родственника и исправить связь', add.status === 201 && delRel.status === 200 && fix.status === 201);

  // 16. Цикл предков.
  const cyc = await s.post('/api/relations/parent-child', { parentId: target.person_b, childId: target.person_a });
  const self = await s.post('/api/relations/parent-child', { parentId: target.person_a, childId: target.person_a });
  check(16, 'Цикл предков и связь с самим собой блокируются', cyc.status === 422 && self.status === 422, cyc.data.error);

  // 17. Резервная копия.
  const bk = await s.post('/api/backups');
  await s.del(`/api/photos/${up.data.photo.id}`);
  await s.del(`/api/persons/${anchor.id}`);
  const fd = new FormData();
  fd.append('name', bk.data.name);
  const prev = await s.form('/api/backups/restore-preview', fd);
  const rs = await s.post('/api/backups/restore', { token: prev.data.token });
  ({ data } = await s.get('/api/data'));
  check(17, 'Резервная копия восстанавливает данные и фотографии', rs.status === 200 && !!data.persons.find((p) => p.id === anchor.id) && fs.existsSync(photoFile) && data.persons.find((p) => p.id === somebody.id).birth_date === '1938-03',
    `копия ${bk.data.name}, ${Math.round(bk.data.size / 1024)} КБ`);

  console.log(`\nПодпись родства после одного подтверждения: «${kin}».`);
  if (showReport) {
    console.log('\n=== Сводка импорта ===');
    console.log(JSON.stringify({ ...commit.summary, createdPersonIds: undefined, checks: undefined }, null, 1));
    for (const c of pv.checks) console.log(' •', c.text);
    console.log('\n=== Вопросы для уточнения ===');
    for (const q of pv.questions) console.log(`[${q.family}] ${q.title}`);
    console.log('\n=== Проверка написания (необязательно) ===');
    for (const n of pv.nameReviews) console.log(' •', n.message);
  }
} finally {
  await s.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
console.log(`\nИтог: пройдено ${results.length - failed.length} из ${results.length}.`);
process.exit(failed.length ? 1 : 0);
