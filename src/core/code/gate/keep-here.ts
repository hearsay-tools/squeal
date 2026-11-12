import { healsUnheld } from "../../scheduler/hold.js";
import { storeResults } from "../../scheduler/store-results.js";
import { BUSY_SLICE_MS } from "../../store/busy.js";
import { isBusy, withBusySliceSync } from "../../store/connection.js";
import type { EpochMs, WorktreeId } from "../../types/common.js";
import type { Store } from "../../types/store.js";
import { shareRecord } from "../coverage/parts.js";
import { COVERAGE_RECORD_VERSION } from "../coverage/record.js";
import type { CodeStore } from "../store/types.js";
import type { KeepWriter, Tried } from "./keep-write.js";

/** The writer with no daemon serving: each try on the keeper's own connections, one busy slice. */
export function writeHere(
  stores: { readonly store: Store; readonly code: CodeStore },
  worktreeId: WorktreeId,
  now: () => EpochMs,
): KeepWriter {
  const { store, code } = stores;
  return {
    coverage: async (file) => {
      const recordKey = { resultKey: file.key, providerVersion: COVERAGE_RECORD_VERSION };
      const shared = shareRecord(file.record, COVERAGE_RECORD_VERSION);
      return tried(() => code.coverage.putParts(recordKey, shared, now()));
    },
    results: async (file, records, keys) =>
      tried(() =>
        storeResults({ store, keys, worktreeId, now }, records, healsUnheld(store, file.paths)),
      ),
  };
}

/** `write`, one synchronous transaction, tried once with one busy slice. */
function tried(write: () => unknown): Tried {
  try {
    withBusySliceSync(BUSY_SLICE_MS, write);
    return "kept";
  } catch (error) {
    if (!isBusy(error)) throw error;
    return "busy";
  }
}
