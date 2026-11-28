// Throwaway: actual lane, protocol, tree sync and proof; synthetic completed runner reports.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fakeAdapter, inProcessHost, POLICY, REPORT } from '../../../../../../test/runner-host/fake-channel.js';
import { RuntimeFiles } from '../../../../../../src/core/keys/runtime-files.js';
import { remoteHostOver } from '../../../../../../src/core/runner-host/remote/connect.js';
import { withRemoteLane } from '../../../../../../src/core/runner-host/remote/lane.js';
import { createTreeHost } from '../../../../../../src/core/runner-host/remote/tree-host.js';
import { provenObserved } from '../../../../../../src/core/scheduler/proven-observed.js';

console.log(JSON.stringify({ node: process.version, load: loadavg(), cpus: cpus().length }));
assert.ok(loadavg()[0] <= cpus().length, 'skip probe above CPU count');
const base = mkdtempSync(join(tmpdir(), 'squeal-issue-313-'));
const file = { project: '', path: 'test/a.test.ts' };
let count = 0;
async function scenario(kind: 'scratch' | 'runtime' | 'input' | 'missing-unsynced' | 'retained', outcome: 'pass' | 'fail') {
  const dir = join(base, String(++count));
  const root = join(dir, 'local');
  const remoteRoot = join(dir, 'remote', 'root');
  const artifact = kind === 'runtime' ? '.ai/qa/test-env.json' : '.ai/qa/artifacts_e2e/screen.png';
  const put = (at: string, path: string, bytes: string) => {
    mkdirSync(dirname(join(at, path)), { recursive: true });
    writeFileSync(join(at, path), bytes);
  };
  mkdirSync(remoteRoot, { recursive: true });
  put(root, '.gitignore', '.ai/qa/**\n');
  put(root, file.path, '// synthetic runner\n');
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'add', '.']);
  if (kind === 'retained') put(root, artifact, 'local input\n');
  const runtime = new RuntimeFiles(kind === 'runtime' ? [{ project: '', tests: [file.path], paths: [artifact] }] : [], [], root);
  const applied = runtime.classify(file, () => undefined);
  let remoteRuns = 0;
  let localRuns = 0;
  const common = {
    environment: async () => [{ project: '', runnerName: 'vitest', runnerVersion: '5.0.3', adapterVersion: 'fake-1', resolvedConfig: '{}', files: [] }],
    testFiles: async () => [file],
    closure: async () => ({ testFile: file, paths: [file.path] }),
  };
  const remote = fakeAdapter({ ...common, run: async (files) => {
    remoteRuns++;
    put(remoteRoot, artifact, 'remote bytes\n');
    return { ...REPORT, completedFiles: [...files], results: [{
      check: { kind: 'test', project: '', testPath: file.path, fullName: 'synthetic assertion' },
      outcome, durationMs: 1, location: null,
      errors: outcome === 'pass' ? [] : [{ name: 'AssertionError', message: 'expected 1 to be 2', stack: null, location: null, diff: null }],
    }], observed: [{ testFile: file, paths: [artifact], directories: [],
      ...(kind === 'scratch' || kind === 'retained' ? { written: ['.ai/qa/artifacts_e2e'] } : {}),
    }] };
  } });
  const tree = createTreeHost(remoteRoot, () => {});
  // Compatibility simulation only: an older reply omitted optional `unsynced`.
  const host = inProcessHost(async () => remote, '0.0.0-probe', {
    tree: kind === 'missing-unsynced' ? { ...tree, unsynced: () => [] } : tree,
  });
  const logs: string[] = [];
  const statuses: string[] = [];
  const lane = withRemoteLane({
    target: 'mock-agent37', whenLost: 'not-run', root, version: '0.0.0-probe',
    local: fakeAdapter({ ...common, run: async () => { localRuns++; return REPORT; } }),
    connect: () => remoteHostOver(host.channel, process.version, { target: { destination: 'mock-agent37' }, version: '0.0.0-probe', root, runner: 'vitest', options: { childEnv: {} }, policy: () => POLICY }),
    allowlist: () => [], status: (line) => statuses.push(line), log: (line) => logs.push(line),
    planning: 'remote', lanes: ['background'], awaitConnect: true,
    provenObserved: (observed) => provenObserved({
      index: { closure: () => ({ paths: [file.path] }) },
      observedOf: () => kind === 'retained' ? [artifact] : [],
      effectiveObserved: (_ref, raw) => runtime.effective(raw, applied),
    }, root, observed),
  });
  try {
    const result = await lane.run([file], { runId: `probe-${count}`, logDir: join(dir, 'logs'), timeoutMs: 5000, background: true, workers: 1, lane: 'vitest' });
    const accepted = kind === 'scratch' || kind === 'runtime';
    assert.equal(localRuns, 0);
    assert.equal(remoteRuns, kind === 'missing-unsynced' ? 2 : 1);
    assert.equal(result.end, accepted ? 'completed' : 'crashed');
    assert.equal(result.completedFiles.length, accepted ? 1 : 0);
    assert.deepEqual(result.results.map((r) => r.outcome), accepted ? [outcome] : []);
    const resends = logs.filter((line) => line.includes('sending again')).length;
    assert.equal(resends, kind === 'missing-unsynced' ? 2 : 0);
    console.log(JSON.stringify({ kind, artifact, syntheticOutcome: outcome, remoteRuns, localRuns, resends, end: result.end, keptOutcomes: result.results.map((r) => r.outcome), completedFiles: result.completedFiles.length, failure: result.failure, logs, statuses }));
  } finally {
    await lane.close();
    host.channel.endInput();
    await host.served;
  }
}
try {
  for (const outcome of ['pass', 'fail'] as const)
    for (const kind of ['scratch', 'runtime', 'input', 'missing-unsynced', 'retained'] as const)
      await scenario(kind, outcome);
} finally { rmSync(base, { recursive: true, force: true }); }
