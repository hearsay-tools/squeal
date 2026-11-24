import { readPolicy } from "../../core/daemon/policy.js";
import { keyingDeferred } from "../../core/scheduler/deferred-keying.js";
import { connectionOf } from "../../core/store/store.js";
import type { AbsolutePath, WorktreeId } from "../../core/types/common.js";
import type { StatusHeader, StatusSnapshot } from "../../core/types/status.js";
import type { Store } from "../../core/types/store.js";

/*
 * Row 011-331: the edit wait's own reads of whether its worktree is listed
 * and pending, moved here with their wait unchanged (row 011-331's record:
 * "the raw SQL in `status-wait-listing.ts` and `anyPending`'s copy of
 * `isPending` move unchanged").
 */

/**
 * Whether the edit wait owes no listing: the snapshot's listing evidence,
 * even when the poll read only held files, or a policy under which the
 * daemon lists nothing unasked. The header already includes completed empty
 * checkpoints, except during an install wait. If it has no evidence, check
 * for any worktree key on the same connection and in the poll's read
 * transaction, without loading every row. Row 010-37: when every runner is
 * deferred (spec 026 D1, `keyingDeferred`), no runner lists until a request
 * opens it, so the wait settles on quiet once the daemon synced the
 * revision instead of holding until its timeout for a listing that never
 * comes.
 */
export function listingSettled(
  store: Store,
  id: WorktreeId,
  root: AbsolutePath,
  header: StatusHeader,
): boolean {
  return (
    header.testFilesListed === true ||
    connectionOf(store).get("SELECT 1 FROM test_file_keys WHERE worktree_id = ? LIMIT 1", id) !==
      null ||
    keyingDeferred(readPolicy(root))
  );
}

/**
 * Whether anything is pending in the snapshot an edit wait ended on: a
 * copy of `isPending` (`core/state/header.ts`) over the snapshot, kept as a
 * copy; its quiet line says the wait does not hold for the rest.
 */
export function anyPending(snapshot: StatusSnapshot): boolean {
  const { counts, testFilesWithoutChecks, runnerPartPending } = snapshot;
  return counts.pending + testFilesWithoutChecks.pending > 0 || runnerPartPending === true;
}
