import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CatchUpSide } from "./catch-up-fixture.js";
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
} from "./merge-hold-fixture.js";

/*
 * Review 0.1.266, B1 (row 011-72, 011 C9 as amended 2026-10-21): another
 * worktree's run that replaces a FAIL with a PASS at a key heals every
 * worktree at that key (`storeResults`). While this worktree's merge hold
 * holds, a key that names an unmerged path takes no stored result from other
 * worktrees' keys either: the heal leaves its file queued with no current
 * outcome. A file whose key names no unmerged path heals as before.
 */

/** Runs of `side` fail the files in `fails`, whatever their bytes. */
function failing(side: CatchUpSide, fails: Set<string>): void {
  side.runner.beforeRun = (files) => {
    for (const { path } of files) {
      if (fails.has(path)) side.runner.failing.add(path);
      else side.runner.failing.delete(path);
    }
  };
}

describe("scheduler: the merge hold and another worktree's heal (review 0.1.266 B1)", {
  timeout: 60_000,
}, () => {
  it("a FAIL -> PASS at a held key leaves the held importers queued; an unaffected file heals", async () => {
    const repo = mergeRepo();
    const main = holdSide(repo);
    // The control: main's own run fails the unaffected file before the merge.
    const marked = main.runner.beforeRun;
    main.runner.beforeRun = (files) => {
      marked?.(files);
      if (files.some((f) => f.path === OTHER)) main.runner.failing.add(OTHER);
    };
    await main.scheduler.start();
    await main.scheduler.idle();
    expect(outcomes(main, OTHER)).toEqual(["fail"]);
    main.runner.beforeRun = marked;

    expect(gitMay(repo.main, ["merge", "side"])).toBe(1);
    await batch(main, HELPER);
    await main.scheduler.idle();
    // Resolved bytes, not staged: the index still lists the helper unmerged.
    writeFileSync(join(repo.main, HELPER), helperReturning(7));
    await batch(main, HELPER);
    await main.scheduler.idle();
    expect(heldPaths(main)).toEqual([HELPER]);
    for (const path of [A, B]) {
      expect(rows(main).get(path)?.pending).toBe("queued");
      expect(outcomes(main, path)).toEqual([]);
    }
    const runs = main.runner.runs.length;

    const other = holdSide(repo, repo.other);
    const fails = new Set([A, B, OTHER]);
    failing(other, fails);
    await other.scheduler.start();
    await other.scheduler.idle();
    writeFileSync(join(repo.other, HELPER), readFileSync(join(repo.main, HELPER)));
    await batch(other, HELPER);
    await other.scheduler.idle();
    for (const path of [A, B, OTHER]) {
      expect(rows(other).get(path)?.key).toBe(rows(main).get(path)?.key);
      expect(outcomes(other, path)).toEqual(["fail"]);
    }

    // A flaky failure's recovery at the same keys: no marker in these bytes.
    fails.clear();
    await other.scheduler.requestFullSuite({ force: true });
    await other.scheduler.idle();
    for (const path of [A, B, OTHER]) expect(outcomes(other, path)).toEqual(["pass"]);

    // Read before any further batch of main's.
    expect(heldPaths(main)).toEqual([HELPER]);
    for (const path of [A, B]) {
      expect(rows(main).get(path)?.pending).toBe("queued");
      expect(outcomes(main, path)).toEqual([]);
    }
    expect(outcomes(main, OTHER)).toEqual(["pass"]);
    expect(main.runner.runs.length).toBe(runs);
  });
});
