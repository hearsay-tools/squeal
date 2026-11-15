import { describe, expect, it } from "vitest";
import {
  decideRelease,
  type ReleaseLane,
  SLOW_RELEASE_MS,
} from "../../src/core/scheduler/slow-release.js";
import type { EpochMs } from "../../src/core/types/common.js";

/*
 * Row 011-355 (`research/scheduler-step.md`, "Tests: replace, don't layer"):
 * `decideRelease(lanes, at)` as a table: which open lanes are idle, which
 * close now and when the next is due. It replaces the rule cases of
 * `slow-release.test.ts` that ran the bound on a clock;
 * `tasks/011-355/notes.md` names them. What stays there is the apply:
 * the wake, a slow selection, a hold's close and the scheduler's orders.
 */

const AT = 1_000_000 as EpochMs;
const B = SLOW_RELEASE_MS;

/** A lane open since a run that ended `ago` ms before `AT` (`null`: no end recorded). */
const lane = (name: string, ago: number | null, busy = false): ReleaseLane => ({
  lane: name,
  busy,
  endedAt: ago === null ? null : ((AT - ago) as EpochMs),
});

interface Row {
  readonly name: string;
  readonly lanes: readonly ReleaseLane[];
  /** The decision, its wake as ms after `AT`. */
  readonly want: { idle: string[]; close: string[]; wakeAt: number | null };
}

const ROWS: readonly Row[] = [
  {
    name: "no open lane: nothing closes, no wake",
    lanes: [],
    want: { idle: [], close: [], wakeAt: null },
  },
  {
    name: "one ms before the bound: it stays, the wake at its bound",
    lanes: [lane("slow", B - 1)],
    want: { idle: ["slow"], close: [], wakeAt: 1 },
  },
  {
    name: "at the bound after the last run: it closes",
    lanes: [lane("slow", B)],
    want: { idle: ["slow"], close: ["slow"], wakeAt: 0 },
  },
  {
    name: "counts from the latest run's end, not the first",
    lanes: [lane("slow", B / 2)],
    want: { idle: ["slow"], close: [], wakeAt: B / 2 },
  },
  {
    name: "no end recorded: it counts from the reading",
    lanes: [lane("slow", null)],
    want: { idle: ["slow"], close: [], wakeAt: B },
  },
  {
    name: "a lane with a tier in flight stays past its bound and sets no wake",
    lanes: [lane("slow", B * 2, true)],
    want: { idle: [], close: [], wakeAt: null },
  },
  {
    name: "a lane waiting for its load guard stays; another past its bound closes",
    lanes: [lane("slow", B * 2), lane("group", B * 2, true)],
    want: { idle: ["slow"], close: ["slow"], wakeAt: -B },
  },
  {
    name: "each lane at its own bound while another keeps ending tiers (review 0.1.396 S4)",
    lanes: [lane("slow", B), lane("group", B / 2)],
    want: { idle: ["slow", "group"], close: ["slow"], wakeAt: 0 },
  },
  {
    name: "two idle lanes before their bounds: the wake at the earlier",
    lanes: [lane("slow", 10), lane("group", 20)],
    want: { idle: ["slow", "group"], close: [], wakeAt: B - 20 },
  },
];

describe("decideRelease (row 011-355)", () => {
  it.each(ROWS)("$name", ({ lanes, want }) => {
    const decision = decideRelease(lanes, AT);
    expect({ ...decision, wakeAt: decision.wakeAt === null ? null : decision.wakeAt - AT }).toEqual(
      want,
    );
  });

  it("takes its bound as the third argument", () => {
    expect(decideRelease([lane("slow", 500)], AT, 500).close).toEqual(["slow"]);
    expect(decideRelease([lane("slow", 499)], AT, 500)).toEqual({
      idle: ["slow"],
      close: [],
      wakeAt: AT + 1,
    });
  });
});
