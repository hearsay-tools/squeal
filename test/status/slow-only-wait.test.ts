import { describe, expect, it } from "vitest";
import { type EndedWait, waitText } from "../../src/cli/status-wait-lines.js";
import { publishSlowActivity } from "../../src/core/slow/state.js";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import type { LoadNow, SlowTierWait, StatusSnapshot } from "../../src/core/types/index.js";
import { BUSY, QUIET } from "../cli/next-step-seed.js";
import {
  FAST,
  inTurn,
  keys,
  NOW,
  type Seeded,
  SLOW_A,
  SLOW_B,
  seed,
  states,
} from "./slow-tier-seed.js";

/*
 * Row 004-85 (004 D8; 011 C6 as amended 2026-10-20, row 011-29): status
 * never reads as a stuck daemon when only slow files wait. Row 011-29
 * deleted the `Idle: nothing is running and no run is open; N queued` line,
 * and `Outstanding:` leaves out the slow files the `Slow tier:` line counts,
 * so the slow tier's wait is named once, on that line, in `squeal status`
 * and in the pathless wait's text.
 */

const WORDS: Record<"load" | "slot", string> = {
  load: "waiting for host load to drop",
  slot: "waiting for the slow slot another worktree's slow tier holds",
};

/**
 * `queued` queued, the fast file otherwise current at revision 2, an agent
 * in a turn, and the daemon holding the slow files for `wait`.
 */
function heldSlow(wait: SlowTierWait, ...queued: string[]): Seeded {
  const s = seed();
  const fast = queued.includes(FAST)
    ? { validity: "pending" as const, pendingPhase: "queued" as const }
    : { observedAt: 2 };
  states(s.store, s.repo, [fast], [FAST]);
  inTurn(s);
  keys(s.store, s.repo, Object.fromEntries(queued.map((path) => [path, "queued"])));
  publishSlowActivity(s.store, s.repo.mainId, { kind: "waiting", for: wait });
  return s;
}

function snapshotOf({ repo, store }: Seeded, load: LoadNow): StatusSnapshot {
  store.close();
  const status = readStatus(repo.main, { now: () => NOW, load: () => load });
  if (!status.available) throw new Error(status.message);
  return status;
}

/** The lines of the `Outstanding:` block, its heading left out; empty without one. */
function outstanding(text: string): string[] {
  const lines = text.split("\n");
  const at = lines.indexOf("Outstanding:");
  if (at < 0) return [];
  const end = lines.findIndex((l, i) => i > at && !l.startsWith("  "));
  return lines.slice(at + 1, end < 0 ? undefined : end);
}

/** A pathless wait that returned on quiet: the edit's one fast file has its result. */
function quietWait(result: StatusSnapshot): EndedWait {
  return {
    outcome: "quiet",
    waitedMs: 0,
    transitions: 0,
    edit: { since: 1, testFiles: 1, pending: 0, otherTransitions: 0 },
    result,
  } as unknown as EndedWait;
}

/** No `Idle` line, no group for the held slow files, the wait named once and on the `Slow tier:` line. */
function expectSlowWaitOnly(text: string, wait: "load" | "slot") {
  expect(text).not.toMatch(/^Idle/m);
  expect(text).not.toContain("nothing is running");
  expect(outstanding(text).filter((l) => l.includes(SLOW_A) || l.includes(SLOW_B))).toEqual([]);
  const named = text.split("\n").filter((line) => line.includes(WORDS[wait]));
  expect(named).toHaveLength(1);
  expect(named[0]).toMatch(/^Slow tier: 2 test files; 2 pending, /);
}

describe("every queued file slow and held: the wait is the slow tier's, named once (004-85)", () => {
  it.each<["load" | "slot", LoadNow]>([
    ["load", BUSY],
    ["slot", QUIET],
  ])(
    "held for the %s: squeal status prints no Idle line and no Outstanding group for them",
    (wait, load) => {
      const text = formatStatus(snapshotOf(heldSlow(wait, SLOW_A, SLOW_B), load), NOW);

      expectSlowWaitOnly(text, wait);
      expect(text).not.toContain("Outstanding:");
      expect(text).toContain("Known failures: 0; not current: 2 of 3 test files (2 queued)");
    },
  );

  it.each<["load" | "slot", LoadNow]>([
    ["load", BUSY],
    ["slot", QUIET],
  ])(
    "held for the %s: the pathless wait's text names it once, and its verdict line says they run after the fast tests",
    (wait, load) => {
      const result = snapshotOf(heldSlow(wait, SLOW_A, SLOW_B), load);

      const text = waitText(quietWait(result), NOW).trimEnd();

      expectSlowWaitOnly(text, wait);
      expect(text.split("\n").at(-1)).toMatch(
        /^Returned on quiet: the 1 test file the edits since revision 1 re-keyed is not pending, at revision 2 after 0\.0 s; this wait does not hold for the rest of the worktree; 2 slow files are not current and Squeal runs them after the fast tests; /,
      );
    },
  );
});

describe("the control: a fast file queued with nothing running keeps its group (004-85)", () => {
  it("prints the fast file's queued group beside held slow files, and none for them", () => {
    const s = heldSlow("load", SLOW_A, SLOW_B, FAST);
    const text = formatStatus(snapshotOf(s, BUSY), NOW);

    const groups = outstanding(text);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatch(new RegExp(`^  1 test file queued.*: ${FAST}(;|$)`));
    expectSlowWaitOnly(text, "load");
  });
});
