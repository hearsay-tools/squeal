// Throwaway issue #280 probe: real lane, protocol and tree sync; synthetic runner.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { inProcessHost, fakeAdapter, POLICY, REPORT } from '../../../../../../test/runner-host/fake-channel.js';
import { remoteHostOver } from '../../../../../../src/core/runner-host/remote/connect.js';
import { withRemoteLane } from '../../../../../../src/core/runner-host/remote/lane.js';
import { createTreeHost } from '../../../../../../src/core/runner-host/remote/tree-host.js';
import { treePaths } from '../../../../../../src/core/runner-host/remote/tree.js';

const base = mkdtempSync(join(tmpdir(), 'squeal-issue-280-'));
const file = { project: '', path: 'test/a.test.ts' };
let n = 0;
async function scenario(kind: 'closure' | 'observed' | 'setup' | 'setup-drift' | 'environment-artifact', policy: 'not-run' | 'local', artifact = 'dist/index.html') {
  const dir = join(base, String(++n));
  const root = join(dir, 'local');
  const remoteRoot = join(dir, 'remote', 'root');
  const put = (at: string, path: string, text: string) => {
    mkdirSync(dirname(join(at, path)), { recursive: true });
    writeFileSync(join(at, path), text);
  };
  mkdirSync(remoteRoot, { recursive: true });
  put(root, '.gitignore', 'dist/\n');
  put(root, file.path, '// synthetic runner file\n');
  put(root, 'vitest.config.ts', 'export default {};\n');
  put(root, 'vitest.setup.ts', '// setup v1\n');
  put(root, artifact, 'local build v1\n');
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'add', '.']);
  const env = { project: '', runnerName: 'vitest', runnerVersion: '5.0.3', adapterVersion: 'fake-1', resolvedConfig: '{}', files: ['vitest.config.ts', 'vitest.setup.ts', ...(kind === 'environment-artifact' ? [artifact] : [])] };
  let remoteRuns = 0;
  let localRuns = 0;
  const common = {
    environment: async () => [env],
    testFiles: async () => [file],
    closure: async () => ({ testFile: file, paths: [file.path, ...(kind === 'closure' ? [artifact] : [])] }),
  };
  const remoteAdapter = fakeAdapter({
    ...common,
    run: async (files) => {
      remoteRuns++;
      if (kind === 'observed') put(remoteRoot, artifact, 'remote build v1\n');
      return { ...REPORT, completedFiles: [...files], ...(kind === 'observed' ? { observed: [{ testFile: file, paths: [artifact], directories: [] }] } : {}) };
    },
  });
  const local = fakeAdapter({ ...common, run: async (files) => { localRuns++; return { ...REPORT, completedFiles: [...files] }; } });
  const host = inProcessHost(async () => remoteAdapter, '0.0.0-probe', { tree: createTreeHost(remoteRoot, () => {}) });
  const statuses: string[] = [];
  const logs: string[] = [];
  const lane = withRemoteLane({
    target: 'mock-agent37', whenLost: policy, root, version: '0.0.0-probe', local,
    connect: () => remoteHostOver(host.channel, process.version, { target: { destination: 'mock-agent37' }, version: '0.0.0-probe', root, runner: 'vitest', options: { childEnv: {} }, policy: () => POLICY }),
    allowlist: () => [], status: (text) => statuses.push(text), log: (text) => logs.push(text),
    planning: 'remote', lanes: ['background'], awaitConnect: true,
  });
  const run = () => lane.run([file], { runId: `probe-${n}-${remoteRuns}`, logDir: join(dir, 'logs'), timeoutMs: 5000, background: true, workers: 1, lane: 'vitest' });
  try {
    const deadline = Date.now() + 5000;
    while (!statuses.some((s) => / go there|refused|unreachable/.test(s))) {
      assert.ok(Date.now() < deadline, 'connect deadline');
      await new Promise((r) => setTimeout(r, 5));
    }
    if (kind === 'setup' || kind === 'setup-drift') {
      const baseline = await run();
      assert.equal(baseline.end, 'completed');
      put(root, 'vitest.setup.ts', '// setup v2\n');
      await lane.invalidate([{ path: 'vitest.setup.ts', kind: 'change' }]);
      assert.equal(readFileSync(join(remoteRoot, 'vitest.setup.ts'), 'utf8'), '// setup v2\n');
      if (kind === 'setup-drift') put(remoteRoot, 'vitest.setup.ts', '// remote diverged\n');
    } else {
      put(root, artifact, 'local build v2\n');
      await lane.invalidate([{ path: artifact, kind: 'change' }]);
    }
    const result = await run();
    const expectedRefusal = kind !== 'setup' && policy === 'not-run';
    assert.equal(result.end, expectedRefusal ? 'crashed' : 'completed');
    if (expectedRefusal) {
      assert.equal(result.completedFiles.length, 0);
      assert.equal(localRuns, 0);
      assert.match(result.failure ?? '', /not run here \(whenLost "not-run"\)/);
      assert.match(result.failure ?? '', kind === 'closure' || kind === 'observed' ? /its tree stayed different/ : /config and setup files differ/);
    }
    if (policy === 'local' && kind !== 'setup') assert.equal(localRuns, 1);
    console.log(JSON.stringify({ kind, policy, artifact, listedForSync: (await treePaths(root)).includes(artifact), end: result.end, completedFiles: result.completedFiles.length, remoteRuns, localRuns, failure: result.failure, retries: logs.filter((s) => s.includes('sending again')).length }));
  } finally {
    await lane.close();
    host.channel.endInput();
    await host.served;
  }
}
try {
  for (const artifact of ['dist/index.html', 'dist/hsq.js']) await scenario('closure', 'not-run', artifact);
  await scenario('observed', 'not-run');
  await scenario('closure', 'local');
  await scenario('setup', 'not-run');
  await scenario('setup-drift', 'not-run');
  await scenario('setup-drift', 'local');
  await scenario('environment-artifact', 'not-run');
} finally { rmSync(base, { recursive: true, force: true }); }
