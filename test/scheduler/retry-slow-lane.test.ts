import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { askRetry } from "../../src/core/retry/records.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";

/*
 * Row 011-323 (spec 011 `research/request-intake.md`, difference 2):
 * `squeal retry` was the only request that queued work and woke no lane.
 * Row 011-357: a slow lane lists, guards and picks inside the step's one
 * lock turn, so no retry's stage runs between its listing and its pick. A
 * retry staged before that turn (here while the step before it reads the
 * probe) queues a slow file the lane's tier takes; one staged during it
 * (here at the lane's listing) runs in the lane's next tier, once the
 * first tier ended.
 */

const S1: TestFileRef = { project: "", path: "test/e2e/s1.test.ts" };
const S2: TestFileRef = { project: "", path: "test/e2e/s2.test.ts" };
const FILES: readonly CatchUpFile[] = [
  { path: "test/a.test.ts", ms: 10, imports: ["src/core.ts"] },
  { path: S1.path, ms: 10, imports: ["src/core.ts"] },
  { path: S2.path, ms: 10, imports: ["src/other.ts"] },
];
/** What the step's turn says while the slow lane lists its queued files (row 011-357). */
const LISTING = "listing the queued files of group slow";
/** The first retry's turn: the second is staged after it. */
const TAKING = "taking squeal retry requests";

/** A started, idle scheduler whose two slow files may run in one tier, on an idle machine. */
async function slowSide(): Promise<CatchUpSide> {
  const repo = catchUpRepo(FILES);
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-011-323-slot-"));
  onTestFinished(() => rmSync(slotDir, { recursive: true, force: true }));
  const side = catchUpSide(repo, repo.main, {
    files: FILES,
    hostSlots: 8,
    policy: {
      ...RUN_MISSING,
      slow: { ...DEFAULT_POLICY.slow, include: ["test/e2e/**"], quietMs: 0, maxParallel: 2 },
    },
    scheduler: { slow: { slotDir, recheckMs: 50, cpus: () => 1, load: () => [0] } },
  });
  await side.scheduler.start();
  await expect.poll(() => FILES.every((f) => side.current(f.path))).toBe(true);
  await side.scheduler.idle();
  return side;
}

/** The agent's `squeal retry` of `ref` at its key here, as the CLI stores it. */
function ask(side: CatchUpSide, ref: TestFileRef): void {
  const row = side.store.testFileKeys
    .list(side.worktreeId)
    .find((r) => r.testFile.path === ref.path);
  if (row === undefined || row.key === null) throw new Error(`${ref.path} has no key`);
  askRetry(side.store, {
    testFile: ref,
    key: row.key,
    session: `session-${ref.path}`,
    reason: "environment",
    at: Date.now(),
    worktreeId: side.worktreeId,
  });
}

/** The second retry's stage, from the first retry on: before the lane's step, or during it. */
type Stage = (side: CatchUpSide, stage: () => void) => () => void;

/** At the step that reads the probe for the lane's step, after the first retry was taken. */
const beforeTheTurn: Stage = (side, stage) => {
  let first = false;
  const unwatch = side.scheduler.watchLock?.((holder) => {
    if (holder?.operation === TAKING) first = true;
  });
  const unstep = side.scheduler.onStep?.((seen) => {
    if (first && seen.decisions.includes("read-probe")) stage();
  });
  return () => {
    unwatch?.();
    unstep?.();
  };
};

/** At the lane's listing, inside the step's turn that starts its tier. */
const duringTheTurn: Stage = (side, stage) => {
  let first = false;
  const unwatch = side.scheduler.watchLock?.((holder) => {
    if (holder?.operation === TAKING) first = true;
    if (first && holder?.operation === LISTING) stage();
  });
  return () => unwatch?.();
};

/** The tiers that ran after a retry of S1, then of S2 staged by `at`. */
async function retried(at: Stage): Promise<string[][]> {
  const side = await slowSide();
  const from = side.runner.runs.length;
  let second: Promise<void> | null = null;
  const stop = at(side, () => {
    if (second !== null) return;
    ask(side, S2);
    second = side.scheduler.requestRetries();
  });
  try {
    ask(side, S1);
    await side.scheduler.requestRetries();
    await expect.poll(() => second).not.toBeNull();
    await second;
    await expect.poll(() => side.current(S1.path) && side.current(S2.path)).toBe(true);
    await side.scheduler.idle();
  } finally {
    stop();
  }
  return side.runner.runs.slice(from).map((run) => run.files.map((f) => f.path).sort());
}

describe("a retried slow-lane file (row 011-323, difference 2)", () => {
  it("joins the tier of the step after its stage", async () => {
    expect(await retried(beforeTheTurn)).toEqual([[S1.path, S2.path]]);
  });

  it("staged during the step's turn that starts the lane's tier, it runs in the lane's next tier", async () => {
    expect(await retried(duringTheTurn)).toEqual([[S1.path], [S2.path]]);
  });
});
