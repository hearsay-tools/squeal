import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
} from "./merge-hold-fixture.js";

/*
 * Row 011-72 (011 C9 as amended 2026-10-21, "Holds"; `tasks/011-61/design.md`
 * R1, tests 1 to 4): while git lists an unmerged path no tier starts, the
 * queue keeps the work, and `git add` or an abort ends the hold within about a
 * second with no revision.
 */

/** Long enough for a tier to start had the hold not held it. */
const SETTLE_MS = 300;
const settle = () => new Promise((r) => setTimeout(r, SETTLE_MS));

describe("scheduler: the merge hold (row 011-72)", { timeout: 60_000 }, () => {
  it("1: a conflicted merge records a revision that re-keys both importers, and no tier starts", async () => {
    const repo = mergeRepo();
    const side = holdSide(repo);
    await side.scheduler.start();
    await side.scheduler.idle();
    const before = rows(side);
    const revision = side.scheduler.status().revision;
    const runs = side.runner.runs.length;
    expect(heldPaths(side)).toBeNull();

    expect(gitMay(repo.main, ["merge", "side"])).toBe(1);
    await batch(side, HELPER);
    await side.scheduler.idle();
    await settle();

    expect(side.scheduler.status().revision).toBe(revision + 1);
    const after = rows(side);
    for (const path of [A, B]) {
      expect(after.get(path)?.key).not.toBe(before.get(path)?.key);
      expect(after.get(path)?.pending).toBe("queued");
    }
    expect(after.get(OTHER)).toEqual(before.get(OTHER));
    expect(side.runner.runs.length).toBe(runs);
    expect(heldPaths(side)).toEqual([HELPER]);
  });

  it("2: the resolved write holds; `git add` alone runs both importers within 2 s at a fresh daemon's keys, with no revision", async () => {
    const repo = mergeRepo();
    const side = holdSide(repo, repo.main, FILES, RUN_MISSING);
    await side.scheduler.start();
    await side.scheduler.idle();
    expect(gitMay(repo.main, ["merge", "side"])).toBe(1);
    await batch(side, HELPER);
    const runs = side.runner.runs.length;

    writeFileSync(join(repo.main, HELPER), helperReturning(4));
    await batch(side, HELPER);
    await side.scheduler.idle();
    await settle();
    expect(side.runner.runs.length).toBe(runs);
    expect(heldPaths(side)).toEqual([HELPER]);
    const revision = side.scheduler.status().revision;

    git(repo.main, ["add", HELPER]);
    const added = performance.now();
    await expect
      .poll(() => [runsOf(side, A), runsOf(side, B)], { timeout: 10_000 })
      .toEqual([2, 2]);
    const started = Math.max(...side.runner.runsOf(A).map((r) => r.startedAt));
    expect(started - added).toBeLessThan(2_000);
    await side.scheduler.idle();
    expect(heldPaths(side)).toBeNull();
    expect(side.scheduler.status().revision).toBe(revision);
    expect([outcomes(side, A), outcomes(side, B)]).toEqual([["pass"], ["pass"]]);
    const held = rows(side);
    await side.scheduler.close();

    const fresh = holdSide(repo);
    await fresh.scheduler.start();
    await fresh.scheduler.idle();
    for (const path of [A, B]) expect(rows(fresh).get(path)?.key).toBe(held.get(path)?.key);
    expect(fresh.runner.runs).toEqual([]);
  });

  it("3: `git add` of the conflicted bytes ends the hold; both importers run and fail", async () => {
    const repo = mergeRepo();
    const side = holdSide(repo, repo.main, FILES, RUN_MISSING);
    await side.scheduler.start();
    await side.scheduler.idle();
    expect(gitMay(repo.main, ["merge", "side"])).toBe(1);
    await batch(side, HELPER);
    expect(readFileSync(join(repo.main, HELPER), "utf8")).toContain("<<<<<<<");
    expect(runsOf(side, A)).toBe(1);

    git(repo.main, ["add", HELPER]);
    await expect
      .poll(() => [outcomes(side, A), outcomes(side, B)], { timeout: 10_000 })
      .toEqual([["fail"], ["fail"]]);
    expect(heldPaths(side)).toBeNull();
  });

  it("4: `git merge --abort` ends the hold; both importers take their stored passes with no run", async () => {
    const repo = mergeRepo();
    const side = holdSide(repo, repo.main, FILES, RUN_MISSING);
    await side.scheduler.start();
    await side.scheduler.idle();
    const before = rows(side);
    const runs = side.runner.runs.length;
    expect(gitMay(repo.main, ["merge", "side"])).toBe(1);
    await batch(side, HELPER);
    const revision = side.scheduler.status().revision;

    // No batch: the hold's own read reconciles the bytes the abort restored before any tier.
    git(repo.main, ["merge", "--abort"]);
    await expect.poll(() => heldPaths(side), { timeout: 2_000 }).toBeNull();
    await expect
      .poll(() => side.scheduler.status().revision, { timeout: 5_000 })
      .toBe(revision + 1);
    await side.scheduler.idle();
    await settle();
    expect(side.runner.runs.length).toBe(runs);
    for (const path of [A, B]) {
      expect(rows(side).get(path)).toEqual(before.get(path));
      expect(outcomes(side, path)).toEqual(["pass"]);
    }
  });
});
