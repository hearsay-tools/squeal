import { testFileId } from "../keys/index.js";
import { type CheckKey, isSlowLane, type RelativePath, type RunReport } from "../types/index.js";
import type { FileState } from "./files.js";
import type { ObservedGrowth, TierObservations } from "./observed.js";
import type { Tier, TierFile } from "./tiers.js";

/*
 * What `recordTier` does with each file of a finished tier (spec 001 D5,
 * D12; task 011-37 section 5): store its results and under which key,
 * discard them, queue it again, or leave it unknown. A pure decision over
 * the file's entry and what the run's end says of every file; `recordTier`
 * carries it out. A stored row's meaning rests on it, so the key format
 * alarm reads it apart from the tier's queueing and capacity (row 011-40).
 */

/** What a tier's end says of its files, read once per tier. */
export interface TierEnd {
  /** `testFileId`s of the files the run completed. */
  readonly completed: ReadonlySet<string>;
  /** The runner withheld them (`RunReport.withheld`, issue 10, task 011-06). */
  readonly withheld: ReadonlySet<string>;
  /** A backlog tier an edit cancelled, its run otherwise completed (task 001-124). */
  readonly cancelled: boolean;
  /** The whole tier, or these files, queue again uncounted (`recordTier`'s `requeue`). */
  readonly requeue: boolean | ReadonlySet<string>;
  /** The global setup's failure kept them from starting (task 001-382). */
  readonly notStarted: ReadonlySet<string>;
  /** `timeoutCap`: the tier cap of a timed-out tier's incomplete files; `null` when none. */
  readonly splitCap: number | null;
  /** What each completed file read beyond its closure (task 001-132). */
  readonly growth: ReadonlyMap<string, ObservedGrowth>;
  /** Files whose run loaded environment files their key lacked (task 003-43). */
  readonly environment: ReadonlySet<string>;
  /** A path whose content changed on disk since selection or in a revision during the run (D5). */
  readonly unstable: (path: RelativePath) => boolean;
}

/** `tier`'s end from its `report`, as `recordTier` takes them. */
export function tierEnd(
  tier: Pick<Tier, "files" | "lane" | "changes" | "cancel">,
  report: RunReport,
  changedOnDisk: ReadonlySet<RelativePath>,
  requeue: boolean | ReadonlySet<string>,
  observed: TierObservations,
): TierEnd {
  const completed = new Set(report.completedFiles.map(testFileId));
  const duringRun = tier.changes;
  return {
    completed,
    withheld: new Set((report.withheld ?? []).map(testFileId)),
    cancelled: tier.cancel?.signal.aborted === true && report.end === "completed",
    requeue,
    notStarted: new Set((report.startupFailure?.testFiles ?? []).map(testFileId)),
    splitCap: timeoutCap(
      report,
      tier.lane,
      tier.files.map((f) => f.file),
      completed,
    ),
    growth: observed.growth,
    environment: new Set(observed.environment?.files.keys() ?? []),
    unstable: (path) =>
      changedOnDisk.has(path) || duringRun.has(path) || observed.changed.has(path),
  };
}

/**
 * The tier cap of the files a timed-out tier left incomplete (D5, D12; task
 * 001-179): half as many as it left so, down to one, so a file that holds
 * every tier it joins ends up in a tier of its own. `null` when the tier
 * held one file, which is `unknown` as before, or ran in a slow lane, whose
 * width spec 004 D2 sets; also when the run did not time out.
 */
function timeoutCap(
  report: RunReport,
  lane: string,
  files: readonly FileState[],
  completed: ReadonlySet<string>,
): number | null {
  if (report.end !== "timed-out" || files.length < 2 || isSlowLane(lane)) return null;
  const incomplete = files.filter((file) => !completed.has(file.id)).length;
  return Math.max(1, Math.floor(incomplete / 2));
}

/** A completed file's results, once its observed growth joined its closure. */
type Completed =
  /** Inputs moved during the run: discarded and re-queued (D5 stability check). */
  | { readonly kind: "unstable"; readonly paths: readonly RelativePath[] }
  /**
   * It read paths first seen during the run (task 001-134): nothing stored,
   * and it re-runs under the key with them when it is still at its key.
   */
  | { readonly kind: "first-seen"; readonly rerun: boolean }
  /** It loaded environment files its key lacked (task 003-43): it re-runs under the key with them. */
  | { readonly kind: "environment" }
  /** Its growth's key is the one an edit moved it from: nothing to store under. */
  | { readonly kind: "no-key" }
  /**
   * Stored under the key it ran under, or the one its growth gives it
   * (`grown`), which never is the key it ran under; current for the file
   * when it is still at the key it ran under and grew nothing.
   */
  | { readonly kind: "store"; readonly at: "ran" | "grown"; readonly current: boolean };

export type StoreDecision =
  /** A newer run has the file at another key (`supersededIn`): this run's outcome is discarded. */
  | { readonly kind: "superseded" }
  /** The ledger no longer holds the file as it was selected: nothing is recorded. */
  | { readonly kind: "gone" }
  /** The runner withheld the completed run: discarded and re-queued, counted. */
  | { readonly kind: "withheld" }
  /** Queued again uncounted: the install moved, a first withhold, a cancel cut it short. */
  | { readonly kind: "requeue" }
  | { readonly kind: "not-started" }
  /** Crashed, or not completed before a timeout (D12). */
  | { readonly kind: "unknown" }
  /** A timed-out tier's incomplete file, queued again in tiers of at most `cap` (task 001-179). */
  | { readonly kind: "split"; readonly cap: number }
  /** Completed; `growth`, when present, joins its closure and the shared observed set first. */
  | (Completed & { readonly growth?: ObservedGrowth });

/**
 * Whether a newer run has `file` at a key other than `key`, the one this
 * tier ran it at: an edit's tier beside a backlog tier took the file it
 * re-keyed (spec 011 C4 step 5, task 011-21), and still runs it or already
 * stored its result. The older run then neither ends the file's running
 * state, nor queues it, nor marks it unknown on a crash or a timeout; its
 * outcome is discarded (review wave-4 B1, both completion orders).
 */
export function supersededIn(file: FileState, key: CheckKey): boolean {
  if (file.runningKey !== null && file.runningKey !== key) return true;
  return file.key !== null && file.key !== key && file.resultKey === file.key;
}

/**
 * What recording `entry` does with its file, the ledger holding it as it
 * was selected when `held`. It reads the file's state and decides nothing
 * the order of a tier's files could change.
 */
export function storeDecision(
  entry: Pick<TierFile, "file" | "key" | "inputs">,
  end: TierEnd,
  held: boolean,
): StoreDecision {
  const { file, key, inputs } = entry;
  if (supersededIn(file, key)) return { kind: "superseded" };
  if (!held) return { kind: "gone" };
  const queued = typeof end.requeue === "boolean" ? end.requeue : end.requeue.has(file.id);
  if (!queued && end.withheld.has(file.id)) return { kind: "withheld" };
  if (queued || (end.cancelled && !end.completed.has(file.id))) return { kind: "requeue" };
  if (!end.completed.has(file.id)) {
    if (end.notStarted.has(file.id)) return { kind: "not-started" };
    if (end.splitCap === null) return { kind: "unknown" };
    return { kind: "split", cap: end.splitCap };
  }
  const growth = end.growth.get(file.id);
  const grew = growth === undefined ? {} : { growth };
  const paths = [...inputs, ...(growth?.growth ?? [])].filter(end.unstable);
  if (paths.length > 0) return { kind: "unstable", paths, ...grew };
  if (growth !== undefined && growth.firstSeen.length > 0) {
    return { kind: "first-seen", rerun: file.key === key, ...grew };
  }
  if (end.environment.has(file.id)) return { kind: "environment", ...grew };
  if (growth === undefined) return { kind: "store", at: "ran", current: file.key === key };
  if (file.key !== key) return { kind: "no-key", ...grew };
  return { kind: "store", at: "grown", current: false, ...grew };
}
