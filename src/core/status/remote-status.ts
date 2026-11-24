import type { WorktreeId } from "../types/common.js";
import type { DaemonNote } from "../types/scheduler.js";
import type { DaemonLiveness, StatusHeader, StatusSnapshot } from "../types/status.js";
import { type Store, worktreeMetaKey } from "../types/store.js";

/*
 * Row 026-20 (lessons D1, D2; spec 026 D12.1, vision principle 2). Two
 * facts of plain `squeal status` that only the daemon's notes held:
 *
 * - `remote`: the remote's one summary line (`summary.ts`), printed as
 *   `Remote: <line>`, present while the daemon's last summary is not empty.
 *   Review 0.1.623 B2: the daemon keeps it in a `meta` row of its own
 *   (`remoteSummary`), not among the notes, whose bounded list would drop
 *   it after `MAX_PERSISTED_NOTES` other notes. An empty summary removes
 *   the row; the worktree's removal removes it too.
 * - `listingFailed`: why the live daemon could not list the test files of
 *   the current revision, such as a remote refused under `whenLost:
 *   "not-run"`, while no test file is listed. Status then says so instead of
 *   "still starting" or "listed no test files". The next revision lists again.
 */

/** The text of the scheduler's note when a runner's `testFiles` threw (`tryRunner`). */
const LISTING_FAILED = "runner testFiles failed: ";

/** The `meta` key of `worktreeId`'s remote summary line (review 0.1.623 B2). */
function remoteSummaryMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("remoteSummary", worktreeId);
}

/** The daemon's remote summary line of `worktreeId`; `undefined` when it has none. */
export function readRemoteSummary(
  store: Pick<Store, "meta">,
  worktreeId: WorktreeId,
): string | undefined {
  const text = store.meta.get(remoteSummaryMetaKey(worktreeId));
  return text === null || text === "" ? undefined : text;
}

/** Keeps `text` as `worktreeId`'s remote summary line; an empty `text` removes it. */
export function writeRemoteSummary(
  store: Pick<Store, "meta">,
  worktreeId: WorktreeId,
  text: string,
): void {
  const key = remoteSummaryMetaKey(worktreeId);
  if (text === "") store.meta.delete(key);
  else store.meta.set(key, text);
}

/** The snapshot's `remote` field: the daemon's summary line, when it has one. */
export function remoteOf(store: Pick<Store, "meta">, worktreeId: WorktreeId): { remote?: string } {
  const text = readRemoteSummary(store, worktreeId);
  return text === undefined ? {} : { remote: text };
}

/**
 * The snapshot's `listingFailed` field: the reason of the latest listing
 * failure at the current revision, while the live daemon has listed no test
 * file. A note of an earlier revision, or one a stopped daemon left, says nothing.
 */
export function listingFailedOf(
  notes: readonly DaemonNote[],
  header: Pick<StatusHeader, "revision" | "testFilesListed">,
  daemon: DaemonLiveness,
): { listingFailed?: string } {
  if (header.testFilesListed !== false || daemon.state !== "alive") return {};
  const note = notes.findLast((n) => n.text.startsWith(LISTING_FAILED));
  if (note === undefined || note.revision !== header.revision) return {};
  return { listingFailed: note.text.slice(LISTING_FAILED.length) };
}

/** `Remote: <line>` while a remote lane is named for the worktree (D12.1). */
export function remoteLines(s: Pick<StatusSnapshot, "remote">): string[] {
  return s.remote === undefined ? [] : [`Remote: ${s.remote}`];
}

/** The unlisted line: why the listing failed, or that Squeal is still starting (`fallback`). */
export function unlistedText(s: Pick<StatusSnapshot, "listingFailed">, fallback: string): string {
  if (s.listingFailed === undefined) return fallback;
  return `The daemon could not list this worktree's test files: ${s.listingFailed}. It lists them again at the next revision.`;
}
