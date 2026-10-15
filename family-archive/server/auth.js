// Защита доступа.
// * По умолчанию сервер слушает только 127.0.0.1 — данные недоступны из сети.
// * Если задан APP_PASSWORD, для API и фотографий нужен вход (cookie-сессия).
// * Запуск на внешнем адресе без пароля запрещён (см. server/index.js).
// * Изменяющие запросы требуют служебный заголовок — защита от подделки запросов
//   со сторонних сайтов; заголовок Host проверяется против подмены DNS.
import crypto from 'node:crypto';
import { nowIso } from './lib/util.js';

const COOKIE = 'fa_session';
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function createAuth(db, config) {
  const enabled = !!config.password;
  const pwdKey = crypto.scryptSync(config.password || '-', 'family-archive', 32);
  const attempts = new Map();

  const hostAllowed = (req) => {
    const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    if (['localhost', '127.0.0.1', '::1'].includes(host)) return true;
    if (config.allowedHosts.includes(host)) return true;
    if (!config.loopback && config.allowedHosts.length === 0) return true;
    return false;
  };

  function guard(req, res, next) {
    if (!hostAllowed(req)) return res.status(421).json({ error: 'Недопустимый адрес сервера. Добавьте его в ALLOWED_HOSTS.' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.path.startsWith('/api/')) {
      if (req.headers['x-requested-with'] !== 'family-archive') return res.status(403).json({ error: 'Запрос отклонён: нет служебного заголовка' });
      const origin = req.headers.origin;
      if (origin) {
        try {
          if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Запрос с другого сайта отклонён' });
        } catch {
          return res.status(403).json({ error: 'Запрос отклонён' });
        }
      }
    }
    next();
  }

  function isLoggedIn(req) {
    if (!enabled) return true;
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return false;
    const row = db.get('SELECT * FROM sessions WHERE token_hash = ?', hash(token));
    if (!row) return false;
    if (row.expires_at < nowIso()) {
      db.run('DELETE FROM sessions WHERE token_hash = ?', row.token_hash);
      return false;
    }
    return true;
  }

  function requireAuth(req, res, next) {
    if (isLoggedIn(req)) return next();
    res.status(401).json({ error: 'Требуется вход', authRequired: true });
  }

  function cookieFlags(req) {
    const secure = config.cookieSecure || req.secure;
    return `Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
  }

  function login(req, res) {
    if (!enabled) return res.json({ ok: true });
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const a = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
    if (a.length >= 10) return res.status(429).json({ error: 'Слишком много попыток. Попробуйте через 15 минут.' });
    const given = crypto.scryptSync(String(req.body?.password || ''), 'family-archive', 32);
    if (!crypto.timingSafeEqual(given, pwdKey)) {
      a.push(now);
      attempts.set(ip, a);
      return res.status(401).json({ error: 'Неверный пароль' });
    }
    attempts.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(now + config.sessionDays * 86400000).toISOString();
    db.run('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)', hash(token), nowIso(), expires);
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; ${cookieFlags(req)}; Max-Age=${config.sessionDays * 86400}`);
    res.json({ ok: true });
  }

  function logout(req, res) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', hash(token));
    res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieFlags(req)}; Max-Age=0`);
    res.json({ ok: true });
  }

  function status(req, res) {
    res.json({ authEnabled: enabled, loggedIn: isLoggedIn(req) });
  }

  return { guard, requireAuth, login, logout, status, enabled };
}
