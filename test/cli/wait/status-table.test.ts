import { describe, expect, it } from "vitest";
import { decideStatusWait, type StatusStep } from "../../../src/cli/wait/decide.js";
import {
  STATUS_WAITS,
  type StatusRecord,
  type StatusWaitName,
} from "../../../src/cli/wait/status-table.js";
import type { StatusHold } from "../../../src/core/types/standing.js";

/*
 * Row 011-331: the status waits' rows of the table, as pure rows beside the
 * run waits' (`table.test.ts`). A read record in, the decision the loop
 * calls out: read a field first, go on, or end with an outcome and the
 * conditions that ended it. Every outcome of every status wait, the order
 * between them, and the hold read only where the chain reaches it.
 */

const HOLD: StatusHold = { cause: "merge", since: 1, revision: 3, paths: ["a"], pathCount: 1 };

/** A read of `status --wait` that read the store: no news, before the settle time and the deadline. */
const ed = (fields: Partial<StatusRecord>): StatusRecord => ({
  store: "read",
  late: false,
  settled: false,
  daemon: "alive",
  news: 0,
  quiet: false,
  ...fields,
});
/** A read of `status <path> --wait` that read the store, its selection not decided. */
const nm = (fields: Partial<StatusRecord>): StatusRecord => ({
  store: "read",
  late: false,
  settled: false,
  daemon: "alive",
  decided: null,
  ...fields,
});
/** The one read of `status <path>`. */
const sn = (fields: Partial<StatusRecord>): StatusRecord => ({
  store: "read",
  daemon: "alive",
  decided: null,
  ...fields,
});

const end = (outcome: string, ...reason: string[]): StatusStep =>
  ({ kind: "end", outcome, reason }) as StatusStep;
const read = (field: string): StatusStep => ({ kind: "read", field }) as StatusStep;
const ON: StatusStep = { kind: "go on" };

type Row = readonly [string, StatusWaitName, StatusRecord, StatusStep];

/** The store rules of the edit and named waits: a first or last read not read ends it, one between is skipped. */
const STORE: readonly Row[] = (["edit", "named"] as const).flatMap((wait): Row[] => [
  [
    "unavailable: the first read did not read the store",
    wait,
    { store: "unread", first: true, late: false },
    end("unavailable", "store unread", "first read"),
  ],
  [
    "unavailable: the deadline's read did not read the store",
    wait,
    { store: "unread", first: false, late: true },
    end("unavailable", "store unread", "late"),
  ],
  [
    "go on: a read between the first and the last that did not read the store is skipped",
    wait,
    { store: "unread", first: false, late: false },
    ON,
  ],
]);

const EDIT: readonly Row[] = [
  ["news: a check changed since the start", "edit", ed({ news: 1 }), end("news", "news")],
  [
    "news beats no daemon, quiet and the deadline",
    "edit",
    ed({ news: 2, settled: true, late: true, daemon: "down", quiet: true }),
    end("news", "news"),
  ],
  [
    "no-daemon: the settle time passed and the wait view found the daemon down",
    "edit",
    ed({ settled: true, daemon: "down" }),
    end("no-daemon", "settled", "daemon down"),
  ],
  [
    "no-daemon beats the deadline",
    "edit",
    ed({ settled: true, late: true, daemon: "down" }),
    end("no-daemon", "settled", "daemon down"),
  ],
  ["go on: the daemon down before the settle time", "edit", ed({ daemon: "down", hold: null }), ON],
  ["quiet: nothing it holds for pending", "edit", ed({ quiet: true }), end("quiet", "quiet")],
  [
    "quiet beats the deadline",
    "edit",
    ed({ quiet: true, settled: true, late: true }),
    end("quiet", "quiet"),
  ],
  [
    "on-hold: a file it holds for queued on hold",
    "edit",
    ed({ hold: HOLD }),
    end("on-hold", "held"),
  ],
  [
    "on-hold beats the deadline",
    "edit",
    ed({ hold: HOLD, settled: true, late: true }),
    end("on-hold", "held"),
  ],
  [
    "timeout: the deadline's read",
    "edit",
    ed({ settled: true, late: true, hold: null }),
    end("timeout", "late"),
  ],
  [
    "timeout: a lapsed heartbeat decides nothing",
    "edit",
    ed({ settled: true, late: true, daemon: "lapsed", hold: null }),
    end("timeout", "late"),
  ],
  ["go on: nothing ends it", "edit", ed({ hold: null }), ON],
  ["go on: a lapsed heartbeat", "edit", ed({ settled: true, daemon: "lapsed", hold: null }), ON],
];

const NAMED: readonly Row[] = [
  [
    "no-daemon: the settle time passed and the wait view found the daemon down",
    "named",
    nm({ settled: true, daemon: "down" }),
    end("no-daemon", "settled", "daemon down"),
  ],
  [
    "no-daemon beats a focused answer and the deadline",
    "named",
    nm({ settled: true, late: true, daemon: "down", decided: "focused" }),
    end("no-daemon", "settled", "daemon down"),
  ],
  [
    "go on: the daemon down before the settle time",
    "named",
    nm({ daemon: "down", hold: null }),
    ON,
  ],
  [
    "settled: no file it holds for pending",
    "named",
    nm({ decided: "settled" }),
    end("settled", "decided settled"),
  ],
  [
    "focused: each named file has its focused answer",
    "named",
    nm({ decided: "focused" }),
    end("focused", "decided focused"),
  ],
  [
    "unmatched: no path selects a file",
    "named",
    nm({ decided: "unmatched" }),
    end("unmatched", "decided unmatched"),
  ],
  [
    "slow: every selected file runs only on a pause",
    "named",
    nm({ decided: "slow" }),
    end("slow", "decided slow"),
  ],
  [
    "a decided selection beats the deadline: the read at the deadline gives its verdict",
    "named",
    nm({ decided: "settled", settled: true, late: true }),
    end("settled", "decided settled"),
  ],
  [
    "on-hold: a file it holds for queued on hold",
    "named",
    nm({ hold: HOLD }),
    end("on-hold", "held"),
  ],
  [
    "on-hold beats the deadline",
    "named",
    nm({ hold: HOLD, settled: true, late: true }),
    end("on-hold", "held"),
  ],
  [
    "timeout: the deadline's read, its selection not decided",
    "named",
    nm({ settled: true, late: true, hold: null }),
    end("timeout", "late"),
  ],
  [
    "timeout: a lapsed heartbeat decides nothing",
    "named",
    nm({ settled: true, late: true, daemon: "lapsed", hold: null }),
    end("timeout", "late"),
  ],
  ["go on: nothing ends it", "named", nm({ hold: null }), ON],
];

const SNAPSHOT: readonly Row[] = [
  [
    "unavailable: the read that asks the sync did not read the store",
    "snapshot",
    { store: "unread" },
    end("unavailable", "store unread"),
  ],
  [
    "no-daemon: the heartbeat is not fresh, with no settle time",
    "snapshot",
    sn({ daemon: "down" }),
    end("no-daemon", "daemon down"),
  ],
  [
    "settled: no file it holds for pending",
    "snapshot",
    sn({ decided: "settled" }),
    end("settled", "decided settled"),
  ],
  [
    "unmatched: no path selects a file",
    "snapshot",
    sn({ decided: "unmatched" }),
    end("unmatched", "decided unmatched"),
  ],
  [
    "slow: every selected file runs only on a pause",
    "snapshot",
    sn({ decided: "slow" }),
    end("slow", "decided slow"),
  ],
  [
    "on-hold: a file it holds for queued on hold",
    "snapshot",
    sn({ hold: HOLD }),
    end("on-hold", "held"),
  ],
  [
    "timeout: its one read, not decided: no verdict",
    "snapshot",
    sn({ hold: null }),
    end("timeout"),
  ],
];

/** The reads each chain reaches: the hold only once every outcome before it failed. */
const READS: readonly Row[] = [
  ["edit reads the hold once news, no daemon and quiet failed", "edit", ed({}), read("hold")],
  ["edit with news reads no hold", "edit", ed({ news: 1 }), end("news", "news")],
  ["edit quiet reads no hold", "edit", ed({ quiet: true }), end("quiet", "quiet")],
  [
    "edit with no daemon reads no hold",
    "edit",
    ed({ settled: true, daemon: "down" }),
    end("no-daemon", "settled", "daemon down"),
  ],
  [
    "edit's skipped read reads nothing but whether it was the first and the last",
    "edit",
    { store: "unread" },
    read("first"),
  ],
  ["named reads the hold once its selection is not decided", "named", nm({}), read("hold")],
  ["named decided reads no hold", "named", nm({ decided: "slow" }), end("slow", "decided slow")],
  ["snapshot reads the hold once its selection is not decided", "snapshot", sn({}), read("hold")],
];

describe("the status waits' table: pure rows (row 011-331)", () => {
  it.each([...STORE, ...EDIT, ...NAMED, ...SNAPSHOT, ...READS])(
    "%s (%s)",
    (_name, wait, record, step) => {
      expect(decideStatusWait(STATUS_WAITS[wait], record)).toEqual(step);
    },
  );

  it("each wait's chain names every outcome of its closed set", () => {
    const outcomes = (wait: StatusWaitName) =>
      new Set(STATUS_WAITS[wait].rules.map((r) => r.then).filter((then) => then !== "go on"));
    expect(outcomes("edit")).toEqual(
      new Set(["unavailable", "news", "no-daemon", "quiet", "on-hold", "timeout"]),
    );
    expect(outcomes("named")).toEqual(
      new Set([
        "unavailable",
        "no-daemon",
        "settled",
        "focused",
        "unmatched",
        "slow",
        "on-hold",
        "timeout",
      ]),
    );
    expect(outcomes("snapshot")).toEqual(
      new Set(["unavailable", "no-daemon", "settled", "unmatched", "slow", "on-hold", "timeout"]),
    );
  });

  it("names the cells where the status waits differ", () => {
    expect(STATUS_WAITS.edit.daemon).toBe("wait view");
    expect(STATUS_WAITS.named.daemon).toBe("wait view");
    expect(STATUS_WAITS.snapshot.daemon).toBe("heartbeat");
    expect(STATUS_WAITS.edit.unsupported).toBe("after settle");
    expect(STATUS_WAITS.named.unsupported).toBe("after settle");
    expect(STATUS_WAITS.snapshot.unsupported).toBe("never");
  });
});
