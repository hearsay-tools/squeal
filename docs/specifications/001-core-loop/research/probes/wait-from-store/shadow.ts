// Throwaway probe for research/wait-from-store.md (task 001-256). Not product code.
//
// A prototype of the store record a store-read `status --wait` would need:
// one entry per test file and re-key revision, open or resolved at a commit
// sequence number, written inside the scheduler's commit transaction. It is
// fed by wrapping `recordRekeyed` (see `mock.ts`), which `Ledger.commit`
// calls once per commit inside its transaction with what that commit learned
// of each file: its earliest unresolved re-key (`open`) and the latest
// revision that re-keyed it (`moved`).
import { testFileId } from "../../../../../../src/core/keys/index.js";
import type { RekeyedMark } from "../../../../../../src/core/scheduler/rekeyed-record.js";
import {
  type RekeyedTestFile,
  type RevisionNumber,
  refinedMetaKey,
  type Store,
  type WorktreeId,
} from "../../../../../../src/core/types/index.js";

/** Resolved at commit `seq`, at time `at`; `null` while open. */
type Entry = { seq: number; at: number } | null;

interface Row {
  /** Commits recorded so far: a wait reads it beside its start view. */
  seq: number;
  /** When a commit first found the refined revision at the current one; `null` while behind. */
  caughtUpAt?: number | null;
  /** The latest `seq` of a resolved entry a prune dropped. */
  dropped: number;
  /** testFileId -> revision -> entry. */
  files: Record<string, Record<string, Entry>>;
}

export const SHADOW = {
  /** Age past which a resolved entry is pruned at the next commit (`G`). */
  retentionMs: 60 * 60_000,
  /** The commit clock; probes shift it to stand for an hour passing. */
  now: () => Date.now(),
  /** Control: keep one entry per file (its latest), as `open`/`last` does today. */
  perFile: false,
  /** Control: name only open entries, as a record with no resolve time can. */
  openOnly: false,
  /** Control: a move to a revision already resolved leaves it resolved. */
  noReopen: false,
  /** How long refinement must have been caught up before a commit prunes. */
  graceMs: 60_000,
  /** Control: prune by age alone, while a runner part is outstanding too. */
  ageOnly: false,
};

const key = (worktreeId: WorktreeId) => `rekeyed2.${worktreeId}`;

export function readShadow(store: Store, worktreeId: WorktreeId): Row {
  const raw = store.meta.get(key(worktreeId));
  return raw === null ? { seq: 0, dropped: 0, files: {} } : (JSON.parse(raw) as Row);
}

/** One commit: called inside the scheduler's transaction, after the real record. */
export function recordShadow(
  store: Store,
  worktreeId: WorktreeId,
  marks: readonly RekeyedMark[],
  removed: readonly string[],
): void {
  const row = readShadow(store, worktreeId);
  const seq = row.seq + 1;
  const at = SHADOW.now();
  row.seq = seq;
  for (const id of removed) delete row.files[id];
  for (const { id, open, moved } of marks) {
    let entries = row.files[id] ?? {};
    if (SHADOW.perFile && moved !== null) entries = {};
    if (open === null) {
      // A result, or `unknown`, at the file's key: every open move is resolved now.
      for (const revision of Object.keys(entries)) entries[revision] ??= { seq, at };
      if (moved !== null) entries[String(moved)] = { seq, at };
    } else {
      // Owed from `open`; a move back to a resolved revision is owed again (13k B1).
      if (SHADOW.noReopen) {
        entries[String(open)] ??= null;
        if (moved !== null) entries[String(moved)] ??= null;
      } else {
        entries[String(open)] = null;
        if (moved !== null) entries[String(moved)] = null;
      }
    }
    if (Object.keys(entries).length > 0) row.files[id] = entries;
  }
  // Read before this commit's own refined revision is written, as `Ledger.commit` orders it.
  const refined = Number(store.meta.get(refinedMetaKey(worktreeId)) ?? Number.NaN);
  const current = store.revisions.latest(worktreeId)?.number ?? 0;
  const caughtUp = !Number.isInteger(refined) || refined >= current;
  row.caughtUpAt = caughtUp ? (row.caughtUpAt ?? at) : null;
  if (SHADOW.ageOnly || (row.caughtUpAt != null && at - row.caughtUpAt >= SHADOW.graceMs)) {
    prune(row, at);
  }
  store.meta.set(key(worktreeId), JSON.stringify(row));
}

/** Drops resolved entries older than the retention; records the latest dropped. */
function prune(row: Row, now: number): void {
  for (const [id, entries] of Object.entries(row.files)) {
    for (const [revision, entry] of Object.entries(entries)) {
      if (entry === null || entry.at >= now - SHADOW.retentionMs) continue;
      delete entries[revision];
      row.dropped = Math.max(row.dropped, entry.seq);
    }
    if (Object.keys(entries).length === 0) delete row.files[id];
  }
}

/** Synthetic resolved entries, as a flood of later cached discharges would leave (13q). */
export function floodShadow(
  store: Store,
  worktreeId: WorktreeId,
  count: number,
  revision: RevisionNumber,
): void {
  store.transaction(() => {
    const row = readShadow(store, worktreeId);
    row.seq += 1;
    for (let n = 0; n < count; n++) {
      row.files[`later-${n}`] = { [String(revision)]: { seq: row.seq, at: SHADOW.now() } };
    }
    store.meta.set(key(worktreeId), JSON.stringify(row));
  });
}

/** An empty commit at the shadow clock: the next commit that prunes. */
export function commitShadow(store: Store, worktreeId: WorktreeId): void {
  store.transaction(() => recordShadow(store, worktreeId, [], []));
}

export type StoreAnswer =
  | { readonly state: "refining" }
  | { readonly state: "incomplete" }
  | { readonly state: "answered"; readonly rekeyed: readonly RekeyedTestFile[] };

/**
 * The store-read answer, in one read transaction: nothing until the store's
 * refined revision reached `upTo`; then every entry at a revision in
 * `(after, upTo]` that is open or was resolved after the wait's start
 * (`sinceSeq`); `incomplete` when a prune dropped one resolved after it.
 */
export function answerFromStore(
  store: Store,
  worktreeId: WorktreeId,
  after: RevisionNumber,
  upTo: RevisionNumber,
  sinceSeq: number,
): StoreAnswer {
  return store.transaction(() => {
    const refined = Number(store.meta.get(refinedMetaKey(worktreeId)) ?? Number.NaN);
    if (Number.isInteger(refined) && refined < upTo) return { state: "refining" } as const;
    const row = readShadow(store, worktreeId);
    if (row.dropped > sinceSeq) return { state: "incomplete" } as const;
    const refs = new Map(
      store.testFileKeys.list(worktreeId).map((k) => [testFileId(k.testFile), k.testFile]),
    );
    const rekeyed: RekeyedTestFile[] = [];
    for (const [id, entries] of Object.entries(row.files)) {
      const testFile = refs.get(id);
      if (testFile === undefined) continue;
      for (const [raw, entry] of Object.entries(entries)) {
        const revision = Number(raw);
        if (revision <= after || revision > upTo) continue;
        if (entry === null) rekeyed.push({ testFile, revision });
        else if (!SHADOW.openOnly && entry.seq > sinceSeq) rekeyed.push({ testFile, revision, resolved: true });
      }
    }
    return { state: "answered", rekeyed } as const;
  });
}
