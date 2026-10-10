import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { CLAIM_GRACE_MS, CLAIM_RECHECK_MS } from "../../src/core/scheduler/claims.js";
import { claimRepo, fileName, type Side, side } from "./claims-fixture.js";

/*
 * Task 001-205: a claim ends when the claimant's tier records, when its
 * heartbeat is two intervals old, or when the waiter has seen it for its own
 * `runner.timeoutMs` plus `CLAIM_GRACE_MS` (research `shared-runs.md`,
 * finding 2). Tests 2, 3 and 10 of the research's ten.
 */

const F0 = fileName(0);

/** `a` runs and holds its first tier; `b` then finds every file claimed and runs none. */
async function heldInA(a: Side, b: Side): Promise<void> {
  a.runner.hold();
  await a.scheduler.start();
  await expect.poll(() => a.runner.active).toBe(1);
  await b.scheduler.start();
  await delay(CLAIM_RECHECK_MS / 2);
  expect(b.runner.runs).toEqual([]);
  expect(b.phase(F0)).toBe("queued");
}

describe("claims: expiry and takeover (task 001-205)", { timeout: 30_000 }, () => {
  it("2. a claimant whose heartbeat stops: the waiter runs its files within two intervals plus 1 s", async () => {
    const { main, other } = claimRepo(6);
    const a = side(main, { count: 6, backlogTierSize: 6, heartbeatMs: 1_000 });
    const b = side(other, { count: 6, backlogTierSize: 6 });
    await heldInA(a, b);
    await delay(1_500);
    expect(b.runner.runs).toEqual([]);

    a.stopBeat();
    const stopped = Date.now();
    await expect.poll(() => b.runner.runs.flat().length, { timeout: 10_000 }).toBe(6);
    // Two intervals and the 1 s recheck, with room for a loaded host.
    expect(Date.now() - stopped).toBeLessThan(2 * 1_000 + CLAIM_RECHECK_MS + 1_500);
  });

  it.each([
    [
      "crashed",
      (a: Side) => {
        a.runner.end = "crashed";
      },
    ],
    [
      "timed out",
      (a: Side) => {
        a.runner.end = "timed-out";
      },
    ],
    [
      "discarded: an edit moved its input during the run",
      async (a: Side) => {
        appendFileSync(join(a.root, F0), "// edited\n");
        await a.batch(F0);
      },
    ],
    [
      "withheld by the completion barrier: its input was touched",
      (a: Side) => {
        const path = join(a.root, F0);
        writeFileSync(path, readFileSync(path));
      },
    ],
  ])("3. a claimant's tier that %s stores nothing: the waiter runs the file", async (_, end) => {
    const { main, other } = claimRepo(1);
    const a = side(main, { count: 1 });
    const b = side(other, { count: 1 });
    await heldInA(a, b);
    const key = b.keyOf(F0);
    await end(a);
    a.runner.release();
    await b.scheduler.idle();
    expect(b.runner.ran(F0)).toBe(1);
    expect(b.keyOf(F0)).toBe(key);
    expect(b.passing()).toBe(1);
  });

  it("10. a claim held past the waiter's timeout plus grace, heartbeat fresh: the waiter runs the file", async () => {
    const { main, other } = claimRepo(1);
    let skew = 0;
    const a = side(main, { count: 1, heartbeatMs: 1_000_000_000 });
    const b = side(other, { count: 1, timeoutMs: 1_000, now: () => Date.now() + skew });
    await heldInA(a, b);
    await delay(CLAIM_RECHECK_MS * 1.5);
    expect(b.runner.runs).toEqual([]);

    skew = 1_000 + CLAIM_GRACE_MS + 1;
    await expect.poll(() => b.runner.ran(F0), { timeout: 5_000 }).toBe(1);
    expect(a.runner.active).toBe(1);
  });
});
