import { describe, expect, it } from "vitest";
import { appendNote, readDaemonNotes } from "../../src/core/notes.js";
import {
  CommandHold,
  decideHolds,
  type HoldDecision,
} from "../../src/core/scheduler/command-hold.js";
import { addCommandHold, type CommandHoldEntry } from "../../src/core/scheduler/hold-rows.js";
import { Wakes } from "../../src/core/scheduler/wakes.js";
import type { EpochMs } from "../../src/core/types/common.js";
import { virtualClock } from "../helpers/virtual-clock.js";
import { fakeCommonDir, open } from "../store/helpers.js";

/*
 * Row 011-355 (`research/scheduler-step.md`, "Tests: replace, don't layer"):
 * `decideHolds(entries, at, gone)` as a table, and one case of
 * `CommandHold` applying its wake on the virtual clock. It replaces the
 * timer case of `command-hold.test.ts` (an entry past its `until`, 4) and the
 * rule case of two entries (6); `tasks/011-355/notes.md` names them.
 */

const AT = 1_000_000 as EpochMs;

function entry(name: string, until: number): CommandHoldEntry {
  return {
    token: name,
    since: (AT - 1_000) as EpochMs,
    until: until as EpochMs,
    command: name,
    wrapper: null,
    child: null,
  };
}

/** A decision as names: ended `name:reason`, left names, the wake and what to do. */
function shape(decision: HoldDecision) {
  return {
    ended: decision.ended.map(({ entry, reason }) => `${entry.token}:${reason}`),
    left: decision.left.map((e) => e.token),
    wakeAt: decision.wakeAt === null ? null : decision.wakeAt - AT,
    prune: decision.prune,
    next: decision.next,
  };
}

interface Row {
  readonly name: string;
  /** Each entry's `until`, as ms after `AT`. */
  readonly entries: Readonly<Record<string, number>>;
  readonly gone?: readonly string[];
  readonly want: ReturnType<typeof shape>;
}

const ROWS: readonly Row[] = [
  {
    name: "no entry: nothing holds, no wake",
    entries: {},
    want: { ended: [], left: [], wakeAt: null, prune: false, next: "free" },
  },
  {
    name: "an entry before its `until` holds, the wake at its `until`",
    entries: { a: 2_000 },
    want: { ended: [], left: ["a"], wakeAt: 2_000, prune: false, next: "hold" },
  },
  {
    name: "an entry at its `until` ends by its bound (case 4's end)",
    entries: { a: 0 },
    want: { ended: ["a:until"], left: [], wakeAt: null, prune: true, next: "free" },
  },
  {
    name: "a bound that passed wins over a holder that is gone",
    entries: { a: -1 },
    gone: ["a"],
    want: { ended: ["a:until"], left: [], wakeAt: null, prune: true, next: "free" },
  },
  {
    name: "an entry whose holder is gone ends before its bound",
    entries: { a: 5_000 },
    gone: ["a"],
    want: { ended: ["a:gone"], left: [], wakeAt: null, prune: true, next: "free" },
  },
  {
    name: "two entries: one ends, the other holds and sets the wake (case 6)",
    entries: { a: 5_000, b: 3_000 },
    gone: ["a"],
    want: { ended: ["a:gone"], left: ["b"], wakeAt: 3_000, prune: true, next: "hold" },
  },
  {
    name: "two entries hold: the wake at the earlier `until`, in the row's order",
    entries: { a: 9_000, b: 4_000 },
    want: { ended: [], left: ["a", "b"], wakeAt: 4_000, prune: false, next: "hold" },
  },
  {
    name: "both end, each with its own cause, in the row's order",
    entries: { a: 9_000, b: 0 },
    gone: ["a"],
    want: { ended: ["a:gone", "b:until"], left: [], wakeAt: null, prune: true, next: "free" },
  },
];

describe("decideHolds (row 011-355)", () => {
  it.each(ROWS)("$name", ({ entries, gone = [], want }) => {
    const list = Object.entries(entries).map(([name, ms]) => entry(name, AT + ms));
    const asked: string[] = [];
    const decision = decideHolds(list, AT, (e) => {
      asked.push(e.token);
      return gone.includes(e.token);
    });
    expect(shape(decision)).toEqual(want);
    // `gone` is asked only of an entry whose bound is still ahead.
    expect(asked).toEqual(list.filter((e) => e.until > AT).map((e) => e.token));
  });

  it("is pure: the same reading gives the same decision and leaves the entries as they were", () => {
    const list = [entry("a", AT + 1_000), entry("b", AT)];
    const before = structuredClone(list);
    const one = decideHolds(list, AT, () => false);
    expect(decideHolds(list, AT, () => false)).toEqual(one);
    expect(list).toEqual(before);
  });
});

describe("CommandHold applies the decision's wake (row 011-355)", () => {
  it("reads the row again at the earliest `until` and ends the entry there with its bound note", async () => {
    const ID = "w";
    const store = open(fakeCommonDir());
    const clock = virtualClock(AT);
    const wakes = new Wakes(clock);
    let dues = 0;
    const held = new CommandHold({
      store,
      worktreeId: ID,
      now: () => clock.now(),
      note: (text) => appendNote(store, ID, { at: clock.now(), revision: null, text }),
      merging: () => false,
      due: () => {
        dues += 1;
        held.check();
      },
      gone: () => false,
      wakes,
    });
    addCommandHold(store, ID, { ...entry("npm run gate", AT + 2_000), since: AT });
    expect(held.check()).toBe(true);

    clock.advance(1_999);
    await wakes.rest();
    expect([dues, held.holding]).toEqual([0, true]);

    clock.advance(1);
    await wakes.rest();
    expect([dues, held.holding]).toEqual([1, false]);
    expect(readDaemonNotes(store, ID).map((n) => n.text)).toEqual([
      "the hold for `npm run gate` passed its 2 s bound; validating again",
    ]);

    clock.advance(10_000);
    await wakes.rest();
    expect(dues).toBe(1);
    held.close();
    store.close();
  });
});
