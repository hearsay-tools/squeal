/*
 * Daemon presence (row 011-293, `GLOSSARY.md`): what is known about a
 * worktree's daemon at one moment, read once from its stored facts, decided
 * once, and said to each audience by a named view.
 */
export {
  decidePresence,
  type MarkedStart,
  type Presence,
  type RestReading,
  readPresence,
  spawnStartCurrent,
} from "./decide.js";
export {
  type PresenceFacts,
  type RestMark,
  readFeedDelivered,
  readPresenceFacts,
  readRest,
  resumesRest,
  type StopMark,
} from "./facts.js";
export {
  beatBetween,
  claimLiveness,
  DAEMON_START_GRACE_MS,
  daemonLiveness,
  HEARTBEAT_GRACE_INTERVALS,
  heartbeatAge,
  heartbeatFresh,
  heartbeatGraceEnd,
  heartbeatGraceMs,
  heartbeatLateBy,
  lastHeartbeat,
  worktreeLiveness,
} from "./heartbeat.js";
export {
  type DaemonStart,
  daemonStart,
  type LockMarks,
  lockFree,
  readLockMarks,
  spawnedAt,
  spawnMarkFor,
  startMarked,
  startMarkFor,
  startOf,
} from "./marks.js";
export { type PresenceNote, type PresenceState, presenceState } from "./state.js";
export {
  editLineView,
  headerView,
  newsChange,
  statusView,
  stopOf,
  type ToldLiveness,
  toldOf,
  withoutStop,
  withToldStart,
} from "./views.js";
export {
  type DownReason,
  type SocketState,
  type WaitInputs,
  type WaitLiveness,
  type WaitReading,
  waitView,
} from "./wait.js";
