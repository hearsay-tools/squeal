import {
  type CacheUpdate,
  type Hasher,
  isRacy,
  mapConcurrent,
  type StatCache,
  sameStat,
} from "../hash/index.js";
import { compare } from "../keys/closure.js";
import type {
  CandidateBatch,
  CandidatePath,
  CommitSha,
  EpochMs,
  FileChange,
  FileHashRecord,
  FileHashRepo,
  FileStat,
  RelativePath,
  Revision,
  RevisionRepo,
  RevisionTrigger,
  Store,
  WorktreeId,
} from "../types/index.js";

/** `HEAD` and the dirty flag recorded with a revision. */
export interface HeadState {
  readonly head: CommitSha;
  readonly dirty: boolean;
}

/** What one candidate batch changed, computed by `diffBatch` and not yet stored. */
export interface BatchDiff {
  readonly trigger: RevisionTrigger;
  /** Sorted by path, each path once. Empty when nothing changed content. */
  readonly changes: readonly FileChange[];
  /** Stat cache updates, written with the revision by `commitBatch`. */
  readonly updates: readonly CacheUpdate[];
}

/** What `commitBatch` writes to. Pass the repos of the store whose transaction it runs in. */
export interface CommitContext {
  readonly worktreeId: WorktreeId;
  /** Required when the diff has changes; read it between `diffBatch` and the transaction. */
  readonly head: HeadState | null;
  readonly revisions: RevisionRepo;
  readonly fileHashes: FileHashRepo;
  /** Clock for `createdAt`. Defaults to `Date.now`. */
  readonly now?: () => EpochMs;
}

/** What `reconcile` needs to turn a batch into a stored revision. */
export interface ReconcileContext {
  readonly worktreeId: WorktreeId;
  readonly store: Pick<Store, "transaction" | "revisions" | "fileHashes">;
  /** `HEAD` and the dirty flag. Called only when a revision is created. */
  head(): Promise<HeadState>;
  /** Clock for `createdAt`. Defaults to `Date.now`. */
  now?(): EpochMs;
}

/**
 * `lstat`s `paths` once each, for callers with paths and no watcher batch,
 * such as the stability check after a run. Sorted, unique.
 */
export async function statCandidates(
  paths: Iterable<RelativePath>,
  hasher: Hasher,
): Promise<CandidatePath[]> {
  const sorted = [...new Set(paths)].sort(compare);
  const stats = await mapConcurrent(sorted, (path) => hasher.stat(path));
  return sorted.map((path, i) => ({ path, stat: stats[i] ?? null }));
}

/**
 * The content changes among `candidates`, and the stat cache updates that go
 * with them. Does not touch the cache.
 *
 * Spec 001 D2: "every reported path is re-stat'ed and, if `mtime`, `size` or
 * inode changed, re-hashed with the git blob hash. Paths whose hash is
 * unchanged are dropped." The re-stat is the candidate's `stat`, taken by the
 * watcher (or `statCandidates`) with the one stat definition of `FileStat`;
 * no path is stat'ed again. ctime is compared too (D3 stat cache). A racy
 * entry is re-hashed even with an equal stat. A path with no file is marked
 * known absent in the cache, even when it was never cached. Changes are
 * sorted by path, each path once; a repeated path keeps its last stat.
 */
export async function diffCandidates(
  candidates: Iterable<CandidatePath>,
  cache: StatCache,
  hasher: Hasher,
): Promise<{ changes: FileChange[]; updates: CacheUpdate[] }> {
  const statOf = new Map<RelativePath, FileStat | null>();
  for (const candidate of candidates) statOf.set(candidate.path, candidate.stat);
  const paths = [...statOf.keys()].sort(compare);
  const observed = await mapConcurrent(paths, async (path) => {
    const stat = statOf.get(path) ?? null;
    const cached = cache.get(path);
    if (stat && cached && sameStat(cached, stat) && !cache.isRacy(path)) return null;
    const hashedAt = hasher.now();
    // The file can vanish between the watcher's stat and this read: then it is absent.
    const hash = stat ? await hasher.hash(path) : null;
    return { path, cached, stat, hash, hashedAt };
  });

  const changes: FileChange[] = [];
  const updates: CacheUpdate[] = [];
  for (const entry of observed) {
    if (!entry) continue;
    const { path, cached, stat, hash, hashedAt } = entry;
    if (!stat || hash === null) {
      if (cached) changes.push({ path, oldHash: cached.hash, newHash: null });
      if (cache.hashOf(path) !== null) updates.push({ kind: "delete", path });
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

/** Step 1 of reconciliation: reads and hashes, stores nothing. See `reconcile`. */
export async function diffBatch(
  batch: CandidateBatch,
  cache: StatCache,
  hasher: Hasher,
): Promise<BatchDiff> {
  return { trigger: batch.trigger, ...(await diffCandidates(batch.paths, cache, hasher)) };
}

/**
 * Step 2 of reconciliation: appends the revision, if any, and writes the stat
 * cache. Synchronous; call it inside `store.transaction` and make it the last
 * write there. The in-memory cache changes only after every write succeeded,
 * so a throw leaves it as it was, and the rolled-back change is detected
 * again by the next reconciliation. Returns `null` when nothing changed.
 */
export function commitBatch(
  diff: BatchDiff,
  cache: StatCache,
  context: CommitContext,
): Revision | null {
  let revision: Revision | null = null;
  if (diff.changes.length > 0) {
    if (!context.head) {
      throw new Error(
        `squeal: ${diff.changes.length} changes in worktree ${context.worktreeId} need HEAD to create a revision`,
      );
    }
    revision = context.revisions.append({
      worktreeId: context.worktreeId,
      createdAt: context.now?.() ?? Date.now(),
      head: context.head.head,
      dirty: context.head.dirty,
      trigger: diff.trigger,
      changes: diff.changes,
    });
  }
  cache.flush(context.fileHashes, context.worktreeId, diff.updates);
  return revision;
}

/**
 * Reconciles one candidate batch into at most one revision.
 *
 * Spec 001 D2: "If anything remains, the worktree's **revision** increments
 * by one and the revision records the changed paths with old and new hashes,
 * the time, `HEAD`, and whether the tree is dirty. A revision is never created
 * by a touch or a no-op save." Returns `null` when no content changed.
 *
 * Three steps, so the async work happens before the synchronous transaction:
 *
 * 1. `diffBatch`: hash what the batch's stats say may have changed.
 * 2. `context.head()`, only when there are changes.
 * 3. `store.transaction(() => commitBatch(...))`: append the revision and
 *    flush the stat cache together. A crash cannot store one without the
 *    other, so a restart never reports the same change as a second revision.
 *
 * Callers that need more writes in the same transaction run the steps
 * themselves. Calls on one cache must not overlap, and nothing else may
 * change the cache between steps 1 and 3.
 */
export async function reconcile(
  batch: CandidateBatch,
  cache: StatCache,
  hasher: Hasher,
  context: ReconcileContext,
): Promise<Revision | null> {
  const diff = await diffBatch(batch, cache, hasher);
  const head = diff.changes.length > 0 ? await context.head() : null;
  const { store } = context;
  return store.transaction(() =>
    commitBatch(diff, cache, {
      worktreeId: context.worktreeId,
      head,
      revisions: store.revisions,
      fileHashes: store.fileHashes,
      now: () => context.now?.() ?? Date.now(),
    }),
  );
}
