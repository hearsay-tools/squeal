import { compare, mapConcurrent } from "../fs/index.js";
import {
  type CacheUpdate,
  type Hasher,
  isRacy,
  isUnknownStat,
  type StatCache,
  sameStat,
  unknownStat,
} from "../hash/index.js";
import type {
  CandidateBatch,
  CandidatePath,
  CommitSha,
  EpochMs,
  FileChange,
  FileHash,
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
  /** The unmerged paths the same `git status` listed (row 011-72); absent when not read. */
  readonly unmerged?: readonly RelativePath[];
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
 * watcher (or `statCandidates`) with the one stat definition of `FileStat`.
 * ctime is compared too (D3 stat cache). A racy entry is re-hashed even with
 * an equal stat. A path with no file is marked known absent in the cache,
 * even when it was never cached. Changes are sorted by path, each path once;
 * a repeated path keeps its last stat.
 *
 * Row 011-204 (task 011-203): a hash is stored only beside a stat taken
 * before its read and one taken after it that agree (`readSettled`), and its
 * change is reported in this batch. A file gone by a read or its stat is
 * absent.
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
    const trusted = cached !== undefined && !isUnknownStat(cached) && !cache.isRacy(path);
    if (stat && trusted && sameStat(cached, stat)) return null;
    // The file can vanish between the watcher's stat and a read: then it is absent.
    return { path, cached, read: stat ? await readSettled(path, stat, hasher) : null };
  });

  const changes: FileChange[] = [];
  const updates: CacheUpdate[] = [];
  for (const entry of observed) {
    if (!entry) continue;
    const { path, cached, read } = entry;
    if (!read) {
      if (cached) changes.push({ path, oldHash: cached.hash, newHash: null });
      if (cache.hashOf(path) !== null) updates.push({ kind: "delete", path });
      continue;
    }
    const { hash, stat } = read;
    const record: FileHashRecord = {
      path,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      size: stat.size,
      inode: stat.inode,
      hash,
    };
    updates.push({ kind: "set", record, racy: isRacy(stat, read.hashedAt) });
    if (cached?.hash !== hash) changes.push({ path, oldHash: cached?.hash ?? null, newHash: hash });
  }
  return { changes, updates };
}

/** The most reads `readSettled` makes of one file. */
const SETTLE_READS = 3;

/** A file's hash, the stat to store it with, and when its read began. */
interface SettledRead {
  readonly hash: FileHash;
  readonly stat: FileStat;
  readonly hashedAt: EpochMs;
}

/**
 * Row 011-204 (review 0.1.310-r2 N1): reads `path` until the stat before a
 * read and the stat after it agree, starting from `before`, the candidate's
 * stat. The hash is stored with that stat: from before a write the read saw,
 * a stat would make the write's own batch see a touch (task 001-159); from
 * after a write it did not see, the write would be lost (review 0.1.310 B1).
 * When they differ, the later stat is the next read's "before". After
 * `SETTLE_READS` reads that never agree, the hash is stored with
 * `unknownStat`. `null` when the file is gone.
 */
async function readSettled(
  path: RelativePath,
  before: FileStat,
  hasher: Hasher,
): Promise<SettledRead | null> {
  let prior = before;
  for (let reads = 1; ; reads++) {
    const hashedAt = hasher.now();
    const hash = await hasher.hash(path);
    const after = hash === null ? null : await hasher.stat(path);
    if (hash === null || after === null) return null;
    if (sameStat(prior, after)) return { hash, stat: after, hashedAt };
    if (reads === SETTLE_READS) return { hash, stat: unknownStat(after), hashedAt };
    prior = after;
  }
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
