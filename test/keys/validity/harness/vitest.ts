import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describeFailure } from "../../../../src/core/state/fingerprint.js";
import type {
  CheckError,
  RunnerAdapter,
  RunReport,
  TestFileRef,
} from "../../../../src/core/types/index.js";
import { VitestAdapter } from "../../../../src/runners/vitest/adapter.js";
import { loadVitest } from "../../../../src/runners/vitest/load.js";
import { WorktreePaths } from "../../../../src/runners/vitest/paths.js";
import type { CaseOutput, VitestInput } from "../case.js";
import { writeTree } from "./shared.js";

/*
 * The `adapter:vitest` kind (011 C14, task 011-37 section 2, row 011-41):
 * the tree's Vitest adapter class over a fixture, each run held inside its
 * test files until the paths it names are heard touched, as 013-01's
 * adapter regressions run it (`test/runners/vitest/touched-scope.test.ts`).
 * What a run reports is what the scheduler stores: the files it completed
 * and withheld, each result's identity, outcome and fingerprint, the files
 * that failed to load with theirs, as `recordsForFile` stores them (review of
 * cand/0.1.232, B1). The reason a run gives is wording. Vitest resolves from the
 * candidate's install at both trees (`compare.ts`).
 */

const sortedRefs = (refs: readonly TestFileRef[] = []) =>
  refs.map((ref) => `${ref.project}:${ref.path}`).sort();

/** A file-level error's fingerprint as `recordsForFile` stores it: at its first error's location. */
const loadFingerprint = (errors: readonly CheckError[]) =>
  describeFailure(errors, errors[0]?.location ?? null).fingerprint;

const byText =
  <T>(text: (v: T) => string) =>
  (a: T, b: T) =>
    text(a) < text(b) ? -1 : text(a) > text(b) ? 1 : 0;

/** What a run's report stores, as a decision reads it: a fingerprint is compared through `sameFingerprint`. */
function storedOf(report: RunReport) {
  return {
    completed: sortedRefs(report.completedFiles),
    withheld: sortedRefs(report.withheld),
    results: report.results
      .map((r) => ({
        check: JSON.stringify(r.check),
        outcome: r.outcome,
        fingerprint:
          r.outcome === "fail" ? describeFailure(r.errors, r.location).fingerprint : null,
      }))
      .sort(byText((r) => r.check)),
    loadErrors: report.fileErrors
      .map((e) => ({
        file: `${e.testFile.project}:${e.testFile.path}`,
        fingerprint: loadFingerprint(e.errors),
      }))
      .sort(byText((e) => e.file)),
  };
}

async function until(holds: () => boolean, what: string): Promise<void> {
  for (const end = Date.now() + 60_000; !holds(); await delay(20)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
  }
}

/**
 * For coverage only: the width hints the adapter answers, which the class
 * held at the last release and `index.ts` holds since 011-40. Hints decide
 * no stored row (C14), so what they answer is dropped.
 */
function hinted(adapter: RunnerAdapter, files: readonly TestFileRef[]): void {
  const [first] = files;
  adapter.slowWidth?.(files);
  if (first !== undefined) adapter.tierWidth?.(first, 2);
}

/** A `fileEnded` callback that throws: the run must still complete (row 011-54). */
const throwing = () => {
  throw new Error("fileEnded throws (validity case)");
};

/** Runs `input`'s runs in turn on one adapter over its fixture, under `scratch`. */
export async function vitestCase(input: VitestInput, scratch: string): Promise<CaseOutput> {
  const markers = join(scratch, "markers");
  mkdirSync(markers, { recursive: true });
  const [started, hold] = [join(markers, "started"), join(markers, "hold")];
  const files = Object.fromEntries(
    Object.entries(input.files).map(([path, text]) => [
      path,
      text
        .replaceAll("$STARTED", JSON.stringify(started))
        .replaceAll("$HOLD", JSON.stringify(hold)),
    ]),
  );
  const root = writeTree(join(scratch, "worktree"), files);
  const adapter = new VitestAdapter(new WorktreePaths(root), await loadVitest(root));
  const reports: RunReport[] = [];
  try {
    await adapter.open();
    for (const [at, run] of input.runs.entries()) {
      writeFileSync(hold, "");
      rmSync(started, { force: true });
      const options = {
        runId: `validity-${at}`,
        logDir: join(scratch, "logs"),
        timeoutMs: null,
        ...(run.fileEndedThrows === true ? { fileEnded: throwing } : {}),
      };
      const report = adapter.run(run.files, options);
      await until(() => existsSync(started), "a held test file to start");
      await adapter.invalidate(run.touched.map((path) => ({ path, kind: "touch" as const })));
      rmSync(hold, { force: true });
      reports.push(await report);
      hinted(adapter, run.files);
    }
  } finally {
    rmSync(hold, { force: true });
    await adapter.close();
  }
  return {
    outputs: { runs: reports.map(storedOf) },
    wording: { failures: reports.map((r) => r.failure) },
  };
}
