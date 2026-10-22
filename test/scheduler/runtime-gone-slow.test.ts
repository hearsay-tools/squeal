import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { poolPermitFile } from "../../src/core/capacity/index.js";
import { heldPermits, takePermit } from "../../src/core/slow/slot.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import { catchUpRepo, catchUpSide, testFiles } from "./catch-up-fixture.js";

/*
 * Review 0.1.262, B3 (row 011-106; spec 011 C9): the pump checks the
 * daemon's own runtime before each tier, and a slow tier then waits for the
 * load guard, up to `slow.maxDeferMs`. A runtime that goes during that wait
 * starts no tier: the selection takes no slot, pool lease or claim, both
 * slow files stay queued, and the daemon tells its exit once. The review's
 * probe: one slow permit, trigger `idle`, a load reader that removes the
 * runtime on its first read and reports high load, then low load.
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

describe("scheduler: a slow tier whose runtime went during the load guard's wait (review 0.1.262)", {
  timeout: 60_000,
}, () => {
  it("B3: starts no run, holds no slot, lease or claim, and leaves both files queued", async () => {
    const files = testFiles(2, [], () => 50);
    const repo = catchUpRepo(files);
    const runtime = tempDir("squeal-runtime-gone-");
    const slotDir = tempDir("squeal-runtime-gone-slot-");
    let reads = 0;
    const told: string[] = [];
    const side = catchUpSide(repo, repo.main, {
      files,
      hostSlots: 4,
      tierSize: 1,
      policy: {
        slow: { ...DEFAULT_POLICY.slow, include: ["test/**"], trigger: "idle", maxParallel: 1 },
      },
      scheduler: {
        runtimeDir: runtime,
        onReinstall: (note) => told.push(note),
        slow: {
          slotDir,
          recheckMs: 25,
          cpus: () => 1,
          load: () => {
            reads += 1;
            if (reads > 1) return [0];
            rmSync(runtime, { recursive: true, force: true });
            return [8];
          },
        },
      },
    });
    const rows = () =>
      side.store.testFileKeys
        .list(side.worktreeId)
        .map((r) => ({ path: r.testFile.path, pending: r.pending }))
        .sort((a, b) => a.path.localeCompare(b.path));
    const queued = files.map((f) => ({ path: f.path, pending: "queued" }));
    await side.scheduler.start();
    await expect.poll(() => told.length).toBe(1);
    // Before the close releases anything: the selection took nothing.
    expect(side.runner.runs).toEqual([]);
    expect(reads).toBe(2);
    expect(heldPermits({ dir: slotDir, permits: 1 })).toEqual([]);
    expect(freePermits(repo.poolDir, 4)).toBe(4);
    expect(rows()).toEqual(queued);

    await side.scheduler.close();
    expect(told).toHaveLength(1);
    expect(told[0]).toContain("squeal start");
    expect(side.runner.runs).toEqual([]);
    expect(rows()).toEqual(queued);
    expect(side.store.knownStates.list(side.worktreeId)).toEqual([]);
  });
});
