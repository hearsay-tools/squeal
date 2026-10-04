import type {
  FileHashRecord,
  FileHashRepo,
  RelativePath,
  Revision,
  RevisionNumber,
  RevisionRepo,
  WorktreeId,
} from "../../src/core/types/index.js";

/** In-memory `FileHashRepo`. */
export class FakeFileHashRepo implements FileHashRepo {
  readonly rows = new Map<WorktreeId, Map<RelativePath, FileHashRecord>>();
  upserts = 0;
  removes = 0;

  private table(worktreeId: WorktreeId): Map<RelativePath, FileHashRecord> {
    let table = this.rows.get(worktreeId);
    if (!table) {
      table = new Map();
      this.rows.set(worktreeId, table);
    }
    return table;
  }
  get(worktreeId: WorktreeId, path: RelativePath): FileHashRecord | null {
    return this.table(worktreeId).get(path) ?? null;
  }
  list(worktreeId: WorktreeId): readonly FileHashRecord[] {
    return [...this.table(worktreeId).values()];
  }
  upsertMany(worktreeId: WorktreeId, records: readonly FileHashRecord[]): void {
    this.upserts += records.length;
    for (const r of records) this.table(worktreeId).set(r.path, r);
  }
  removeMany(worktreeId: WorktreeId, paths: readonly RelativePath[]): void {
    this.removes += paths.length;
    for (const p of paths) this.table(worktreeId).delete(p);
  }
}

/** In-memory `RevisionRepo`. */
export class FakeRevisionRepo implements RevisionRepo {
  readonly rows: Revision[] = [];

  append(revision: Omit<Revision, "number">): Revision {
    const number = (this.latest(revision.worktreeId)?.number ?? 0) + 1;
    const stored: Revision = { ...revision, number };
    this.rows.push(stored);
    return stored;
  }
  latest(worktreeId: WorktreeId): Revision | null {
    return this.rows.filter((r) => r.worktreeId === worktreeId).at(-1) ?? null;
  }
  get(worktreeId: WorktreeId, number: RevisionNumber): Revision | null {
    return this.rows.find((r) => r.worktreeId === worktreeId && r.number === number) ?? null;
  }
}

/**
 * The parts of `Store` reconciliation writes to, over in-memory repos. A
 * transaction that throws rolls both tables back, like `BEGIN IMMEDIATE`.
 */
export class FakeStore {
  readonly revisions = new FakeRevisionRepo();
  readonly fileHashes = new FakeFileHashRepo();
  transactions = 0;

  transaction<T>(fn: () => T): T {
    this.transactions++;
    const revisions = [...this.revisions.rows];
    const fileHashes = new Map([...this.fileHashes.rows].map(([id, rows]) => [id, new Map(rows)]));
    try {
      return fn();
    } catch (error) {
      this.revisions.rows.splice(0, Infinity, ...revisions);
      this.fileHashes.rows.clear();
      for (const [id, rows] of fileHashes) this.fileHashes.rows.set(id, rows);
      throw error;
    }
  }
}
