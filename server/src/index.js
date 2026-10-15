import { openDb } from './db.js';
import { createApp } from './app.js';

const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32) { console.error('[GuardianLink] STARTUP ERROR: JWT_SECRET must be set (>=32 characters) in Environment variables'); process.exit(1); }
let db;
try { db = openDb(process.env.DB_PATH || './data/guardianlink.db'); }
catch (e) { console.error('[GuardianLink] STARTUP ERROR: cannot open database at DB_PATH:', e.message); process.exit(1); }
const server = createApp({ db, jwtSecret: secret, maxDevices: Number(process.env.MAX_DEVICES_PER_FAMILY || 10) });
const port = Number(process.env.PORT || 3000);
server.listen(port, () => console.log(`GuardianLink server listening on :${port} (put HTTPS reverse proxy in front)`));
