// Lock only this probe's freshly opened store, from a bounded child process.
import { channel } from 'node:diagnostics_channel';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isMainThread } from 'node:worker_threads';

if (isMainThread && process.env.ISSUE176_MODE === 'lock') {
  channel('squeal:test-pause').subscribe(point => {
    if (point !== 'store-open') return;
    const root = process.env.ISSUE176_ROOT;
    const script = `const { DatabaseSync } = require('node:sqlite');
const { writeFileSync } = require('node:fs');
const db = new DatabaseSync(${JSON.stringify(join(root, '.git/squeal/store.sqlite'))});
db.exec('PRAGMA busy_timeout=1000; BEGIN IMMEDIATE');
writeFileSync(${JSON.stringify(join(root, 'lock-ready'))}, String(Date.now()));
setTimeout(() => { db.exec('ROLLBACK'); db.close(); }, 4000);`;
    spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', script], { stdio: 'ignore' });
    const until = Date.now() + 2000;
    while (!existsSync(join(root, 'lock-ready')) && Date.now() < until) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  });
}
