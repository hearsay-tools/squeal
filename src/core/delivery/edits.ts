import { isRecord } from "../fs/json.js";
import { testFileId } from "../keys/reverse-index.js";
import { isRefined } from "../scheduler/refined.js";
import { pruneRekeyed, readRekeyed } from "../scheduler/rekeyed-record.js";
import { testFileKeyOf } from "../state/derive.js";
import type { CheckId } from "../types/check.js";
import type { RevisionNumber, WorktreeId } from "../types/common.js";
import type { Consumer, OwnEdits } from "../types/delivery.js";
import type { KnownState } from "../types/state.js";
import type { StatusHeader } from "../types/status.js";
import { type Store, worktreeMetaKey } from "../types/store.js";
import type { TestFileKeyRecord } from "../types/store-records.js";
import { changedAfter, registration } from "./registered.js";
import { readAll, readSlot, writeSlot } from "./slots.js";

/*
 * Tasks 001-223 and 001-224 (spec 005 D6, proposals a and c): what a
 * delivery says about the consumer's own edits. The files they re-keyed are
 * those the scheduler's attribution names (task 001-186), which the daemon
 * keeps in the store for hooks (`readRekeyed`, review wave 13u B1, task
 * 001-238): a file whose latest re-key came after the consumer's edit state
 * began, owed while its earliest unresolved re-key has no result. A key a
 * backlog merely runs again, or a first listing, is never recorded. Row
 * 005-93 (c): a change delivery's news header counts those files and the
 * ones owed; once none is owed, the count starts again from that revision.
 * A confirmation run at the same key after the edit's result (001-171)
 * owes nothing; `status --wait` holds for no such run (task 001-196).
 *
 * Each consumer keeps the revision its edits are counted from and whether
 * the 001-224 line was said, in one slot. When it leaves, "said" is parked
 * with its registration (`park`) and restored if the same session comes back
 * (review wave 13u B2).
 */

/** `meta` key of the consumers' edit state: the revision their edits count from, and whether 001-224 was said. */
export function editsMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("edits", worktreeId);
}

interface EditState {
  /** Edits after this revision are the ones the own count counts. */
  readonly since: RevisionNumber;
  /** Whether the 001-224 line was said. */
  readonly said: boolean;
}

function readState(store: Store, consumer: Consumer): EditState | null {
  const value = readSlot(store, editsMetaKey(consumer.worktreeId), consumer);
  if (!isRecord(value) || typeof value.since !== "number") return null;
  return { since: value.since, said: value.said === true };
}

function writeState(store: Store, consumer: Consumer, state: EditState | null): void {
  writeSlot(store, editsMetaKey(consumer.worktreeId), consumer, state);
}

/**
 * Counts `consumer`'s edits from after `revision`; `said` when a parked
 * registration of the same session had the 001-224 line said. Call inside
 * the registration's transaction.
 */
export function startEdits(
  store: Store,
  consumer: Consumer,
  revision: RevisionNumber,
  said: boolean,
): void {
  writeState(store, consumer, { since: revision, said });
}

/** Whether `consumer` was said the 001-224 line, for `park`. */
export function editsSaid(store: Store, consumer: Consumer): boolean {
  return readState(store, consumer)?.said === true;
}

/** Drops `consumer`'s edit state. Call inside the unregistration's transaction. */
export function forgetEdits(store: Store, consumer: Consumer): void {
  writeState(store, consumer, null);
  prune(store, consumer.worktreeId);
}

/** Drops the record's resolved entries no registered consumer's edits can count. */
function prune(store: Store, worktreeId: WorktreeId): void {
  const sinces = Object.values(readAll(store, editsMetaKey(worktreeId))).flatMap((v) =>
    isRecord(v) && typeof v.since === "number" ? [v.since] : [],
  );
  pruneRekeyed(
    store,
    worktreeId,
    sinces.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...sinces),
  );
}

/** What a delivery says about the consumer's edits, and what saying it records. */
export interface EditNotes {
  readonly sawEdit?: { readonly queued: number };
  /** Row 005-93 (c): the own count the news header shows; absent with no file affected. */
  readonly own?: OwnEdits;
  /** The test files (`testFileId`) the edits affect, the ones `sawEdit` counts. */
  readonly rekeyed: ReadonlySet<string>;
  /** Records what was said: 001-224 once, and once none is owed, edits count from this revision. */
  readonly tell: () => void;
}

/**
 * The notes on `consumer`'s edits after its edit state's revision. `null` with nothing to say,
 * before any edit, or for a consumer registered before these notes (no edit state).
 * `delivering` says the delivery has other news; without it, and with 001-224 said, only the
 * edit state is read.
 */
export function editNotes(
  store: Store,
  consumer: Consumer,
  states: readonly KnownState[],
  delivering: boolean,
): EditNotes | null {
  const state = readState(store, consumer);
  // Once 001-224 was said, only a delivery with other news carries a note.
  if (state === null || (state.said && !delivering)) return null;
  const own = readOwn(store, consumer, state.since, states);
  // An edit that queued nothing (one made while awaiting an install) has no results to come.
  if (own === null || own.files === 0) return null;
  const sawEdit = state.said ? undefined : { queued: own.files };
  const moved = own.owed === 0;
  return {
    ...(sawEdit === undefined ? {} : { sawEdit }),
    own: ownCount(own),
    rekeyed: own.rekeyed,
    tell: () => {
      // Written only when it changes: once per said line, never per quiet delivery.
      if (!moved && sawEdit === undefined) return;
      writeState(store, consumer, { since: moved ? own.revision : state.since, said: true });
      if (moved) prune(store, consumer.worktreeId);
    },
  };
}

/** The own count of `own`, its unknown files only when there are any. */
function ownCount(own: Own): OwnEdits {
  const count = { files: own.files, owed: own.owed };
  return own.unknown === 0 ? count : { ...count, unknown: own.unknown };
}

/** What the consumer's edits since its count began read at the latest revision. */
interface Own {
  readonly revision: RevisionNumber;
  /** The test files the edits affect. */
  readonly files: number;
  /** Of `files`, those with no result at their key yet. */
  readonly owed: number;
  /** Of `files`, those with an unknown check: no result. */
  readonly unknown: number;
  /** The ids (`testFileId`) of the files the edits affect. */
  readonly rekeyed: ReadonlySet<string>;
}

/**
 * The consumer's edits after `since` at the latest revision; `null` with none, or until the
 * latest revision's runner part is applied (`isRefined`): the files it adds have no key until
 * then. A file is owed while its re-key has no result at its key (row 005-93).
 */
function readOwn(
  store: Store,
  consumer: Consumer,
  since: RevisionNumber,
  states: readonly KnownState[],
): Own | null {
  const { worktreeId } = consumer;
  const revision = store.revisions.latest(worktreeId)?.number ?? 0;
  if (revision <= since || !isRefined(store, worktreeId, revision)) return null;
  const gaps = registration(store, consumer)?.gaps ?? [];
  if (changedAfter(store, worktreeId, { since, gaps }, revision).changed.size === 0) return null;
  const rows = new Map(store.testFileKeys.list(worktreeId).map((k) => [testFileId(k.testFile), k]));
  const rekeyed: TestFileKeyRecord[] = [];
  let owed = 0;
  for (const [id, entry] of readRekeyed(store, worktreeId)) {
    const row = rows.get(id);
    // An unkeyed file has no result to come.
    if (row === undefined || row.key === null || entry.last <= since) continue;
    rekeyed.push(row);
    // Owed while its re-key has no result at its key (row 005-93): a confirmation run at the same
    // key after the edit's result (001-171) owes nothing.
    if (entry.open !== null) owed++;
  }
  return {
    revision,
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
