import { expect } from "vitest";
import { daemonLiveness } from "../../src/core/delivery/liveness.js";
import { publishedBatches } from "../../src/core/scheduler/promotions.js";
import { standingsOf } from "../../src/core/status/standing.js";
import type { BatchPlace, EpochMs } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpRun,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import { ModelClock } from "./model-clock.js";
import { heldRun, holdRuns, ref, START_WITHIN_MS } from "./tier-yields-fixture.js";

/*
 * Row 011-268 (spec 011 C4 step 5 and C15 as amended 2026-10-29,
 * `research/named-wait-batches.md`): a named wait's batch held in flight.
 * The 55 files of P stand for cezar's parity gate, of 1 s to 217 s, so the
 * backlog's 120 s budget would cut them and the queue's order puts the
 * shortest first; Q is a later wait of 4 files of 60 s, S one file of 2 s,
 * E an edit's file, B the backlog beside them. The scheduler's clock is a
 * `ModelClock`, not installed: it stands still but for the side's
 * `advance`, so a wait's deadline passes only when a test moves it.
 */
export const X = "test/x.test.ts";
export const E = "test/e.test.ts";
export const S = "test/s.test.ts";
const named = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `test/${prefix}${String(i).padStart(3, "0")}.test.ts`);
export const P = named("p", 55);
export const Q = named("q", 4);
export const B = named("b", 20);
/** P's last-known durations: 2 s, over the tier-sharing floor beside X, to 218 s; 6,050 file-seconds. */
export const P_MS = (i: number) => 2_000 + i * 4_000;
/** P, longest first: the order a batch's tier takes them. */
export const P_LONGEST = P.toReversed();
const of = (paths: readonly string[], ms: number, source: string): CatchUpFile[] =>
  paths.map((path) => ({ path, ms, imports: [source] }));

/** The files of the repository; `backlog` false leaves B out, so no backlog is queued. */
function files(backlog: boolean): CatchUpFile[] {
  return [
    ...of([X], 10, "src/x.ts"),
    ...of([E], 10, "src/e.ts"),
    ...of([S], 2_000, "src/s.ts"),
    ...P.map((path, i) => ({ path, ms: P_MS(i), imports: ["src/p.ts"] })),
    ...of(Q, 60_000, "src/q.ts"),
    ...(backlog ? of(B, 1_000, "src/b.ts") : []),
  ];
}

export interface BatchSetup {
  /** How long the named wait on P lasts. */
  readonly waitMs?: number;
  /** The pool's slots. */
  readonly hostSlots?: number;
  /** Whether B is in the repository, queued as the backlog. */
  readonly backlog?: boolean;
}

/**
 * After a baseline, one revision makes X an edit's work and re-keys every
 * other file through the root environment; X's tier is held in flight
 * while a named wait selects P. Then X's tier ends and P's batch tier
 * starts, held in flight. 24 slots let it take all of P at the grant
 * (6,050 file-seconds over 24 workers is about 461 s, under the run's
 * 600 s deadline).
 */
export async function heldBatch({
  waitMs = 600_000,
  hostSlots = 24,
  backlog = true,
}: BatchSetup = {}) {
  const repo = catchUpRepo(files(backlog));
  const clock = new ModelClock();
  const side = catchUpSide(repo, repo.main, {
    files: files(backlog),
    hostSlots,
    policy: RUN_MISSING,
    now: clock.now,
  });
  await side.scheduler.start();
  await side.scheduler.idle();
  const base = side.runner.runs.length;
  const gate = holdRuns(side.runner, (path) => path === X || P.includes(path));
  await side.edit("watch", "src/x.ts", "config.json");
  const edit = await heldRun(side, X, base);
  expect(edit.files.some((f) => P.includes(f.path))).toBe(false);
  await side.scheduler.promote(
    P.map((path) => ref(path)),
    waitMs,
  );
  const after = side.runner.runs.length;
  side.runner.release();
  const batch = await firstOf(side, P, after);
  return { side, gate, batch, after };
}

export const paths = (run: CatchUpRun) => run.files.map((f) => f.path);

/** The first run after the first `after` that holds a file of `of`, once it has started. */
async function firstOf(side: CatchUpSide, of: readonly string[], after: number) {
  const first = () =>
    side.runner.runs.slice(after).find((run) => paths(run).some((path) => of.includes(path)));
  await expect.poll(() => first() !== undefined, { timeout: START_WITHIN_MS }).toBe(true);
  const run = first();
  if (run === undefined) throw new Error("no run of the batch");
  return run;
}

/** Each live batch's file, by path in the root project, and its place, as `side`'s daemon published them. */
export function batchesOf(side: CatchUpSide): Map<string, BatchPlace | null> {
  const { store, worktreeId } = side;
  const places = publishedBatches(store, worktreeId, 0 as EpochMs, side.now() as EpochMs);
  return new Map([...places].map(([id, place]) => [id.slice(id.indexOf("\0") + 1), place]));
}

/** The named-wait reading of `path` in `side` now, as `status --wait` reads it. */
export function standingOf(side: CatchUpSide, path: string) {
  const { store, worktreeId, root } = side;
  const now = Date.now() as EpochMs;
  const daemon = daemonLiveness(store.worktrees.get(worktreeId)?.daemon ?? null, now);
  const [file] = standingsOf(store, worktreeId, root, daemon, now)([ref(path)]);
  if (file === undefined) throw new Error(`no named file ${path}`);
  return file;
}
