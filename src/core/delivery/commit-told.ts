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
 * once, with its next tool call or prompt; a consumer that registers after
 * it is not told an older commit. Only with a `checks` key
 * (`groupTextsShown`): without one, a report is marked told and nothing is
 * said, so no text changes and no later boundary reads the policy for it.
 */

/** `meta` key of the commit whose report each consumer of a worktree was last told. */
export function commitToldMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("commitTold", worktreeId);
}

/** Whether `line` is a report `consumer` was not told; `false` without one. */
export function commitChanged(
  store: Store,
  consumer: Consumer,
  line: CommitLine | undefined,
): boolean {
  return (
    line !== undefined &&
    readSlot(store, commitToldMetaKey(consumer.worktreeId), consumer) !== line.commit
  );
}

/** Records `line`'s commit as told to `consumer`. Call inside a transaction. */
export function tellCommit(store: Store, consumer: Consumer, line: CommitLine | undefined): void {
  if (line === undefined) return;
  writeSlot(store, commitToldMetaKey(consumer.worktreeId), consumer, line.commit);
}

/**
 * At a tool boundary, inside the delivery's transaction: the newest report
 * when `consumer` was not told it and the policy shows it, which makes the
 * boundary deliver. A report the policy does not show is marked told.
 */
export function commitNews(store: Store, consumer: Consumer): CommitLine | undefined {
  const line = readCommitLine(store, consumer.worktreeId);
  if (!commitChanged(store, consumer, line)) return undefined;
  const root = store.worktrees.get(consumer.worktreeId)?.root;
  if (root !== undefined && groupTextsShown(readPolicy(root))) return line;
  tellCommit(store, consumer, line);
  return undefined;
}
