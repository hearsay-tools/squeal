// Row 013-08 probe: run a Cezar checkout's Vitest files through Squeal's
// adapter with coverage on, as the daemon does, and print each run's end and
// failure with nested causes (errorText, 9bc8358be).
//
// node --import tsx provider-load.ts <cezar-root> <out-dir> [tier=200] [rounds=1] [project]
//
// The provider is copied to <out-dir>/plugin/dist/coverage/provider.mjs, a
// path outside node_modules, as a plugin cache holds it. Slow files
// (`packages/web/e2e/`) are left out; a project name keeps that project's files only. Writes <out-dir>/runs/<n>/vitest.log
// and report.json, and a summary line per run to stdout.
import { copyFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { coverageProvider } from "../../../../../../src/core/code/coverage/index.js";
import { createVitestAdapter } from "../../../../../../src/runners/vitest/index.js";

const [root, out, tierArg, roundsArg, project] = process.argv.slice(2);
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
    enabled: () => true,
    provider,
    tempDir: join(outDir, "coverage-temp"),
    collected: () => {},
  },
});
await adapter.open?.();
const files = (await adapter.testFiles()).filter(
  (f) => !f.path.includes("/e2e/") && (project === undefined || f.project === project),
);
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
