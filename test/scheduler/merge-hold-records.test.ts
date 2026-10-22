import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { git } from "../hash/git-repo.js";
import {
  A,
  B,
  batch,
  gitMay,
  HELPER,
  heldPaths,
  helperReturning,
  holdSide,
  mergeRepo,
  OTHER,
  outcomes,
  rows,
  runsOf,
  unmergeIndex,
} from "./merge-hold-fixture.js";

/*
 * Row 011-72 (011 C9 as amended 2026-10-21; `tasks/011-61/design.md` R1,
 * tests 6 to 9): a key that names an unmerged path takes no stored result and
 * stores none, a tier in flight at the hold's start runs to its end, and the
 * hold is one worktree's.
 */

describe("scheduler: what the merge hold records (row 011-72)", { timeout: 60_000 }, () => {
  it("6: a tier the check let past stores nothing for the importers, and a second such withhold leaves no unknown", async () => {
    const repo = mergeRepo();
    const side = holdSide(repo);
    await side.scheduler.start();
    await side.scheduler.idle();
    // The files land, the tier starts, then the index lands: what the check before a tier cannot see.
    let races = 2;
    const marked = side.runner.beforeRun;
    side.runner.beforeRun = (files) => {
      marked?.(files);
      if (races > 0 && files.some((f) => f.path === A)) {
        races -= 1;
        unmergeIndex(repo.main, HELPER);
      }
    };
    writeFileSync(join(repo.main, HELPER), helperReturning(7));
    await batch(side, HELPER);
    await expect.poll(() => heldPaths(side), { timeout: 5_000 }).toEqual([HELPER]);
    await side.scheduler.idle();
    const held = rows(side);
    for (const path of [A, B]) {
      expect(held.get(path)?.pending).toBe("queued");
      expect(outcomes(side, path)).toEqual([]);
    }

    git(repo.main, ["add", HELPER]);
    await expect.poll(() => races, { timeout: 5_000 }).toBe(0);
    await expect.poll(() => heldPaths(side), { timeout: 5_000 }).toEqual([HELPER]);
    await side.scheduler.idle();
    expect(rows(side)).toEqual(held);
    const unknown = side.store.knownStates
      .list(side.worktreeId)
      .filter((s) => s.outcome === "unknown" || s.validity === "unknown");
    expect(unknown).toEqual([]);

    git(repo.main, ["add", HELPER]);
    await expect
      .poll(() => [outcomes(side, A), outcomes(side, B)], { timeout: 10_000 })
      .toEqual([["pass"], ["pass"]]);
    expect([runsOf(side, A), runsOf(side, B)]).toEqual([4, 4]);
  });

  it("7: a FAIL this worktree stored at the conflicted key reads pending while held; after `git add` the stored pass at the resolved key is current", async () => {
    const repo = mergeRepo();
    expect(gitMay(repo.main, ["merge", "side"])).toBe(1);
    const conflicted = readFileSync(join(repo.main, HELPER), "utf8");
    git(repo.main, ["merge", "--abort"]);
    const side = holdSide(repo);
    await side.scheduler.start();
    await side.scheduler.idle();
    const passed = rows(side).get(A)?.key;
    // The same bytes written by hand: no unmerged path, no hold, a FAIL at their key.
    writeFileSync(join(repo.main, HELPER), conflicted);
    await batch(side, HELPER);
    await side.scheduler.idle();
    expect(outcomes(side, A)).toEqual(["fail"]);
    const failed = rows(side).get(A)?.key;
    git(repo.main, ["checkout", "--", HELPER]);
    await batch(side, HELPER);
    await side.scheduler.idle();
    expect(outcomes(side, A)).toEqual(["pass"]);
    const runs = side.runner.runs.length;

    expect(gitMay(repo.main, ["merge", "side"])).toBe(1);
    await batch(side, HELPER);
    await side.scheduler.idle();
    expect(rows(side).get(A)).toEqual({ key: failed, pending: "queued" });
    for (const path of [A, B]) expect(outcomes(side, path)).toEqual([]);

    // Resolved to main's side, whose pass is stored: still held, so still pending.
    writeFileSync(join(repo.main, HELPER), helperReturning(3));
    await batch(side, HELPER);
    await side.scheduler.idle();
    expect(rows(side).get(A)).toEqual({ key: passed, pending: "queued" });
    for (const path of [A, B]) expect(outcomes(side, path)).toEqual([]);

    git(repo.main, ["add", HELPER]);
    await expect
      .poll(() => [outcomes(side, A), outcomes(side, B)], { timeout: 5_000 })
      .toEqual([["pass"], ["pass"]]);
    await side.scheduler.idle();
    expect(rows(side).get(A)).toEqual({ key: passed, pending: null });
    expect(side.runner.runs.length).toBe(runs);
  });

  it("7: a FAIL another worktree stores at the conflicted key during the hold is not promoted", async () => {
    const repo = mergeRepo();
    const side = holdSide(repo);
    await side.scheduler.start();
    await side.scheduler.idle();
    expect(gitMay(repo.main, ["merge", "side"])).toBe(1);
    await batch(side, HELPER);
    await side.scheduler.idle();
    const runs = side.runner.runs.length;

    const other = holdSide(repo, repo.other);
    await other.scheduler.start();
    await other.scheduler.idle();
    writeFileSync(join(repo.other, HELPER), readFileSync(join(repo.main, HELPER)));
    await batch(other, HELPER);
    await other.scheduler.idle();
    expect(outcomes(other, A)).toEqual(["fail"]);
    expect(rows(other).get(A)?.key).toBe(rows(side).get(A)?.key);

    // A reconciliation pass reads the keys other worktrees stored (C4 step 3, task 011-23).
    await side.scheduler.handleBatch({ trigger: "interval", paths: [] });
    await side.scheduler.idle();
    for (const path of [A, B]) {
      expect(rows(side).get(path)?.pending).toBe("queued");
      expect(outcomes(side, path)).toEqual([]);
    }
    expect(side.runner.runs.length).toBe(runs);
  });

  it("8: a tier in flight at the hold's start finishes; its file whose key names no unmerged path stores", async () => {
    const repo = mergeRepo();
    const side = holdSide(repo);
    await side.scheduler.start();
    await side.scheduler.idle();
    side.runner.hold();
    for (const path of [A, B, OTHER]) appendFileSync(join(repo.main, path), "// edit\n");
    await batch(side, A, B, OTHER);
    await expect.poll(() => side.runner.active, { timeout: 5_000 }).toBe(1);

    expect(gitMay(repo.main, ["merge", "side"])).toBe(1);
    await batch(side, HELPER);
    expect(heldPaths(side)).toEqual([HELPER]);
    side.runner.release();
    await side.scheduler.idle();

    expect(side.runner.runs.at(-1)?.cancelled).toBe(false);
    expect(rows(side).get(OTHER)?.pending).toBeNull();
    expect(outcomes(side, OTHER)).toEqual(["pass"]);
    for (const path of [A, B]) {
      expect(rows(side).get(path)?.pending).toBe("queued");
      expect(outcomes(side, path)).toEqual([]);
    }
  });

  it("9: another worktree's daemon runs its edit during the hold", async () => {
    const repo = mergeRepo();
    const side = holdSide(repo);
    await side.scheduler.start();
    await side.scheduler.idle();
    expect(gitMay(repo.main, ["merge", "side"])).toBe(1);
    await batch(side, HELPER);
    await side.scheduler.idle();
    const runs = side.runner.runs.length;

    const other = holdSide(repo, repo.other);
    await other.scheduler.start();
    await other.scheduler.idle();
    const before = runsOf(other, OTHER);
    appendFileSync(join(repo.other, OTHER), "// edit\n");
    await batch(other, OTHER);
    await other.scheduler.idle();
    expect(runsOf(other, OTHER)).toBe(before + 1);
    expect(outcomes(other, OTHER)).toEqual(["pass"]);
    expect(heldPaths(other)).toBeNull();
    expect(heldPaths(side)).toEqual([HELPER]);
    expect(side.runner.runs.length).toBe(runs);
  });
});
