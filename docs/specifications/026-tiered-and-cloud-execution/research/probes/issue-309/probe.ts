// Throwaway: real lane, import graph walker and blobs; synthetic transform/runner/transport.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir, loadavg, cpus } from 'node:os';
import { join, dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const source = (name: string) => import(pathToFileURL(resolve('src', name)).href);
const { withRemoteLane } = await source('core/runner-host/remote/lane.ts');
const { blobsAt } = await source('core/runner-host/remote/lane-compare.ts');
const { importClosure } = await source('runners/vitest/graph.ts');
const { NO_TRAITS } = await source('core/types/runner-traits.ts');
const { coreEnvironmentInputs, installedDependenciesFingerprint } = await source('core/keys/environment.ts');
const REF = { project: '', path: 'test/view.test.ts' };
const VIEW = 'src/codex-app-server-runner.ts';
const ADDED = 'src/codex-questions.ts';
const output = { version: JSON.parse(await readFile('package.json', 'utf8')).version,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  node: process.version, load: loadavg(), cpus: cpus().length, results: [] as object[] };
assert.ok(output.load[0] <= output.cpus, 'host overloaded: skip probe');

for (const mode of ['transform-error-omits-target', 'candidate-in-proof-control']) {
  const scratch = await mkdtemp(join(tmpdir(), 'squeal-issue-309-'));
  const here = join(scratch, 'here');
  const there = join(scratch, 'there');
  let lane;
  try {
    const put = async (root: string, path: string, bytes: string | Buffer) => {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), bytes);
    };
    for (const root of [here, there]) {
      await put(root, REF.path, "import '../src/codex-app-server-runner';\n");
      await put(root, VIEW, 'export const view = 0;\n');
    }
    execFileSync('git', ['init', '-q', here]);
    execFileSync('git', ['-C', here, 'add', '.']);
    execFileSync('git', ['-C', here, '-c', 'user.name=Probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'initial']);
    // Create and commit a sibling module; transport loss below is injected.
    await put(here, VIEW, "import { shell } from './codex-questions'; export const view = shell;\n");
    await put(here, ADDED, 'export const shell = 42;\n');
    execFileSync('git', ['-C', here, 'add', '.']);
    execFileSync('git', ['-C', here, '-c', 'user.name=Probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'add sibling']);
    let localRuns = 0;
    let remoteRuns = 0;
    const sends: string[][] = [];
    const evidence: object[] = [];
    const logs: string[] = [];
    const environment = async () => [{ project: '', runnerName: 'vitest', runnerVersion: 'synthetic', adapterVersion: '1', resolvedConfig: '{}', files: [] }];
    const graph = async (root: string) => {
      const project = { name: '', config: { root }, vite: { environments: { ssr: {
        moduleGraph: { getModuleById: () => undefined },
        transformRequest: async (file: string) => {
          if (file === join(root, REF.path)) return { deps: [`/${VIEW}`] };
          if (file === join(root, VIEW)) {
            if (!existsSync(join(root, ADDED))) throw new Error('Failed to resolve import "./codex-questions"');
            return { deps: [`/${ADDED}`] };
          }
          return { deps: [] };
        },
      } } } };
      const walked = await importClosure(project, [join(root, REF.path)]);
      const paths = [...walked.files, ...walked.missing].map((p: string) => relative(root, p));
      if (mode === 'candidate-in-proof-control' && !paths.includes(ADDED)) paths.push(ADDED);
      return { testFile: REF, paths };
    };
    const report = (files: unknown[]) => ({ end: 'completed', completedFiles: files, results: [], fileErrors: [], failure: null, durationMs: 1 });
    const local = { name: 'vitest', adapterVersion: '1', traits: NO_TRAITS, environment,
      invalidate: async () => ({ recreatedProjects: [] }), affected: async () => ({ direct: [REF], transitive: [] }),
      closure: async () => graph(here), enumerate: async () => [], testFiles: async () => [REF], close: async () => {},
      run: async (files: unknown[]) => { localRuns++; return report(files); } };
    const remote = { ...local, closure: async () => graph(there),
      invalidate: async (changes: {path: string}[]) => {
        sends.push(changes.map(p => p.path));
        for (const {path} of changes) await put(there, path, await readFile(join(here, path)));
        return { recreatedProjects: [] };
      },
      run: async (files: unknown[], options: { expected: Record<string, string> }) => {
        remoteRuns++;
        const paths = Object.keys(options.expected);
        const proof = await blobsAt(there, paths);
        const refused = paths.filter(p => proof[p] !== options.expected[p]);
        const missing = !existsSync(join(there, ADDED));
        evidence.push({ request: remoteRuns, expectedPaths: paths, missingOnRemote: missing, refused });
        if (refused.length) return { ...report([]), refused };
        return { ...report(files), proof, fileErrors: missing ? [{ testFile: REF,
          errors: [{ message: 'Failed to resolve import "./codex-questions"' }] }] : [] };
      },
    };
    const host = { adapter: remote, node: process.version,
      coreEnvironment: async () => coreEnvironmentInputs({ squealVersion: 'probe', installedDependencies: await installedDependenciesFingerprint(here, here), allowlist: [] }),
      blobs: async (paths: string[]) => blobsAt(there, paths), admit: async () => ({ grant: 1 }), install: async () => ({ ran: false, command: null }) };
    lane = withRemoteLane({ target: 'synthetic', whenLost: 'not-run', root: here, version: 'probe', local,
      connect: async () => host, allowlist: () => [], status: () => {}, log: (line: string) => logs.push(line),
      eager: false, awaitConnect: true, planning: 'remote' });
    await lane.environment();
    // Deliberately deliver the changed importer but withhold the newly committed sibling module.
    await lane.invalidate([{ path: VIEW, kind: 'change' }]);
    const run = { runId: mode, logDir: scratch, timeoutMs: 1000, background: true, workers: 1 };
    const first = await lane.run([REF], run);
    const repeated = await lane.run([REF], { ...run, runId: `${mode}-retry` });
    const beforeDelivery = { requests: remoteRuns, sends: sends.map(p => [...p]), firstErrors: first.fileErrors.length,
      retryErrors: repeated.fileErrors.length, firstEnd: first.end, retryEnd: repeated.end,
      firstCompleted: first.completedFiles.length, retryCompleted: repeated.completedFiles.length };
    if (mode === 'transform-error-omits-target') {
      assert.equal(first.fileErrors.length, 1);
      assert.equal(repeated.fileErrors.length, 1);
      assert.equal(remoteRuns, 2);
      assert.equal(sends.length, 1);
    } else {
      assert.equal(first.fileErrors.length, 0);
      assert.equal(repeated.fileErrors.length, 0);
      assert.equal(remoteRuns, 3);
      assert.ok(sends.some(paths => paths.includes(ADDED)));
    }
    await lane.invalidate([{ path: ADDED, kind: 'add' }]);
    const recovered = await lane.run([REF], { ...run, runId: `${mode}-delivered` });
    assert.equal(recovered.fileErrors.length, 0);
    assert.equal(recovered.completedFiles.length, 1);
    assert.equal(localRuns, 0);
    output.results.push({ mode, beforeDelivery, recoveryErrors: recovered.fileErrors.length, localRuns, sends, evidence, logs });
  } finally {
    await lane?.close();
    await rm(scratch, { recursive: true, force: true });
  }
}
console.log(JSON.stringify(output, null, 2));
