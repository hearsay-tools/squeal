import { describe, expect, it } from "vitest";
import type { RunOptions, RunReport, TestFileRef } from "../../src/core/types/index.js";
import { catchUpRepo, catchUpSide } from "./catch-up-fixture.js";
import { focus, focusedRows, focusing } from "./focused-fixture.js";

/*
 * Spec 011 C5 as amended 2026-10-23 (row 011-146, review 0.1.286 B2; the
 * coordinator's request 732c0c52 grants `focused-row.ts` and
 * `focused-record.ts` for this repair): a focused run's entry keeps at most
 * 50 selected checks, the failing ones first, and counts every selected
 * check's outcome before that cut, so a fail past it is never read as a pass.
 */

const F = "test/f.test.ts";
const FILE: TestFileRef = { project: "", path: F as never };

describe("a focused run of more than 50 selected checks (review 0.1.286 B2)", {
  timeout: 60_000,
}, () => {
  it("keeps the fail that came last, and counts every outcome", async () => {
    const files = [{ path: F, ms: 1, imports: [] }];
    const repo = catchUpRepo(files);
    const side = catchUpSide(repo, repo.main, {
      files,
      hostSlots: 2,
      policy: { baseline: { onStart: "lookup-only" } },
    });
    focusing(side);
    side.runner.failing.add(F);
    // The focused run reports 51 selected checks: 50 passes, then the fail.
    const run = side.runner.run.bind(side.runner);
    Object.assign(side.runner, {
      run: async (refs: readonly TestFileRef[], options: RunOptions): Promise<RunReport> => {
        const report = await run(refs, options);
        const [failed] = report.results;
        if (options.checks === undefined || failed === undefined) return report;
        const passes = Array.from({ length: 50 }, (_, i) => ({
          ...failed,
          check: { ...failed.check, fullName: `runs ${i}` },
          outcome: "pass" as const,
          errors: [],
        }));
        return {
          ...report,
          results: [...passes, failed],
          focused: [{ testFile: FILE, collected: 51, matched: 51 }],
        };
      },
    });
    await side.scheduler.start();
    await side.scheduler.idle();

    await focus(side, [FILE], ["runs"], 60_000);
    await side.scheduler.idle();

    const [row] = focusedRows(side);
    expect(row).toMatchObject({ end: "completed", matched: 51, more: 1 });
    expect(row?.checks).toHaveLength(50);
    expect(row?.checks[0]).toMatchObject({ check: { fullName: "runs" }, outcome: "fail" });
    expect(row?.outcomes).toEqual({ pass: 50, fail: 1, skip: 0 });
  });
});
