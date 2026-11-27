// Throwaway research probe: real lane, proof and tree transport; synthetic runner.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fakeAdapter, inProcessHost, POLICY, REPORT } from '../../../../../../test/runner-host/fake-channel.js';
import { RuntimeFiles } from '../../../../../../src/core/keys/runtime-files.js';
import { remoteHostOver } from '../../../../../../src/core/runner-host/remote/connect.js';
import { withRemoteLane } from '../../../../../../src/core/runner-host/remote/lane.js';
import { classify } from '../../../../../../src/core/runner-host/remote/lane-proof.js';
import { createTreeHost } from '../../../../../../src/core/runner-host/remote/tree-host.js';
import { readEntry, treePathsFor } from '../../../../../../src/core/runner-host/remote/tree.js';

const load = Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0]);
const cpus = Number(execFileSync('getconf', ['_NPROCESSORS_ONLN'], { encoding: 'utf8' }).trim());
console.log(JSON.stringify({ node: process.version, load, cpus }));
assert.ok(load <= cpus, 'skip live probe when one-minute load exceeds CPU count');
const base = mkdtempSync(join(tmpdir(), 'squeal-issue-304-'));
const file = { project: '', path: 'test/a.test.ts' };
let count = 0;
async function scenario(kind: 'recreated' | 'retained' | 'synced-delete' | 'local-ignored' | 'runtime' | 'written-directory', artifact: string) {
  const dir = join(base, String(++count));
  const root = join(dir, 'local');
  const remoteRoot = join(dir, 'remote', 'root');
  const put = (at: string, path: string, text: string) => {
    mkdirSync(dirname(join(at, path)), { recursive: true });
    writeFileSync(join(at, path), text);
  };
  mkdirSync(remoteRoot, { recursive: true });
  put(root, '.gitignore', '.ai/qa/**\n');
  put(root, file.path, '// synthetic runner\n');
  if (kind === 'synced-delete') put(root, artifact, 'previously synced bytes\n');
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'add', '.']);
  if (kind === 'local-ignored') put(root, artifact, 'local bytes\n');
  const rules = kind === 'runtime' ? [{ project: '', tests: [file.path], paths: [artifact] }] : [];
  const runtime = new RuntimeFiles(rules, [], root);
  const applied = runtime.classify(file, () => undefined);
  const effectiveObserved = runtime.effective([artifact], applied);
  if (kind === 'runtime') assert.deepEqual(effectiveObserved, []);
  let remoteRuns = 0;
  let localRuns = 0;
  const existsAtRunStart: boolean[] = [];
  const common = {
    environment: async () => [{ project: '', runnerName: 'vitest', runnerVersion: '5.0.3', adapterVersion: 'fake-1', resolvedConfig: '{}', files: [] }],
    testFiles: async () => [file],
    closure: async () => ({ testFile: file, paths: [file.path] }),
  };
  const remoteAdapter = fakeAdapter({ ...common, run: async (files) => {
    remoteRuns++;
    existsAtRunStart.push(existsSync(join(remoteRoot, artifact)));
    if (kind !== 'synced-delete' && (kind !== 'retained' || remoteRuns === 1)) put(remoteRoot, artifact, 'remote bytes\n');
    return { ...REPORT, completedFiles: [...files], observed: [{ testFile: file, paths: [artifact], directories: [], ...(kind === 'written-directory' ? { written: ['.ai/qa/artifacts'] } : {}) }] };
  } });
  const local = fakeAdapter({ ...common, run: async (files) => { localRuns++; return { ...REPORT, completedFiles: [...files] }; } });
  const host = inProcessHost(async () => remoteAdapter, '0.0.0-probe', { tree: createTreeHost(remoteRoot, () => {}) });
  const statuses: string[] = [];
  const logs: string[] = [];
  const lane = withRemoteLane({
    target: 'mock-agent37', whenLost: 'not-run', root, version: '0.0.0-probe', local,
    connect: () => remoteHostOver(host.channel, process.version, { target: { destination: 'mock-agent37' }, version: '0.0.0-probe', root, runner: 'vitest', options: { childEnv: {} }, policy: () => POLICY }),
    allowlist: () => [], status: (text) => statuses.push(text), log: (text) => logs.push(text),
    planning: 'remote', lanes: ['background'], awaitConnect: true,
  });
  try {
    const deadline = Date.now() + 5000;
    while (!statuses.some((text) => / go there|refused|unreachable/.test(text))) {
      assert.ok(Date.now() < deadline, 'connect deadline');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    if (kind === 'synced-delete') rmSync(join(root, artifact));
    const localBlob = (await readEntry(root, artifact))?.entry.blob ?? null;
    const inTree = await treePathsFor(root, [artifact]);
    const classified = classify([artifact], inTree, { [artifact]: localBlob });
    const result = await lane.run([file], { runId: `probe-${count}`, logDir: join(dir, 'logs'), timeoutMs: 5000, background: true, workers: 1, lane: 'vitest' });
    const repaired = kind === 'synced-delete';
    assert.equal(result.end, repaired ? 'completed' : 'crashed');
    assert.equal(result.completedFiles.length, repaired ? 1 : 0);
    assert.equal(localRuns, 0);
    assert.equal(remoteRuns, kind === 'local-ignored' ? 1 : 2);
    assert.equal(logs.filter((text) => text.includes('sending again')).length, kind === 'local-ignored' ? 0 : repaired ? 1 : 2);
    if (!repaired) assert.match(result.failure ?? '', kind === 'local-ignored' ? /git-ignored input/ : /its tree stayed different/);
    // A never-synced artifact survives removal; a previously synced file does not.
    assert.deepEqual(existsAtRunStart, repaired ? [true, false] : kind === 'local-ignored' ? [false] : [false, true]);
    console.log(JSON.stringify({ kind, artifact, localBlob, inTree: inTree.has(artifact), classified, appliedRuntime: applied, effectiveObserved, existsAtRunStart, remoteRuns, localRuns, end: result.end, completedFiles: result.completedFiles.length, failure: result.failure, logs }));
  } finally {
    await lane.close();
    host.channel.endInput();
    await host.served;
  }
}
try {
  await scenario('recreated', '.ai/qa/test-env.json');
  await scenario('runtime', '.ai/qa/test-env.json');
  await scenario('recreated', '.ai/qa/artifacts/screen.png');
  await scenario('written-directory', '.ai/qa/artifacts/screen.png');
  await scenario('recreated', '.ai/qa/build/dist/activity.js');
  await scenario('retained', '.ai/qa/test-env.json');
  await scenario('synced-delete', 'generated.json');
  await scenario('local-ignored', '.ai/qa/test-env.json');
} finally { rmSync(base, { recursive: true, force: true }); }
