// Row 013-08 probe: run a Cezar checkout's Vitest files through Squeal's
// adapter with coverage on, as the daemon does, and print each run's end and
// failure with nested causes (errorText, 9bc8358be).
//
// node --import tsx provider-load.ts <cezar-root> <out-dir> [tier=200] [rounds=1] [project] [limit]
//
// The provider is copied to <out-dir>/plugin/dist/coverage/provider.mjs, a
// path outside node_modules, as a plugin cache holds it. Slow files
// (`packages/web/e2e/`) are left out; a project name keeps that project's files only. Writes <out-dir>/runs/<n>/vitest.log
// and report.json, and a summary line per run to stdout. Rows 013-09 and
// 013-10: each run's kept payloads are mapped into records (`buildRecord`, as
// the daemon's writer does), and one record per run is printed.
// PROBE_COVERAGE=off runs the same batches with coverage off, to compare.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  buildRecord,
  type CoverageRun,
  coverageProvider,
  hasLine,
  type V8Script,
} from "../../../../../../src/core/code/coverage/index.js";
import { createVitestAdapter } from "../../../../../../src/runners/vitest/index.js";

const [root, out, tierArg, roundsArg, project, limitArg] = process.argv.slice(2);
if (root === undefined || out === undefined) throw new Error("usage: <root> <out> [tier] [rounds]");
const tier = Number(tierArg ?? 200);
const rounds = Number(roundsArg ?? 1);
const outDir = resolve(out);
const source = coverageProvider();
if (source === null) throw new Error("no provider beside the sources");
const provider = join(outDir, "plugin/dist/coverage/provider.mjs");
mkdirSync(join(outDir, "plugin/dist/coverage"), { recursive: true });
copyFileSync(source, provider);

// The daemon runs each call from the root (`inRootWhileRunning`); some tests read from it.
process.chdir(resolve(root));
const adapter = await createVitestAdapter({
  root: resolve(root),
  note: (text) => console.log(`note: ${text}`),
  observe: () => true,
  coverage: {
    enabled: () => process.env.PROBE_COVERAGE !== "off",
    provider,
    tempDir: join(outDir, "coverage-temp"),
    collected: (run) => records(run),
  },
});
/** Lines set in a record's bitset, up to 10,000. */
const count = (bits: string) =>
  Array.from({ length: 10_000 }, (_, i) => i).filter((i) => hasLine(bits, i)).length;

/** Maps each kept payload as the writer does; prints the totals and one record. */
function records(run: CoverageRun): void {
  let mapped = 0;
  let shown = false;
  for (const file of run.files) {
    const { result } = JSON.parse(readFileSync(file.payload, "utf8")) as { result: V8Script[] };
    const record = buildRecord(file, result, "sha1", new Map());
    if (record.sources.length > 0) mapped++;
    const source = record.sources.find((s) => s.path !== file.testFile.path);
    if (shown || source === undefined) continue;
    shown = true;
    console.log(
      `  record: ${file.testFile.project} ${file.testFile.path}: ${record.sources.length} sources; ${source.path} ${count(source.covered)} of ${count(source.lines)} lines covered, ${source.functions.length} functions`,
    );
  }
  console.log(`  ${run.runId}: ${run.files.length} payloads kept, ${mapped} mapped to sources`);
}

await adapter.open?.();
const files = (await adapter.testFiles())
  .filter((f) => !f.path.includes("/e2e/") && (project === undefined || f.project === project))
  .slice(0, limitArg === undefined ? undefined : Number(limitArg));
console.log(`files: ${files.length}, tier ${tier}, rounds ${rounds}`);
let n = 0;
for (let round = 0; round < rounds; round++) {
  for (let i = 0; i < files.length; i += tier) {
    const batch = files.slice(i, i + tier);
    const logDir = join(outDir, "runs", String(++n));
    mkdirSync(logDir, { recursive: true });
    const started = Date.now();
    const report = await adapter.run(batch, { runId: `probe-${n}`, logDir, timeoutMs: 900_000 });
    const s = Math.round((Date.now() - started) / 1000);
    const head = report.failure === null ? "" : ` | ${report.failure.split("\n")[0]}`;
    console.log(`run ${n}: ${batch.length} files, ${report.end}, ${s} s${head}`);
    for (const line of (report.failure ?? "").split("\n")) {
      if (line.startsWith("Caused by:")) console.log(`  ${line}`);
    }
  }
}
await adapter.close();
