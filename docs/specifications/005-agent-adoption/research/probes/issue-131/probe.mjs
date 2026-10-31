// Throwaway launcher probe. No real plugin, session, daemon or test store is used.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = resolve(import.meta.dirname, '../../../../../..');
const source = join(repo, 'plugins/claude-code/bin/squeal-launcher');
const launcher = readFileSync(source, 'utf8');
const cpuCount = cpus().length;
const initialLoad = loadavg()[0];
console.log(JSON.stringify({ at: new Date().toISOString(), node: process.version,
  packageVersion: JSON.parse(readFileSync(join(repo, 'package.json'))).version,
  launcherSha256: createHash('sha256').update(launcher).digest('hex'),
  cpus: cpuCount, load1: initialLoad }));
if (initialLoad > cpuCount) {
  console.log('SKIP: one-minute load exceeds CPU count');
  process.exit(0);
}
const root = mkdtempSync(join(tmpdir(), 'squeal-issue-131-'));
const write = (file, value) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
};
function fixture(name, terminal = false, blocked = false) {
  const home = join(root, name);
  const codex = join(home, 'codex');
  const data = join(codex, 'plugins/data/squeal-hearsay');
  const bin = terminal ? join(home, 'bin/squeal') : join(data, 'bin/squeal');
  const mark = terminal ? join(home, 'state/squeal/launcher-notices.json') : join(data, 'launcher-notices.json');
  write(bin, launcher);
  for (const version of ['0.1.382', '0.1.383', '0.1.384']) {
    const runtime = join(data, 'versions', version);
    write(join(runtime, 'runtime.json'), { version });
    write(join(runtime, '.codex-plugin/plugin.json'), { version });
    write(join(runtime, 'dist/cli/squeal.mjs'),
      `console.log(JSON.stringify({ syntheticRuntime: '${version}', args: process.argv.slice(2) }));\n`);
  }
  const current = (version) => write(join(data, 'runtime/current.json'), { schema: 1, version });
  const pin = (sessionId) => write(join(data, 'runtime/sessions',
    createHash('sha256').update(sessionId).digest('hex') + '.json'),
    { schema: 1, sessionId, version: '0.1.382' });
  current('0.1.383');
  pin('session-a');
  pin('session-b');
  if (blocked) mkdirSync(mark, { recursive: true }); // rename over a directory must fail, even as root.
  const env = {
    PATH: dirname(process.execPath) + ':/usr/bin:/bin', HOME: home, CODEX_HOME: codex,
    CLAUDE_CONFIG_DIR: join(home, 'claude'), XDG_DATA_HOME: join(home, 'data'),
    XDG_STATE_HOME: join(home, 'state'), CODEX_SESSION_ID: 'session-a',
  };
  return { bin, mark, env, current, pin };
}
function call(f, label, override = {}) {
  const load1 = loadavg()[0];
  if (load1 > cpuCount) throw new Error(`Probe stopped before ${label}: load ${load1} > ${cpuCount}`);
  const args = [f.bin, 'status', '--wait', '60000', 'src/example.ts'];
  const run = spawnSync('/bin/sh', args, { cwd: dirname(f.bin), env: { ...f.env, ...override },
    encoding: 'utf8', timeout: 5000 });
  const normalize = (s) => s.replaceAll(root, '<scratch>');
  console.log(JSON.stringify({ label, load1, command: ['/bin/sh', ...args.map(normalize)],
    status: run.status, stdout: normalize(run.stdout), stderr: normalize(run.stderr) }));
  assert.equal(run.status, 0);
  assert.deepEqual(JSON.parse(run.stdout), { syntheticRuntime: '0.1.382',
    args: ['status', '--wait', '60000', 'src/example.ts'] });
  return run.stderr;
}
try {
  for (const terminal of [false, true]) {
    const name = terminal ? 'terminal-writable' : 'data-writable';
    const f = fixture(name, terminal);
    assert.match(call(f, `${name}: first`), /this Codex session started on 0.1.382/);
    assert.equal(call(f, `${name}: second`), '');
    assert.equal(call(f, `${name}: third`), '');
    assert.match(call(f, `${name}: new session`, { CODEX_SESSION_ID: 'session-b' }), /plugins: Codex 0.1.383/);
    f.current('0.1.384');
    assert.match(call(f, `${name}: upgrade again`), /plugins: Codex 0.1.384/);
    assert.equal(call(f, `${name}: unchanged after upgrade`), '');
    console.log(JSON.stringify({ label: `${name}: saved marker`, value: JSON.parse(readFileSync(f.mark)) }));
  }
  const blocked = fixture('data-mark-blocked', false, true);
  for (let i = 1; i <= 3; i++) assert.match(call(blocked, `data-mark-blocked: ${i}`), /this Codex session started on 0.1.382/);
  const thread = fixture('thread-only');
  const threadEnv = { CODEX_SESSION_ID: '', CODEX_THREAD_ID: 'session-a' };
  assert.match(call(thread, 'thread-only: first', threadEnv), /this Codex session started on 0.1.382/);
  assert.equal(call(thread, 'thread-only: second', threadEnv), '');
  console.log(JSON.stringify({ label: 'thread-only: saved marker', value: JSON.parse(readFileSync(thread.mark)) }));
  console.log('PASS: 17 launcher calls; writable-state notices deduplicate; blocked-state notices repeat; pins and arguments preserved.');
} finally {
  rmSync(root, { recursive: true, force: true });
}
