import type {
  EpochMs,
  FileHash,
  FileHashRecord,
  FileHashRepo,
  FileStat,
  RelativePath,
  WorktreeId,
} from "../types/index.js";

/**
 * How close to the time of hashing a file's mtime may be before the stat is
 * not trusted to show the next write. A second write of the same size inside
 * one filesystem timestamp tick leaves the stat unchanged; git calls this
 * "racy". Linux filesystems tick in a few milliseconds, FAT and HFS+ in one or
 * two seconds.
 */
export const RACY_WINDOW_MS = 2_000;

/** Spec 001 D3: a cache entry is reused only while all four stat fields are equal. */
export function sameStat(a: FileStat, b: FileStat): boolean {
  return (
    a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.size === b.size && a.inode === b.inode
  );
}

/** True when `stat` was taken so close to `hashedAt` that a same-size rewrite could hide behind it. */
export function isRacy(stat: FileStat, hashedAt: EpochMs): boolean {
  return hashedAt - stat.mtimeMs < RACY_WINDOW_MS;
}

/**
 * In-memory stat cache of one worktree, persisted through `FileHashRepo`.
 *
 * Spec 001 D3: "a stat cache `path -> (mtime, ctime, size, inode, hash)`".
 * Entries marked racy are re-hashed the next time they are reconciled, even if
 * their stat is unchanged. The mark is in-memory only, so entries loaded from
 * the store are trusted. That is wrong only if a daemon hashed a file and then
 * stopped within one timestamp tick of a same-size rewrite.
 *
 * `hashOf` is tri-state (`HashSource`). A path is known absent once a
 * reconciliation or a seed looked for it and found no file; that mark is
 * in-memory only, because `FileHashRepo` stores files, not absences. Every
 * other path without an entry is untracked: nothing watches it, so its hash
 * is unknown. Spec 001 D2: "A test file is never keyed while any of its
 * closure paths is untracked by the stat cache."
 */
export class StatCache {
  private readonly entries = new Map<RelativePath, FileHashRecord>();
  private readonly absent = new Set<RelativePath>();
  private readonly racy = new Set<RelativePath>();
  private readonly upserted = new Set<RelativePath>();
  private readonly removed = new Set<RelativePath>();

  constructor(records: Iterable<FileHashRecord> = []) {
    for (const record of records) this.entries.set(record.path, record);
  }

  static load(repo: FileHashRepo, worktreeId: WorktreeId): StatCache {
    return new StatCache(repo.list(worktreeId));
  }

  get size(): number {
    return this.entries.size;
  }

  get(path: RelativePath): FileHashRecord | undefined {
    return this.entries.get(path);
  }

  /** The file's hash, `null` when it is known to be absent, `undefined` when untracked. */
  hashOf(path: RelativePath): FileHash | null | undefined {
    const entry = this.entries.get(path);
    if (entry) return entry.hash;
    return this.absent.has(path) ? null : undefined;
  }

  isRacy(path: RelativePath): boolean {
    return this.racy.has(path);
  }

  /** Paths with a file. Known-absent paths are not listed. */
  paths(): IterableIterator<RelativePath> {
    return this.entries.keys();
  }

  set(record: FileHashRecord, options: { racy?: boolean } = {}): void {
    this.entries.set(record.path, record);
    this.absent.delete(record.path);
    if (options.racy) this.racy.add(record.path);
    else this.racy.delete(record.path);
    this.upserted.add(record.path);
    this.removed.delete(record.path);
  }

  /** Records that `path` has no file: drops its entry and marks it known absent. */
  delete(path: RelativePath): void {
    this.absent.add(path);
    if (!this.entries.delete(path)) return;
    this.racy.delete(path);
    this.upserted.delete(path);
    this.removed.add(path);
  }

  /** Writes the entries changed since the last flush or load. */
  flush(repo: FileHashRepo, worktreeId: WorktreeId): void {
    if (this.upserted.size > 0) {
      const records = [...this.upserted].map((path) => this.entries.get(path) as FileHashRecord);
      repo.upsertMany(worktreeId, records);
    }
    if (this.removed.size > 0) repo.removeMany(worktreeId, [...this.removed]);
    this.upserted.clear();
    this.removed.clear();
  }
}
