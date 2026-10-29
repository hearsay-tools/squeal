import { expect } from "vitest";
import { publishedYieldRow } from "../../src/core/scheduler/yields.js";
import type { TierYield } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpRun,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import { ModelClock } from "./model-clock.js";
import { heldRun, holdRuns, ref } from "./tier-yields-fixture.js";

/*
 * Row 011-265 (gh-79, gh-121; spec 011 C4 step 5 as amended 2026-10-28,
 * `research/issue-79-gate.md` option B): the setup of the promoted-only
 * tier's tests. The 56 promoted files stand for cezar's parity files of
 * #79, the 100 others for the backlog beside them. The scheduler's clock is
 * a `ModelClock`, not installed: it stands still but for the side's
 * `advance`, so no tier has run any time and no promotion passes its
 * deadline while a test reads; the timers stay the host's.
 */
export const X = "test/x.test.ts";
export const E = "test/e.test.ts";
const named = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `test/${prefix}${String(i).padStart(3, "0")}.test.ts`);
export const P = named("p", 56);
export const B = named("b", 100);
const of = (paths: readonly string[], ms: number, source: string): CatchUpFile[] =>
  paths.map((path) => ({ path, ms, imports: [source] }));
/** Over 30 s, so a tier of P has a remainder an edit's work would make it yield on (rule B). */
const P_MS = 31_000;
// The backlog's files sort first in their group (shortest first), so the edit's tier takes none of P.
const FILES: CatchUpFile[] = [
  ...of([X], 10, "src/x.ts"),
  ...of([E], 10, "src/e.ts"),
  ...of(P, P_MS, "src/p.ts"),
  ...of(B, 1_000, "src/b.ts"),
];
export const holdX = (path: string) => path === X;
const holdXP = (path: string) => path === X || P.includes(path);

export interface Setup {
  /** How long the named wait promotes P. */
  readonly promoteMs?: number;
  /** The pool's slots. */
  readonly hostSlots?: number;
}

/**
 * After a baseline, one revision makes X an edit's work and re-keys every
 * other file through the root environment, as the backlog; X's tier is held
 * in flight, its lane busy, while a named wait promotes P. X's 10 ms leaves
 * no remainder to yield on. The pool's 24 slots let one tier take all of P
 * within the wall budget (56 × 31 s over 20 workers or more is under 120 s).
 */
export async function promotedBehindEdit(
  held: (path: string) => boolean,
  { promoteMs = 600_000, hostSlots = 24 }: Setup = {},
) {
  const repo = catchUpRepo(FILES);
  const now = new ModelClock().now;
  const side = catchUpSide(repo, repo.main, {
    files: FILES,
    hostSlots,
    policy: RUN_MISSING,
    now,
  });
  await side.scheduler.start();
  await side.scheduler.idle();
  const base = side.runner.runs.length;
  const gate = holdRuns(side.runner, held);
  await side.edit("watch", "src/x.ts", "config.json");
  const edit = await heldRun(side, X, base);
  expect(edit.files.some((f) => P.includes(f.path))).toBe(false);
  await side.scheduler.promote(
    P.map((path) => ref(path)),
    promoteMs,
  );
  return { side, gate, after: side.runner.runs.length };
}

/** `promotedBehindEdit` with P held too: X's tier ends and the promoted-only tier is held in flight. */
export async function heldWide(setup: Setup = {}) {
  const held = await promotedBehindEdit(holdXP, setup);
  held.side.runner.release();
  const wide = await heldRun(held.side, P[0] ?? "", held.after);
  // Row 011-268: a batch's tier takes all of P within the run's deadline, at 4 slots too.
  expect(paths(wide).toSorted()).toEqual(P);
  return { ...held, wide };
}

export const paths = (run: CatchUpRun) => run.files.map((f) => f.path);
export const holdsP = (run: CatchUpRun) => run.files.some((f) => P.includes(f.path));

/** What each tier in flight of `side` does for a wait, as its daemon last published. */
export function standings(side: CatchUpSide): TierYield["kind"][] {
  const { store, worktreeId } = side;
  return [...publishedYieldRow(store, worktreeId, 0).tiers.values()].map((t) => t.kind);
}
