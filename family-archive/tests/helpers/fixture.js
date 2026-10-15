// Синтетическая книга Excel с ВЫМЫШЛЕННЫМИ именами. Повторяет особенности реального
// наброска: пространственная схема без заголовков, объединённые ячейки, границы
// (в том числе у пустых ячеек), конечные пробелы, пустая строка, скрытый лист.
import { zipSync, strToU8 } from 'fflate';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Стили границ: индекс в cellXfs = индекс границы.
const BORDERS = [
  {}, // 0 нет
  { left: 1, right: 1, top: 1, bottom: 1 }, // 1 со всех сторон
  { left: 1, top: 1 }, // 2
  { right: 1, top: 1 }, // 3
  { left: 1, bottom: 1 }, // 4
  { right: 1, bottom: 1 }, // 5
  { left: 1, right: 1, top: 1 }, // 6
  { left: 1, right: 1, bottom: 1 }, // 7
];

function stylesXml() {
  const side = (b, k) => (b[k] ? `<${k} style="thin"><color indexed="64"/></${k}>` : `<${k}/>`);
  const borders = BORDERS.map((b) => `<border>${side(b, 'left')}${side(b, 'right')}${side(b, 'top')}${side(b, 'bottom')}<diagonal/></border>`).join('');
  const xfs = BORDERS.map((_, i) => `<xf numFmtId="0" fontId="0" fillId="0" borderId="${i}" xfId="0"${i ? ' applyBorder="1"' : ''}/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="12"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="${BORDERS.length}">${borders}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${BORDERS.length}">${xfs}</cellXfs></styleSheet>`;
}

// sheets: [{ name, state, cells: { A1: { v, s, rich, inline, num } }, merges: ['B4:D4'] }]
export function buildXlsx(sheets, { mtime = '2020-01-01T00:00:00Z' } = {}) {
  const shared = [];
  const sharedIndex = (key, xml) => {
    let i = shared.findIndex((x) => x.key === key);
    if (i < 0) {
      shared.push({ key, xml });
      i = shared.length - 1;
    }
    return i;
  };
  const files = {};
  sheets.forEach((sh, idx) => {
    const byRow = new Map();
    for (const [ref, c] of Object.entries(sh.cells)) {
      const m = /^([A-Z]+)(\d+)$/.exec(ref);
      const row = Number(m[2]);
      if (!byRow.has(row)) byRow.set(row, []);
      byRow.get(row).push({ ref, col: m[1], c });
    }
    const colNum = (l) => [...l].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
    const rowsXml = [...byRow.keys()].sort((a, b) => a - b).map((r) => {
      const cells = byRow.get(r).sort((a, b) => colNum(a.col) - colNum(b.col)).map(({ ref, c }) => {
        const s = c.s ? ` s="${c.s}"` : '';
        if (c.num != null) return `<c r="${ref}"${s}><v>${c.num}</v></c>`;
        if (c.inline != null) return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(c.inline)}</t></is></c>`;
        if (c.rich) {
          const i = sharedIndex(`rich:${c.rich.join('|')}`, `<si>${c.rich.map((t) => `<r><t xml:space="preserve">${esc(t)}</t></r>`).join('')}</si>`);
          return `<c r="${ref}"${s} t="s"><v>${i}</v></c>`;
        }
        if (c.v != null) {
          const i = sharedIndex(`s:${c.v}`, `<si><t xml:space="preserve">${esc(c.v)}</t></si>`);
          return `<c r="${ref}"${s} t="s"><v>${i}</v></c>`;
        }
        return `<c r="${ref}"${s}/>`;
      }).join('');
      return `<row r="${r}">${cells}</row>`;
    }).join('');
    const merges = sh.merges?.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
    files[`xl/worksheets/sheet${idx + 1}.xml`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${sh.dimension || 'A1'}"/><sheetFormatPr baseColWidth="10" defaultRowHeight="16"/><cols><col min="1" max="8" width="26" customWidth="1"/></cols><sheetData>${rowsXml}</sheetData>${merges}</worksheet>`;
  });
  files['xl/sharedStrings.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared.map((x) => x.xml).join('')}</sst>`;
  files['xl/styles.xml'] = stylesXml();
  files['xl/workbook.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sh, i) => `<sheet name="${esc(sh.name)}" sheetId="${i + 1}"${sh.state && sh.state !== 'visible' ? ` state="${sh.state}"` : ''} r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
  files['xl/_rels/workbook.xml.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rIdT" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  files['_rels/.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  files['[Content_Types].xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`;
  const u8 = {};
  for (const [k, v] of Object.entries(files)) u8[k] = strToU8(v);
  // Фиксированное время внутри архива — одинаковое содержимое даёт одинаковую контрольную сумму.
  return Buffer.from(zipSync(u8, { mtime: new Date(mtime) }));
}

// Вымышленная семья, разложенная так же «пространственно», как исходный набросок.
export function fixtureSheets({ variant = 'base' } = {}) {
  const cells = {
    A1: { s: 1 }, // пустая ячейка с границами
    B1: { v: 'Петров Иван  ', s: 6 }, // два пробела в конце; рамка B1:B2
    D1: { v: 'Сидорова Анна Павловна ' },
    B2: { v: 'Петрова Мария ', s: 7 },
    D2: { v: 'Сидоров Павел ' },
    F2: { v: 'Орлов Олег ' },
    C3: { v: 'Петрова Ольга Павловна ', s: 2 },
    D3: { s: 3 },
    E3: { v: 'Сидоров Пётр Павлович' },
    F3: { v: 'Орлов Олег Олегович ', s: 2 },
    G3: { s: 3 },
    A4: { v: 'Петров Сергей Иванович ' },
    B4: { v: 'Петров Алексей Иванович ' },
    E4: { v: 'Сидорова Нина' },
    F4: { v: 'Орлова Вера', s: 4 },
    G4: { v: 'Зоя ', s: 5 },
    H1: { num: 42 }, // число — не запись
    H2: { v: '   ' }, // только пробелы — не запись
    B6: { v: 'Петров Илья Алексеевич' },
    C6: { rich: ['Петров ', 'Глеб Алексеевич '] }, // строка из нескольких фрагментов
    B7: { inline: 'Петрова Дарья Алексеевна ' }, // встроенная строка
    C7: { v: 'Лебедева Ирина Андреевна ' },
    D7: { v: 'Кравец Ева Марковна ' },
    C8: { v: 'Петров Лев Глебович' },
    D8: { v: 'Петров Ян Глебович ' },
    D9: { v: 'Генадий Тест Генадьевич ' },
  };
  const merges = ['C3:D3', 'F3:G3', 'B4:D4', 'C6:D6'];
  if (variant === 'changed') {
    cells.E4 = { v: 'Сидорова Нина Петровна' }; // изменён текст
    delete cells.D9; // запись исчезла
    cells.A9 = { v: 'Новикова Тамара ' }; // новая запись
  }
  return [
    { name: 'Лист1', cells, merges, dimension: 'A1:H9' },
    { name: 'Скрытый', state: 'hidden', cells: { A1: { v: 'Скрытая запись' } } },
  ];
}

export const fixtureXlsx = (opts = {}) => buildXlsx(fixtureSheets(opts), opts);
export const FIXTURE_RECORDS = 21;
