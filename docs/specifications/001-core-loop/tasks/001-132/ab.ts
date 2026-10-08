// Task 001-132 evidence driver, not product code. One full-suite run of a
// repository through Squeal's own Vitest adapter, with the recorder (`on`) or
// without (`off`), delivered exactly as the daemon delivers it.
// Usage: npx tsx ab.ts <root> <on|off> <out.json> [test path ...]
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { createVitestAdapter } from "../../../../../src/runners/vitest/index.js";

const [root, mode, out, ...only] = process.argv.slice(2);
if (!root || (mode !== "on" && mode !== "off") || !out) throw new Error("usage: <root> <on|off> <out>");
const adapter = await createVitestAdapter({ root, observe: () => mode === "on" });
const files = (await adapter.testFiles()).filter((f) => only.length === 0 || only.includes(f.path));
const logDir = join(tmpdir(), `ab-${randomUUID()}`);
mkdirSync(logDir, { recursive: true });
const loadBefore = loadavg()[0];
const started = performance.now();
const report = await adapter.run(files, { runId: randomUUID(), logDir, timeoutMs: null });
const wallMs = Math.round(performance.now() - started);
const failed = new Set(
  report.results.filter((r) => r.outcome === "fail").map((r) => `${r.check.project}:${r.check.testPath}`),
);
for (const e of report.fileErrors) failed.add(`${e.testFile.project}:${e.testFile.path}`);
writeFileSync(
  out,
  JSON.stringify({
    mode,
    files: files.length,
    end: report.end,
    completed: report.completedFiles.length,
    wallMs,
    loadBefore,
    loadAfter: loadavg()[0],
    failed: [...failed].sort(),
    failures: report.results
      .filter((r) => r.outcome === "fail")
      .map((r) => ({ file: r.check.testPath, name: r.check.fullName, error: r.errors[0]?.message?.slice(0, 300) })),
    durations: Object.fromEntries(
      (report.fileDurations ?? []).map((d) => [`${d.testFile.project}:${d.testFile.path}`, d.durationMs]),
    ),
    observed: Object.fromEntries(
      (report.observed ?? []).map((o) => [
        `${o.testFile.project}:${o.testFile.path}`,
        { paths: o.paths, directories: o.directories },
      ]),
    ),
  }),
);
await adapter.close();
console.log(`${mode}: ${report.end}, ${report.completedFiles.length}/${files.length} files, ${failed.size} failing, ${wallMs} ms`);
