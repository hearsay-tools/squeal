import { testFileId } from "../keys/index.js";
import type {
  PendingRetries,
  PendingRetry,
  RunRecord,
  Store,
  TestFileKeyRecord,
  TestFileRef,
} from "../types/index.js";
import { gateClosedSince } from "./gate.js";
import { type HostLoad, hostLoad } from "./load.js";
import { type RetryRecord, readRetries } from "./records.js";

/**
 * Spec 001 D6 (001-368): the requests pending at the worktree's current keys,
 * one entry per test file, as status lists them; `{}` when none is. `runs`,
 * the live daemon's open ones, say since when a file's run is open.
 */
export function pendingRetriesOf(
  store: Store,
  keys: readonly TestFileKeyRecord[],
  load: () => HostLoad = hostLoad,
  runs: readonly RunRecord[] = [],
): { pendingRetries?: PendingRetries } {
  const current = new Map(keys.map((k) => [testFileId(k.testFile), k.key]));
  const byFile = new Map<string, RetryRecord[]>();
  for (const r of readRetries(store)) {
    const id = testFileId(r.testFile);
    if (r.end !== null || current.get(id) !== r.key) continue;
    byFile.set(id, [...(byFile.get(id) ?? []), r]);
  }
  if (byFile.size === 0) return {};
  const running = new Map(
    keys.filter((k) => k.pending === "running").map((k) => [testFileId(k.testFile), k]),
  );
  const retries = [...byFile.values()].map((records) => {
    const id = testFileId((records[0] as RetryRecord).testFile);
    // Row 011-27: its run is open while the live daemon's run holds the file.
    const run = running.has(id)
      ? runs.find((r) => r.testFiles.some((f) => testFileId(f) === id))
      : undefined;
    return { ...entry(records), ...(run === undefined ? {} : { runningSince: run.startedAt }) };
  });
  const { oneMinute, cpus } = load();
  return { pendingRetries: { retries, loadAverage: oneMinute, cpus } };
}

function entry(records: readonly RetryRecord[]): PendingRetry {
  const first = records[0] as RetryRecord;
  const testFile: TestFileRef = first.testFile;
  const since = gateClosedSince(records);
  return {
    testFile,
    reason: records.some((r) => r.reason === "environment") ? "environment" : "load",
    // A run asked for a file with no result starts at once whatever its reason (011 C5, gh-36).
    ...(records.some((r) => r.noResult === true) ? { noResult: true as const } : {}),
    askedAt: first.askedAt,
    claimedBy: records.find((r) => r.claim !== null)?.claim?.worktreeId ?? null,
    requests: records.length,
    // Row 011-213: since when the load gate has been closed on it.
    ...(since === null ? {} : { gateClosedAt: since }),
  };
}
