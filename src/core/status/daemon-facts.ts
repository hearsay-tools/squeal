import type { DaemonLiveness, EpochMs, Store, WorktreeRecord } from "../types/index.js";
import { withDeath } from "./died.js";
import { withLate } from "./feed-late.js";
import { withStopping } from "./stopping.js";

/**
 * `base` with what status and every header say of the daemon beyond its heartbeat: a daemon that
 * died without its stop note (`withDeath`, task 001-263), one stopping (`withStopping`, row
 * 011-34), and a live daemon's late change feed (`withLate`, row 011-200). Status's snapshot and
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
  return withLate(store, worktree, withStopping(store, worktree, died, now), now);
}
