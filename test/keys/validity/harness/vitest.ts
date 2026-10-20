import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { RunnerAdapter, RunReport, TestFileRef } from "../../../../src/core/types/index.js";
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
 * and withheld, each result's identity and outcome, the files that failed
 * to load. The reason a run gives is wording. Vitest resolves from the
 * candidate's install at both trees (`compare.ts`).
 */

const sortedRefs = (refs: readonly TestFileRef[] = []) =>
  refs.map((ref) => `${ref.project}:${ref.path}`).sort();

/** What a run's report stores, as a decision reads it. */
function storedOf(report: RunReport) {
  return {
    completed: sortedRefs(report.completedFiles),
    withheld: sortedRefs(report.withheld),
    results: report.results
      .map((r) => ({ check: JSON.stringify(r.check), outcome: r.outcome }))
      .sort((a, b) => (a.check < b.check ? -1 : a.check > b.check ? 1 : 0)),
    loadErrors: sortedRefs(report.fileErrors.map((e) => e.testFile)),
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
      const options = { runId: `validity-${at}`, logDir: join(scratch, "logs"), timeoutMs: null };
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
