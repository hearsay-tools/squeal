// Throwaway probe (row 001-348). Drives Squeal's Vitest adapter over ./fixture
// and prints what Squeal would store for each file. See README.md.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describeFailure } from "../../../../../../src/core/state/fingerprint.js";
import { recordsForFile } from "../../../../../../src/core/scheduler/records.js";
import type { CheckId, CheckKey, Provenance, TestFileRef } from "../../../../../../src/core/types/index.js";
import { createVitestAdapter } from "../../../../../../src/runners/vitest/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "fixture");
const adapter = await createVitestAdapter({ root, note: (t) => console.log(`NOTE ${t}`) });

const only = process.argv[2];
const files: TestFileRef[] = [
  ...["a-pass", "b-assert", "c-import", "d-beforeall-fetch", "e-beforeall-provider",
    "f-describe-beforeall", "g-top-level-await", "h-zero-tests", "i-bug-econnrefused",
    "j-env-in-test", "l-bug-in-beforeall"].map((n) => ({ project: "main", path: `main/${n}.test.ts` })),
  { project: "gs", path: "gs/k-under-global-setup.test.ts" },
].filter((f) => only === undefined || f.project === only);

const logDir = mkdtempSync(join(tmpdir(), "envfail-"));
const report = await adapter.run(files, { runId: "probe", logDir, timeoutMs: 60_000 });
console.log(`RUN end=${report.end} completed=${report.completedFiles.length}/${files.length}`);
if (report.failure) console.log(`RUN failure: ${report.failure.split("\n")[0]}`);

const key = "probe-key" as CheckKey;
const provenance = { worktree: "probe", revision: 1 } as unknown as Provenance;
for (const ref of files) {
  const done = report.completedFiles.some((f) => f.project === ref.project && f.path === ref.path);
  if (!done) {
    console.log(`\n${ref.path}: not completed (scheduler records unknown)`);
    continue;
  }
  const fileErr = report.fileErrors.find((e) => e.testFile.path === ref.path);
  // As stored on a first run (no checks under the previous key) ...
  const first = recordsForFile({ ref, key, report, previousChecks: [], provenance, describe: describeFailure });
  // ... and when the same key already holds the file's tests, as statically enumerated
  // (a run that passed before the environment went down).
  const known: CheckId[] = (await adapter.enumerate(ref)).map((e) => e.check);
  const again = recordsForFile({ ref, key, report, previousChecks: known, provenance, describe: describeFailure });
  console.log(`\n${ref.path}: fileErrors=${fileErr?.errors.length ?? 0}`);
  for (const r of first) {
    const name = r.check.kind === "file" ? "<file>" : r.check.fullName;
    console.log(`  ${r.outcome.toUpperCase().padEnd(4)} ${name}${r.summary ? `  | ${r.summary}` : ""}`);
  }
  const extra = again.filter((r) => r.outcome === "fail").length - first.filter((r) => r.outcome === "fail").length;
  if (extra > 0) console.log(`  (+${extra} FAIL when the key already holds ${known.length} enumerated test(s) that this run did not report)`);
  for (const e of fileErr?.errors ?? []) console.log(`  error name=${e.name} location=${e.location ? `${e.location.path}:${e.location.line}` : "none"}`);
}
console.log(`\n--- run log ${logDir}/vitest.log (file-level and unhandled lines) ---`);
const { readFileSync } = await import("node:fs");
for (const line of readFileSync(join(logDir, "vitest.log"), "utf8").split("\n")) {
  if (/^(squeal vitest|end:|MODULE|RUN END|    (file-level|unhandled|\[cause\]|Caused by|.*ECONNREFUSED))/.test(line)) console.log(line);
}
await adapter.close();
