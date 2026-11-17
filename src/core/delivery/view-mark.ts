import { isRecord } from "../fs/json.js";
import { checkIdentity } from "../state/derive.js";
import { currentBirthMark } from "../store/state-born.js";
import { checksBornAfter, untoldBornAfter, type ViewSeedRow } from "../store/view-seed.js";
import type { EpochMs, WorktreeId } from "../types/common.js";
import type { Consumer, ViewEntry } from "../types/delivery.js";
import type { KnownState } from "../types/state.js";
import { type Store, worktreeMetaKey } from "../types/store.js";
import { owesCounts } from "./counts-owed.js";
import { viewThroughMark } from "./delta.js";
import { readSlot, writeSlot } from "./slots.js";

/*
 * Row 005-106 (005 `research/consumer-view-design.md`, design N; spec 001 D6
 * as amended): a registration seeds its consumer's view with the states that
 * are not `pass` and keeps the store's high birth mark (row 005-105) in the
 * consumer's slot. A state with no view entry that was born at or before
 * that mark reads as the pass it was at the registration (`markedView`); the
 * view no longer copies every state.
 *
 * A registration on a store whose marks are not kept (no daemon of 0.1.545
 * or later served it) seeds the full copy and keeps no mark. A consumer with
 * no mark reads its view as it is, as before this row: one registered before
 * the upgrade keeps its full copy until it registers again or expires. A
 * store that loses a trigger reads every consumer as unmarked until a
 * daemon's registration makes it again. The slot ends with the consumer: it
 * is read only while registered, every registration writes or clears it,
 * and `writeSlot` drops the slots of consumers gone at its next write.
 */

/** The mark a registration keeps: the store's high birth mark, and when it was read. */
export interface ViewMark {
  readonly mark: number;
  readonly at: EpochMs;
}

/** `meta` key of the birth marks the worktree's consumers registered at. */
export function viewMarkMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("viewMark", worktreeId);
}

/** `consumer`'s mark; `null` when it has none or it is unreadable. */
export function viewMarkOf(store: Store, consumer: Consumer): ViewMark | null {
  const value = readSlot(store, viewMarkMetaKey(consumer.worktreeId), consumer);
  if (!isRecord(value) || typeof value.mark !== "number" || typeof value.at !== "number") {
    return null;
  }
  return { mark: value.mark, at: value.at };
}

/**
 * A registration's view rows and mark, read in its transaction with the
 * states `seed` holds: the rows not `pass` and the high mark while the store
 * keeps marks; else every row and no mark.
 */
export function registrationSeed(
  store: Store,
  seed: readonly ViewSeedRow[],
): { readonly rows: readonly ViewSeedRow[]; readonly mark: number | null } {
  return underMark(store, seed);
}

/** The one rule of the seed: the rows not `pass` and the high mark while the store keeps marks; else every row and no mark. */
function underMark<T extends { readonly outcome: string }>(
  store: Store,
  rows: readonly T[],
): { readonly rows: readonly T[]; readonly mark: number | null } {
  const mark = currentBirthMark(store);
  if (mark === null) return { rows, mark: null };
  return { rows: rows.filter((row) => row.outcome !== "pass"), mark };
}

/**
 * Row 005-113 (011 `research/unlisted-after-start.md` R1): the view writes
 * of a delivery to a consumer owed the counts, a consumer that registered
 * before the test files were listed. Its first delivery after the listing
 * planned one write per state it was never told, every pass among them.
 * Those writes are seeded as a registration at this moment seeds them
 * (`underMark`): the passes never told are left out and the store's high
 * mark is kept, so each reads as the told pass the write would have stored
 * (`markedView`). What the delivery tells is planned before and unchanged.
 *
 * `view` is the consumer's stored entries the plan read, `writes` its
 * writes; a plan `restricted` to some entries (`keep`, the waiter's) writes
 * no silent pass and keeps its writes. A write over an entry, a recovery, is
 * kept. A store that keeps no marks keeps every write. Call inside the
 * delivery's transaction, before the writes.
 */
export function listingWrites(
  store: Store,
  consumer: Consumer,
  {
    view,
    at,
    restricted,
  }: { readonly view: readonly ViewEntry[]; readonly at: EpochMs; readonly restricted: boolean },
  { writes }: { readonly writes: readonly ViewEntry[] },
): readonly ViewEntry[] {
  if (restricted || !owesCounts(store, consumer)) return writes;
  const held = new Set(view.map((v) => checkIdentity(v.check)));
  const untold = writes.filter((w) => !held.has(checkIdentity(w.check)));
  const { rows, mark } = underMark(store, untold);
  if (mark === null || rows.length === untold.length) return writes;
  recordViewMark(store, consumer, { mark, at });
  const seeded = new Set(rows);
  return writes.filter((w) => held.has(checkIdentity(w.check)) || seeded.has(w));
}

/** Records `consumer`'s mark (`null` clears it). Call inside the registration's transaction. */
export function recordViewMark(store: Store, consumer: Consumer, mark: ViewMark | null): void {
  const key = viewMarkMetaKey(consumer.worktreeId);
  if (mark === null && readSlot(store, key, consumer) === undefined) return;
  writeSlot(store, key, consumer, mark);
}

/** The mark a reader may trust: `consumer`'s, while the store still keeps marks. */
function trustedMark(store: Store, consumer: Consumer): ViewMark | null {
  const mark = viewMarkOf(store, consumer);
  return mark === null || currentBirthMark(store) === null ? null : mark;
}

/**
 * `view`, the consumer's stored entries, as `planDelta` reads it against
 * `states`: with a mark, each state with no entry born at or before it
 * reads as a told pass (`viewThroughMark`). Read in the transaction of
 * `states` and `view`, after both.
 */
export function markedView(
  store: Store,
  consumer: Consumer,
  view: readonly ViewEntry[],
  states: readonly KnownState[],
): readonly ViewEntry[] {
  const mark = trustedMark(store, consumer);
  if (mark === null) return view;
  const after = checksBornAfter(store, consumer.worktreeId, mark.mark);
  return viewThroughMark(view, states, (s) => !after.has(checkIdentity(s.check)), mark.at);
}

/** The states never told to `consumer` (task 001-414): with a mark, those born after it. */
export function untoldStates(store: Store, consumer: Consumer): readonly KnownState[] {
  const mark = trustedMark(store, consumer);
  if (mark === null) return store.knownStates.untold(consumer);
  return untoldBornAfter(store, consumer, mark.mark);
}
