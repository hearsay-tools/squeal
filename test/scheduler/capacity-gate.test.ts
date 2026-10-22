import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { createPermitPool, type PoolMark, readMarks } from "../../src/core/capacity/index.js";
import type { RunOptions, TestFileRef } from "../../src/core/types/index.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * 011 C10 as amended 2026-10-21 (row 011-98): an edit's tier runs without a
 * permit and never waits, and while it runs its daemon writes its mark with
 * the CPU its tests use and no backlog demand, so other daemons' backlog
 * tiers shrink. Here another daemon holds the whole pool and states far more
 * cores than the slots.
 */

describe("an edit's tier under the CPU gate (row 011-98)", SLOW, () => {
  it("starts at once beside a pool that is full in permits and cores, and marks its CPU while it runs", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "squeal-capacity-gate-")), "squeal-uid");
    onTestFinished(() => rmSync(join(dir, ".."), { recursive: true, force: true }));
    const repo = createRepo("basic");
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 4,
      backlogTierSize: 50,
      capacity: { dir, hostSlots: 2 },
    });
    await h.scheduler.start();
    await h.scheduler.idle();
    const own = (): PoolMark | undefined =>
      readMarks(dir, "reader", Date.now()).find((m) => m.id === h.worktreeId);
    expect(own()).toBeUndefined();

    const other = createPermitPool({
      dir,
      owner: { pid: process.pid, worktreeId: "other-daemon" },
      hostSlots: 2,
      cores: { read: () => 40, reset: () => {} },
    });
    onTestFinished(() => other.close());
    expect(other.acquire(2)?.permits).toBe(2);

    const edits: { files: readonly TestFileRef[]; options: RunOptions; mark?: PoolMark }[] = [];
    h.gate.before = (files, options) => {
      const mark = own();
      edits.push({ files, options, ...(mark === undefined ? {} : { mark }) });
    };
    appendFileSync(join(h.root, "test/math.test.ts"), "// an edit\n");
    await h.batch("test/math.test.ts");
    await expect.poll(() => edits.length, { timeout: 30_000 }).toBeGreaterThan(0);
    const [edit] = edits;
    expect(edit?.files.map((f) => f.path)).toEqual(["test/math.test.ts"]);
    expect(edit?.options.workers).toBeUndefined();
    expect(edit?.mark).toMatchObject({ want: 0, grant: 0, since: null });
    expect(edit?.mark?.cores).toBeGreaterThan(0);
    await h.scheduler.idle();
    expect(own()).toBeUndefined();
  });
});
