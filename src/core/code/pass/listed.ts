import { compare } from "../../fs/index.js";
import {
  type FileHash,
  type ListingFact,
  parseListing,
  type RelativePath,
  type RevisionNumber,
  type WorktreeId,
} from "../../types/index.js";
import type { CodeMetaRepo, CodeStore } from "../store/index.js";
import type { Entry } from "./blobs.js";
import { committedPaths } from "./head.js";
import { checkKey, type judge } from "./judge.js";
import type { PassContext } from "./pass.js";
import type { PassSource } from "./types.js";

/*
 * Spec 015 D1 and D2 (row 015-52, review 0.1.315 B1 and B2): a test file is
 * any file a runner lists, and a revision can bring one before a listing
 * that holds it. The scheduler records each listing that did not fail
 * (`listingMetaKey`) and nudges the pass after it (`onListed`). The pass
 * holds a file it never counted that a revision after the listed one
 * changed, or any file it never counted while no listing is recorded.
 * While a file waits, the removals an edit pass would make wait with it, so
 * a move into that file is one move when it is read, and a recount waits
 * for its listing (`plan.ts`). A counted file that a runner now lists
 * leaves with nothing told.
 */

/** Code meta `listed:<worktreeId>`. */
const listedKey = (worktreeId: WorktreeId) => `listed:${worktreeId}`;

/** What the last pass read of the listing, and what waits for the next one. */
export interface ListedRecord {
  /** `Listing.fact` at that pass. */
  readonly listed: ListingFact | null;
  /**
   * While files wait for their listing, or removals wait with them: the
   * revision their changes came after. `null` when nothing waits.
   */
  readonly since: RevisionNumber | null;
  /** Paths whose removed functions wait (B1); each pass reads them again. */
  readonly deferred: readonly RelativePath[];
}

/** What a pass reads of the runners' listing. */
export interface Listing {
  /** `PassSource.listing`, its revision at most the latest; `null` when none is recorded. */
  readonly fact: ListingFact | null;
  /** Read after `fact`, so they hold each listing up to it. */
  readonly tests: readonly RelativePath[];
  /** The last pass's record. */
  readonly seen: ListedRecord | null;
}

export function readListing(
  store: Pick<CodeStore, "meta">,
  worktreeId: WorktreeId,
  source: Pick<PassSource, "listing" | "testFiles">,
  latest: RevisionNumber,
): Listing {
  const fact = source.listing();
  return {
    fact: fact === null ? null : { ...fact, revision: Math.min(fact.revision, latest) },
    tests: source.testFiles(),
    seen: readListed(store.meta, worktreeId),
  };
}

/** A listing came since the last pass: a counted file it lists leaves, and waiting files are read again. */
export function listingMoved({ fact, seen }: Listing): boolean {
  if (seen === null) return true;
  const { listed } = seen;
  if (listed === null || fact === null) return listed !== fact;
  return listed.revision !== fact.revision || listed.count !== fact.count;
}

/** `null` when no pass of this version wrote the record, or it does not read. */
export function readListed(meta: CodeMetaRepo, worktreeId: WorktreeId): ListedRecord | null {
  const text = meta.get(listedKey(worktreeId));
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null) return null;
    const { listed, since, deferred } = value as Record<string, unknown>;
    const fact = listed === null ? null : parseListing(JSON.stringify(listed));
    if (listed !== null && fact === null) return null;
    if (since !== null && typeof since !== "number") return null;
    if (!Array.isArray(deferred) || !deferred.every((p) => typeof p === "string")) return null;
    return { listed: fact, since, deferred };
  } catch {
    return null;
  }
}

/** Writes only what changes. */
export function writeListed(
  meta: CodeMetaRepo,
  worktreeId: WorktreeId,
  record: ListedRecord,
): void {
  const text = JSON.stringify(record);
  if (meta.get(listedKey(worktreeId)) !== text) meta.set(listedKey(worktreeId), text);
}

/**
 * The record a pass writes: `held` files wait, and `deferred` paths'
 * removals wait with them. Only an edit pass holds (a recount waits), so
 * `since` is its cursor's revision.
 */
export function nextRecord(
  { fact, seen }: Listing,
  since: RevisionNumber | null,
  held: number,
  deferred: readonly RelativePath[],
): ListedRecord {
  if (held === 0 && deferred.length === 0) return { listed: fact, since: null, deferred: [] };
  const anchor = Math.min(fact?.revision ?? Number.POSITIVE_INFINITY, since ?? 0);
  return {
    listed: fact,
    since: Math.min(seen?.since ?? anchor, anchor),
    deferred: [...new Set(deferred)].sort(compare),
  };
}

/** What waits from the last pass: files changed after its `since` with no files row, and its deferred paths. */
export function waitingPaths(
  store: Pick<CodeStore, "files">,
  worktreeId: WorktreeId,
  source: Pick<PassSource, "changedPaths">,
  seen: ListedRecord | null,
  upTo: RevisionNumber,
): RelativePath[] {
  if (seen === null || seen.since === null) return [];
  const changed = source.changedPaths(seen.since, upTo);
  const rows = new Set(store.files.list(worktreeId, changed).map((f) => f.path));
  return [...new Set([...changed.filter((path) => !rows.has(path)), ...seen.deferred])];
}

/**
 * `entries` without the files that wait for their listing: no files row,
 * so never counted, and changed by a revision after the listed one, or
 * any such file while no listing is recorded. A file counted before goes
 * on: its edit is not held back by the runner.
 */
export function holdUnlisted(
  store: Pick<CodeStore, "files">,
  worktreeId: WorktreeId,
  source: Pick<PassSource, "changedPaths">,
  entries: readonly Entry[],
  { fact }: Listing,
  latest: RevisionNumber,
): { readonly entries: readonly Entry[]; readonly held: number } {
  if (fact !== null && fact.revision >= latest) return { entries, held: 0 };
  const fresh = fact === null ? null : new Set(source.changedPaths(fact.revision, latest));
  const candidates = entries.flatMap((e) =>
    e.kind !== "gone" && (fresh === null || fresh.has(e.path)) ? [e.path] : [],
  );
  if (candidates.length === 0) return { entries, held: 0 };
  const rows = new Set(store.files.list(worktreeId, candidates).map((f) => f.path));
  const held = new Set(candidates.filter((path) => !rows.has(path)));
  return { entries: entries.filter((e) => !held.has(e.path)), held: held.size };
}

type Judged = ReturnType<typeof judge>;

/**
 * B1: while a file still waits for its listing, the removals of an edit
 * pass's `judged` wait with it. Their states, views and history stay and no
 * transition tells them, so a move into the waiting file pairs by body hash
 * once it is read (D2). A `seeds` path's removal goes on: it tells nothing.
 */
export function holdRemovals(
  judged: Judged,
  waiting: boolean,
  seeds: ReadonlySet<RelativePath>,
): { readonly judged: Judged; readonly deferred: readonly RelativePath[] } {
  const held = waiting ? judged.removed.filter((check) => !seeds.has(check.path)) : [];
  if (held.length === 0) return { judged, deferred: [] };
  const keys = new Set(held.map(checkKey));
  return {
    judged: {
      ...judged,
      removed: judged.removed.filter((check) => !keys.has(checkKey(check))),
      transitions: judged.transitions.filter(
        (t) => t.kind !== "removed" || !keys.has(checkKey(t.check)),
      ),
    },
    deferred: held.map((check) => check.path),
  };
}

/** The revision a pass reads its edits after: the cursor's, or before it what waits. */
export const changesFrom = ({ seen }: Listing, cursor: RevisionNumber): RevisionNumber =>
  seen?.since == null ? cursor : Math.min(cursor, seen.since);

/**
 * `committedPaths` for an edit pass: a waiting path read again asks from
 * `held`, the revision its own change came after, so a pull that brought
 * it is still git's (015-19, 015-38); the other files from `since`.
 */
export async function committedWithHeld(
  ctx: Pick<PassContext, "root" | "source" | "log">,
  range: {
    readonly since: RevisionNumber;
    readonly held: RevisionNumber;
    readonly upTo: RevisionNumber;
  },
  files: readonly { readonly path: RelativePath; readonly blob: FileHash | null }[],
  late: ReadonlySet<RelativePath>,
): Promise<Set<RelativePath>> {
  const waited = files.filter((f) => late.has(f.path));
  const committed = await committedPaths(
    ctx,
    range.since,
    range.upTo,
    files.filter((f) => !late.has(f.path)),
  );
  if (waited.length === 0) return committed;
  for (const path of await committedPaths(ctx, range.held, range.upTo, waited)) committed.add(path);
  return committed;
}
