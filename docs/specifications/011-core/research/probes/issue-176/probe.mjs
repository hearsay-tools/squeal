// Throwaway probe. Runs only private empty repositories and their own daemons.
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, loadavg, cpus } from 'node:os';
import { resolve, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const repo = process.cwd();
const cli = resolve(repo, 'plugins/claude-code/dist/cli/squeal.mjs');
const preload = fileURLToPath(new URL('./preload.mjs', import.meta.url));
const emit = value => console.log(JSON.stringify(value));
const run = (args, cwd, env) => new Promise(resolveResult => {
  const start = Date.now();
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', cli, ...args], { cwd, env });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => stdout += data);
  child.stderr.on('data', data => stderr += data);
  const timeout = setTimeout(() => child.kill('SIGKILL'), 8000);
  child.on('exit', (code, signal) => {
    clearTimeout(timeout);
    resolveResult({ args, ms: Date.now() - start, code, signal, stdout, stderr });
  });
});
for (const mode of (process.argv.length > 2 ? process.argv.slice(2) : ['async', 'sync', 'lock'])) {
  const load = loadavg()[0], count = cpus().length;
  emit({ mode, at: new Date().toISOString(), node: process.version, load, cpus: count });
  if (load > count) { emit({ mode, skipped: 'load above CPU count' }); continue; }
  const root = mkdtempSync(join(tmpdir(), 'squeal-issue176-'));
  const runtime = join(root, 'runtime');
  mkdirSync(runtime, { mode: 0o700 });
  const marker = join(root, 'entered');
  const env = { ...process.env, XDG_RUNTIME_DIR: runtime, ISSUE176_ROOT: root, ISSUE176_MODE: mode };
  spawnSync('git', ['init', '-q', root]);
  writeFileSync(join(root, '.gitignore'), 'node_modules\nruntime\nentered\nlock-ready\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module', devDependencies: { vitest: '*' } }));
  writeFileSync(join(root, 'squeal.config.json'), JSON.stringify({ baseline: { onStart: 'lookup-only' }, complexity: { enabled: false }, coverage: { enabled: false } }));
  symlinkSync(join(repo, 'node_modules'), join(root, 'node_modules'));
  writeFileSync(join(root, 'vitest.config.mjs'), `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(marker)}, String(Date.now()));
${mode.startsWith('async') ? 'await new Promise(r => setTimeout(r, 14000));' : mode === 'sync' ? 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 14000);' : ''}
export default { test: { include: ['empty/**/*.test.js'] } };
`);
  spawnSync('git', ['add', '.'], { cwd: root });
  spawnSync('git', ['-c', 'user.name=Probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'fixture'], { cwd: root });
  const daemonArgs = ['--disable-warning=ExperimentalWarning', ...(mode === 'lock' ? ['--import', preload] : []), cli, 'daemon', root];
  emit({ mode, command: [process.execPath, ...daemonArgs], root });
  const daemon = spawn(process.execPath, daemonArgs, { cwd: root, env });
  let log = '';
  daemon.stdout.on('data', data => log += data);
  daemon.stderr.on('data', data => log += data);
  const kill = setTimeout(() => daemon.kill('SIGKILL'), 35000);
  try {
    const start = Date.now();
    const waitMarker = mode === 'lock' ? join(root, 'lock-ready') : marker;
    while (!existsSync(waitMarker) && daemon.exitCode === null && Date.now() - start < 12000) await sleep(50);
    emit({ mode, marker: existsSync(waitMarker), elapsedMs: Date.now() - start });
    if (mode === 'async-stop') {
      emit({ mode, earlyStop: await run(['stop'], root, env) });
      await sleep(7000);
      emit({ mode, after: await run(['status', '--json'], root, env) });
      continue;
    }
    if (mode !== 'lock') await sleep(10000);
    emit({ mode, during: await run(['status', '--json'], root, env) });
    emit({ mode, request: await run(['run', 'tests', '--wait', '1000'], root, env) });
    await sleep(mode === 'lock' ? 5000 : 4500);
    emit({ mode, after: await run(['status', '--json'], root, env) });
    emit({ mode, recoveredRequest: await run(['run', 'tests', '--wait', '1000'], root, env) });
    emit({ mode, stop: await run(['stop'], root, env) });
  } finally {
    clearTimeout(kill);
    if (daemon.exitCode === null) {
      daemon.kill('SIGTERM');
      await sleep(300);
      if (daemon.exitCode === null) daemon.kill('SIGKILL');
    }
    emit({ mode, daemonLog: log, exitCode: daemon.exitCode, signal: daemon.signalCode });
    rmSync(root, { recursive: true, force: true });
  }
}
