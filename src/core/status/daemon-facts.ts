import {
  type DaemonLiveness,
  daemonIncarnation,
  type EpochMs,
  type Store,
  type WorktreeRecord,
} from "../types/index.js";
import { shutDown, withDeath } from "./died.js";
import { withLate } from "./feed-late.js";
import { withStopping } from "./stopping.js";

/**
 * `base` with what status and every header say of the daemon beyond its heartbeat: a daemon that
 * died without its stop note (`withDeath`, task 001-263), one stopping (`withStopping`, row
 * 011-34), a late heartbeat that none of them explains (`withLateHeartbeat`, row 011-276), and a
 * live daemon's late change feed (`withLate`, row 011-200). Status's snapshot and
 * `readLiveHeader` both read it, each over its own base. `livenessChange` reads `withStopping`
 * alone: a late feed starts no delivery of its own (C5).
 */
export function withDaemonFacts(
  store: Store,
  worktree: WorktreeRecord | null,
  base: DaemonLiveness,
  now: EpochMs,
): DaemonLiveness {
  const died = withDeath(store, worktree, base, now);
  const stopping = withStopping(store, worktree, died, now);
  return withLate(store, worktree, withLateHeartbeat(store, worktree, stopping, now), now);
}

/**
 * Row 011-276 (gh-109, gh-128; the human, 2026-10-30: wording only): a down `live` whose record
 * is not cleared, with no stop, exit or start recorded, has a late heartbeat, not a stopped
 * daemon. A shutdown clears the record or marks its start (`shutDown`); `squeal stop` marks
 * `stopped`; a death or a start is read from the lock (`withDeath`). No new probe: the record,
 * the marks and the lock are what the other facts read.
 */
export function withLateHeartbeat(
  store: Store,
  worktree: WorktreeRecord | null,
  live: DaemonLiveness,
  now: EpochMs,
): DaemonLiveness {
  const record = worktree?.daemon ?? null;
  if (live.state !== "down" || worktree === null || record === null) return live;
  const self = daemonIncarnation(record);
  if (self !== null && shutDown(store, worktree.id, self)) return live;
  const explained =
    live.died !== undefined ||
    live.stopping !== undefined ||
    live.stopped === true ||
    live.startingSince !== undefined ||
    live.resting === true;
  return explained ? live : { ...live, heartbeatLate: { ageMs: now - record.heartbeatAt } };
}
