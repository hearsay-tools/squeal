import { vi } from "vitest";
import { handoffFrom } from "../../src/core/delivery/handoff.js";
import {
  livenessChange,
  readLiveHeader,
  tellLiveness,
  withTold,
} from "../../src/core/delivery/liveness.js";
import {
  readEditLine,
  readHookHandoff,
  readHookStop,
  readPresence,
  readShortHandoffOf,
  readStopping,
  statusView,
  type ToldLiveness,
} from "../../src/core/presence/index.js";
import type { EpochMs, Store, WorktreeId, WorktreeRecord } from "../../src/core/types/index.js";
import { at, scratch } from "./fixture.js";
import type { Row } from "./rows.js";

/*
 * Row 011-293, review 0.1.403-r2 B2: the reads each presence view makes, in
 * order. Each view is the expression its production caller runs. The log
 * holds each meta key read (the worktree's id written `<id>`), each worktree
 * row read (`row`), each read of a mark file beside the lock (`.starting`,
 * `.spawned`) and each lock probe (`probe`). A test file that traces mocks
 * `node:fs` and `daemon/lock.js` through `traceLog` (see `presence.test.ts`).
 */

/** The log a tracing test file's mocks write to; shared through `globalThis`, which `vi.hoisted` reaches. */
export interface TraceLog {
  events: string[];
  on: boolean;
}

const shared = globalThis as { __presenceTrace?: TraceLog };
shared.__presenceTrace ??= { events: [], on: false };
export const traceLog: TraceLog = shared.__presenceTrace;

/** The presence meta keys, by the name the expected reads give them. */
const NAMES: Readonly<Record<string, string>> = {
  "daemon-exit:<id>": "exit",
  "notes.<id>": "notes",
  "daemon-handoff:<id>": "claim",
  "daemon-handoff-short:<id>": "short",
  "daemon-rest:<id>": "rest",
  "daemon-stopped:<id>": "stop",
  "feed-delivered:<id>": "feed",
  "liveness-told:<id>": "told",
};

/**
 * A logged read as the expected reads write it: a presence meta key by its
 * name (`NAMES`), another meta key without its worktree id (`head-move`,
 * `command-hold`), `row`, a mark file, `probe`. A key without the id stays whole.
 */
export function readName(event: string): string {
  return NAMES[event] ?? event.replace(/[.:]<id>$/, "");
}

/** What `readLiveHeader` reads before the daemon's presence: its header's rows, then the holds. */
export const HEADER_ALIVE =
  "row head-move refined awaiting-install row optimizer-off merge-hold command-hold";
export const HEADER_DOWN = "row head-move refined awaiting-install row optimizer-off command-hold";
/** With no worktree row, no command hold is read. */
export const HEADER_NO_ROW = "row head-move refined awaiting-install row optimizer-off";

/** The views whose reads the table states, each as its production caller calls it. */
export const VIEWS = [
  "status",
  "header",
  "toldHeader",
  "news",
  "editLine",
  "hookStop",
  "hookHandoff",
  "shortHandoff",
  "waitStopping",
] as const;
export type ViewName = (typeof VIEWS)[number];

interface ViewInput {
  readonly store: Store;
  readonly id: WorktreeId;
  readonly now: EpochMs;
  readonly told: ToldLiveness;
  /** The row the caller read before the view: the hooks' and the wait's. */
  readonly row: WorktreeRecord | null;
}

const consumer = (id: WorktreeId) => ({ worktreeId: id, sessionId: "s1", agentId: "main" });

const run: Record<ViewName, (i: ViewInput) => unknown> = {
  // `buildSnapshot`: the row, then the status view of it.
  status: ({ store, id, now }) => statusView(readPresence(store, id, now, store.worktrees.get(id))),
  header: ({ store, id, now }) => readLiveHeader(store, id, now).daemon,
  toldHeader: ({ store, id, now, told }) =>
    withTold(readLiveHeader(store, id, now), told, now).daemon,
  news: ({ store, id, now }) => store.transaction(() => livenessChange(store, consumer(id), now)),
  editLine: ({ store, id, now }) => readEditLine(store, id, now),
  hookStop: ({ store, id, now, row }) => readHookStop(store, id, row, now),
  hookHandoff: ({ store, id, now, row }) =>
    row === null || row.daemon === null
      ? null
      : readHookHandoff(store, id, row, handoffFrom(row.daemon), now),
  shortHandoff: ({ store, id, now }) => readShortHandoffOf(store, id, now),
  waitStopping: ({ store, now, row }) => readStopping(store, row, now),
};

/** The reads `view` makes over a scratch store holding `row`'s facts, and what it returns. */
export function traceView(row: Row, view: ViewName): { reads: string; value: unknown } {
  const { store, id, release } = scratch(row.stored);
  try {
    const now = at(row.now ?? 0);
    const told = row.told ?? "alive";
    if (row.told !== undefined) store.transaction(() => tellLiveness(store, consumer(id), told));
    const before = store.worktrees.get(id);
    const meta = store.meta.get.bind(store.meta);
    const get = store.worktrees.get.bind(store.worktrees);
    const list = store.worktrees.list.bind(store.worktrees);
    const note = (event: string) => {
      if (traceLog.on) traceLog.events.push(event);
    };
    vi.spyOn(store.meta, "get").mockImplementation((key) => {
      note(key.split(id).join("<id>"));
      return meta(key);
    });
    vi.spyOn(store.worktrees, "get").mockImplementation((key) => {
      note("row");
      return get(key);
    });
    vi.spyOn(store.worktrees, "list").mockImplementation(() => {
      note("rows");
      return list();
    });
    traceLog.events = [];
    traceLog.on = true;
    const value = run[view]({ store, id, now, told, row: before });
    traceLog.on = false;
    return { reads: traceLog.events.map(readName).join(" "), value };
  } finally {
    traceLog.on = false;
    vi.restoreAllMocks();
    release();
  }
}
