// Throwaway: real lane and blob hashing; synthetic transport/runner only.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir, loadavg, cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const source = (name: string) => import(pathToFileURL(resolve('src', name)).href);
const { withRemoteLane } = await source('core/runner-host/remote/lane.ts');
const { blobsAt } = await source('core/runner-host/remote/lane-compare.ts');
const { NO_TRAITS } = await source('core/types/runner-traits.ts');
const { coreEnvironmentInputs, installedDependenciesFingerprint } = await source('core/keys/environment.ts');
const REF = { project: '', path: 'test/a.test.ts' };
const INPUT = 'src/input.ts';
const paths = [REF.path, INPUT];
const output = { node: process.version, load: loadavg(), cpus: cpus().length, results: [] as object[] };
assert.ok(output.load[0] <= output.cpus, 'host overloaded: skip probe');

for (const mode of ['settled-burst', 'one-racing-edit', 'two-racing-edits']) {
  const scratch = await mkdtemp(join(tmpdir(), 'squeal-issue-306-'));
  const here = join(scratch, 'here');
  const there = join(scratch, 'there');
  let lane;
  try {
    for (const root of [here, there]) {
      for (const dir of ['test', 'src']) await mkdir(join(root, dir), { recursive: true });
      await writeFile(join(root, REF.path), '// synthetic test\n');
      await writeFile(join(root, INPUT), 'export const value = 0;\n');
    }
    execFileSync('git', ['init', '-q', here]);
    execFileSync('git', ['-C', here, 'add', '.']);
    let localRuns = 0;
    let remoteRuns = 0;
    let edits = 0;
    let remaining = mode === 'one-racing-edit' ? 1 : mode === 'two-racing-edits' ? 2 : 0;
    const sends: string[][] = [];
    const logs: string[] = [];
    const evidence: object[] = [];
    const edit = async () => {
      edits++;
      // Different lengths make each stat change visible, without relying on timer resolution.
      await writeFile(join(here, INPUT), `export const value = ${edits}; // ${'x'.repeat(edits)}\n`);
    };
    const environment = async () => [{ project: '', runnerName: 'vitest', runnerVersion: '5.0.3', adapterVersion: '1', resolvedConfig: '{}', files: [] }];
    const report = (files: unknown[]) => ({ end: 'completed', completedFiles: files, results: [], fileErrors: [], failure: null, durationMs: 1 });
    const local = {
      name: 'vitest', adapterVersion: '1', traits: NO_TRAITS, environment,
      invalidate: async () => ({ recreatedProjects: [] }),
      affected: async () => ({ direct: [REF], transitive: [] }),
      closure: async (file: unknown) => ({ testFile: file, paths }),
      enumerate: async () => [], testFiles: async () => [REF], close: async () => {},
      run: async (files: unknown[]) => { localRuns++; return report(files); },
    };
    const remote = {
      ...local,
      invalidate: async (changes: {path: string}[]) => {
        sends.push(changes.map(p => p.path));
        for (const {path} of changes) await writeFile(join(there, path), await readFile(join(here, path)));
        return { recreatedProjects: [] };
      },
      run: async (files: unknown[], options: {expected: Record<string, string>}) => {
        remoteRuns++;
        const proof = await blobsAt(there, paths);
        // Deterministic watcher-lag window: edit after admission/expected hash, before reply.
        if (remaining > 0) { remaining--; await edit(); }
        const current = await blobsAt(here, paths);
        evidence.push({ request: remoteRuns, expected: options.expected[INPUT], remote: proof[INPUT], localAfter: current[INPUT] });
        const refused = paths.filter(path => proof[path] !== options.expected[path]);
        return refused.length > 0 ? { ...report([]), refused } : { ...report(files), proof };
      },
    };
    const host = {
      adapter: remote, node: process.version,
      coreEnvironment: async () => coreEnvironmentInputs({ squealVersion: 'probe', installedDependencies: await installedDependenciesFingerprint(here, here), allowlist: [] }),
      blobs: async (names: string[]) => blobsAt(there, names),
      admit: async () => ({ grant: 1 }), install: async () => ({ ran: false, command: null }),
    };
    lane = withRemoteLane({ target: 'synthetic', whenLost: 'not-run', root: here, version: 'probe', local,
      connect: async () => host, allowlist: () => [], status: () => {}, log: (line: string) => logs.push(line),
      eager: false, awaitConnect: true, planning: 'remote' });
    await lane.environment();
    if (mode === 'settled-burst') {
      for (let i = 0; i < 8; i++) await edit();
      await lane.invalidate([{ path: INPUT, kind: 'change' }]);
    }
    const run = { runId: mode, logDir: scratch, timeoutMs: 1000, background: true, workers: 1 };
    const first = await lane.run([REF], run);
    const firstRequests = remoteRuns;
    const firstSends = sends.length;
    let recovery = null;
    if (mode === 'two-racing-edits') {
      assert.match(first.failure, /its tree stayed different at src\/input.ts/);
      assert.equal(first.completedFiles.length, 0);
      assert.equal(firstRequests, 2);
      recovery = await lane.run([REF], { ...run, runId: `${mode}-settled` });
      assert.equal(recovery.end, 'completed');
      assert.equal(remoteRuns, 3);
    } else {
      assert.equal(first.end, 'completed');
      assert.equal(firstRequests, mode === 'settled-burst' ? 1 : 2);
    }
    assert.equal(localRuns, 0);
    output.results.push({ mode, edits, firstEnd: first.end, firstFailure: first.failure, firstRequests, firstSends,
      recoveryEnd: recovery?.end ?? null, remoteRequests: remoteRuns, localRuns, sends, evidence, logs });
  } finally {
    await lane?.close();
    await rm(scratch, { recursive: true, force: true });
  }
}
console.log(JSON.stringify(output, null, 2));
