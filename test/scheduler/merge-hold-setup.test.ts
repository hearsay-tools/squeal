import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RunReport, TestFileRef } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import type { CatchUpFile, CatchUpSide } from "./catch-up-fixture.js";
import {
  A,
  B,
  batch,
  FILES,
  HELPER,
  heldPaths,
  helperReturning,
  holdSide,
  mergeRepo,
  OTHER,
  outcomes,
  rows,
  unmergeIndex,
} from "./merge-hold-fixture.js";

/*
 * Review 0.1.266, B2 (row 011-72, 011 C9 as amended 2026-10-21): a run the
 * check before a tier let past, whose global setup failed on a path the
 * index then lists unmerged, applies no setup outcome to the projects the
 * merge hold holds. Their files stay queued, never UNKNOWN, count toward no
 * withhold limit and run once `git add` ends the hold, with no edit. A
 * project the hold does not hold records its setup failure as before.
 */

/** A global setup and its import, which project `""` lists among its environment inputs, as Vitest does. */
const SETUP = "test/global-setup.ts";
const SETUP_DEP = "test/setup-db.ts";
const P_FILE = "p/test/x.test.ts";

const setupError = (path: string) => ({
  name: "Error",
  message: `Transform failed with 1 error: ${path}: Unexpected "<<"`,
  stack: null,
  location: null,
  diff: null,
});

interface Race {
  /** The project the startup failure names: `""` (default) or another. */
  readonly project?: string;
  readonly setupFile: string;
  /** The path the race makes unmerged once the run is selected. */
  readonly unmerged: string;
}

/**
 * The next `count` runs that hold `A` make `race.unmerged` unmerged after
 * selection, then fail to start on `race.setupFile` and run nothing.
 * Returns the races left.
 */
function setupRaces(side: CatchUpSide, root: string, race: Race, count: number): () => number {
  const run = side.runner.run.bind(side.runner);
  let left = count;
  side.runner.run = async (files, options) => {
    if (left === 0 || !files.some((f) => f.path === A)) return run(files, options);
    left -= 1;
    unmergeIndex(root, race.unmerged);
    const report: RunReport = {
      end: "completed",
      durationMs: 1,
      completedFiles: [],
      results: [],
      fileErrors: [],
      failure: `global setup ${race.setupFile} failed`,
      startupFailure: {
        projects: [race.project ?? ""],
        testFiles: files.map((f: TestFileRef) => ({ ...f })),
        setupFile: race.setupFile,
        error: setupError(race.setupFile),
      },
    };
    return report;
  };
  return () => left;
}

const setupStates = (side: CatchUpSide) =>
  side.store.knownStates
    .list(side.worktreeId)
    .filter((s) => s.check.kind === "setup")
    .map((s) => ({ project: s.check.project, outcome: s.outcome, validity: s.validity }));

const unknownOf = (side: CatchUpSide, paths: readonly string[]) =>
  side.store.knownStates
    .list(side.worktreeId)
    .filter((s) => paths.includes(s.check.testPath))
    .filter((s) => s.outcome === "unknown" || s.validity === "unknown");

/** The held importers: queued, no current or unknown outcome, nothing stored at their keys. */
function expectHeld(side: CatchUpSide, paths: readonly string[]): void {
  const now = rows(side);
  for (const path of paths) {
    expect(now.get(path)?.pending, path).toBe("queued");
    expect(outcomes(side, path), path).toEqual([]);
    expect(side.store.results.byKey(now.get(path)?.key ?? null, 0), path).toEqual([]);
  }
  expect(unknownOf(side, paths)).toEqual([]);
}

describe("scheduler: setup outcomes under the merge hold (review 0.1.266 B2)", {
  timeout: 60_000,
}, () => {
  it("a setup that failed on the conflicted helper applies nothing; the importers stay queued and run after `git add`", async () => {
    const repo = mergeRepo();
    const side = holdSide(repo);
    await side.scheduler.start();
    await side.scheduler.idle();
    const left = setupRaces(side, repo.main, { setupFile: HELPER, unmerged: HELPER }, 2);

    writeFileSync(join(repo.main, HELPER), helperReturning(7));
    await batch(side, HELPER);
    await expect.poll(() => heldPaths(side), { timeout: 5_000 }).toEqual([HELPER]);
    await side.scheduler.idle();
    expect(left()).toBe(1);
    expectHeld(side, [A, B]);
    expect(setupStates(side)).toEqual([]);
    const held = rows(side);

    // The hold ends, the importers start, and the race holds them once more.
    git(repo.main, ["add", HELPER]);
    await expect.poll(left, { timeout: 5_000 }).toBe(0);
    await expect.poll(() => heldPaths(side), { timeout: 5_000 }).toEqual([HELPER]);
    await side.scheduler.idle();
    expect(rows(side)).toEqual(held);
    expectHeld(side, [A, B]);
    expect(setupStates(side)).toEqual([]);

    git(repo.main, ["add", HELPER]);
    await expect
      .poll(() => [outcomes(side, A), outcomes(side, B)], { timeout: 10_000 })
      .toEqual([["pass"], ["pass"]]);
    await side.scheduler.idle();
    expect(rows(side).get(A)?.pending).toBeNull();
    expect(setupStates(side)).toEqual([]);
  });

  it("an unmerged import of the global setup, among the project's environment inputs, holds every file of the project", async () => {
    const repo = mergeRepo();
    writeFileSync(join(repo.main, SETUP), 'import "./setup-db.ts";\nexport default () => {};\n');
    writeFileSync(join(repo.main, SETUP_DEP), "export const db = 1;\n");
    git(repo.main, ["add", SETUP, SETUP_DEP]);
    git(repo.main, ["commit", "-qm", "setup"]);
    const side = holdSide(repo);
    const environment = side.runner.environment;
    side.runner.environment = async () =>
      (await environment()).map((e) => ({ ...e, files: [...e.files, SETUP, SETUP_DEP] }));
    await side.scheduler.start();
    await side.scheduler.idle();
    // The setup file itself is not unmerged: only the environment inputs name the conflict.
    const left = setupRaces(side, repo.main, { setupFile: SETUP, unmerged: SETUP_DEP }, 1);

    writeFileSync(join(repo.main, SETUP_DEP), "export const db = 2;\n");
    await batch(side, SETUP_DEP);
    await expect.poll(() => heldPaths(side), { timeout: 5_000 }).toEqual([SETUP_DEP]);
    await side.scheduler.idle();
    expect(left()).toBe(0);
    expectHeld(side, [A, B, OTHER]);
    expect(setupStates(side)).toEqual([]);

    git(repo.main, ["add", SETUP_DEP]);
    await expect
      .poll(() => [A, B, OTHER].map((path) => outcomes(side, path)), { timeout: 10_000 })
      .toEqual([["pass"], ["pass"], ["pass"]]);
    expect(setupStates(side)).toEqual([]);
  });

  it("control: the setup failure of a project the hold does not hold stands", async () => {
    const files: CatchUpFile[] = [...FILES, { project: "p", path: P_FILE, ms: 10, imports: [] }];
    const repo = mergeRepo(files);
    const side = holdSide(repo, repo.main, files, RUN_MISSING);
    await side.scheduler.start();
    await side.scheduler.idle();
    const race = { project: "p", setupFile: "p/global-setup.ts", unmerged: HELPER };
    const left = setupRaces(side, repo.main, race, 1);
    const tiers: string[][] = [];
    const run = side.runner.run;
    side.runner.run = async (ran, options) => {
      tiers.push(ran.map((f) => f.path).sort());
      return run(ran, options);
    };

    writeFileSync(join(repo.main, HELPER), helperReturning(7));
    side.touch(P_FILE);
    await batch(side, HELPER, P_FILE);
    await expect.poll(() => heldPaths(side), { timeout: 5_000 }).toEqual([HELPER]);
    await side.scheduler.idle();
    expect(left()).toBe(0);
    expect(tiers).toEqual([[P_FILE, A, B]]);
    expectHeld(side, [A, B]);
    expect(setupStates(side)).toEqual([{ project: "p", outcome: "fail", validity: "current" }]);
    expect(rows(side).get(P_FILE)?.pending).toBeNull();
    expect(unknownOf(side, [P_FILE])).not.toEqual([]);
  });
});
