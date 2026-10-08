import { ancestorListings } from "../keys/index.js";
import { commitBatch, diffBatch, statCandidates } from "../revision/index.js";
import type { CandidateBatch, Revision } from "../types/index.js";
import type { SchedulerContext } from "./context.js";
import type { Ledger } from "./ledger.js";
import { type ContentRekey, rekeyContent } from "./revision.js";

/**
 * Reconciles a batch. A new revision is stored in one transaction with the
 * stat cache flush, the content re-key, the `queued` phases and the
 * refreshed known states, so the store never shows a revision whose
 * classification lags (spec 001 D5, review B2). The runner part follows in
 * `fetchRunnerPart` and `applyRunnerPart`.
 *
 * `commitBatch` updates the in-memory stat cache as it writes; a later
 * write in the same transaction that throws rolls the store back but not
 * memory. `handleBatch` then rejects, like a failed `Ledger.commit`.
 *
 * A reconciliation pass that finds no change also asks whether an
 * installed lockfile appeared, vanished or moved; that becomes a revision
 * of its own (review S8, N3).
 */
export async function reconcileBatch(
  context: SchedulerContext,
  ledger: Ledger,
  batch: CandidateBatch,
): Promise<{ revision: Revision; content: ContentRekey } | null> {
  const { keys, hasher, store, worktreeId } = context;
  let diff = await diffBatch(batch, keys.cache, hasher);
  if (diff.changes.length === 0 && batch.trigger !== "watch") {
    const moved = await keys.lockfileCandidates();
    if (moved.length > 0) {
      const paths = await statCandidates(moved, hasher);
      const lockfiles = await diffBatch({ trigger: batch.trigger, paths }, keys.cache, hasher);
      diff = { ...lockfiles, updates: [...diff.updates, ...lockfiles.updates] };
    }
  }
  const head = diff.changes.length > 0 ? await context.head() : null;
  return store.transaction(() => {
    const revision = commitBatch(diff, keys.cache, {
      worktreeId,
      head,
      revisions: store.revisions,
      fileHashes: store.fileHashes,
      now: context.now,
    });
    if (revision === null) return null;
    ledger.revision = { number: revision.number, head: revision.head, dirty: revision.dirty };
    for (const change of revision.changes) {
      ledger.tierChanges?.add(change.path);
      ledger.refineChanges?.add(change.path);
      // An add or delete moves the listings of its directories (task 001-132).
      if (change.oldHash === null || change.newHash === null) {
        for (const listing of ancestorListings(change.path)) ledger.tierChanges?.add(listing);
      }
    }
    const content = rekeyContent(context, ledger, revision);
    ledger.commit();
    return { revision, content };
  });
}
