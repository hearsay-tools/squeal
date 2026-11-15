import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { RUN_MISSING } from "../helpers/baseline.js";
import { catchUpRepo, catchUpSide } from "./catch-up-fixture.js";

/*
 * Review 0.1.513 B1 (row 011-352): `Scheduler.rest()` on a real scheduler.
 * A runner's run is set aside, so a held run counts as rest while the pump
 * waits for an event; the run's end, and the record and pump work after it,
 * do not.
 */

/** Whether `promise` settles within `ms` of real time. */
async function settles(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return Promise.race([promise.then(() => true), delay(ms).then(() => false)]);
}

describe("Scheduler.rest() with a held run (review 0.1.513 B1)", { timeout: 60_000 }, () => {
  it("rests while the run is held; after its release, rests only once its record ended", async () => {
    const files = [{ path: "test/a.test.ts", ms: 1, imports: ["src/a.ts"] }];
    const repo = catchUpRepo(files);
    const side = catchUpSide(repo, repo.main, { files, hostSlots: 2, policy: RUN_MISSING });
    await side.scheduler.start();
    await side.scheduler.idle();

    side.runner.hold();
    // A rest asked for as the run returns, before the scheduler's continuation runs.
    let idle = false;
    let afterRun: Promise<boolean> | null = null;
    const run = side.runner.run.bind(side.runner);
    side.runner.run = async (refs, options) => {
      const report = await run(refs, options);
      afterRun = side.scheduler.rest().then(() => idle);
      return report;
    };
    await side.edit("watch", "src/a.ts");
    await expect.poll(() => side.runner.active, { timeout: 10_000 }).toBe(1);
    expect(await settles(side.scheduler.rest(), 5_000)).toBe(true);
    expect(side.runner.active).toBe(1);

    void side.scheduler.idle().then(() => {
      idle = true;
    });
    side.runner.release();
    await expect.poll(() => afterRun, { timeout: 10_000 }).not.toBeNull();
    // The run's end does not count as rest: its record and the pump's last pass come first.
    expect(await afterRun).toBe(true);
  });
});
