import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const MIGRATIONS = [
  `CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, pw_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
   CREATE TABLE families (id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL);
   CREATE TABLE refresh_tokens (hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE pairing_codes (hash TEXT PRIMARY KEY, family_id INTEGER NOT NULL REFERENCES families(id), expires_at INTEGER NOT NULL, used_at INTEGER);
   CREATE TABLE devices (id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL REFERENCES families(id), name TEXT NOT NULL, platform TEXT NOT NULL,
     key_hash TEXT NOT NULL, consent_at INTEGER NOT NULL, revoked_at INTEGER, revoked_by TEXT, last_seen INTEGER, battery INTEGER);
   CREATE TABLE locations (id INTEGER PRIMARY KEY, device_id INTEGER NOT NULL REFERENCES devices(id), ts INTEGER NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, accuracy REAL);
   CREATE INDEX idx_loc ON locations(device_id, ts);
   CREATE TABLE app_usage (device_id INTEGER NOT NULL REFERENCES devices(id), day TEXT NOT NULL, package TEXT NOT NULL, seconds INTEGER NOT NULL, PRIMARY KEY(device_id, day, package));
   CREATE TABLE geofences (id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL REFERENCES families(id), name TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, radius INTEGER NOT NULL);
   CREATE TABLE commands (id INTEGER PRIMARY KEY, device_id INTEGER NOT NULL REFERENCES devices(id), type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', issued_by INTEGER NOT NULL, created_at INTEGER NOT NULL);
   CREATE TABLE audit_log (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT, ip TEXT);`,
];

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)');
  let v = db.prepare('SELECT v FROM schema_version').get()?.v;
  if (v === undefined) { db.exec('INSERT INTO schema_version VALUES (0)'); v = 0; }
  for (let i = v; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try { db.exec(MIGRATIONS[i]); db.prepare('UPDATE schema_version SET v=?').run(i + 1); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  return db;
}
