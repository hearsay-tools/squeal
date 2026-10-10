import { isRecord } from "../fs/index.js";
import { testFileId } from "../keys/index.js";
import { pruneRekeyed, readRekeyed } from "../scheduler/rekeyed-record.js";
import { testFileKeyOf } from "../state/index.js";
import {
  type Consumer,
  type EditsSettled,
  type KnownState,
  type RevisionNumber,
  refinedMetaKey,
  type Store,
  type TestFileKeyRecord,
  type WorktreeId,
} from "../types/index.js";
import { changedAfter, registration } from "./registered.js";
import { readAll, readSlot, writeSlot } from "./slots.js";

/*
 * Tasks 001-223 and 001-224 (spec 005 D6, proposals a and c): what a
 * delivery says about the consumer's own edits. The files they re-keyed are
 * those the scheduler's attribution names (task 001-186), which the daemon
 * keeps in the store for hooks (`readRekeyed`, review wave 13u B1, task
 * 001-238): a file whose latest re-key came after the consumer's edit state
 * began, owed while its earliest unresolved re-key has no result. A key a
 * backlog merely runs again, or a first listing, is never recorded.
 *
 * Each consumer keeps the revision its edits are counted from and whether
 * the 001-224 line was said, in one slot. When it leaves, "said" is parked
 * with its registration (`park`) and restored if the same session comes back
 * (review wave 13u B2).
 */

/** `meta` key of the consumers' edit state: the revision their edits count from, and whether 001-224 was said. */
export function editsMetaKey(worktreeId: WorktreeId): string {
  return `edits:${worktreeId}`;
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
  // The key snapshot squeal 0.1.100 to 0.1.102 kept per consumer.
  const legacy = `edit-keys:${JSON.stringify([consumer.worktreeId, consumer.sessionId, consumer.agentId])}`;
  if (store.meta.get(legacy) !== null) store.meta.delete(legacy);
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

/** The revision whose runner part the daemon applied last; with none recorded, every one. */
function refined(store: Store, worktreeId: WorktreeId): number {
  const raw = store.meta.get(refinedMetaKey(worktreeId));
  const value = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(value) ? value : Number.POSITIVE_INFINITY;
}

/** What a delivery says about the consumer's edits, and what saying it records. */
export interface EditNotes {
  readonly sawEdit?: { readonly queued: number };
  readonly editsSettled?: EditsSettled;
  /** Records what was said: 001-224 once, and after a settled line, edits count from the revision it settled. */
  readonly tell: () => void;
}

/**
 * The notes on `consumer`'s edits since its edit state's revision, once the runner part
 * of the latest revision is applied (`refinedMetaKey`): until then the files
 * it adds have no key. `null` with nothing to say, before any edit, or for a
 * consumer registered before these notes (no edit state). `delivering`
 * says the delivery has other news; without it, and with 001-224 said, only
 * the edit state is read.
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
  const revision = store.revisions.latest(consumer.worktreeId)?.number ?? 0;
  if (revision <= state.since || refined(store, consumer.worktreeId) < revision) return null;
  const gaps = registration(store, consumer)?.gaps ?? [];
  const { changed } = changedAfter(
    store,
    consumer.worktreeId,
    { since: state.since, gaps },
    revision,
  );
  if (changed.size === 0) return null;
  const rows = new Map(
    store.testFileKeys.list(consumer.worktreeId).map((k) => [testFileId(k.testFile), k]),
  );
  const rekeyed: TestFileKeyRecord[] = [];
  let owed = false;
  for (const [id, entry] of readRekeyed(store, consumer.worktreeId)) {
    const row = rows.get(id);
    if (row === undefined || entry.last <= state.since) continue;
    rekeyed.push(row);
    owed ||= entry.open !== null && row.pending !== null;
  }
  // An edit that queued nothing (one made while awaiting an install) has no results to come.
  const sawEdit = state.said || rekeyed.length === 0 ? undefined : { queued: rekeyed.length };
  const editsSettled = owed ? undefined : settled(state.since, rekeyed, states);
  if (sawEdit === undefined && editsSettled === undefined) return null;
  return {
    ...(sawEdit === undefined ? {} : { sawEdit }),
    ...(editsSettled === undefined ? {} : { editsSettled }),
    tell: () => {
      writeState(store, consumer, {
        since: editsSettled === undefined ? state.since : revision,
        said: true,
      });
      if (editsSettled !== undefined) prune(store, consumer.worktreeId);
    },
  };
}

/**
 * `rekeyed`, none pending, as the settled line counts them: a file with an
 * unknown check has no result. `undefined` when the edits re-keyed nothing.
 */
function settled(
  since: RevisionNumber,
  rekeyed: readonly TestFileKeyRecord[],
  states: readonly KnownState[],
): EditsSettled | undefined {
  if (rekeyed.length === 0) return undefined;
  const unknown = new Set(
    states.filter((s) => s.outcome === "unknown").map((s) => testFileKeyOf(s.check)),
  );
  return {
    since,
    files: rekeyed.length,
    unknown: rekeyed.filter((k) => unknown.has(testFileId(k.testFile))).length,
  };
}
