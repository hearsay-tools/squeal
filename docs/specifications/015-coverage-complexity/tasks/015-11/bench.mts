// Row 015-11, goal 9: one run of a test-file list through Squeal's Vitest adapter, coverage
// off or on. With it on, every payload is also mapped to its record and encoded, as the
// records' writer does, so the CPU /usr/bin/time reports holds the mapping.
// Usage: tsx bench.mts <squeal src root> <project root> <off|on> <list file> <temp dir>
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [src = "", root = "", mode = "off", list = "", tempDir = ""] = process.argv.slice(2);
const { createVitestAdapter } = await import(join(src, "src/runners/vitest/index.ts"));
const { buildRecord, coverageProvider, encodeRecord } = await import(
  join(src, "src/core/code/coverage/index.ts")
);

const files = readFileSync(list, "utf8").split("\n").filter(Boolean);
const runs: { files: { payload: string }[] }[] = [];
const adapter = await createVitestAdapter({
  root,
  ...(mode === "on"
    ? {
        coverage: {
          enabled: () => true,
          provider: coverageProvider(),
          tempDir,
          collected: (run: never) => runs.push(run),
        },
      }
    : {}),
});
const started = performance.now();
const report = await adapter.run(
  files.map((path) => ({ project: "", path })),
  { runId: "bench", logDir: join(tempDir, "logs"), timeoutMs: null, workers: 4 },
);
const ran = performance.now() - started;
const mapStart = performance.now();
let bytes = 0;
let records = 0;
const blobs = new Map();
for (const run of runs) {
  for (const file of run.files) {
    const payload = JSON.parse(readFileSync(file.payload, "utf8")).result;
    bytes += encodeRecord(buildRecord(file, payload, "sha1", blobs)).byteLength;
    records++;
  }
}
const mapped = performance.now() - mapStart;
await adapter.close();
const outcomes: Record<string, number> = {};
for (const r of report.results) outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
console.log(
  `RESULT mode=${mode} completed=${report.completedFiles.length} outcomes=${JSON.stringify(outcomes)} ` +
    `run_ms=${Math.round(ran)} map_ms=${Math.round(mapped)} records=${records} record_bytes=${bytes}`,
);
