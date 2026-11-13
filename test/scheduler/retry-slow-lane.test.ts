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
 * `squeal retry` was the only request that queued work and woke no lane. A
 * slow lane's selection lists its queued files under the scheduler's lock,
 * then checks the runtime and the holds before it starts a tier of them
 * (`slow-tier.ts`, `next`); only a preemption since the listing makes it
 * plan again. A retry whose stage runs in that window queues a slow file
 * the tier leaves out, so it waits for the lane's next planning: once the
 * tier ends, minutes for a slow one. Here the second retry's stage runs
 * right after the listing, as the lock's next task.
 */

const S1: TestFileRef = { project: "", path: "test/e2e/s1.test.ts" };
const S2: TestFileRef = { project: "", path: "test/e2e/s2.test.ts" };
const FILES: readonly CatchUpFile[] = [
  { path: "test/a.test.ts", ms: 10, imports: ["src/core.ts"] },
  { path: S1.path, ms: 10, imports: ["src/core.ts"] },
  { path: S2.path, ms: 10, imports: ["src/other.ts"] },
];
/** What the slow lane's selection holds the lock for while it lists its queued files. */
const LISTING = "listing the queued files of group slow";

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

describe("a retried slow-lane file (row 011-323, difference 2)", () => {
  it("joins the tier a slow selection in flight starts, not the lane's next planning", async () => {
    const side = await slowSide();
    const from = side.runner.runs.length;
    let first = false;
    let second: Promise<void> | null = null;
    const unwatch = side.scheduler.watchLock?.((holder) => {
      // The first retry queued S1; the lane now lists it, and S2's retry takes the lock next.
      if (holder?.operation === "taking squeal retry requests") first = true;
      if (!first || second !== null || holder?.operation !== LISTING) return;
      ask(side, S2);
      second = side.scheduler.requestRetries();
    });
    try {
      ask(side, S1);
      await side.scheduler.requestRetries();
      await expect.poll(() => second).not.toBeNull();
      await second;
      await side.scheduler.idle();
    } finally {
      unwatch?.();
    }

    const tiers = side.runner.runs.slice(from).map((run) => run.files.map((f) => f.path).sort());
    expect(tiers).toEqual([[S1.path, S2.path]]);
  });
});
