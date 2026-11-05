import { afterEach, describe, expect, it } from "vitest";
import {
  HANDOFF_BOUND_MS,
  readLockMarks,
  readPresence,
  type SocketState,
  type WaitReading,
  waitView,
} from "../../src/core/presence/index.js";
import { lockFileFor } from "../../src/core/store/index.js";
import { at, type Stored, scratch } from "./fixture.js";

/*
 * Row 011-293: the wait's presence view. Stored facts, the clock and what the
 * wait's own I/O found (the socket's answer, how long it has been dead, a
 * second read of the record) in; the wait's reading out, with what the wait
 * does with its socket check and timer.
 */

interface WaitRow {
  readonly name: string;
  readonly stored: Stored;
  readonly now?: number;
  readonly socket?: SocketState;
  readonly deadMs?: number;
  readonly recordedAgain?: true;
  readonly reading: WaitReading;
}

const lapsed = { liveness: { state: "lapsed" } } as const;
const locked = { liveness: { state: "lapsed", locked: true } } as const;

const rows: readonly WaitRow[] = [
  {
    name: "a fresh heartbeat",
    stored: { heartbeat: -2_000 },
    reading: { liveness: { state: "alive" }, forget: "all" },
  },
  {
    name: "a fresh heartbeat whose shutdown began",
    stored: { heartbeat: -2_000, exit: { note: -1_000 } },
    reading: { liveness: { state: "alive" }, forget: "all" },
  },
  {
    name: "a handoff before its bound",
    stored: { heartbeat: -12_000, exit: { note: -12_000 }, claim: -11_000, lock: "held" },
    reading: lapsed,
  },
  {
    name: "a handoff at its claim's bound",
    stored: { heartbeat: -12_000, exit: { note: -12_000 }, claim: -11_000, lock: "held" },
    now: -11_000 + HANDOFF_BOUND_MS,
    reading: { liveness: { state: "down", reason: "handoff" } },
  },
  {
    name: "a stop past its bound",
    stored: { heartbeat: -12_000, exit: "mark", lock: "held" },
    now: -12_000 + HANDOFF_BOUND_MS,
    reading: { liveness: { state: "down", reason: "handoff" } },
  },
  {
    name: "a cleared record while a daemon marks its start",
    stored: { lastHeartbeat: -60_000, startMark: true, lock: "held" },
    reading: locked,
  },
  {
    name: "a cleared record with a spawn mark older than the last heartbeat, which status reads as none",
    stored: { lastHeartbeat: -500, spawnMark: -1_000 },
    reading: locked,
  },
  {
    name: "a cleared record with a spawn mark past its grace",
    stored: { lastHeartbeat: -60_000, spawnMark: -10_001 },
    reading: { liveness: { state: "down", reason: "stopped" } },
  },
  {
    name: "a cleared record with no mark",
    stored: { lastHeartbeat: -60_000 },
    reading: { liveness: { state: "down", reason: "stopped" } },
  },
  {
    name: "a cleared record a second read finds registered",
    stored: { lastHeartbeat: -60_000 },
    recordedAgain: true,
    reading: locked,
  },
  {
    name: "a stale record while another daemon marks its start",
    stored: { heartbeat: -12_000, startMark: true, lock: "held" },
    reading: { ...locked, forget: "dead" },
  },
  {
    name: "a stale record with a hook's spawn mark only, no start",
    stored: { heartbeat: -12_000, spawnMark: -1_000 },
    reading: { ...lapsed, forget: "dead", ask: 12_000 },
  },
  {
    name: "a stale record whose socket has not answered",
    stored: { heartbeat: -12_000 },
    reading: { ...lapsed, forget: "dead", ask: 12_000 },
  },
  {
    name: "a stale record whose socket listens",
    stored: { heartbeat: -12_000 },
    socket: "listening",
    reading: { ...lapsed, forget: "dead", ask: 12_000, lapse: 12_000 },
  },
  {
    name: "a socket that says stopping, before the bound",
    stored: { heartbeat: -12_000 },
    socket: "stopping",
    reading: { ...lapsed, forget: "dead", ask: 12_000 },
  },
  {
    name: "a socket that says stopping, past the bound",
    stored: { heartbeat: -140_000 },
    socket: "stopping",
    reading: { liveness: { state: "down", reason: "handoff" }, ask: 140_000 },
  },
  {
    name: "a dead socket just past the heartbeat's grace",
    stored: { heartbeat: -12_000 },
    socket: "absent",
    reading: { ...lapsed, ask: 12_000 },
  },
  {
    name: "a dead socket, the heartbeat long past its grace",
    stored: { heartbeat: -30_000 },
    socket: "absent",
    reading: { liveness: { state: "down", reason: "silent" }, ask: 30_000 },
  },
  {
    name: "a socket dead for the down bound",
    stored: { heartbeat: -12_000 },
    socket: "absent",
    deadMs: 10_000,
    reading: { liveness: { state: "down", reason: "silent" }, ask: 12_000 },
  },
];

const releases: (() => void)[] = [];
afterEach(() => {
  for (const release of releases.splice(0)) release();
});

describe("daemon presence: the wait's view (row 011-293)", () => {
  it.each(rows)("$name", (row) => {
    const { store, id, release } = scratch(row.stored);
    releases.push(release);
    const now = at(row.now ?? 0);
    const presence = readPresence(store, id, now);
    const worktree = store.worktrees.get(id);
    const lockFile = worktree === null ? null : lockFileFor(worktree.commonDir, id);
    const reading = waitView({
      record: presence.record,
      at: now,
      stopping: presence.stopping ?? undefined,
      marks: () => (lockFile === null ? null : readLockMarks(lockFile, now)),
      socket: row.socket ?? null,
      deadMs: () => row.deadMs ?? 0,
      recordedAgain: () => row.recordedAgain === true,
      downMs: 10_000,
    });
    expect(reading).toEqual(row.reading);
  });
});
