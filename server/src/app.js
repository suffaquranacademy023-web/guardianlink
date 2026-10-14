import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';
import { hashPassword, verifyPassword, signJwt, verifyJwt, sha256, randomToken, safeEqualHex } from './crypto.js';

const PUBLIC = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.apk': 'application/vnd.android.package-archive', '.exe': 'application/vnd.microsoft.portable-executable' };
const ACCESS_TTL = 15 * 60, REFRESH_TTL = 30 * 24 * 3600, CODE_TTL = 15 * 60;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (m) => new HttpError(400, m);

export function createApp({ db, jwtSecret, maxDevices = 10, rateLimit = { windowMs: 60_000, max: 120, authMax: 10 } }) {
  if (!jwtSecret || jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
  const q = (sql) => db.prepare(sql);
  const now = () => Date.now();
  const hits = new Map();

  function limited(key, max) {
    const t = now(), e = hits.get(key);
    if (!e || t - e.start > rateLimit.windowMs) { hits.set(key, { start: t, n: 1 }); return false; }
    return ++e.n > max;
  }
  setInterval(() => { const t = now(); for (const [k, v] of hits) if (t - v.start > rateLimit.windowMs) hits.delete(k); }, 60_000).unref();

  const audit = (actor, action, target, ip) => q('INSERT INTO audit_log(ts,actor,action,target,ip) VALUES (?,?,?,?,?)').run(now(), actor, action, target ?? null, ip ?? null);

  const isEmail = (s) => typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  const str = (v, name, max = 100) => { if (typeof v !== 'string' || !v.trim() || v.length > max) throw bad(`Invalid ${name}`); return v.trim(); };
  const num = (v, name, lo, hi) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw bad(`Invalid ${name}`); return v; };

  function issueTokens(user) {
    const family = q('SELECT id FROM families WHERE owner_id=?').get(user.id);
    const access = signJwt({ sub: user.id, fam: family.id }, jwtSecret, ACCESS_TTL);
    const refresh = randomToken(32);
    q('INSERT INTO refresh_tokens(hash,user_id,expires_at) VALUES (?,?,?)').run(sha256(refresh), user.id, now() + REFRESH_TTL * 1000);
    return { accessToken: access, refreshToken: refresh, expiresIn: ACCESS_TTL };
  }

  function parent(req) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    const p = m && verifyJwt(m[1], jwtSecret);
    if (!p) throw new HttpError(401, 'Unauthorized');
    return { userId: p.sub, familyId: p.fam };
  }
  function device(req) {
    const id = Number(req.headers['x-device-id']);
    const key = req.headers['x-device-key'] || req.headers['x-pairing-token'];
    const d = Number.isInteger(id) && q('SELECT * FROM devices WHERE id=?').get(id);
    if (!d || typeof key !== 'string' || d.revoked_at || !safeEqualHex(sha256(key), d.key_hash)) throw new HttpError(401, 'Unauthorized');
    return d;
  }
  const ownDevice = (familyId, id) => {
    const d = q('SELECT * FROM devices WHERE id=? AND family_id=?').get(Number(id), familyId);
    if (!d) throw new HttpError(404, 'Not found');
    return d;
  };
  const pubDevice = (d) => ({ id: d.id, name: d.name, platform: d.platform, lastSeen: d.last_seen, battery: d.battery, consentAt: d.consent_at, revokedAt: d.revoked_at });

  // [method, regex, handler(ctx) -> {status?, body}]
  const routes = [
    ['POST', /^\/api\/auth\/register$/, ({ body, ip }) => {
      if (!isEmail(body.email)) throw bad('Invalid email');
      if (typeof body.password !== 'string' || body.password.length < 10 || body.password.length > 200) throw bad('Password must be 10–200 characters');
      const familyName = str(body.familyName ?? 'My Family', 'familyName');
      const email = body.email.toLowerCase();
      if (q('SELECT 1 FROM users WHERE email=?').get(email)) throw new HttpError(409, 'Email already registered');
      const u = q('INSERT INTO users(email,pw_hash,created_at) VALUES (?,?,?)').run(email, hashPassword(body.password), now());
      q('INSERT INTO families(owner_id,name) VALUES (?,?)').run(u.lastInsertRowid, familyName);
      audit(`user:${u.lastInsertRowid}`, 'register', null, ip);
      return { status: 201, body: issueTokens({ id: Number(u.lastInsertRowid) }) };
    }, 'auth'],
    ['POST', /^\/api\/auth\/login$/, ({ body, ip }) => {
      const u = isEmail(body.email) && typeof body.password === 'string' ? q('SELECT * FROM users WHERE email=?').get(body.email.toLowerCase()) : null;
      if (!u || !verifyPassword(body.password, u.pw_hash)) { audit('anon', 'login_failed', String(body.email).slice(0, 100), ip); throw new HttpError(401, 'Invalid credentials'); }
      audit(`user:${u.id}`, 'login', null, ip);
      return { body: issueTokens(u) };
    }, 'auth'],
    ['POST', /^\/api\/auth\/refresh$/, ({ body }) => {
      const h = sha256(String(body.refreshToken));
      const r = q('SELECT * FROM refresh_tokens WHERE hash=?').get(h);
      if (!r || r.revoked || r.expires_at < now()) throw new HttpError(401, 'Invalid refresh token');
      q('UPDATE refresh_tokens SET revoked=1 WHERE hash=?').run(h); // rotation
      return { body: issueTokens({ id: r.user_id }) };
    }, 'auth'],
    ['POST', /^\/api\/auth\/logout$/, ({ body }) => {
      q('UPDATE refresh_tokens SET revoked=1 WHERE hash=?').run(sha256(String(body.refreshToken)));
      return { body: { ok: true } };
    }],
    ['GET', /^\/api\/me$/, ({ req }) => {
      const { userId, familyId } = parent(req);
      const u = q('SELECT id,email FROM users WHERE id=?').get(userId);
      const f = q('SELECT id,name FROM families WHERE id=?').get(familyId);
      return { body: { user: u, family: f, maxDevices } };
    }],
    ['POST', /^\/api\/pairing-codes$/, ({ req, ip }) => {
      const { userId, familyId } = parent(req);
      const active = q('SELECT COUNT(*) c FROM devices WHERE family_id=? AND revoked_at IS NULL').get(familyId).c;
      if (active >= maxDevices) throw new HttpError(409, `Device limit (${maxDevices}) reached`);
      let code = '';
      for (let i = 0; i < 8; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      q('INSERT INTO pairing_codes(hash,family_id,expires_at) VALUES (?,?,?)').run(sha256(code), familyId, now() + CODE_TTL * 1000);
      audit(`user:${userId}`, 'pairing_code_created', null, ip);
      return { status: 201, body: { code, expiresInSeconds: CODE_TTL } };
    }],
    // Device enrolment: requires explicit consent flag, exchanges one-time code for a per-device key.
    ['POST', /^\/api\/devices\/enroll$/, ({ body, ip }) => {
      if (body.consent !== true) throw bad('Explicit consent is required');
      const code = str(body.code, 'code', 16).toUpperCase();
      const name = str(body.name, 'name'), platform = body.platform;
      if (!['android', 'windows'].includes(platform)) throw bad('Invalid platform');
      const pc = q('SELECT * FROM pairing_codes WHERE hash=?').get(sha256(code));
      if (!pc || pc.used_at || pc.expires_at < now()) throw new HttpError(401, 'Invalid or expired pairing code');
      const active = q('SELECT COUNT(*) c FROM devices WHERE family_id=? AND revoked_at IS NULL').get(pc.family_id).c;
      if (active >= maxDevices) throw new HttpError(409, 'Device limit reached');
      const key = randomToken(32);
      q('UPDATE pairing_codes SET used_at=? WHERE hash=?').run(now(), pc.hash);
      const r = q('INSERT INTO devices(family_id,name,platform,key_hash,consent_at) VALUES (?,?,?,?,?)').run(pc.family_id, name, platform, sha256(key), now());
      audit(`device:${r.lastInsertRowid}`, 'device_enrolled', `family:${pc.family_id}`, ip);
      return { status: 201, body: { deviceId: Number(r.lastInsertRowid), deviceKey: key } };
    }, 'auth'],
    ['POST', /^\/api\/device\/telemetry$/, ({ req, body }) => {
      const d = device(req);
      const battery = body.battery == null ? null : Math.round(num(body.battery, 'battery', 0, 100));
      q('UPDATE devices SET last_seen=?, battery=COALESCE(?,battery) WHERE id=?').run(now(), battery, d.id);
      if (body.lat != null || body.lng != null)
        q('INSERT INTO locations(device_id,ts,lat,lng,accuracy) VALUES (?,?,?,?,?)').run(d.id, now(), num(body.lat, 'lat', -90, 90), num(body.lng, 'lng', -180, 180), body.accuracy == null ? null : num(body.accuracy, 'accuracy', 0, 1e6));
      return { body: { ok: true } };
    }],
    ['POST', /^\/api\/device\/usage$/, ({ req, body }) => {
      const d = device(req);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.day) || !Array.isArray(body.apps) || body.apps.length > 500) throw bad('Invalid usage payload');
      const up = q('INSERT INTO app_usage(device_id,day,package,seconds) VALUES (?,?,?,?) ON CONFLICT(device_id,day,package) DO UPDATE SET seconds=excluded.seconds');
      for (const a of body.apps) up.run(d.id, body.day, str(a.package, 'package', 200), Math.round(num(a.seconds, 'seconds', 0, 86400)));
      return { body: { ok: true } };
    }],
    ['GET', /^\/api\/device\/commands$/, ({ req }) => {
      const d = device(req);
      const cmds = q("SELECT id,type FROM commands WHERE device_id=? AND status='pending'").all(d.id);
      return { body: { commands: cmds } };
    }],
    ['POST', /^\/api\/device\/commands\/(\d+)\/ack$/, ({ req, m }) => {
      const d = device(req);
      q("UPDATE commands SET status='done' WHERE id=? AND device_id=?").run(Number(m[1]), d.id);
      return { body: { ok: true } };
    }],
    // A child/device owner can always leave the family.
    ['POST', /^\/api\/device\/leave$/, ({ req, ip }) => {
      const d = device(req);
      q("UPDATE devices SET revoked_at=?, revoked_by='device' WHERE id=?").run(now(), d.id);
      audit(`device:${d.id}`, 'device_left', null, ip);
      return { body: { ok: true } };
    }],
    ['GET', /^\/api\/devices$/, ({ req }) => {
      const { familyId } = parent(req);
      return { body: { devices: q('SELECT * FROM devices WHERE family_id=? ORDER BY id').all(familyId).map(pubDevice) } };
    }],
    ['GET', /^\/api\/devices\/(\d+)\/locations$/, ({ req, m }) => {
      const { familyId } = parent(req);
      const d = ownDevice(familyId, m[1]);
      return { body: { locations: q('SELECT ts,lat,lng,accuracy FROM locations WHERE device_id=? ORDER BY ts DESC LIMIT 200').all(d.id) } };
    }],
    ['GET', /^\/api\/devices\/(\d+)\/usage$/, ({ req, m }) => {
      const { familyId } = parent(req);
      const d = ownDevice(familyId, m[1]);
      return { body: { usage: q('SELECT day,package,seconds FROM app_usage WHERE device_id=? ORDER BY day DESC, seconds DESC LIMIT 500').all(d.id) } };
    }],
    ['POST', /^\/api\/devices\/(\d+)\/commands$/, ({ req, m, body, ip }) => {
      const { userId, familyId } = parent(req);
      const d = ownDevice(familyId, m[1]);
      if (d.revoked_at) throw new HttpError(409, 'Device revoked');
      if (body.type !== 'lock') throw bad('Unsupported command');
      const r = q('INSERT INTO commands(device_id,type,issued_by,created_at) VALUES (?,?,?,?)').run(d.id, 'lock', userId, now());
      audit(`user:${userId}`, 'command_lock', `device:${d.id}`, ip);
      return { status: 201, body: { id: Number(r.lastInsertRowid) } };
    }],
    ['DELETE', /^\/api\/devices\/(\d+)$/, ({ req, m, ip }) => {
      const { userId, familyId } = parent(req);
      const d = ownDevice(familyId, m[1]);
      q("UPDATE devices SET revoked_at=?, revoked_by=? WHERE id=? AND revoked_at IS NULL").run(now(), `user:${userId}`, d.id);
      audit(`user:${userId}`, 'device_revoked', `device:${d.id}`, ip);
      return { body: { ok: true } };
    }],
    ['GET', /^\/api\/geofences$/, ({ req }) => {
      const { familyId } = parent(req);
      return { body: { geofences: q('SELECT id,name,lat,lng,radius FROM geofences WHERE family_id=?').all(familyId) } };
    }],
    ['POST', /^\/api\/geofences$/, ({ req, body }) => {
      const { familyId } = parent(req);
      const r = q('INSERT INTO geofences(family_id,name,lat,lng,radius) VALUES (?,?,?,?,?)').run(familyId, str(body.name, 'name'), num(body.lat, 'lat', -90, 90), num(body.lng, 'lng', -180, 180), Math.round(num(body.radius, 'radius', 10, 100000)));
      return { status: 201, body: { id: Number(r.lastInsertRowid) } };
    }],
    ['DELETE', /^\/api\/geofences\/(\d+)$/, ({ req, m }) => {
      const { familyId } = parent(req);
      q('DELETE FROM geofences WHERE id=? AND family_id=?').run(Number(m[1]), familyId);
      return { body: { ok: true } };
    }],
    ['GET', /^\/api\/audit$/, ({ req }) => {
      const { userId, familyId } = parent(req);
      const rows = q(`SELECT ts,actor,action,target FROM audit_log WHERE actor=? OR target=? OR actor IN (SELECT 'device:'||id FROM devices WHERE family_id=?) ORDER BY id DESC LIMIT 200`).all(`user:${userId}`, `family:${familyId}`, familyId);
      return { body: { events: rows } };
    }],
    ['GET', /^\/api\/health$/, () => ({ body: { ok: true } })],
  ];

  const SEC = {
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains', 'Cache-Control': 'no-store',
  };
  const send = (res, status, body, extra = {}) => {
    const isStr = typeof body === 'string' || Buffer.isBuffer(body);
    res.writeHead(status, { ...SEC, 'Content-Type': isStr ? 'text/plain' : 'application/json', ...extra });
    res.end(isStr ? body : JSON.stringify(body));
  };

  async function readJson(req) {
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > 100_000) throw new HttpError(413, 'Body too large'); chunks.push(c); }
    if (!size) return {};
    try { const j = JSON.parse(Buffer.concat(chunks).toString()); if (j === null || typeof j !== 'object') throw 0; return j; }
    catch { throw bad('Invalid JSON'); }
  }

  const server = createServer(async (req, res) => {
    const ip = req.socket.remoteAddress;
    try {
      const url = new URL(req.url, 'http://x');
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET') return send(res, 405, 'Method not allowed');
        const rel = normalize(url.pathname === '/' ? '/index.html' : url.pathname);
        if (rel.includes('..')) return send(res, 400, 'Bad request');
        try {
          const data = await readFile(join(PUBLIC, rel));
          return send(res, 200, data, { 'Content-Type': MIME[extname(rel)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
        } catch { return send(res, 404, 'Not found'); }
      }
      for (const [method, re, handler, kind] of routes) {
        const m = re.exec(url.pathname);
        if (!m || method !== req.method) continue;
        if (limited(`${ip}:all`, rateLimit.max) || (kind === 'auth' && limited(`${ip}:auth`, rateLimit.authMax))) throw new HttpError(429, 'Too many requests');
        const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readJson(req);
        const out = handler({ req, body, m, ip });
        return send(res, out.status ?? 200, out.body);
      }
      send(res, 404, { error: 'Not found' });
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error('Unhandled error:', e.message); // no request data logged
      send(res, 500, { error: 'Internal error' });
    }
  });
  return server;
}
