import { CLOSURE_METHOD } from "../../src/core/keys/closure.js";
import { connectionOf } from "../../src/core/store/store.js";
import type { Store } from "../../src/core/types/store.js";
import { armMarkers } from "./closure-trust.js";

/*
 * Review 0.1.489, B1: writes by a release before rows 011-44 and 011-45,
 * which runs no marker code. Raw SQL stands for that release's
 * repositories: the same statements, nothing else.
 */

/** The store as this release leaves it for a reader that may keep what it read. */
export function asThisRelease(store: Store): void {
  armMarkers(store);
}

/** An older writer's state of `fullName` in `worktreeId`: `outcome`, with no marker code. */
export function olderState(
  store: Store,
  worktreeId: string,
  fullName: string,
  outcome: "pass" | "fail",
): void {
  const changed = connectionOf(store).run(
    `UPDATE known_states SET outcome = ?, fingerprint = ?, observed_at = 4
     WHERE worktree_id = ? AND check_id = (SELECT id FROM checks WHERE full_name = ?)`,
    outcome,
    outcome === "fail" ? "Error: x" : null,
    worktreeId,
    fullName,
  );
  if (changed !== 1) throw new Error(`olderState: ${changed} rows`);
}

/** An older writer's closure of `path`, holding `paths`, by `by`, with no marker code. */
export function olderClosure(
  store: Store,
  path: string,
  paths: readonly string[],
  by: string,
): void {
  connectionOf(store).run(
    `INSERT OR REPLACE INTO test_files
       (project, path, closure_paths, complete, method, updated_at, updated_by)
     VALUES ('', ?, ?, 0, ?, 1, ?)`,
    path,
    JSON.stringify([path, ...paths].sort()),
    CLOSURE_METHOD,
    by,
  );
}
