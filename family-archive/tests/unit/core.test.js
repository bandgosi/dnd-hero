// Модульные тесты: чтение xlsx, разбор имён, даты, построение предположений.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWorkbook, decodeXml } from '../../server/xlsx/reader.js';
import { analyzeWorkbook } from '../../server/import/analyze.js';
import { parseFullName, patronymicMatchesName, searchKey, doubleLetterSuggestion, surnameStem } from '../../shared/names.js';
import { validateDateValue, formatDate, dateBounds, lifeSpan } from '../../shared/dates.js';
import { sniffImage } from '../../server/services/photos.js';
import { fixtureXlsx, FIXTURE_RECORDS, buildXlsx } from '../helpers/fixture.js';
import { makePng } from '../helpers/harness.js';

test('xlsx: листы, видимость, объединения, точные исходные строки', () => {
  const wb = readWorkbook(fixtureXlsx());
  assert.equal(wb.sheets.length, 2);
  assert.deepEqual(wb.sheets.map((s) => s.state), ['visible', 'hidden']);
  const s = wb.sheets[0];
  assert.equal(s.merges.length, 4);
  const cell = (ref) => s.cells.find((c) => c.ref === ref);
  assert.equal(cell('B1').value, 'Петров Иван  ', 'два конечных пробела сохраняются');
  assert.equal(cell('C6').value, 'Петров Глеб Алексеевич ', 'фрагменты форматированной строки объединяются');
  assert.equal(cell('B7').value, 'Петрова Дарья Алексеевна ', 'встроенная строка читается');
  assert.equal(cell('H1').type, 'number');
  assert.ok(cell('A1').border.top && cell('A1').border.left, 'границы пустой ячейки прочитаны');
});

test('xlsx: сущности XML декодируются один раз', () => {
  assert.equal(decodeXml('A &amp;amp; B &#1041; &#x41a;'), 'A &amp; B Б К');
  const wb = readWorkbook(buildXlsx([{ name: 'Л & Д', cells: { A1: { v: 'Иван & Ко <тест>' } } }]));
  assert.equal(wb.sheets[0].name, 'Л & Д');
  assert.equal(wb.sheets[0].cells[0].value, 'Иван & Ко <тест>');
});

test('xlsx: не книга Excel — понятная ошибка', () => {
  assert.throws(() => readWorkbook(Buffer.from('not a zip')), /не похож на книгу Excel/);
});

test('анализ: записи, объединения читаются один раз, скрытый лист пропущен', () => {
  const a = analyzeWorkbook(readWorkbook(fixtureXlsx()));
  assert.equal(a.records.length, FIXTURE_RECORDS);
  assert.equal(new Set(a.records.map((r) => r.key)).size, a.records.length);
  assert.ok(!a.records.some((r) => ['D3', 'G3', 'C4', 'D4', 'D6'].includes(r.cell)), 'нет записей из неосновных ячеек объединений');
  assert.equal(a.records.find((r) => r.cell === 'B4').mergedRange, 'B4:D4');
  assert.ok(!a.records.some((r) => r.sheet === 'Скрытый'));
  const withHidden = analyzeWorkbook(readWorkbook(fixtureXlsx()), { includeHidden: true });
  assert.equal(withHidden.records.length, FIXTURE_RECORDS + 1);
  assert.deepEqual(a.skipped.map((x) => x.cell).sort(), ['H1', 'H2']);
  assert.ok(a.geometry['Лист1'].borderedCells.some((c) => c.ref === 'A1' && c.empty));
  assert.deepEqual(a.geometry['Лист1'].emptyRows, [5]);
});

test('анализ: отображаемое имя без пробелов по краям, без исправлений; одно слово — без фамилии', () => {
  const a = analyzeWorkbook(readWorkbook(fixtureXlsx()));
  for (const r of a.records) assert.equal(r.text, r.raw.trim());
  const zoya = a.records.find((r) => r.cell === 'G4');
  assert.equal(zoya.parse.given_name, 'Зоя');
  assert.equal(zoya.parse.surname, null);
  assert.equal(zoya.parse.patronymic, null);
  const g = a.records.find((r) => r.cell === 'D9');
  assert.equal(g.text, 'Генадий Тест Генадьевич', 'написание «Генадий» не исправляется');
});

test('анализ: только предположения, без фактов; братья и сёстры не становятся поколениями', () => {
  const a = analyzeWorkbook(readWorkbook(fixtureXlsx()));
  const L = new Map(a.records.map((r) => [r.key, r.cell]));
  const hyps = a.suggestions.hypotheses.map((h) => ({ ...h, a: L.get(h.a), b: L.get(h.b) }));
  assert.ok(hyps.every((h) => h.basis.length > 0), 'у каждого предположения есть основание');
  // Записи одна под другой с общим отчеством не связываются как родитель — ребёнок.
  assert.ok(!hyps.some((h) => h.type === 'parent_child' && h.a === 'B6' && h.b === 'B7'));
  // Возможные вторые родители предлагаются всем детям одинаково (не по столбцам).
  for (const q of ['C7', 'D7']) for (const c of ['C8', 'D8']) assert.ok(hyps.some((h) => h.type === 'parent_child' && h.a === q && h.b === c), `${q} → ${c}`);
  // Совпадение фамилии и имени — вопрос, а не слияние.
  assert.ok(hyps.some((h) => h.type === 'same_person' && h.a === 'F2' && h.b === 'F3'));
  // Пара предполагается только для записей вплотную одна под другой.
  assert.ok(hyps.some((h) => h.type === 'partnership' && h.a === 'B1' && h.b === 'B2'));
  assert.ok(!hyps.some((h) => h.type === 'partnership' && [h.a, h.b].includes('C8')));
});

test('имена: черновой разбор, отчества, поиск по вариантам', () => {
  assert.deepEqual(
    [parseFullName('Петров Анна Олеговна').surname, parseFullName('Петров Анна Олеговна').patronymic],
    ['Петров', 'Олеговна'],
  );
  assert.equal(parseFullName('Зоя').surname, null);
  assert.equal(parseFullName('Иван Петрович').surname, null);
  assert.ok(patronymicMatchesName('Генадьевич', 'Генадий'));
  assert.ok(patronymicMatchesName('Михайлович', 'Михаил'));
  assert.ok(patronymicMatchesName('Кахеевич', 'Кахе'));
  assert.ok(patronymicMatchesName('Кахевна', 'Кахе'));
  assert.ok(patronymicMatchesName('Зурабовна', 'Зураб'));
  assert.ok(!patronymicMatchesName('Зурабович', 'Леван'));
  assert.equal(searchKey('Геннадий'), searchKey('Генадий'));
  assert.equal(searchKey('Пётр'), searchKey('Петр'));
  assert.equal(doubleLetterSuggestion('Генадий'), 'Геннадий');
  assert.equal(doubleLetterSuggestion('Ирина'), null);
  assert.equal(surnameStem('Петрова'), surnameStem('Петров'));
});

test('даты: точность, без подстановки дня и месяца, без сдвига часового пояса', () => {
  assert.equal(validateDateValue({ precision: 'year', date: '1950' }), null);
  assert.match(validateDateValue({ precision: 'exact', date: '1950' }), /день, месяц и год/);
  assert.match(validateDateValue({ precision: 'exact', date: '1950-02-30' }), /корректную/);
  assert.equal(validateDateValue({ precision: 'exact', date: '1952-02-29' }), null);
  assert.equal(validateDateValue({ precision: 'range', date: '1948', dateEnd: '1950-05' }), null);
  assert.match(validateDateValue({ precision: 'range', date: '1951', dateEnd: '1950' }), /позже/);
  assert.equal(formatDate({ precision: 'year', date: '1950' }), '1950');
  assert.equal(formatDate({ precision: 'month', date: '1950-03' }), 'март 1950');
  assert.equal(formatDate({ precision: 'exact', date: '1950-01-01' }), '1 января 1950');
  assert.equal(formatDate({ precision: 'about', date: '1950' }), 'около 1950');
  assert.equal(formatDate({ precision: 'unknown' }), 'Не указана');
  assert.deepEqual(dateBounds({ precision: 'year', date: '1950' }), { min: 19500101, max: 19501231 });
  // Отсутствие даты смерти не означает «жив».
  assert.equal(lifeSpan({ birth_precision: 'year', birth_date: '1950', death_precision: 'unknown', life_status: 'unknown' }), 'род. 1950');
});

test('фото: распознавание формата по содержимому', () => {
  const png = sniffImage(makePng(7, 5));
  assert.deepEqual([png.mime, png.width, png.height], ['image/png', 7, 5]);
  assert.equal(sniffImage(Buffer.from('GIF89a\x02\x00\x03\x00\x00\x00\x00\x00', 'latin1')).width, 2);
  assert.equal(sniffImage(Buffer.from('hello world, not an image')), null);
  const heic = Buffer.alloc(16);
  heic.write('ftypheic', 4, 'ascii');
  assert.equal(sniffImage(heic).unsupported, true);
});
