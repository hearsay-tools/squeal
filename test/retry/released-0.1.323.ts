import { randomUUID } from "node:crypto";
import {
  RETRIES_KEPT,
  RETRIES_META_KEY,
  type RetryAsk,
  type RetryEnd,
  type RetryRecord,
  readRetries,
  retriesAt,
} from "../../src/core/retry/index.js";
import type {
  CheckKey,
  EpochMs,
  Store,
  TestFileRef,
  WorktreeId,
} from "../../src/core/types/index.js";

/*
 * The request writer Squeal 0.1.323 shipped, copied from
 * `squeal--v0.1.323:src/core/retry/records.ts` (row 011-224): it stores
 * requests in the same `retries` row, keeps the newest `RETRIES_KEPT`
 * whatever they are, and writes no `retries-asked` fact. `readRetries` and
 * `retriesAt` are unchanged since, so they are imported.
 */

function writeRetries(store: Store, records: readonly RetryRecord[]): void {
  store.meta.set(RETRIES_META_KEY, JSON.stringify(records.slice(-RETRIES_KEPT)));
}

function spends(record: RetryRecord): boolean {
  if (record.noResult === true) return false;
  return record.end === null || record.end.outcome === "passed" || record.end.outcome === "failed";
}

export function askRetry(store: Store, ask: RetryAsk) {
  return store.transaction(() => {
    const records = readRetries(store);
    const spent = retriesAt(records, ask.testFile, ask.key)
      .filter((r) => r.session === ask.session && spends(r))
      .at(-1);
    if (spent !== undefined) return { kind: "spent", record: spent };
    const record = newRecord(ask);
    writeRetries(store, [...records, record]);
    return { kind: "queued", record };
  });
}

export function askNoResultRun(store: Store, ask: RetryAsk) {
  return store.transaction(() => {
    const records = readRetries(store);
    const pending = retriesAt(records, ask.testFile, ask.key).find((r) => r.end === null);
    if (pending !== undefined) return { kind: "joined", record: pending };
    const record: RetryRecord = { ...newRecord(ask), noResult: true };
    writeRetries(store, [...records, record]);
    return { kind: "queued", record };
  });
}

function newRecord(ask: RetryAsk): RetryRecord {
  return {
    id: randomUUID(),
    testFile: ask.testFile,
    key: ask.key,
    session: ask.session,
    reason: ask.reason,
    askedAt: ask.at,
    askedIn: ask.worktreeId,
    claim: null,
    end: null,
  };
}

export function cancelRetries(
  store: Store,
  testFile: TestFileRef,
  key: CheckKey,
  worktreeId: WorktreeId,
  at: EpochMs,
): RetryRecord[] {
  return endWhere(store, (r) => r.end === null && retriesAt([r], testFile, key).length > 0, {
    outcome: "cancelled",
    at,
    worktreeId,
  });
}

export function endRetries(
  store: Store,
  testFile: TestFileRef,
  key: CheckKey,
  end: RetryEnd,
): RetryRecord[] {
  return endWhere(store, (r) => r.end === null && retriesAt([r], testFile, key).length > 0, end);
}

function endWhere(
  store: Store,
  match: (record: RetryRecord) => boolean,
  end: RetryEnd,
): RetryRecord[] {
  return store.transaction(() => {
    const records = readRetries(store);
    const ended = records.filter(match).map((r) => ({ ...r, end }));
    if (ended.length === 0) return [];
    const byId = new Map(ended.map((r) => [r.id, r]));
    writeRetries(
      store,
      records.map((r) => byId.get(r.id) ?? r),
    );
    return ended;
  });
}
