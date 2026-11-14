import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { PoolLease } from "../capacity/pool.js";
import type { StatCache } from "../hash/stat-cache.js";
import { testFileId } from "../keys/reverse-index.js";
import { copyInputs, runEnd } from "../run-evidence/run-evidence.js";
import type { CheckPriority } from "../types/check-groups.js";
import type { EpochMs, ProjectName, RelativePath } from "../types/common.js";
import type { CheckKey, TestFileRef } from "../types/keys.js";
import { BESIDE_LANE_PREFIX, type FocusedFile, type RunReport } from "../types/runner.js";
import type { SchedulerContext } from "./context.js";
import type { FileState } from "./files.js";
import type { Ledger, RevisionState } from "./ledger.js";
import { TierPermits } from "./local-permits.js";
import { NOTHING_OBSERVED, type TierObservations } from "./observed.js";
import { endRecord, recordFile, tierRecord } from "./record-tier.js";
import { tierLoad } from "./retries.js";
import { type CutFiles, NONE_CUT } from "./sharing.js";
import { backlogSlot } from "./slots.js";
import { groupView, laneFor } from "./slow.js";
import { liveAsks, liveView } from "./tier-live.js";
import { planTiers } from "./tier-plan.js";
import { startNext } from "./tier-start.js";
import { fewest } from "./tier-width.js";

/** One test file of a tier and the key it runs under. */
export interface TierFile {
  readonly file: FileState;
  readonly key: CheckKey;
  /** Closure, environment files and lockfile: what must hold still during the run. */
  readonly inputs: readonly RelativePath[];
  /** Applied runtime contract at selection. Record-time growth cannot replace it. */
  readonly runtimePolicy: string;
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
  /**
   * A focused tier's texts per file (`RunOptions.checks`, spec 011 C4 as
   * amended 2026-10-23, row 011-145), in the order of `files`; it stores
   * nothing under a key (`recordFocusedTier`). Absent: its files run whole.
   */
  readonly focus?: readonly FocusedFile[];
  /**
   * A batch's tier (`batchFiles`, spec 011 C4 step 5 and C15 as amended
   * 2026-10-29, rows 011-265 and 011-268), a backlog tier of one batch's
   * files: while a file of it that has not ended is in its batch, only a
   * revision that supersedes it cancels it, and an edit's work does not.
   */
  readonly promoted?: boolean;
  /**
   * A tier beside a batch's tier (`besideFiles`, spec 011 C4 step 5 as
   * amended 2026-10-29, row 011-269): an edit's tier of its lane that runs
   * in the lane's second instance (`BESIDE_LANE_PREFIX`).
   */
  readonly beside?: boolean;
  /**
   * The priority of the group whose lane it runs in (spec 019 D3; the
   * default `slow` group's `"low"`, `tests`' `"normal"`): `executeTier`
   * passes it as `RunOptions.priority` (row 019-12).
   */
  readonly priority?: CheckPriority;
}

/**
 * What a tier is, for C4 step 5 as amended 2026-10-21 (row 011-51):
 * `backlog`, selected while no work of the first group was queued, or a
 * backlog slot (the turn's included), which an edit's work cancels, or a
 * batch's tier (`Tier.promoted`, rows 011-265 and 011-268), which only a
 * revision that supersedes it cancels while a file of it that has not
 * ended is in its batch; `turn`,
 * the backlog's turn after four tiers of the first group, which only a
 * revision that supersedes it cancels; `edit`, any other fast tier, which
 * yields too; `slow`, a slow tier (spec 004 D2), which nothing cancels;
 * `focused`, a named wait's focused checks (row 011-145), which yields to
 * nothing and stores nothing under a key.
 */
export type TierKind = "backlog" | "turn" | "edit" | "slow" | "focused";

/**
 * The lane of `ref` (`RunnerAdapter.lane`): one tier at a time per lane, so
 * tiers of different lanes run at once (D5 as amended, task 001-140). A
 * runner that names none has one lane. A slow file's lane is its runner's
 * behind `SLOW_LANE_PREFIX`, a runner instance of its own, so fast tiers run
 * beside it (spec 004 D2, task 004-18).
 */
export function laneOf(context: SchedulerContext, ref: TestFileRef): string {
  return laneFor(context.policy, ref, context.runner.traits.lane(ref));
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
 * A named wait's batch (C15) leads its lane, an edit's work queued or not:
 * its tier holds one batch's files, longest first, as the backlog's at the
 * grant, with no wall budget but the run's deadline (`batchFiles`, C4 step
 * 5 as amended 2026-10-29, row 011-268). It never starts later or narrower
 * than an edit's tier would (C10 Capacity and C15 as amended 2026-11-07,
 * row 011-308): when the pool refuses it, or grants fewer workers than an
 * edit's tier of its first `runner.tierSize` files runs with, the grant goes
 * back and it is picked again as an edit's (`asEdit`): at most
 * `runner.tierSize` of its files, longest first, with no grant, stated to
 * the pool while it runs as an edit's tier is (`executeTier`). It is still a
 * batch's tier, and the rest of the batch leads the lane's next selection.
 * The backlog's turn and a wait for
 * quiet do not hold it and it does not count toward the turn. After it,
 * while a file of the second group is queued, the backlog's turn is due
 * (`batchTurnDue`), edits queued or not: selected with `rest`, a turn's tier
 * of the second group's files only (review `reviews/0.1.378.md` B1); when
 * none can start, the selection goes on as before. When no promoted file can start,
 * each waiting on another worktree's claim of its key, the queue's other
 * files start as before (`wide`). With `beside`, it selects an edit's tier
 * of those files only, in a lane a batch's tier holds (row 011-269): it
 * runs in the lane's second instance and counts toward no turn.
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
 * and the turn below start as before. A lane whose catch-up of an edit waits
 * for quiet (as amended 2026-10-23, row 011-153) starts no tier of catch-up,
 * the turn's included; an edit's tier still takes catch-up files beside its
 * own, as it takes the backlog's, and the rest of the queue starts as before.
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
  const view = liveView(context, ledger, { busy: () => busy, cut, turnDue: () => turnDue });
  const next = startNext(context, ledger, planTiers(view, liveAsks(context, ledger)));
  return "tier" in next ? next.tier : null;
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
 * rules of C4 step 5 may cancel it (`TierKind`, `newTier`). `lease` is a
 * backlog tier's grant, kept for as many files as start. `marks` sets
 * `Tier.promoted` and `Tier.beside`.
 */
export function startTier(
  context: SchedulerContext,
  ledger: Ledger,
  picked: readonly TierFile[],
  kind: TierKind,
  lease?: PoolLease,
  { promoted = false, beside = false }: { promoted?: boolean; beside?: boolean } = {},
): Tier | null {
  const { store } = context;
  return store.transaction(() => {
    const files = picked.flatMap((p) => startable(ledger, p));
    const first = files[0];
    if (first === undefined) {
      ledger.commit();
      return null;
    }
    const slot = kind === "backlog" && backlogSlot(context, first.file.ref) !== null;
    const tier: Tier = {
      ...newTier(context, ledger, first, files, kind),
      ...(lease === undefined ? {} : { lease }),
      ...(slot ? { slot: true } : {}),
      ...(promoted ? { promoted: true } : {}),
      ...(beside ? { beside: true } : {}),
    };
    lease?.shrinkTo(files.length);
    for (const { file, key } of files) {
      ledger.queue.remove(file.ref);
      ledger.claims.taken(key);
      ledger.setRunning(file, key);
    }
    store.runs.start({
      id: tier.runId,
      worktreeId: context.worktreeId,
      revision: tier.revision.number,
      testFiles: files.map((p) => p.file.ref),
      checkpointId: tier.checkpointId,
      logDir: tier.logDir,
      startedAt: context.now(),
    });
    ledger.commit();
    return tier;
  });
}

/**
 * A new tier of `files`, `first` among them, of `kind`, with its run id, its
 * log folder and its stability snapshot, its changes in
 * `Ledger.tierChanges`: the fields every tier has. `first` names the lane
 * and whether the runner cancels: a backlog tier gets its cancel, and any
 * other but a slow one when its runner cancels (`cancels`). The caller adds
 * its own fields (`lease`, `slot`, `focus`).
 */
export function newTier(
  context: SchedulerContext,
  ledger: Ledger,
  first: TierFile,
  files: readonly TierFile[],
  kind: TierKind,
): Tier & { readonly startedAt: EpochMs } {
  const { keys } = context;
  const runId = randomUUID();
  const cancellable = kind === "backlog" || (kind !== "slow" && cancels(context, first.file.ref));
  const tier: Tier & { readonly startedAt: EpochMs } = {
    runId,
    logDir: join(context.runsDir, runId),
    lane: laneOf(context, first.file.ref),
    priority: groupView(context.policy).of(first.file.ref).limits.priority,
    run: keys.beginRun(),
    changes: new Set(),
    revision: ledger.revision,
    checkpointId: files.find((p) => p.checkpointId !== null)?.checkpointId ?? null,
    files,
    snapshot: copyInputs(
      keys.cache,
      files.flatMap((p) => p.inputs),
    ),
    kind,
    startedAt: context.now(),
    ended: new Set(),
    cancel: cancellable ? new AbortController() : null,
    loadPerCpu: tierLoad(context),
  };
  ledger.tierChanges.add(tier.changes);
  return tier;
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
  const permits = tierPermits(context, tier);
  const fileEnded = (ref: TestFileRef) => {
    tier.ended?.add(testFileId(ref));
    const left = tier.files.filter(({ file }) => tier.ended?.has(file.id) !== true).length;
    if (left > 0) (permits === null ? tier.lease : permits.lease)?.shrinkTo(left);
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
        // Row 011-269: a tier beside a batch's runs in its lane's second instance.
        lane: tier.beside === true ? `${BESIDE_LANE_PREFIX}${tier.lane}` : tier.lane,
        // Spec 019 D3 (rows 019-10, 019-12): the group's priority sets the run's I/O class.
        ...(tier.priority === undefined ? {} : { priority: tier.priority }),
        ...(observeIgnored ? { observeIgnored } : {}),
        ...(tier.lease === undefined ? {} : { workers: tier.lease.grant }),
        // Spec 021 D12 (row 021-14): only a backlog tier or turn may go remote; a batch is waited for.
        ...(background(tier) ? { background: true as const } : {}),
        ...(permits === null ? {} : { permits }),
        ...(tier.focus === undefined ? {} : { checks: tier.focus }),
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
    permits?.release();
  }
}

/** Spec 021 D18 (row 021-21): a leased background tier's permits, which a run sent away gives back. */
function tierPermits(context: SchedulerContext, tier: Tier): TierPermits | null {
  if (tier.lease === undefined || !background(tier) || context.capacity === undefined) return null;
  return new TierPermits(context.capacity, tier.lease, fewest(context.runner.traits, tier.files));
}

/** A backlog tier or the backlog's turn, not a named wait's batch (`RunOptions.background`). */
function background(tier: Tier): boolean {
  return (tier.kind === "backlog" || tier.kind === "turn") && tier.promoted !== true;
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
  const { store } = context;
  endTier(context, ledger, tier);
  const end = runEnd(tier, report, changedOnDisk, requeue, observed, (ref) =>
    context.keys.runtimeIdentity(ref),
  );
  const record = tierRecord(context, ledger, tier, report, end, setups);
  // C15 Lifetime (rows 011-193, 011-196): the record ends a file's run before it queues the file
  // again (a cut, a split, a discard, a startup failure, the re-run of a grown environment, a
  // first-seen path or a first failure), so the promotions settle once, at its end.
  ledger.queue.settlingOnce(() =>
    store.transaction(() => {
      store.runs.finish(tier.runId, report.end, context.now());
      for (const entry of tier.files) recordFile(record, entry);
      endRecord(record, observed.environment);
      if (commit) ledger.commit();
    }),
  );
  return [...new Set([...changedOnDisk, ...observed.changed])];
}
