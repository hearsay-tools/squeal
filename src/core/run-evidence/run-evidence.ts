import type { Hasher } from "../hash/hasher.js";
import type { StatCache } from "../hash/stat-cache.js";
import type { SchedulerContext } from "../scheduler/context.js";
import { scratchUnstable } from "../scheduler/editor-scratch.js";
import { rekeyEnvironments } from "../scheduler/environment-growth.js";
import { newFileState } from "../scheduler/files.js";
import { heldFiles, type MergeHold } from "../scheduler/hold.js";
import type { WorktreeKeys } from "../scheduler/keying.js";
import { NOTHING_OBSERVED, prepareObserved, type TierObservations } from "../scheduler/observed.js";
import {
  barredByTouch,
  type Moved,
  snapshotInputs,
  type Withheld,
} from "../scheduler/stability.js";
import {
  type StoreDecision,
  storeDecision,
  type TierEnd,
  tierEnd,
} from "../scheduler/store-decision.js";
import type { Tier, TierFile } from "../scheduler/tiers.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import type { CheckKey, TestFileRef } from "../types/keys.js";
import type { RunReport } from "../types/runner.js";
import { reasonOf } from "./reason.js";
import { movedInputs, observedMoves, readKeepEvidence } from "./sources.js";

/*
 * Run evidence and the store decision (GLOSSARY, "Results"; row 011-319,
 * `specifications/011-core/research/run-evidence.md`). Two callers save a
 * test file's results at its key: the daemon's record of a tier
 * (`scheduler/record.ts`, `recordTier`) and `squeal code`'s keeper (spec 020
 * D17.3, `code/gate/keep.ts`). Both copy the input state here before the
 * run, read the run evidence here after it, and take each file's store
 * decision from `storeDecision` through here. Each acts on the decision and
 * writes in its own way. Each kind of evidence comes from a source its
 * caller supplies: the keeper reads changed and touched inputs, observed
 * reads, environment files and, since row 011-320, the runtime's identity
 * (`readKeepEvidence`, in `sources.ts`); the daemon reads those, the
 * revisions during the run, the merge hold and the editor-scratch listings
 * (`readRecordEvidence`).
 */

/** What is known about one finished run of `TierFile`s, beyond its report. */
export interface RunEvidence {
  /** Inputs whose content moved during the run, editor-scratch listings among them (row 011-117). */
  readonly changed: ReadonlySet<RelativePath>;
  /** Touched inputs, observed reads among them (task 001-168): sorted. */
  readonly touched: readonly RelativePath[];
  /** What the run read beyond its keys, and loaded beyond its environments (tasks 001-132, 003-43). */
  readonly observed: TierObservations | undefined;
  /** The files a merge holds a path of (011 C9). */
  readonly held: readonly TierFile[];
}

/** A finished run's files as the decision reads them: `Tier`'s fields `tierEnd` takes. */
export type RunFiles = Pick<Tier, "files" | "lane" | "changes" | "cancel">;

/**
 * A file's store decision (`storeDecision`; GLOSSARY, "Store decision")
 * and its reason, which names the evidence behind it: a merge hold or a
 * touched input, when the decision is the caller's action on either.
 */
export interface FileDecision {
  readonly decision: StoreDecision;
  readonly reason: string;
}

/** Before a run: a copy of the stat cache entries of its inputs (`snapshotInputs`). */
export function copyInputs(cache: StatCache, paths: Iterable<RelativePath>): StatCache {
  return snapshotInputs(cache, paths);
}

/** A tier's `movedInputs` since it was selected (task 001-168). Outside the lock: it only reads. */
export function unstableInputs(
  tier: Pick<Tier, "snapshot" | "files">,
  hasher: Hasher,
): Promise<Moved> {
  return movedInputs(
    tier.snapshot,
    tier.files.flatMap((f) => f.inputs),
    hasher,
  );
}

/**
 * For a caller that writes later (spec 020 D17.5): the files of `files`
 * whose inputs still hold the bytes the run read, none changed since `before`.
 */
export async function stillAsRead<T extends { readonly paths: readonly RelativePath[] }>(
  before: StatCache,
  files: readonly T[],
  hasher: Hasher,
): Promise<T[]> {
  const { changed } = await movedInputs(
    before,
    files.flatMap((f) => f.paths),
    hasher,
  );
  return files.filter((f) => !f.paths.some((path) => changed.has(path)));
}

/**
 * The daemon's evidence beyond `inputs`, read once per record under the
 * scheduler lock (row 011-126). Task 003-43: environment files the run
 * loaded beyond the keyed ones re-key first: the daemon's evidence entry
 * re-keys the environments (`rekeyEnvironments` whole, its `seeStartup`
 * write first), it does not only read. Task 001-132: what the run read
 * beyond its closures is hashed (`prepareObserved`), then checked against
 * the stat cache (`observedMoves`). Row 011-117
 * (review 0.1.268 B1): a listing editor scratch files moved during the run,
 * one the run observed first included, as the batches applied before this
 * record leave it, counts as changed. Row 011-72 (011 C9): a file whose key
 * names an unmerged path is held. After a moved install, nothing the run
 * read or loaded is read.
 */
export async function readRecordEvidence(
  context: SchedulerContext,
  tier: Tier,
  report: RunReport,
  inputs: Moved,
  installMoved: boolean,
  hold: MergeHold,
): Promise<RunEvidence> {
  const environment = installMoved ? undefined : await rekeyEnvironments(context, report, tier);
  const growth = installMoved ? undefined : await prepareObserved(context, report, tier.run);
  const read = growth === undefined ? undefined : await observedMoves(context, growth);
  const observed =
    environment === undefined || read === undefined ? read : { ...read, environment };
  const changed = new Set([...inputs.changed, ...scratchUnstable(context, tier, observed?.growth)]);
  const touched = [...new Set([...inputs.touched, ...(observed?.touched ?? [])])].sort();
  return { changed, touched, observed, held: mergeHeld(hold, tier.files, observed) };
}

/** The files of `files` whose keys, or what their run read, name a path a merge holds (011 C9). */
export function mergeHeld(
  hold: MergeHold,
  files: readonly TierFile[],
  observed: TierObservations | undefined,
): TierFile[] {
  return heldFiles(hold, files, observed?.growth);
}

/** A test file's runtime identity now (`WorktreeKeys.runtimeIdentity`, `TierFile.runtimePolicy`). */
export type RuntimeIdentity = (ref: TestFileRef) => string;

/** What `squeal code` reads its evidence from (spec 020 D17.3). */
export interface KeepSources {
  readonly root: AbsolutePath;
  readonly keys: WorktreeKeys;
  readonly hasher: Hasher;
  /** `WorktreeKeys.beginRun`'s number for the run, for the reads first hashed after it. */
  readonly run: number;
  /** The copy of the inputs taken before the run (`copyInputs`). */
  readonly before: StatCache;
  /**
   * Row 011-320 (difference 2): the runtime identity at the run's end,
   * compared with each file's `KeepFile.runtimeIdentity`; without it, no
   * identity is compared.
   */
  readonly runtime?: RuntimeIdentity;
}

/** What a record knows at the try of its write, of its own: the caller's facts, not evidence. */
export interface RecordFacts {
  /** The files a merge holds at this try (`mergeHeld`): queued again, outside the barrier. */
  readonly held: readonly TierFile[];
  /** The hold rejects the report's startup failure (review 0.1.266 B2): the report goes without it. */
  readonly startupHeld: boolean;
  /** Which barred files are withheld at their key for the first time (`Withholds.peek`, task 007-30). */
  readonly withholds: (barred: readonly TierFile[]) => Withheld<TierFile>;
  /** Files a stop's or a hold's cancel cut short (D10, row 011-74): queued again. */
  readonly unfinished: readonly string[];
  /** Files a held startup failure kept from starting (review 0.1.266 B2): queued again. */
  readonly notStarted: readonly TierFile[];
  /** Files a crash after the stop, or the runtime's loss, interrupted (rows 011-66, 011-106). */
  readonly interrupted: readonly string[];
  /** The install moved during the run (task 001-107): the whole run queues again. */
  readonly installMoved: boolean;
}

/** What a record hands `recordTier`, and the withholds its caller counts once the write lands. */
export interface RecordOutcome {
  /** The barrier's report, without a startup failure the hold rejects. */
  readonly report: RunReport;
  /** `TierEnd.requeue`: the whole run, or these files, queue again uncounted. */
  readonly requeue: boolean | ReadonlySet<string>;
  /** The files a merge holds, and those it leaves free. */
  readonly held: readonly TierFile[];
  readonly free: readonly TierFile[];
  /** The free files the barrier withheld, split as `RecordFacts.withholds` did. */
  readonly barred: readonly TierFile[];
  readonly withheld: Withheld<TierFile>;
  /** The touched paths the barred files' keys, or their reads, name. */
  readonly paths: readonly RelativePath[];
}

/**
 * The report and the requeue of a finished run's record (row 011-319):
 * the completion barrier (task 001-168, task 013-02) over the files the
 * merge hold leaves free (011 C9) withholds those whose keys, or what their
 * run read, name a touched path; a first withhold at a file's key queues it
 * again, an exhausted one leaves it unknown (task 007-30). The held files,
 * and those `facts` names, queue again; a moved install queues the whole
 * run. The daemon's record and `squeal code` both take their report and
 * requeue from here, then `runEnd` and `storeDecision` per file.
 */
export function recordOutcome(
  files: readonly TierFile[],
  report: RunReport,
  evidence: Pick<RunEvidence, "touched" | "observed">,
  facts: RecordFacts,
): RecordOutcome {
  const { held } = facts;
  const free = held.length === 0 ? files : files.filter((f) => !held.includes(f));
  const growth = evidence.observed?.growth;
  const barrier = barredByTouch(report, free, evidence.touched, growth);
  const withheld = facts.withholds(barrier.barred);
  const { startupFailure: _, ...withoutStartup } = barrier.report;
  const again = [
    ...withheld.again.map(({ file }) => file.id),
    ...facts.unfinished,
    ...held.map(({ file }) => file.id),
    ...facts.notStarted.map(({ file }) => file.id),
    ...facts.interrupted,
  ];
  const { installMoved } = facts;
  return {
    report: facts.startupHeld ? withoutStartup : barrier.report,
    requeue: installMoved || again.length === 0 ? installMoved : new Set(again),
    held,
    free,
    barred: barrier.barred,
    withheld,
    paths: barrier.paths,
  };
}

/** What a run's end says of its files (`tierEnd`), from its evidence and its record's outcome. */
export function runEnd(
  tier: RunFiles,
  report: RunReport,
  changed: ReadonlySet<RelativePath>,
  requeue: boolean | ReadonlySet<string>,
  observed: TierObservations,
  runtimeIdentity?: RuntimeIdentity,
): TierEnd {
  return tierEnd(tier, report, changed, requeue, observed, runtimeIdentity);
}

/**
 * `entry`'s store decision over the run's `end` (`storeDecision`, as
 * `recordFile` takes it), the caller holding its file as it ran when
 * `holds`, with the reason `outcome` gives it.
 */
export function decisionOf(
  entry: TierFile,
  end: TierEnd,
  outcome: RecordOutcome,
  holds: boolean,
): FileDecision {
  const decision = storeDecision(entry, end, holds);
  return { decision, reason: reasonOf(decision, entry, end, outcome) };
}

/** A file `squeal code` ran: the key a lookup gave it, and what its stability check compares. */
export interface KeepFile {
  readonly ref: TestFileRef;
  readonly key: CheckKey;
  readonly paths: readonly RelativePath[];
  /** Its runtime identity when the lookup expected it (`KeepSources.runtime`); default none. */
  readonly runtimeIdentity?: string;
}

/**
 * `squeal code`'s store decision for each of `files` that `report`'s run
 * ran, by `testFileId`, from the evidence it reads (`readKeepEvidence`)
 * and the runtime identity at the run's end, as `recordTier` reads it. It
 * has no ledger: each file is held at the key it ran under, and nothing
 * queues again (`KEEP_FACTS`).
 */
export async function keepDecisions(
  sources: KeepSources,
  files: readonly KeepFile[],
  report: RunReport,
): Promise<Map<string, FileDecision>> {
  const entries = files.map(({ ref, key, paths, runtimeIdentity = "" }): TierFile => {
    const file = { ...newFileState(ref), key };
    const entry = { file, key, inputs: paths, runtimePolicy: runtimeIdentity };
    return { ...entry, checkpointId: null, forced: false };
  });
  const evidence = await readKeepEvidence(sources, entries, report);
  const outcome = recordOutcome(entries, report, evidence, KEEP_FACTS);
  const run = { files: entries, lane: KEEP_LANE, changes: new Set<RelativePath>(), cancel: null };
  const observed = evidence.observed ?? NOTHING_OBSERVED;
  const { changed } = evidence;
  const end = runEnd(run, outcome.report, changed, outcome.requeue, observed, sources.runtime);
  return new Map(entries.map((entry) => [entry.file.id, decisionOf(entry, end, outcome, true)]));
}

/** `squeal code` has no ledger, no merge hold yet, and no retry: a barred file is not kept. */
const KEEP_FACTS: RecordFacts = {
  held: [],
  startupHeld: false,
  withholds: (barred) => ({ again: [], exhausted: barred }),
  unfinished: [],
  notStarted: [],
  interrupted: [],
  installMoved: false,
};

/** The lane `keepDecisions` names: no slow lane, so a timed-out run of several files splits. */
const KEEP_LANE = "squeal code";

/** `squeal code` keeps a file only when the daemon would store it at the key it ran under. */
export function keeps(decision: StoreDecision): boolean {
  return decision.kind === "store" && decision.at === "ran";
}
