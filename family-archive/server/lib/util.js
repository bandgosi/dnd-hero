// Общие вспомогательные функции сервера.
import crypto from 'node:crypto';

export const newId = () => crypto.randomUUID();

// Метка времени в UTC (ISO 8601). Используется только для служебных полей
// created_at / updated_at; даты жизни людей хранятся отдельно, без времени.
export const nowIso = () => new Date().toISOString();

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// Ошибка, которую обработчик API превращает в понятный ответ.
export class ApiError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const badRequest = (msg, extra) => new ApiError(400, msg, extra);
export const notFound = (msg = 'Запись не найдена', extra) => new ApiError(404, msg, extra);
export const conflict = (msg, extra) => new ApiError(409, msg, extra);
export const unprocessable = (msg, extra) => new ApiError(422, msg, extra);

// Нормализация строки, введённой пользователем: обрезка по краям,
// пустая строка → null. Исходные строки Excel этой функцией НЕ обрабатываются.
export function cleanText(v, { max = 20000 } = {}) {
  if (v == null) return null;
  if (typeof v !== 'string') v = String(v);
  const t = v.trim();
  if (!t) return null;
  if (t.length > max) throw badRequest(`Слишком длинный текст (больше ${max} символов)`);
  return t;
}

export function oneOf(value, allowed, fallback, label) {
  if (value == null || value === '') return fallback;
  if (!allowed.includes(value)) throw badRequest(`Недопустимое значение поля «${label}»`);
  return value;
}

// Экранирование для CSV (разделитель «;», значения в кавычках при необходимости).
export function csvCell(v) {
  if (v == null) return '';
  let s = String(v);
  // Защита от формул при открытии в Excel: значение, начинающееся с = + - @, экранируется апострофом.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[";\n\r]/.test(s) || /^\s|\s$/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
