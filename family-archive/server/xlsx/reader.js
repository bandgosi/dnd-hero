// Чтение .xlsx (Office Open XML) без внешних сервисов.
// Возвращает листы с их видимостью, значения ячеек с точным исходным текстом
// (включая конечные пробелы), объединённые диапазоны, границы ячеек
// (в том числе у пустых ячеек), ширины столбцов, высоты строк и сведения
// о формулах, комментариях, таблицах и рисунках.
import { safeUnzipSync, ZipLimitError } from '../lib/zip.js';
import { XMLParser } from 'fast-xml-parser';
import path from 'node:path';

const ARRAY_TAGS = new Set([
  'sheet', 'si', 'r', 'row', 'c', 'mergeCell', 'col', 'xf', 'border', 'Relationship',
  'Override', 'Default', 'cxnSp', 'sp', 'pic', 'twoCellAnchor', 'oneCellAnchor', 'absoluteAnchor', 'grpSp',
  'comment', 'rPh',
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: false,
  cdataPropName: '__cdata',
  ignorePiTags: true,
  isArray: (name) => ARRAY_TAGS.has(name),
});

export class XlsxError extends Error {}

// Декодирование XML-сущностей за один проход (без двойного декодирования).
export function decodeXml(s) {
  if (s == null) return s;
  return String(s).replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (m, e) => {
    switch (e) {
      case 'lt': return '<';
      case 'gt': return '>';
      case 'amp': return '&';
      case 'quot': return '"';
      case 'apos': return "'";
      default: {
        const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        try {
          return String.fromCodePoint(code);
        } catch {
          return m;
        }
      }
    }
  });
}

// Экранирование OOXML вида _x000D_ внутри строк.
function decodeOoxmlEscapes(s) {
  return s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

// Текст узла <t> с учётом CDATA и сущностей.
function textOf(node) {
  if (node == null) return '';
  if (typeof node === 'string') return decodeOoxmlEscapes(decodeXml(node));
  if (typeof node === 'object') {
    let out = '';
    if (node.__cdata != null) out += asArray(node.__cdata).join('');
    if (node['#text'] != null) out += decodeOoxmlEscapes(decodeXml(node['#text']));
    return out;
  }
  return String(node);
}

// Строка из <si>/<is>: простой <t> или набор фрагментов <r><t>…</t></r>.
// Фонетические подсказки <rPh> не входят в значение.
function richText(si) {
  if (si == null) return '';
  let out = '';
  for (const t of asArray(si.t)) out += textOf(t);
  for (const r of asArray(si.r)) for (const t of asArray(r.t)) out += textOf(t);
  return out;
}

export function colToIndex(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function indexToCol(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Пределы Excel: столбцы A…XFD, строки 1…1 048 576.
export const MAX_COL = 16384;
export const MAX_ROW = 1048576;
// Пределы книги: крошечный файл может объявить гигантские диапазоны, и разбор исчерпал бы память.
const MAX_SHEETS = 200;
// Разбор XML строит объект на каждый элемент: ~1,6 КБ памяти на ячейку, поэтому пределы скромные
// (семейной таблице с запасом хватает и тысячи ячеек).
const MAX_CELLS = 30000;
const MAX_XML_NODES = 150000;
const MAX_XML_ATTRIBUTES = 200000;
const MAX_MERGES = 50000;
const MAX_MERGED_AREA = 200000;

export function parseRef(ref) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(ref);
  if (!m) return null;
  const col = colToIndex(m[1]);
  const row = Number(m[2]);
  if (col < 1 || col > MAX_COL || row < 1 || row > MAX_ROW) return null;
  return { col, row };
}

export function parseRange(ref) {
  const [a, b] = String(ref).split(':');
  const p = parseRef(a);
  const q = parseRef(b || a);
  if (!p || !q) return null;
  return {
    ref: `${indexToCol(Math.min(p.col, q.col))}${Math.min(p.row, q.row)}:${indexToCol(Math.max(p.col, q.col))}${Math.max(p.row, q.row)}`,
    top: Math.min(p.row, q.row),
    left: Math.min(p.col, q.col),
    bottom: Math.max(p.row, q.row),
    right: Math.max(p.col, q.col),
  };
}

export const cellRef = (row, col) => `${indexToCol(col)}${row}`;

function resolveTarget(baseDir, target) {
  if (!target) return null;
  if (target.startsWith('/')) return target.slice(1);
  return path.posix.normalize(path.posix.join(baseDir, target));
}

function readRels(files, relsPath) {
  const xml = files[relsPath];
  if (!xml) return [];
  const doc = parser.parse(xml);
  return asArray(doc?.Relationships?.Relationship).map((r) => ({
    id: r.Id,
    type: r.Type || '',
    target: decodeXml(r.Target),
    external: r.TargetMode === 'External',
  }));
}

function parseBorders(stylesDoc) {
  const borders = asArray(stylesDoc?.styleSheet?.borders?.border).map((b) => {
    const side = (k) => {
      const node = b?.[k];
      if (node == null || node === '') return null;
      const style = typeof node === 'object' ? node.style : null;
      return style && style !== 'none' ? style : null;
    };
    return { left: side('left'), right: side('right'), top: side('top'), bottom: side('bottom') };
  });
  const xfs = asArray(stylesDoc?.styleSheet?.cellXfs?.xf).map((xf) => ({
    borderId: xf.borderId != null ? Number(xf.borderId) : 0,
    horizontal: xf.alignment && typeof xf.alignment === 'object' ? xf.alignment.horizontal || null : null,
  }));
  return { borders, xfs };
}

function analyseDrawing(files, drawingPath) {
  const xml = files[drawingPath];
  const res = { anchors: 0, connectors: 0, shapes: 0, pictures: 0 };
  if (!xml) return res;
  const doc = parser.parse(xml);
  const root = doc?.wsDr || {};
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    res.connectors += asArray(node.cxnSp).length;
    res.shapes += asArray(node.sp).length;
    res.pictures += asArray(node.pic).length;
    for (const g of asArray(node.grpSp)) walk(g);
  };
  for (const k of ['twoCellAnchor', 'oneCellAnchor', 'absoluteAnchor']) {
    for (const a of asArray(root[k])) {
      res.anchors += 1;
      walk(a);
    }
  }
  return res;
}

// Основная функция чтения книги.
export function readWorkbook(buffer, { maxEntryBytes = 8 * 1024 * 1024, maxTotalBytes = 24 * 1024 * 1024, maxEntries = 5000 } = {}) {
  let raw;
  let names;
  try {
    // Распаковываются только XML-части; картинки и прочее внутри книги не читаются.
    ({ files: raw, names } = safeUnzipSync(buffer, { want: (n) => /\.(xml|rels)$/i.test(n), maxEntryBytes, maxTotalBytes, maxEntries }));
  } catch (e) {
    if (e instanceof ZipLimitError) throw new XlsxError(e.message);
    throw new XlsxError('Файл не похож на книгу Excel (.xlsx): не удалось распаковать архив');
  }
  if (!names.length) throw new XlsxError('Файл не похож на книгу Excel (.xlsx): не удалось распаковать архив');
  // Быстрый подсчёт до разбора: каждый узел XML (элемент, инструкция, CDATA, комментарий) и каждое
  // слово внутри тега (атрибут — в любой записи, даже без значения) становятся объектами в памяти,
  // поэтому строятся они только для книги разумного размера.
  let nodes = 0;
  let attributes = 0;
  for (const data of Object.values(raw)) {
    let inTag = false;
    let quote = 0;
    let space = false;
    for (let i = 0; i < data.length; i++) {
      const b = data[i];
      if (!inTag) {
        if (b === 60) {
          inTag = true;
          quote = 0;
          space = false;
          if (data[i + 1] !== 47) nodes++; // всё, кроме </
        }
        continue;
      }
      if (quote) {
        if (b === quote) quote = 0;
        continue;
      }
      if (b === 34 || b === 39) quote = b;
      else if (b === 62) inTag = false;
      else {
        const sp = b === 32 || b === 9 || b === 10 || b === 13;
        if (space && !sp) attributes++;
        space = sp;
      }
    }
    if (nodes > MAX_XML_NODES || attributes > MAX_XML_ATTRIBUTES) {
      throw new XlsxError('Файл слишком большой или сложный для импорта. Удалите лишнее оформление или разбейте книгу.');
    }
  }
  const dec = new TextDecoder('utf-8');
  const files = {};
  for (const [name, data] of Object.entries(raw)) {
    if (/\.(xml|rels)$/i.test(name)) files[name] = dec.decode(data);
  }
  const rootRels = readRels(files, '_rels/.rels');
  const officeDoc = rootRels.find((r) => r.type.endsWith('/officeDocument'));
  const workbookPath = officeDoc ? resolveTarget('', officeDoc.target) : 'xl/workbook.xml';
  if (!files[workbookPath]) {
    if (names.includes('xl/workbook.bin')) throw new XlsxError('Формат .xlsb не поддерживается — сохраните файл как .xlsx');
    throw new XlsxError('В файле не найдена книга Excel (workbook.xml)');
  }
  const wbDir = path.posix.dirname(workbookPath);
  const wbRels = readRels(files, `${wbDir}/_rels/${path.posix.basename(workbookPath)}.rels`);
  const wbDoc = parser.parse(files[workbookPath]);

  let sharedStrings = [];
  const ssRel = wbRels.find((r) => r.type.endsWith('/sharedStrings'));
  const ssPath = ssRel ? resolveTarget(wbDir, ssRel.target) : null;
  if (ssPath && files[ssPath]) {
    const ssDoc = parser.parse(files[ssPath]);
    sharedStrings = asArray(ssDoc?.sst?.si).map(richText);
  }

  let styles = { borders: [], xfs: [] };
  const stRel = wbRels.find((r) => r.type.endsWith('/styles'));
  const stPath = stRel ? resolveTarget(wbDir, stRel.target) : null;
  if (stPath && files[stPath]) styles = parseBorders(parser.parse(files[stPath]));

  const sheetsMeta = asArray(wbDoc?.workbook?.sheets?.sheet);
  if (sheetsMeta.length > MAX_SHEETS) throw new XlsxError(`В книге слишком много листов (${sheetsMeta.length}, допустимо до ${MAX_SHEETS})`);
  let cellCount = 0;
  let mergedArea = 0;
  const sheets = sheetsMeta.map((s, index) => {
    const rel = wbRels.find((r) => r.id === s.id);
    const sheetPath = rel ? resolveTarget(wbDir, rel.target) : null;
    const name = decodeXml(s.name);
    const state = s.state === 'hidden' || s.state === 'veryHidden' ? s.state : 'visible';
    const base = {
      name,
      index,
      state,
      kind: rel?.type?.endsWith('/worksheet') ? 'worksheet' : rel?.type?.endsWith('/chartsheet') ? 'chartsheet' : 'other',
      declaredDimension: null,
      cells: [],
      merges: [],
      columns: [],
      rows: [],
      defaultColWidth: 8.43,
      defaultRowHeight: 15,
      formulas: 0,
      comments: 0,
      tables: 0,
      drawing: { anchors: 0, connectors: 0, shapes: 0, pictures: 0 },
    };
    if (!sheetPath || !files[sheetPath] || base.kind !== 'worksheet') return base;
    const doc = parser.parse(files[sheetPath]);
    const ws = doc?.worksheet || {};
    base.declaredDimension = ws.dimension?.ref || null;
    const fmt = ws.sheetFormatPr || {};
    if (fmt.defaultColWidth) base.defaultColWidth = Number(fmt.defaultColWidth);
    else if (fmt.baseColWidth) base.defaultColWidth = Number(fmt.baseColWidth) + 0.83;
    if (fmt.defaultRowHeight) base.defaultRowHeight = Number(fmt.defaultRowHeight);
    // Ширины столбцов хранятся диапазонами (min…max), без разворачивания по одному столбцу.
    for (const c of asArray(ws.cols?.col)) {
      const min = Number(c.min);
      const max = Number(c.max);
      if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || min > max || max > MAX_COL) continue;
      if (base.columns.length >= MAX_COL) break;
      base.columns.push({ min, max, width: c.width != null ? Number(c.width) : null, hidden: c.hidden === '1' || c.hidden === 'true', custom: c.customWidth === '1' });
    }
    const tooManyCells = () => new XlsxError(`В книге слишком много строк и ячеек (больше ${MAX_CELLS.toLocaleString('ru-RU')}). Удалите лишнее оформление или разбейте книгу.`);
    const badRef = (ref) => new XlsxError(`Файл повреждён: недопустимый адрес ячейки на листе «${name}»${ref ? ` (${String(ref).slice(0, 20)})` : ''}`);
    let rowCursor = 0;
    for (const row of asArray(ws.sheetData?.row)) {
      const r = row.r != null ? Number(row.r) : rowCursor + 1;
      if (!Number.isInteger(r) || r < 1 || r > MAX_ROW) throw badRef(row.r);
      if (++cellCount > MAX_CELLS) throw tooManyCells();
      rowCursor = r;
      if (row.ht != null || row.hidden) base.rows.push({ index: r, height: row.ht != null ? Number(row.ht) : null, hidden: row.hidden === '1' || row.hidden === 'true' });
      let colCursor = 0;
      for (const c of asArray(row.c)) {
        const pos = c.r ? parseRef(c.r) : { row: r, col: colCursor + 1 };
        if (!pos || pos.col > MAX_COL) throw badRef(c.r);
        if (++cellCount > MAX_CELLS) throw tooManyCells();
        colCursor = pos.col;
        const styleIndex = c.s != null ? Number(c.s) : 0;
        const xf = styles.xfs[styleIndex] || { borderId: 0 };
        const b = styles.borders[xf.borderId] || {};
        const border = { top: b.top || null, right: b.right || null, bottom: b.bottom || null, left: b.left || null };
        const hasFormula = c.f != null;
        if (hasFormula) base.formulas += 1;
        let type = c.t || 'n';
        let value = null;
        const v = c.v != null ? textOf(c.v) : null;
        if (type === 's') {
          const idx = v != null ? Number(v) : NaN;
          value = Number.isInteger(idx) && sharedStrings[idx] != null ? sharedStrings[idx] : null;
          type = 'string';
        } else if (type === 'inlineStr') {
          value = richText(c.is);
          type = 'string';
        } else if (type === 'str') {
          value = v;
          type = 'string';
        } else if (type === 'b') {
          value = v;
          type = 'boolean';
        } else if (type === 'e') {
          value = v;
          type = 'error';
        } else if (type === 'd') {
          value = v;
          type = 'date';
        } else {
          value = v;
          type = v == null ? 'empty' : 'number';
        }
        base.cells.push({
          ref: cellRef(pos.row, pos.col),
          row: pos.row,
          col: pos.col,
          type,
          value,
          formula: hasFormula,
          styleIndex,
          horizontal: xf.horizontal || null,
          border,
        });
      }
    }
    const mergeList = asArray(ws.mergeCells?.mergeCell);
    if (mergeList.length > MAX_MERGES) throw new XlsxError(`На листе «${name}» слишком много объединённых ячеек`);
    for (const m of mergeList) {
      const rg = parseRange(m.ref);
      if (!rg) throw new XlsxError(`Файл повреждён: недопустимый объединённый диапазон на листе «${name}» (${String(m.ref).slice(0, 30)})`);
      mergedArea += (rg.bottom - rg.top + 1) * (rg.right - rg.left + 1);
      if (mergedArea > MAX_MERGED_AREA) throw new XlsxError('Объединённые диапазоны в книге слишком большие (больше 200 000 ячеек)');
      base.merges.push(rg);
    }
    // Связанные части листа: рисунки, комментарии, таблицы.
    const sheetRels = readRels(files, `${path.posix.dirname(sheetPath)}/_rels/${path.posix.basename(sheetPath)}.rels`);
    for (const rr of sheetRels) {
      const target = resolveTarget(path.posix.dirname(sheetPath), rr.target);
      if (rr.type.endsWith('/drawing')) {
        const d = analyseDrawing(files, target);
        for (const k of Object.keys(d)) base.drawing[k] += d[k];
      } else if (rr.type.endsWith('/comments')) {
        const cdoc = files[target] ? parser.parse(files[target]) : null;
        base.comments += asArray(cdoc?.comments?.commentList?.comment).length;
      } else if (rr.type.endsWith('/threadedComment')) {
        base.comments += 1;
      } else if (rr.type.endsWith('/table')) {
        base.tables += 1;
      }
    }
    return base;
  });

  return {
    sheets,
    parts: names.sort(),
  };
}

// Наличие хотя бы одной границы.
export const hasBorder = (b) => !!(b && (b.top || b.right || b.bottom || b.left));
