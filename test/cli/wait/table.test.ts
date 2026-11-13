import { describe, expect, it } from "vitest";
import type { FileClasses, FileVerdict } from "../../../src/cli/verdict.js";
import { decideRunWait, type WaitStep } from "../../../src/cli/wait/decide.js";
import type { LintCounts } from "../../../src/cli/wait/reads.js";
import { RUN_WAITS, type RunWaitName, type WaitRecord } from "../../../src/cli/wait/table.js";
import type { StatusHold } from "../../../src/core/types/standing.js";

/*
 * Row 011-326: the run waits' table at the module's interface, as pure
 * rows. A read record in, the decision the loop calls out: read a field
 * first, go on, or end with an outcome and the conditions that ended it.
 * Every outcome of every run wait, the order between them, and the reads
 * each chain reaches.
 */

const classes = (pending: number, unlisted = false): FileClasses => ({
  revision: 3,
  testFiles: 2,
  byClass: { current: 2 - pending, pending, stale: 0, unknown: 0 },
  unlisted,
});
const verdict = (pending: number, unlisted = false): FileVerdict => ({
  ...classes(pending, unlisted),
  failures: { tests: 0, testFiles: 0 },
});
const UNOPENED = "no Squeal store at /r/.git/squeal/store.sqlite";
const BUSY =
  "store busy, waited 1000 ms: another process holds the store's lock; run the command again once it is released";
const HOLD: StatusHold = { cause: "merge", since: 1, revision: 3, paths: ["a"], pathCount: 1 };
const counts = (linting: number): LintCounts => ({
  files: 2,
  failing: 0,
  linting,
  held: 0,
  unknown: 0,
});

/** A read of the checkpoint wait at revision 3, its store open. */
const cp = (fields: Partial<WaitRecord>): WaitRecord => ({
  poll: 0,
  since: 3,
  store: "opened",
  ...fields,
});
/** A read of a group wait, its store open. */
const gr = (fields: Partial<WaitRecord>): WaitRecord => ({ poll: 0, store: "opened", ...fields });
const lint = (fields: Partial<WaitRecord>): WaitRecord => ({ poll: 0, ...fields });

const end = (outcome: object, ...reason: string[]): WaitStep =>
  ({ kind: "end", outcome, reason }) as WaitStep;
const read = (field: string): WaitStep => ({ kind: "read", field }) as WaitStep;
const ON: WaitStep = { kind: "go on" };

type Row = readonly [string, RunWaitName, WaitRecord, WaitStep];

const CHECKPOINT: readonly Row[] = [
  [
    "ended: completed with nothing pending",
    "checkpoint",
    cp({ end: "completed", revision: 3, late: false, verdict: verdict(0) }),
    end({ kind: "ended", verdict: verdict(0) }, "completed", "verdict settled"),
  ],
  [
    "ended beats deadline: completed and settled at the deadline's read",
    "checkpoint",
    cp({ end: "completed", revision: 3, late: true, verdict: verdict(0) }),
    end({ kind: "ended", verdict: verdict(0) }, "completed", "verdict settled"),
  ],
  [
    "deadline: running at the deadline",
    "checkpoint",
    cp({ end: null, revision: 3, late: true, verdict: verdict(1) }),
    end({ kind: "deadline", verdict: verdict(1) }, "late"),
  ],
  [
    "deadline: completed with a re-run pending at the deadline",
    "checkpoint",
    cp({ end: "completed", revision: 3, late: true, verdict: verdict(1) }),
    end({ kind: "deadline", verdict: verdict(1) }, "late"),
  ],
  [
    "deadline: completed with the runner's listing pending",
    "checkpoint",
    cp({ end: "completed", revision: 3, late: true, verdict: verdict(0, true) }),
    end({ kind: "deadline", verdict: verdict(0, true) }, "late"),
  ],
  [
    "on hold: running before the deadline, its files queued on a hold",
    "checkpoint",
    cp({ end: null, revision: 3, late: false, hold: HOLD }),
    end({ kind: "on-hold", hold: HOLD }, "running", "before deadline", "held"),
  ],
  [
    "abandoned",
    "checkpoint",
    cp({ end: "abandoned", revision: 3, late: false }),
    end({ kind: "abandoned" }, "abandoned"),
  ],
  [
    "abandoned beats deadline",
    "checkpoint",
    cp({ end: "abandoned", revision: 3, late: true }),
    end({ kind: "abandoned" }, "abandoned"),
  ],
  [
    "moved: a newer revision",
    "checkpoint",
    cp({ end: null, revision: 4, late: false }),
    end({ kind: "moved", revision: 4 }, "newer revision"),
  ],
  [
    "moved beats abandoned and ended",
    "checkpoint",
    cp({ end: "abandoned", revision: 5, late: true, verdict: verdict(0) }),
    end({ kind: "moved", revision: 5 }, "newer revision"),
  ],
  [
    "unopened: the store did not open, with why (011-327: was stopped)",
    "checkpoint",
    cp({ store: "unopened", unavailable: UNOPENED }),
    end({ kind: "unopened", unavailable: UNOPENED }, "store unopened"),
  ],
  [
    "go on: a busy store before the deadline is read again (011-327: was a throw)",
    "checkpoint",
    cp({ store: "busy", unavailable: BUSY, late: false }),
    ON,
  ],
  [
    "unopened: a busy store at the deadline's read, with why (011-327: was a throw)",
    "checkpoint",
    cp({ store: "busy", unavailable: BUSY, late: true }),
    end({ kind: "unopened", unavailable: BUSY }, "store busy", "late"),
  ],
  [
    "stopped: the fifth read's ping found no daemon",
    "checkpoint",
    cp({ poll: 4, end: null, revision: 3, late: false, hold: null, daemon: "none" }),
    end({ kind: "stopped" }, "ping due", "no daemon"),
  ],
  [
    "go on: running before the deadline, no hold",
    "checkpoint",
    cp({ end: null, revision: 3, late: false, hold: null }),
    ON,
  ],
  [
    "go on: completed with a re-run pending before the deadline",
    "checkpoint",
    cp({ end: "completed", revision: 3, late: false, verdict: verdict(1) }),
    ON,
  ],
  [
    "go on: the ping on the fifth read was answered",
    "checkpoint",
    cp({ poll: 9, end: null, revision: 3, late: false, hold: null, daemon: "answered" }),
    ON,
  ],
];

const GROUP: readonly Row[] = [
  [
    "ended: none of its files pending",
    "group",
    gr({ classes: classes(0), late: false, verdict: verdict(0) }),
    end({ kind: "ended", verdict: verdict(0) }, "files settled"),
  ],
  [
    "ended beats deadline: settled at the deadline's read",
    "group",
    gr({ classes: classes(0), late: true, verdict: verdict(0) }),
    end({ kind: "ended", verdict: verdict(0) }, "files settled"),
  ],
  [
    "deadline: a file pending",
    "group",
    gr({ classes: classes(1), late: true, verdict: verdict(1), install: null }),
    end({ kind: "deadline", verdict: verdict(1) }, "late"),
  ],
  [
    "deadline: the runner's listing pending",
    "group",
    gr({ classes: classes(0, true), late: true, verdict: verdict(0, true), install: null }),
    end({ kind: "deadline", verdict: verdict(0, true) }, "late"),
  ],
  [
    "deadline names the install the worktree waits for",
    "group",
    gr({
      classes: classes(1),
      late: true,
      verdict: verdict(1),
      install: { command: "pnpm install" },
    }),
    end({ kind: "deadline", verdict: verdict(1), install: { command: "pnpm install" } }, "late"),
  ],
  [
    "on hold: a file pending before the deadline, queued on a hold",
    "group",
    gr({ classes: classes(1), late: false, hold: HOLD }),
    end({ kind: "on-hold", hold: HOLD }, "files pending", "before deadline", "held"),
  ],
  [
    "unopened: the store did not open, with why (011-327: was stopped)",
    "group",
    gr({ store: "unopened", unavailable: UNOPENED }),
    end({ kind: "unopened", unavailable: UNOPENED }, "store unopened"),
  ],
  [
    "go on: a busy store before the deadline is read again (011-327: was a throw)",
    "group",
    gr({ store: "busy", unavailable: BUSY, late: false }),
    ON,
  ],
  [
    "unopened: a busy store at the deadline's read, with why (011-327: was a throw)",
    "group",
    gr({ store: "busy", unavailable: BUSY, late: true }),
    end({ kind: "unopened", unavailable: BUSY }, "store busy", "late"),
  ],
  [
    "stopped: the fifth read's ping found no daemon",
    "group",
    gr({ poll: 4, classes: classes(1), late: false, hold: null, daemon: "none" }),
    end({ kind: "stopped" }, "ping due", "no daemon"),
  ],
  [
    "go on: a ping with no answer within the deadline is a busy daemon (019-24)",
    "group",
    gr({ poll: 4, classes: classes(1), late: false, hold: null, daemon: "unanswered" }),
    ON,
  ],
  [
    "go on: a file pending before the deadline, no hold",
    "group",
    gr({ classes: classes(1), late: false, hold: null }),
    ON,
  ],
];

const LINT: readonly Row[] = [
  [
    "ended: nothing left to lint",
    "lint group",
    lint({ counts: counts(0), late: false }),
    end({ kind: "ended", counts: counts(0) }, "nothing to lint"),
  ],
  [
    "deadline: checks left to lint",
    "lint group",
    lint({ counts: counts(2), late: true }),
    end({ kind: "deadline", counts: counts(2) }, "late"),
  ],
  [
    "deadline beats ended at the deadline's read: no verdict (accidental, 011-327)",
    "lint group",
    lint({ counts: counts(0), late: true }),
    end({ kind: "deadline", counts: counts(0) }, "late"),
  ],
  [
    "off: lint is off",
    "lint group",
    lint({ counts: "off", late: true }),
    end({ kind: "off" }, "lint off"),
  ],
  [
    "unread: the lint store cannot be read",
    "lint group",
    lint({ counts: "unread", late: false }),
    end({ kind: "unread" }, "lint unread"),
  ],
  [
    "stopped: the fifth read's ping found no daemon",
    "lint group",
    lint({ poll: 4, counts: counts(1), late: false, daemon: "none" }),
    end({ kind: "stopped" }, "ping due", "no daemon"),
  ],
  [
    "go on: a ping with no answer within the deadline",
    "lint group",
    lint({ poll: 4, counts: counts(1), late: false, daemon: "unanswered" }),
    ON,
  ],
  [
    "go on: checks left before the deadline",
    "lint group",
    lint({ counts: counts(1), late: false }),
    ON,
  ],
];

/** The reads a chain reaches: a field it asks for next, none it does not reach. */
const READS: readonly Row[] = [
  [
    "checkpoint running before the deadline reads the hold, not the verdict",
    "checkpoint",
    cp({ end: null, revision: 3, late: false }),
    read("hold"),
  ],
  [
    "checkpoint completed reads the verdict, not the hold",
    "checkpoint",
    cp({ end: "completed", revision: 3, late: false }),
    read("verdict"),
  ],
  [
    "checkpoint running at the deadline reads the verdict, not the hold",
    "checkpoint",
    cp({ end: null, revision: 3, late: true }),
    read("verdict"),
  ],
  [
    "checkpoint moved reads neither",
    "checkpoint",
    cp({ end: null, revision: 4, late: false }),
    end({ kind: "moved", revision: 4 }, "newer revision"),
  ],
  [
    "checkpoint asks the daemon on the fifth read only",
    "checkpoint",
    cp({ poll: 4, end: null, revision: 3, late: false, hold: null }),
    read("daemon"),
  ],
  [
    "group with a file pending before the deadline reads the hold, not the verdict",
    "group",
    gr({ classes: classes(1), late: false }),
    read("hold"),
  ],
  [
    "group settled reads the verdict, not the hold",
    "group",
    gr({ classes: classes(0), late: false }),
    read("verdict"),
  ],
  [
    "group at the deadline reads the verdict, then the install",
    "group",
    gr({ classes: classes(1), late: true, verdict: verdict(1) }),
    read("install"),
  ],
  [
    "group settled reads no install",
    "group",
    gr({ classes: classes(0), late: true, verdict: verdict(0) }),
    end({ kind: "ended", verdict: verdict(0) }, "files settled"),
  ],
  [
    "group asks the daemon on the fifth read only",
    "group",
    gr({ poll: 14, classes: classes(1), late: false, hold: null }),
    read("daemon"),
  ],
  [
    "lint group asks the daemon on the fifth read only",
    "lint group",
    lint({ poll: 4, counts: counts(1), late: false }),
    read("daemon"),
  ],
];

describe("the run waits' table: pure rows (row 011-326)", () => {
  it.each([...CHECKPOINT, ...GROUP, ...LINT, ...READS])("%s (%s)", (_name, wait, record, step) => {
    expect(decideRunWait(RUN_WAITS[wait], record)).toEqual(step);
  });

  it("each wait's chain names every outcome of its closed set", () => {
    const outcomes = (wait: RunWaitName) =>
      new Set(RUN_WAITS[wait].rules.map((r) => r.then).filter((then) => then !== "go on"));
    expect(outcomes("checkpoint")).toEqual(
      new Set(["unopened", "stopped", "moved", "abandoned", "on-hold", "ended", "deadline"]),
    );
    expect(outcomes("group")).toEqual(
      new Set(["unopened", "stopped", "on-hold", "ended", "deadline"]),
    );
    expect(outcomes("lint group")).toEqual(
      new Set(["off", "unread", "deadline", "ended", "stopped"]),
    );
  });
});
