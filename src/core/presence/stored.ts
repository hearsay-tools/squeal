import { isRecord } from "../fs/index.js";
import {
  type DaemonRecord,
  daemonIncarnation,
  type EpochMs,
  type Store,
  type WorktreeId,
  worktreeMetaKey,
} from "../types/index.js";

/*
 * Row 011-294: the meta rows daemon presence stores, by key, with their
 * stored forms and parsers. Only presence names these keys: the events
 * (`events.ts`) write them and the facts (`facts.ts`) read them. The forms
 * are the ones every earlier release stored, so a daemon of the previous
 * release and one of this release read each other's rows.
 */

/**
 * `meta` key of the incarnation (`daemonIncarnation`) whose shutdown began,
 * written first by its exit path and cleared by the next registration
 * (`markExit`, `recordRegistration`), which presence reads to tell a kill
 * while it shut down from a death (task 001-274). Outside the capped notes,
 * so no number of later notes evicts it (review wave-13ag B1).
 */
export function daemonExitMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("daemonExit", worktreeId);
}

/**
 * `meta` key of when a daemon stopped unused (D10 as amended, task 001-415):
 * while its record is cleared and no heartbeat came after it, the worktree's
 * daemon rests, and its consumers are told nothing about it (`livenessChange`).
 */
export function daemonRestMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("daemonRest", worktreeId);
}

/** D10 as amended (task 001-415): a daemon stopped unused at `at`; a hook spawned one after it at `spawnedAt`. */
export interface RestMark {
  readonly at: EpochMs;
  readonly spawnedAt?: EpochMs;
}

/** The worktree's rest mark; `null` with none or one unreadable. */
export function readRest(store: Store, worktreeId: WorktreeId): RestMark | null {
  const rest = parsed(store.meta.get(daemonRestMetaKey(worktreeId)));
  if (!isRecord(rest) || typeof rest.at !== "number") return null;
  const spawnedAt = typeof rest.spawnedAt === "number" ? { spawnedAt: rest.spawnedAt } : {};
  return { at: rest.at as EpochMs, ...spawnedAt };
}

/** `squeal stop` at `at`, the tree printed as `tree` (`treePrint`), `null` when git could not tell. */
export interface StopMark {
  readonly at: EpochMs;
  readonly tree: string | null;
  /** Row 011-254: `squeal stop --until-start`; no edit, Git operation or heartbeat ends it. */
  readonly untilStart?: true;
}

/** `meta` key of the worktree's stopped mark (task 011-08). */
export function stoppedMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("daemonStopped", worktreeId);
}

/** The worktree's stopped mark as stored, `null` with none or one unreadable. */
export function readStop(store: Store, worktreeId: WorktreeId): StopMark | null {
  const text = store.meta.get(stoppedMetaKey(worktreeId));
  if (text === null) return null;
  try {
    const mark: unknown = JSON.parse(text);
    if (!isRecord(mark) || typeof mark.at !== "number") return null;
    return {
      at: mark.at as EpochMs,
      tree: typeof mark.tree === "string" ? mark.tree : null,
      ...(mark.untilStart === true ? { untilStart: true } : {}),
    };
  } catch {
    return null;
  }
}

/*
 * Row 011-32 (011 C9 as amended 2026-10-20, design 011-30 section 2, R2):
 * one successor per handoff. The hook whose step-down a daemon accepted
 * claims the handoff, the worktree's `daemonHandoff` row in `meta`, and
 * spawns the successor only when the claim it wrote is its own. A hook that
 * reads a live claim for the same incarnation asks nothing and spawns
 * nothing. The claim ends when its successor registers, when that
 * successor's lock wait ends without the lock, or at its bound; then the
 * next boundary claims again (`events.ts`).
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

/** `meta` key of the start of the last batch `worktreeId`'s change feed delivered, as stored (row 011-200). */
export function feedDeliveredMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("feedDelivered", worktreeId);
}

/** When the last batch the worktree's change feed delivered started, as stored; `null` when none is. */
export function readFeedDelivered(store: Store, worktreeId: WorktreeId): EpochMs | null {
  const raw = store.meta.get(feedDeliveredMetaKey(worktreeId));
  const at = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(at) ? (at as EpochMs) : null;
}

function parsed(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
