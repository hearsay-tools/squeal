import { randomUUID } from "node:crypto";
import { testFileId } from "../keys/index.js";
import type { CheckKey, EpochMs, Store, TestFileRef, WorktreeId } from "../types/index.js";
import { addAskedKeys, heldIn, keptRetries, readAskedKeys, storedAt } from "./kept.js";

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

/**
 * The requests kept: past it, the oldest ended one, then the oldest pending
 * one at a key no worktree holds, is forgotten (`keptRetries`).
 */
export const RETRIES_KEPT = 1_024;

/**
 * Why the agent asks: `load`, a timeout under load, waits for the one-minute
 * load average to fall below the CPU count, at most `LOAD_RETRY_WAIT_MS`
 * (row 011-213); `environment`, a service now started, runs at once.
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
  /**
   * The run that ended it, the `Provenance.runId` of the results it stored;
   * absent for a withdrawal and for requests ended before review 001-398, S2.
   */
  readonly runId?: string;
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
  /**
   * Asked for a file with no result at its key, `unknown` or never run
   * (011 C5, gh-36): it runs at once whatever its reason and never spends
   * the session's retry, which bounds counted failures only. Absent on a
   * counted failure's request.
   */
  readonly noResult?: true;
  /**
   * A `load` request: when a daemon at its key first found it due with the
   * load gate closed (011 C5 as amended, row 011-213); it runs once
   * `LOAD_RETRY_WAIT_MS` later if the gate stays closed. Absent until then.
   */
  readonly gateClosedAt?: EpochMs;
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

/**
 * Replaces the row with `records`, trimmed as `keptRetries` keeps them; in
 * the caller's transaction. Before the trim it keeps the file and key of
 * each, dropped or kept, whoever stored it, as asked (row 011-224): the one
 * owner of the fact a named wait reads (review 0.1.322 B2).
 */
export function writeRetries(store: Store, records: readonly RetryRecord[]): void {
  const held = heldIn(store);
  addAskedKeys(store, records, held);
  store.meta.set(RETRIES_META_KEY, JSON.stringify(keptRetries(records, held, RETRIES_KEPT)));
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

/** Whether a request is pending for `testFile` at `key`. */
export function pendingAt(testFile: TestFileRef, key: CheckKey): (record: RetryRecord) => boolean {
  const id = testFileId(testFile);
  return (r) => r.end === null && r.key === key && testFileId(r.testFile) === id;
}

/**
 * Whether `record` spends its session's one retry at its key: a pending
 * request, or one whose run gave a result. A withdrawn one, or one whose run
 * gave none, does not.
 */
function spends(record: RetryRecord): boolean {
  if (record.noResult === true) return false;
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
    const record = newRecord(ask);
    writeRetries(store, [...records, record]);
    return { kind: "queued", record };
  });
}

/**
 * What a request for a file with no result at its key got (011 C5, gh-36):
 * `queued`, a new request whose one run starts at once; `joined`, a request
 * at the key is pending already (`record`), so nothing more is queued.
 */
export type NoResultAnswer = {
  readonly kind: "queued" | "joined";
  readonly record: RetryRecord;
};

/**
 * Stores a request to run a file that has no result at `ask.key` once,
 * outside the session's one retry, unless one is pending there; one
 * transaction.
 */
export function askNoResultRun(store: Store, ask: RetryAsk): NoResultAnswer {
  return store.transaction(() => {
    const records = readRetries(store);
    const pending = records.find(pendingAt(ask.testFile, ask.key));
    if (pending !== undefined) return { kind: "joined", record: pending };
    const record: RetryRecord = { ...newRecord(ask), noResult: true };
    writeRetries(store, [...records, record]);
    return { kind: "queued", record };
  });
}

/**
 * What a named wait's request got (row 011-207, 011 C15): `queued`, a new
 * request as `askNoResultRun` stores it; `joined`, one is pending at the key
 * (`record`); `asked`, one at the key ended or was withdrawn (`storedAt`), so
 * a wait asks no second run there; `changed`, the file no longer qualifies
 * (B1), so nothing is stored.
 */
export type NamedRunAnswer =
  | { readonly kind: "queued" | "joined"; readonly record: RetryRecord }
  | { readonly kind: "asked" | "changed" };

/**
 * Stores a request to run a file with no result at `ask.key` once, as
 * `askNoResultRun` does, only when no request was ever stored at the key,
 * pending or ended, kept in the row or as an asked key (B2), and
 * `stillAskable` holds: the wait's own check of the file, made again here
 * (C15: "the check and the write are one transaction"), so two waits at
 * once ask one run and a file queued, claimed, current or re-keyed since
 * the wait's read is not asked.
 */
export function askNamedRun(
  store: Store,
  ask: RetryAsk,
  stillAskable: () => boolean,
): NamedRunAnswer {
  return store.transaction(() => {
    const records = readRetries(store);
    const at = retriesAt(records, ask.testFile, ask.key);
    // Row 011-224: one an older Squeal stored keeps its fact past any later trim.
    addAskedKeys(store, at);
    const pending = at.find((r) => r.end === null);
    if (pending !== undefined) return { kind: "joined", record: pending };
    if (storedAt(records, readAskedKeys(store), ask.testFile, ask.key)) return { kind: "asked" };
    if (!stillAskable()) return { kind: "changed" };
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
  return endWhere(store, pendingAt(testFile, key), {
    outcome: "cancelled",
    at,
    worktreeId,
  });
}

/**
 * Decides, in one transaction, which daemon runs the pending requests for
 * `testFile` at `key`: one owner for the file and key, so two daemons there
 * never both queue it (review 001-398, B1). While another worktree's live
 * daemon (`live`) holds a claim there, every pending request at the key is
 * that daemon's, a session joining since included: its one run ends them.
 * Otherwise they are all `worktreeId`'s: those no daemon claimed, this
 * worktree's own (its earlier daemon exited) and a dead claimant's. Returns
 * whether they are now this worktree's to run.
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
    const pending = new Set(records.filter(pendingAt(testFile, key)));
    if (pending.size === 0) return false;
    const owner = [...pending]
      .map((r) => r.claim)
      .find((c) => c !== null && c.worktreeId !== worktreeId && live(c.worktreeId));
    const claim = owner ?? { worktreeId, at };
    const moves = (r: RetryRecord) =>
      pending.has(r) && (owner === undefined || r.claim?.worktreeId !== claim.worktreeId);
    if (records.some(moves)) {
      writeRetries(
        store,
        records.map((r) => (moves(r) ? { ...r, claim } : r)),
      );
    }
    return owner === undefined;
  });
}

/**
 * Gives back `worktreeId`'s claims on `testFile` (its key moved here, or it
 * is gone), but those at `keep`, its key here: another daemon at the key may
 * take them.
 */
export function releaseRetries(
  store: Store,
  testFile: TestFileRef,
  worktreeId: WorktreeId,
  keep: CheckKey | null = null,
): void {
  store.transaction(() => {
    const records = readRetries(store);
    const id = testFileId(testFile);
    const mine = (r: RetryRecord) =>
      r.end === null &&
      r.claim?.worktreeId === worktreeId &&
      r.key !== keep &&
      testFileId(r.testFile) === id;
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
  return endWhere(store, pendingAt(testFile, key), end);
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
