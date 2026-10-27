// Throwaway research probe. No product files or existing daemon are changed.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { cpus, availableParallelism, loadavg, tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const repo = process.cwd();
const cli = resolve(repo, 'plugins/claude-code/dist/cli/squeal.mjs');
const metadata = {
  at: new Date().toISOString(), load: loadavg(), cpus: cpus().length,
  availableParallelism: availableParallelism(), node: process.version,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  version: execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim(),
};
console.log(JSON.stringify({ metadata }));
if (metadata.load[0] > metadata.cpus) {
  console.log('Not reproduced because one-minute load exceeds CPU count.');
  process.exit(0);
}
const scratch = mkdtempSync(join(tmpdir(), 'sq110-'));
const root = join(scratch, 'repo');
const runtime = join(scratch, 'runtime');
mkdirSync(root); mkdirSync(runtime, { mode: 0o700 });
const env = { ...process.env, XDG_RUNTIME_DIR: runtime, ISSUE110_TRACE: runtime };
const emit = (event) => console.log(JSON.stringify({ at: new Date().toISOString(), ...event }));
const write = (path, text) => writeFileSync(join(root, path), text);
write('package.json', JSON.stringify({ name: 'issue-110-probe', private: true, type: 'module' }));
const config = {
  baseline: { onStart: 'lookup-then-run-missing' },
  runner: { tierSize: 1, backlogTierSize: 1, timeoutMs: 60000 },
  slow: { include: ['slow-*.test.mjs'], trigger: 'continuous', quietMs: 0, maxParallel: 1 },
  nodeTest: [{ name: 'probe', cwd: '.', node: process.execPath, include: ['*.test.mjs'] }],
  complexity: { enabled: false }, coverage: { enabled: false },
};
write('squeal.config.json', JSON.stringify(config));
emit({ config, root, runtime });
for (const name of ['fast-a', 'fast-b', 'fast-c', 'slow-a', 'slow-z']) {
  write(`${name}.test.mjs`, `import { test } from 'node:test';
import { appendFileSync, existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
const name = ${JSON.stringify(name)};
test(name, async () => {
  const dir = process.env.ISSUE110_TRACE;
  const event = (phase) => appendFileSync(dir + '/events.jsonl', JSON.stringify({ name, phase, at: Date.now() }) + '\\n');
  event('start');
  const deadline = Date.now() + 45000;
  while (name.startsWith('fast') && !existsSync(dir + '/' + name + '.release')) {
    if (Date.now() > deadline) throw new Error('probe gate deadline');
    await delay(20);
  }
  event('end');
});
`);
}
const git = (args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
git(['init', '-q']); git(['add', '.']);
git(['-c', 'user.name=Research probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'fixture']);
const children = [];
function command(args) {
  emit({ command: [process.execPath, cli, ...args], cwd: root });
  const child = spawn(process.execPath, [cli, ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (data) => { stdout += data; });
  child.stderr.on('data', (data) => { stderr += data; });
  const done = new Promise((res, rej) => {
    child.on('error', rej);
    child.on('close', (code, signal) => res({ args, code, signal, stdout, stderr }));
  });
  return { child, done };
}
const events = () => existsSync(join(runtime, 'events.jsonl'))
  ? readFileSync(join(runtime, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
async function until(predicate, label) {
  const deadline = Date.now() + 20000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`deadline: ${label}`);
    await delay(50);
  }
}
async function snapshot(label) {
  const result = await command(['status', '--json', 'slow-z.test.mjs']).done;
  if (!result.stdout.trim().startsWith('{')) throw new Error(JSON.stringify(result));
  const value = JSON.parse(result.stdout);
  emit({ label, code: result.code, revision: value.revision, daemon: value.daemon,
    slowTier: value.slowTier, selection: value.selection, testFileCounts: value.testFileCounts, events: events() });
  return value;
}
const daemon = command(['daemon', root]);
try {
  await until(() => events().some((e) => e.name.startsWith('fast') && e.phase === 'start'), 'first fast start');
  const first = events().find((e) => e.phase === 'start').name;
  await snapshot('first fast tier held');
  const wait = command(['status', '--json', '--wait', '4000', 'slow-z.test.mjs']);
  await delay(1000);
  await snapshot('named wait open before release');
  writeFileSync(join(runtime, `${first}.release`), 'release');
  await until(() => events().filter((e) => e.name.startsWith('fast') && e.phase === 'start').length >= 2, 'second fast start');
  const afterFirst = await snapshot('current tier ended; next fast tier held');
  assert.equal(events().some((e) => e.name.startsWith('slow')), false);
  assert.equal(afterFirst.slowTier.activity.for, 'fast');
  const timeout = await wait.done;
  emit({ namedWait: timeout });
  assert.equal(timeout.code, 3);
  const finalWait = command(['status', '--json', '--wait', '20000', 'slow-z.test.mjs']);
  await delay(1000);
  for (const name of ['fast-a', 'fast-b', 'fast-c']) writeFileSync(join(runtime, `${name}.release`), 'release');
  const settled = await finalWait.done;
  emit({ drainedWait: settled });
  assert.equal(settled.code, 0);
  await until(() => events().some((e) => e.name === 'slow-a' && e.phase === 'end'), 'unnamed slow control');
  const trace = events();
  emit({ trace, finalLoad: loadavg() });
  assert.equal(trace.filter((e) => e.phase === 'start' && e.name.startsWith('slow'))[0].name, 'slow-z');
  assert.ok(trace.findIndex((e) => e.name.startsWith('slow')) > trace.findLastIndex((e) => e.name.startsWith('fast')));
  emit({ verdict: 'REPRODUCED: named slow wait stays behind subsequent fast backlog tiers; named slow file leads slow lane after fast drain.' });
} finally {
  for (const name of ['fast-a', 'fast-b', 'fast-c']) writeFileSync(join(runtime, `${name}.release`), 'cleanup');
  emit({ cleanup: await command(['stop', root]).done });
  if (daemon.child.exitCode === null) daemon.child.kill('SIGTERM');
  emit({ daemon: await daemon.done });
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  rmSync(scratch, { recursive: true, force: true });
}
