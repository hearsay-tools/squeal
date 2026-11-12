import { healsUnheld } from "../../scheduler/hold.js";
import { storeResults } from "../../scheduler/store-results.js";
import { BUSY_SLICE_MS } from "../../store/busy.js";
import { isBusy, withBusySliceSync } from "../../store/connection.js";
import type { AbsolutePath, EpochMs, WorktreeId } from "../../types/common.js";
import type { Policy } from "../../types/policy.js";
import type { Store } from "../../types/store.js";
import { shareRecord } from "../coverage/parts.js";
import { COVERAGE_RECORD_VERSION } from "../coverage/record.js";
import { isCodeStoreOpenFailure, openCodeStore } from "../store/open.js";
import type { CodeStore } from "../store/types.js";
import { mergeSeen } from "./keep-seen.js";
import { DAEMON_KEEPS_ITS_OWN, type DaemonWaits, sentWriter } from "./keep-sent.js";
import { type KeepWriter, notKept, type Tried } from "./keep-write.js";

/**
 * The writer with no daemon serving: each try on the keeper's own
 * connections, one busy slice. Row 020-39: it alone merges the runs' reads
 * into the shared observed rows.
 */
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
    seen: async (seen) => tried(() => mergeSeen(store, seen)),
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

/**
 * The keeper's writer: its own under the worktree's lock (`locked`), with
 * the code store it opened, created as a daemon creates it; else the
 * serving daemon's (spec 021 D15), for `at.files` files: `null` when there
 * are none, or when the daemon keeps its own, which `at.tell` says.
 */
export function writerFor(
  store: Store,
  locked: boolean,
  at: {
    readonly commonDir: AbsolutePath;
    readonly policy: Policy;
    readonly worktreeId: WorktreeId;
    readonly now: () => EpochMs;
    readonly daemonWaits: DaemonWaits | undefined;
    readonly files: number;
    readonly tell: (text: string) => void;
  },
): { readonly writer: KeepWriter; readonly code: CodeStore | null } | null {
  const { worktreeId, now } = at;
  if (locked) {
    const code = openCodeStore(at.commonDir, at.policy);
    if (isCodeStoreOpenFailure(code))
      throw new Error(`the code store did not open: ${code.reason}`);
    return { writer: writeHere({ store, code }, worktreeId, now), code };
  }
  if (at.files === 0) return null;
  const sent = sentWriter(store, worktreeId, now(), at.daemonWaits);
  if (sent === null) at.tell(`${notKept(at.files)}: ${DAEMON_KEEPS_ITS_OWN}`);
  return sent === null ? null : { writer: sent, code: null };
}
