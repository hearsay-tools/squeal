import { readCommitReport } from "../commit/store.js";
import { readPolicy } from "../daemon/policy.js";
import { groupTextsShown, readCommitLine } from "../state/index.js";
import {
  type CommitLine,
  type Consumer,
  type Store,
  type WorktreeId,
  worktreeMetaKey,
} from "../types/index.js";
import { readSlot, writeSlot } from "./slots.js";

/*
 * Spec 019 D5 step 3 (row 019-16): each commit report reaches a consumer
 * once, with its next tool call or prompt, and its one update once more
 * (row 019-22); a consumer that registers after it is not told an older
 * commit, only an update that comes after the registration. Row 019-38
 * (lessons Round 2 P8, option A): a Stop tells one no boundary told, with
 * its hold or as news, and a later Stop or boundary does not repeat it.
 * Only with a `checks` key (`groupTextsShown`): without one, a report is
 * marked told and nothing is said, so no text changes and no later
 * boundary reads the policy for it.
 */

/** `meta` key of the commit whose report each consumer of a worktree was last told. */
export function commitToldMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("commitTold", worktreeId);
}

/**
 * What a consumer told `line` was told: its commit, and `+` once the
 * report took its one update (row 019-22, D5 step 3), so the update is
 * news once. A report the store no longer holds is its commit's.
 */
function toldId(store: Store, worktreeId: WorktreeId, line: CommitLine): string {
  const report = readCommitReport(store.meta, worktreeId, line.commit);
  return report !== null && "updated" in report && report.updated === true
    ? `${line.commit}+`
    : line.commit;
}

/** Whether `line` is a report, or its update, `consumer` was not told; `false` without one. */
export function commitChanged(
  store: Store,
  consumer: Consumer,
  line: CommitLine | undefined,
): boolean {
  return (
    line !== undefined &&
    readSlot(store, commitToldMetaKey(consumer.worktreeId), consumer) !==
      toldId(store, consumer.worktreeId, line)
  );
}

/** Records `line`'s report, as it stands, as told to `consumer`. Call inside a transaction. */
export function tellCommit(store: Store, consumer: Consumer, line: CommitLine | undefined): void {
  if (line === undefined) return;
  const id = toldId(store, consumer.worktreeId, line);
  writeSlot(store, commitToldMetaKey(consumer.worktreeId), consumer, id);
}

/**
 * At a tool boundary or a Stop, inside the delivery's transaction: the
 * newest report when `consumer` was not told it and the policy shows it,
 * which makes the delivery deliver. A report the policy does not show is
 * marked told.
 */
export function commitNews(store: Store, consumer: Consumer): CommitLine | undefined {
  const line = readCommitLine(store, consumer.worktreeId);
  if (!commitChanged(store, consumer, line)) return undefined;
  const root = store.worktrees.get(consumer.worktreeId)?.root;
  if (root !== undefined && groupTextsShown(readPolicy(root))) return line;
  tellCommit(store, consumer, line);
  return undefined;
}
