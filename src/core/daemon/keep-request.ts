import { shareRecord } from "../code/coverage/parts.js";
import { COVERAGE_RECORD_VERSION } from "../code/coverage/record.js";
import type { CoverageRecord } from "../code/coverage/types.js";
import { mergeSeen } from "../code/gate/keep-seen.js";
import { isCodeStoreOpenFailure, openCodeStore } from "../code/store/open.js";
import { healsUnheld } from "../scheduler/hold.js";
import type { WorktreeKeys } from "../scheduler/keying.js";
import { storeResults } from "../scheduler/store-results.js";
import { BUSY_SLICE_MS } from "../store/busy.js";
import { isBusy } from "../store/connection.js";
import type { AbsolutePath, EpochMs, WorktreeId } from "../types/common.js";
import type { KeepOutcome, KeepRequest } from "../types/daemon-writes.js";
import type { Policy } from "../types/policy.js";
import type { Store } from "../types/store.js";
import type { DaemonWrites } from "./busy-writes.js";

export interface KeepInDaemonContext {
  readonly commonDir: AbsolutePath;
  readonly worktreeId: WorktreeId;
  readonly store: Store;
  /** The policy the code store opens with (`complexity.enabled`). */
  readonly policy: () => Pick<Policy, "complexity">;
  readonly writes: DaemonWrites;
  readonly now: () => EpochMs;
}

/**
 * Spec 021 D15 (row 021-20, part two): one try of one write of a file the
 * code gate keeps (spec 020 D17.3), made by the daemon that holds the
 * worktree's lock, so the gate writes nothing itself while one serves. It
 * runs once in the daemon's retried path (`DaemonWrites`, one busy slice of
 * `BUSY_SLICE_MS`); a busy store's refusal answers `kept: false`, and the
 * gate pauses, reads the file's inputs again and counts its bound before
 * it asks again (D17.5), as it does when it writes itself. The rows are the
 * ones the gate writes itself: the record's parts at its key, and the
 * results through `storeResults` with the heals of `healsUnheld`.
 * Row 020-48 (spec 020 D17.3): and the reads of the gate's runs, merged
 * into the shared observed rows as the gate merges them where no daemon
 * serves (`mergeSeen`, the daemon's own `ObservedSets` and `ModuleSets`),
 * so the gate keeps a file at the key with what its run read.
 */
export async function keepInDaemon(
  context: KeepInDaemonContext,
  request: KeepRequest,
): Promise<KeepOutcome> {
  const { write } = request;
  if (write.kind === "seen") {
    return once(context, "the reads of a gate's runs", () => mergeSeen(context.store, write.seen));
  }
  if (write.kind === "coverage") {
    const code = openCodeStore(context.commonDir, context.policy(), {
      busyTimeoutMs: BUSY_SLICE_MS,
    });
    if (isCodeStoreOpenFailure(code)) {
      return { failed: `the code store did not open: ${code.reason}` };
    }
    try {
      const key = { resultKey: write.key, providerVersion: COVERAGE_RECORD_VERSION };
      // The gate built the record (`CoverageRecord`); `shareRecord` throws on one that is not.
      const shared = shareRecord(write.record as CoverageRecord, COVERAGE_RECORD_VERSION);
      return await once(context, "a kept file's coverage record", () =>
        code.coverage.putParts(key, shared, context.now()),
      );
    } finally {
      code.close();
    }
  }
  const { store, worktreeId, now } = context;
  // `storeResults` reads only `environmentFiles` of its keys (`unresolvedPreloads`): the gate's own.
  const keys: Pick<WorktreeKeys, "environmentFiles"> = {
    environmentFiles: () => write.environmentFiles,
  };
  return once(context, "a kept file's results", () =>
    storeResults(
      { store, keys: keys as WorktreeKeys, worktreeId, now },
      write.records,
      healsUnheld(store, write.paths),
    ),
  );
}

/** `write` once in the retried path: a busy store's refusal is `kept: false`. */
async function once(
  context: KeepInDaemonContext,
  what: string,
  write: () => unknown,
): Promise<KeepOutcome> {
  try {
    await context.writes.write(what, write, () => true);
    return { kept: true };
  } catch (error) {
    if (isBusy(error)) return { kept: false };
    throw error;
  }
}
