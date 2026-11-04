import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { readStopHolds } from "../../src/core/delivery/turn.js";
import type { CheckGroup, PolicyFile } from "../../src/core/types/index.js";
import { STOP_RECORD_WAIT_MS } from "../../src/harness/shared/stop-decide.js";
import { FILE, type SquealRepo } from "./helpers.js";
import {
  decision,
  HARNESSES,
  type Harness,
  landSlow,
  mainConsumer,
  queueSlowAgain,
  repo,
  SLOW_FILE,
  slowKey,
  stopBoth,
  turnOf,
} from "./stop-slow-helpers.js";

/*
 * Row 019-30, from the dogfood (`019-run-triggers/lessons.md` Round 1):
 * P3, the first Stop of a session leaves its hold to the waiting entry
 * when the 2 s entry starts first; P5 (option a), a hold at the bound names
 * the group a group at `stop` follows and its files pending; P6, the hold
 * that spends the turn's last one says so and names the run command.
 * Claude Code and Codex alike.
 */

/** A group of the fixture's slow file at `stop`. */
const E2E: CheckGroup = { name: "e2e", runner: "vitest", tests: ["test/e2e/**"], at: "stop" };

/** The group of `FILE`, at `edit`. */
const UNIT: CheckGroup = { name: "unit", runner: "vitest", tests: [FILE.path], at: "edit" };

/** The CLI as either harness names it in a command: `squeal` or a path ending in it. */
const CLI = "`[^`]*squeal[^`]*";

const LAST =
  /\nThis is Stop's last hold this turn: no later Stop in it waits for the e2e group, and `[^`]*squeal[^`]* run e2e --wait` runs it and waits for its results\.\n\n/;

/** A Stop the harness continued after an earlier one blocked. */
const ACTIVE = { stop_hook_active: true };

/** `repo`'s fixture (revision 1, the slow file queued) under `policy`; `marked`: the waiting entry ran before. */
async function withPolicy(harness: Harness, policy: PolicyFile, marked = true) {
  const r = await repo(harness, {}, marked);
  r.policy(policy);
  return r;
}

function holds(r: SquealRepo): number {
  return readStopHolds(r.store, mainConsumer(r));
}

describe.each(HARNESSES)("Stop's first hold, $name (row 019-30, P3)", (harness) => {
  it("both entries at the first Stop, the 2 s entry first: the waiting entry decides, one hold", async () => {
    const r = await withPolicy(harness, { checks: [E2E], stop: { slowWaitMs: 300 } }, false);
    const quick = harness.stop(r);
    await sleep(150);
    const waiting = harness.stopSlow(r);
    const out = { quick: decision(await quick), waiting: decision(await waiting) };
    expect(out.quick).toEqual({});
    expect(out.waiting.decision).toBe("block");
    expect(out.waiting.reason).toMatch(
      /^Squeal policy checks puts the e2e group at stop and after 0\.3 s 1 e2e test file is still not current/,
    );
    expect(holds(r)).toBe(1);
  });

  it("with no waiting entry, the 2 s entry holds after its wait for the record, and counts it", async () => {
    const r = await withPolicy(harness, { checks: [E2E] }, false);
    const started = performance.now();
    const out = decision(await harness.stop(r));
    const ms = performance.now() - started;
    expect(out.decision).toBe("block");
    expect(ms).toBeGreaterThanOrEqual(STOP_RECORD_WAIT_MS - 50);
    expect(ms).toBeLessThan(1_500);
    expect(holds(r)).toBe(1);
  });

  it("a later hold of the turn with no waiting entry does not wait again", async () => {
    const r = await withPolicy(harness, { checks: [E2E], stop: { maxHolds: 2 } }, false);
    expect(decision(await harness.stop(r)).decision).toBe("block");
    const started = performance.now();
    expect(decision(await harness.stop(r, ACTIVE)).decision).toBe("block");
    expect(performance.now() - started).toBeLessThan(STOP_RECORD_WAIT_MS - 100);
    expect(holds(r)).toBe(2);
  });
});

describe.each(HARNESSES)(
  "a hold at the bound for a group that has not started, $name (P5 a)",
  (harness) => {
    /** Revision 2: unit's file queued at it, and the e2e file, which follows unit, queued too. */
    async function following(after: readonly string[]) {
      const r = await withPolicy(harness, {
        checks: [UNIT, { ...E2E, after }],
        stop: { slowWaitMs: 300 },
      });
      r.queue("k2");
      slowKey(r, "queued");
      return r;
    }

    it("names the group it follows and that group's files pending", async () => {
      const r = await following(["unit"]);
      const out = await stopBoth(harness, r);
      expect(out.quick).toEqual({});
      expect(out.waiting.reason).toMatch(
        new RegExp(
          "^Squeal policy checks puts the e2e group at stop and after 0\\.3 s 1 e2e test file is " +
            "still not current at revision 2: test/e2e/slow\\.test\\.ts\\. They have not started: " +
            "they run after the unit group, which has 1 test file pending\\. " +
            `${CLI} run e2e --wait\` waits for their results\\.\n`,
        ),
      );
    });

    it("says nothing of it when the group it follows has nothing pending", async () => {
      const r = await following(["unit"]);
      r.apply(r.pass());
      slowKey(r, "queued");
      const out = await stopBoth(harness, r);
      expect(out.waiting.reason).toMatch(
        /still not current at revision 3: test\/e2e\/slow\.test\.ts\. `/,
      );
      expect(out.waiting.reason).not.toContain("have not started");
    });

    it("says nothing of it when the group follows none, or one of its files is running", async () => {
      const alone = await following([]);
      expect((await stopBoth(harness, alone)).waiting.reason).not.toContain("have not started");
      const running = await following(["unit"]);
      slowKey(running, "queued");
      const revision = running.store.revisions.latest(running.worktreeId)?.number ?? 0;
      running.store.testFileKeys.upsertMany([
        {
          worktreeId: running.worktreeId,
          testFile: SLOW_FILE,
          key: "slow1",
          revision,
          pending: "running",
        },
      ]);
      expect((await stopBoth(harness, running)).waiting.reason).not.toContain("have not started");
    });
  },
);

describe.each(HARNESSES)("the turn's last hold, $name (P6)", (harness) => {
  describe.each([1, 2])("maxHolds %i", (maxHolds) => {
    it("only the hold that spends the last one says so, with the run command", async () => {
      const r = await withPolicy(harness, { checks: [E2E], stop: { slowWaitMs: 300, maxHolds } });
      for (let hold = 1; hold <= maxHolds; hold++) {
        const out = await stopBoth(harness, r, () => {}, 300, hold === 1 ? {} : ACTIVE);
        expect(out.waiting.decision).toBe("block");
        if (hold === maxHolds) expect(out.waiting.reason).toMatch(LAST);
        else expect(out.waiting.reason).not.toContain("last hold");
      }
      const after = await stopBoth(harness, r, () => {}, 300, ACTIVE);
      expect(after).toMatchObject({ quick: {}, waiting: {} });
      expect(turnOf(r)).toBe("idle");
    });

    it("a failure's hold says so at the last one too", async () => {
      const r = await withPolicy(harness, { checks: [E2E], stop: { slowWaitMs: 2_000, maxHolds } });
      for (let hold = 1; hold <= maxHolds; hold++) {
        if (hold > 1) queueSlowAgain(r);
        // A failure told once is not held for again: the second one is another.
        const land = () =>
          hold === 1 ? landSlow(r, "fail") : landSlow(r, "fail", "slow2", "still broken");
        const out = await stopBoth(harness, r, land, 200, hold === 1 ? {} : ACTIVE);
        expect(out.waiting.reason).toMatch(/the e2e group ran at revision \d+: 1 check fails/);
        if (hold === maxHolds) expect(out.waiting.reason).toMatch(LAST);
        else expect(out.waiting.reason).not.toContain("last hold");
      }
    });

    it("the 2 s entry's hold, with no waiting entry, says so at the last one", async () => {
      const r = await withPolicy(harness, { checks: [E2E], stop: { maxHolds } }, false);
      for (let hold = 1; hold <= maxHolds; hold++) {
        const out = decision(await harness.stop(r, hold === 1 ? {} : ACTIVE));
        expect(out.decision).toBe("block");
        if (hold === maxHolds) expect(out.reason).toMatch(LAST);
        else expect(out.reason).not.toContain("last hold");
      }
    });
  });
});

describe.each(HARNESSES)("texts without `checks` are as before, $name (row 019-30)", (harness) => {
  it("the waiting entry's last hold at the bound, beside a fast file pending", async () => {
    const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 300 });
    r.queue("k2");
    slowKey(r, "queued");
    const out = await stopBoth(harness, r);
    expect(out.waiting.reason?.split("\n\n")[0]).toMatch(
      new RegExp(
        "^Squeal policy stop\\.requireSlowSuite is on and after 0\\.3 s 2 slow test files are " +
          "still not current at revision 2: src/math\\.test\\.ts, test/e2e/slow\\.test\\.ts\\. " +
          `${CLI} run --slow --wait\` waits for their results\\.$`,
      ),
    );
  });

  it("the 2 s entry's last hold, with no waiting entry", async () => {
    const r = await repo(harness, { requireSlowSuite: true }, false);
    const out = decision(await harness.stop(r));
    expect(out.reason?.split("\n\n")[0]).toMatch(
      new RegExp(
        "^Squeal policy stop\\.requireSlowSuite is on and 1 slow test file is not current at " +
          `revision 1: test/e2e/slow\\.test\\.ts\\. ${CLI} run --slow --wait\` runs them and ` +
          "waits for their results\\.$",
      ),
    );
  });

  it("a failure's last hold", async () => {
    const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 2_000 });
    const out = await stopBoth(harness, r, () => landSlow(r, "fail"), 200);
    expect(out.waiting.reason?.split("\n\n")[0]).toBe(
      "Squeal policy stop.requireSlowSuite is on and the slow tier ran at revision 1: 1 check " +
        "fails: test/e2e/slow.test.ts > ledger > posts.",
    );
  });
});
