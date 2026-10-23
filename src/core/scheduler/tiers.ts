import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { defaultHostSlots, type PoolLease } from "../capacity/index.js";
import type { StatCache } from "../hash/index.js";
import { listedDirectory, testFileId } from "../keys/index.js";
import { readRunLoads } from "../retry/index.js";
import type {
  CheckKey,
  ProjectName,
  Provenance,
  RelativePath,
  RunReport,
  TestFileRef,
} from "../types/index.js";
import { BacklogWall, backlogBudget } from "./backlog.js";
import { WAIT_FOR_CAPACITY, widthLease } from "./capacity.js";
import { NOTHING_CHANGED, type SchedulerContext } from "./context.js";
import { rerunGrown } from "./environment-growth.js";
import type { FileState } from "./files.js";
import { healsUnheld } from "./hold.js";
import type { Ledger, RevisionState } from "./ledger.js";
import { NOTHING_OBSERVED, type TierObservations } from "./observed.js";
import { priorityOf } from "./queue.js";
import { recordsForFile } from "./records.js";
import {
  endRerun,
  failsAfterTestsPassed,
  holdsNewFailure,
  type NewFailure,
  queueReruns,
  rememberReruns,
} from "./rerun.js";
import { endRetry, recordFailedLoad, tierLoad } from "./retries.js";
import { storeClosures } from "./revision.js";
import { failStartup } from "./setup.js";
import { type CutFiles, joinSpan, NONE_CUT, type TierSpan } from "./sharing.js";
import { backlogSlot, joinsSlot } from "./slots.js";
import { laneFor } from "./slow.js";
import { changedSince, type Moved, snapshotInputs } from "./stability.js";
import { storeDecision, tierEnd } from "./store-decision.js";
import { storeResults } from "./store-results.js";
import { requeueSplit, timedOutReason } from "./timeout-split.js";

export { supersededIn } from "./store-decision.js";

/** One test file of a tier and the key it runs under. */
export interface TierFile {
  readonly file: FileState;
  readonly key: CheckKey;
  /** Closure, environment files and lockfile: what must hold still during the run. */
  readonly inputs: readonly RelativePath[];
  /** The checkpoint that requested this file, when it was selected (review S9). */
  readonly checkpointId: string | null;
  /** Queued by `run --all --force`: a re-queue keeps it forced (task 001-107). */
  readonly forced: boolean;
  /** Queued as work an edit caused (D5 step 4): a re-queue after a timeout keeps it so (task 001-179). */
  readonly recent?: boolean;
  /** Queued as catch-up (C4 step 4 as amended 2026-10-20): a cancel's re-queue keeps it so (011-22). */
  readonly catchUp?: boolean;
  /** Another worktree's result could stand for it: it waits on a claim of its key (`claimOf`, task 001-205). */
  readonly waits?: boolean;
}

export interface Tier {
  readonly runId: string;
  readonly logDir: string;
  /** The lane of every file of the tier (`laneOf`, task 001-140). */
  readonly lane: string;
  /** `WorktreeKeys.beginRun`'s number for the run (task 001-134). */
  readonly run: number;
  /** Paths changed by revisions since the tier was selected; in `Ledger.tierChanges` while in flight. */
  readonly changes: Set<RelativePath>;
  readonly revision: RevisionState;
  /** `RunRecord.checkpointId`: the open checkpoint when it requested any file of the tier. */
  readonly checkpointId: string | null;
  readonly files: readonly TierFile[];
  /** The stat cache entries of every input when the tier was selected. */
  readonly snapshot: StatCache;
  /**
   * What the tier is (`TierKind`): which rules of C4 step 5 may cancel it in
   * flight. `startTier` always sets it; absent, the tier counts as an edit's.
   */
  readonly kind?: TierKind;
  /** When it started, on the scheduler's clock: its estimated remainder runs from here (`TierYields`). */
  readonly startedAt?: number;
  /**
   * The ids of its files whose module ended during the run, as the runner
   * names them (`RunOptions.fileEnded`, row 011-54): `TierYields` reads the
   * others as unfinished. Results still wait for the report. Absent or
   * empty: every file is unfinished.
   */
  readonly ended?: Set<string>;
  /**
   * Aborted to cancel the tier in flight (`TierYields`, spec 011 C4 step 5
   * as amended 2026-10-21, row 011-51): a backlog tier's always; any other
   * but a slow one when its runner cancels a run (`cancels`). `null` otherwise.
   */
  readonly cancel: AbortController | null;
  /** A backlog or checkpoint tier's grant from the per-user pool, returned when it ends (`endTier`). */
  readonly lease?: PoolLease;
  /** The host's load per CPU when the tier started (`tierLoad`, 001-368); `null` when not known. */
  readonly loadPerCpu?: number | null;
  /**
   * A backlog slot (`backlogSlot`, spec 011 C4 step 5 as amended for slots,
   * task 011-21 slice 2): its lane takes the next file once its run ends,
   * and its record joins the next one.
   */
  readonly slot?: boolean;
}

/**
 * What a tier is, for C4 step 5 as amended 2026-10-21 (row 011-51):
 * `backlog`, selected while no work of the first group was queued, or a
 * backlog slot (the turn's included), which an edit's work cancels; `turn`,
 * the backlog's turn after four tiers of the first group, which only a
 * revision that supersedes it cancels; `edit`, any other fast tier, which
 * yields too; `slow`, a slow tier (spec 004 D2), which nothing cancels.
 */
export type TierKind = "backlog" | "turn" | "edit" | "slow";

/**
 * The lane of `ref` (`RunnerAdapter.lane`): one tier at a time per lane, so
 * tiers of different lanes run at once (D5 as amended, task 001-140). A
 * runner that names none has one lane. A slow file's lane is its runner's
 * behind `SLOW_LANE_PREFIX`, a runner instance of its own, so fast tiers run
 * beside it (spec 004 D2, task 004-18).
 */
export function laneOf(context: SchedulerContext, ref: TestFileRef): string {
  return laneFor(context.policy, ref, context.runner.lane?.(ref) ?? "");
}

/**
 * Picks the next tier from the queue as the latest revision ordered it.
 *
 * Spec 001 D5: "runs them in tiers of a configurable size (default 4 test
 * files). Between tiers it re-plans against the latest revision." Each key is
 * looked up once more just before it would run, because another worktree may
 * have stored it meanwhile (`Ledger.lookup`, spec 004 D6); forced entries
 * skip the lookup. Returns `null` when no fast file is left to run: slow
 * files are never in these tiers (spec 004 D2, `selectSlowTier`).
 *
 * While no queued file is recent or promoted (spec 011 C15), the tier is
 * the backlog's: up to `runner.backlogTierSize` files, cancelled by the next
 * edit (D5 step 5 as amended, task 001-124; lessons, defect 25: 559 tiers of
 * 4 took 4.6 h where one `npm test` took 514 s). It takes one file per
 * worker it will run with at the grant the pool offers (`tierWidth`), then
 * more while their estimated wall time stays within `backlogBudget`
 * (`BacklogWall`, spec 011 C4 step 5 as amended, task 001-366). The budget
 * bounds the selection, not the run: unknown durations count 0 and the
 * first round is always taken. A runner that cannot cancel runs its backlog
 * in slots instead (`backlogSlot`, C4 step 5 as amended for slots, task
 * 011-21 slice 2): a backlog tier of its lane is one slot, one file, or a
 * pytest batch of light files (`joinsSlot`), and asks the pool for one
 * permit; its lane holds up to `runner.tierSize` of them (`busyLanes`). An
 * edit's tier of such a lane takes only the edit's work: the backlog's
 * files run in the slots, which hold the permits.
 *
 * A tier holds the files of one lane, the lane of the first file it takes;
 * files of a lane in `busy` (`busyLanes`), which takes no tier now, stay
 * queued and are not looked up (task 001-140). Whether the tier is the
 * backlog's is decided on the free lanes' files.
 *
 * Any other tier takes a file only beside files of a comparable last-known
 * time (`joinSpan`, task 001-184): a tier stores its results when it ends,
 * so a file far slower than one already taken waits for the next tier
 * instead of holding the faster file's result (lessons, defect 31). Nor
 * does it hold both a file a yield `cut` past its tier's estimate and one
 * it did not so cut (row 011-112): the file the tier yielded to does not
 * wait for the cut files to run again from their start.
 *
 * A file a timed-out tier left incomplete joins a tier of at most its
 * `tierCap` files; one that does not fit stays queued and leads a later tier
 * (task 001-179).
 *
 * A missed file another worktree's result could stand for, whose key another
 * live worktree is running, stays queued in its place and does not count
 * against the budget (`Claims`, D5 step 4 as amended, task 001-205); a
 * backlog tier is split with the other daemons that have its keys pending
 * (`Claims.backlogSize`).
 *
 * A lane that waits for quiet after its backlog tier's cancel
 * (`BacklogQuiet`, C4 step 5 as amended 2026-10-21, row 011-82) takes no
 * backlog tier: its files stay queued, as a busy lane's do. Its edit's work
 * and the turn below start as before.
 *
 * The second group's turn after four tiers of the first (C4 step 4, catch-up
 * first) is selected while an edit's work is queued, so it is never
 * cancelled and holds `runner.tierSize` files of a comparable time; it still
 * takes the backlog's grant, and in a lane of slots it is one slot (review
 * W4r of wave 4, task 011-22). Where the pool makes it wait, the edit's tier
 * goes first and the turn comes after it.
 *
 * A backlog tier takes its grant from the per-user pool after its files are
 * picked and before `startTier` claims their keys, so a daemon that waits for
 * capacity holds no claim (D11 Capacity, task 001-376). It asks for no more
 * workers than its runner runs it with, and a grant below the offer trims
 * the picked tail to the same rule at the grant (task 001-366), and no fewer
 * than its runner runs it with at a grant of 1 (`fewest`, row 011-97: a
 * Vitest project with `isolate: false` runs 2). It waits while
 * no permit it may take is free, holding none: the pump looks again when a
 * tier of this daemon ends and at least every `CAPACITY_RECHECK_MS` (011 C10
 * as amended 2026-10-21, row 011-96). An edit's tier takes no grant and
 * never waits on the pool.
 */
export function selectTier(
  context: SchedulerContext,
  ledger: Ledger,
  busy: ReadonlySet<string> = new Set(),
  cut: CutFiles = NONE_CUT,
  turnDue = ledger.queue.backlogTurn(),
): Tier | null {
  const { keys, policy } = context;
  const picked: TierFile[] = [];
  ledger.claims.begin();
  const backlog = !ledger.queue.hasFirstGroup((ref) => !busy.has(laneOf(context, ref)));
  /** The second group's turn after four tiers of the first (C4 step 4): it leads `ordered`. */
  const turn = !backlog && turnDue;
  /** The tier is the turn's: it took a file of the second group first. */
  let turnTier = false;
  let size = backlog ? ledger.claims.backlogSize(ledger.queue.fastSize) : policy.runner.tierSize;
  // Without a pool a runner runs as wide as its own default: CPUs − 1 for Vitest and node:test.
  const offer = backlog ? (context.capacity?.offer(size) ?? defaultHostSlots()) : 0;
  const wall = backlog ? new BacklogWall(backlogBudget(policy.runner.timeoutMs)) : null;
  let span: TierSpan | null = null;
  let tookBacklog = false;
  let lane: string | null = null;
  /** The files a backlog slot takes at most, once its first file's runner runs slots. */
  let slot: number | null = null;
  /** A backlog file left to a lane's slots by an edit's tier. */
  let skipped = false;
  const now = context.now();
  for (const ref of ledger.ordered(turnDue)) {
    if (picked.length >= size) break;
    const at = laneOf(context, ref);
    if (busy.has(at) || (lane !== null && at !== lane)) continue;
    // A lane that waits for quiet after its backlog tier's cancel starts no backlog tier (row 011-82).
    if (backlog && context.quiet?.waits(at, now) === true) continue;
    const file = ledger.file(ref);
    const key = file?.key ?? null;
    if (!file || key === null || file.blocked !== null) {
      ledger.queue.remove(ref);
      if (file) ledger.touch(file);
      continue;
    }
    const forced = ledger.queue.isForced(ref);
    const recent = ledger.queue.isRecent(ref);
    const catchUp = ledger.queue.isCatchUp(ref);
    // A lane of slots runs the backlog's files there, each with its permit: an edit's tier takes
    // only the edit's work (task 011-21 slice 2), except on the backlog's turn after four tiers of
    // the first group, which takes them as it does in any lane (review wave-4 slice 2, B2).
    if (
      !backlog &&
      !ledger.queue.isFirstGroup(ref) &&
      !turn &&
      backlogSlot(context, ref) !== null
    ) {
      skipped = true;
      continue;
    }
    let waits = false;
    if (!forced) {
      const { hits, mayWait } = ledger.probe(key);
      if (hits.length > 0) {
        ledger.applyResults(file, key, hits, ledger.checkpoints.idFor(ref));
        continue;
      }
      waits = mayWait && !recent;
      if (waits && ledger.claims.holds(key)) continue;
    }
    const cap = Math.min(size, file.tierCap ?? size);
    if (picked.length >= cap) continue;
    if (picked.length === 0 && (backlog || (turn && !ledger.queue.isFirstGroup(ref)))) {
      turnTier = !backlog;
      slot = backlogSlot(context, ref);
    } else if (slot !== null && !joinsSlot(picked, file, (r) => partOf(context, r))) break;
    if (!backlog && slot === null) {
      const joined = joinSpan(span, file.durationMs, cut.cutPastEstimate(file));
      if (joined === null) continue;
      span = joined;
    }
    if (
      slot === null &&
      wall !== null &&
      !wall.take(file.durationMs, tierWidth(context, ref, offer), partOf(context, ref))
    )
      break;
    tookBacklog ||= !recent && !ledger.queue.isPromoted(ref);
    lane = at;
    size = Math.min(cap, slot ?? cap);
    const checkpointId = ledger.checkpoints.idFor(ref);
    const inputs = keys.stabilityPaths(ref);
    picked.push({ file, key, inputs, checkpointId, forced, recent, waits, catchUp });
  }
  const granted = backlog || turnTier;
  const width = slot !== null ? 1 : granted ? widest(context, picked) : 0;
  const least = slot !== null ? 1 : fewest(context, picked);
  const taken = picked.length > 0 && granted ? context.capacity?.take(width, "fast", least) : null;
  if (taken === WAIT_FOR_CAPACITY) {
    ledger.commit();
    // The turn holds no edit's tier back on the pool: that tier goes, and the turn comes after it.
    return turnTier ? selectTier(context, ledger, busy, cut, false) : null;
  }
  const lease = taken ? widthLease(taken, width) : taken;
  if (backlog && slot === null && lease && lease.grant < Math.min(width, offer)) {
    // Granted less than offered (another daemon took permits meanwhile): the prefix that fits.
    const fits = new BacklogWall(backlogBudget(policy.runner.timeoutMs));
    const keep = picked.findIndex(
      (p) =>
        !fits.take(
          p.file.durationMs,
          tierWidth(context, p.file.ref, lease.grant),
          partOf(context, p.file.ref),
        ),
    );
    if (keep !== -1) picked.splice(keep);
  }
  let tier: Tier | null = null;
  try {
    // The turn's slot is a slot as any other; its runner cannot cancel it (C4 step 5).
    const kind = backlog || (turnTier && slot !== null) ? "backlog" : turnTier ? "turn" : "edit";
    tier =
      picked.length === 0 ? null : startTier(context, ledger, picked, kind, lease ?? undefined);
  } finally {
    // The tier owns the lease once it starts; until then it is returned here (review 001-384, B2).
    if (tier === null) lease?.release();
  }
  if (tier !== null) {
    ledger.queue.tierSelected(tookBacklog);
    return tier;
  }
  ledger.commit();
  // A result recorded since the lookup settled a pick in the start: the queue moved (review wave 13o, B1).
  const settled = picked.some((p) => !ledger.queue.has(p.file.ref));
  // The edit's work settled by lookups and left only the backlog's: its slots start now.
  const slots =
    skipped &&
    picked.length === 0 &&
    !ledger.queue.hasFirstGroup((r) => !busy.has(laneOf(context, r)));
  return settled || slots ? selectTier(context, ledger, busy, cut, turnDue) : null;
}

/** How many files a backlog tier holding `ref` runs at once at `grant` workers (task 001-366). */
function tierWidth(context: SchedulerContext, ref: TestFileRef, grant: number): number {
  return Math.max(1, context.runner.tierWidth?.(ref, grant) ?? grant);
}

/** The part of a backlog tier `ref` runs in; parts run one after another (review wave-3 B1). */
function partOf(context: SchedulerContext, ref: TestFileRef): string {
  return context.runner.tierPart?.(ref) ?? "";
}

/** The workers a backlog tier of `picked` asks the pool for: no more than its runner runs it with. */
function widest(context: SchedulerContext, picked: readonly TierFile[]): number {
  const widths = picked.map((p) => tierWidth(context, p.file.ref, picked.length));
  return Math.min(picked.length, Math.max(1, ...widths));
}

/**
 * The fewest permits a backlog tier of `picked` may hold (row 011-97): the
 * workers its runner runs it with at a grant of 1, at most one per file.
 */
function fewest(context: SchedulerContext, picked: readonly TierFile[]): number {
  const widths = picked.map((p) => tierWidth(context, p.file.ref, 1));
  return Math.min(picked.length, Math.max(1, ...widths));
}

/**
 * Records the start of a tier of `picked`, files still queued: in one
 * `BEGIN IMMEDIATE`, each file that is not forced is looked up once more
 * (`Ledger.probe`): a result that may stand for it is applied and it leaves
 * the tier, as in `selectTier`; one withheld runs here (review wave 13o, B1:
 * a tier that recorded the key since the selection released its claim too).
 * Each file that `waits` is checked for another worktree's claim once more
 * and stays queued when one holds, then the others leave the queue with
 * their `running` phases, which are this worktree's claims, and the run row
 * (D8 as amended, task 001-205: a check before the transaction let two
 * daemons take one key). Then the stability snapshot. `null` when every file
 * settled or stayed queued; what settled is committed. `kind` says which
 * rules of C4 step 5 may cancel it (`TierKind`); a backlog tier gets its
 * cancel, and any other but a slow one when its runner cancels (`cancels`).
 * `lease` is a backlog tier's grant, kept for as many files as start.
 */
export function startTier(
  context: SchedulerContext,
  ledger: Ledger,
  picked: readonly TierFile[],
  kind: TierKind,
  lease?: PoolLease,
): Tier | null {
  const { store, keys } = context;
  return store.transaction(() => {
    const files = picked.flatMap((p) => startable(ledger, p));
    const first = files[0];
    if (first === undefined) {
      ledger.commit();
      return null;
    }
    const checkpointId = files.find((p) => p.checkpointId !== null)?.checkpointId ?? null;
    const runId = randomUUID();
    const slot = kind === "backlog" && backlogSlot(context, first.file.ref) !== null;
    const cancellable = kind === "backlog" || (kind !== "slow" && cancels(context, first.file.ref));
    const tier: Tier = {
      runId,
      logDir: join(context.runsDir, runId),
      lane: laneOf(context, first.file.ref),
      run: keys.beginRun(),
      changes: new Set(),
      revision: ledger.revision,
      checkpointId,
      files,
      snapshot: snapshotInputs(
        keys.cache,
        files.flatMap((p) => p.inputs),
      ),
      kind,
      startedAt: context.now(),
      ended: new Set(),
      cancel: cancellable ? new AbortController() : null,
      ...(lease === undefined ? {} : { lease }),
      loadPerCpu: tierLoad(context),
      ...(slot ? { slot: true } : {}),
    };
    lease?.shrinkTo(files.length);
    for (const { file, key } of files) {
      ledger.queue.remove(file.ref);
      ledger.claims.taken(key);
      ledger.setRunning(file, key);
    }
    ledger.tierChanges.add(tier.changes);
    store.runs.start({
      id: runId,
      worktreeId: context.worktreeId,
      revision: tier.revision.number,
      testFiles: files.map((p) => p.file.ref),
      checkpointId,
      logDir: tier.logDir,
      startedAt: context.now(),
    });
    ledger.commit();
    return tier;
  });
}

/**
 * Whether the runner of `ref`'s lane cancels a run in flight: one that runs
 * its backlog in tiers, not in slots (Vitest; C4 step 5: "a runner that
 * cannot cancel (node:test, pytest) runs its backlog in slots").
 */
export function cancels(context: SchedulerContext, ref: TestFileRef): boolean {
  return backlogSlot(context, ref) === null;
}

/**
 * In `startTier`'s transaction: `[p]` when it starts, with whether it still
 * waits; `[]` when a result now stands for it (applied) or another
 * worktree's claim holds its key. A forced file always starts; a file only
 * waits when it did at selection and nothing is withheld now.
 */
function startable(ledger: Ledger, p: TierFile): TierFile[] {
  if (p.forced) return [p];
  const { hits, mayWait } = ledger.probe(p.key);
  if (hits.length > 0) {
    ledger.applyResults(p.file, p.key, hits, p.checkpointId);
    return [];
  }
  const waits = p.waits === true && mayWait;
  if (waits && ledger.claims.holds(p.key)) return [];
  return [{ ...p, waits }];
}

/**
 * Runs a tier; with `observeIgnored`, for a warm-up (task 001-307). `stop`,
 * a `squeal stop`, cancels it whatever its kind, as an edit cancels a
 * backlog tier (D10, task 001-367). Each file the runner names as ended
 * joins `Tier.ended`, then `onFileEnd` hears of it (row 011-54). A tier
 * holds only what it runs: once its files that have not ended are fewer
 * than its lease's permits, the lease returns the rest (011 C10 as amended
 * 2026-10-21, row 011-97). A tier without a lease, an edit's, is told to
 * the pool while it runs, so its CPU counts against backlog tiers (row
 * 011-98). Never rejects: a runner that throws is a crash (D12).
 */
export async function executeTier(
  context: SchedulerContext,
  tier: Tier,
  observeIgnored = false,
  stop?: AbortSignal,
  onFileEnd?: () => void,
): Promise<RunReport> {
  const started = context.now();
  const signals = [tier.cancel?.signal, stop].filter((signal) => signal !== undefined);
  const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
  const fileEnded = (ref: TestFileRef) => {
    tier.ended?.add(testFileId(ref));
    const left = tier.files.filter(({ file }) => tier.ended?.has(file.id) !== true).length;
    if (left > 0) tier.lease?.shrinkTo(left);
    onFileEnd?.();
  };
  const unleased = tier.lease === undefined ? context.capacity?.running(tier.files.length) : null;
  try {
    return await context.runner.run(
      tier.files.map((f) => f.file.ref),
      {
        runId: tier.runId,
        logDir: tier.logDir,
        timeoutMs: context.policy.runner.timeoutMs,
        ...(signal === undefined ? {} : { signal }),
        ...(stop === undefined ? {} : { stop }),
        lane: tier.lane,
        ...(observeIgnored ? { observeIgnored } : {}),
        ...(tier.lease === undefined ? {} : { workers: tier.lease.grant }),
        fileEnded,
      },
    );
  } catch (error) {
    return {
      end: "crashed",
      durationMs: context.now() - started,
      completedFiles: [],
      results: [],
      fileErrors: [],
      failure: error instanceof Error ? error.message : String(error),
    };
  } finally {
    unleased?.();
  }
}

/** The ids of the tier's files `report` does not complete. */
export function unfinishedFiles(tier: Tier, report: RunReport): string[] {
  const completed = new Set(report.completedFiles.map(testFileId));
  return tier.files.map(({ file }) => file.id).filter((id) => !completed.has(id));
}

/** The tier is no longer in flight: recorded, or put back after an error. Once per tier. */
export function endTier(context: SchedulerContext, ledger: Ledger, tier: Tier): void {
  tier.lease?.release();
  if (ledger.tierChanges.delete(tier.changes)) context.keys.endRun();
}

/**
 * The tier's inputs whose content now differs from the snapshot, and those
 * touched since it (task 001-168). Outside the lock: it only reads. A
 * listing is no file; the revisions during the run cover it (`Tier.changes`),
 * and one editor scratch files moved is asked as the run is recorded
 * (`scratchUnstable`, row 011-117).
 */
export function unstableInputs(context: SchedulerContext, tier: Tier): Promise<Moved> {
  const inputs = new Set(tier.files.flatMap((f) => f.inputs));
  for (const path of inputs) if (listedDirectory(path) !== null) inputs.delete(path);
  return changedSince(tier.snapshot, inputs, context.hasher);
}

/**
 * Records a finished tier.
 *
 * - Crashed, or not completed before a timeout: nothing stored under a key,
 *   the file's checks become `unknown` (D12; files whose module ended before
 *   the cancel keep their results, review N6). A fast tier of several files
 *   that timed out queues its incomplete files again in tiers of half as
 *   many instead (`timeoutCap`, task 001-179); alone, a file is `unknown`.
 * - Completed and withheld by the runner (`RunReport.withheld`: bytes the
 *   run may have executed moved or were touched during it): discarded and
 *   re-queued as a content discard is, counted toward `MAX_DISCARDS`, at
 *   which it is `unknown` with the runner's reason (issue 10, task 011-06).
 *   No revision may follow a touch, so `unknown` before the limit would
 *   leave an edited file without a result until its key moved.
 * - Not completed in a tier a revision, an edit or a promotion cancelled
 *   (C4 step 5), a run that otherwise ended `completed`: queued again,
 *   uncounted (task 001-124), an edit's work, catch-up or promoted still
 *   when it was (tasks 011-22, 011-51).
 * - Any input changed on disk since selection, or in a revision during the
 *   run: discarded and re-queued (D5 stability check). Returns those paths so
 *   the caller reconciles them; the watcher may not have reported them yet.
 * - The install moved during the run (`requeue`, `InstallStamps`), or
 *   went and ends the daemon (task 001-113): the whole tier is re-queued
 *   uncounted and nothing is stored (task 001-107). A file the ledger no
 *   longer holds as it was selected records nothing either. A set of file
 *   ids re-queues only those files; the rest record the report as usual
 *   (task 007-34).
 * - Otherwise one `putMany` per file under the key it ran under. When that is
 *   still the file's key the results become current; else they wait in the
 *   store for a lookup, and the file is already queued for its new key.
 * - A file whose run read paths its closure lacks (`observed`, task 001-132):
 *   they join its closure and the shared observed set first, they join the
 *   stability check, and the results are stored under the key that includes
 *   them, never under the key it ran under, which lacks them (D5 as
 *   amended). When an edit moved its key during the run, nothing is stored.
 *   When one of those paths was first seen during the run (`firstSeen`),
 *   nothing from before the run proves it held still: nothing is stored, and
 *   the file re-runs under the key with it (review wave 12d, B1; task 001-134).
 * - A file whose run loaded environment files the key it ran under lacked
 *   (`observed.environment`, task 003-43) stores nothing: the environments
 *   were read again, and it runs again under the key that holds them
 *   (`rerunGrown`), at most `MAX_DISCARDS` times in a row.
 * - The report's notes become status notes (D7), after the transaction.
 *
 * `commit` false leaves the ledger's writes to the caller's next commit: the
 * records of slots that ended together share one (spec 011 C4 step 5 as
 * amended for slots, task 011-21 slice 2).
 *
 * `setups` false applies none of the report's setup outcomes: no setup check
 * fails or passes and no project is blocked, and a file the startup failure
 * kept from running that `requeue` does not hold is `unknown`, as a crashed
 * run's is. A report the runtime's loss rejects (row 011-106, review
 * 0.1.262 B2): its startup failure is the missing recorder's. A set of
 * projects passes none of their setups (`heldSetups`, review 0.1.266 B2): the
 * caller has already taken out a startup failure the merge hold rejects.
 */
export function recordTier(
  context: SchedulerContext,
  ledger: Ledger,
  tier: Tier,
  report: RunReport,
  changedOnDisk: ReadonlySet<RelativePath>,
  requeue: boolean | ReadonlySet<string> = false,
  observed: TierObservations = NOTHING_OBSERVED,
  commit = true,
  setups: boolean | ReadonlySet<ProjectName> = true,
): RelativePath[] {
  const { store, worktreeId } = context;
  endTier(context, ledger, tier);
  const end = tierEnd(tier, report, changedOnDisk, requeue, observed);

  const provenance: Provenance = {
    worktreeId,
    revision: tier.revision.number,
    commit: tier.revision.head,
    dirty: tier.revision.dirty,
    runId: tier.runId,
    recordedAt: context.now(),
  };
  const unknown: { file: FileState; key: CheckKey }[] = [];
  const rekeyed: TestFileRef[] = [];
  const grown: { ref: TestFileRef; checkpointId: string | null }[] = [];
  const firstSeen: { file: FileState; firstSeen: readonly RelativePath[] }[] = [];
  const grewEnvironment: FileState[] = [];
  const failedAnew: NewFailure[] = [];
  const notStarted: { file: FileState; forced: boolean }[] = [];
  const startup = report.startupFailure;
  const { environment } = observed;
  store.transaction(() => {
    store.runs.finish(tier.runId, report.end, context.now());
    for (const entry of tier.files) {
      const { file, key, checkpointId, forced, recent, catchUp } = entry;
      const decision = storeDecision(entry, end, ledger.files.get(file.id) === file);
      // A newer run has the file at another key (an edit's tier beside this backlog tier, task
      // 011-21): its state is that run's, and this run's outcome is superseded (review wave-4 B1).
      if (decision.kind === "superseded") {
        ledger.endRunningAt(file, key);
        continue;
      }
      ledger.setRunning(file, null);
      if (decision.kind === "gone") continue;
      if (decision.kind === "withheld") {
        ledger.discard(file, key, forced, [], report.failure ?? `run ${report.end}`, tier.runId);
        continue;
      }
      if (decision.kind === "requeue") {
        // What did not run keeps its class: an edit's work, catch-up (C4 step 4 as amended
        // 2026-10-20, task 011-22), or promoted, which `Promotions` holds while it is queued (011-51).
        // It stays forced only while what forced it holds (row 011-120).
        if (file.key !== null && file.blocked === null) {
          const priority = priorityOf(file, NOTHING_CHANGED);
          const again = ledger.staysForced(file, key, forced);
          ledger.enqueue(file, priority, again, recent === true, catchUp === true);
        }
        continue;
      }
      if (decision.kind === "not-started") {
        if (setups !== false)
          notStarted.push({ file, forced: ledger.staysForced(file, key, forced) });
        else unknown.push({ file, key });
      } else if (decision.kind === "unknown") unknown.push({ file, key });
      else if (decision.kind === "split") {
        requeueSplit(ledger, file, key, decision.cap, forced, recent === true);
      }
      if (
        decision.kind === "not-started" ||
        decision.kind === "unknown" ||
        decision.kind === "split"
      ) {
        continue;
      }
      const { growth } = decision;
      let storeKey: CheckKey | null = key;
      if (growth !== undefined) {
        rekeyed.push(...context.keys.addObserved(file.ref, growth.add).map((c) => c.testFile));
        grown.push({ ref: file.ref, checkpointId });
        storeKey = decision.kind === "store" ? context.keys.index.key(file.ref) : null;
      }
      if (decision.kind === "unstable") {
        ledger.discard(file, key, forced, decision.paths, undefined, tier.runId);
        continue;
      }
      if (decision.kind === "first-seen") {
        if (decision.rerun) firstSeen.push({ file, firstSeen: growth?.firstSeen ?? [] });
        continue;
      }
      if (decision.kind === "environment") {
        // Task 003-43: the key it ran under lacks what the run loaded; it runs again at the key with it.
        grewEnvironment.push(file);
        continue;
      }
      if (decision.kind === "no-key" || storeKey === null) continue;
      const previous = file.resultKey;
      const records = recordsForFile({
        ref: file.ref,
        key: storeKey,
        report,
        previousChecks: previous === null ? [] : store.results.checksForKey(previous),
        provenance,
        describe: context.describe,
      });
      // 011-64 R3 (row 011-77, gh-54): a failing row a pass replaces here is kept as history.
      const failing = store.failures.failingAt(storeKey);
      // Review 0.1.266, B1: a worktree whose merge hold names the stored key's inputs takes no heal.
      const inputs = [...entry.inputs, ...(growth?.growth ?? [])];
      const prior = storeResults(context, records, healsUnheld(store, inputs));
      recordFailedLoad(context, tier.runId, tier.loadPerCpu ?? null, records);
      store.failures.keepReplaced(failing, records, (run) => readRunLoads(store).get(run) ?? null);
      if (forced && file.rerunKey === key) endRerun(context, file);
      if (forced) endRetry(context, file, key, records, tier.runId);
      // A grown file's results become current at `storeKey` through `settle` below; its new
      // failure is judged here, before the sink applies them (review wave 13i, B3).
      if (growth !== undefined || file.key === key) {
        if (holdsNewFailure(context, prior, records)) {
          failedAnew.push({
            file,
            key: storeKey,
            forced,
            afterTestsPassed: failsAfterTestsPassed(records),
          });
        }
      }
      if (decision.current) ledger.applyResults(file, key, records, checkpointId);
    }
    // Task 003-43: the environments read again moved the keys of every file of their projects.
    // A file an edit re-keyed keeps that edit's revision (001-186), so a wait that holds for the
    // edit still holds for it after a later, unrelated revision (task 003-45); `status --wait`
    // holds for one no edit re-keyed from the latest revision on.
    if (environment !== undefined) {
      const unkeyed: TestFileRef[] = [];
      const edited: TestFileRef[] = [];
      for (const { testFile } of environment.changes) {
        (ledger.file(testFile)?.keyedAt === null ? unkeyed : edited).push(testFile);
      }
      ledger.settle(unkeyed, NOTHING_CHANGED, { keyedAt: ledger.revision.number });
      ledger.settle(edited, NOTHING_CHANGED);
      rerunGrown(ledger, environment, grewEnvironment);
    }
    // The grown files take their new key and, once stored, its results; a re-key reached others.
    for (const { ref, checkpointId } of grown) {
      ledger.settle([ref], NOTHING_CHANGED, { checkpointId });
    }
    ledger.settle(rekeyed, NOTHING_CHANGED);
    ledger.rerunFirstSeen(firstSeen, tier.runId);
    rememberReruns(context, queueReruns(context, ledger, failedAnew));
    storeClosures(
      context,
      grown.map((g) => g.ref),
    );
    // Task 001-382: one setup failure, not a FAIL per file; a run of a project that started passes
    // it, whatever its tests then did (review wave-13bp B4).
    if (setups !== false) {
      const started = new Set([
        ...(report.startedProjects ?? []),
        ...report.completedFiles.map((f) => f.project),
      ]);
      for (const project of startup?.projects ?? []) started.delete(project);
      // Review 0.1.266, B2: no outcome of a setup that may have read an unmerged path.
      if (setups !== true) for (const project of setups) started.delete(project);
      ledger.setups.pass(started, provenance.commit);
      if (startup !== undefined) failStartup(ledger, startup, notStarted, provenance.commit);
    }
    const timedOut =
      report.end === "timed-out" ? timedOutReason(context.policy.runner.timeoutMs) : null;
    const reason = timedOut ?? report.failure ?? `run ${report.end}`;
    for (const { file, key } of unknown) endRetry(context, file, key, null, tier.runId);
    for (const { file } of notStarted)
      if (file.key !== null) endRetry(context, file, file.key, null, tier.runId);
    // Row 011-108 (gh-74): the run is recorded beside the states, never as a keyed result.
    ledger.markUnknown(unknown, reason, {
      runId: tier.runId,
      ...(timedOut === null ? {} : { cause: "timeout" }),
    });
    if (commit) ledger.commit();
  });
  return [...new Set([...changedOnDisk, ...observed.changed])];
}
