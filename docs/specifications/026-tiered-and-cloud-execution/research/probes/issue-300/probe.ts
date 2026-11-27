// Throwaway issue-300 probe: real lane, synthetic adapters, no remote resources.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const source = (name: string) => import(pathToFileURL(resolve(root, 'src', name)).href);
const { withRemoteLane } = await source('core/runner-host/remote/lane.ts');
const { blobsAt } = await source('core/runner-host/remote/lane-compare.ts');
const { NO_TRAITS } = await source('core/types/runner-traits.ts');
const { coreEnvironmentInputs, installedDependenciesFingerprint } = await source('core/keys/environment.ts');
const REF = { project: '', path: 'test/a.test.ts' };
const HELPER = 'e2e/describe-error.ts';
const FIXTURE = 'fixtures/golden.json';
const results = [];

for (const scenario of ['config-drift', 'persistent-proof-drift', 'repaired-proof-drift', 'added-helper']) {
  const scratch = await mkdtemp(join(tmpdir(), 'squeal-issue-300-'));
  let lane;
  try {
    execFileSync('git', ['init', '-q', scratch]);
    for (const folder of ['test', 'e2e', 'fixtures']) await mkdir(join(scratch, folder));
    await writeFile(join(scratch, REF.path), '// synthetic test\n');
    if (scenario !== 'added-helper') await writeFile(join(scratch, HELPER), 'export const helper = 1;\n');
    await writeFile(join(scratch, FIXTURE), '{"value":1}\n');
    let localRuns = 0;
    let remoteRuns = 0;
    const sends: string[][] = [];
    const logs: string[] = [];
    const statuses: string[] = [];
    let configDrift = false;
    let newHelper = false;
    let remoteHelper = true;
    const env = () => [{ project: '', runnerName: 'vitest', runnerVersion: '5.0.3', adapterVersion: '1', resolvedConfig: '{}', files: newHelper || scenario === 'config-drift' ? [HELPER] : [] }];
    const report = (files: unknown[]) => ({ end: 'completed', completedFiles: files, results: [], fileErrors: [], failure: null, durationMs: 1 });
    const local = {
      name: 'vitest', adapterVersion: '1', traits: NO_TRAITS,
      environment: async () => env(),
      invalidate: async () => ({ recreatedProjects: [] }),
      affected: async () => ({ direct: [REF], transitive: [] }),
      closure: async (file: unknown) => ({ testFile: file, paths: [REF.path, FIXTURE] }),
      enumerate: async () => [], testFiles: async () => [REF], close: async () => {},
      run: async (files: unknown[]) => { localRuns++; return report(files); },
    };
    const remote = {
      ...local,
      invalidate: async (paths: {path: string}[]) => {
        sends.push(paths.map(p => p.path));
        if (paths.some(p => p.path === HELPER)) remoteHelper = true;
        return { recreatedProjects: [] };
      },
      run: async (files: unknown[], options: {expected: object}) => {
        remoteRuns++;
        if (scenario === 'persistent-proof-drift' || (scenario === 'repaired-proof-drift' && remoteRuns === 1)) {
          return { ...report([]), refused: [FIXTURE] };
        }
        return { ...report(files), proof: options.expected };
      },
    };
    const host = {
      adapter: remote, node: process.version,
      coreEnvironment: async () => coreEnvironmentInputs({squealVersion: 'probe', installedDependencies: await installedDependenciesFingerprint(scratch, scratch), allowlist: []}),
      blobs: async (paths: string[]) => {
        const values = await blobsAt(scratch, paths);
        if (configDrift || !remoteHelper) values[HELPER] = null;
        return values;
      },
      admit: async () => ({ grant: 1 }),
      install: async () => ({ ran: false, command: null }),
    };
    lane = withRemoteLane({target: 'synthetic', whenLost: 'not-run', root: scratch, version: 'probe', local,
      connect: async () => host, allowlist: () => [], status: (s: string) => statuses.push(s), log: (s: string) => logs.push(s),
      eager: false, awaitConnect: true, planning: 'remote'});
    // Establish a healthy connection before injecting drift.
    await lane.environment();
    if (scenario === 'config-drift') configDrift = true;
    if (scenario === 'added-helper') {
      await writeFile(join(scratch, HELPER), 'export const helper = 1;\n');
      newHelper = true;
      remoteHelper = false;
      await lane.invalidate([{path: HELPER, kind: 'add'}]);
    }
    const answer = await lane.run([REF], {runId: scenario, logDir: scratch, timeoutMs: 1000, background: true, workers: 1});
    assert.equal(localRuns, 0);
    if (scenario === 'config-drift') {
      assert.match(answer.failure, /config and setup files differ: e2e\/describe-error.ts/);
      assert.equal(remoteRuns, 0);
      assert.equal(sends.length, 0);
    } else if (scenario === 'persistent-proof-drift') {
      assert.match(answer.failure, /its tree stayed different at fixtures\/golden.json/);
      assert.equal(remoteRuns, 2);
      assert.equal(sends.length, 1);
    } else {
      assert.equal(answer.end, 'completed');
      assert.equal(remoteRuns, scenario === 'repaired-proof-drift' ? 2 : 1);
    }
    results.push({scenario, end: answer.end, failure: answer.failure, remoteRunRequests: remoteRuns, localRuns, sends, logs, status: statuses.at(-1)});
  } finally {
    await lane?.close();
    await rm(scratch, {recursive: true, force: true});
  }
}
console.log(JSON.stringify(results, null, 2));
