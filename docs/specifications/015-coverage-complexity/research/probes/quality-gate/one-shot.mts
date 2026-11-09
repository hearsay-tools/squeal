// Throwaway probe for research/quality-gate.md, Q1. Not product code.
//
// One process, no daemon, no store: Squeal's own Vitest adapter runs the
// named test files with Squeal's coverage provider, each payload is mapped
// to a record (`mapHere`), each loaded source is counted (`countFile`),
// joined (`joinCoverage`) and scored (`crapScore`).
//
// Usage (from a scratch copy whose src/ the imports read):
//   node_modules/.bin/tsx <this file> <root> <out.json> <test file>...
// Prints one JSON summary to <out.json>; timings go to stderr.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const [root, out, ...tests] = process.argv.slice(2);
if (root === undefined || out === undefined || tests.length === 0) {
  throw new Error("usage: one-shot.mts <root> <out.json> <test file>...");
}
const at = (p: string) => join(root, p);
const t0 = performance.now();
const cpu0 = process.cpuUsage();

const { createVitestAdapter } = await import(at("src/runners/vitest/index.ts"));
const { coverageProvider } = await import(at("src/core/code/coverage/runtime.ts"));
const { mapHere } = await import(at("src/core/code/coverage/mapper.ts"));
const { decodeRecord } = await import(at("src/core/code/coverage/record.ts"));
const { countFile } = await import(at("src/core/code/count/index.ts"));
const { joinCoverage } = await import(at("src/core/code/crap/join.ts"));
const { crapScore } = await import(at("src/core/code/crap/score.ts"));
const { blobHash } = await import(at("src/core/hash/blob.ts"));

const provider = coverageProvider(new URL(`file://${at("src/core/code/coverage/runtime.ts")}`));
if (provider === null) throw new Error("no provider.mjs");
const temp = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "oneshot-"));
const runs: { files: { testFile: { path: string }; payload: string; sources: Map<string, unknown> }[] }[] = [];
const adapter = await createVitestAdapter({
  root,
  coverage: { enabled: () => true, provider, tempDir: temp, collected: (run: never) => runs.push(run) },
});
const refs = tests.map((path) => ({ project: "", path }));
const logDir = join(temp, "run");
mkdirSync(logDir);
const tRun = performance.now();
const report = await adapter.run(refs, { runId: "probe", logDir, timeoutMs: 600_000, workers: 4 });
const runMs = performance.now() - tRun;

// Map every payload to a record, as the daemon's writer does, here on this thread.
const tMap = performance.now();
const blobs = new Map();
const records: { test: string; record: { sources: { path: string; blob: string }[]; unread: string[] } }[] = [];
for (const run of runs) {
  for (const file of run.files) {
    records.push({ test: file.testFile.path, record: decodeRecord(mapHere(file as never, "sha1", blobs, () => false)) });
  }
}
const mapMs = performance.now() - tMap;

// Count and join every non-test source a record names, at its current bytes.
const tJoin = performance.now();
const paths = new Set(records.flatMap((r) => r.record.sources.map((s) => s.path)));
const prefix = process.env.PROBE_PREFIX ?? "src/";
const testSelf = records.filter((r) => r.record.sources.some((s) => s.path === r.test)).length;
let functions = 0;
let joined = 0;
let ranNone = 0;
let overCc = 0;
let overCrap = 0;
let unreadSources = 0;
const sampleRows: unknown[] = [];
for (const path of [...paths].sort()) {
  if (!path.startsWith(prefix)) continue;
  const bytes = readFileSync(at(path));
  const blob = blobHash(bytes, "sha1");
  const count = await countFile(bytes.toString("utf8"), "typescript", blob);
  const sources = records.flatMap((r) => r.record.sources.filter((s) => s.path === path && s.blob === blob));
  const stale = records.some((r) => r.record.sources.some((s) => s.path === path && s.blob !== blob));
  if (stale) unreadSources++;
  const result = joinCoverage(count.functions, sources as never);
  count.functions.forEach((fn: { qualifiedName: string; complexity: number; range: { startLine: number } }, i: number) => {
    const j = result[i];
    functions++;
    if (j.ran === true) joined++;
    if (j.ran === false) ranNone++;
    const crap = crapScore(fn.complexity, j.coverage);
    if (fn.complexity > 20) overCc++;
    if (crap > 30) overCrap++;
    if (sampleRows.length < 5 || (fn.complexity > 20 && sampleRows.length < 40)) sampleRows.push({ path, name: fn.qualifiedName, line: fn.range.startLine, cc: fn.complexity, cov: j.coverage, crap });
  });
}
const joinMs = performance.now() - tJoin;
await adapter.close();
const cpu = process.cpuUsage(cpu0);
const summary = {
  end: report.end,
  completed: report.completedFiles.length,
  failed: report.results.filter((r: { outcome: string }) => r.outcome === "fail").length,
  records: records.length,
  sources: [...paths].filter((p) => p.startsWith(prefix)).length,
  testFilesInOwnRecord: testSelf,
  functions,
  ranInProcess: joined,
  ranNone,
  overCc,
  overCrap,
  unreadSources,
  ms: { total: Math.round(performance.now() - t0), run: Math.round(runMs), map: Math.round(mapMs), join: Math.round(joinMs) },
  mainProcessCpuMs: Math.round((cpu.user + cpu.system) / 1000),
  sampleRows,
};
writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
process.stderr.write(`${JSON.stringify(summary.ms)}\n`);
