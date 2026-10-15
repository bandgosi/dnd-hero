// Защита доступа.
// * По умолчанию сервер слушает только 127.0.0.1 — данные недоступны из сети.
// * Если задан пароль (APP_PASSWORD_HASH или APP_PASSWORD), для API и фотографий нужен вход.
// * Запуск с доступом из сети без пароля и без ALLOWED_HOSTS запрещён (config.configProblems).
// * Изменяющие запросы требуют служебный заголовок и совпадение Origin — защита от подделки
//   запросов со сторонних сайтов; заголовок Host проверяется против подмены DNS.
// * Пароль проверяется медленной функцией scrypt; попытки входа ограничены.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { nowIso } from './lib/util.js';

const scrypt = promisify(crypto.scrypt);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];
const SCRYPT = { N: 32768, r: 8, p: 1 };
const maxmem = (p) => 128 * p.N * p.r * 2;

const b64 = (buf) => Buffer.from(buf).toString('base64url');

// Формат хэша: scrypt:N:r:p:соль:ключ (base64url) — без символов, которые раскрываются оболочками.
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password).normalize('NFC'), salt, 32, { ...SCRYPT, maxmem: maxmem(SCRYPT) });
  return `scrypt:${SCRYPT.N}:${SCRYPT.r}:${SCRYPT.p}:${b64(salt)}:${b64(key)}`;
}

function parseHash(str) {
  const [alg, N, r, p, salt, key] = String(str).split(':');
  if (alg !== 'scrypt') throw new Error('Неверный формат хэша пароля');
  const params = { N: Number(N), r: Number(r), p: Number(p) };
  return { params, salt: Buffer.from(salt, 'base64url'), key: Buffer.from(key, 'base64url') };
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        /* испорченное значение cookie пропускается */
      }
    }
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createAuth(db, config) {
  const enabled = !!(config.passwordHash || config.password);
  const cookieName = config.cookieSecure ? '__Host-fa_session' : 'fa_session';
  let stored = null;
  let fingerprint = null;
  if (config.passwordHash) {
    stored = parseHash(config.passwordHash);
    fingerprint = sha256(`hash:${config.passwordHash}`);
  } else if (config.password) {
    const salt = crypto.randomBytes(16);
    stored = { params: SCRYPT, salt, key: crypto.scryptSync(config.password.normalize('NFC'), salt, 32, { ...SCRYPT, maxmem: maxmem(SCRYPT) }) };
    // Отпечаток для сброса сеансов при смене пароля — тоже через медленную функцию.
    fingerprint = crypto.scryptSync(config.password.normalize('NFC'), 'family-archive-fingerprint', 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
  }
  // Пароль изменился — все прежние входы недействительны.
  if (enabled) {
    const prev = db.get("SELECT value FROM meta WHERE key = 'auth_fp'")?.value;
    if (prev !== fingerprint) {
      db.run('DELETE FROM sessions');
      db.run("INSERT INTO meta (key, value) VALUES ('auth_fp', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", fingerprint);
    }
  }
  db.run('DELETE FROM sessions WHERE expires_at < ?', nowIso());

  const perIp = new Map();
  let globalFails = [];
  const WINDOW = 15 * 60 * 1000;

  const hostOf = (req) => {
    const raw = String(req.headers.host || '').toLowerCase();
    if (raw.startsWith('[')) return raw.slice(1, raw.indexOf(']') > 0 ? raw.indexOf(']') : undefined);
    return raw.replace(/:\d+$/, '');
  };
  const hostAllowed = (req) => {
    const host = hostOf(req);
    return LOCAL_HOSTS.includes(host) || config.allowedHosts.includes(host);
  };

  function guard(req, res, next) {
    if (!hostAllowed(req)) return res.status(421).type('text/plain; charset=utf-8').send('Недопустимый адрес сервера. Добавьте его в ALLOWED_HOSTS.');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.path.startsWith('/api/')) {
      if (req.headers['x-requested-with'] !== 'family-archive') return res.status(403).json({ error: 'Запрос отклонён: нет служебного заголовка' });
      const origin = req.headers.origin;
      if (origin) {
        let ok = false;
        try {
          ok = new URL(origin).host.toLowerCase() === String(req.headers.host || '').toLowerCase();
        } catch {
          ok = false;
        }
        if (!ok) return res.status(403).json({ error: 'Запрос с другого сайта отклонён' });
      }
    }
    next();
  }

  function sessionToken(req) {
    return parseCookies(req.headers.cookie)[cookieName] || null;
  }

  function isLoggedIn(req) {
    if (!enabled) return true;
    const token = sessionToken(req);
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return false;
    const row = db.get('SELECT * FROM sessions WHERE token_hash = ?', sha256(token));
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

  async function verify(password) {
    if (!stored) return false;
    const pw = String(password ?? '');
    if (!pw || pw.length > 1024) return false;
    const key = await scrypt(pw.normalize('NFC'), stored.salt, stored.key.length, { ...stored.params, maxmem: maxmem(stored.params) });
    return crypto.timingSafeEqual(key, stored.key);
  }

  async function login(req, res) {
    if (!enabled) return res.json({ ok: true });
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const mine = (perIp.get(ip) || []).filter((t) => now - t < WINDOW);
    globalFails = globalFails.filter((t) => now - t < WINDOW);
    if (mine.length >= 10 || globalFails.length >= 50) {
      return res.status(429).json({ error: 'Слишком много неудачных попыток входа. Подождите 15 минут.' });
    }
    let ok = false;
    try {
      ok = await verify(req.body?.password);
    } catch {
      ok = false;
    }
    if (!ok) {
      mine.push(now);
      perIp.set(ip, mine);
      globalFails.push(now);
      if (perIp.size > 10000) perIp.clear();
      await sleep(400 + Math.floor(Math.random() * 300));
      return res.status(401).json({ error: 'Неверный пароль' });
    }
    perIp.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(now + config.sessionDays * 86400000).toISOString();
    db.run('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)', sha256(token), nowIso(), expires);
    res.setHeader('Set-Cookie', `${cookieName}=${token}; ${cookieFlags(req)}; Max-Age=${config.sessionDays * 86400}`);
    res.json({ ok: true });
  }

  function logout(req, res) {
    const token = sessionToken(req);
    if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
    res.setHeader('Set-Cookie', `${cookieName}=; ${cookieFlags(req)}; Max-Age=0`);
    res.json({ ok: true });
  }

  // Завершить все сеансы (например, если телефон потерян).
  function logoutAll(req, res) {
    db.run('DELETE FROM sessions');
    res.setHeader('Set-Cookie', `${cookieName}=; ${cookieFlags(req)}; Max-Age=0`);
    res.json({ ok: true });
  }

  function status(req, res) {
    res.json({ authEnabled: enabled, loggedIn: isLoggedIn(req) });
  }

  return { guard, requireAuth, login, logout, logoutAll, status, enabled };
}
