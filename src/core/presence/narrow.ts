import type {
  DaemonLiveness,
  DaemonStopping,
  EpochMs,
  Store,
  WorktreeId,
  WorktreeRecord,
} from "../types/index.js";
import { readPresence, stopHeld } from "./decide.js";
import { readPresenceFacts, type StopMark } from "./facts.js";
import { heartbeatFresh } from "./heartbeat.js";
import { editLineView } from "./views.js";

/*
 * Row 011-293, review 0.1.403 B2: the narrow readers. Each reads only the
 * facts its caller read before the move, at the same moment and in the same
 * order, and never probes the lock; the rules stay in presence. A fact read
 * twice before is read once now (`once`), and a fact read before only for a
 * finding the caller did not use is not read at all. `test/presence/io.test.ts`
 * counts their reads.
 */

/**
 * The hook's stop check (task 011-08, `ensure`): the stop by request that
 * holds by the store alone, from `row` the hook read. A fresh heartbeat reads
 * nothing; otherwise the stop mark alone.
 */
export function readHookStop(
  store: Store,
  worktreeId: WorktreeId,
  row: WorktreeRecord | null,
  at: EpochMs,
): StopMark | null {
  return stopHeld(readPresenceFacts(store, worktreeId, at, row), at);
}

/**
 * The hook's "Not validated" line after an edit (row 011-276): the row, then
 * for a stale record with an incarnation, its exit row, then its notes.
 */
export function readEditLine(store: Store, worktreeId: WorktreeId, at: EpochMs): DaemonLiveness {
  return editLineView(readPresenceFacts(store, worktreeId, at), at);
}

/** What the hook's handoff decision reads of the recorded daemon (`handOver`, row 011-32). */
export interface HookHandoff {
  /** Its heartbeat is fresh. */
  readonly alive: boolean;
  /** A live claim names it, so another hook claimed the handoff. */
  readonly joined: boolean;
  /** Its heartbeat stopped and it already took a step-down. */
  readonly stepping: boolean;
}

/**
 * The hook's handoff reading of `row`'s recorded daemon, of incarnation
 * `from`, inside the hook's read transaction: `null` when the short
 * handoff's mark names it (row 011-140), which is asked nothing again.
 * Reads the short handoff, then the claim, then, for a stale heartbeat only,
 * its shutdown (exit row, then notes). A step-down already taken is its
 * shutdown begun (every release from 0.1.121), or a claim that names it,
 * past its bound now, which only an accepted step-down writes.
 */
export function readHookHandoff(
  store: Store,
  worktreeId: WorktreeId,
  row: WorktreeRecord,
  from: string,
  at: EpochMs,
): HookHandoff | null {
  const facts = readPresenceFacts(store, worktreeId, at, row);
  const record = row.daemon;
  if (record === null || facts.short()?.of === from) return null;
  const alive = heartbeatFresh(record, at);
  const claim = facts.claim();
  const joined = claim !== null && claim.from === from && at < claim.boundAt;
  const stepping = !alive && (facts.shutDown() || claim?.from === from);
  return { alive, joined, stepping };
}

/** `squeal start`'s reading of the short handoff (row 011-140): the incarnation it names, `null` with none. */
export function readShortHandoffOf(
  store: Store,
  worktreeId: WorktreeId,
  at: EpochMs,
): string | null {
  return readPresenceFacts(store, worktreeId, at).short()?.of ?? null;
}

/**
 * The wait's stopping reading (`Presence.stopping`): with the record cleared,
 * the claim alone; else the shutdown, and once it began, the marks and the
 * lock while the heartbeat is down, the exit note and the claim.
 */
export function readStopping(
  store: Store,
  worktree: WorktreeRecord | null,
  at: EpochMs,
): DaemonStopping | undefined {
  if (worktree === null) return undefined;
  return readPresence(store, worktree.id, at, worktree).stopping ?? undefined;
}
