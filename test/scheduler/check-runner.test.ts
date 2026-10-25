import { describe, expect, it } from "vitest";
import type { CheckId, RunReport, SetupCheckId, TestFileRef } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { type CatchUpFile, catchUpRepo, catchUpSide, testFiles } from "./catch-up-fixture.js";

/*
 * Spec 016 D3 (row 016-15, review 0.1.303 B1): the runner is recorded where it
 * is known, when the run's results are stored: the runner its project's
 * environment names (`RunnerEnvironment.runnerName`), the one its key hashed,
 * with each result; a setup check's with this worktree's record. The
 * fixture's runner names itself `catch-up`.
 */

function sideOf(files: readonly CatchUpFile[]) {
  const repo = catchUpRepo(files);
  return catchUpSide(repo, repo.main, { files, hostSlots: 4, policy: RUN_MISSING });
}

describe("scheduler: a result's runner (spec 016 D3)", { timeout: 60_000 }, () => {
  it("is recorded with the results of each run, file-level check included", async () => {
    const files = testFiles(2, [], () => 50);
    const side = sideOf(files);
    side.runner.failing.add(files[1]?.path ?? "");
    await side.scheduler.start();
    await side.scheduler.idle();
    await side.scheduler.close();
    const runnerOf = (check: CheckId) => {
      const key = side.store.results.latestForCheck(check)?.key;
      return key === undefined ? undefined : side.store.checks.runnerOf(check, key);
    };
    for (const { path } of files) {
      expect(runnerOf({ kind: "test", project: "", testPath: path, fullName: "runs" })).toBe(
        "catch-up",
      );
      expect(runnerOf({ kind: "file", project: "", testPath: path })).toBe("catch-up");
    }
  });

  it("is recorded with a setup check whose run failed to start, which stores no result", async () => {
    const files = testFiles(1, [], () => 50);
    const side = sideOf(files);
    side.runner.run = async (testFiles: readonly TestFileRef[]): Promise<RunReport> => ({
      end: "completed",
      durationMs: 1,
      completedFiles: [],
      results: [],
      fileErrors: [],
      failure: "global setup setup.ts failed",
      startupFailure: {
        projects: [""],
        testFiles,
        setupFile: "setup.ts",
        error: { name: "Error", message: "no pg", stack: null, location: null, diff: null },
      },
    });
    await side.scheduler.start();
    await side.scheduler.idle();
    await side.scheduler.close();
    const setup: SetupCheckId = { kind: "setup", project: "", testPath: "setup.ts" };
    expect(side.store.knownStates.list(side.worktreeId).map((s) => s.check)).toContainEqual(setup);
    expect(side.store.checks.setupRunnerOf(side.worktreeId, setup)).toBe("catch-up");
    expect(side.store.checks.setupRunnerOf("another", setup)).toBeNull();
  });
});
