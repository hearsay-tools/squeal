import { readHeader, skippedReason, worktreeSlowView } from "../core/state/index.js";
import type { CheckpointRecord, Store } from "../core/types/index.js";
import { failuresText, noVerdictText, readVerdict } from "./verdict.js";

/**
 * Spec 004 D8 as amended 2026-10-17 (task 004-65): a `run --all`
 * checkpoint whose slow lane a precondition skipped is not a full suite. Its
 * verdict line names the fast lane's result and the skip, exiting 1 on the
 * fast lane's known failures and otherwise 3; `null` when its slow lane was
 * not skipped. Read from `store` after the checkpoint ended.
 */
export function skippedLaneVerdict(
  store: Store,
  checkpoint: CheckpointRecord,
): [string, 1 | 3] | null {
  const { worktreeId } = checkpoint;
  const reason = skippedReason(readHeader(store, worktreeId).slowTier);
  const view = worktreeSlowView(store, worktreeId);
  if (reason === null || view === null) return null;
  const fast = checkpoint.testFiles.filter((ref) => !view.isSlow(ref));
  const verdict = readVerdict(store, worktreeId, fast);
  const failing =
    verdict.failures.tests + verdict.failures.testFiles + (verdict.failures.setups ?? 0);
  const lane = noVerdictText(verdict) ?? failuresText(verdict.failures);
  const line =
    `has no verdict: its slow lane was skipped, ${reason}, so it is not a full suite; ` +
    `its fast lane at revision ${verdict.revision}: ${lane}`;
  return [line, failing > 0 ? 1 : 3];
}
