import { isNewerVersion } from "../daemon/version.js";
import { isRecord } from "../fs/index.js";
import { appendNote } from "../notes.js";
import {
  type DaemonRecord,
  daemonIncarnation,
  type EpochMs,
  type Store,
  type WorktreeId,
  worktreeMetaKey,
} from "../types/index.js";

/*
 * Row 011-32 (011 C9 as amended 2026-10-20, design 011-30 section 2, R2):
 * one successor per handoff. The hook whose step-down a daemon accepted
 * claims the handoff, the worktree's `daemonHandoff` row in `meta`, and
 * spawns the successor only when the claim it wrote is its own. A hook that
 * reads a live claim for the same incarnation asks nothing and spawns
 * nothing. The claim ends when its successor registers (`#register`), when
 * that successor's lock wait ends without the lock (`lockWaitTimedOut`), or
 * at its bound; then the next boundary claims again. Six hooks gave six
 * successors before it, which held 582 MB and used 12 CPU-seconds a minute
 * between them while they waited.
 */

/**
 * How long the successor a step-down spawns waits for the old daemon's lock
 * (task 001-130): its cancelled tiers, then its shutdown (row 011-31). A
 * daemon before 0.1.200 finishes its tier, which can outlast this wait; the
 * successor then exits with a note and the next boundary spawns.
 */
export const SUCCESSOR_LOCK_WAIT_MS = 120_000;

/** A claim's bound past its time: the successor's lock wait plus 10 s. */
export const HANDOFF_BOUND_MS = SUCCESSOR_LOCK_WAIT_MS + 10_000;

/** A worktree's handoff claim. */
export interface HandoffClaim {
  /** The incarnation of the daemon that steps down (`handoffFrom`). */
  readonly from: string;
  /** The claiming hook's version, which its successor runs. */
  readonly to: string;
  readonly at: EpochMs;
  /** `at` plus `HANDOFF_BOUND_MS`: from then on the claim holds nothing. */
  readonly boundAt: EpochMs;
}

/** `meta` key of the worktree's handoff claim. */
export function handoffMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("daemonHandoff", worktreeId);
}

/**
 * The incarnation a claim names for `record`: `daemonIncarnation`, or its
 * version and start time for a record with no start token (a release before
 * task 001-270).
 */
export function handoffFrom(record: DaemonRecord): string {
  return daemonIncarnation(record) ?? `${record.squealVersion}@${record.startedAt}`;
}

/** The worktree's handoff claim, live or not; `null` with none or one unreadable. */
export function readHandoff(store: Store, worktreeId: WorktreeId): HandoffClaim | null {
  const text = store.meta.get(handoffMetaKey(worktreeId));
  if (text === null) return null;
  try {
    const claim: unknown = JSON.parse(text);
    if (!isRecord(claim)) return null;
    const { from, to, at, boundAt } = claim;
    if (typeof from !== "string" || typeof to !== "string") return null;
    if (typeof at !== "number" || typeof boundAt !== "number") return null;
    return { from, to, at: at as EpochMs, boundAt: boundAt as EpochMs };
  } catch {
    return null;
  }
}

/** The worktree's claim while it holds at `now` for the daemon of incarnation `from`; `null` otherwise. */
export function liveHandoff(
  store: Store,
  worktreeId: WorktreeId,
  from: string,
  now: EpochMs,
): HandoffClaim | null {
  const claim = readHandoff(store, worktreeId);
  return claim !== null && claim.from === from && now < claim.boundAt ? claim : null;
}

/**
 * Claims the handoff from `from` to version `to` at `at`, in one write
 * transaction that reads the claim first: the claim written, or `null` when
 * a live claim for `from` was already there. Throws when the store stays
 * busy past its timeout; the hook then spawns as before (C9).
 */
export function claimHandoff(
  store: Store,
  worktreeId: WorktreeId,
  claim: Pick<HandoffClaim, "from" | "to" | "at">,
): HandoffClaim | null {
  return store.transaction(() => {
    if (liveHandoff(store, worktreeId, claim.from, claim.at) !== null) return null;
    const written = { ...claim, boundAt: (claim.at + HANDOFF_BOUND_MS) as EpochMs };
    store.meta.set(handoffMetaKey(worktreeId), JSON.stringify(written satisfies HandoffClaim));
    return written;
  });
}

/** Ends the worktree's claim: its successor registered, or its lock wait ended without the lock. */
export function clearHandoff(store: Store, worktreeId: WorktreeId): void {
  store.meta.delete(handoffMetaKey(worktreeId));
}

/*
 * Row 011-140 (011 C9, `research/issue-75-77.md` Q2): a Codex kept copy that
 * held older code than its name spawned every successor older than the claim
 * it ended, so the next hook stepped it down again, 39 times in 180 s. A
 * successor that registers older than the live claim it ends ends the
 * handoff short: one note, and a mark naming its incarnation, which no hook
 * asks to step down again (`handOver`) and which status and the next
 * liveness notice name with `squeal start`.
 */

/** A handoff that ended with a daemon older than its claim. */
export interface ShortHandoff {
  /** The incarnation that registered (`handoffFrom` of its record). */
  readonly of: string;
  /** Its version. */
  readonly version: string;
  /** The claim's version, which the successor was to run. */
  readonly claimed: string;
  /** When it registered. */
  readonly at: EpochMs;
}

/** `meta` key of the worktree's short handoff. */
export function shortHandoffMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("daemonHandoffShort", worktreeId);
}

/** What `endHandoff` reads of the daemon that registers. */
export interface Registering {
  /** Its incarnation, as `handoffFrom` names its record. */
  readonly of: string;
  readonly version: string;
  /** The script it runs, `process.argv[1]`. */
  readonly executable: string;
  readonly at: EpochMs;
}

/**
 * A daemon registers: the claim ends (row 011-32). When a live claim names a
 * version newer than the daemon's, the handoff ends short: its mark and one
 * note, naming both versions and the executable. Any other registration
 * clears an earlier mark. Call in the registering transaction.
 */
export function endHandoff(store: Store, worktreeId: WorktreeId, daemon: Registering): void {
  const claim = readHandoff(store, worktreeId);
  clearHandoff(store, worktreeId);
  const short =
    claim !== null && daemon.at < claim.boundAt && isNewerVersion(claim.to, daemon.version);
  if (!short) {
    store.meta.delete(shortHandoffMetaKey(worktreeId));
    return;
  }
  const mark: ShortHandoff = {
    of: daemon.of,
    version: daemon.version,
    claimed: claim.to,
    at: daemon.at,
  };
  store.meta.set(shortHandoffMetaKey(worktreeId), JSON.stringify(mark));
  const text =
    `the handoff to Squeal ${claim.to} ended with a ${daemon.version} daemon from ${daemon.executable}; ` +
    `no hook asks it to step down again, and \`squeal start\` of ${claim.to} replaces it`;
  appendNote(store, worktreeId, { at: daemon.at, revision: null, text });
}

/** The worktree's short handoff; `null` with none or one unreadable. */
export function readShortHandoff(store: Store, worktreeId: WorktreeId): ShortHandoff | null {
  const text = store.meta.get(shortHandoffMetaKey(worktreeId));
  if (text === null) return null;
  try {
    const mark: unknown = JSON.parse(text);
    if (!isRecord(mark)) return null;
    const { of, version, claimed, at } = mark;
    if (typeof of !== "string" || typeof version !== "string") return null;
    if (typeof claimed !== "string" || typeof at !== "number") return null;
    return { of, version, claimed, at: at as EpochMs };
  } catch {
    return null;
  }
}
