import { isRecord } from "../fs/json.js";
import { testFileId } from "../keys/reverse-index.js";
import { isRefined } from "../scheduler/refined.js";
import { pruneRekeyed, readRekeyed } from "../scheduler/rekeyed-record.js";
import { testFileKeyOf } from "../state/derive.js";
import type { CheckId } from "../types/check.js";
import type { EpochMs, RevisionNumber, WorktreeId } from "../types/common.js";
import type {
  CaughtUp,
  Consumer,
  Delta,
  DeltaEntry,
  EditsLate,
  OwnEdits,
} from "../types/delivery.js";
import type { KnownState } from "../types/state.js";
import type { StatusHeader } from "../types/status.js";
import { type Store, worktreeMetaKey } from "../types/store.js";
import type { TestFileKeyRecord } from "../types/store-records.js";
import {
  endLate,
  forgetLate,
  type LateNotes,
  lateIsOpen,
  lateNotes,
  type OwedFile,
  type OwnRead,
} from "./late.js";
import { changedAfter, registration } from "./registered.js";
import { readAll, readSlot, writeSlot } from "./slots.js";

/*
 * Tasks 001-223 and 001-224 (spec 005 D6, proposals a and c): what a
 * delivery says about the consumer's own edits. The files they re-keyed are
 * those the scheduler's attribution names (task 001-186), which the daemon
 * keeps in the store for hooks (`readRekeyed`, review wave 13u B1, task
 * 001-238): a file whose latest re-key came after the consumer's edit state
 * began, owed while its earliest unresolved re-key has no result. A key a
 * backlog merely runs again, or a first listing, is never recorded. The
 * settled line waits while any of those files is queued or running again,
 * for example 001-171's confirmation of its edit's new failure at the same
 * key (review wave 13v, B1, task 001-240); `status --wait` holds for no such
 * run (task 001-196).
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
  /** Edits after this revision are the ones not settled yet. */
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
  forgetLate(store, consumer);
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
  readonly late?: EditsLate;
  readonly caughtUp?: CaughtUp;
  /** The test files (`testFileId`) the edits affect, the ones `sawEdit` counts. */
  readonly rekeyed: ReadonlySet<string>;
  /**
   * Records what was said: 001-224 once; the late state; and once none is owed, edits count
   * from this revision. `failed`: the delivery carries a new failure, which ends a late state.
   */
  readonly tell: (failed: boolean) => void;
}

/** When the delivery is at a tool boundary that is not a Stop: its time and lazy header. */
export interface Boundary {
  readonly at: EpochMs;
  readonly header: () => StatusHeader;
}

/**
 * The notes on `consumer`'s edits after its edit state's revision. `null` with nothing to say,
 * before any edit, or for a consumer registered before these notes (no edit state).
 * `delivering` says the delivery has other news; `boundary`, a tool boundary that is not a
 * Stop, where late and caught up are said (row 005-93). Elsewhere, with 001-224 said and no
 * other news, only the edit state is read.
 */
export function editNotes(
  store: Store,
  consumer: Consumer,
  states: readonly KnownState[],
  delivering: boolean,
  boundary: Boundary | null = null,
): EditNotes | null {
  const state = readState(store, consumer);
  if (state === null || (state.said && !delivering && boundary === null)) return null;
  const own = readOwn(store, consumer, state.since, states);
  if (own === null) return null;
  const { lateness, lateOpen } = lateOf(store, consumer, own, boundary);
  // An edit that queued nothing (one made while awaiting an install) has no results to come.
  const sawEdit = state.said || own.files === 0 ? undefined : { queued: own.files };
  const counted = own.refined && own.files > 0;
  const said = sawEdit !== undefined || lateness?.late !== undefined || lateness?.caughtUp;
  if (!said && !(delivering && counted)) return null;
  return {
    ...(sawEdit === undefined ? {} : { sawEdit }),
    ...(counted ? { own: { files: own.files, owed: own.owed.length } } : {}),
    ...lateParts(lateness),
    rekeyed: own.rekeyed,
    tell: (failed) => {
      if (!failed) lateness?.tell();
      // A late state stays counted from its revision until caught up or a failure ends it.
      const ended = !lateOpen || lateness?.caughtUp !== undefined || failed;
      const moved = counted && own.owed.length === 0 && ended;
      // Written only when it changes: once per said line, never per quiet delivery.
      if (!moved && sawEdit === undefined) return;
      writeState(store, consumer, { since: moved ? own.revision : state.since, said: true });
      if (moved) prune(store, consumer.worktreeId);
    },
  };
}

/** What a delivery tells of the consumer's edits beside its entries (row 005-93). */
export interface EditTold {
  /** The delivery carries a new failure: it ends a late state, and no late or caught up rides on it. */
  readonly failed: boolean;
  /** The notes deliver by themselves: the 001-224 line where `alone` allows it, late, caught up. */
  readonly speaks: boolean;
  /** The delta's edit parts, with the 001-224 line as the delivery keeps it (`carriesEditResult`). */
  readonly parts: (
    sawEdit: EditNotes["sawEdit"],
  ) => Pick<Delta, "sawEdit" | "ownEdits" | "editsLate" | "caughtUp">;
}

/** `notes` as a delivery of `entries` tells them; `alone`: the 001-224 line may deliver by itself. */
export function editTold(
  notes: EditNotes | null,
  entries: readonly DeltaEntry[],
  alone: boolean,
): EditTold {
  const failed = entries.some((e) => e.kind !== "fail-retired" && e.to === "fail");
  const late = failed ? undefined : notes?.late;
  const caughtUp = failed ? undefined : notes?.caughtUp;
  return {
    failed,
    speaks: (alone && notes?.sawEdit !== undefined) || late !== undefined || caughtUp !== undefined,
    parts: (sawEdit) => ({
      ...(sawEdit === undefined ? {} : { sawEdit }),
      ...(notes?.own === undefined ? {} : { ownEdits: notes.own }),
      ...(late === undefined ? {} : { editsLate: late }),
      ...(caughtUp === undefined ? {} : { caughtUp }),
    }),
  };
}

/**
 * The late notes at a `boundary`, and whether a late state is open. Review 0.1.530 B1: the late
 * state is read on every path, so a delivery that may not say caught up (Stop, the waiter, the
 * turn start) keeps the window that caught up counts.
 */
function lateOf(
  store: Store,
  consumer: Consumer,
  own: OwnRead,
  boundary: Boundary | null,
): { readonly lateness: LateNotes | null; readonly lateOpen: boolean } {
  if (boundary === null) return { lateness: null, lateOpen: lateIsOpen(store, consumer) };
  const lateness = lateNotes(store, consumer, own, boundary.at, boundary.header);
  return { lateness, lateOpen: lateness?.open ?? false };
}

/**
 * Records what a delivery told of `notes`. Review 0.1.530 B1: a delivered new failure ends the
 * late state on every path, with or without notes. Call inside the delivery's transaction.
 */
export function tellEdits(
  store: Store,
  consumer: Consumer,
  notes: EditNotes | null,
  failed: boolean,
): void {
  notes?.tell(failed);
  if (failed) endLate(store, consumer);
}

/** The late and caught-up parts of `EditNotes`, as `lateNotes` gave them. */
function lateParts(lateness: LateNotes | null): Pick<EditNotes, "late" | "caughtUp"> {
  if (lateness === null) return {};
  return {
    ...(lateness.late === undefined ? {} : { late: lateness.late }),
    ...(lateness.caughtUp === undefined ? {} : { caughtUp: lateness.caughtUp }),
  };
}

/** `OwnRead` with the ids of the files the edits affect. */
interface Own extends OwnRead {
  readonly rekeyed: ReadonlySet<string>;
}

/**
 * The consumer's edits after `since` at the latest revision; `null` with none. Until the latest
 * revision's runner part is applied (`isRefined`), the files it adds have no key, so none is
 * counted. A file is owed while its earliest unresolved re-key has no result at its key; its
 * edit is that re-key, or the first revision after `since` for one made before it.
 */
function readOwn(
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
  const entries = [...readRekeyed(store, worktreeId)].filter(([, e]) => e.last > since);
  if (entries.length === 0) return { ...none, refined: true };
  const rows = new Map(store.testFileKeys.list(worktreeId).map((k) => [testFileId(k.testFile), k]));
  const rekeyed: TestFileKeyRecord[] = [];
  const owed: OwedFile[] = [];
  for (const [id, entry] of entries) {
    const row = rows.get(id);
    // An unkeyed file has no result to come.
    if (row === undefined || row.key === null) continue;
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
