import { setTimeout as turn } from "node:timers/promises";
import { describe, expect, it, onTestFinished } from "vitest";
import { catchUpRepo, catchUpSide } from "../scheduler/catch-up-fixture.js";
import { RUN_MISSING } from "./baseline.js";

/*
 * Review `reviews/011-378.md` B1: a runner-part call the scheduler abandons
 * after the quiet point began waiting. Its bound (`RunnerPartBound`) drops
 * the call and leaves the runner's promise open, so no call ends: the quiet
 * point must see the abandonment in a fresh rest, as `Scheduler.idle()` does.
 */

const BOUND_MS = 400;

/** A side whose next `invalidate` never answers, after an edit that made it: its bound is armed. */
async function heldInvalidate(clock?: "virtual") {
  const file = { path: "test/a.test.ts", ms: 1, realMs: 0, imports: ["src/a.ts"] };
  const repo = catchUpRepo([file]);
  const side = catchUpSide(repo, repo.main, {
    files: [file],
    hostSlots: 2,
    policy: RUN_MISSING,
    runnerPartMs: BOUND_MS,
    ...(clock === undefined ? {} : { clock }),
  });
  await side.scheduler.start();
  await side.quiet();
  let release = () => {};
  const held = new Promise<{ recreatedProjects: never[] }>((resolve) => {
    release = () => resolve({ recreatedProjects: [] });
  });
  onTestFinished(() => release());
  side.runner.invalidate = () => held;

  await side.edit("watch", "src/a.ts");
  const armed = await side.rest();
  expect(armed.wakes.map((wake) => wake.reason)).toContain("runner-part-bound");
  expect(side.calls.describe()).toBe("invalidate ×1");
  return side;
}

/** `promise`'s outcome: `"quiet"` when it resolved, else its error's message. */
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => "quiet",
    (error: unknown) => String(error),
  );

describe("the quiet point sees a call abandoned while it waits (review 011-378 B1)", {
  timeout: 60_000,
}, () => {
  it("on the host's clock: returns once the bound abandons the call, which stays open", async () => {
    const side = await heldInvalidate();
    const point = outcome(side.quiet({ limitMs: 10_000 }));

    expect(await point).toBe("quiet");
    expect(side.calls.describe()).toBe("invalidate ×1");
    expect((await side.rest()).wakes.map((wake) => wake.reason)).not.toContain("runner-part-bound");
  });

  it("on a virtual clock: moves no time to the bound; returns once the test moves it", async () => {
    const side = await heldInvalidate("virtual");
    const at = side.now();
    let done = false;
    const point = outcome(side.quiet({ limitMs: 10_000 })).finally(() => {
      done = true;
    });

    await turn(200);
    expect(done).toBe(false);
    expect(side.now()).toBe(at);

    side.advance(BOUND_MS);
    expect(await point).toBe("quiet");
    expect(side.calls.describe()).toBe("invalidate ×1");
  });
});
