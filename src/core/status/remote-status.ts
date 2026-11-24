import { REMOTE_SUMMARY_TOPIC } from "../runner-host/remote/summary.js";
import type { DaemonNote } from "../types/scheduler.js";
import type { DaemonLiveness, StatusHeader, StatusSnapshot } from "../types/status.js";

/*
 * Row 026-20 (lessons D1, D2; spec 026 D12.1, vision principle 2). Two
 * facts of plain `squeal status` that only the daemon's notes held:
 *
 * - `remote`: the remote's one summary line (`summary.ts`), printed as
 *   `Remote: <line>`, present while the latest summary note is not empty.
 * - `listingFailed`: why the live daemon could not list the test files of
 *   the current revision, such as a remote refused under `whenLost:
 *   "not-run"`, while no test file is listed. Status then says so instead of
 *   "still starting" or "listed no test files". The next revision lists again.
 */

/** The text of the scheduler's note when a runner's `testFiles` threw (`tryRunner`). */
const LISTING_FAILED = "runner testFiles failed: ";

/** The snapshot's `remote` field: the latest summary line, when it is not empty. */
export function remoteOf(notes: readonly DaemonNote[]): { remote?: string } {
  const text = notes.findLast((note) => note.topic === REMOTE_SUMMARY_TOPIC)?.text;
  return text === undefined || text === "" ? {} : { remote: text };
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

/** Whether `note` is the remote's summary, which the `Remote:` line prints instead of the notes. */
export function isRemoteSummary(note: DaemonNote): boolean {
  return note.topic === REMOTE_SUMMARY_TOPIC;
}
