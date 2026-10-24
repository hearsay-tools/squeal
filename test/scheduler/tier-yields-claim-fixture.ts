import { daemonLiveness } from "../../src/core/delivery/liveness.js";
import { standingsOf } from "../../src/core/status/standing.js";
import type { TestFileRef } from "../../src/core/types/index.js";
import {
  type CatchUpFile,
  type CatchUpOptions,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import { holds } from "./tier-yields-fixture.js";

/*
 * Row 011-55 (spec 011 C15 and C7): what the tests of a promoted file under
 * another worktree's claim share. Two worktrees on one store; the other runs
 * F's key, held, while this one runs four slow files.
 */
export const SLOW = [1, 2, 3, 4].map((i) => `test/s${i}.test.ts`);
export const isSlow = (path: string) => SLOW.includes(path);
export const F = "f/f.test.ts";
export const G = "g/g.test.ts";

/** The test files: four slow ones of `slowMs`, F of `fMs`, G of 1 ms. */
export function filesOf(slowMs: number, fMs: number): CatchUpFile[] {
  return [
    ...SLOW.map((path) => ({ path, ms: slowMs, imports: ["src/s.ts"] })),
    { project: "f", path: F, ms: fMs, imports: ["src/f.ts"] },
    { project: "g", path: G, ms: 1, imports: ["src/g.ts"] },
  ];
}

/**
 * Both worktrees started and idle. `options` are this worktree's: its
 * policy's timeout, its clock, and a `policy` set over the defaults; under
 * `RUN_MISSING` its start runs every file and the other inherits the results.
 */
export async function sides(
  files: CatchUpFile[],
  options: Pick<CatchUpOptions, "timeoutMs" | "now" | "policy"> = {},
): Promise<{ main: CatchUpSide; other: CatchUpSide }> {
  const repo = catchUpRepo(files);
  const main = catchUpSide(repo, repo.main, { files, hostSlots: 8, ...options });
  await main.scheduler.start();
  await main.scheduler.idle();
  const other = catchUpSide(repo, repo.other, { files, hostSlots: 8 });
  await other.scheduler.start();
  await other.scheduler.idle();
  return { main, other };
}

/** How many runs of `side` after the first `after` held `path`. */
export function ranSince(side: CatchUpSide, path: string, after: number): number {
  return side.runner.runs.slice(after).filter((run) => holds(run, path)).length;
}

export function rowOf(side: CatchUpSide, path: string) {
  return side.store.testFileKeys.list(side.worktreeId).find((r) => r.testFile.path === path);
}

/** `file` as a named wait in `side` reads it now. */
export function named(side: CatchUpSide, file: TestFileRef) {
  const { store, worktreeId, root } = side;
  const now = Date.now();
  const daemon = daemonLiveness(store.worktrees.get(worktreeId)?.daemon ?? null, now);
  const [entry] = standingsOf(store, worktreeId, root, daemon, now)([file]);
  if (entry === undefined) throw new Error("no named file");
  return entry;
}
