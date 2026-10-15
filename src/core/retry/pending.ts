import { testFileId } from "../keys/index.js";
import type {
  PendingRetries,
  PendingRetry,
  Store,
  TestFileKeyRecord,
  TestFileRef,
} from "../types/index.js";
import { type HostLoad, hostLoad } from "./load.js";
import { type RetryRecord, readRetries } from "./records.js";

/**
 * Spec 001 D6 (001-368): the requests pending at the worktree's current keys,
 * one entry per test file, as status lists them; `{}` when none is.
 */
export function pendingRetriesOf(
  store: Store,
  keys: readonly TestFileKeyRecord[],
  load: () => HostLoad = hostLoad,
): { pendingRetries?: PendingRetries } {
  const current = new Map(keys.map((k) => [testFileId(k.testFile), k.key]));
  const byFile = new Map<string, RetryRecord[]>();
  for (const r of readRetries(store)) {
    const id = testFileId(r.testFile);
    if (r.end !== null || current.get(id) !== r.key) continue;
    byFile.set(id, [...(byFile.get(id) ?? []), r]);
  }
  if (byFile.size === 0) return {};
  const retries = [...byFile.values()].map(entry);
  const { oneMinute, cpus } = load();
  return { pendingRetries: { retries, loadAverage: oneMinute, cpus } };
}

function entry(records: readonly RetryRecord[]): PendingRetry {
  const first = records[0] as RetryRecord;
  const testFile: TestFileRef = first.testFile;
  return {
    testFile,
    reason: records.some((r) => r.reason === "environment") ? "environment" : "load",
    askedAt: first.askedAt,
    claimedBy: records.find((r) => r.claim !== null)?.claim?.worktreeId ?? null,
    requests: records.length,
  };
}
