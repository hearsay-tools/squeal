import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { git } from "../hash/git-repo.js";
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
  outcomes,
  rows,
  runsOf,
} from "./merge-hold-fixture.js";

/*
 * Row 011-72 (011 C9 as amended 2026-10-21; `tasks/011-61/design.md` R1, test
 * 5): every operation that leaves unmerged index entries holds, whatever it
 * is, and whatever clears them ends the hold.
 */

const settle = () => new Promise((r) => setTimeout(r, 300));

/** `side` is on hold for the helper, with no run since `runs`. */
async function expectHeld(side: CatchUpSide, runs: number): Promise<void> {
  await side.scheduler.idle();
  await settle();
  expect(heldPaths(side)).toEqual([HELPER]);
  expect(side.runner.runs.length).toBe(runs);
  for (const path of [A, B]) expect(rows(side).get(path)?.pending).toBe("queued");
}

async function started(): Promise<{ root: string; side: CatchUpSide }> {
  const repo = mergeRepo();
  const side = holdSide(repo);
  await side.scheduler.start();
  await side.scheduler.idle();
  return { root: repo.main, side };
}

describe("scheduler: the merge hold's operations (row 011-72)", { timeout: 60_000 }, () => {
  it("5: a rebase conflict holds, and its abort ends the hold with no run", async () => {
    const { root, side } = await started();
    const runs = side.runner.runs.length;
    expect(gitMay(root, ["rebase", "side"])).toBe(1);
    await batch(side, HELPER);
    await expectHeld(side, runs);

    git(root, ["rebase", "--abort"]);
    await batch(side, HELPER);
    await expect.poll(() => heldPaths(side), { timeout: 2_000 }).toBeNull();
    await side.scheduler.idle();
    expect(side.runner.runs.length).toBe(runs);
    for (const path of [A, B]) expect(outcomes(side, path)).toEqual(["pass"]);
  });

  it("5: a cherry-pick conflict holds, and its abort ends the hold with no run", async () => {
    const { root, side } = await started();
    const runs = side.runner.runs.length;
    expect(gitMay(root, ["cherry-pick", "side"])).toBe(1);
    await batch(side, HELPER);
    await expectHeld(side, runs);

    git(root, ["cherry-pick", "--abort"]);
    await batch(side, HELPER);
    await expect.poll(() => heldPaths(side), { timeout: 2_000 }).toBeNull();
    await side.scheduler.idle();
    expect(side.runner.runs.length).toBe(runs);
  });

  it("5: a `stash pop` conflict holds; `git reset` ends it, and the markers fail both importers", async () => {
    const { root, side } = await started();
    writeFileSync(join(root, HELPER), helperReturning(5));
    git(root, ["stash", "push", "-q"]);
    writeFileSync(join(root, HELPER), helperReturning(6));
    git(root, ["commit", "-qam", "six"]);
    await batch(side, HELPER);
    await side.scheduler.idle();
    const runs = side.runner.runs.length;
    const [a, b] = [runsOf(side, A), runsOf(side, B)];

    expect(gitMay(root, ["stash", "pop", "-q"])).toBe(1);
    await batch(side, HELPER);
    await expectHeld(side, runs);

    // No byte changes: the markers stay, only the index clears.
    git(root, ["reset", "-q"]);
    await expect.poll(() => heldPaths(side), { timeout: 2_000 }).toBeNull();
    await expect
      .poll(() => [outcomes(side, A), outcomes(side, B)], { timeout: 10_000 })
      .toEqual([["fail"], ["fail"]]);
    // A new failure runs once more (C5).
    expect([runsOf(side, A), runsOf(side, B)]).toEqual([a + 2, b + 2]);
  });
});
