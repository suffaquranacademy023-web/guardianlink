import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.mjs';
import { createApp } from '../src/app.mjs';

let server, base;
const SECRET = 'x'.repeat(40);
before(async () => {
  server = createApp({ db: openDb(':memory:'), jwtSecret: SECRET, maxDevices: 2, rateLimit: { windowMs: 60000, max: 10000, authMax: 10000 } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = async (method, path, body, headers = {}) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const reg = async (email) => (await call('POST', '/api/auth/register', { email, password: 'correct-horse-battery', familyName: 'Fam' })).body;
const auth = (t) => ({ authorization: `Bearer ${t.accessToken}` });
async function enroll(t, name = 'Phone') {
  const { body: pc } = await call('POST', '/api/pairing-codes', null, auth(t));
  return call('POST', '/api/devices/enroll', { code: pc.code, name, platform: 'android', consent: true });
}

test('register/login/refresh rotation/logout', async () => {
  const t = await reg('a@example.com');
  assert.ok(t.accessToken);
  assert.equal((await call('POST', '/api/auth/register', { email: 'a@example.com', password: 'correct-horse-battery' })).status, 409);
  assert.equal((await call('POST', '/api/auth/login', { email: 'a@example.com', password: 'wrong-password-1' })).status, 401);
  const l = await call('POST', '/api/auth/login', { email: 'a@example.com', password: 'correct-horse-battery' });
  assert.equal(l.status, 200);
  const r1 = await call('POST', '/api/auth/refresh', { refreshToken: l.body.refreshToken });
  assert.equal(r1.status, 200);
  assert.equal((await call('POST', '/api/auth/refresh', { refreshToken: l.body.refreshToken })).status, 401, 'old refresh token must be revoked');
  await call('POST', '/api/auth/logout', { refreshToken: r1.body.refreshToken });
  assert.equal((await call('POST', '/api/auth/refresh', { refreshToken: r1.body.refreshToken })).status, 401);
});

test('validation: weak password, bad email, bad JSON', async () => {
  assert.equal((await call('POST', '/api/auth/register', { email: 'b@example.com', password: 'short' })).status, 400);
  assert.equal((await call('POST', '/api/auth/register', { email: 'nope', password: 'correct-horse-battery' })).status, 400);
  const r = await fetch(base + '/api/auth/login', { method: 'POST', body: '{bad' });
  assert.equal(r.status, 400);
});

test('protected routes reject missing/forged tokens', async () => {
  assert.equal((await call('GET', '/api/devices')).status, 401);
  assert.equal((await call('GET', '/api/devices', null, { authorization: 'Bearer a.b.c' })).status, 401);
});

test('enrollment requires consent, valid one-time code; per-device key works; old hardcoded token does not', async () => {
  const t = await reg('c@example.com');
  const { body: pc } = await call('POST', '/api/pairing-codes', null, auth(t));
  assert.equal((await call('POST', '/api/devices/enroll', { code: pc.code, name: 'P', platform: 'android' })).status, 400, 'no consent');
  assert.equal((await call('POST', '/api/devices/enroll', { code: 'GL-8924-10', name: 'P', platform: 'android', consent: true })).status, 401);
  const e = await call('POST', '/api/devices/enroll', { code: pc.code, name: 'P', platform: 'android', consent: true });
  assert.equal(e.status, 201);
  assert.equal((await call('POST', '/api/devices/enroll', { code: pc.code, name: 'P2', platform: 'android', consent: true })).status, 401, 'code is single-use');
  const h = { 'x-device-id': String(e.body.deviceId), 'x-device-key': e.body.deviceKey };
  assert.equal((await call('POST', '/api/device/telemetry', { battery: 80, lat: 24.8, lng: 67.0 }, h)).status, 200);
  assert.equal((await call('POST', '/api/device/telemetry', { battery: 80 }, { ...h, 'x-device-key': 'wrong' })).status, 401);
  assert.equal((await call('POST', '/api/device/telemetry', { lat: 999, lng: 0 }, h)).status, 400);
  const list = await call('GET', '/api/devices', null, auth(t));
  assert.equal(list.body.devices[0].battery, 80);
  const loc = await call('GET', `/api/devices/${e.body.deviceId}/locations`, null, auth(t));
  assert.equal(loc.body.locations.length, 1);
});

test('families are isolated', async () => {
  const a = await reg('d1@example.com'), b = await reg('d2@example.com');
  const e = await enroll(a);
  assert.equal((await call('GET', `/api/devices/${e.body.deviceId}/locations`, null, auth(b))).status, 404);
  assert.equal((await call('DELETE', `/api/devices/${e.body.deviceId}`, null, auth(b))).status, 404);
  assert.equal((await call('POST', `/api/devices/${e.body.deviceId}/commands`, { type: 'lock' }, auth(b))).status, 404);
  assert.equal((await call('GET', '/api/devices', null, auth(b))).body.devices.length, 0);
});

test('revocation by parent and by device blocks further access; limit enforced', async () => {
  const t = await reg('e@example.com');
  const e1 = await enroll(t, 'one'), e2 = await enroll(t, 'two');
  const h1 = { 'x-device-id': String(e1.body.deviceId), 'x-device-key': e1.body.deviceKey };
  const h2 = { 'x-device-id': String(e2.body.deviceId), 'x-device-key': e2.body.deviceKey };
  assert.equal((await call('POST', '/api/pairing-codes', null, auth(t))).status, 409, 'limit of 2');
  assert.equal((await call('DELETE', `/api/devices/${e1.body.deviceId}`, null, auth(t))).status, 200);
  assert.equal((await call('POST', '/api/device/telemetry', { battery: 1 }, h1)).status, 401);
  assert.equal((await call('POST', '/api/device/leave', {}, h2)).status, 200);
  assert.equal((await call('POST', '/api/device/telemetry', { battery: 1 }, h2)).status, 401);
  const audit = await call('GET', '/api/audit', null, auth(t));
  const acts = audit.body.events.map((x) => x.action);
  assert.ok(acts.includes('device_revoked') && acts.includes('device_left') && acts.includes('device_enrolled'));
});

test('lock command flow, usage and geofences', async () => {
  const t = await reg('f@example.com');
  const e = await enroll(t);
  const h = { 'x-device-id': String(e.body.deviceId), 'x-device-key': e.body.deviceKey };
  const c = await call('POST', `/api/devices/${e.body.deviceId}/commands`, { type: 'lock' }, auth(t));
  assert.equal(c.status, 201);
  assert.equal((await call('POST', `/api/devices/${e.body.deviceId}/commands`, { type: 'wipe' }, auth(t))).status, 400);
  const pend = await call('GET', '/api/device/commands', null, h);
  assert.deepEqual(pend.body.commands.map((x) => x.type), ['lock']);
  await call('POST', `/api/device/commands/${c.body.id}/ack`, {}, h);
  assert.equal((await call('GET', '/api/device/commands', null, h)).body.commands.length, 0);
  assert.equal((await call('POST', '/api/device/usage', { day: '2026-10-14', apps: [{ package: 'com.x', seconds: 120 }] }, h)).status, 200);
  assert.equal((await call('GET', `/api/devices/${e.body.deviceId}/usage`, null, auth(t))).body.usage[0].seconds, 120);
  const g = await call('POST', '/api/geofences', { name: 'Home', lat: 24.8, lng: 67, radius: 150 }, auth(t));
  assert.equal(g.status, 201);
  assert.equal((await call('GET', '/api/geofences', null, auth(t))).body.geofences.length, 1);
});

test('security headers and static path traversal', async () => {
  const r = await fetch(base + '/api/health');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const t = await fetch(base + '/%2e%2e/src/app.js');
  assert.notEqual(t.status, 200);
});

test('rate limiting on auth endpoints', async () => {
  const s = createApp({ db: openDb(':memory:'), jwtSecret: SECRET, rateLimit: { windowMs: 60000, max: 1000, authMax: 3 } });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const b = `http://127.0.0.1:${s.address().port}`;
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await fetch(b + '/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'x@y.zz', password: 'abcdefghijk' }) })).status);
  s.close();
  assert.deepEqual(codes, [401, 401, 401, 429, 429]);
});
