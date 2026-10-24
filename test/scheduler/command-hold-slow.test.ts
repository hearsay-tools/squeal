import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { poolPermitFile } from "../../src/core/capacity/index.js";
import { removeCommandHold } from "../../src/core/scheduler/hold-rows.js";
import { heldPermits, takePermit } from "../../src/core/slow/slot.js";
import { readSlowActivity } from "../../src/core/slow/state.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpRepo,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import { heldFiles, hold, liveProcess, settle } from "./command-hold-fixture.js";
import { heldPaths, rows, unmergeIndex } from "./merge-hold-fixture.js";

/*
 * Review 0.1.269, B1 (row 011-74; 011 C9, "Holds": "no tier starts in any
 * lane of the worktree, slow and backlog included"): a slow selection waits
 * for the load guard after the pump's hold check. A hold that begins during
 * that wait starts no run when the load falls, with a runner that cancels
 * (Vitest) and with one that does not (node:test, pytest); the selection
 * holds no slot, pool lease or claim, and the file stays queued until the
 * hold ends. The review's probe: one slow file, the guard's load at 10 per
 * CPU, then 0 once the hold settled.
 */

/** A private temporary directory, removed after the test. */
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** How many of the pool's `slots` permits nothing holds; all when the pool was never opened. */
function freePermits(dir: string, slots: number): number {
  if (!existsSync(dir)) return slots;
  let free = 0;
  for (let i = 0; i < slots; i++) {
    const db = takePermit(join(dir, poolPermitFile(i)), { pid: process.pid, worktreeId: "probe" });
    db?.close();
    if (db !== null) free++;
  }
  return free;
}

const SLOW = { ...DEFAULT_POLICY.slow, include: ["test/**"], quietMs: 0, maxDeferMs: 10_000 };

interface SlowSide {
  readonly repo: CatchUpRepo;
  readonly side: CatchUpSide;
  readonly slotDir: string;
  readonly path: string;
  setLoad(load: number): void;
}

/** One slow 3 s file whose guard reads a load per CPU of `load`, started. */
async function slowSide(
  runner: { cancels: boolean; backlogSlot?: () => number },
  initial: number,
): Promise<SlowSide> {
  const files = heldFiles(1, 3_000);
  const repo = catchUpRepo(files);
  const slotDir = tempDir("squeal-hold-slow-slot-");
  let load = initial;
  const side = catchUpSide(repo, repo.main, {
    files,
    hostSlots: 4,
    ...runner,
    policy: { ...RUN_MISSING, slow: SLOW },
    scheduler: { slow: { slotDir, recheckMs: 50, cpus: () => 1, load: () => [load] } },
  });
  await side.scheduler.start();
  const path = files[0]?.path ?? "";
  return { repo, side, slotDir, path, setLoad: (next) => (load = next) };
}

/** `slowSide` under a load of 10 per CPU, its file waiting for the guard and no run started. */
async function waiting(runner: {
  cancels: boolean;
  backlogSlot?: () => number;
}): Promise<SlowSide> {
  const slow = await slowSide(runner, 10);
  const { side } = slow;
  await expect
    .poll(() => readSlowActivity(side.store, side.worktreeId)?.kind, { timeout: 10_000 })
    .toBe("waiting");
  expect(side.runner.runs).toEqual([]);
  return slow;
}

/** The selection took nothing: no slot permit, pool lease or claim, and the file is queued. */
function tookNothing(repo: CatchUpRepo, side: CatchUpSide, slotDir: string, path: string): void {
  expect(side.runner.runs).toEqual([]);
  expect(heldPermits({ dir: slotDir, permits: SLOW.maxParallel })).toEqual([]);
  expect(freePermits(repo.poolDir, 4)).toBe(4);
  expect(rows(side).get(path)?.pending).toBe("queued");
}

describe("scheduler: a hold during the slow tier's load guard (review 0.1.269, B1)", {
  timeout: 60_000,
}, () => {
  it.each([
    ["a runner that cancels (Vitest)", { cancels: true }],
    ["a runner that does not (node:test, pytest)", { cancels: false, backlogSlot: () => 1 }],
  ])(
    "with %s, no run starts after the command hold settled; its end runs the file",
    async (_, runner) => {
      const { repo, side, slotDir, path, setLoad } = await waiting(runner);
      const entry = hold(side, (await liveProcess()).identity);
      expect(await side.scheduler.commandHold()).toBe(true);

      setLoad(0);
      await settle(500);
      tookNothing(repo, side, slotDir, path);

      removeCommandHold(side.store, side.worktreeId, entry.token);
      expect(await side.scheduler.commandHold()).toBe(false);
      await expect.poll(() => side.current(path), { timeout: 30_000 }).toBe(true);
      expect(side.runner.runs).toHaveLength(1);
    },
  );

  it("a slow tier in flight is cancelled and its file queued; the scheduler stays open, and the hold's end runs it", async () => {
    const { side, slotDir, path } = await slowSide({ cancels: true }, 0);
    await expect.poll(() => side.runner.active, { timeout: 10_000 }).toBe(1);
    const run = side.runner.runs[0];
    const entry = hold(side, (await liveProcess()).identity);
    expect(await side.scheduler.commandHold()).toBe(true);
    expect(run?.cancelled).toBe(true);
    expect(run?.completed).toEqual([]);
    await settle(500);
    expect(side.runner.runs).toHaveLength(1);
    expect(heldPermits({ dir: slotDir, permits: SLOW.maxParallel })).toEqual([]);
    expect(rows(side).get(path)?.pending).toBe("queued");

    removeCommandHold(side.store, side.worktreeId, entry.token);
    expect(await side.scheduler.commandHold()).toBe(false);
    await expect.poll(() => side.current(path), { timeout: 30_000 }).toBe(true);
    expect(side.runner.runs).toHaveLength(2);
  });

  it("a merge hold that began during the wait: the selection reads the index again after it and starts no run; the hold's end runs the file", async () => {
    const { repo, side, slotDir, path, setLoad } = await waiting({ cancels: true });
    // No pass reads the index meanwhile: only the selection's own check after the wait sees it.
    unmergeIndex(repo.main, "src/held.ts");

    setLoad(0);
    await expect.poll(() => heldPaths(side), { timeout: 10_000 }).toEqual(["src/held.ts"]);
    await settle(500);
    tookNothing(repo, side, slotDir, path);

    git(repo.main, ["reset", "-q"]);
    await expect.poll(() => side.current(path), { timeout: 30_000 }).toBe(true);
    expect(side.runner.runs).toHaveLength(1);
  });
});
