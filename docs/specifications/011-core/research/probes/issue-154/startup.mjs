// Throwaway probe: a real daemon with deliberately delayed Vitest config loading.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { join, resolve } from 'node:path';
import { createConnection } from 'node:net';
import { createHash } from 'node:crypto';
const repo = resolve(import.meta.dirname, '../../../../../..');
const cli = join(repo, 'plugins/claude-code/dist/cli/squeal.mjs');
const waitMs = Number(process.argv[2] ?? 60000);
const load = loadavg()[0];
console.log(JSON.stringify({ node: process.version, version: JSON.parse(readFileSync(join(repo, 'package.json'))).version, load, cpus: cpus().length, waitMs }));
if (load > cpus().length) process.exit(0);
const base = mkdtempSync('/tmp/sq154-');
const root = join(base, 'repo');
const runtime = join(base, 'rt');
mkdirSync(root); mkdirSync(runtime);
const env = { ...process.env, XDG_RUNTIME_DIR: runtime };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const emit = data => console.log(JSON.stringify(data));
function git(args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw Error(r.stderr);
}
async function run(args, timeout = 20000) {
  const started = Date.now();
  const child = spawn(process.execPath, [cli, ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', b => out += b); child.stderr.on('data', b => err += b);
  const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
  const code = await new Promise(resolve => child.once('exit', resolve));
  clearTimeout(timer);
  return { args, code, elapsedMs: Date.now() - started, out, err };
}
async function ask(socketPath, request) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let data = '';
    socket.setTimeout(2000, () => socket.destroy(new Error('socket timeout')));
    socket.on('error', reject);
    socket.once('connect', () => socket.write(JSON.stringify(request) + '\n'));
    socket.on('data', b => { data += b; if (data.includes('\n')) { socket.destroy(); resolve(JSON.parse(data)); } });
  });
}
let daemon;
let daemonLog = '';
const release = join(root, '.git', 'release');
const entered = join(root, '.git', 'entered');
try {
  git(['init', '-q']);
  symlinkSync(join(repo, 'node_modules'), join(root, 'node_modules'));
  writeFileSync(join(root, '.gitignore'), 'node_modules\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(root, 'squeal.config.json'), JSON.stringify({ baseline: { onStart: 'lookup-only' }, complexity: { enabled: false }, coverage: { enabled: false }, lint: { enabled: true, tools: ['eslint'] }, checks: [{ name: 'lint', lint: true, at: 'stop' }] }));
  writeFileSync(join(root, 'eslint.config.js'), 'export default [{files:["*.js"],rules:{}}];\n');
  writeFileSync(join(root, 'tiny.test.js'), "import {test} from 'vitest';test('tiny',()=>{});\n");
  writeFileSync(join(root, 'vitest.config.js'), `import {existsSync,writeFileSync} from 'node:fs';\nexport default async function(){writeFileSync(${JSON.stringify(entered)},'entered');const end=Date.now()+180000;while(!existsSync(${JSON.stringify(release)}) && Date.now()<end)await new Promise(r=>setTimeout(r,50));return {test:{include:['tiny.test.js'],maxWorkers:1}};}\n`);
  git(['add', '.gitignore', 'package.json', 'squeal.config.json', 'eslint.config.js', 'tiny.test.js', 'vitest.config.js']);
  git(['-c', 'user.name=probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'fixture']);
  daemon = spawn(process.execPath, [cli, 'daemon', root], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  daemon.stdout.on('data', b => daemonLog += b); daemon.stderr.on('data', b => daemonLog += b);
  for (let i = 0; i < 200 && !existsSync(entered) && daemon.exitCode === null; i++) await sleep(100);
  if (!existsSync(entered)) throw Error('config gate not reached: ' + daemonLog);
  emit({ gateEntered: true, daemonPid: daemon.pid });
  const result = await run(['run', 'lint', '--wait', String(waitMs)], waitMs + 10000);
  emit(result);
  const id = /took request ([\w-]+)/.exec(result.out)?.[1];
  const socketPath = join(runtime, `squeal-${createHash('sha256').update(root).digest('hex').slice(0, 16)}.sock`);
  if (id) emit({ beforeRelease: await ask(socketPath, { type: 'run-group-status', requestId: id }) });
  emit({ statusBeforeRelease: await run(['status', '--json']) });
  writeFileSync(release, 'go');
  if (id) {
    let last;
    for (let i = 0; i < 100; i++) {
      last = await ask(socketPath, { type: 'run-group-status', requestId: id });
      if (last.requested !== null || last.error !== null) break;
      await sleep(100);
    }
    emit({ afterRelease: last });
  }
  emit({ control: await run(['run', 'lint', '--wait', '10000']) });
} finally {
  writeFileSync(release, 'go');
  if (daemon && daemon.exitCode === null) {
    emit({ stop: await run(['stop', root]) });
    for (let i = 0; i < 50 && daemon.exitCode === null; i++) await sleep(100);
    if (daemon.exitCode === null) daemon.kill('SIGTERM');
    for (let i = 0; i < 50 && daemon.exitCode === null; i++) await sleep(100);
    if (daemon.exitCode === null) daemon.kill('SIGKILL');
  }
  emit({ daemonExit: daemon?.exitCode, daemonLog });
  rmSync(base, { recursive: true, force: true });
}
