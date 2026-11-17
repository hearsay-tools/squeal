import type { EpochMs, WorktreeId } from "../types/common.js";
import type { Consumer, ViewEntry } from "../types/delivery.js";
import type { KnownState } from "../types/state.js";
import type { Store } from "../types/store.js";
import { num } from "./codec.js";
import { SELECT_STATES, toKnownState } from "./repos/states.js";
import { connectionOf } from "./store.js";

/*
 * Row 005-103: a registration seeds its consumer's view with every known state it read, in one
 * statement. `views.writeMany` of `toView` took three statements per state: an insert and a
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
