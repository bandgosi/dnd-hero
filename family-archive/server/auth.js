// Защита доступа.
// * По умолчанию сервер слушает только 127.0.0.1 — данные недоступны из сети.
// * Если задан пароль (APP_PASSWORD_HASH или APP_PASSWORD), для API и фотографий нужен вход.
// * Запуск с доступом из сети без пароля и без ALLOWED_HOSTS запрещён (config.configProblems).
// * Изменяющие запросы требуют служебный заголовок и совпадение Origin — защита от подделки
//   запросов со сторонних сайтов; заголовок Host проверяется против подмены DNS.
// * Пароль проверяется медленной функцией scrypt; попытки входа ограничены.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
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

// Счётчики попыток не растут без предела: сначала забываются устаревшие, затем самые давние.
function pruneCounters(map, now, max = 10000) {
  if (map.size <= max) return;
  for (const [k, list] of map) if (!list.length || now - list[list.length - 1] >= 15 * 60 * 1000) map.delete(k);
  for (const k of map.keys()) {
    if (map.size <= max) break;
    map.delete(k);
  }
}
const hmac = (key, s) => crypto.createHmac('sha256', key).update(s).digest('base64url');

// Секрет установки: лежит в папке данных (не в базе и не в резервных копиях).
function installSecret(dataDir) {
  const file = path.join(dataDir, 'auth.key');
  try {
    fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  const hex = fs.readFileSync(file, 'utf8').trim();
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error(`Файл ${file} повреждён — удалите его, он будет создан заново (все устройства выйдут).`);
  return Buffer.from(hex, 'hex');
}

// Ключ клиента для ограничения попыток: IPv4 целиком, IPv6 — по сети /64
// (у одного абонента обычно целая сеть /64, иначе ограничение легко обойти).
function parseIp(ip) {
  const a = String(ip || 'unknown').toLowerCase().split('%')[0];
  if (a.startsWith('::ffff:') && a.includes('.')) return { v4: a.slice(7) };
  if (!a.includes(':')) return { v4: a };
  const [head, tail] = a.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = a.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return { v6: groups.map((g) => g.replace(/^0+(?=.)/, '')) };
}
export function clientKey(ip) {
  const p = parseIp(ip);
  return p.v4 ?? `${p.v6.slice(0, 4).join(':')}::/64`;
}
// Сеть клиента (IPv4 /24, IPv6 /48): общий предел для адресов одной сети — против подбора
// с множества адресов одного провайдера или туннеля.
export function netKey(ip) {
  const p = parseIp(ip);
  if (p.v6) return `${p.v6.slice(0, 3).join(':')}::/48`;
  const o = p.v4.split('.');
  return o.length === 4 ? `${o.slice(0, 3).join('.')}.0/24` : p.v4;
}

export function createAuth(db, config) {
  const enabled = !!(config.passwordHash || config.password);
  const cookieName = config.cookieSecure ? '__Host-fa_session' : 'fa_session';
  const devName = config.cookieSecure ? '__Host-fa_device' : 'fa_device';
  let stored = null;
  let fingerprint = null;
  let secret = null;
  if (enabled) secret = installSecret(config.dataDir);
  if (config.passwordHash) {
    stored = parseHash(config.passwordHash);
    fingerprint = hmac(secret, `hash:${config.passwordHash}`);
  } else if (config.password) {
    const salt = crypto.randomBytes(16);
    stored = { params: SCRYPT, salt, key: crypto.scryptSync(config.password.normalize('NFC'), salt, 32, { ...SCRYPT, maxmem: maxmem(SCRYPT) }) };
    // Отпечаток для сброса сеансов при смене пароля: медленная функция с секретом установки как солью.
    fingerprint = crypto.scryptSync(config.password.normalize('NFC'), secret, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('base64url');
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
  const perNet = new Map();
  let globalFails = [];
  let inFlight = 0;
  const WINDOW = 15 * 60 * 1000;
  const MAX_IN_FLIGHT = 4;

  const hostOf = (req) => {
    const raw = String(req.headers.host || '').toLowerCase();
    if (raw.startsWith('[')) return raw.slice(1, raw.indexOf(']') > 0 ? raw.indexOf(']') : undefined);
    return raw.replace(/:\d+$/, '');
  };
  const hostAllowed = (req) => {
    const host = hostOf(req);
    return LOCAL_HOSTS.includes(host) || config.allowedHosts.includes(host);
  };

  const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'forwarded', 'x-real-ip', 'via'];

  function guard(req, res, next) {
    if (!hostAllowed(req)) return res.status(421).type('text/plain; charset=utf-8').send('Недопустимый адрес сервера. Добавьте его в ALLOWED_HOSTS.');
    // Без пароля — только этот компьютер: запрос через прокси или туннель означает доступ из сети.
    if (!enabled && PROXY_HEADERS.some((h) => req.headers[h] !== undefined)) {
      return res.status(403).type('text/plain; charset=utf-8').send('Доступ через прокси без пароля запрещён. Задайте пароль (APP_PASSWORD_HASH) и ALLOWED_HOSTS.');
    }
    // Проверяются все изменяющие запросы, независимо от пути (маршрутизация не различает регистр).
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
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

  // Устройство, с которого уже входили: cookie, подписанная секретом установки (не паролем —
  // переживает смену пароля). Она не даёт доступа, а лишь освобождает от строгого режима при подборе.
  const deviceSig = (ts) => hmac(secret, `device:${ts}`);
  const knownDevice = (req) => {
    const m = /^(\d{10,16})\.([A-Za-z0-9_-]{43})$/.exec(parseCookies(req.headers.cookie)[devName] || '');
    if (!m) return false;
    const a = Buffer.from(m[2]);
    const b = Buffer.from(deviceSig(m[1]));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };

  async function login(req, res) {
    if (!enabled) return res.json({ ok: true });
    const ip = clientKey(req.ip);
    const net = netKey(req.ip);
    const now = Date.now();
    const known = knownDevice(req);
    const mine = (perIp.get(ip) || []).filter((t) => now - t < WINDOW);
    const ours = (perNet.get(net) || []).filter((t) => now - t < WINDOW);
    globalFails = globalFails.filter((t) => now - t < WINDOW);
    // Обычно — 10 попыток за 15 минут с адреса и 30 с сети. Если идёт подбор с многих адресов
    // (50 неудач на всех), новым устройствам остаётся по 3 попытки с адреса; знакомые устройства
    // от строгого режима и предела сети освобождены — полной блокировки, которая заперла бы семью, нет.
    const limit = globalFails.length >= 50 && !known ? 3 : 10;
    if (mine.length >= limit || (!known && ours.length >= 30)) {
      return res.status(429).json({ error: 'Слишком много неудачных попыток входа. Подождите 15 минут.' });
    }
    // Проверка пароля дорогая (scrypt): одновременно — не больше нескольких; для знакомых
    // устройств всегда остаётся запас.
    if (inFlight >= (known ? MAX_IN_FLIGHT + 2 : MAX_IN_FLIGHT)) {
      return res.status(429).json({ error: 'Сервер занят проверкой входа. Повторите через несколько секунд.' });
    }
    // Попытка засчитывается сразу, чтобы параллельные запросы не обходили ограничение.
    mine.push(now);
    perIp.set(ip, mine);
    if (!known) {
      ours.push(now);
      perNet.set(net, ours);
    }
    globalFails.push(now);
    pruneCounters(perIp, now);
    pruneCounters(perNet, now);
    let ok = false;
    inFlight++;
    try {
      ok = await verify(req.body?.password);
    } catch {
      ok = false;
    } finally {
      inFlight--;
    }
    if (!ok) {
      await sleep(400 + Math.floor(Math.random() * 300));
      return res.status(401).json({ error: 'Неверный пароль' });
    }
    const i = globalFails.lastIndexOf(now);
    if (i >= 0) globalFails.splice(i, 1);
    perIp.delete(ip);
    if (!known) {
      const j = ours.lastIndexOf(now);
      if (j >= 0) ours.splice(j, 1);
    }
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(now + config.sessionDays * 86400000).toISOString();
    db.run('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)', sha256(token), nowIso(), expires);
    res.setHeader('Set-Cookie', [
      `${cookieName}=${token}; ${cookieFlags(req)}; Max-Age=${config.sessionDays * 86400}`,
      `${devName}=${now}.${deviceSig(now)}; ${cookieFlags(req)}; Max-Age=${400 * 86400}`,
    ]);
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
