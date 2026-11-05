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
  stopHeld,
} from "./decide.js";
export {
  claimHandoff,
  clearHandoff,
  clearRecord,
  clearStopped,
  endHandoff,
  FEED_STORED_STEP_MS,
  FeedDeliveredRow,
  forgetRest,
  markExit,
  markRest,
  markStopped,
  type Registering,
  type Registration,
  recordHeartbeat,
  recordRegistration,
  spawnedAfterRest,
} from "./events.js";
export { type PresenceFacts, readPresenceFacts, resumesRest } from "./facts.js";
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
export { clearStartMark, markSpawn, markStart } from "./lock-events.js";
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
export {
  type HookHandoff,
  readEditLine,
  readHookHandoff,
  readHookStop,
  readShortHandoffOf,
  readStopping,
} from "./narrow.js";
export { type PresenceNote, type PresenceState, presenceState } from "./state.js";
export {
  daemonExitMetaKey,
  daemonRestMetaKey,
  feedDeliveredMetaKey,
  HANDOFF_BOUND_MS,
  type HandoffClaim,
  handoffFrom,
  handoffMetaKey,
  liveHandoff,
  type RestMark,
  readFeedDelivered,
  readHandoff,
  readRest,
  readShortHandoff,
  readStop,
  type ShortHandoff,
  type StopMark,
  SUCCESSOR_LOCK_WAIT_MS,
  shortHandoffMetaKey,
  stoppedMetaKey,
} from "./stored.js";
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
