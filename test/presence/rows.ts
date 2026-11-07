import type { PresenceNote, PresenceState } from "../../src/core/presence/state.js";
import type { StopMark } from "../../src/core/presence/stored.js";
import { HANDOFF_BOUND_MS } from "../../src/core/presence/stored.js";
import type { ToldLiveness } from "../../src/core/presence/told.js";
import type { DaemonLiveness } from "../../src/core/types/status.js";
import { at, OPEN_RUN, SELF, START_MARKED, type Stored, VERSION } from "./fixture.js";

/*
 * Row 011-293: the presence table. Each row is stored facts and a clock, the
 * presence state with its notes, and each view's output. A row names the
 * header, news and edit-line views only where they differ from status.
 */

export interface Row {
  readonly name: string;
  readonly stored: Stored;
  readonly now?: number;
  readonly state: PresenceState;
  readonly notes?: readonly PresenceNote[];
  readonly status: DaemonLiveness;
  /** Default: `status`. */
  readonly header?: DaemonLiveness;
  /** What the consumer was told, for news and the told header; default `alive`. */
  readonly told?: ToldLiveness;
  /** The header with `told`; default: `header`. */
  readonly toldHeader?: DaemonLiveness;
  /** News for `told`; default: `status` when its state differs from `told`'s, else `null`. */
  readonly news?: DaemonLiveness | null;
  readonly forgetRest?: true;
  /**
   * The hook's "Not validated" line. Default: `status` where a hook prints it
   * (a down daemon, no stop held, no start current), else the heartbeat alone.
   */
  readonly editLine?: DaemonLiveness;
  /** The hook spawn's view: a start is current, so it spawns no second daemon. */
  readonly spawn?: true;
  /** The hook's stop check: the stop by request that holds by the store alone; default none. */
  readonly heldStop?: StopMark;
}

export const alive = { state: "alive", lastHeartbeatAt: at(-2_000) } as const;
export const stale = { state: "down", since: at(-12_000) } as const;
export const cleared = { state: "down", since: at(-60_000) } as const;
export const late = { ageMs: 12_000 };
const short = {
  ...alive,
  short: { of: SELF, version: VERSION, claimed: "0.1.401", since: at(-50_000) },
} as const;
export const claimed = { to: "0.1.401", boundAt: at(-11_000 + HANDOFF_BOUND_MS) };

export const rows: readonly Row[] = [
  {
    name: "a fresh heartbeat",
    stored: { heartbeat: -2_000 },
    state: "validating",
    status: alive,
    news: null,
  },
  {
    name: "a heartbeat at the end of its grace",
    stored: { heartbeat: -10_000 },
    state: "validating",
    status: { state: "alive", lastHeartbeatAt: at(-10_000) },
    news: null,
  },
  {
    name: "a daemon that ended its handoff short, told once",
    stored: { heartbeat: -2_000, short: true },
    state: "validating",
    notes: ["handoff ended short"],
    status: short,
    news: short,
  },
  {
    name: "a short handoff already told",
    stored: { heartbeat: -2_000, short: true },
    state: "validating",
    notes: ["handoff ended short"],
    status: short,
    told: { short: SELF },
    news: null,
  },
  {
    name: "a late change feed, which is no news",
    stored: { heartbeat: -2_000, feed: -120_000 },
    state: "validating",
    notes: ["change feed late"],
    status: { ...alive, late: { since: at(-120_000) } },
    news: null,
  },
  {
    name: "a fresh heartbeat whose shutdown began",
    stored: { heartbeat: -2_000, exit: { note: -1_000 } },
    state: "stopping",
    status: { ...alive, stopping: { from: VERSION, since: at(-1_000), overdue: false } },
  },
  {
    name: "a stale heartbeat handing over, its lock held",
    stored: { heartbeat: -12_000, exit: { note: -12_000 }, claim: -11_000, lock: "held" },
    state: "stopping",
    status: {
      ...stale,
      stopping: { from: VERSION, since: at(-12_000), ...claimed, overdue: false },
    },
    told: "down",
  },
  {
    name: "a stop past its bound",
    stored: { heartbeat: -12_000, exit: "mark", lock: "held" },
    now: -12_000 + HANDOFF_BOUND_MS,
    state: "stopping",
    status: {
      state: "down",
      since: at(-12_000),
      stopping: { from: VERSION, since: at(-12_000), overdue: true },
    },
  },
  {
    name: "a live claim after the old daemon cleared its record",
    stored: { lastHeartbeat: -12_000, claim: -11_000 },
    state: "stopping",
    status: {
      ...stale,
      stopping: { from: VERSION, since: at(-11_000), ...claimed, overdue: false },
    },
  },
  {
    name: "a claim past its bound after the old daemon cleared its record",
    stored: { lastHeartbeat: -12_000, claim: -11_000 - HANDOFF_BOUND_MS },
    state: "gone",
    status: stale,
  },
  {
    name: "another incarnation's exit mark, its lock held",
    stored: { heartbeat: -12_000, exit: "other", lock: "held" },
    state: "heartbeat late",
    status: { ...stale, heartbeatLate: late },
  },
  {
    name: "a shutdown whose lock is free",
    stored: { heartbeat: -12_000, exit: "mark", lock: "free" },
    state: "gone",
    status: stale,
  },
  {
    name: "a daemon that marks its start, its record cleared",
    spawn: true,
    stored: { lastHeartbeat: -60_000, startMark: true, lock: "held" },
    state: "starting",
    status: { ...cleared, startingSince: START_MARKED, startMark: "start" },
    news: null,
  },
  {
    name: "a hook's spawn, its record cleared",
    spawn: true,
    stored: { lastHeartbeat: -60_000, spawnMark: -1_000 },
    state: "starting",
    status: { ...cleared, startingSince: at(-1_000), startMark: "spawn" },
    news: null,
  },
  {
    name: "a start marked in place of a stale record",
    spawn: true,
    stored: { heartbeat: -12_000, startMark: true, lock: "held" },
    state: "starting",
    status: { ...stale, startingSince: START_MARKED, startMark: "start" },
    news: null,
    editLine: { ...stale, heartbeatLate: late },
  },
  {
    name: "a spawn mark beside a stale record, its lock held",
    stored: { heartbeat: -12_000, spawnMark: -1_000, lock: "held" },
    state: "heartbeat late",
    status: { ...stale, heartbeatLate: late },
  },
  {
    name: "a rest, which status says as no daemon",
    stored: { lastHeartbeat: -60_000, rest: { at: -30_000 } },
    state: "resting",
    status: cleared,
    header: { ...cleared, resting: true },
    news: null,
  },
  {
    name: "a rest with its hook's spawn after it",
    stored: { lastHeartbeat: -60_000, rest: { at: -30_000, spawnedAt: -3_000 } },
    state: "starting",
    status: cleared,
    header: { ...cleared, startingSince: at(-3_000) },
    news: null,
  },
  {
    name: "a rest whose spawn is overdue, forgotten by news",
    stored: { lastHeartbeat: -60_000, rest: { at: -30_000, spawnedAt: -20_000 } },
    state: "gone",
    status: cleared,
    forgetRest: true,
  },
  {
    name: "a rest beside a spawn mark",
    spawn: true,
    stored: { lastHeartbeat: -60_000, rest: { at: -30_000 }, spawnMark: -1_000 },
    state: "starting",
    status: { ...cleared, startingSince: at(-1_000), startMark: "spawn" },
    header: { ...cleared, resting: true, startingSince: at(-1_000), startMark: "spawn" },
    news: null,
  },
  {
    name: "a late heartbeat, its lock held",
    stored: { heartbeat: -12_000, lock: "held" },
    state: "heartbeat late",
    status: { ...stale, heartbeatLate: late },
  },
  {
    name: "a death: a stale record, no shutdown, its lock free",
    stored: { heartbeat: -12_000, lock: "free", openRun: true },
    state: "gone",
    notes: ["last one died"],
    status: { ...stale, died: { runs: [OPEN_RUN] } },
  },
  {
    name: "a worktree with no row",
    stored: { noRow: true },
    state: "gone",
    status: { state: "down", since: null },
  },
  {
    name: "a cleared record, nothing else",
    stored: { lastHeartbeat: -60_000 },
    state: "gone",
    status: cleared,
  },
  {
    name: "a start the consumer was told of",
    stored: { lastHeartbeat: -60_000 },
    state: "gone",
    status: cleared,
    told: { startingSince: at(-3_000) },
    toldHeader: { ...cleared, startingSince: at(-3_000) },
    news: null,
  },
  {
    name: "a told start past its grace",
    stored: { lastHeartbeat: -60_000 },
    state: "gone",
    status: cleared,
    told: { startingSince: at(-20_000) },
  },
  {
    name: "a told start beside a death, whose late heartbeat it hides",
    stored: { heartbeat: -12_000, lock: "free" },
    state: "gone",
    notes: ["last one died"],
    status: { ...stale, died: { runs: [] } },
    told: { startingSince: at(-3_000) },
    toldHeader: { ...stale, died: { runs: [] }, startingSince: at(-3_000) },
    news: null,
  },
];
