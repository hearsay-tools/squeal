import { daemonLiveness } from "../../src/core/presence/heartbeat.js";
import { readYieldRow } from "../../src/core/scheduler/yield-row.js";
import { yieldsMetaKey } from "../../src/core/scheduler/yields.js";
import { standingsOf } from "../../src/core/status/standing.js";
import type { EpochMs } from "../../src/core/types/common.js";
import { isBesideLane } from "../../src/core/types/runner.js";
import type { TierOverrun } from "../../src/core/types/standing.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import type { VirtualClock } from "../helpers/virtual-clock.js";
import { Gate } from "./batch-fixture.js";
import {
  type CatchUpFile,
  type CatchUpRun,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import { heldRun, ref, settle } from "./tier-yields-fixture.js";

/*
 * Row 011-399 (gh-233): a tier of 4 whose file H never ends, on a virtual
 * clock, with the fake runner that reports no file's end, so the tier's four
 * files are all unfinished. Shared by `overrun-beside.test.ts` and
 * `overrun-calendar.test.ts`.
 */

export const H = "test/h.test.ts";
export const MATES = ["test/m0.test.ts", "test/m1.test.ts", "test/m2.test.ts"];
export const queued = (count: number) =>
  Array.from({ length: count }, (_, i) => `test/q${String(i).padStart(4, "0")}.test.ts`);

/** H and its mates lead the edit's order (shortest first); every file imports `src/a.ts`. */
function files(hMs: number, count: number): CatchUpFile[] {
  return [
    { path: H, ms: hMs, imports: ["src/a.ts"] },
    ...MATES.map((path) => ({ path, ms: hMs, imports: ["src/a.ts"] })),
    ...queued(count).map((path) => ({ path, ms: Math.max(10, hMs + 1), imports: ["src/a.ts"] })),
  ];
}

export const besideRuns = (side: CatchUpSide, after: number) =>
  side.runner.runs.slice(after).filter((run) => isBesideLane(run.lane ?? ""));
export const pathsOf = (run: CatchUpRun) => run.files.map((f) => f.path);

/** The overruns `side`'s daemon published in its `yields` row (additive key, row 011-399). */
export function overrunsOf(side: CatchUpSide): TierOverrun[] {
  const row = readYieldRow(side.store.meta.get(yieldsMetaKey(side.worktreeId)), 0 as EpochMs);
  return [...(row.overruns ?? new Map<string, TierOverrun>()).values()];
}

/** What status reads of `paths` at the scheduler's calendar time, its daemon alive on the host's. */
export function read(side: CatchUpSide, paths: readonly string[]) {
  const { store, worktreeId, root } = side;
  const daemon = daemonLiveness(store.worktrees.get(worktreeId)?.daemon ?? null, Date.now());
  return standingsOf(
    store,
    worktreeId,
    root,
    daemon,
    side.now() as EpochMs,
  )(paths.map((p) => ref(p)));
}

/**
 * After a baseline, an edit of `src/a.ts` queues every file as the edit's
 * work; the first tier holds H and its three mates and stays in flight. Runs
 * beside it wait on `beside` while it holds.
 */
export async function hungTier(hMs: number, count: number) {
  const all = files(hMs, count);
  const repo = catchUpRepo(all);
  const side = catchUpSide(repo, repo.main, {
    files: all,
    hostSlots: 8,
    policy: RUN_MISSING,
    clock: "virtual",
  });
  await side.scheduler.start();
  await settle(side);
  const hung = new Gate();
  const beside = new Gate();
  side.runner.holdOf = (run) => {
    if (isBesideLane(run.lane ?? "")) return beside.wait();
    return pathsOf(run).includes(H) ? hung.wait() : undefined;
  };
  const after = side.runner.runs.length;
  await side.edit("watch", "src/a.ts");
  const tier = await heldRun(side, H, after);
  return { side, hung, beside, tier, after };
}

/**
 * `hungTier(5, 4)` with the live daemon's record started 2 h earlier, so the
 * row's stamp floor (row 011-386) plays no part in a calendar step; `start`
 * is the calendar time at the tier's start (review 0.1.567 B2).
 */
export async function hung() {
  const held = await hungTier(5, 4);
  const { store, worktreeId } = held.side;
  const daemon = store.worktrees.get(worktreeId)?.daemon;
  if (daemon)
    store.worktrees.setDaemon(worktreeId, { ...daemon, startedAt: daemon.startedAt - 7_200_000 });
  return { ...held, start: held.side.now(), clock: held.side.clock as VirtualClock };
}

/** H's overrun as status reads it now: its age and the time left to its deadline. */
export function facts(side: Awaited<ReturnType<typeof hung>>["side"]) {
  const [named] = read(side, [H]);
  const standing = named?.standing;
  const overrun = standing?.kind === "running" ? standing.overrun : undefined;
  const deadline = overrun?.deadline ?? null;
  return {
    ranMs: overrun?.ranMs,
    leftMs: deadline === null ? null : deadline - side.now(),
  };
}
