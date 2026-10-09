import { readFailureKeys } from "../slow/state.js";
import type { CheckKey, ResultRecord, Store, WorktreeId } from "../types/index.js";
import { checkIdentity } from "./derive.js";

/**
 * Spec 001 D6 as amended (task 001-170, decided by the human): another
 * worktree's `fail` stands in a worktree only once that worktree confirmed
 * it. Until a local run does, the results of its key are held: no known
 * state, transition or delivery comes from them, and the file is queued. A
 * failure is confirmed when the worktree's own state already holds a fail
 * under that key (`readFailureKeys`): its own run failed there, and a later
 * run elsewhere failing again replaced the row. A pass stands at once.
 *
 * The first held result of `results`, one key's stored results, or
 * `undefined` when they stand. The worktree's failure keys are read only
 * when another worktree's fail is among them.
 */
export function heldFailure(
  store: Store,
  worktreeId: WorktreeId,
  results: readonly ResultRecord[],
  failureKeys: () => ReadonlyMap<string, CheckKey> = () => readFailureKeys(store, worktreeId),
): ResultRecord | undefined {
  const foreign = results.filter(
    (r) => r.outcome === "fail" && r.provenance.worktreeId !== worktreeId,
  );
  if (foreign.length === 0) return undefined;
  const confirmed = failureKeys();
  return foreign.find((r) => confirmed.get(checkIdentity(r.check)) !== r.key);
}

/** `readFailureKeys` read once, at the first call: for `heldFailure` over many keys. */
export function failureKeysOnce(
  store: Store,
  worktreeId: WorktreeId,
): () => ReadonlyMap<string, CheckKey> {
  let keys: ReadonlyMap<string, CheckKey> | null = null;
  return () => {
    keys ??= readFailureKeys(store, worktreeId);
    return keys;
  };
}
