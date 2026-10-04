import { HEARTBEAT_GRACE_INTERVALS } from "../status/snapshot.js";
import type { DaemonLiveness, DaemonRecord, EpochMs } from "../types/index.js";

/**
 * Daemon liveness from the heartbeat the daemon records in `worktrees`,
 * judged as `squeal status` judges it (spec 001 D10), so a header and status
 * never disagree. Review wave 3, S2: delivered text says when no daemon is
 * validating; hooks restart one when the heartbeat is this old.
 */
export function daemonLiveness(record: DaemonRecord | null, now: EpochMs): DaemonLiveness {
  if (record === null) return { state: "down", since: null };
  if (now - record.heartbeatAt <= record.heartbeatIntervalMs * HEARTBEAT_GRACE_INTERVALS) {
    return { state: "alive", lastHeartbeatAt: record.heartbeatAt };
  }
  return { state: "down", since: record.heartbeatAt };
}
