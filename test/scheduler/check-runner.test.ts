import { describe, expect, it } from "vitest";
import { createDelivery, formatRegistration } from "../../src/core/delivery/index.js";
import type { RunReport, SetupCheckId, TestFileRef } from "../../src/core/types/index.js";
import { fixedStatus, liveDaemon } from "../delivery/fakes.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
  testFiles,
} from "./catch-up-fixture.js";

/*
 * Spec 016 D3 (row 016-15, review 0.1.303 B1 and its re-review): each
 * worktree's ledger records the runner of every project its commit names, the
 * one the project's environment names (`RunnerEnvironment.runnerName`) and
 * its keys hash, whether the commit holds a run's results, a lookup's or a
 * setup failure. The fixture's runner names itself `catch-up`.
 */

const SENTENCE = "No dependencies are installed in this worktree";

function sideOf(files: readonly CatchUpFile[]) {
  const repo = catchUpRepo(files);
  return catchUpSide(repo, repo.main, { files, hostSlots: 4, policy: RUN_MISSING });
}

/** `side`'s runner named as Vitest, so its keys and record name `vitest`. */
function asVitest(side: CatchUpSide): void {
  const read = side.runner.environment;
  side.runner.environment = async () =>
    (await read()).map((environment) => ({ ...environment, runnerName: "vitest" }));
}

describe("scheduler: each worktree's project runners (spec 016 D3)", { timeout: 60_000 }, () => {
  it("are recorded from a run's results", async () => {
    const files = testFiles(2, [], () => 50);
    const side = sideOf(files);
    side.runner.failing.add(files[1]?.path ?? "");
    await side.scheduler.start();
    await side.scheduler.idle();
    await side.scheduler.close();
    expect(side.store.checks.runnersOf(side.worktreeId)).toEqual(new Map([["", "catch-up"]]));
  });

  it("are recorded from a setup check whose run failed to start, which stores no result", async () => {
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
    expect(side.store.checks.runnersOf(side.worktreeId)).toEqual(new Map([["", "catch-up"]]));
  });

  it("are recorded in a worktree that only looks a Vitest failure up, whose agent is told the sentence", async () => {
    const files = testFiles(2, [], () => 50);
    const repo = catchUpRepo(files);
    const main = catchUpSide(repo, repo.main, { files, hostSlots: 4, policy: RUN_MISSING });
    const other = catchUpSide(repo, repo.other, { files, hostSlots: 4 });
    asVitest(main);
    asVitest(other);
    const failing = files[1]?.path ?? "";
    main.runner.failing.add(failing);
    await main.scheduler.start();
    await main.scheduler.idle();
    // Its one run confirming the inherited failure (011 C4 step 3) never ends: the record is the lookup's.
    other.runner.hold();
    await other.scheduler.start();

    await expect.poll(() => other.store.checks.runnersOf(other.worktreeId).get("")).toBe("vitest");
    expect(other.runner.runs.every((run) => run.endedAt === null)).toBe(true);
    liveDaemon(other.store, other.worktreeId);
    // Hashed, and no installed Node lockfile among them: Node is not installed there.
    other.store.fileHashes.upsertMany(other.worktreeId, [
      { path: "uv.lock", mtimeMs: 1, ctimeMs: 1, size: 1, inode: 1, hash: "h" },
    ]);
    const delivery = createDelivery(other.store, { status: fixedStatus() });
    const consumer = { worktreeId: other.worktreeId, sessionId: "s1", agentId: "main" };
    const text = formatRegistration(await delivery.register(consumer, { atStart: true }));
    expect(text).toContain(failing);
    expect(text).toContain(SENTENCE);
  });
});
