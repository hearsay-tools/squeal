import type { Hasher } from "../hash/hasher.js";
import type { StatCache } from "../hash/stat-cache.js";
import { listedDirectory } from "../keys/observed.js";
import type { SchedulerContext } from "../scheduler/context.js";
import { scratchUnstable } from "../scheduler/editor-scratch.js";
import { type EnvironmentGrowth, rekeyEnvironments } from "../scheduler/environment-growth.js";
import { newFileState } from "../scheduler/files.js";
import { heldFiles, type MergeHold } from "../scheduler/hold.js";
import type { WorktreeKeys } from "../scheduler/keying.js";
import {
  NOTHING_OBSERVED,
  observedGrowth,
  prepareObserved,
  type TierObservations,
} from "../scheduler/observed.js";
import { barredByTouch, changedSince, type Moved, snapshotInputs } from "../scheduler/stability.js";
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
 * reads and environment files (`readKeepEvidence`); the daemon reads those,
 * the revisions during the run, the runtime's identity, the merge hold and
 * the editor-scratch listings (`readRecordEvidence`).
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
 * The store decision for one test file of a finished run (GLOSSARY, "Store
 * decision"): `storeDecision`'s, after the two kinds of evidence its caller
 * acts on first.
 */
export type RunDecision =
  /** A merge holds a path its key names (011 C9): nothing is stored until the merge ends. */
  | { readonly kind: "held" }
  /** Touched inputs (task 001-168): the run is withheld for these paths. */
  | { readonly kind: "touched"; readonly paths: readonly RelativePath[] }
  | StoreDecision;

/** A file's store decision and its reason. */
export interface FileDecision {
  readonly decision: RunDecision;
  readonly reason: string;
}

/** Before a run: a copy of the stat cache entries of its inputs (`snapshotInputs`). */
export function copyInputs(cache: StatCache, paths: Iterable<RelativePath>): StatCache {
  return snapshotInputs(cache, paths);
}

/**
 * After a run: the inputs among `paths` whose content differs from
 * `before`, and the touched ones (`changedSince`). A listing is no file:
 * the revisions during the run cover it, and the editor-scratch listings.
 */
export function movedInputs(
  before: StatCache,
  paths: Iterable<RelativePath>,
  hasher: Hasher,
): Promise<Moved> {
  const files = new Set<RelativePath>();
  for (const path of paths) if (listedDirectory(path) === null) files.add(path);
  return changedSince(before, files, hasher);
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
 * loaded beyond the keyed ones re-key first (`rekeyEnvironments`). Task
 * 001-132: what the run read beyond its closures is hashed. Row 011-117
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
  const read = installMoved ? undefined : await prepareObserved(context, report, tier.run);
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

/** What `squeal code` reads its evidence from (spec 020 D17.3). */
export interface KeepSources {
  readonly root: AbsolutePath;
  readonly keys: WorktreeKeys;
  readonly hasher: Hasher;
  /** `WorktreeKeys.beginRun`'s number for the run, for the reads first hashed after it. */
  readonly run: number;
  /** The copy of the inputs taken before the run (`copyInputs`). */
  readonly before: StatCache;
}

/**
 * The keeper's evidence: its inputs that moved, what the run read beyond
 * its keys (`observedGrowth`), and the environment files it loaded that its
 * project's keys lack. No revision, runtime identity, merge hold or editor
 * scratch listing is read (`research/run-evidence.md`, differences 2 to 4).
 */
async function readKeepEvidence(
  sources: KeepSources,
  files: readonly TierFile[],
  report: RunReport,
): Promise<RunEvidence> {
  const { root, keys } = sources;
  const growth = await observedGrowth({ root, keys }, report, sources.run);
  const inputs = await movedInputs(
    sources.before,
    files.flatMap((f) => f.inputs),
    sources.hasher,
  );
  const environment = loadedBeyondKeys(keys, files, report);
  const observed: TierObservations = {
    ...NOTHING_OBSERVED,
    growth,
    ...(environment === undefined ? {} : { environment }),
  };
  return { changed: inputs.changed, touched: [...inputs.touched].sort(), observed, held: [] };
}

/** The files of `files` whose project's run loaded an environment file its keys lack. */
function loadedBeyondKeys(
  keys: WorktreeKeys,
  files: readonly TierFile[],
  report: RunReport,
): EnvironmentGrowth | undefined {
  const beyond = new Map<string, RelativePath[]>();
  for (const { project, paths } of report.environmentObserved ?? []) {
    const keyed = new Set(keys.environmentFiles(project));
    const lacking = paths.filter((path) => !keyed.has(path));
    if (lacking.length > 0) beyond.set(project, lacking);
  }
  const loaded = new Map<string, readonly RelativePath[]>();
  for (const { file } of files) {
    const paths = beyond.get(file.ref.project);
    if (paths !== undefined) loaded.set(file.id, paths);
  }
  return loaded.size === 0 ? undefined : { files: loaded, changes: [] };
}

/**
 * The completion barrier (task 001-168; task 013-02): `report` without the
 * files of `files` whose keys, or what their run read, name a touched path.
 */
export function touchBarrier<T extends TierFile>(
  report: RunReport,
  files: readonly T[],
  evidence: Pick<RunEvidence, "touched" | "observed">,
): { readonly report: RunReport; readonly barred: T[]; readonly paths: RelativePath[] } {
  return barredByTouch(report, files, evidence.touched, evidence.observed?.growth);
}

/** What a run's end says of its files (`tierEnd`), from its evidence. */
export function runEnd(
  tier: RunFiles,
  report: RunReport,
  changed: ReadonlySet<RelativePath>,
  requeue: boolean | ReadonlySet<string>,
  observed: TierObservations,
  runtimeIdentity?: (ref: TestFileRef) => string,
): TierEnd {
  return tierEnd(tier, report, changed, requeue, observed, runtimeIdentity);
}

/** What the daemon decides with its ledger; absent, each file is held at the key it ran under. */
export interface DecideOptions {
  /** The whole run, or these files, queue again uncounted (`TierEnd.requeue`). */
  readonly requeue?: boolean | ReadonlySet<string>;
  /** Whether the caller still holds `entry`'s file as it ran (the daemon's ledger). */
  readonly holds?: (entry: TierFile) => boolean;
  /** The runtime's identity now (`TierFile.runtimePolicy`, the daemon's). */
  readonly runtimeIdentity?: (ref: TestFileRef) => string;
}

/**
 * Each file's store decision and its reason, by `testFileId`: held when a
 * merge holds a path it names, touched when the barrier withholds it, else
 * `storeDecision`'s over the run's end.
 */
export function decideFiles(
  tier: RunFiles,
  report: RunReport,
  evidence: RunEvidence,
  options: DecideOptions = {},
): Map<string, FileDecision> {
  const free = tier.files.filter((f) => !evidence.held.includes(f));
  const barrier = touchBarrier(report, free, evidence);
  const observed = evidence.observed ?? NOTHING_OBSERVED;
  const end = runEnd(
    tier,
    barrier.report,
    evidence.changed,
    options.requeue ?? false,
    observed,
    options.runtimeIdentity,
  );
  const touched = new Set(evidence.touched);
  const out = new Map<string, FileDecision>();
  for (const entry of tier.files) {
    const named = [...entry.inputs, ...(observed.growth.get(entry.file.id)?.growth ?? [])];
    const decision: RunDecision = evidence.held.includes(entry)
      ? { kind: "held" }
      : barrier.barred.includes(entry)
        ? { kind: "touched", paths: [...new Set(named.filter((p) => touched.has(p)))].sort() }
        : storeDecision(entry, end, options.holds?.(entry) ?? true);
    out.set(entry.file.id, { decision, reason: reasonOf(decision, entry, end) });
  }
  return out;
}

/** A file `squeal code` ran: the key a lookup gave it, and what its stability check compares. */
export interface KeepFile {
  readonly ref: TestFileRef;
  readonly key: CheckKey;
  readonly paths: readonly RelativePath[];
}

/**
 * `squeal code`'s store decision for each of `files` that `report`'s run
 * ran, by `testFileId`, from the evidence it reads (`readKeepEvidence`). It
 * has no ledger: each file is held at the key it ran under, and nothing
 * queues again.
 */
export async function keepDecisions(
  sources: KeepSources,
  files: readonly KeepFile[],
  report: RunReport,
): Promise<Map<string, FileDecision>> {
  const entries = files.map(({ ref, key, paths }): TierFile => {
    const file = { ...newFileState(ref), key };
    return { file, key, inputs: paths, runtimePolicy: "", checkpointId: null, forced: false };
  });
  const evidence = await readKeepEvidence(sources, entries, report);
  const run = { files: entries, lane: KEEP_LANE, changes: new Set<RelativePath>(), cancel: null };
  return decideFiles(run, report, evidence);
}

/** The lane `keepDecisions` names: no slow lane, so a timed-out run of several files splits. */
const KEEP_LANE = "squeal code";

/** `squeal code` keeps a file only when the daemon would store it at the key it ran under. */
export function keeps(decision: RunDecision): boolean {
  return decision.kind === "store" && decision.at === "ran";
}
