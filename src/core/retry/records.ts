import { randomUUID } from "node:crypto";
import { testFileId } from "../keys/index.js";
import type { CheckKey, EpochMs, Store, TestFileRef, WorktreeId } from "../types/index.js";

/*
 * Spec 001 D6 as amended (task 001-348 and its scope for 001-368, decided by
 * the human 2026-10-14): a failure whose cause lies outside its keyed inputs
 * is retried only when the agent asks, once per test file per key per
 * session. A request is kept in the shared store (D8), in one `meta` row of
 * every worktree, so it outlives the daemon that saw it and is run by
 * whichever daemon at its key claims it first; it lapses when the file's key
 * moves, since a worktree reads only the requests at its current key.
 */

/** `meta` key of every worktree's retry requests: the rows they re-run are shared. */
export const RETRIES_META_KEY = "retries";

/** The newest requests kept; an older one, ended or lapsed, is forgotten. */
export const RETRIES_KEPT = 1_024;

/**
 * Why the agent asks: `load`, a timeout under load, waits for the one-minute
 * load average to fall below the CPU count; `environment`, a service now
 * started, runs at once.
 */
export type RetryReason = "load" | "environment";

export const RETRY_REASONS: readonly RetryReason[] = ["load", "environment"];

/** How a request ended: its run passed or failed, ran to no result, or was withdrawn. */
export type RetryOutcome = "passed" | "failed" | "unknown" | "cancelled";

export interface RetryClaim {
  readonly worktreeId: WorktreeId;
  readonly at: EpochMs;
}

export interface RetryEnd {
  readonly outcome: RetryOutcome;
  readonly at: EpochMs;
  /** The worktree whose run ended it, or that withdrew it. */
  readonly worktreeId: WorktreeId;
}

/** One session's request to re-run one test file at one key. */
export interface RetryRecord {
  readonly id: string;
  readonly testFile: TestFileRef;
  readonly key: CheckKey;
  /** The harness session that asked; `""` when its shell named none. */
  readonly session: string;
  readonly reason: RetryReason;
  readonly askedAt: EpochMs;
  readonly askedIn: WorktreeId;
  /** The daemon's worktree that queued its run; `null` while no daemon has. */
  readonly claim: RetryClaim | null;
  /** `null` while it is pending. */
  readonly end: RetryEnd | null;
}

/** Every kept request, oldest first; empty when the row is absent or does not parse. */
export function readRetries(store: Store): RetryRecord[] {
  const raw = store.meta.get(RETRIES_META_KEY);
  if (raw === null) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter(isRecord) : [];
  } catch {
    return [];
  }
}

function writeRetries(store: Store, records: readonly RetryRecord[]): void {
  store.meta.set(RETRIES_META_KEY, JSON.stringify(records.slice(-RETRIES_KEPT)));
}

/** The requests for `testFile` at `key`, oldest first. */
export function retriesAt(
  records: readonly RetryRecord[],
  testFile: TestFileRef,
  key: CheckKey,
): RetryRecord[] {
  const id = testFileId(testFile);
  return records.filter((r) => r.key === key && testFileId(r.testFile) === id);
}

/**
 * Whether `record` spends its session's one retry at its key: a pending
 * request, or one whose run gave a result. A withdrawn one, or one whose run
 * gave none, does not.
 */
function spends(record: RetryRecord): boolean {
  return record.end === null || record.end.outcome === "passed" || record.end.outcome === "failed";
}

export interface RetryAsk {
  readonly testFile: TestFileRef;
  readonly key: CheckKey;
  readonly session: string;
  readonly reason: RetryReason;
  readonly at: EpochMs;
  readonly worktreeId: WorktreeId;
}

/**
 * What a request got: `queued`, a new pending request; `spent`, this session
 * already asked at this key (`record`, pending or ended), so the failure
 * stands.
 */
export type RetryAnswer =
  | { readonly kind: "queued"; readonly record: RetryRecord }
  | { readonly kind: "spent"; readonly record: RetryRecord };

/** Stores a request unless its session spent its retry at the key; one transaction. */
export function askRetry(store: Store, ask: RetryAsk): RetryAnswer {
  return store.transaction(() => {
    const records = readRetries(store);
    const spent = retriesAt(records, ask.testFile, ask.key)
      .filter((r) => r.session === ask.session && spends(r))
      .at(-1);
    if (spent !== undefined) return { kind: "spent", record: spent };
    const record: RetryRecord = {
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
    writeRetries(store, [...records, record]);
    return { kind: "queued", record };
  });
}

/**
 * Withdraws the pending requests for `testFile` at `key`, every session's:
 * one run serves them all. Returns the requests withdrawn.
 */
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

/**
 * Takes the pending requests for `testFile` at `key` for `worktreeId`'s
 * daemon: those no daemon claimed, this worktree's own (its earlier daemon
 * exited) and those whose claimant `live` says has no live daemon. Returns
 * whether any pending request is now this worktree's, in one transaction,
 * so two daemons at the key never both take it.
 */
export function claimRetries(
  store: Store,
  testFile: TestFileRef,
  key: CheckKey,
  worktreeId: WorktreeId,
  at: EpochMs,
  live: (worktreeId: WorktreeId) => boolean,
): boolean {
  return store.transaction(() => {
    const records = readRetries(store);
    const ids = new Set(
      retriesAt(records, testFile, key)
        .filter((r) => r.end === null)
        .filter(
          (r) => r.claim === null || r.claim.worktreeId === worktreeId || !live(r.claim.worktreeId),
        )
        .map((r) => r.id),
    );
    if (ids.size === 0) return false;
    writeRetries(
      store,
      records.map((r) => (ids.has(r.id) ? { ...r, claim: { worktreeId, at } } : r)),
    );
    return true;
  });
}

/** Gives back `worktreeId`'s claims on `testFile` (its key moved here): another daemon at the key may take them. */
export function releaseRetries(store: Store, testFile: TestFileRef, worktreeId: WorktreeId): void {
  store.transaction(() => {
    const records = readRetries(store);
    const id = testFileId(testFile);
    const mine = (r: RetryRecord) =>
      r.end === null && r.claim?.worktreeId === worktreeId && testFileId(r.testFile) === id;
    if (!records.some(mine)) return;
    writeRetries(
      store,
      records.map((r) => (mine(r) ? { ...r, claim: null } : r)),
    );
  });
}

/** Ends every pending request for `testFile` at `key` with the run's `end`. */
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

function isRecord(value: unknown): value is RetryRecord {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const ref = v.testFile as Record<string, unknown> | null | undefined;
  return (
    typeof v.id === "string" &&
    typeof ref === "object" &&
    ref !== null &&
    typeof ref.project === "string" &&
    typeof ref.path === "string" &&
    typeof v.key === "string" &&
    typeof v.session === "string" &&
    RETRY_REASONS.includes(v.reason as RetryReason) &&
    typeof v.askedAt === "number" &&
    typeof v.askedIn === "string" &&
    (v.claim === null || typeof v.claim === "object") &&
    (v.end === null || typeof v.end === "object")
  );
}
