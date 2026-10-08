import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { StatCache } from "../hash/index.js";
import { testFileId } from "../keys/index.js";
import type {
  CheckKey,
  CheckpointRecord,
  Provenance,
  RelativePath,
  RunReport,
} from "../types/index.js";
import { backlogBudget } from "./backlog.js";
import { NOTHING_CHANGED, type SchedulerContext } from "./context.js";
import { classify, type FileState } from "./files.js";
import type { Ledger, RevisionState } from "./ledger.js";
import { priorityOf } from "./queue.js";
import { recordsForFile } from "./records.js";
import { changedSince, snapshotInputs } from "./stability.js";

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
}

export interface Tier {
  readonly runId: string;
  readonly logDir: string;
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
 * Picks the next tier from the queue as the latest revision ordered it.
 *
 * Spec 001 D5: "runs them in tiers of a configurable size (default 4 test
 * files). Between tiers it re-plans against the latest revision." Each key is
 * looked up once more just before it would run, because another worktree may
 * have stored it meanwhile; forced entries skip the lookup. Returns `null`
 * when nothing is left to run.
 *
 * While no queued file is recent, the tier is the backlog's: up to
 * `runner.backlogTierSize` files and `backlogBudget` of last known file time,
 * cancelled by the next edit (D5 step 5 as amended, task 001-124; lessons,
 * defect 25: 559 tiers of 4 took 4.6 h where one `npm test` took 514 s).
 */
export function selectTier(context: SchedulerContext, ledger: Ledger): Tier | null {
  const { store, keys, policy } = context;
  const picked: TierFile[] = [];
  const backlog = !ledger.queue.hasRecent();
  const size = backlog ? policy.runner.backlogTierSize : policy.runner.tierSize;
  const budget = backlog ? backlogBudget(policy.runner.timeoutMs) : Number.POSITIVE_INFINITY;
  let known = 0;
  let tookBacklog = false;
  for (const ref of ledger.ordered()) {
    if (picked.length >= size) break;
    const file = ledger.file(ref);
    const key = file?.key ?? null;
    if (!file || key === null || file.blocked !== null) {
      ledger.queue.remove(ref);
      if (file) ledger.touch(file);
      continue;
    }
    const forced = ledger.queue.isForced(ref);
    if (!forced) {
      const hits = store.results.byKey(key, context.now());
      if (hits.length > 0) {
        ledger.applyResults(file, key, hits, ledger.checkpoints.idFor(ref));
        continue;
      }
    }
    known += file.durationMs ?? 0;
    if (picked.length > 0 && known > budget) break;
    tookBacklog ||= !ledger.queue.isRecent(ref);
    ledger.queue.remove(ref);
    const checkpointId = ledger.checkpoints.idFor(ref);
    picked.push({ file, key, inputs: keys.stabilityPaths(ref), checkpointId, forced });
  }
  if (picked.length === 0) {
    ledger.commit();
    return null;
  }
  ledger.queue.tierSelected(tookBacklog);

  const checkpointId = picked.find((p) => p.checkpointId !== null)?.checkpointId ?? null;
  const runId = randomUUID();
  const tier: Tier = {
    runId,
    logDir: join(context.runsDir, runId),
    revision: ledger.revision,
    checkpointId,
    files: picked,
    snapshot: snapshotInputs(
      keys.cache,
      picked.flatMap((p) => p.inputs),
    ),
    cancel: backlog ? new AbortController() : null,
  };
  for (const { file, key } of picked) ledger.setRunning(file, key);
  ledger.tierChanges = new Set();
  store.transaction(() => {
    store.runs.start({
      id: runId,
      worktreeId: context.worktreeId,
      revision: tier.revision.number,
      testFiles: picked.map((p) => p.file.ref),
      checkpointId,
      logDir: tier.logDir,
      startedAt: context.now(),
    });
    ledger.commit();
  });
  return tier;
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

/** The tier's inputs whose content now differs from the snapshot. Outside the lock: it only reads. */
export function unstableInputs(context: SchedulerContext, tier: Tier): Promise<Set<RelativePath>> {
  const inputs = new Set(tier.files.flatMap((f) => f.inputs));
  return changedSince(tier.snapshot, inputs, context.hasher);
}

/**
 * Records a finished tier.
 *
 * - Crashed, or not completed before a timeout: nothing stored under a key,
 *   the file's checks become `unknown` (D12; files whose module ended before
 *   the cancel keep their results, review N6).
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
 * - The report's notes become status notes (D7), after the transaction.
 */
export function recordTier(
  context: SchedulerContext,
  ledger: Ledger,
  tier: Tier,
  report: RunReport,
  changedOnDisk: ReadonlySet<RelativePath>,
  installMoved = false,
): RelativePath[] {
  const { store, worktreeId } = context;
  const duringRun = ledger.tierChanges ?? new Set<RelativePath>();
  ledger.tierChanges = null;
  const completed = new Set(report.completedFiles.map(testFileId));
  const cancelled = tier.cancel?.signal.aborted === true && report.end === "completed";

  const provenance: Provenance = {
    worktreeId,
    revision: tier.revision.number,
    commit: tier.revision.head,
    dirty: tier.revision.dirty,
    runId: tier.runId,
    recordedAt: context.now(),
  };
  const unknown: { file: FileState; key: CheckKey }[] = [];
  store.transaction(() => {
    store.runs.finish(tier.runId, report.end, context.now());
    for (const { file, key, inputs, checkpointId, forced } of tier.files) {
      ledger.setRunning(file, null);
      if (ledger.files.get(file.id) !== file) continue;
      if (installMoved || (cancelled && !completed.has(file.id))) {
        if (file.key !== null && file.blocked === null) {
          ledger.enqueue(file, priorityOf(file, NOTHING_CHANGED), forced);
        }
        continue;
      }
      if (!completed.has(file.id)) {
        unknown.push({ file, key });
        continue;
      }
      if (inputs.some((path) => changedOnDisk.has(path) || duringRun.has(path))) {
        ledger.discard(file, key);
        continue;
      }
      const previous = file.resultKey;
      const records = recordsForFile({
        ref: file.ref,
        key,
        report,
        previousChecks: previous === null ? [] : store.results.checksForKey(previous),
        provenance,
        describe: context.describe,
      });
      if (records.length > 0) store.results.putMany(records);
      if (file.key === key) ledger.applyResults(file, key, records, checkpointId);
    }
    const reason = report.failure ?? `run ${report.end}`;
    ledger.markUnknown(unknown, reason);
    ledger.commit();
  });
  return [...changedOnDisk];
}

/**
 * Spec 001 D5: "`squeal run --all` queues every test file whose key has no
 * result, or every test file when `--force` is given." One checkpoint of kind
 * `run-all` over those files (D7). Files already queued or running belong to
 * it too; a file that crashed at its key is queued again. "An unkeyed or
 * `unknown` file is always work to do": an unkeyed file, or one blocked by a
 * runner failure, is requested too and ends the checkpoint `abandoned`.
 */
/**
 * `run --all` while the worktree waits for an install: nothing can be listed
 * or keyed, so the checkpoint over the files an earlier daemon listed is
 * abandoned at once and never claims a full suite (review wave 11, B1).
 */
export function abandonFullSuite(ledger: Ledger): CheckpointRecord {
  const files = [...ledger.files.values()].map((file) => file.ref);
  const record = ledger.checkpoints.abandon(randomUUID(), "run-all", ledger.revision.number, files);
  ledger.commit();
  return record;
}

export function queueFullSuite(ledger: Ledger, force: boolean): CheckpointRecord {
  const id = randomUUID();
  const files = [...ledger.files.values()];
  const unrunnable = files.filter((file) => file.key === null || file.blocked !== null);
  const runnable = files.filter((file) => file.key !== null && file.blocked === null);
  let requested: FileState[];
  if (force) {
    requested = runnable;
    for (const file of runnable) ledger.enqueue(file, priorityOf(file, NOTHING_CHANGED), true);
  } else {
    const open = runnable.filter((file) => classify(file) !== "current");
    for (const file of open) file.unknownKey = null;
    const pending = open.filter((file) => file.phase !== null);
    const misses = ledger.settle(
      open.filter((file) => file.phase === null).map((file) => file.ref),
      NOTHING_CHANGED,
      { checkpointId: id },
    );
    requested = [...pending, ...misses];
  }
  const record = ledger.checkpoints.start(
    id,
    "run-all",
    ledger.revision.number,
    [...requested, ...unrunnable].map((file) => file.ref),
    force,
  );
  for (const file of unrunnable) ledger.checkpoints.failed(file.ref);
  ledger.commit();
  return record;
}
