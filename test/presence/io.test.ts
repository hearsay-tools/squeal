import { afterEach, describe, expect, it, vi } from "vitest";
import {
  daemonExitMetaKey,
  daemonRestMetaKey,
  daemonStart,
  feedDeliveredMetaKey,
  handoffFrom,
  handoffMetaKey,
  readEditLine,
  readHookHandoff,
  readHookStop,
  readShortHandoffOf,
  readStopping,
  shortHandoffMetaKey,
  stoppedMetaKey,
} from "../../src/core/presence/index.js";
import { lockFileFor } from "../../src/core/store/index.js";
import { notesMetaKey, type Store, type WorktreeId } from "../../src/core/types/index.js";
import { at, type Stored, scratch } from "./fixture.js";

/*
 * Review 0.1.403 B2 (row 011-293): each narrow reader reads what its caller
 * read before the move, in the same order, and probes no lock where it
 * probed none. One log holds, in order, each presence meta key read, each
 * read of a mark file beside the lock, and each lock probe. Where the old
 * reader read more, the row says what it read; the old reads are from the
 * review's probe and the code at 4204b3d47.
 */

const log = vi.hoisted(() => ({ events: [] as string[], on: false }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const readFileSync = ((path: unknown, ...rest: unknown[]) => {
    const name = String(path);
    if (log.on && name.endsWith(".starting")) log.events.push(".starting");
    if (log.on && name.endsWith(".spawned")) log.events.push(".spawned");
    return (actual.readFileSync as (...args: unknown[]) => unknown)(path, ...rest);
  }) as typeof actual.readFileSync;
  return { ...actual, readFileSync };
});

vi.mock("../../src/core/daemon/lock.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/daemon/lock.js")>();
  return {
    ...actual,
    acquireDaemonLock: (...args: Parameters<typeof actual.acquireDaemonLock>) => {
      if (log.on) log.events.push("probe");
      return actual.acquireDaemonLock(...args);
    },
  };
});

const releases: (() => void)[] = [];
afterEach(() => {
  log.on = false;
  vi.restoreAllMocks();
  for (const release of releases.splice(0)) release();
});

/** A scratch store holding `stored`, its row read, and the reads `read` makes from then on. */
function reads<T>(
  stored: Stored,
  read: (store: Store, id: WorktreeId, row: ReturnType<Store["worktrees"]["get"]>) => T,
) {
  const { store, id, release } = scratch(stored);
  releases.push(release);
  const row = store.worktrees.get(id);
  const names = new Map([
    [daemonExitMetaKey(id), "exit"],
    [notesMetaKey(id), "notes"],
    [handoffMetaKey(id), "claim"],
    [shortHandoffMetaKey(id), "short"],
    [daemonRestMetaKey(id), "rest"],
    [stoppedMetaKey(id), "stop"],
    [feedDeliveredMetaKey(id), "feed"],
  ]);
  const get = store.meta.get.bind(store.meta);
  vi.spyOn(store.meta, "get").mockImplementation((key) => {
    log.events.push(names.get(key) ?? key);
    return get(key);
  });
  log.events = [];
  log.on = true;
  const value = read(store, id, row);
  log.on = false;
  return { value, events: log.events };
}

const fresh = { heartbeat: -2_000 } as const;
const stale = { heartbeat: -12_000 } as const;

/*
 * Row 011-295: the edit line says a death and a stopping daemon as status
 * does, so it reads their findings too; a hook reads it only when it prints it.
 */
describe("the hook's edit line reads as before, and a death and a stop (review 0.1.403 B2)", () => {
  it("reads nothing for a fresh heartbeat", () => {
    expect(reads(fresh, (s, id) => readEditLine(s, id, at(0))).events).toEqual([]);
  });

  it("reads the exit row, then the notes, for a stale one, then the marks for its death", () => {
    expect(reads(stale, (s, id) => readEditLine(s, id, at(0))).events).toEqual([
      "exit",
      "notes",
      ".starting",
      ".spawned",
    ]);
  });

  it("reads the exit row, then the marks, the exit note and the claim of a stopping daemon", () => {
    const events = reads({ ...stale, exit: "mark" }, (s, id) => readEditLine(s, id, at(0))).events;
    expect(events).toEqual(["exit", ".starting", ".spawned", "notes", "claim"]);
  });
});

describe("the hook's stop check reads as before (review 0.1.403 B2)", () => {
  const stop = { at: -30_000, untilStart: true } as const;
  it("reads nothing for a fresh heartbeat, a stop mark beside it", () => {
    const r = reads({ ...fresh, stop }, (s, id, row) => readHookStop(s, id, row, at(0)));
    expect(r).toEqual({ value: null, events: [] });
  });

  it("reads the stop mark alone for a stale one", () => {
    const r = reads({ ...stale, stop }, (s, id, row) => readHookStop(s, id, row, at(0)));
    expect(r.events).toEqual(["stop"]);
  });
});

describe("the hook's handoff read reads as before (review 0.1.403 B2)", () => {
  const handoff = (s: Store, id: WorktreeId, row: ReturnType<Store["worktrees"]["get"]>) =>
    row === null || row.daemon === null
      ? null
      : readHookHandoff(s, id, row, handoffFrom(row.daemon), at(0));

  it("reads the short handoff, then the claim, for a fresh heartbeat", () => {
    expect(reads(fresh, handoff).events).toEqual(["short", "claim"]);
  });

  it("reads the shutdown next for a stale one, and the claim once (before: twice)", () => {
    expect(reads(stale, handoff).events).toEqual(["short", "claim", "exit", "notes"]);
  });

  it("reads the short handoff alone when it names the daemon", () => {
    expect(reads({ ...fresh, short: true }, handoff)).toEqual({ value: null, events: ["short"] });
  });
});

describe("`squeal start`'s short handoff reads as before (review 0.1.403 B2)", () => {
  it("reads the short handoff alone, and no row", () => {
    const r = reads({ ...fresh, short: true }, (s, id) => readShortHandoffOf(s, id, at(0)));
    expect(r.events).toEqual(["short"]);
  });
});

describe("the wait's stopping read (review 0.1.403 B2)", () => {
  const stopping = (s: Store, _id: WorktreeId, row: ReturnType<Store["worktrees"]["get"]>) =>
    readStopping(s, row, at(0));

  it("reads the claim alone with the record cleared (before: and both marks, with no live claim)", () => {
    expect(reads({ lastHeartbeat: -60_000 }, stopping).events).toEqual(["claim"]);
    expect(reads({ lastHeartbeat: -12_000, claim: -11_000 }, stopping).events).toEqual(["claim"]);
  });

  it("reads the shutdown alone when none began (before: and both marks)", () => {
    expect(reads(stale, stopping).events).toEqual(["exit", "notes"]);
  });

  it("reads a begun shutdown, the marks, the lock, the exit note and the claim, in the old order", () => {
    const r = reads({ ...stale, exit: "mark", lock: "held" }, stopping);
    expect(r.events).toEqual(["exit", ".starting", ".spawned", "probe", "notes", "claim"]);
    expect(r.value).toMatchObject({ overdue: false });
  });
});

describe("daemonStart's reading of the marks (review 0.1.403 B2)", () => {
  const start = (_s: Store, id: WorktreeId, row: ReturnType<Store["worktrees"]["get"]>) =>
    row === null ? null : daemonStart(lockFileFor(row.commonDir, id), at(0));

  it("stops at a live start mark, and reads the spawn mark only without one", () => {
    const marked = reads({ lastHeartbeat: -60_000, startMark: true, lock: "held" }, start);
    expect(marked.events).toEqual([".starting"]);
    expect(marked.value).toMatchObject({ kind: "locked" });
    expect(reads({ lastHeartbeat: -60_000 }, start).events).toEqual([".starting", ".spawned"]);
  });
});
