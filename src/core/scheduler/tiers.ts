import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { StatCache } from "../hash/index.js";
import { listedDirectory, testFileId } from "../keys/index.js";
import type { CheckKey, Provenance, RelativePath, RunReport, TestFileRef } from "../types/index.js";
import { SLOW_LANE_PREFIX } from "../types/index.js";
import { backlogBudget } from "./backlog.js";
import { NOTHING_CHANGED, type SchedulerContext } from "./context.js";
import { rerunGrown } from "./environment-growth.js";
import type { FileState } from "./files.js";
import type { Ledger, RevisionState } from "./ledger.js";
import { NOTHING_OBSERVED, type TierObservations } from "./observed.js";
import { priorityOf } from "./queue.js";
import { recordsForFile } from "./records.js";
import {
  endRerun,
  holdsNewFailure,
  type NewFailure,
  queueReruns,
  rememberReruns,
} from "./rerun.js";
import { storeClosures } from "./revision.js";
import { joinSpan, type TierSpan } from "./sharing.js";
import { slowView } from "./slow.js";
import { changedSince, type Moved, snapshotInputs } from "./stability.js";
import { storeResults } from "./store-results.js";
import { requeueSplit, timedOutReason, timeoutCap } from "./timeout-split.js";

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
  /** A backlog tier, which an edit cancels (`Scheduler.handleBatch`); `null` for an edit's tier. */
  readonly cancel: AbortController | null;
}

/**
 * The lane of `ref` (`RunnerAdapter.lane`): one tier at a time per lane, so
 * tiers of different lanes run at once (D5 as amended, task 001-140). A
 * runner that names none has one lane. A slow file's lane is its runner's
 * behind `SLOW_LANE_PREFIX`, a runner instance of its own, so fast tiers run
 * beside it (spec 004 D2, task 004-18).
 */
export function laneOf(context: SchedulerContext, ref: TestFileRef): string {
  const lane = context.runner.lane?.(ref) ?? "";
  return slowView(context.policy).isSlow(ref) ? SLOW_LANE_PREFIX + lane : lane;
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
 * While no queued file is recent, the tier is the backlog's: up to
 * `runner.backlogTierSize` files and `backlogBudget` of last-known file time,
 * cancelled by the next edit (D5 step 5 as amended, task 001-124; lessons,
 * defect 25: 559 tiers of 4 took 4.6 h where one `npm test` took 514 s). The
 * budget bounds the selection, not the run: unknown durations count 0 and
 * the first file is always taken.
 *
 * A tier holds the files of one lane, the lane of the first file it takes;
 * files of a lane in `busy`, which has a tier in flight, stay queued and
 * are not looked up (task 001-140). Whether the tier is the backlog's is
 * decided on the free lanes' files.
 *
 * Any other tier takes a file only beside files of a comparable last-known
 * time (`joinSpan`, task 001-184): a tier stores its results when it ends,
 * so a file far slower than one already taken waits for the next tier
 * instead of holding the faster file's result (lessons, defect 31).
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
 */
export function selectTier(
  context: SchedulerContext,
  ledger: Ledger,
  busy: ReadonlySet<string> = new Set(),
): Tier | null {
  const { keys, policy } = context;
  const picked: TierFile[] = [];
  ledger.claims.begin();
  const backlog = !ledger.queue.hasRecent((ref) => !busy.has(laneOf(context, ref)));
  let size = backlog ? ledger.claims.backlogSize(ledger.queue.fastSize) : policy.runner.tierSize;
  const budget = backlog ? backlogBudget(policy.runner.timeoutMs) : Number.POSITIVE_INFINITY;
  let known = 0;
  let span: TierSpan | null = null;
  let tookBacklog = false;
  let lane: string | null = null;
  for (const ref of ledger.ordered()) {
    if (picked.length >= size) break;
    const at = laneOf(context, ref);
    if (busy.has(at) || (lane !== null && at !== lane)) continue;
    const file = ledger.file(ref);
    const key = file?.key ?? null;
    if (!file || key === null || file.blocked !== null) {
      ledger.queue.remove(ref);
      if (file) ledger.touch(file);
      continue;
    }
    const forced = ledger.queue.isForced(ref);
    const recent = ledger.queue.isRecent(ref);
    let waits = false;
    if (!forced) {
      const { hits, mayWait } = ledger.probe(file, key);
      if (hits.length > 0) {
        ledger.applyResults(file, key, hits, ledger.checkpoints.idFor(ref));
        continue;
      }
      waits = mayWait && !recent;
      if (waits && ledger.claims.holds(key)) continue;
    }
    const cap = Math.min(size, file.tierCap ?? size);
    if (picked.length >= cap) continue;
    if (!backlog) {
      const joined = joinSpan(span, file.durationMs);
      if (joined === null) continue;
      span = joined;
    }
    known += file.durationMs ?? 0;
    if (picked.length > 0 && known > budget) break;
    tookBacklog ||= !recent;
    lane = at;
    size = cap;
    const checkpointId = ledger.checkpoints.idFor(ref);
    const inputs = keys.stabilityPaths(ref);
    picked.push({ file, key, inputs, checkpointId, forced, recent, waits });
  }
  const tier = picked.length === 0 ? null : startTier(context, ledger, picked, backlog);
  if (tier !== null) {
    ledger.queue.tierSelected(tookBacklog);
    return tier;
  }
  ledger.commit();
  // A result recorded since the lookup settled a pick in the start: the queue moved (review wave 13o, B1).
  const settled = picked.some((p) => !ledger.queue.has(p.file.ref));
  return settled ? selectTier(context, ledger, busy) : null;
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
 * settled or stayed queued; what settled is committed. `cancellable` for a
 * backlog tier, which an edit cancels; never for an edit's or a slow tier.
 */
export function startTier(
  context: SchedulerContext,
  ledger: Ledger,
  picked: readonly TierFile[],
  cancellable: boolean,
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
      cancel: cancellable ? new AbortController() : null,
    };
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
 * In `startTier`'s transaction: `[p]` when it starts, with whether it still
 * waits; `[]` when a result now stands for it (applied) or another
 * worktree's claim holds its key. A forced file always starts; a file only
 * waits when it did at selection and nothing is withheld now.
 */
function startable(ledger: Ledger, p: TierFile): TierFile[] {
  if (p.forced) return [p];
  const { hits, mayWait } = ledger.probe(p.file, p.key);
  if (hits.length > 0) {
    ledger.applyResults(p.file, p.key, hits, p.checkpointId);
    return [];
  }
  const waits = p.waits === true && mayWait;
  if (waits && ledger.claims.holds(p.key)) return [];
  return [{ ...p, waits }];
}

/** Runs a tier. Never rejects: a runner that throws is a crash (D12). */
export async function executeTier(context: SchedulerContext, tier: Tier): Promise<RunReport> {
  const started = context.now();
  try {
    return await context.runner.run(
      tier.files.map((f) => f.file.ref),
      {
        runId: tier.runId,
        logDir: tier.logDir,
        timeoutMs: context.policy.runner.timeoutMs,
        ...(tier.cancel === null ? {} : { signal: tier.cancel.signal }),
        lane: tier.lane,
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
  }
}

/** The tier is no longer in flight: recorded, or put back after an error. Once per tier. */
export function endTier(context: SchedulerContext, ledger: Ledger, tier: Tier): void {
  if (ledger.tierChanges.delete(tier.changes)) context.keys.endRun();
}

/**
 * The tier's inputs whose content now differs from the snapshot, and those
 * touched since it (task 001-168). Outside the lock: it only reads. A
 * listing is no file; the revisions during the run cover it (`Tier.changes`).
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
 * - Not completed in a backlog tier an edit cancelled, a run that otherwise
 *   ended `completed`: queued again, uncounted (task 001-124).
 * - Any input changed on disk since selection, or in a revision during the
 *   run: discarded and re-queued (D5 stability check). Returns those paths so
 *   the caller reconciles them; the watcher may not have reported them yet.
 * - The install moved during the run (`installMoved`, `InstallStamps`), or
 *   went and ends the daemon (task 001-113): the whole tier is re-queued
 *   uncounted and nothing is stored (task 001-107). A file the ledger no
 *   longer holds as it was selected records nothing either.
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
 */
export function recordTier(
  context: SchedulerContext,
  ledger: Ledger,
  tier: Tier,
  report: RunReport,
  changedOnDisk: ReadonlySet<RelativePath>,
  installMoved = false,
  observed: TierObservations = NOTHING_OBSERVED,
): RelativePath[] {
  const { store, worktreeId } = context;
  const duringRun = tier.changes;
  endTier(context, ledger, tier);
  const completed = new Set(report.completedFiles.map(testFileId));
  const cancelled = tier.cancel?.signal.aborted === true && report.end === "completed";
  const files = tier.files.map((f) => f.file);
  const splitCap = timeoutCap(report, tier.lane, files, completed);

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
  const firstSeen: FileState[] = [];
  const grewEnvironment: FileState[] = [];
  const failedAnew: NewFailure[] = [];
  const { environment } = observed;
  const unstable = (path: RelativePath) =>
    changedOnDisk.has(path) || duringRun.has(path) || observed.changed.has(path);
  store.transaction(() => {
    store.runs.finish(tier.runId, report.end, context.now());
    for (const { file, key, inputs, checkpointId, forced, recent } of tier.files) {
      ledger.setRunning(file, null);
      if (ledger.files.get(file.id) !== file) continue;
      if (installMoved || (cancelled && !completed.has(file.id))) {
        if (file.key !== null && file.blocked === null) {
          ledger.enqueue(file, priorityOf(file, NOTHING_CHANGED), forced);
        }
        continue;
      }
      if (!completed.has(file.id)) {
        if (splitCap === null) unknown.push({ file, key });
        else requeueSplit(ledger, file, splitCap, forced, recent === true);
        continue;
      }
      const growth = observed.growth.get(file.id);
      let storeKey: CheckKey | null = key;
      if (growth !== undefined) {
        const ranUnderCurrent = file.key === key;
        rekeyed.push(...context.keys.addObserved(file.ref, growth.add).map((c) => c.testFile));
        grown.push({ ref: file.ref, checkpointId });
        storeKey = ranUnderCurrent ? context.keys.index.key(file.ref) : null;
      }
      if (inputs.some(unstable) || growth?.growth.some(unstable)) {
        ledger.discard(file, key, forced);
        continue;
      }
      if (growth !== undefined && growth.firstSeen.length > 0) {
        if (file.key === key) firstSeen.push(file);
        continue;
      }
      if (environment?.files.has(file.id)) {
        // Task 003-43: the key it ran under lacks what the run loaded; it runs again at the key with it.
        grewEnvironment.push(file);
        continue;
      }
      if (storeKey === null) continue;
      const previous = file.resultKey;
      const records = recordsForFile({
        ref: file.ref,
        key: storeKey,
        report,
        previousChecks: previous === null ? [] : store.results.checksForKey(previous),
        provenance,
        describe: context.describe,
      });
      const prior = storeResults(context, records);
      if (forced && file.rerunKey === key) endRerun(context, file);
      // A grown file's results become current at `storeKey` through `settle` below; its new
      // failure is judged here, before the sink applies them (review wave 13i, B3).
      if (growth !== undefined || file.key === key) {
        if (holdsNewFailure(context, prior, records)) {
          failedAnew.push({ file, key: storeKey, forced });
        }
      }
      if (growth === undefined && file.key === key) {
        ledger.applyResults(file, key, records, checkpointId);
      }
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
    ledger.rerunFirstSeen(firstSeen);
    rememberReruns(context, queueReruns(context, ledger, failedAnew));
    storeClosures(
      context,
      grown.map((g) => g.ref),
    );
    const timedOut =
      report.end === "timed-out" ? timedOutReason(context.policy.runner.timeoutMs) : null;
    const reason = timedOut ?? report.failure ?? `run ${report.end}`;
    ledger.markUnknown(unknown, reason);
    ledger.commit();
  });
  return [...new Set([...changedOnDisk, ...observed.changed])];
}
