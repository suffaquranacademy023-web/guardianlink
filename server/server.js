// Entry shim. Works whether the host runs `node server.js` or `npm start`.
// node:sqlite needs --experimental-sqlite on Node < 22.13; if it is not loadable, re-launch ourselves with the flag.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
let hasSqlite = !process.env.GL_FORCE_FLAG_TEST;
if (hasSqlite) { try { await import('node:sqlite'); } catch { hasSqlite = false; } }

console.log(`[GuardianLink] Node ${process.version}, sqlite ${hasSqlite ? 'available' : 'needs flag'}`);
if (hasSqlite) {
  await import('./src/index.js');
} else {
  const child = spawn(process.execPath, ['--experimental-sqlite', '--no-warnings', 'src/index.js'], { cwd: here, stdio: 'inherit', env: { ...process.env, GL_FORCE_FLAG_TEST: '' } });
  child.on('exit', (code) => process.exit(code ?? 1));
  for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => child.kill(s));
}
