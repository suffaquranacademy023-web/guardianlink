import { openDb } from './db.js';
import { createApp } from './app.js';

const secret = process.env.JWT_SECRET;
if (!secret) { console.error('JWT_SECRET is required (see .env.example)'); process.exit(1); }
const db = openDb(process.env.DB_PATH || './data/guardianlink.db');
const server = createApp({ db, jwtSecret: secret, maxDevices: Number(process.env.MAX_DEVICES_PER_FAMILY || 10) });
const port = Number(process.env.PORT || 3000);
server.listen(port, () => console.log(`GuardianLink server listening on :${port} (put HTTPS reverse proxy in front)`));
