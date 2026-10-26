import { NO_YIELD_ROW, type YieldRow } from "../scheduler/yield-row.js";
import { publishedYieldRow } from "../scheduler/yields.js";
import {
  type EpochMs,
  isSlowLane,
  type LastYield,
  type RunRecord,
  type Standing,
  type Store,
  type TestFileRef,
  type WorktreeId,
} from "../types/index.js";

/*
 * Row 011-209 (`research/issue-91.md` F1 to F4, spec 011 C15): what a
 * pending file's standing gains from its live daemon's `yields` row: its
 * tier's yield standing, how many files of its run ended, the last yield
 * in its lane, and, on the first tier the daemon started in a lane, that no
 * yield before the daemon's start is kept (rule C, `tasks/011-209/notes.md`).
 */

type Pending = Extract<Standing, { readonly kind: "running" | "queued" | "unlisted" }>;

/** What a standing reads of its daemon: its `yields` row, its start, and status's lane of a file. */
export interface YieldReads {
  readonly row: YieldRow;
  /** The live daemon's start; `null` with none live. */
  readonly startedAt: EpochMs | null;
  readonly laneOf: (ref: TestFileRef) => string;
}

/** The live daemon's row, `NO_YIELD_ROW` with none live (`startedAt` `null`). */
export function liveYieldRow(
  store: Store,
  worktreeId: WorktreeId,
  startedAt: EpochMs | null,
): YieldRow {
  return startedAt === null ? NO_YIELD_ROW : publishedYieldRow(store, worktreeId, startedAt);
}

/**
 * `pending` of a file in `lane`, with what the row holds of `run`: the
 * file's own run when it runs, else the open run of its lane. Lanes are
 * status's (`laneOf`): the daemon's lane names are never compared with them.
 */
export function withYieldFacts(
  pending: Pending,
  lane: string,
  run: RunRecord | undefined,
  { row, startedAt, laneOf }: YieldReads,
): Pending {
  const last = lastIn(row, lane, run?.id, laneOf);
  const ended = run === undefined ? undefined : row.ended.get(run.id);
  if (pending.kind === "queued")
    return last === undefined ? pending : { ...pending, lastYield: last };
  if (run === undefined) return pending;
  if (pending.kind === "unlisted") {
    const waited = {
      lane,
      since: run.startedAt,
      files: run.testFiles.length,
      ...(ended === undefined ? {} : { ended }),
    };
    return { ...pending, run: waited };
  }
  const tier = row.tiers.get(run.id);
  const first = startedAt !== null && firstTier(row, lane, run, laneOf);
  return {
    ...pending,
    ...(tier === undefined ? {} : { yields: tier }),
    ...(ended === undefined ? {} : { ended }),
    ...(last === undefined ? {} : { lastYield: last }),
    ...(first ? { yieldsSince: startedAt } : {}),
  };
}

/**
 * `row`'s last yield when it cut files of `lane` and a run other than
 * `runId`, its lane as status words it.
 */
function lastIn(
  row: YieldRow,
  lane: string,
  runId: string | undefined,
  laneOf: (ref: TestFileRef) => string,
): LastYield | undefined {
  const { last } = row;
  const [cut] = last?.files ?? [];
  if (last === null || cut === undefined || last.runId === runId) return undefined;
  return laneOf(cut) === lane ? { ...last, lane } : undefined;
}

/**
 * Rule C: `run`, of several files in a fast lane, is the first tier its
 * daemon started there, as no tier of that lane ended in it, and the daemon
 * keeps no yield: whatever a predecessor cut is not kept.
 */
function firstTier(
  row: YieldRow,
  lane: string,
  run: RunRecord,
  laneOf: (ref: TestFileRef) => string,
): boolean {
  if (run.testFiles.length < 2 || isSlowLane(lane) || row.last !== null) return false;
  return ![...row.lanes.values()].some((ref) => laneOf(ref) === lane);
}
