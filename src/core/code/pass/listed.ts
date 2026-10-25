import type { FileHash, RelativePath, RevisionNumber, WorktreeId } from "../../types/index.js";
import type { CodeMetaRepo, CodeStore } from "../store/index.js";
import type { Entry } from "./blobs.js";
import { committedPaths } from "./head.js";
import type { PassContext } from "./pass.js";
import type { PassSource } from "./types.js";

/*
 * Spec 015 D1 (row 015-52): a test file is any file a runner lists, and a
 * revision can bring one before the runner part that lists it. The pass
 * holds a file it never counted that a revision after the listed one
 * changed, and reads it again at the first pass after that listing, which
 * the scheduler's `onRefined` nudges. A counted file that a runner lists
 * later leaves with nothing told (`pass.ts`).
 */

/** Code meta `listed:<worktreeId>`: the listed revision at the last pass, and whether it held files. */
const listedKey = (worktreeId: WorktreeId) => `listed:${worktreeId}`;

export interface ListedRecord {
  /** `PassSource.listedRevision` when the pass ran. */
  readonly revision: RevisionNumber;
  /** It held files changed after `revision`; the next pass reads them again. */
  readonly held: boolean;
}

/** What a pass reads of the runners' listing. */
export interface Listing {
  /** `PassSource.listedRevision`, at most the latest revision. */
  readonly revision: RevisionNumber;
  /** Read after `revision`, so they hold each listing up to it. */
  readonly tests: readonly RelativePath[];
  /** The last pass's record. */
  readonly seen: ListedRecord | null;
}

export function readListing(
  store: Pick<CodeStore, "meta">,
  worktreeId: WorktreeId,
  source: Pick<PassSource, "listedRevision" | "testFiles">,
  latest: RevisionNumber,
): Listing {
  const revision = Math.min(source.listedRevision(), latest);
  return { revision, tests: source.testFiles(), seen: readListed(store.meta, worktreeId) };
}

/** The listing moved since the last pass: a counted file it lists leaves, and held files are read again. */
export const listingMoved = (listing: Listing): boolean =>
  listing.seen?.revision !== listing.revision;

/** `null` when no pass of this version wrote the record, or it does not read. */
export function readListed(meta: CodeMetaRepo, worktreeId: WorktreeId): ListedRecord | null {
  const text = meta.get(listedKey(worktreeId));
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null) return null;
    const { revision, held } = value as Record<string, unknown>;
    return typeof revision === "number" && typeof held === "boolean" ? { revision, held } : null;
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
  const last = readListed(meta, worktreeId);
  if (last?.revision === record.revision && last.held === record.held) return;
  meta.set(listedKey(worktreeId), JSON.stringify(record));
}

/** The files `seen`'s pass held: changed after its listed revision up to `upTo`, with no files row. */
export function heldPaths(
  store: Pick<CodeStore, "files">,
  worktreeId: WorktreeId,
  source: Pick<PassSource, "changedPaths">,
  seen: ListedRecord | null,
  upTo: RevisionNumber,
): RelativePath[] {
  if (seen === null || !seen.held) return [];
  const changed = source.changedPaths(seen.revision, upTo);
  const rows = new Set(store.files.list(worktreeId, changed).map((f) => f.path));
  return changed.filter((path) => !rows.has(path));
}

/**
 * `entries` without the files that wait for their listing: no files row,
 * so never counted, and changed by a revision after the listed one. A
 * file counted before goes on: its edit is not held back by the runner.
 * `record` is what the pass writes.
 */
export function holdUnlisted(
  store: Pick<CodeStore, "files">,
  worktreeId: WorktreeId,
  source: Pick<PassSource, "changedPaths">,
  entries: readonly Entry[],
  { revision }: Listing,
  latest: RevisionNumber,
): { readonly entries: readonly Entry[]; readonly record: ListedRecord } {
  const none = { entries, record: { revision, held: false } };
  if (revision >= latest) return none;
  const fresh = new Set(source.changedPaths(revision, latest));
  const candidates = entries.flatMap((e) =>
    e.kind !== "gone" && fresh.has(e.path) ? [e.path] : [],
  );
  if (candidates.length === 0) return none;
  const rows = new Set(store.files.list(worktreeId, candidates).map((f) => f.path));
  const held = new Set(candidates.filter((path) => !rows.has(path)));
  return {
    entries: entries.filter((e) => !held.has(e.path)),
    record: { revision, held: held.size > 0 },
  };
}

/** The revision a pass reads its edits after: the cursor's, or the held files' own when it reads them again. */
export function changesFrom(
  { seen }: Listing,
  cursor: RevisionNumber,
  released: ReadonlySet<RelativePath>,
): RevisionNumber {
  return released.size > 0 && seen !== null ? Math.min(cursor, seen.revision) : cursor;
}

/**
 * `committedPaths` for an edit pass: a held file read again asks from
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
  released: ReadonlySet<RelativePath>,
): Promise<Set<RelativePath>> {
  const late = files.filter((f) => released.has(f.path));
  const committed = await committedPaths(
    ctx,
    range.since,
    range.upTo,
    files.filter((f) => !released.has(f.path)),
  );
  if (late.length === 0) return committed;
  for (const path of await committedPaths(ctx, range.held, range.upTo, late)) committed.add(path);
  return committed;
}
