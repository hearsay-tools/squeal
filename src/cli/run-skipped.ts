import { readHeader, skippedReason, worktreeSlowView } from "../core/state/index.js";
import type { CheckpointRecord, Store } from "../core/types/index.js";
import { failuresText, noVerdictText, readVerdict } from "./verdict.js";

/**
 * Spec 004 D8 as amended 2026-10-17 (task 004-65): a `run --all`
 * checkpoint whose slow lane a precondition skipped is not a full suite. Its
 * verdict line names the fast lane's result and the skip, exiting 1 on the
 * fast lane's known failures and otherwise 3; `null` when its slow lane was
 * not skipped, or it held no slow lane. The fast lane is every listed fast
 * file, the ones already current that the checkpoint did not queue
 * included (review wave-8.1 B3); a slow-lane checkpoint names none. Read
 * from `store` after the checkpoint ended.
 */
export function skippedLaneVerdict(
  store: Store,
  checkpoint: CheckpointRecord,
): [string, 1 | 3] | null {
  const { worktreeId, lane } = checkpoint;
  if (lane === "fast") return null;
  const reason = skippedReason(readHeader(store, worktreeId).slowTier);
  const view = worktreeSlowView(store, worktreeId);
  if (reason === null || view === null) return null;
  const skipped = `has no verdict: its slow lane was skipped, ${reason}, so it is not a full suite`;
  if (lane === "slow") return [skipped, 3];
  const fast = store.testFileKeys
    .list(worktreeId)
    .map((row) => row.testFile)
    .filter((ref) => !view.isSlow(ref));
  const verdict = readVerdict(store, worktreeId, fast);
  const failing =
    verdict.failures.tests + verdict.failures.testFiles + (verdict.failures.setups ?? 0);
  const result = noVerdictText(verdict) ?? failuresText(verdict.failures);
  return [
    `${skipped}; its fast lane at revision ${verdict.revision}: ${result}`,
    failing > 0 ? 1 : 3,
  ];
}
