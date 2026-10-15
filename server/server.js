'use strict';
// CommonJS entry (works with hosts that require() the entry file, e.g. LiteSpeed/lsnode, and with plain `node server.js`).
// The real server is an ES module in src/index.mjs, loaded with a dynamic import (no top-level await here).
const { spawn } = require('node:child_process');
const path = require('node:path');

function launch() { return import('./src/index.mjs'); }

import('node:sqlite').then(() => true, () => false).then((hasSqlite) => {
  console.log(`[GuardianLink] Node ${process.version}, sqlite ${hasSqlite && !process.env.GL_FORCE_FLAG_TEST ? 'available' : 'needs flag'}`);
  if (hasSqlite && !process.env.GL_FORCE_FLAG_TEST) return launch();
  // Older Node 22.x needs --experimental-sqlite: re-launch ourselves with it.
  const child = spawn(process.execPath, ['--experimental-sqlite', '--no-warnings', path.join(__dirname, 'src', 'index.mjs')],
    { cwd: __dirname, stdio: 'inherit', env: { ...process.env, GL_FORCE_FLAG_TEST: '' } });
  child.on('exit', (code) => process.exit(code ?? 1));
  for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => child.kill(s));
}).catch((e) => { console.error('[GuardianLink] STARTUP ERROR:', e && e.message); });
