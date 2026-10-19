// Throwaway research probe: real core scheduler/store, synthetic runner, no tests executed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { join } from 'node:path';
import { createScheduler } from '../../../src/core/scheduler/scheduler.ts';
import { createStateSink } from '../../../src/core/state/sink.ts';
import { openStore, storePaths } from '../../../src/core/store/index.ts';
import { worktreeIdFor } from '../../../src/core/fs/index.ts';
import { DEFAULT_POLICY } from '../../../src/core/types/index.ts';
import { readHead } from '../../../src/core/daemon-loop/head.ts';
import { createFsHasher } from '../../../src/core/hash/index.ts';
import { statCandidates } from '../../../src/core/revision/index.ts';
import { buildSnapshot } from '../../../src/core/status/snapshot.ts';
import { formatStatus } from '../../../src/core/status/format-status.ts';
import { waitLine } from '../../../src/cli/status-wait-lines.ts';
import { waitsText } from '../../../src/core/retry/text.ts';
import { workLine } from '../../../src/core/status/work-line.ts';

const load = loadavg()[0];
const cpus = availableParallelism();
console.log(JSON.stringify({ node: process.version, version: JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url))).version, load, cpus }));
if (load > cpus) { console.log('SKIPPED: one-minute load exceeds CPU count'); process.exit(0); }
const scratch = new URL('.tmp/', import.meta.url);
mkdirSync(scratch, { recursive: true });
const dir = mkdtempSync(new URL('run-', scratch));
const main = join(dir, 'main');
const child = join(dir, 'child');
mkdirSync(main);
const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const refs = ['a.test.js', 'b.test.js', 'c.test.js', 'd.test.js'].map(path => ({ project: '', path }));
const packages = { imports: [], builtins: [] };
const schedulers = [];
let store;
try {
  git(main, ['init', '-q']);
  writeFileSync(join(main, 'helper.js'), 'export const value = 1;\n');
  for (const ref of refs) writeFileSync(join(main, ref.path), '// synthetic test file\n');
  writeFileSync(join(main, 'squeal.config.json'), JSON.stringify({ baseline: { onStart: 'lookup-only' } }));
  git(main, ['add', '.']);
  git(main, ['-c', 'user.name=Probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'fixture']);
  const commonDir = join(main, '.git');
  store = openStore(commonDir);
  assert.ok(!('reason' in store));
  function rig(root, listed, onStart) {
    const id = worktreeIdFor(root);
    const runs = [];
    const errors = [];
    const runner = {
      name: 'probe', adapterVersion: '1',
      invalidate: async () => ({ recreated: false }),
      affected: async paths => ({ direct: paths.includes('helper.js') ? [refs[0]] : [], transitive: [] }),
      closure: async ref => ({ testFile: ref, paths: [ref.path, ...(ref.path === 'a.test.js' ? ['helper.js'] : [])], packages }),
      enumerate: async () => [],
      testFiles: async () => listed,
      environment: async () => [{ project: '', runnerName: 'probe', runnerVersion: '1', adapterVersion: '1', resolvedConfig: '{}', files: [], packages }],
      run: async files => {
        runs.push(files.map(f => f.path));
        return { end: 'completed', durationMs: 1, completedFiles: files, fileErrors: [], failure: null,
          results: files.map(f => ({ check: { kind: 'test', project: '', testPath: f.path, fullName: 'synthetic pass' }, outcome: 'pass', durationMs: 1, location: null, errors: [] })) };
      },
      close: async () => {},
    };
    const now = Date.now();
    store.worktrees.upsert({ id, root, commonDir, isMain: root === main, registeredAt: now,
      daemon: { socketPath: join(dir, 'nonexistent.sock'), startedAt: now, heartbeatAt: now, heartbeatIntervalMs: 60000, squealVersion: '0.1.222' } });
    const scheduler = createScheduler({ root, worktreeId: id, store, runner, sink: createStateSink(store), policy: { ...DEFAULT_POLICY, baseline: { onStart } }, squealVersion: '0.1.222', runsDir: storePaths(commonDir).runsDir, head: () => readHead(root), onError: error => errors.push(String(error)) });
    schedulers.push(scheduler);
    return { scheduler, runs, errors, id, root };
  }
  function view(label, rig) {
    const snapshot = buildSnapshot(store, rig.root, Date.now());
    assert.equal(snapshot.available, true);
    const rows = store.testFileKeys.list(rig.id);
    const observed = { label, runs: rig.runs, errors: rig.errors, busy: rig.scheduler.busy(), inherited: snapshot.inherited, withoutChecks: snapshot.testFilesWithoutChecks, phases: rows.map(r => [r.testFile.path, r.pending]), runsOpen: snapshot.runsOpen, workLine: workLine(snapshot, 'squeal') };
    console.log(JSON.stringify(observed));
    assert.deepEqual(rig.errors, []);
    return snapshot;
  }
  const warm = rig(main, [refs[0]], 'lookup-then-run-missing');
  await warm.scheduler.start();
  await warm.scheduler.idle();
  assert.deepEqual(warm.runs, [['a.test.js']]);
  await warm.scheduler.close();
  git(main, ['worktree', 'add', '-q', '--detach', child]);
  const lookup = rig(child, refs, 'lookup-only');
  await lookup.scheduler.start();
  await lookup.scheduler.idle();
  const before = view('lookup-only baseline', lookup);
  assert.deepEqual(lookup.runs, []);
  assert.deepEqual(before.testFilesWithoutChecks, { pending: 0, unknown: 3 });
  assert.ok(before.inherited.count > 0);
  writeFileSync(join(child, 'helper.js'), 'export const value = 2;\n');
  await lookup.scheduler.handleBatch({ trigger: 'watch', paths: await statCandidates(['helper.js'], createFsHasher(child, 'sha1')) });
  await lookup.scheduler.idle();
  const after = view('after helper edit', lookup);
  assert.deepEqual(lookup.runs, [['a.test.js']]);
  assert.deepEqual(after.testFilesWithoutChecks, { pending: 0, unknown: 3 });
  assert.equal(after.runsOpen, 0);
  await lookup.scheduler.close();

  // Separate store-backed rendering control, with no scheduler backing these rows.
  store.testFileKeys.remove(lookup.id, refs.slice(1));
  for (let i = 0; i < 553; i++) store.testFileKeys.upsertMany([{ worktreeId: lookup.id, testFile: { project: '', path: `unrun-${i}.test.js` }, key: `synthetic-${i}`, revision: after.revision, pending: 'queued' }]);
  const queued = buildSnapshot(store, child, Date.now());
  const text = formatStatus(queued, Date.now());
  console.log('SEEDED RENDERING ONLY\n' + text.split('\n').filter(line => /Idle:|553 test files without checks|Affected checks/.test(line)).join('\n'));
  assert.equal(queued.testFilesWithoutChecks.pending, 553);
  assert.ok(text.includes('553 test files without checks queued'));
  const verdict = waitLine({ result: queued, outcome: 'quiet', waitedMs: 0, transitions: 0, edit: { since: 1, testFiles: 91, pending: 0, otherTransitions: 0 } });
  console.log(verdict);
  assert.ok(verdict.includes('553 test files without checks: 0 running, 553 queued'));
  const retry = waitsText('load', { oneMinute: 7.45, cpus: 24 });
  console.log('RETRY RENDERING ONLY: ' + retry);
  assert.ok(retry.includes('waits for the one-minute load average to fall below'));
  console.log('PASS: lookup-only scheduler keeps misses unknown; queued wording requires queued stored rows in this probe.');
} finally {
  for (const scheduler of schedulers.reverse()) await scheduler.close();
  store?.close();
  rmSync(dir, { recursive: true, force: true });
}
