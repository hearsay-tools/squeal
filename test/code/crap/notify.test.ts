import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COVERAGE_COALESCE_MS } from "../../../src/core/code/pass/index.js";
import type { Store } from "../../../src/core/types/index.js";
import { WT } from "../../state/helpers.js";
import { daemonPass } from "../pass/helpers.js";
import { COVERED, coverageRig, sourceOf } from "./rig.js";

/*
 * Review 0.1.305-r2 B1 (row 015-42): a stored record's notification, the
 * code pass's `soon`, revokes the decoded records at once, each time, also
 * while its timer is set; the coalescing delays only the work. The chain's
 * paced continuation can run before that timer, so it must not judge from
 * a record decoded before the notification.
 */

/** Past the step's budget: a step that reads the loader map this long judges nothing more. */
const SLOW_MS = 60;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setImmediate", "Date"], now: 1_000 });
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * One source of CC 6 and one test file that loads it, with a record that
 * ran the function (`hit`) or not; the next `slow()` loader map reads each
 * take `SLOW_MS` by the clock, which the pass's timers do not see.
 */
async function notified(hit: boolean) {
  const rig = coverageRig();
  rig.tree.write("src/a.ts", "cold 6 c1\n").revise();
  const keys = rig.main.testFileKeys;
  let slow = 0;
  const main = {
    results: rig.main.results,
    testFileKeys: {
      list: (...args: Parameters<Store["testFileKeys"]["list"]>) => {
        if (slow > 0) {
          slow--;
          vi.setSystemTime(Date.now() + SLOW_MS);
        }
        return keys.list(...args);
      },
    },
  } as unknown as Pick<Store, "results" | "testFileKeys">;
  const run = daemonPass(rig.tree, {
    policy: () => COVERED,
    now: Date.now,
    coverage: { main, closures: () => rig.closures, writing: () => false },
  });
  run.code.nudge();
  await run.code.idle();
  await vi.advanceTimersByTimeAsync(10 * COVERAGE_COALESCE_MS);
  await run.code.idle();
  const blob = rig.store.files.list(WT, ["src/a.ts"])[0]?.blob ?? "";
  const store = (ran: boolean) =>
    rig.loader("test/a.test.ts", {
      closure: ["src/a.ts"],
      record: [sourceOf("src/a.ts", blob, 1, ran ? [1] : [])],
    });
  store(hit);
  const settle = async () => {
    await vi.advanceTimersByTimeAsync(20 * COVERAGE_COALESCE_MS);
    await run.code.idle();
  };
  return {
    rig,
    run,
    store,
    settle,
    slow: (reads: number) => {
      slow = reads;
    },
    states: () => [...rig.states("uncovered"), ...rig.states("crap")],
  };
}

const HIT = ["cold pass -", "cold pass 6"];
const MISSED = ["cold fail -", "cold fail 42"];

describe("a stored record's notification (review 0.1.305-r2 B1)", () => {
  for (const [first, then, expected] of [
    [true, false, MISSED],
    [false, true, HIT],
  ] as const) {
    it(`judges from the newer record, ${first ? "hit to no hit" : "no hit to hit"}, when the chain's next step runs before the coalescing timer`, async () => {
      const at = await notified(first);
      at.slow(1);
      at.run.code.soon();
      // The step decodes the record and has no budget left to judge: its successor waits SLOW_MS.
      await vi.advanceTimersByTimeAsync(COVERAGE_COALESCE_MS);
      expect(at.states()).toEqual(["cold pending -", "cold pending -"]);

      // A later run at the key stores the other record; its notification's timer is due after the successor.
      at.store(then);
      at.run.code.soon();
      await at.settle();
      expect(at.states()).toEqual(expected);
      expect(at.run.errors).toEqual([]);
      await at.run.code.close();
    });
  }

  it("revokes the decoded records at a second notification while the first one's timer is set", async () => {
    const at = await notified(true);
    at.slow(2);
    at.run.code.soon();
    // The first step decodes the record, past its budget; its successor is due SLOW_MS later.
    await vi.advanceTimersByTimeAsync(COVERAGE_COALESCE_MS);
    expect(at.states()).toEqual(["cold pending -", "cold pending -"]);
    // Results stored just before the successor: their timer is set, the record stays the same.
    await vi.advanceTimersByTimeAsync(SLOW_MS - 1);
    at.run.code.soon();
    // The successor reads the record again, past its budget, and judges nothing.
    await vi.advanceTimersByTimeAsync(1);
    expect(at.states()).toEqual(["cold pending -", "cold pending -"]);

    // The other record, notified while the first timer is still set.
    at.store(false);
    at.run.code.soon();
    await at.settle();
    expect(at.states()).toEqual(MISSED);
    expect(at.run.errors).toEqual([]);
    await at.run.code.close();
  });
});
