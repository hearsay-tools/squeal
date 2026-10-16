// Throwaway research fixture. No product imports, mocks, or test-suite changes.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir, loadavg, availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';

const cli = resolve(process.argv[2]);
const modules = resolve(process.argv[3] ?? 'node_modules');
const scratch = mkdtempSync(join(tmpdir(), 'squeal-issue-14-'));
const root = join(scratch, 'repo');
const control = join(scratch, 'control');
mkdirSync(root);
mkdirSync(control);
const eventsPath = join(control, 'events');
const started = performance.now();
const log = (label, value) => console.log(JSON.stringify({ ms: Math.round(performance.now() - started), label, value }));
const events = () => existsSync(eventsPath) ? readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
async function command(...args) {
  log('command', [process.execPath, '--disable-warning=ExperimentalWarning', cli, ...args]);
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', cli, ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', b => stdout += b);
  child.stderr.on('data', b => stderr += b);
  const timer = setTimeout(() => child.kill('SIGKILL'), 90000);
  const code = await new Promise((res, rej) => { child.on('error', rej); child.on('close', res); });
  clearTimeout(timer);
  log('result', { args, code, stdout, stderr });
  return { code, stdout, stderr };
}
async function until(label, predicate) {
  const deadline = Date.now() + 60000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timeout: ${label}`);
    await sleep(50);
  }
}
function rows() {
  const db = new DatabaseSync(join(root, '.git/squeal/store.sqlite'), { readOnly: true });
  try { return db.prepare('SELECT path, revision, pending FROM test_file_keys ORDER BY path').all(); }
  finally { db.close(); }
}
const release = name => writeFileSync(join(control, `${name}.release`), 'go');
log('environment', { cli, root, node: process.version, load: loadavg(), cpus: availableParallelism() });
let daemonStarted = false;
try {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'issue-14-fixture', private: true, type: 'module', devDependencies: { vitest: '^5.0.3' } }));
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n');
  symlinkSync(modules, join(root, 'node_modules'), 'dir');
  writeFileSync(join(root, 'vitest.config.mjs'), `export default { test: { include: ['*.test.mjs'], maxWorkers: 1, testTimeout: 120000 } };\n`);
  writeFileSync(join(root, 'squeal.config.json'), JSON.stringify({ baseline: { onStart: 'lookup-then-run-missing' }, runner: { tierSize: 1, backlogTierSize: 1 }, observe: { runtimeInputs: false } }));
  for (const name of ['a-running', 'b-background', 'z-selected']) {
    writeFileSync(join(root, `${name}.test.mjs`), `import { test, expect } from 'vitest';
import { appendFileSync, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
test(${JSON.stringify(name)}, async () => {
  const event = phase => appendFileSync(${JSON.stringify(eventsPath)}, JSON.stringify({ name: ${JSON.stringify(name)}, phase, at: Date.now() }) + '\\n');
  event('start');
  ${name === 'z-selected' ? '' : `while (!existsSync(${JSON.stringify(join(control, `${name}.release`))})) await sleep(25);`}
  expect(1 + 1).toBe(2);
  event('end');
});\n`);
  }
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=Research Probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'fixture');
  await command('--version');
  daemonStarted = true;
  assert.equal((await command('start')).code, 0);
  await until('a running', () => events().some(e => e.name === 'a-running' && e.phase === 'start'));
  log('before-first-wait', rows());
  const activeWait = command('status', '--wait', '60000', 'z-selected.test.mjs');
  const first = await command('status', '--wait', '1000', 'z-selected.test.mjs');
  assert.equal(first.code, 3);
  assert.equal(rows().find(r => r.path === 'z-selected.test.mjs').pending, 'queued');
  log('release-a', null);
  release('a-running');
  await until('b running', () => events().some(e => e.name === 'b-background' && e.phase === 'start'));
  assert.equal(events().some(e => e.name === 'z-selected'), false);
  log('after-tier-boundary', rows());
  const second = await command('status', '--wait', '1000', 'z-selected.test.mjs');
  assert.equal(second.code, 3);
  log('release-b', null);
  release('b-background');
  const final = await activeWait;
  assert.equal(final.code, 0);
  const before = events();
  const repeated = await command('status', '--wait', '1000', 'z-selected.test.mjs');
  assert.equal(repeated.code, 0);
  assert.deepEqual(events(), before);
  log('events', events());
  log('final-rows', rows());
  assert.deepEqual(events().filter(e => e.phase === 'start').map(e => e.name), ['a-running', 'b-background', 'z-selected']);
  log('assertions', 'PASS: both named waits timed out with selected queued; unrelated queued tier ran first; final/repeated wait current; repeated wait ran nothing');
} finally {
  release('a-running');
  release('b-background');
  if (daemonStarted) {
    const stop = await command('stop');
    if (stop.code !== 0) throw new Error(`Stop failed; retained fixture ${scratch}`);
  }
  rmSync(scratch, { recursive: true, force: true });
}
