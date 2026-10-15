// Форматирование для интерфейса.
import { formatDate, lifeSpan, birthOf, deathOf, PRECISION_LABELS } from '../../../shared/dates.js';
import { initials, searchKey } from '../../../shared/names.js';

export { formatDate, lifeSpan, birthOf, deathOf, PRECISION_LABELS, initials, searchKey };

export const SEX_LABELS = { male: 'Мужской', female: 'Женский', other: 'Другое' };
export const LIFE_LABELS = { unknown: 'Неизвестно', alive: 'Жив(а)', deceased: 'Умер(ла)' };
export const PARENT_KIND_LABELS = {
  unknown: 'Тип не указан',
  biological: 'Биологический',
  adoptive: 'Усыновление',
  foster: 'Приёмная семья',
  step: 'Отчим / мачеха',
  guardian: 'Опекун',
  other: 'Другое',
};
export const PARTNER_KIND_LABELS = {
  unknown: 'Вид не указан',
  marriage: 'Брак',
  civil: 'Гражданский союз',
  partners: 'Пара без брака',
  engagement: 'Помолвка',
  other: 'Другое',
};
export const PARTNER_STATUS_LABELS = {
  unknown: 'Статус не указан',
  ongoing: 'Вместе',
  divorced: 'Развод',
  separated: 'Расставание',
  widowed: 'Вдовство',
  ended: 'Завершено',
};
export const SOURCE_KIND_LABELS = {
  document: 'Документ',
  oral: 'Рассказ родственника',
  photo: 'Фотография',
  archive: 'Архив',
  web: 'Интернет',
  excel: 'Таблица Excel',
  other: 'Другое',
};
export const HYP_STATUS_LABELS = { open: 'Не решено', confirmed: 'Подтверждено', rejected: 'Отклонено', deferred: 'Отложено' };
export const Q_STATUS_LABELS = { open: 'Открыт', deferred: 'Отложен', resolved: 'Решён' };

export function splitName(person) {
  const d = person.display_name || '';
  if (person.surname && d.startsWith(person.surname + ' ')) return [person.surname, d.slice(person.surname.length + 1)];
  return [d, ''];
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export const countText = (n, one, few, many) => `${n} ${plural(n, one, few, many)}`;

// Видимые пробелы в исходной строке: «Зоя␣».
export function showSpaces(raw) {
  if (raw == null) return '';
  return raw.replace(/ +$/g, (m) => '␣'.repeat(m.length)).replace(/^ +/g, (m) => '␣'.repeat(m.length));
}

export function personSearchText(person, records = []) {
  return searchKey([person.display_name, person.surname, person.given_name, person.patronymic, person.birth_surname, ...(person.other_names || []), ...records.map((r) => r.raw_text), ...records.map((r) => r.cell)].filter(Boolean).join(' '));
}

export function matchesQuery(text, query) {
  const q = searchKey(query);
  if (!q) return true;
  return q.split(' ').every((part) => text.includes(part));
}

export function recordLabel(r) {
  return `${r.sheet_name}!${r.cell}`;
}
