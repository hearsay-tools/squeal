import { checkIdentity } from "../state/derive.js";
import type { EpochMs, WorktreeId } from "../types/common.js";
import type { Consumer, ViewEntry } from "../types/delivery.js";
import type { KnownState } from "../types/state.js";
import type { Store } from "../types/store.js";
import { CHECK_COLUMNS, checkFrom, num } from "./codec.js";
import { SELECT_STATES, toKnownState } from "./repos/states.js";
import { connectionOf } from "./store.js";

/*
 * Row 005-103: a registration seeds its consumer's view with the rows it is given, in one
 * statement (row 005-106: the states that are not `pass` while the store keeps birth marks,
 * else every known state it read). `views.writeMany` of `toView` took three statements per state: an insert and a
 * select to find the check's row id again, then the view's row. A module of its own, not a
 * repository method: delivery alone uses it, and it decides nothing a check stores, so it stays
 * out of the key-format validity path's bundle (011 C3), which every repository is in.
 */

/** One view entry `seedView` writes: a check by its row id, as a known state holds it. */
export interface ViewSeedRow {
  readonly checkId: number;
  readonly outcome: ViewEntry["outcome"];
  readonly fingerprint: string | null;
}

/**
 * `knownStates.list(worktreeId)`, with each state's seed row at its index, from the same read:
 * a registration's text and the view it seeds come from one read.
 */
export function statesToSeed(
  store: Store,
  worktreeId: WorktreeId,
): { readonly states: readonly KnownState[]; readonly seed: readonly ViewSeedRow[] } {
  const rows = connectionOf(store).all(
    `${SELECT_STATES} WHERE s.worktree_id = ? ORDER BY c.project, c.test_path, c.kind, c.full_name`,
    worktreeId,
  );
  const states: KnownState[] = [];
  const seed: ViewSeedRow[] = [];
  for (const row of rows) {
    const state = toKnownState(row);
    states.push(state);
    seed.push({
      checkId: num(row, "check_id"),
      outcome: state.outcome,
      fingerprint: state.fingerprint,
    });
  }
  return { states, seed };
}

/**
 * Writes `rows` into `consumer`'s view at `toldAt` in one statement: the entries `writeMany`
 * writes for the same states. The values are those read, so under a serving daemon (spec 021
 * D15), which writes the batch after the read, a state committed in between is not seeded as
 * told, as it would be by an `INSERT ... SELECT` from `known_states`.
 */
export function seedView(
  store: Store,
  consumer: Consumer,
  rows: readonly ViewSeedRow[],
  toldAt: EpochMs,
): void {
  connectionOf(store).run(
    `INSERT OR REPLACE INTO consumer_views
       (worktree_id, session_id, agent_id, check_id, outcome, fingerprint, told_at)
     SELECT ?, ?, ?, j.value ->> 0, j.value ->> 1, j.value ->> 2, ? FROM json_each(?) j`,
    consumer.worktreeId,
    consumer.sessionId,
    consumer.agentId,
    toldAt,
    JSON.stringify(rows.map((r) => [r.checkId, r.outcome, r.fingerprint])),
  );
}

/*
 * Row 005-106: the reads of a view seeded with the states that are not `pass` (design N). A
 * consumer's registration keeps the store's high birth mark (`state-born.ts`); a state born
 * after it was never told to the consumer unless its view holds it.
 */

/** The identities (`checkIdentity`) of `worktreeId`'s checks whose state was born after `mark`. */
export function checksBornAfter(
  store: Store,
  worktreeId: WorktreeId,
  mark: number,
): ReadonlySet<string> {
  const rows = connectionOf(store).all(
    `SELECT ${CHECK_COLUMNS} FROM state_born b JOIN checks c ON c.id = b.check_id
     WHERE b.worktree_id = ? AND b.id > ?`,
    worktreeId,
    mark,
  );
  return new Set(rows.map((row) => checkIdentity(checkFrom(row))));
}

/**
 * Spec 024 D2: of `consumer`'s worktree's known states, those a delivery to a consumer that holds
 * `mark` can tell: each not `pass`, each its view holds, and each born after the mark. Any other
 * is a pass with no entry born at or before the mark, which `markedView` reads as a told pass, so
 * `planDelta` plans nothing for it: no entry, no write, no removal. In `knownStates.list` order.
 */
export function relevantStates(store: Store, consumer: Consumer, mark: number): KnownState[] {
  return connectionOf(store)
    .all(
      `${SELECT_STATES} WHERE s.worktree_id = ? AND (s.outcome != 'pass'
         OR EXISTS (SELECT 1 FROM consumer_views v WHERE v.worktree_id = s.worktree_id
           AND v.session_id = ? AND v.agent_id = ? AND v.check_id = s.check_id)
         OR EXISTS (SELECT 1 FROM state_born b WHERE b.worktree_id = s.worktree_id
           AND b.check_id = s.check_id AND b.id > ?))
       ORDER BY c.project, c.test_path, c.kind, c.full_name`,
      consumer.worktreeId,
      consumer.sessionId,
      consumer.agentId,
      mark,
    )
    .map(toKnownState);
}

/**
 * `KnownStateRepo.untold` for a consumer whose registration kept `mark`: the states with no
 * view entry that were born after it. One born at or before it was a pass told at the
 * registration.
 */
export function untoldBornAfter(store: Store, consumer: Consumer, mark: number): KnownState[] {
  return connectionOf(store)
    .all(
      `${SELECT_STATES} JOIN state_born b ON b.worktree_id = s.worktree_id AND b.check_id = s.check_id
       WHERE s.worktree_id = ? AND b.id > ? AND NOT EXISTS (
         SELECT 1 FROM consumer_views v WHERE v.worktree_id = s.worktree_id
           AND v.session_id = ? AND v.agent_id = ? AND v.check_id = s.check_id)
       ORDER BY c.project, c.test_path, c.kind, c.full_name`,
      consumer.worktreeId,
      mark,
      consumer.sessionId,
      consumer.agentId,
    )
    .map(toKnownState);
}
