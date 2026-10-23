import { expect } from "vitest";
import {
  type CatchUpFile,
  type CatchUpOptions,
  type CatchUpRun,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import { idleAfterQuiet } from "./quiet-clock.js";

/*
 * Task 011-25 (spec 011 C4 step 4 as amended 2026-10-20, `research/edit-cut.md`
 * done-when 1 to 10): an edited source, its own test, other direct
 * importers and files that reach it through another module, over the
 * catch-up fixture, whose runner splits `affected` into direct and
 * transitive.
 */

/** `count` direct importers `test/<name>N.test.ts` of `source`, of `ms(i)`. */
export function importers(
  name: string,
  source: string,
  ms: readonly number[],
  realMs = 0,
): CatchUpFile[] {
  return ms.map((m, i) => ({ path: `test/${name}${i}.test.ts`, ms: m, realMs, imports: [source] }));
}

/**
 * `count` files `test/<name>NNN.test.ts` that import `hub`, which reaches
 * `source`: 0.1 to 5 s each, the last of 60 s.
 */
export function transitive(
  name: string,
  source: string,
  count: number,
  hub = "src/hub.ts",
  realMs = 0,
): CatchUpFile[] {
  return Array.from({ length: count }, (_, i) => ({
    path: `test/${name}${String(i).padStart(3, "0")}.test.ts`,
    ms: i === count - 1 ? 60_000 : 100 + ((i * 37) % 50) * 100,
    realMs,
    imports: [hub],
    through: [source],
  }));
}

/** Six fast direct importers, all kept when their source has no namesake. */
export const SIX = [100, 200, 300, 400, 600, 800] as const;

/**
 * Four fast direct importers and two of 5 and 6 s: the cut keeps the four.
 * The two are slower than any kept file may share an edit's tier with
 * (`joinSpan`, task 001-184), so they run as catch-up and as nothing else.
 */
export const FOUR_SHORT = [100, 200, 300, 400, 5_000, 6_000] as const;

/** A daemon whose baseline ran every file, so each has a last-known duration. */
export async function started(
  files: readonly CatchUpFile[],
  options: Partial<CatchUpOptions> = {},
  others: readonly string[] = [],
) {
  const repo = catchUpRepo(files, others);
  const side = catchUpSide(repo, repo.main, { files, hostSlots: 23, tierSize: 4, ...options });
  await side.scheduler.start();
  await side.scheduler.idle();
  return { repo, side };
}

/** The runs after `before`, split: an edit's tiers (no grant) and the backlog route's (a grant). */
export function split(runs: readonly CatchUpRun[], before: number) {
  const after = runs.slice(before);
  const paths = (list: readonly CatchUpRun[]) =>
    list.flatMap((run) => run.files.map((f) => f.path)).sort();
  const edits = after.filter((run) => run.workers === undefined);
  const catchUp = after.filter((run) => run.workers !== undefined);
  return { after, edits, catchUp, editPaths: paths(edits), catchUpPaths: paths(catchUp) };
}

/** `side` edits `paths` as one watch revision and runs what it queued, its catch-up's wait skipped. */
export async function editAndRun(side: CatchUpSide, ...paths: string[]) {
  const before = side.runner.runs.length;
  await side.edit("watch", ...paths);
  await idleAfterQuiet(side);
  return split(side.runner.runs, before);
}

/**
 * The cut kept `kept` as an edit's work and made `demoted` catch-up. An
 * edit's tier leads with a kept file; once they are taken, files of
 * comparable time from the groups after fill its places (task 001-184).
 */
export function expectCut(
  result: ReturnType<typeof split>,
  kept: readonly CatchUpFile[],
  demoted: readonly CatchUpFile[],
): void {
  const keptPaths = pathsOf(kept);
  expect(result.editPaths).toEqual(expect.arrayContaining(keptPaths));
  expect(result.edits.map((run) => keptPaths.includes(run.files[0]?.path ?? ""))).not.toContain(
    false,
  );
  expect(result.catchUpPaths).toEqual(expect.arrayContaining(pathsOf(demoted)));
}

/** Every edit tier ran before the first catch-up tier, each within `runner.tierSize` and ungranted. */
export function expectEditsFirst(result: ReturnType<typeof split>, tierSize = 4): void {
  expect(result.edits.every((run) => run.files.length <= tierSize)).toBe(true);
  const lastEdit = Math.max(...result.edits.map((run) => result.after.indexOf(run)));
  const firstCatchUp = Math.min(...result.catchUp.map((run) => result.after.indexOf(run)));
  expect(lastEdit).toBeLessThan(firstCatchUp);
  // The backlog's route: the pool's grant, and more files than an edit's tier holds.
  expect(result.catchUp.some((run) => run.files.length > tierSize)).toBe(true);
}

export const pathsOf = (files: readonly CatchUpFile[]) => files.map((f) => f.path).sort();
