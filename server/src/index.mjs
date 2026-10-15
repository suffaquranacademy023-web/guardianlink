import { createServer } from 'node:http';

const port = Number(process.env.PORT || 3000);

// If startup fails, stay alive and show WHY on every URL (no secrets are printed), instead of dying with a bare 503.
function fail(msg) {
  const text = `GuardianLink could not start.\n\n${msg}\n\nNode: ${process.version}\nPORT: ${port}\nJWT_SECRET set: ${!!process.env.JWT_SECRET} (length ${(process.env.JWT_SECRET || '').length})\nDB_PATH set: ${!!process.env.DB_PATH}\n`;
  console.error('[GuardianLink] STARTUP ERROR:', msg);
  createServer((req, res) => { res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(text); })
    .listen(port, () => console.log(`[GuardianLink] diagnostic server on :${port}`));
}

try {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET must be set (>= 32 characters) in Environment variables.');
  const { openDb } = await import('./db.mjs');
  const { createApp } = await import('./app.mjs');
  let db;
  try { db = openDb(process.env.DB_PATH || './data/guardianlink.db'); }
  catch (e) { throw new Error(`Cannot open database at DB_PATH (${process.env.DB_PATH || './data/guardianlink.db'}): ${e.message}`); }
  const server = createApp({ db, jwtSecret: secret, maxDevices: Number(process.env.MAX_DEVICES_PER_FAMILY || 10) });
  server.listen(port, () => console.log(`GuardianLink server listening on :${port} (HTTPS is provided by the host)`));
} catch (e) {
  fail(e.message);
}
