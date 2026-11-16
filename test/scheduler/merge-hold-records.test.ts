import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MERGE_HOLD_POLL_MS } from "../../src/core/scheduler/hold.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  A,
  B,
  batch,
  FILES,
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

/** Row 011-381: each side's clock is virtual; the hold's poll comes when a case moves it. */
const VIRTUAL = { clock: "virtual" } as const;

describe("scheduler: what the merge hold records (row 011-72)", { timeout: 60_000 }, () => {
  it("6: a tier the check let past stores nothing for the importers, and a second such withhold leaves no unknown", async () => {
    const repo = mergeRepo();
    const side = holdSide(repo, repo.main, FILES, RUN_MISSING, VIRTUAL);
    await side.scheduler.start();
    await side.quiet();
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
    await side.quiet();
    expect(heldPaths(side)).toEqual([HELPER]);
    const held = rows(side);
    for (const path of [A, B]) {
      expect(held.get(path)?.pending).toBe("queued");
      expect(outcomes(side, path)).toEqual([]);
    }

    // The hold sees each `git add` at its next poll.
    git(repo.main, ["add", HELPER]);
    side.advance(MERGE_HOLD_POLL_MS);
    await side.quiet();
    expect(races).toBe(0);
    expect(heldPaths(side)).toEqual([HELPER]);
    expect(rows(side)).toEqual(held);
    const unknown = side.store.knownStates
      .list(side.worktreeId)
      .filter((s) => s.outcome === "unknown" || s.validity === "unknown");
    expect(unknown).toEqual([]);

    git(repo.main, ["add", HELPER]);
    side.advance(MERGE_HOLD_POLL_MS);
    await side.quiet();
    expect([outcomes(side, A), outcomes(side, B)]).toEqual([["pass"], ["pass"]]);
    expect([runsOf(side, A), runsOf(side, B)]).toEqual([4, 4]);
  });

  it("7: a FAIL this worktree stored at the conflicted key reads pending while held; after `git add` the stored pass at the resolved key is current", async () => {
    const repo = mergeRepo();
    expect(gitMay(repo.main, ["merge", "side"])).toBe(1);
    const conflicted = readFileSync(join(repo.main, HELPER), "utf8");
    git(repo.main, ["merge", "--abort"]);
    const side = holdSide(repo, repo.main, FILES, {}, VIRTUAL);
    await side.scheduler.start();
    await side.quiet();
    const passed = rows(side).get(A)?.key;
    // The same bytes written by hand: no unmerged path, no hold, a FAIL at their key.
    writeFileSync(join(repo.main, HELPER), conflicted);
    await batch(side, HELPER);
    await side.quiet();
    expect(outcomes(side, A)).toEqual(["fail"]);
    const failed = rows(side).get(A)?.key;
    git(repo.main, ["checkout", "--", HELPER]);
    await batch(side, HELPER);
    await side.quiet();
    expect(outcomes(side, A)).toEqual(["pass"]);
    const runs = side.runner.runs.length;

    expect(gitMay(repo.main, ["merge", "side"])).toBe(1);
    await batch(side, HELPER);
    await side.quiet();
    expect(rows(side).get(A)).toEqual({ key: failed, pending: "queued" });
    for (const path of [A, B]) expect(outcomes(side, path)).toEqual([]);

    // Resolved to main's side, whose pass is stored: still held, so still pending.
    writeFileSync(join(repo.main, HELPER), helperReturning(3));
    await batch(side, HELPER);
    await side.quiet();
    expect(rows(side).get(A)).toEqual({ key: passed, pending: "queued" });
    for (const path of [A, B]) expect(outcomes(side, path)).toEqual([]);

    git(repo.main, ["add", HELPER]);
    side.advance(MERGE_HOLD_POLL_MS);
    await side.quiet();
    expect([outcomes(side, A), outcomes(side, B)]).toEqual([["pass"], ["pass"]]);
    expect(rows(side).get(A)).toEqual({ key: passed, pending: null });
    expect(side.runner.runs.length).toBe(runs);
  });

  it("7: a FAIL another worktree stores at the conflicted key during the hold is not promoted", async () => {
    const repo = mergeRepo();
    const side = holdSide(repo, repo.main, FILES, {}, VIRTUAL);
    await side.scheduler.start();
    await side.quiet();
    expect(gitMay(repo.main, ["merge", "side"])).toBe(1);
    await batch(side, HELPER);
    await side.quiet();
    const runs = side.runner.runs.length;

    const other = holdSide(repo, repo.other, FILES, {}, VIRTUAL);
    await other.scheduler.start();
    await other.quiet();
    writeFileSync(join(repo.other, HELPER), readFileSync(join(repo.main, HELPER)));
    await batch(other, HELPER);
    await other.quiet();
    expect(outcomes(other, A)).toEqual(["fail"]);
    expect(rows(other).get(A)?.key).toBe(rows(side).get(A)?.key);

    // A reconciliation pass reads the keys other worktrees stored (C4 step 3, task 011-23).
    await side.scheduler.handleBatch({ trigger: "interval", paths: [] });
    await side.quiet();
    for (const path of [A, B]) {
      expect(rows(side).get(path)?.pending).toBe("queued");
      expect(outcomes(side, path)).toEqual([]);
    }
    expect(side.runner.runs.length).toBe(runs);
  });

  it("8: a tier in flight at the hold's start finishes; its file whose key names no unmerged path stores", async () => {
    const repo = mergeRepo();
    const side = holdSide(repo, repo.main, FILES, {}, VIRTUAL);
    await side.scheduler.start();
    await side.quiet();
    side.runner.hold();
    for (const path of [A, B, OTHER]) appendFileSync(join(repo.main, path), "// edit\n");
    await batch(side, A, B, OTHER);
    await side.rest();
    expect(side.runner.active).toBe(1);

    expect(gitMay(repo.main, ["merge", "side"])).toBe(1);
    await batch(side, HELPER);
    expect(heldPaths(side)).toEqual([HELPER]);
    side.runner.release();
    await side.quiet();

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
    const side = holdSide(repo, repo.main, FILES, {}, VIRTUAL);
    await side.scheduler.start();
    await side.quiet();
    expect(gitMay(repo.main, ["merge", "side"])).toBe(1);
    await batch(side, HELPER);
    await side.quiet();
    const runs = side.runner.runs.length;

    const other = holdSide(repo, repo.other, FILES, {}, VIRTUAL);
    await other.scheduler.start();
    await other.quiet();
    const before = runsOf(other, OTHER);
    appendFileSync(join(repo.other, OTHER), "// edit\n");
    await batch(other, OTHER);
    await other.quiet();
    expect(runsOf(other, OTHER)).toBe(before + 1);
    expect(outcomes(other, OTHER)).toEqual(["pass"]);
    expect(heldPaths(other)).toBeNull();
    expect(heldPaths(side)).toEqual([HELPER]);
    expect(side.runner.runs.length).toBe(runs);
  });
});
