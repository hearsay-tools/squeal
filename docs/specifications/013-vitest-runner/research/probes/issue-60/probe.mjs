// Throwaway issue-60 probe. No product files or existing daemons are changed.
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const base = fileURLToPath(new URL('.', import.meta.url));
const root = join(base, '.runtime', `fixture-${Date.now()}`);
const cli = process.argv[2];
if (!cli) throw new Error('Pass an absolute shipped squeal.mjs path');
console.log(JSON.stringify({ timestamp: new Date().toISOString(), node: process.version, cpus: cpus().length, load: loadavg(), root }));
if (loadavg()[0] > cpus().length) { console.log('SKIPPED: one-minute load exceeds CPU count'); process.exit(0); }
mkdirSync(join(root, 'src'), { recursive: true });
const put = (path, text) => writeFileSync(join(root, path), text);
put('.gitignore', 'node_modules/\n.prepared/\n');
put('package.json', '{"name":"issue-60-probe","private":true,"type":"module"}\n');
put('src/ui.txt', 'Run activity');
put('squeal.config.json', JSON.stringify({ inputs: { 'browser-check.test.ts': ['src/**'] }, observe: { runtimeInputs: false }, runner: { tierSize: 1 }, baseline: { onStart: 'lookup-only' } }));
put('vitest.config.ts', `import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['browser-check.test.ts'], globalSetup: ['./environment.ts'], maxWorkers: 1 } });\n`);
put('environment.ts', `import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
export default async function setup(project) {
  mkdirSync('.prepared', { recursive: true });
  const text = readFileSync('src/ui.txt', 'utf8');
  writeFileSync('.prepared/index.html', text);
  appendFileSync('.prepared/events', 'setup:' + text + '\\n');
  const server = createServer((_req, res) => res.end(readFileSync('.prepared/index.html')));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  project.provide('url', 'http://127.0.0.1:' + server.address().port);
  return async () => {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    appendFileSync('.prepared/events', 'teardown:' + text + '\\n');
  };
}\n`);
put('browser-check.test.ts', `import { test, expect, inject } from 'vitest';
import { readFileSync } from 'node:fs';
test('prepared assets match declared source', async () => {
  const served = await (await fetch(inject('url'))).text();
  expect(served).toBe(readFileSync('src/ui.txt', 'utf8'));
});\n`);
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^(GIT_|VITEST|SQUEAL_|CEZ)/.test(key) || key === 'NODE_OPTIONS') delete env[key];
env.XDG_CONFIG_HOME = join(root, '.prepared/config');
const git = args => execFileSync('git', args, { cwd: root, env, encoding: 'utf8' });
git(['init', '-q']); git(['add', '.']); git(['-c','user.name=Probe','-c','user.email=probe@example.invalid','commit','-qm','fixture']);
function run(args, allowFail = false) {
  console.log('$ node --disable-warning=ExperimentalWarning ' + cli + ' ' + args.join(' '));
  try { const out = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', cli, ...args], { cwd: root, env, encoding:'utf8', timeout: 90000 }); console.log(out); return { code: 0, out }; }
  catch (e) { console.log(e.stdout?.toString(), e.stderr?.toString()); if (!allowFail) throw e; return { code: e.status, out: e.stdout?.toString() }; }
}
const daemon = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', cli, 'daemon', root], { cwd: root, env, stdio: ['ignore','pipe','pipe'] });
let daemonLog = ''; daemon.stdout.on('data', x => daemonLog += x); daemon.stderr.on('data', x => daemonLog += x);
const exited = new Promise(resolve => daemon.once('exit', (code, signal) => resolve({code,signal})));
const events = () => readFileSync(join(root, '.prepared/events'), 'utf8');
try {
  await new Promise(resolve => setTimeout(resolve, 2500));
  console.log('DAEMON_PID', daemon.pid);
  const first = run(['run', '--all', '--wait']);
  assert.equal(first.code, 0);
  console.log('FIRST_EVENTS', events());
  put('src/ui.txt', 'Session activity');
  const second = run(['run', '--all', '--wait'], true);
  console.log('SECOND_EVENTS', events());
  console.log('SECOND_ASSET', readFileSync(join(root, '.prepared/index.html'), 'utf8'));
  run(['status', '--json'], true);
  run(['why', 'prepared assets match declared source', '--json'], true);
  assert.equal(second.code, 1);
  assert.equal(events(), 'setup:Run activity\n');
  assert.equal(readFileSync(join(root, '.prepared/index.html'), 'utf8'), 'Run activity');
  // Positive control: an edit to a known recreate trigger, same daemon.
  appendFileSync(join(root, 'environment.ts'), '\n// Probe control: setup closure changed.\n');
  const control = run(['run', '--all', '--wait']);
  assert.equal(control.code, 0);
  console.log('CONTROL_EVENTS', events());
  assert.equal(events(), 'setup:Run activity\nteardown:Run activity\nsetup:Session activity\n');
  console.log('REPRODUCED: new key/current FAIL with old assets; setup-closure edit restores PASS');
} finally {
  run(['stop'], true);
  const end = await Promise.race([exited, new Promise(resolve => setTimeout(() => resolve(null), 10000))]);
  if (!end) { daemon.kill('SIGTERM'); await exited; }
  console.log('DAEMON_EXIT', end);
  console.log('FINAL_EVENTS', events());
  console.log('DAEMON_LOG', daemonLog);
  console.log('FINAL_LOAD', JSON.stringify(loadavg()));
}
