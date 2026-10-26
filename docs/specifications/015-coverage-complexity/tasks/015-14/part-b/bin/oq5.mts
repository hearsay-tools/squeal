// 015-14 part B, open question 5: one run of a test-file list through 0.1.349's Vitest adapter
// with Squeal's provider, each completed file's payload built into its record as the writer does.
// Usage: tsx oq5.mts <squeal src root> <project root> <list file> <temp dir> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [src = "", root = "", list = "", tempDir = "", out = ""] = process.argv.slice(2);
const { createVitestAdapter } = await import(join(src, "src/runners/vitest/index.ts"));
const { buildRecord, coverageProvider } = await import(join(src, "src/core/code/coverage/index.ts"));

const files = readFileSync(list, "utf8").split("\n").filter(Boolean);
const runs: { files: { testFile: { path: string }; payload: string }[] }[] = [];
const provider = coverageProvider();
if (provider === null) throw new Error("no provider beside the sources");
const adapter = await createVitestAdapter({
  root,
  maxWorkers: 4,
  coverage: { enabled: () => true, provider, tempDir, collected: (run: never) => runs.push(run) },
});
const started = performance.now();
const report = await adapter.run(
  files.map((path) => ({ project: "", path })),
  { runId: "oq5", logDir: join(tempDir, "logs"), timeoutMs: null },
);
const ran = performance.now() - started;
await new Promise((resolve) => setTimeout(resolve, 3000));
const blobs = new Map();
const records: Record<string, unknown> = {};
for (const run of runs) {
  for (const file of run.files) {
    const payload = JSON.parse(readFileSync(file.payload, "utf8")).result;
    records[file.testFile.path] = buildRecord(file as never, payload, "sha1", blobs);
  }
}
await adapter.close();
const outcomes: Record<string, Record<string, number>> = {};
for (const r of report.results) {
  const o = (outcomes[r.check.testPath] ??= {});
  o[r.outcome] = (o[r.outcome] ?? 0) + 1;
}
writeFileSync(out, JSON.stringify({ completed: report.completedFiles.map((f: { path: string }) => f.path), end: report.end, outcomes, records }));
console.log(`RESULT completed=${report.completedFiles.length} records=${Object.keys(records).length} run_ms=${Math.round(ran)}`);
