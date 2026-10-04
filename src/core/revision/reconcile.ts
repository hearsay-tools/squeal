import { type Hasher, isRacy, mapConcurrent, type StatCache, sameStat } from "../hash/index.js";
import { compare } from "../keys/closure.js";
import type {
  CommitSha,
  EpochMs,
  FileChange,
  FileHashRecord,
  RelativePath,
  Revision,
  RevisionRepo,
  RevisionTrigger,
  WorktreeId,
} from "../types/index.js";

/** What `reconcile` needs to turn changes into a stored revision. */
export interface ReconcileContext {
  readonly worktreeId: WorktreeId;
  readonly trigger: RevisionTrigger;
  /** Assigns the revision number. */
  readonly revisions: RevisionRepo;
  /** `HEAD` and the dirty flag. Called only when a revision is created. */
  head(): Promise<{ readonly head: CommitSha; readonly dirty: boolean }>;
  /** Clock for `createdAt`. Defaults to `Date.now`. */
  now?(): EpochMs;
}

/** The stat cache updates of one reconciliation, applied once its revision is stored. */
export type CacheUpdate =
  | { readonly kind: "set"; readonly record: FileHashRecord; readonly racy: boolean }
  | { readonly kind: "delete"; readonly path: RelativePath };

/**
 * The content changes among `candidates`, and the stat cache updates that go
 * with them. Does not touch the cache.
 *
 * Spec 001 D2: "every reported path is re-stat'ed and, if `mtime`, `size` or
 * inode changed, re-hashed with the git blob hash. Paths whose hash is
 * unchanged are dropped." ctime is compared too (D3 stat cache). A racy entry
 * is re-hashed even with an equal stat. Changes are sorted by path, each path
 * once. A path that is not a regular file counts as absent.
 */
export async function diffCandidates(
  candidates: Iterable<RelativePath>,
  cache: StatCache,
  hasher: Hasher,
): Promise<{ changes: FileChange[]; updates: CacheUpdate[] }> {
  const paths = [...new Set(candidates)].sort(compare);
  const observed = await mapConcurrent(paths, async (path) => {
    const cached = cache.get(path);
    const stat = await hasher.stat(path);
    if (stat && cached && sameStat(cached, stat) && !cache.isRacy(path)) return null;
    const hashedAt = hasher.now();
    const hash = stat ? await hasher.hash(path) : null;
    return { path, cached, stat: hash === null ? null : stat, hash, hashedAt };
  });

  const changes: FileChange[] = [];
  const updates: CacheUpdate[] = [];
  for (const entry of observed) {
    if (!entry) continue;
    const { path, cached, stat, hash, hashedAt } = entry;
    if (!stat || hash === null) {
      if (!cached) continue;
      changes.push({ path, oldHash: cached.hash, newHash: null });
      updates.push({ kind: "delete", path });
      continue;
    }
    const record: FileHashRecord = {
      path,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      size: stat.size,
      inode: stat.inode,
      hash,
    };
    updates.push({ kind: "set", record, racy: isRacy(stat, hashedAt) });
    if (cached?.hash !== hash) changes.push({ path, oldHash: cached?.hash ?? null, newHash: hash });
  }
  return { changes, updates };
}

/**
 * Reconciles watcher hints into at most one revision.
 *
 * Spec 001 D2: "If anything remains, the worktree's **revision** increments
 * by one and the revision records the changed paths with old and new hashes,
 * the time, `HEAD`, and whether the tree is dirty. A revision is never created
 * by a touch or a no-op save." Returns `null` when no content changed.
 *
 * The stat cache is updated only after the revision is stored, so a failed
 * append is detected again by the next reconciliation. Persisting the cache
 * (`StatCache.flush`) is the caller's, ideally in the transaction that appends
 * the revision. Calls on one cache must not overlap.
 */
export async function reconcile(
  candidates: Iterable<RelativePath>,
  cache: StatCache,
  hasher: Hasher,
  context: ReconcileContext,
): Promise<Revision | null> {
  const { changes, updates } = await diffCandidates(candidates, cache, hasher);
  let revision: Revision | null = null;
  if (changes.length > 0) {
    const { head, dirty } = await context.head();
    revision = context.revisions.append({
      worktreeId: context.worktreeId,
      createdAt: context.now?.() ?? Date.now(),
      head,
      dirty,
      trigger: context.trigger,
      changes,
    });
  }
  for (const update of updates) {
    if (update.kind === "delete") cache.delete(update.path);
    else cache.set(update.record, { racy: update.racy });
  }
  return revision;
}
