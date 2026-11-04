import type { StopMark } from "../../src/core/presence/index.js";
import type { DaemonLiveness } from "../../src/core/types/index.js";
import { at, START_MARKED, VERSION } from "./fixture.js";
import { alive, claimed, cleared, late, type Row, stale } from "./rows.js";

/*
 * Row 011-293: the table's rows of a stop by request, beside each start the
 * marks or a told start say (review 0.1.357 B1: a current start wins over a
 * stop), for either stop: `squeal stop` and `--until-start`.
 */

type Down = Extract<DaemonLiveness, { readonly state: "down" }>;

const stopped = (live: Down, untilStart: boolean): DaemonLiveness => ({
  ...live,
  stopped: true,
  ...(untilStart ? { untilStart: true } : {}),
});

/** The stop mark written at `offset`, as the hook's stop check returns it. */
const mark = (offset: number, untilStart = false): StopMark => ({
  at: at(offset),
  tree: "t",
  ...(untilStart ? { untilStart: true as const } : {}),
});

/**
 * The rows beside a stop at -11 s, after the stale record's heartbeat and the
 * cleared one's; and review 0.1.403 B1: beside a fresh heartbeat, a stop
 * written before or after it holds nothing, so the hook ensures a daemon.
 */
const besideEitherStop = (untilStart: boolean): readonly Row[] => {
  const stop = { at: -11_000, ...(untilStart ? { untilStart: true as const } : {}) };
  const which = untilStart ? "a stop until start" : "a stop by request";
  const held = mark(-11_000, untilStart);
  const fresh = (offset: number): Row => ({
    name: `${which} written ${offset < -2_000 ? "before" : "after"} a fresh heartbeat`,
    stored: { heartbeat: -2_000, stop: { ...stop, at: offset } },
    state: "validating",
    status: alive,
    news: null,
  });
  return [
    fresh(-30_000),
    fresh(-1_000),
    {
      name: `${which} beside a stale record`,
      stored: { heartbeat: -12_000, stop },
      heldStop: held,
      state: "stopped by request",
      status: stopped(stale, untilStart),
      editLine: { ...stale, heartbeatLate: late },
    },
    {
      name: `${which} beside a stale record and a hook's spawn mark only`,
      stored: { heartbeat: -12_000, stop, spawnMark: -1_000 },
      heldStop: held,
      state: "stopped by request",
      status: stopped(stale, untilStart),
      editLine: { ...stale, heartbeatLate: late },
    },
    {
      name: `${which} beside a start marked in place of a stale record`,
      stored: { heartbeat: -12_000, stop, startMark: true, lock: "held" },
      heldStop: held,
      state: "starting",
      status: { ...stale, startingSince: START_MARKED, startMark: "start" },
      news: null,
      editLine: { ...stale, heartbeatLate: late },
      spawn: true,
    },
    {
      name: `${which} beside a hook's spawn, its record cleared`,
      stored: { lastHeartbeat: -12_000, stop, spawnMark: -1_000 },
      heldStop: held,
      state: "starting",
      status: { ...stale, startingSince: at(-1_000), startMark: "spawn" },
      news: null,
      spawn: true,
    },
    {
      name: `${which} beside a daemon that marks its start, its record cleared`,
      stored: { lastHeartbeat: -12_000, stop, startMark: true, lock: "held" },
      heldStop: held,
      state: "starting",
      status: { ...stale, startingSince: START_MARKED, startMark: "start" },
      news: null,
      spawn: true,
    },
  ];
};

export const stopRows: readonly Row[] = [
  {
    name: "a stop by request",
    stored: { lastHeartbeat: -60_000, stop: { at: -30_000 } },
    state: "stopped by request",
    status: { ...cleared, stopped: true },
    heldStop: mark(-30_000),
  },
  {
    name: "a stop until start",
    stored: { lastHeartbeat: -60_000, stop: { at: -100_000, untilStart: true } },
    state: "stopped by request",
    status: { ...cleared, stopped: true, untilStart: true },
    heldStop: mark(-100_000, true),
  },
  {
    name: "a stop a later heartbeat voided",
    stored: { lastHeartbeat: -60_000, stop: { at: -100_000 } },
    state: "gone",
    status: cleared,
  },
  {
    name: "a death while a stop holds",
    stored: { heartbeat: -12_000, lock: "free", stop: { at: -11_000 } },
    heldStop: mark(-11_000),
    state: "stopped by request",
    notes: ["last one died"],
    status: { ...stale, stopped: true, died: { runs: [] } },
    news: { ...stale, stopped: true },
    editLine: { ...stale, heartbeatLate: late },
  },
  {
    name: "a stop while a handoff claim is live",
    stored: { lastHeartbeat: -12_000, claim: -11_000, stop: { at: -11_500 } },
    heldStop: mark(-11_500),
    state: "stopping",
    status: {
      ...stale,
      stopped: true,
      stopping: { from: VERSION, since: at(-11_000), ...claimed, overdue: false },
    },
  },
  {
    name: "a told start over a stop",
    stored: { lastHeartbeat: -60_000, stop: { at: -30_000 } },
    state: "stopped by request",
    status: { ...cleared, stopped: true },
    told: { startingSince: at(-3_000) },
    toldHeader: { ...cleared, startingSince: at(-3_000) },
    news: null,
    heldStop: mark(-30_000),
  },
  ...besideEitherStop(false),
  ...besideEitherStop(true),
];
