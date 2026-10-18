import { randomUUID } from "node:crypto";
import type {
  CheckpointLane,
  CheckpointRecord,
  FullSuiteCheckpoint,
  TestFileRef,
} from "../types/index.js";
import { NOTHING_CHANGED } from "./context.js";
import { classify, type FileState } from "./files.js";
import type { Ledger } from "./ledger.js";
import { priorityOf } from "./queue.js";

/**
 * `run --all` while the worktree waits for an install: nothing can be listed
 * or keyed, so the checkpoint over the files an earlier daemon listed is
 * abandoned at once and never claims a full suite (review wave 11, B1).
 */
export function abandonFullSuite(ledger: Ledger): FullSuiteCheckpoint {
  const files = [...ledger.files.values()].map((file) => file.ref);
  const record = ledger.checkpoints.abandon(randomUUID(), "run-all", ledger.revision.number, files);
  ledger.commit();
  return { ...record, owner: record.id };
}

/** Task 004-61: `run --all --fast` requests only the fast lane's files, `isSlow` says which. */
export interface LaneFilter {
  readonly lane: CheckpointLane;
  readonly isSlow: (ref: TestFileRef) => boolean;
}

/**
 * Spec 001 D5: "`squeal run --all` queues every test file whose key has no
 * result, or every test file when `--force` is given." One checkpoint of kind
 * `run-all` over those files (D7). Files already queued or running belong to
 * it too; a file that crashed at its key is queued again. "An unkeyed or
 * `unknown` file is always work to do": an unkeyed file, or one blocked by a
 * runner failure, is requested too and ends the checkpoint `abandoned`.
 *
 * Task 001-217: when the open checkpoint already runs every file the request
 * needs (a forced one: runs them forced), the request joins it and ends with
 * it rather than abandoning it for an identical one. A request that needs
 * nothing completes at once and leaves the open one be. A `fresh` request
 * never joins: a warm-up's files run flagged, so a tier already in flight
 * cannot count for them (review wave 13ar, B1). The joined one is its
 * `owner`, which the CLI counts the work of (review wave-3, B4). With
 * `only`, the request and its checkpoint hold that lane's files alone (task
 * 004-61); joined, it ends once those have a result, whatever the open one's
 * other lane still runs (review 001-417 S1).
 */
export function queueFullSuite(
  ledger: Ledger,
  force: boolean,
  fresh = false,
  only?: LaneFilter,
): FullSuiteCheckpoint {
  const id = randomUUID();
  const revision = ledger.revision.number;
  const { checkpoints } = ledger;
  const lane = only?.lane;
  // A file another worktree's heal left held here is not done (review wave 13i, B1).
  ledger.confirmHeld();
  const files = [...ledger.files.values()].filter(
    (file) => only === undefined || only.isSlow(file.ref) === (only.lane === "slow"),
  );
  const unrunnable = files.filter((file) => file.key === null || file.blocked !== null);
  const runnable = files.filter((file) => file.key !== null && file.blocked === null);
  const open = force ? runnable : runnable.filter((file) => classify(file) !== "current");
  const joins =
    !fresh &&
    open.length + unrunnable.length > 0 &&
    checkpoints.covers(refs([...open, ...unrunnable]), force);
  const attributed = joins ? (checkpoints.active?.record.id ?? id) : id;
  let requested: FileState[];
  if (force) {
    requested = runnable;
    // Joined, every file is queued or running forced already.
    const queue = joins ? [] : runnable;
    for (const file of queue) ledger.enqueue(file, priorityOf(file, NOTHING_CHANGED), true);
  } else {
    for (const file of open) file.unknownKey = null;
    const pending = open.filter((file) => file.phase !== null);
    const misses = ledger.settle(
      refs(open.filter((file) => file.phase === null)),
      NOTHING_CHANGED,
      { checkpointId: attributed },
    );
    requested = [...pending, ...misses];
  }
  const testFiles = refs([...requested, ...unrunnable]);
  let record: CheckpointRecord;
  if (joins) {
    record = checkpoints.join(id, "run-all", revision, testFiles, lane);
  } else if (testFiles.length === 0 && checkpoints.active !== null) {
    record = checkpoints.completeAtOnce(id, "run-all", revision, lane);
  } else {
    record = checkpoints.start(id, "run-all", revision, testFiles, force, lane);
    for (const file of unrunnable) checkpoints.failed(file.ref);
  }
  ledger.commit();
  return { ...record, owner: joins ? attributed : record.id };
}

/** What the last daemon owed (task 001-219), taken once at the baseline (`Checkpoints.takeOwed`). */
export type Owed = ReturnType<Ledger["checkpoints"]["takeOwed"]>;

/**
 * The files of `owed` still listed and keyed that only its own forced runs
 * count for. The baseline requests them too (task 004-69): a lookup hit is
 * no forced run, so the baseline cannot complete, and certify a full suite,
 * before a forced slow file's precondition resolves (spec 004 D8).
 */
export function owedStrict(ledger: Ledger, owed: Owed): FileState[] {
  if (owed === null) return [];
  const strictIds = new Set(owed.owed.strict.map((ref) => ledger.file(ref)?.id));
  return owed.owed.remaining
    .flatMap((ref) => ledger.file(ref) ?? [])
    .filter((file) => strictIds.has(file.id) && file.key !== null);
}

/**
 * At the baseline (task 001-219): the explicit checkpoint the last daemon
 * owed resumes. Its files still listed and keyed run again: a forced one's
 * forced, the others when no result stands at their key; a file gone from
 * the listing needs none. With the baseline open, it ends with the
 * baseline, which already runs every file without a result and waits for
 * the forced ones (`owedStrict`); otherwise it is the open checkpoint itself.
 */
export function resumeOwed(ledger: Ledger, taken: Owed): void {
  const { checkpoints } = ledger;
  if (taken === null) return;
  const listed = taken.owed.remaining.flatMap((ref) => ledger.file(ref) ?? []);
  const strict = owedStrict(ledger, taken);
  const loose = listed.filter((file) => !strict.includes(file));
  const unrunnable = loose.filter((file) => file.key === null || file.blocked !== null);
  const baseline = checkpoints.active;
  // The baseline requested and queued every runnable file without a result.
  const others =
    baseline === null
      ? loose.filter((file) => !unrunnable.includes(file) && classify(file) !== "current")
      : [];
  checkpoints.resume(taken.records, refs([...strict, ...others, ...unrunnable]), refs(strict));
  for (const file of strict) ledger.enqueue(file, priorityOf(file, NOTHING_CHANGED), true);
  ledger.settle(refs(others.filter((file) => file.phase === null)), NOTHING_CHANGED);
  for (const file of unrunnable) checkpoints.failed(file.ref);
}

function refs(files: readonly FileState[]): TestFileRef[] {
  return files.map((file) => file.ref);
}
