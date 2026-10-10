import { isRecord } from "../fs/index.js";
import { testFileId } from "../keys/index.js";
import { testFileKeyOf } from "../state/index.js";
import {
  type CheckKey,
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
import { readSlot, writeSlot } from "./slots.js";

/*
 * Tasks 001-223 and 001-224 (spec 005 D6, proposals a and c): what a
 * delivery says about the consumer's own edits. The daemon's set of files a
 * revision re-keyed (task 001-186) lives in its memory; a hook reads the
 * store. So each consumer keeps a snapshot of the worktree's test-file keys,
 * taken when it registers and again when the settled line is said, and the
 * files its edits re-keyed are those whose key moved since: a key a backlog
 * merely runs again does not move. A test file with no key in the snapshot
 * counts only when the consumer's changes name it (it added the file), so a
 * first listing is not its edit.
 *
 * The snapshot is a row of its own, written once per registration and once
 * per settled line, never per delivery, and deleted with the consumer.
 */

/** Characters of a key the snapshot keeps: enough that two keys of one file never collide. */
const KEY_CHARS = 16;

/** `meta` key of the consumers' edit state: the revision their snapshot is of, and whether 001-224 was said. */
function editsMetaKey(worktreeId: WorktreeId): string {
  return `edits:${worktreeId}`;
}

/** `meta` key of `consumer`'s key snapshot, a row of its own. */
export function editKeysMetaKey(consumer: Consumer): string {
  return `edit-keys:${JSON.stringify([consumer.worktreeId, consumer.sessionId, consumer.agentId])}`;
}

interface EditState {
  /** The revision the snapshot is of; edits after it are the ones not settled yet. */
  readonly since: RevisionNumber;
  /** Whether the 001-224 line was said. */
  readonly said: boolean;
}

function readState(store: Store, consumer: Consumer): EditState | null {
  const value = readSlot(store, editsMetaKey(consumer.worktreeId), consumer);
  if (!isRecord(value) || typeof value.since !== "number") return null;
  return { since: value.since, said: value.said === true };
}

const short = (key: CheckKey | null) => (key === null ? null : key.slice(0, KEY_CHARS));

/**
 * Records `consumer`'s snapshot of `keys` at `revision`. Call inside the
 * registration's or the delivery's transaction.
 */
export function snapshotKeys(
  store: Store,
  consumer: Consumer,
  revision: RevisionNumber,
  keys: readonly TestFileKeyRecord[],
  said = false,
): void {
  const snapshot = Object.fromEntries(keys.map((k) => [testFileId(k.testFile), short(k.key)]));
  store.meta.set(editKeysMetaKey(consumer), JSON.stringify(snapshot));
  writeSlot(store, editsMetaKey(consumer.worktreeId), consumer, { since: revision, said });
}

/** Drops `consumer`'s edit state and snapshot. Call inside the unregistration's transaction. */
export function forgetEdits(store: Store, consumer: Consumer): void {
  writeSlot(store, editsMetaKey(consumer.worktreeId), consumer, null);
  store.meta.delete(editKeysMetaKey(consumer));
}

function readSnapshot(store: Store, consumer: Consumer): ReadonlyMap<string, string | null> {
  const raw = store.meta.get(editKeysMetaKey(consumer));
  try {
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (!isRecord(value)) return new Map();
    return new Map(
      Object.entries(value).filter(
        (e): e is [string, string | null] => typeof e[1] === "string" || e[1] === null,
      ),
    );
  } catch {
    return new Map();
  }
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
  /** Records what was said: 001-224 once, and a new snapshot after a settled line. */
  readonly tell: () => void;
}

/**
 * The notes on `consumer`'s edits since its snapshot, once the runner part
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
  const keys = store.testFileKeys.list(consumer.worktreeId);
  // A key that moved after the snapshot was written at a later revision.
  const moved = keys.filter((k) => k.revision > state.since && k.key !== null);
  const snapshot = moved.length === 0 ? new Map() : readSnapshot(store, consumer);
  const rekeyed = moved.filter((k) => {
    const before = snapshot.get(testFileId(k.testFile));
    return before === undefined ? changed.has(k.testFile.path) : before !== short(k.key);
  });
  const owed = rekeyed.some((k) => k.pending !== null);
  // An edit that queued nothing (one made while awaiting an install) has no results to come.
  const sawEdit = state.said || rekeyed.length === 0 ? undefined : { queued: rekeyed.length };
  const editsSettled = owed ? undefined : settled(state.since, rekeyed, states);
  if (sawEdit === undefined && editsSettled === undefined) return null;
  return {
    ...(sawEdit === undefined ? {} : { sawEdit }),
    ...(editsSettled === undefined ? {} : { editsSettled }),
    tell: () => {
      if (editsSettled !== undefined) snapshotKeys(store, consumer, revision, keys, true);
      else writeSlot(store, editsMetaKey(consumer.worktreeId), consumer, { ...state, said: true });
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
