import { readRunLoads } from "../retry/index.js";
import type {
  CheckKey,
  ProjectName,
  Provenance,
  RelativePath,
  RunReport,
  TestFileRef,
} from "../types/index.js";
import { NOTHING_CHANGED, type SchedulerContext } from "./context.js";
import { type EnvironmentGrowth, rerunGrown } from "./environment-growth.js";
import type { FileState } from "./files.js";
import { healsUnheld } from "./hold.js";
import type { Ledger } from "./ledger.js";
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
import { endRetry, recordFailedLoad } from "./retries.js";
import { storeClosures } from "./revision.js";
import { failStartup } from "./setup.js";
import { type StoreDecision, storeDecision, type TierEnd } from "./store-decision.js";
import { storeResults } from "./store-results.js";
import type { Tier, TierFile } from "./tiers.js";
import { requeueSplit, timedOutReason } from "./timeout-split.js";

/** A file the run did not complete: not started, crashed or timed out, or split (D12, task 001-179). */
type Incomplete = Extract<StoreDecision, { kind: "not-started" | "unknown" | "split" }>;

/** A completed file, once its observed growth joined its closure. */
type Completed = Extract<
  StoreDecision,
  { kind: "unstable" | "first-seen" | "environment" | "no-key" | "store" }
>;

/**
 * One record of a finished tier (`recordTier`): what it records under, and
 * the lists its walk over the tier's files fills for the steps after it.
 */
export interface TierRecord {
  readonly context: SchedulerContext;
  readonly ledger: Ledger;
  readonly tier: Tier;
  readonly report: RunReport;
  readonly end: TierEnd;
  readonly provenance: Provenance;
  readonly setups: boolean | ReadonlySet<ProjectName>;
  readonly unknown: { file: FileState; key: CheckKey }[];
  readonly rekeyed: TestFileRef[];
  readonly grown: { ref: TestFileRef; checkpointId: string | null }[];
  readonly firstSeen: { file: FileState; firstSeen: readonly RelativePath[] }[];
  readonly grewEnvironment: FileState[];
  readonly failedAnew: NewFailure[];
  readonly notStarted: { file: FileState; forced: boolean }[];
}

/** A record of `tier` with nothing walked yet, its provenance as of now. */
export function tierRecord(
  context: SchedulerContext,
  ledger: Ledger,
  tier: Tier,
  report: RunReport,
  end: TierEnd,
  setups: boolean | ReadonlySet<ProjectName>,
): TierRecord {
  const provenance: Provenance = {
    worktreeId: context.worktreeId,
    revision: tier.revision.number,
    commit: tier.revision.head,
    dirty: tier.revision.dirty,
    runId: tier.runId,
    recordedAt: context.now(),
  };
  return {
    context,
    ledger,
    tier,
    report,
    end,
    provenance,
    setups,
    unknown: [],
    rekeyed: [],
    grown: [],
    firstSeen: [],
    grewEnvironment: [],
    failedAnew: [],
    notStarted: [],
  };
}

/** Records one file of the tier as `storeDecision` decides, in the tier's file order. */
export function recordFile(record: TierRecord, entry: TierFile): void {
  const { ledger, report, tier } = record;
  const { file, key, forced } = entry;
  const decision = storeDecision(entry, record.end, ledger.files.get(file.id) === file);
  // A newer run has the file at another key (an edit's tier beside this backlog tier, task
  // 011-21): its state is that run's, and this run's outcome is superseded (review wave-4 B1).
  if (decision.kind === "superseded") {
    ledger.endRunningAt(file, key);
    return;
  }
  ledger.setRunning(file, null);
  if (decision.kind === "gone") return;
  if (decision.kind === "withheld") {
    ledger.discard(file, key, forced, [], report.failure ?? `run ${report.end}`, tier.runId);
  } else if (decision.kind === "requeue") requeueFile(ledger, entry);
  else if (
    decision.kind === "not-started" ||
    decision.kind === "unknown" ||
    decision.kind === "split"
  ) {
    recordIncomplete(record, entry, decision);
  } else recordCompleted(record, entry, decision);
}

/**
 * What did not run keeps its class: an edit's work, catch-up (C4 step 4 as amended 2026-10-20,
 * task 011-22), or promoted, which `Promotions` holds while it is queued (011-51). It stays
 * forced only while what forced it holds (row 011-120).
 */
function requeueFile(ledger: Ledger, entry: TierFile): void {
  const { file, key, forced, recent, catchUp } = entry;
  if (file.key === null || file.blocked !== null) return;
  const priority = priorityOf(file, NOTHING_CHANGED);
  const again = ledger.staysForced(file, key, forced);
  ledger.enqueue(file, priority, again, recent === true, catchUp === true);
}

/** A file the run did not complete: split, failed by its startup when setups apply, else unknown. */
function recordIncomplete(record: TierRecord, entry: TierFile, decision: Incomplete): void {
  const { file, key, forced } = entry;
  if (decision.kind === "split") {
    requeueSplit(record.ledger, file, key, decision.cap, forced, entry.recent === true);
  } else if (decision.kind === "not-started" && record.setups !== false) {
    record.notStarted.push({ file, forced: record.ledger.staysForced(file, key, forced) });
  } else record.unknown.push({ file, key });
}

/** A completed file: its growth joins its closure first, then it is discarded, re-run or stored. */
function recordCompleted(record: TierRecord, entry: TierFile, decision: Completed): void {
  const { context, ledger, tier } = record;
  const { file, key, checkpointId, forced } = entry;
  const { growth } = decision;
  if (growth !== undefined) {
    const added = context.keys.addObserved(file.ref, growth.add);
    record.rekeyed.push(...added.map((c) => c.testFile));
    record.grown.push({ ref: file.ref, checkpointId });
  }
  if (decision.kind === "unstable") {
    ledger.discard(file, key, forced, decision.paths, undefined, tier.runId);
  } else if (decision.kind === "first-seen") {
    if (decision.rerun) record.firstSeen.push({ file, firstSeen: growth?.firstSeen ?? [] });
  } else if (decision.kind === "environment") {
    // Task 003-43: the key it ran under lacks what the run loaded; it runs again at the key with it.
    record.grewEnvironment.push(file);
  } else if (decision.kind === "store") {
    const storeKey = growth === undefined ? key : context.keys.index.key(file.ref);
    if (storeKey !== null) storeFile(record, entry, decision, storeKey);
  }
}

/** Stores a completed file's results under `storeKey`; current when it still is at the key it ran under. */
function storeFile(
  record: TierRecord,
  entry: TierFile,
  decision: Extract<Completed, { kind: "store" }>,
  storeKey: CheckKey,
): void {
  const { context, ledger, tier, report } = record;
  const { store } = context;
  const { file, key, checkpointId, forced } = entry;
  const { growth } = decision;
  const previous = file.resultKey;
  const records = recordsForFile({
    ref: file.ref,
    key: storeKey,
    report,
    previousChecks: previous === null ? [] : store.results.checksForKey(previous),
    provenance: record.provenance,
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
  if ((growth !== undefined || file.key === key) && holdsNewFailure(context, prior, records)) {
    record.failedAnew.push({
      file,
      key: storeKey,
      forced,
      afterTestsPassed: failsAfterTestsPassed(records),
    });
  }
  if (decision.current) ledger.applyResults(file, key, records, checkpointId);
}

/**
 * After the files: the keys they moved settle, the re-runs queue, the
 * setups pass or fail and the files left `unknown` are marked, in this order.
 */
export function endRecord(record: TierRecord, environment: EnvironmentGrowth | undefined): void {
  const { context, ledger, tier } = record;
  // 016 D4: the start-up paths and direct marks the run gave, seen before this transaction.
  context.keys.writeSeen();
  if (environment !== undefined) settleEnvironment(record, environment);
  // The grown files take their new key and, once stored, its results; a re-key reached others.
  for (const { ref, checkpointId } of record.grown) {
    ledger.settle([ref], NOTHING_CHANGED, { checkpointId });
  }
  ledger.settle(record.rekeyed, NOTHING_CHANGED);
  ledger.rerunFirstSeen(record.firstSeen, tier.runId);
  rememberReruns(context, queueReruns(context, ledger, record.failedAnew));
  storeClosures(
    context,
    record.grown.map((g) => g.ref),
  );
  if (record.setups !== false) recordSetups(record, record.setups);
  markUnknown(record);
}

/**
 * Task 003-43: the environments read again moved the keys of every file of their projects.
 * A file an edit re-keyed keeps that edit's revision (001-186), so a wait that holds for the
 * edit still holds for it after a later, unrelated revision (task 003-45); `status --wait`
 * holds for one no edit re-keyed from the latest revision on.
 */
function settleEnvironment(record: TierRecord, environment: EnvironmentGrowth): void {
  const { ledger } = record;
  const unkeyed: TestFileRef[] = [];
  const edited: TestFileRef[] = [];
  for (const { testFile } of environment.changes) {
    (ledger.file(testFile)?.keyedAt === null ? unkeyed : edited).push(testFile);
  }
  ledger.settle(unkeyed, NOTHING_CHANGED, { keyedAt: ledger.revision.number });
  ledger.settle(edited, NOTHING_CHANGED);
  rerunGrown(ledger, environment, record.grewEnvironment);
}

/**
 * Task 001-382: one setup failure, not a FAIL per file; a run of a project that started passes
 * it, whatever its tests then did (review wave-13bp B4).
 */
function recordSetups(record: TierRecord, setups: true | ReadonlySet<ProjectName>): void {
  const { ledger, report, provenance } = record;
  const startup = report.startupFailure;
  const started = new Set([
    ...(report.startedProjects ?? []),
    ...report.completedFiles.map((f) => f.project),
  ]);
  for (const project of startup?.projects ?? []) started.delete(project);
  // Review 0.1.266, B2: no outcome of a setup that may have read an unmerged path.
  if (setups !== true) for (const project of setups) started.delete(project);
  ledger.setups.pass(started, provenance.commit);
  if (startup !== undefined) failStartup(ledger, startup, record.notStarted, provenance.commit);
}

/** Ends the retries of the files left `unknown` and marks them, with why the run ended. */
function markUnknown(record: TierRecord): void {
  const { context, ledger, tier, report } = record;
  const timedOut =
    report.end === "timed-out" ? timedOutReason(context.policy.runner.timeoutMs) : null;
  const reason = timedOut ?? report.failure ?? `run ${report.end}`;
  for (const { file, key } of record.unknown) endRetry(context, file, key, null, tier.runId);
  for (const { file } of record.notStarted)
    if (file.key !== null) endRetry(context, file, file.key, null, tier.runId);
  // Row 011-108 (gh-74): the run is recorded beside the states, never as a keyed result.
  ledger.markUnknown(record.unknown, reason, {
    runId: tier.runId,
    ...(timedOut === null ? {} : { cause: "timeout" }),
  });
}
