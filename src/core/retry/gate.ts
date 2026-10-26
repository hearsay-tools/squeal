import type { CheckKey, EpochMs, Store, TestFileRef } from "../types/index.js";
import { pendingAt, type RetryRecord, readRetries, retriesAt, writeRetries } from "./records.js";

/*
 * Spec 011 C5 as amended (row 011-213, gh-92): a `load` retry waits for the
 * load gate at most `LOAD_RETRY_WAIT_MS`, counted from the first look at
 * which a daemon at its key found it due with the gate closed, then runs
 * once, and the daemon notes the load it was queued under. The time is kept
 * on each pending request at the key; the earliest governs, since one run
 * ends them all.
 */

/** The most a `load` retry waits for the load gate: 600 s, the value of 004 D3's `slow.maxDeferMs` default. */
export const LOAD_RETRY_WAIT_MS = 600_000;

/** The earliest time a request among `records` met the gate closed; `null` when none has. */
export function gateClosedSince(records: readonly RetryRecord[]): EpochMs | null {
  const times = records.flatMap((r) =>
    typeof r.gateClosedAt === "number" ? [r.gateClosedAt] : [],
  );
  return times.length === 0 ? null : Math.min(...times);
}

/**
 * The gate is closed at `at` for the pending requests for `testFile` at
 * `key`: each that has no time yet gets `at`, in one transaction, and the
 * earliest time among them is returned. `pending` is the caller's read: when
 * every request in it has a time, nothing is written.
 */
export function markGateClosed(
  store: Store,
  pending: readonly RetryRecord[],
  testFile: TestFileRef,
  key: CheckKey,
  at: EpochMs,
): EpochMs {
  const known = retriesAt(pending, testFile, key);
  const since = gateClosedSince(known);
  if (since !== null && known.every((r) => r.gateClosedAt !== undefined)) return since;
  return store.transaction(() => {
    const records = readRetries(store);
    const open = pendingAt(testFile, key);
    const stamped = records.map((r) =>
      open(r) && r.gateClosedAt === undefined ? { ...r, gateClosedAt: at } : r,
    );
    if (stamped.some((r, i) => r !== records[i])) writeRetries(store, stamped);
    return gateClosedSince(stamped.filter(open)) ?? at;
  });
}
