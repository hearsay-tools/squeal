import { randomUUID } from "node:crypto";
import type { CheckpointRecord, TestFileRef } from "../types/index.js";
import { NOTHING_CHANGED } from "./context.js";
import { classify, type FileState } from "./files.js";
import type { Ledger } from "./ledger.js";
import { priorityOf } from "./queue.js";

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
 * nothing completes at once and leaves the open one be.
 */
export function queueFullSuite(ledger: Ledger, force: boolean): CheckpointRecord {
  const id = randomUUID();
  const revision = ledger.revision.number;
  const { checkpoints } = ledger;
  // A file another worktree's heal left held here is not done (review wave 13i, B1).
  ledger.confirmHeld();
  const files = [...ledger.files.values()];
  const unrunnable = files.filter((file) => file.key === null || file.blocked !== null);
  const runnable = files.filter((file) => file.key !== null && file.blocked === null);
  const open = force ? runnable : runnable.filter((file) => classify(file) !== "current");
  const joins =
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
    record = checkpoints.join(id, "run-all", revision, testFiles);
  } else if (testFiles.length === 0 && checkpoints.active !== null) {
    record = checkpoints.completeAtOnce(id, "run-all", revision);
  } else {
    record = checkpoints.start(id, "run-all", revision, testFiles, force);
    for (const file of unrunnable) checkpoints.failed(file.ref);
  }
  ledger.commit();
  return record;
}

/**
 * At the baseline (task 001-219): the explicit checkpoint the last daemon
 * owed resumes. Its files still listed and keyed run again: a forced one's
 * forced, the others when no result stands at their key; a file gone from
 * the listing needs none. With the baseline open, it ends with the
 * baseline, which already runs every file without a result; otherwise it is
 * the open checkpoint itself.
 */
export function resumeOwed(ledger: Ledger): void {
  const { checkpoints } = ledger;
  const taken = checkpoints.takeOwed();
  if (taken === null) return;
  const listed = taken.owed.remaining.flatMap((ref) => ledger.file(ref) ?? []);
  const strictIds = new Set(taken.owed.strict.map((ref) => ledger.file(ref)?.id));
  const strict = listed.filter((file) => strictIds.has(file.id) && file.key !== null);
  const loose = listed.filter((file) => !strictIds.has(file.id) || file.key === null);
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
