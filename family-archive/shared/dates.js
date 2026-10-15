// Даты с указанием точности. Используется и сервером, и интерфейсом.
//
// Дата хранится как строка частичного формата ISO без времени и часового пояса:
//   'YYYY-MM-DD' — полная дата, 'YYYY-MM' — месяц и год, 'YYYY' — только год.
// Точность (precision):
//   unknown — дата неизвестна (значения пустые);
//   exact   — полная дата;
//   month   — месяц и год;
//   year    — только год;
//   about   — приблизительно (год, месяц и год или полная дата);
//   range   — диапазон «между … и …» (две частичные даты).
// Неизвестные день и месяц никогда не подставляются (никакого «1 января»).

export const PRECISIONS = ['unknown', 'exact', 'month', 'year', 'about', 'range'];

export const PRECISION_LABELS = {
  unknown: 'Неизвестно',
  exact: 'Полная дата',
  month: 'Месяц и год',
  year: 'Только год',
  about: 'Приблизительно',
  range: 'Диапазон',
};

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

const RE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

export function daysInMonth(year, month) {
  return [31, (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

// Разбор частичной даты; возвращает {year, month, day, parts} или null.
export function parsePartial(s) {
  if (typeof s !== 'string') return null;
  const m = RE.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const month = m[2] ? Number(m[2]) : null;
  const day = m[3] ? Number(m[3]) : null;
  if (year < 1000 || year > 2200) return null;
  if (month != null && (month < 1 || month > 12)) return null;
  if (day != null && (day < 1 || day > daysInMonth(year, month))) return null;
  return { year, month, day, parts: day != null ? 3 : month != null ? 2 : 1 };
}

// Проверка значения даты; возвращает текст ошибки или null.
export function validateDateValue({ precision, date, dateEnd }, label = 'Дата') {
  if (!PRECISIONS.includes(precision)) return `${label}: неизвестный вид точности`;
  if (precision === 'unknown') {
    if (date || dateEnd) return `${label}: для неизвестной даты значения не заполняются`;
    return null;
  }
  const a = parsePartial(date);
  if (!a) return `${label}: укажите корректную дату`;
  if (precision === 'exact' && a.parts !== 3) return `${label}: для полной даты нужны день, месяц и год`;
  if (precision === 'month' && a.parts !== 2) return `${label}: укажите месяц и год`;
  if (precision === 'year' && a.parts !== 1) return `${label}: укажите только год`;
  if (precision === 'range') {
    const b = parsePartial(dateEnd);
    if (!b) return `${label}: укажите конец диапазона`;
    if (compareBounds(a, b) > 0) return `${label}: начало диапазона позже конца`;
  } else if (dateEnd) {
    return `${label}: конец диапазона указывается только для диапазона`;
  }
  return null;
}

function compareBounds(a, b) {
  const ka = a.year * 10000 + (a.month || 0) * 100 + (a.day || 0);
  const kb = b.year * 10000 + (b.month || 12) * 100 + (b.day || 31);
  return ka > kb ? 1 : 0;
}

// Границы даты в виде порядковых чисел YYYYMMDD — для сравнения и
// предупреждений (не для хранения). Возвращает {min, max} или null.
export function dateBounds({ precision, date, dateEnd }) {
  if (!precision || precision === 'unknown') return null;
  const a = parsePartial(date);
  if (!a) return null;
  const lo = (p) => p.year * 10000 + (p.month || 1) * 100 + (p.day || 1);
  const hi = (p) => p.year * 10000 + (p.month || 12) * 100 + (p.day || (p.month ? daysInMonth(p.year, p.month) : 31));
  if (precision === 'range') {
    const b = parsePartial(dateEnd);
    if (!b) return null;
    return { min: lo(a), max: hi(b) };
  }
  if (precision === 'about') {
    // «Около» — допускаем ±2 года.
    return { min: lo(a) - 20000, max: hi(a) + 20000 };
  }
  return { min: lo(a), max: hi(a) };
}

function fmtPartial(p, { genitive = true } = {}) {
  if (!p) return '';
  if (p.parts === 3) return `${p.day} ${MONTHS_GEN[p.month - 1]} ${p.year}`;
  if (p.parts === 2) return `${genitive ? MONTHS_NOM[p.month - 1] : MONTHS_NOM[p.month - 1]} ${p.year}`;
  return String(p.year);
}

// Человекочитаемое представление даты.
export function formatDate(value, { unknownText = 'Не указана' } = {}) {
  if (!value || !value.precision || value.precision === 'unknown') return unknownText;
  const a = parsePartial(value.date);
  if (!a) return unknownText;
  switch (value.precision) {
    case 'about':
      return `около ${fmtPartial(a)}`;
    case 'range': {
      const b = parsePartial(value.dateEnd);
      return b ? `между ${fmtPartial(a)} и ${fmtPartial(b)}` : fmtPartial(a);
    }
    default:
      return fmtPartial(a);
  }
}

// Короткая форма (год) для подписи в карточке древа.
export function shortYear(value) {
  if (!value || !value.precision || value.precision === 'unknown') return null;
  const a = parsePartial(value.date);
  if (!a) return null;
  if (value.precision === 'about') return `≈${a.year}`;
  if (value.precision === 'range') {
    const b = parsePartial(value.dateEnd);
    return b && b.year !== a.year ? `${a.year}–${b.year}` : String(a.year);
  }
  return String(a.year);
}

// Строка «годы жизни» без домысливания: отсутствие даты смерти не означает «жив».
export function lifeSpan(person) {
  const b = shortYear(birthOf(person));
  const d = shortYear(deathOf(person));
  if (b && d) return `${b} – ${d}`;
  if (b && person.life_status === 'deceased') return `${b} – ?`;
  if (b) return `род. ${b}`;
  if (d) return `ум. ${d}`;
  return null;
}

export const birthOf = (p) => ({ precision: p.birth_precision, date: p.birth_date, dateEnd: p.birth_date_end });
export const deathOf = (p) => ({ precision: p.death_precision, date: p.death_date, dateEnd: p.death_date_end });
