// Throwaway: private four-file fixture; no repository suite or installation.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { cpus, loadavg, tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
const repo = process.cwd();
const cli = process.env.SQUEAL_PROBE_CLI || join(homedir(), '.codex/plugins/data/squeal-hearsay/versions/0.1.565/dist/cli/squeal.mjs');
const clean = (s) => s.replaceAll(repo, '<checkout>').replaceAll(homedir(), '~');
const emit = (value) => console.log(clean(JSON.stringify({ at: new Date().toISOString(), ...value })));
const metadata = { node: process.version, load: loadavg(), cpus: cpus().length,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  version: execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim(),
  vitest: JSON.parse(readFileSync('node_modules/vitest/package.json', 'utf8')).version };
emit({ metadata });
if (metadata.load[0] > metadata.cpus) { emit({ skipped: 'one-minute load above CPU count' }); process.exit(0); }
const scratch = mkdtempSync(join(tmpdir(), 'sq248-'));
const root = join(scratch, 'repo'), runtime = join(scratch, 'runtime');
mkdirSync(root); mkdirSync(runtime, { mode: 0o700 }); mkdirSync(join(root, 'node_modules'));
symlinkSync(join(repo, 'node_modules/vitest'), join(root, 'node_modules/vitest'));
const env = { ...process.env, XDG_RUNTIME_DIR: runtime, ISSUE248_TRACE: runtime };
const write = (path, value) => writeFileSync(join(root, path), value);
write('.gitignore', 'node_modules/\n');
write('package.json', JSON.stringify({ name: 'issue-248-probe', private: true, type: 'module' }));
write('vitest.config.ts', 'export default { test: { include: ["*.test.ts"], maxWorkers: 1 } };\n');
const config = { baseline: { onStart: 'lookup-then-run-missing' }, runner: { tierSize: 1, backlogTierSize: 1, timeoutMs: 60000 },
  inputs: { 'declared.test.ts': ['lib.ts'] }, complexity: { enabled: false }, coverage: { enabled: false } };
write('squeal.config.json', JSON.stringify(config));
const baseline = '// original note\nexport type Shape = { x: number };\nexport const value = 1;\n';
write('lib.ts', baseline);
for (const name of ['importer', 'declared', 'reader', 'unrelated']) {
  write(`${name}.test.ts`, `import { it, expect } from 'vitest';
import { appendFileSync, readFileSync } from 'node:fs';
${name === 'importer' ? "import { value } from './lib.ts';" : ''}
it('${name}', () => {
 const phase = readFileSync(process.env.ISSUE248_TRACE + '/phase', 'utf8');
 const observed = ${name === 'reader' ? "readFileSync('lib.ts', 'utf8')" : name === 'importer' ? 'value' : '1'};
 appendFileSync(process.env.ISSUE248_TRACE + '/events.jsonl', JSON.stringify({ name: '${name}', phase, observed }) + '\\n');
 ${name === 'importer' ? 'expect(observed).toBe(1);' : "expect(observed).toBeTruthy();"}
});\n`);
}
const git = (args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=Research probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'fixture']);
emit({ config });
function command(args) {
  const child = spawn(process.execPath, [cli, ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; child.stdout.on('data', x => stdout += x); child.stderr.on('data', x => stderr += x);
  return { child, done: new Promise((res, rej) => { child.on('error', rej); child.on('close', (code, signal) => res({ args: args.map(a => a === root ? '<fixture>' : a), code, signal, stdout, stderr })); }) };
}
const events = () => existsSync(join(runtime, 'events.jsonl')) ? readFileSync(join(runtime, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
async function until(predicate, label) { const end = Date.now() + 45000; while (!predicate()) { if (Date.now() > end) throw new Error(`deadline: ${label}`); await delay(50); } }
const keys = () => { const db = new DatabaseSync(join(root, '.git/squeal/store.sqlite'), { readOnly: true }); try { return db.prepare('SELECT path,key,revision,pending FROM test_file_keys ORDER BY path').all(); } finally { db.close(); } };
writeFileSync(join(runtime, 'phase'), 'baseline');
const daemon = command(['daemon', root]);
try {
  await until(() => new Set(events().map(e => e.name)).size === 4, 'baseline');
  await until(() => keys().length === 4 && keys().every(k => k.pending === null), 'baseline recorded');
  let previous = keys(); emit({ phase: 'baseline', keys: previous, events: events() });
  const edits = [
    ['type', baseline.replace('x: number', 'x: string')],
    ['comment', baseline.replace('x: number', 'x: string').replace('original note', 'changed note')],
    ['behavior', baseline.replace('x: number', 'x: string').replace('original note', 'changed note').replace('value = 1', 'value = 2')],
  ];
  for (const [phase, source] of edits) {
    writeFileSync(join(runtime, 'phase'), phase); write('lib.ts', source);
    await until(() => events().some(e => e.phase === phase && e.name === 'importer'), phase + ' importer');
    emit({ phase, beforeNamedWait: keys() });
    emit({ phase, namedWait: await command(['status', '--json', '--wait', '10000', 'declared.test.ts', 'reader.test.ts', 'importer.test.ts']).done });
    await until(() => new Set(events().filter(e => e.phase === phase).map(e => e.name)).size === 3, phase + ' execution');
    await until(() => keys().every(k => k.pending === null), phase + ' recorded');
    const current = keys();
    const changedKeys = current.filter(k => k.key !== previous.find(p => p.path === k.path).key).map(k => k.path);
    assert.deepEqual(changedKeys, ['declared.test.ts', 'importer.test.ts', 'reader.test.ts']);
    assert.equal(events().some(e => e.phase === phase && e.name === 'unrelated'), false);
    const status = await command(['status', '--json', 'lib.ts']).done;
    const parsed = JSON.parse(status.stdout);
    emit({ phase, source, changedKeys, keys: current, events: events().filter(e => e.phase === phase), selection: parsed.selection, counts: parsed.counts, knownFailures: parsed.knownFailures, statusCode: status.code });
    previous = current;
  }
  emit({ verdict: 'REPRODUCED: type and comment edits re-key the value importer, declared input and observed reader; unrelated key unchanged.', finalLoad: loadavg() });
} finally {
  emit({ cleanup: await command(['stop', root]).done });
  if (daemon.child.exitCode === null) daemon.child.kill('SIGTERM'); emit({ daemon: await daemon.done });
  rmSync(scratch, { recursive: true, force: true });
}
