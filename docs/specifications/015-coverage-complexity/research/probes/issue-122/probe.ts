// Throwaway research probe. No daemon or external project is changed.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus, loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { transformSync } from 'esbuild';
import { countFile } from '../../../../../../src/core/code/count/index.js';
import { decodeRecord, type CoverageRun } from '../../../../../../src/core/code/coverage/index.js';
import { mapHere } from '../../../../../../src/core/code/coverage/mapper.js';
import { coverageOf, fileCondition } from '../../../../../../src/core/code/crap/file.js';
import { judgeFiles } from '../../../../../../src/core/code/crap/judge.js';
import { LoaderBuild } from '../../../../../../src/core/code/crap/loaders.js';
import { includedSet } from '../../../../../../src/core/code/pass/included.js';
import { coverageChecks } from '../../../../../../src/core/code/crap/checks.js';
import { DEFAULT_POLICY } from '../../../../../../src/core/types/index.js';
import { createNodeTestAdapter } from '../../../../../../src/runners/node-test/adapter.js';

const metadata = { at: new Date().toISOString(), node: process.version,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  version: JSON.parse(readFileSync('package.json', 'utf8')).version,
  load: loadavg(), cpus: cpus().length, availableParallelism: availableParallelism() };
if (metadata.load[0] > metadata.availableParallelism) {
  console.log(JSON.stringify({ metadata, skipped: 'load exceeds CPU count' }, null, 2));
  process.exit(0);
}
const root = mkdtempSync(join(tmpdir(), 'squeal-issue-122-'));
const cleanup = `function cleanup(n: number): number {
  let total = 0;
  if (n > 0) total++;
  if (n > 1) total++;
  if (n > 2) total++;
  if (n > 3) total++;
  if (n > 4) total++;
  if (n > 5) total++;
  if (n > 6) total++;
  return total;
}`;
const files = {
  'package.json': JSON.stringify({ type: 'module' }),
  'src/helper.ts': `export ${cleanup.replace('cleanup', 'productHelper')}\n`,
  'test/e2e/delegation.test.ts': `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { productHelper } from '../../src/helper.ts';
test('packaged cleanup runs', () => {
${cleanup}
  assert.equal(cleanup(7), 7);
  assert.equal(productHelper(7), 7);
});\n`,
  'test/unit.test.mjs': `import assert from 'node:assert/strict';
import { test } from 'node:test';
test('unit only', async () => {
  if (process.env.RUN_PACKAGED === '1') await import('./e2e/delegation.test.ts');
  assert.equal(2 + 2, 4);
});\n`,
};
for (const [path, text] of Object.entries(files)) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
  if (path.endsWith('.ts')) {
    const target = join(root, 'dist', path.replace(/\.ts$/, '.mjs'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, transformSync(text, { loader: 'ts', format: 'esm' }).code.replace(/\.ts(["'])/g, '.mjs$1'));
  }
}
const manual = spawnSync(process.execPath, ['--test', 'dist/test/e2e/delegation.test.mjs'], {
  cwd: root, encoding: 'utf8', timeout: 20_000,
});
assert.equal(manual.status, 0, manual.stdout + manual.stderr);
const runs: CoverageRun[] = [];
const notes: string[] = [];
const adapter = await createNodeTestAdapter({ name: 'unit', argv: [], env: {}, include: ['test/unit.test.mjs'] }, {
  root, tempDir: join(root, 'tmp'), note: (text) => notes.push(text),
  coverage: { enabled: () => true, collected: (run) => runs.push(run) },
});
try {
  await adapter.environment();
  const listed = await adapter.testFiles();
  assert.equal(listed.length, 1);
  const ref = listed[0]!;
  const closure = await adapter.closure(ref);
  const report = await adapter.run(listed, { runId: 'issue-122', logDir: join(root, 'logs'), timeoutMs: 20_000 });
  assert.equal(report.results.length, 1);
  assert.equal(report.results[0]?.outcome, 'pass');
  const payload = runs[0]?.files[0];
  assert.ok(payload, JSON.stringify(notes));
  const record = decodeRecord(mapHere(payload, 'sha1', new Map(), () => false));
  // Supply actual adapter closures/results to LoaderBuild with an in-memory store seam.
  const loaders = new LoaderBuild({ worktreeId: 'probe', now: 100_000, writing: false,
    main: {
      testFileKeys: { list: () => [{ worktreeId: 'probe', testFile: ref, key: 'key', revision: 1, pending: null }] },
      results: { byKey: () => report.results.map(r => ({ ...r, provenance: { recordedAt: 1 } })) },
    } as never,
    closures: { key: () => 'key', closure: () => closure, environment: () => ({ runner: 'node-test', files: [] }) },
    coverage: { storedAt: () => 1 },
  }).advance(() => true)!;
  const counted = includedSet(DEFAULT_POLICY.complexity, listed.map(f => f.path), []);
  const exclude = coverageChecks({ ...DEFAULT_POLICY, coverage: { ...DEFAULT_POLICY.coverage, exclude: ['test/e2e/**'] } });
  const findings = [];
  for (const path of ['test/e2e/delegation.test.ts', 'src/helper.ts']) {
    const count = await countFile(readFileSync(join(root, path), 'utf8'), 'typescript');
    const file = { path, blob: count.blob, language: 'typescript' as const, counterVersion: count.counterVersion, size: 1, revision: 1 };
    const condition = fileCondition(loaders.of(path), loaders.listed);
    assert.equal(condition.state, 'ready');
    if (condition.state !== 'ready') throw Error('not ready');
    const coverage = coverageOf(file, count.functions, condition.loaders, () => record);
    assert.notEqual(coverage, 'unread');
    if (coverage === 'unread') throw Error('unread');
    const judged = judgeFiles({ worktreeId: 'probe', revision: 1, at: 1, threshold: 30, prior: new Map(), edits: new Map() }, [{ file, count, coverage }]);
    const target = count.functions.find(f => /cleanup|productHelper/.test(f.qualifiedName))!;
    assert.equal(target.complexity, 8);
    assert.equal(judged.states.find(s => s.check.qualifiedName === target.qualifiedName && s.measure === 'crap')?.value, 72);
    assert.equal(judged.states.find(s => s.check.qualifiedName === target.qualifiedName && s.measure === 'uncovered')?.outcome, 'fail');
    findings.push({ path, counted: counted(path), closureLoaderCount: loaders.of(path).length,
      presentInExecutionRecord: record.sources.some(s => s.path === path), condition,
      functions: count.functions, coverage, states: judged.states,
      explicitExcludeMatches: exclude.excluded(path), countedIfListedAsTest: includedSet(DEFAULT_POLICY.complexity, [path], [])(path) });
  }
  // A real second run: include the packaged source as a test, using Node 24's TS support.
  const positiveRuns: CoverageRun[] = [];
  const positiveAdapter = await createNodeTestAdapter({ name: 'packaged', argv: [], env: {}, include: ['test/e2e/delegation.test.ts'] }, {
    root, tempDir: join(root, 'tmp-positive'), note: (text) => notes.push(text),
    coverage: { enabled: () => true, collected: (run) => positiveRuns.push(run) },
  });
  let positive;
  try {
    await positiveAdapter.environment();
    const positiveListed = await positiveAdapter.testFiles();
    const positiveReport = await positiveAdapter.run(positiveListed, { runId: 'positive', logDir: join(root, 'logs-positive'), timeoutMs: 20_000 });
    assert.equal(positiveReport.results[0]?.outcome, 'pass');
    const positiveRecord = decodeRecord(mapHere(positiveRuns[0]!.files[0]!, 'sha1', new Map(), () => false));
    const path = 'src/helper.ts';
    const count = await countFile(files[path], 'typescript');
    const file = { path, blob: count.blob, language: 'typescript' as const, counterVersion: count.counterVersion, size: 1, revision: 1 };
    const coverage = coverageOf(file, count.functions, [{ testFile: positiveListed[0]!, key: 'positive', storedAt: 1 }], () => positiveRecord);
    if (coverage === 'unread') throw Error('positive unread');
    const judged = judgeFiles({ worktreeId: 'probe', revision: 1, at: 1, threshold: 30, prior: new Map(), edits: new Map() }, [{ file, count, coverage }]);
    assert.equal(judged.states.find(s => s.measure === 'crap')?.value, 8);
    assert.equal(judged.states.find(s => s.measure === 'uncovered')?.outcome, 'pass');
    positive = { listed: positiveListed, results: positiveReport.results, coverage, states: judged.states };
  } finally { await positiveAdapter.close(); }
  const missingRecord = fileCondition([{ testFile: ref, condition: { kind: 'unknown', cause: 'no-record' } }], true);
  assert.equal(missingRecord.state, 'unknown');
  console.log(JSON.stringify({ metadata, manual: { command: 'node --test dist/test/e2e/delegation.test.mjs', status: manual.status, stdout: manual.stdout, stderr: manual.stderr },
    listed, closure, results: report.results, notes, record, findings, positive, missingRecord,
    discoveryOnly: fileCondition([{ testFile: ref, condition: { kind: 'pending', reason: 'run' } }], true),
  }, null, 2));
} finally {
  await adapter.close();
  rmSync(root, { recursive: true, force: true });
}
