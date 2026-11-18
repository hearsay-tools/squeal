import { testFileId } from "../keys/reverse-index.js";
import { isRefined } from "../scheduler/refined.js";
import { readRekeyed } from "../scheduler/rekeyed-record.js";
import { testFileKeyOf } from "../state/derive.js";
import type { CheckId } from "../types/check.js";
import type { RevisionNumber } from "../types/common.js";
import type { Consumer, OwnEdits } from "../types/delivery.js";
import type { KnownState } from "../types/state.js";
import type { StatusHeader } from "../types/status.js";
import type { Store } from "../types/store.js";
import type { TestFileKeyRecord } from "../types/store-records.js";
import type { EditNotes } from "./edits.js";
import type { OwedFile, OwnRead } from "./late.js";
import { changedAfter, registration } from "./registered.js";

/*
 * Row 005-93 (c): the consumer's own edits that `editNotes` (`edits.ts`) counts: the files they
 * re-keyed, those owed, and those with an unknown check (row 005-120 moved them here).
 */

/** The own count of `own`, its unknown files only when there are any. */
export function ownCount(own: OwnRead): OwnEdits {
  const count = { files: own.files, owed: own.owed.length };
  return own.unknown === 0 ? count : { ...count, unknown: own.unknown };
}

/** `OwnRead` with the ids of the files the edits affect. */
export interface Own extends OwnRead {
  /** The ids (`testFileId`) of the files the edits affect. */
  readonly rekeyed: ReadonlySet<string>;
}

/**
 * The consumer's edits after `since` at the latest revision; `null` with none. Until the latest
 * revision's runner part is applied (`isRefined`), the files it adds have no key, so none is
 * counted (`refined: false`, which only the late state reads). A file is owed while its re-key
 * has no result at its key (row 005-93); its edit is that re-key, or the first revision after
 * `since` for one made before it.
 */
export function readOwn(
  store: Store,
  consumer: Consumer,
  since: RevisionNumber,
  states: readonly KnownState[],
): Own | null {
  const { worktreeId } = consumer;
  const revision = store.revisions.latest(worktreeId)?.number ?? 0;
  if (revision <= since) return null;
  const gaps = registration(store, consumer)?.gaps ?? [];
  if (changedAfter(store, worktreeId, { since, gaps }, revision).changed.size === 0) return null;
  const none = { since, revision, files: 0, owed: [], unknown: 0, rekeyed: new Set<string>() };
  if (!isRefined(store, worktreeId, revision)) return { ...none, refined: false };
  const rows = new Map(store.testFileKeys.list(worktreeId).map((k) => [testFileId(k.testFile), k]));
  const rekeyed: TestFileKeyRecord[] = [];
  const owed: OwedFile[] = [];
  for (const [id, entry] of readRekeyed(store, worktreeId)) {
    const row = rows.get(id);
    // An unkeyed file has no result to come.
    if (row === undefined || row.key === null || entry.last <= since) continue;
    rekeyed.push(row);
    // Owed while its re-key has no result at its key (row 005-93): a confirmation run at the same
    // key after the edit's result (001-171) owes nothing.
    if (entry.open !== null)
      owed.push({ file: row.testFile, from: Math.max(entry.open, since + 1) });
  }
  return {
    since,
    revision,
    refined: true,
    files: rekeyed.length,
    owed,
    unknown: unknownFiles(rekeyed, states),
    rekeyed: new Set(rekeyed.map((k) => testFileId(k.testFile))),
  };
}

/**
 * Task 001-396: whether the 001-224 line would sit in the message that is
 * the edit's result. It would say "queued N; results arrive with later tool
 * calls" beside the result of a file it counts and a header with nothing
 * pending: a file the edit affects can still be pending on its row, a
 * new failure's confirmation run at the same key (001-171), which holds no
 * check. The line is then left out, and spent.
 */
export function carriesEditResult(
  notes: EditNotes,
  checks: readonly CheckId[],
  header: StatusHeader,
): boolean {
  if (notes.sawEdit === undefined) return false;
  const pending =
    header.counts.pending > 0 ||
    header.testFilesWithoutChecks.pending > 0 ||
    header.runnerPartPending === true;
  return !pending && checks.some((check) => notes.rekeyed.has(testFileKeyOf(check)));
}

/** Of `rekeyed`, the files with an unknown check: no result. */
function unknownFiles(
  rekeyed: readonly TestFileKeyRecord[],
  states: readonly KnownState[],
): number {
  const unknown = new Set(
    states.filter((s) => s.outcome === "unknown").map((s) => testFileKeyOf(s.check)),
  );
  return rekeyed.filter((k) => unknown.has(testFileId(k.testFile))).length;
}
