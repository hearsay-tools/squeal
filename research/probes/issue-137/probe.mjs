// Throwaway issue 137 probe. Starts only a private three-file fixture.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
const repo = process.cwd();
const cli = resolve('plugins/claude-code/dist/cli/squeal.mjs');
const emit = (data) => console.log(JSON.stringify({ at: new Date().toISOString(), ...data }));
const metadata = { node: process.version, load: loadavg(), cpus: cpus().length,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  version: execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim(),
  vitest: JSON.parse(readFileSync('node_modules/vitest/package.json', 'utf8')).version };
emit({ metadata });
if (metadata.load[0] > metadata.cpus) { emit({ skipped: 'one-minute load above CPU count' }); process.exit(0); }
const scratch = mkdtempSync(join(tmpdir(), 'sq137-'));
const root = join(scratch, 'repo'), runtime = join(scratch, 'runtime');
mkdirSync(root); mkdirSync(runtime, { mode: 0o700 }); mkdirSync(join(root, 'node_modules'));
symlinkSync(join(repo, 'node_modules/vitest'), join(root, 'node_modules/vitest'));
const env = { ...process.env, XDG_RUNTIME_DIR: runtime, ISSUE137_TRACE: runtime };
const write = (path, value) => writeFileSync(join(root, path), value);
write('.gitignore', 'node_modules/\n');
write('package.json', JSON.stringify({ name: 'issue-137-probe', private: true, type: 'module' }));
write('vitest.config.ts', 'export default { test: { include: ["*.test.ts"], maxWorkers: 1, testTimeout: 45000 } };\n');
const config = { baseline: { onStart: 'lookup-then-run-missing' }, runner: { tierSize: 1, backlogTierSize: 1, timeoutMs: 60000 },
  slow: { include: ['slow.test.ts'], trigger: 'continuous', quietMs: 0, maxParallel: 1, maxWorkers: 1 },
  inputs: { 'slow.test.ts': ['guide.md'] }, complexity: { enabled: false }, coverage: { enabled: false } };
write('squeal.config.json', JSON.stringify(config));
write('lib.ts', '// original note\nexport const value: number = 1;\n');
write('guide.md', 'baseline\n');
for (const name of ['fast-a', 'fast-b', 'slow']) {
  write(`${name}.test.ts`, `import { it, expect } from 'vitest';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
${name === 'slow' ? '' : "import { value } from './lib.ts';"}
it('${name}', async () => {
  const dir = process.env.ISSUE137_TRACE!;
  const phase = readFileSync(dir + '/phase', 'utf8');
  const event = (state: string) => appendFileSync(dir + '/events.jsonl', JSON.stringify({ name: '${name}', phase, state, value: ${name === 'slow' ? "readFileSync('guide.md', 'utf8')" : 'value'}, at: Date.now() }) + '\\n');
  event('start');
  const deadline = Date.now() + 40000;
  while (${name !== 'slow'} && !existsSync(dir + '/' + phase + '-${name}.release')) {
    if (Date.now() > deadline) throw new Error('probe gate deadline');
    await delay(25);
  }
  event('end');
  ${name === 'slow' ? "expect(readFileSync('guide.md', 'utf8')).not.toBe('');" : 'expect(value).toBe(1);'}
});\n`);
}
const git = (args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=Research probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'fixture']);
emit({ root, runtime, config });
const children = [];
function command(args) {
  emit({ command: [process.execPath, cli, ...args], cwd: root });
  const child = spawn(process.execPath, [cli, ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child); let stdout = '', stderr = '';
  child.stdout.on('data', (x) => { stdout += x; }); child.stderr.on('data', (x) => { stderr += x; });
  return { child, done: new Promise((res, rej) => { child.on('error', rej); child.on('close', (code, signal) => res({ args, code, signal, stdout, stderr })); }) };
}
const events = () => existsSync(join(runtime, 'events.jsonl')) ? readFileSync(join(runtime, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
async function until(predicate, label) { const end = Date.now() + 45000; while (!predicate()) { if (Date.now() > end) throw new Error(`deadline: ${label}`); await delay(50); } }
const keys = () => { const db = new DatabaseSync(join(root, '.git/squeal/store.sqlite'), { readOnly: true }); try { return db.prepare('SELECT path,key,revision,pending FROM test_file_keys ORDER BY path').all(); } finally { db.close(); } };
async function snapshot(label) { const result = await command(['status', '--json', 'slow.test.ts']).done; const state = JSON.parse(result.stdout); emit({ label, code: result.code, revision: state.revision, slowTier: state.slowTier, keys: keys(), events: events() }); return state; }
const release = (phase, name) => writeFileSync(join(runtime, `${phase}-${name}.release`), 'release');
writeFileSync(join(runtime, 'phase'), 'baseline');
for (const name of ['fast-a', 'fast-b']) release('baseline', name);
const daemon = command(['daemon', root]);
try {
  await until(() => events().some((e) => e.name === 'slow' && e.state === 'end'), 'baseline');
  await until(() => keys().every((k) => k.pending === null), 'baseline recorded');
  await snapshot('baseline current'); let previous = keys();
  writeFileSync(join(runtime, 'phase'), 'docs-only');
  const docsAt = Date.now(); write('guide.md', 'docs-only\n');
  await until(() => events().some((e) => e.phase === 'docs-only' && e.name === 'slow' && e.state === 'end'), 'docs-only slow');
  await until(() => keys().every((k) => k.pending === null), 'docs-only recorded');
  for (const row of keys().filter((k) => k.path.startsWith('fast'))) assert.equal(row.key, previous.find((p) => p.path === row.path).key);
  assert.equal(events().some((e) => e.phase === 'docs-only' && e.name.startsWith('fast')), false);
  emit({ docsOnlyEditToSlowMs: events().find((e) => e.phase === 'docs-only' && e.name === 'slow').at - docsAt });
  await snapshot('docs-only control'); previous = keys();
  const edits = [
    ['comment', '// changed note\nexport const value: number = 1;\n'],
    ['whitespace', '// changed note\nexport   const value: number = 1;\n'],
    ['behavior', '// changed note\nexport   const value: number = 2;\n'],
  ];
  for (const [phase, source] of edits) {
    writeFileSync(join(runtime, 'phase'), phase);
    const editedAt = Date.now();
    write('lib.ts', source); write('guide.md', `${phase}\n`);
    emit({ edit: phase, source, editedAt, load: loadavg() });
    await until(() => events().some((e) => e.phase === phase && e.name.startsWith('fast') && e.state === 'start'), phase + ' first fast');
    const first = events().find((e) => e.phase === phase && e.name.startsWith('fast') && e.state === 'start').name;
    const state = await snapshot(phase + ' first fast held'); const current = keys();
    for (const row of current) assert.notEqual(row.key, previous.find((p) => p.path === row.path).key);
    assert.equal(state.slowTier.pending, 1);
    assert.equal(events().some((e) => e.phase === phase && e.name === 'slow'), false);
    release(phase, first);
    await until(() => events().some((e) => e.phase === phase && e.name.startsWith('fast') && e.name !== first && e.state === 'start'), phase + ' second fast');
    const next = await snapshot(phase + ' second fast held');
    assert.equal(next.slowTier.pending, 1);
    assert.equal(events().some((e) => e.phase === phase && e.name === 'slow'), false);
    for (const name of ['fast-a', 'fast-b']) release(phase, name);
    await until(() => events().some((e) => e.phase === phase && e.name === 'slow' && e.state === 'end'), phase + ' slow');
    await until(() => keys().every((k) => k.pending === null), phase + ' recorded');
    await snapshot(phase + ' drained');
    const trace = events().filter((e) => e.phase === phase);
    const slowStart = trace.find((e) => e.name === 'slow').at;
    const lastFastEnd = Math.max(...trace.filter((e) => e.name.startsWith('fast') && e.state === 'end').map((e) => e.at));
    assert.ok(slowStart >= lastFastEnd);
    emit({ phase, editToSlowMs: slowStart - editedAt, finalFastEndToSlowMs: slowStart - lastFastEnd, trace });
    previous = keys();
  }
  const finalStatus = await command(['status', '--json', '--wait', '10000', 'lib.ts', 'slow.test.ts']).done;
  emit({ finalStatus });
  assert.equal(finalStatus.code, 1);
  const final = JSON.parse(finalStatus.stdout);
  assert.equal(final.knownFailures.length, 2);
  assert.equal(final.counts.pending, 0);
  assert.equal(final.slowTier.current, 1);
  emit({ verdict: 'REPRODUCED: both byte-only edits re-key both fast importers; slow waits through both fast tiers. Behavior control executes value 2.', finalLoad: loadavg() });
} finally {
  for (const phase of ['baseline', 'comment', 'whitespace', 'behavior']) for (const name of ['fast-a', 'fast-b']) release(phase, name);
  emit({ cleanup: await command(['stop', root]).done });
  if (daemon.child.exitCode === null) daemon.child.kill('SIGTERM'); emit({ daemon: await daemon.done });
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  rmSync(scratch, { recursive: true, force: true });
}
