import { describe, expect, it } from "vitest";
import type { CheckId } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { type CatchUpFile, catchUpRepo, catchUpSide, testFiles } from "./catch-up-fixture.js";

/*
 * Spec 016 D3 (row 016-15): the runner of a check is recorded where it is
 * known, when the run's results are stored: the runner its project's
 * environment names (`RunnerEnvironment.runnerName`), the one its key hashed.
 * The fixture's runner names itself `catch-up`.
 */

function sideOf(files: readonly CatchUpFile[]) {
  const repo = catchUpRepo(files);
  return catchUpSide(repo, repo.main, { files, hostSlots: 4, policy: RUN_MISSING });
}

describe("scheduler: a check's runner (spec 016 D3)", { timeout: 60_000 }, () => {
  it("is recorded with the results of each run, file-level check included", async () => {
    const files = testFiles(2, [], () => 50);
    const side = sideOf(files);
    side.runner.failing.add(files[1]?.path ?? "");
    await side.scheduler.start();
    await side.scheduler.idle();
    await side.scheduler.close();
    for (const { path } of files) {
      const test: CheckId = { kind: "test", project: "", testPath: path, fullName: "runs" };
      expect(side.store.checks.runnerOf(test)).toBe("catch-up");
      expect(side.store.checks.runnerOf({ kind: "file", project: "", testPath: path })).toBe(
        "catch-up",
      );
    }
  });
});
