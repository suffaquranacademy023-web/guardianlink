import { scryptSync, randomBytes, timingSafeEqual, createHmac, createHash } from 'node:crypto';

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const randomToken = (n = 32) => randomBytes(n).toString('base64url');

export function hashPassword(pw) {
  const salt = randomBytes(16);
  const h = scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}
export function verifyPassword(pw, stored) {
  const [alg, s, h] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(h, 'base64');
  const got = scryptSync(pw, Buffer.from(s, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(got, expected);
}
export function safeEqualHex(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
export function signJwt(payload, secret, ttlSec) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ ...payload, iat: now, exp: now + ttlSec })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
export function verifyJwt(token, secret) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const sig = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  if (!safeEqualHex(sig, parts[2])) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return p.exp > Date.now() / 1000 ? p : null;
  } catch { return null; }
}
