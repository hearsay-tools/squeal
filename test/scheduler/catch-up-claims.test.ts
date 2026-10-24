import { describe, expect, it } from "vitest";
import { RUN_MISSING } from "../helpers/baseline.js";
import { catchUpRepo, catchUpSide, sources, testFiles } from "./catch-up-fixture.js";

/*
 * Task 011-22 (spec 011 C4 step 4 as amended 2026-10-20, `research/catch-up.md`
 * done-when 8): catch-up is not an edit's work, so a file of it whose key
 * another live worktree is running waits on that claim and adopts the
 * result (004 D6, 001-205). As edit work, both worktrees ran every key.
 */
const TWELVE = sources(12);
const FILES = testFiles(48, TWELVE, () => 1_000);

describe("scheduler: worktrees on one commit share a catch-up through claims (C4 step 4, task 011-22)", () => {
  it("8. runs each key of the same 12-source change once: the second worktree waits and adopts", {
    timeout: 120_000,
  }, async () => {
    const repo = catchUpRepo(FILES);
    const main = catchUpSide(repo, repo.main, { files: FILES, hostSlots: 8, policy: RUN_MISSING });
    await main.scheduler.start();
    await main.scheduler.idle();
    const other = catchUpSide(repo, repo.other, { files: FILES, hostSlots: 8 });
    await other.scheduler.start();
    await other.scheduler.idle();
    // The second worktree inherited the first's baseline: nothing ran there.
    expect(other.runner.runs).toHaveLength(0);
    expect(FILES.every((f) => other.current(f.path))).toBe(true);

    const before = main.runner.runs.length;
    main.runner.hold();
    await main.edit("watch", ...TWELVE);
    await expect.poll(() => main.runner.active).toBe(1);
    // The same bytes in the second worktree: the same keys, claimed by the first's tier.
    await other.edit("watch", ...TWELVE);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(other.runner.runs).toHaveLength(0);
    main.runner.release();
    await main.scheduler.idle();
    await expect
      .poll(() => FILES.every((f) => other.current(f.path)), { timeout: 60_000 })
      .toBe(true);
    await other.scheduler.idle();

    const ran = main.runner.runs.slice(before).flatMap((run) => run.files.map((f) => f.path));
    expect(ran.sort()).toEqual(FILES.map((f) => f.path).sort());
    expect(other.runner.runs).toHaveLength(0);
    // Adopted with provenance: each result the second worktree holds is the first's.
    const keys = other.store.testFileKeys.list(other.worktreeId);
    for (const row of keys) {
      const results = other.store.results.byKey(row.key);
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.provenance.worktreeId === main.worktreeId)).toBe(true);
    }
  });
});
