# GuardianLink (rebuild)

Consent-based family safety: parents see location/battery/usage of enrolled devices; every device shows a permanent notice, can leave at any time, and can be revoked by the parent.

| Folder | What | Status |
|---|---|---|
| `server/` | Node 22 backend (zero npm dependencies: `node:http`, `node:sqlite`, scrypt, HS256 JWT) + web dashboard in `server/public` | **Built, 9/9 automated tests pass, UI smoke-tested** |
| `android/` | Kotlin + Compose app | Source written, **not compiled or tested** |
| `windows/` | .NET 8 WPF app + Inno Setup installer | Source written, **not compiled or tested** |

## Run the server
    cd server
    cp .env.example .env   # set JWT_SECRET (>=32 random chars)
    export $(cat .env | xargs) && npm start      # needs Node >= 22.5
    npm test
Put it behind an HTTPS reverse proxy (Caddy/nginx). Hostinger **shared** hosting cannot run this; use a VPS (or Hostinger Node hosting if your plan supports Node 22). Back up `DB_PATH` nightly (`sqlite3 db ".backup file"`).

## Security model
- Parent auth: scrypt password hashes, 15-min access JWT, rotating hashed refresh tokens, rate limits on auth.
- Devices enroll with a single-use 15-min code **plus explicit consent flag**, then get a random per-device key (stored hashed server-side). The old shared token `GL-8924-10` is rejected.
- Families are isolated; every parent action is audit-logged; device or parent can revoke.
- No hidden mode, no screen/audio capture. Lock requests use Android Device Admin (user must opt in) / `LockWorkStation` on Windows.

## Known limitations / TODO
- Android & Windows apps need building and on-device testing; Android usage-stats upload and geofence alerts (push) not implemented; Windows has no tray icon or usage reporting.
- No email verification / password reset / TOTP yet; in-memory rate limiter (single instance only).
- Live Remote View intentionally omitted. Privacy policy and terms are templates, not legal advice.
- Release files must be built by you, signed, and checksummed in `RELEASES.md`.
