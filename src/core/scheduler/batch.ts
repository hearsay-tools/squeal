import { compare } from "../fs/index.js";
import { ancestorListings } from "../keys/index.js";
import { type BatchDiff, commitBatch, diffBatch, statCandidates } from "../revision/index.js";
import type { CandidateBatch, RelativePath, Revision } from "../types/index.js";
import type { SchedulerContext } from "./context.js";
import type { Ledger } from "./ledger.js";
import { type ContentRekey, rekeyContent } from "./revision.js";
import { touchedUnchanged } from "./stability.js";

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
 * of its own (review S8, N3). Every reconciliation pass lists the ignored
 * declared inputs no watch reports yet beside its own changes (004-44).
 *
 * `touched` is what no revision names (task 001-159): the paths written
 * since they were hashed whose bytes ended as they were, a revert and its
 * restore in one batch among them.
 */
export async function reconcileBatch(
  context: SchedulerContext,
  ledger: Ledger,
  batch: CandidateBatch,
): Promise<{
  applied: { revision: Revision; content: ContentRekey } | null;
  touched: RelativePath[];
}> {
  const { keys, hasher, store, worktreeId } = context;
  let diff = await diffBatch(batch, keys.cache, hasher);
  const ignored = new Set<RelativePath>();
  if (batch.trigger !== "watch") {
    for (const path of await keys.ignoredCandidates()) ignored.add(path);
    const moved = diff.changes.length === 0 ? await keys.lockfileCandidates() : [];
    diff = await diffBeside(context, diff, batch, [...moved, ...ignored]);
  }
  const head = diff.changes.length > 0 ? await context.head() : null;
  // The ignored inputs key slow results, not transforms: no touch of the runner (004-44).
  const touched = touchedUnchanged(diff, keys.cache).filter((path) => !ignored.has(path));
  const applied = store.transaction(() => {
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
      ledger.refineChanges?.add(change.path);
      // An add or delete moves the listings of its directories (task 001-132).
      const structural = change.oldHash === null || change.newHash === null;
      const listings = structural ? [...ancestorListings(change.path)] : [];
      for (const changes of ledger.tierChanges) {
        changes.add(change.path);
        for (const listing of listings) changes.add(listing);
      }
    }
    const content = rekeyContent(context, ledger, revision);
    ledger.commit();
    return { revision, content };
  });
  return { applied, touched };
}

/**
 * `diff` with the content changes and cache updates of `paths` beyond the
 * batch's own, both kept: a pass that found a source change still lists what
 * no watch reports (reviews/wave-4.6.md B1).
 */
async function diffBeside(
  context: SchedulerContext,
  diff: BatchDiff,
  batch: CandidateBatch,
  paths: readonly RelativePath[],
): Promise<BatchDiff> {
  const own = new Set(batch.paths.map((candidate) => candidate.path));
  const beside = paths.filter((path) => !own.has(path));
  if (beside.length === 0) return diff;
  const { keys, hasher } = context;
  const candidates = await statCandidates(beside, hasher);
  const more = await diffBatch({ trigger: batch.trigger, paths: candidates }, keys.cache, hasher);
  return {
    trigger: diff.trigger,
    changes: [...diff.changes, ...more.changes].sort((a, b) => compare(a.path, b.path)),
    updates: [...diff.updates, ...more.updates],
  };
}
