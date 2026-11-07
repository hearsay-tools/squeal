// Throwaway research probe. No production daemon starts or receives a request.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { cpus, loadavg } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { socketPathFor } from '../../../../../../src/core/daemon/paths.js';
import { worktreeIdFor } from '../../../../../../src/core/fs/git-layout.js';
import { stoppedMetaKey } from '../../../../../../src/core/presence/stored.js';
import { openStore, isStoreOpenFailure } from '../../../../../../src/core/store/open.js';

const cli = resolve(process.argv[2] ?? 'plugins/claude-code/dist/cli/squeal.mjs');
const loads = loadavg();
const count = cpus().length;
console.log(JSON.stringify({ at: new Date().toISOString(), node: process.version,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim(), cli,
  sha256: createHash('sha256').update(readFileSync(cli)).digest('hex'),
  load: loads, cpus: count }));
if (loads[0] > count) { console.log('SKIPPED: one-minute load exceeds CPU count'); process.exit(0); }

for (const mode of ['locked', 'transient', 'unlocked', 'no-daemon-locked']) {
  const dir = mkdtempSync('/tmp/sq158-');
  const root = join(dir, 'repo');
  mkdirSync(root);
  const env = { PATH: '/usr/bin:/bin', XDG_RUNTIME_DIR: dir };
  const git = (...args: string[]) => execFileSync('git', args, {cwd:root, env, encoding:'utf8'});
  let locker: DatabaseSync | undefined;
  let held = false;
  let server: ReturnType<typeof createServer> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const requests: string[] = [];
  const release = () => { if (held) { locker!.exec('ROLLBACK'); held = false; } };
  try {
    git('init', '-q');
    writeFileSync(join(root, 'a.txt'), 'a\n');
    writeFileSync(join(root, 'squeal.config.json'), '{}\n');
    git('add', 'a.txt', 'squeal.config.json');
    git('-c', 'user.name=probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'fixture');
    const commonDir = join(root, '.git');
    const id = worktreeIdFor(root);
    const store = openStore(commonDir);
    if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
    store.worktrees.upsert({id, root, commonDir, isMain:true, registeredAt:1, daemon:null});
    store.close();
    const socket = socketPathFor(id, env);
    if (!socket.startsWith(dir + '/')) throw new Error('Socket escaped isolated directory');
    if (mode !== 'no-daemon-locked') {
      server = createServer(connection => connection.once('data', data => {
        const {type} = JSON.parse(data.toString());
        requests.push(type);
        const ping = {pid:2147483647, startedAt:1, worktreeId:id, root};
        connection.end(JSON.stringify({schemaVersion:1, ok:true, type, ...(type === 'ping' ? ping : {})}) + '\n');
        if (type === 'stop') {
          server!.close();
          if (mode === 'transient') timer = setTimeout(release, 500);
        }
      }));
      await new Promise<void>(r => server!.listen(socket, r));
    }
    locker = new DatabaseSync(join(commonDir, 'squeal/store.sqlite'));
    const key = stoppedMetaKey(id);
    const mark = () => locker!.prepare('SELECT value FROM meta WHERE key = ?').get(key) ?? null;
    const before = mark();
    if (mode !== 'unlocked') { locker.exec('BEGIN IMMEDIATE'); held = true; }
    const args = ['--disable-warning=ExperimentalWarning', cli, 'stop', '--until-start', root];
    const start = performance.now();
    const result = await new Promise<{code:number|null;signal:string|null;stdout:string;stderr:string}>((done, fail) => {
      const child = spawn(process.execPath, args, {cwd:root, env, stdio:['ignore','pipe','pipe']});
      let stdout = '', stderr = '';
      child.stdout.on('data', x => stdout += x);
      child.stderr.on('data', x => stderr += x);
      const watchdog = setTimeout(() => child.kill('SIGKILL'), 15000);
      child.on('error', fail);
      child.on('close', (code, signal) => { clearTimeout(watchdog); done({code, signal, stdout, stderr}); });
    });
    const durationMs = Math.round(performance.now() - start);
    const heldAtExit = held;
    release();
    console.log(JSON.stringify({mode, command:[process.execPath, ...args], cwd:root, env,
      lockCommand:mode === 'unlocked' ? null : 'BEGIN IMMEDIATE', requests, durationMs,
      heldAtExit, before, after:mark(), ...result, load:loadavg()}));
  } finally {
    if (timer) clearTimeout(timer);
    release(); locker?.close(); server?.close();
    rmSync(dir, {recursive:true, force:true});
  }
}
