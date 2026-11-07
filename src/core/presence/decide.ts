import type { EpochMs, WorktreeId } from "../types/common.js";
import { daemonIncarnation } from "../types/daemon.js";
import type {
  DaemonDeath,
  DaemonLiveness,
  DaemonShort,
  DaemonStopping,
  FeedLate,
  HeartbeatLate,
} from "../types/status.js";
import type { Store } from "../types/store.js";
import type { DaemonRecord, WorktreeRecord } from "../types/store-records.js";
import { type PresenceFacts, readPresenceFacts } from "./facts.js";
import {
  heldStop,
  lateOf,
  liveOf,
  restOf,
  shortOf,
  startCurrentOf,
  startOfMarks,
  stoppingOf,
} from "./findings.js";
import { lastHeartbeat } from "./heartbeat.js";
import { type DaemonStart, startOf } from "./marks.js";
import { once } from "./once.js";
import type { StopMark } from "./stored.js";

/*
 * Row 011-293 (`research/daemon-presence.md`, decisions 1 and 3): what is
 * known about a worktree's daemon, decided once from its facts. Each finding
 * below is one rule; the views (`views.ts`) say them to their audiences, and
 * `presenceState` (`state.ts`) names the one state they add up to.
 */

/** A rest (`Presence.rest`): quiet, with the spawn after it if one came, or overdue. */
export type RestReading =
  | { readonly kind: "quiet"; readonly spawnedAt?: EpochMs }
  | { readonly kind: "overdue" };

/** A start the marks say: `start`, a daemon holds the lock and marked it; `spawn`, a hook spawned one. */
export interface MarkedStart {
  readonly since: EpochMs;
  readonly mark: "start" | "spawn";
}

/** Daemon presence at one moment: the facts, and what each rule decided from them. */
export interface Presence {
  readonly facts: PresenceFacts;
  readonly at: EpochMs;
  /** The recorded daemon, `null` with none. */
  readonly record: DaemonRecord | null;
  /** The heartbeat alone (`daemonLiveness`). */
  readonly heartbeat: DaemonLiveness;
  /** Its shutdown began (`PresenceFacts.shutDown`). */
  readonly shutDown: boolean;
  /** The marks beside the lock with the last heartbeat (row 011-251); `null` without a row. */
  readonly marks: DaemonStart | null;
  /**
   * A start is current: a start mark that names a live process, with any
   * record; a spawn mark within its grace, with the record cleared only, since
   * a busy daemon may hold the lock behind a stale one.
   */
  readonly startCurrent: boolean;
  /** The stop by request that holds by the store alone (`heldStop`), before a current start wins. */
  readonly stop: StopMark | null;
  /** The stop by request said: it holds and no start is current (review 0.1.357 B1). */
  readonly stopped: boolean;
  /** Row 011-34: the recorded daemon stopping, or after it cleared its record, a live claim. */
  readonly stopping: DaemonStopping | null;
  /** Row 011-251: a daemon's start the marks say, while the heartbeat is down. */
  readonly start: MarkedStart | null;
  /** Task 001-415: the daemon rests after it stopped unused; `null` with no rest. */
  readonly rest: RestReading | null;
  /** Row 011-140: an alive daemon that registered older than the claim it ended. */
  readonly short: DaemonShort | null;
  /** Row 011-200: a live daemon's change feed is late. */
  readonly late: FeedLate | null;
  /** Task 001-263: the recorded daemon died without shutting down. Probes the lock at the first call. */
  readonly died: () => DaemonDeath | null;
  /** Row 011-276: a late heartbeat nothing else explains. Probes the lock at the first call. */
  readonly heartbeatLate: () => HeartbeatLate | null;
}

/** The presence of `worktreeId`'s daemon at `now` from the store (`readPresenceFacts`, `decidePresence`). */
export function readPresence(
  store: Store,
  worktreeId: WorktreeId,
  now: EpochMs,
  row?: WorktreeRecord | null,
): Presence {
  return decidePresence(readPresenceFacts(store, worktreeId, now, row), now);
}

/**
 * Decides presence from `facts` at `at`. Each decision is made at its first
 * use only, and once, reading only the facts its rule asks for (review
 * 0.1.403 B2): a view pays for what it says.
 */
export function decidePresence(facts: PresenceFacts, at: EpochMs): Presence {
  const record = once(() => facts.row()?.daemon ?? null);
  const heartbeat = once(() => liveOf(facts, at));
  const down = () => heartbeat().state === "down";
  const shutDown = once(() => daemonIncarnation(record()) !== null && facts.shutDown());
  const marks = once(() => {
    const read = facts.marks();
    return read === null ? null : startOf(read, at, lastHeartbeat(facts.row()));
  });
  const startCurrent = once(() => startCurrentOf(marks(), record()));
  const stop = once(() => heldStop(facts, heartbeat()));
  // Review 0.1.403-r2 B2: a current start settles it before the stop mark is read, as `asStopped` did.
  const stopped = once(() => !startCurrent() && stop() !== null);
  const stopping = once(() => stoppingOf(facts, record(), shutDown, heartbeat(), marks, at));
  const start = once(() => startOfMarks(facts, record(), down(), stopping, marks));
  const died = once((): DaemonDeath | null => {
    if (!down() || record() === null || shutDown() || marks() !== null) return null;
    return facts.lockFree() ? { runs: facts.inFlight() } : null;
  });
  const rest = once(() => restOf(facts, at));
  const short = once(() => shortOf(facts, record(), shutDown, heartbeat()));
  const late = once(() => lateOf(facts, record(), heartbeat(), stopping, at));
  const heartbeatLate = once((): HeartbeatLate | null => {
    const daemon = record();
    if (!down() || daemon === null || shutDown() || start() !== null || stopped()) return null;
    return died() === null ? { ageMs: at - daemon.heartbeatAt } : null;
  });
  return {
    facts,
    at,
    get record() {
      return record();
    },
    get heartbeat() {
      return heartbeat();
    },
    get shutDown() {
      return shutDown();
    },
    get marks() {
      return marks();
    },
    get startCurrent() {
      return startCurrent();
    },
    get stop() {
      return stop();
    },
    get stopped() {
      return stopped();
    },
    get stopping() {
      return stopping();
    },
    get start() {
      return start();
    },
    get rest() {
      return rest();
    },
    get short() {
      return short();
    },
    get late() {
      return late();
    },
    died,
    heartbeatLate,
  };
}
