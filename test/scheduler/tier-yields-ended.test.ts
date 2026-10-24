import { describe, expect, it } from "vitest";
import { RUN_MISSING } from "../helpers/baseline.js";
import { catchUpRepo, catchUpSide } from "./catch-up-fixture.js";
import {
  CUT_WITHIN_MS,
  completions,
  heldRun,
  order,
  pause,
  SETTLE_MS,
} from "./tier-yields-fixture.js";

/*
 * Review `reviews/0.1.237.md` B2 (spec 011 C4 step 5 as corrected
 * 2026-10-21): the runner reports which modules ended only with the run's
 * report, so a revision that re-keys every file of a tier but one that
 * ended does not cancel it; the tier yields only under the 30 s rule. A
 * ends at once, B would take a minute; a save of B's test file re-keys B
 * alone, and queues it as an edit's work behind the tier.
 *
 * The start runs both (`RUN_MISSING`), so the tier's estimate reads the
 * `ms` each run stored. A start that runs nothing leaves no estimate, and
 * the tier then yields 30 s after its start whatever its remainder (row
 * 011-107): the yield passed a 30 s poll by a few ms, and the no-cancel
 * check proved nothing of the 30 s rule (row 011-169). The edit's own check
 * cuts the tier, so its cut comes within `SETTLE_MS`.
 */
const [A, B] = ["test/a.test.ts", "test/b.test.ts"];

/** A and B of `ms` known each in one edit's tier, in flight; B's run would take a minute. */
async function oneEnded(ms: number) {
  const [a, b] = [A, B].map((path) => ({ path, ms, realMs: 0, imports: ["src/ab.ts"] }));
  if (a === undefined || b === undefined) throw new Error("no files");
  const repo = catchUpRepo([a, b]);
  const side = catchUpSide(repo, repo.main, { files: [a, b], hostSlots: 8, policy: RUN_MISSING });
  await side.scheduler.start();
  await side.scheduler.idle();
  const base = side.runner.runs.length;
  b.realMs = 60_000;
  await side.edit("watch", "src/ab.ts");
  const tier = await heldRun(side, B, base);
  // Read at a run's start: the tier keeps its minute, a later run takes none.
  b.realMs = 0;
  return { side, base, tier };
}

describe("a tier whose re-keyed files are not all of it (review 0.1.237 B2, spec 011 C4 step 5)", {
  timeout: 120_000,
}, () => {
  it("a remainder of 30 s or less: no cancel, until a revision re-keys every file of it", async () => {
    const { side, tier } = await oneEnded(20_000);

    await side.edit("watch", B);
    expect(tier.endedAt).toBeNull();
    await pause(SETTLE_MS);
    expect(tier.cancelled).toBe(false);
    expect(tier.endedAt).toBeNull();

    // A save that re-keys A as well: every file of the tier, so the first rule cancels it.
    await side.edit("watch", "src/ab.ts");
    await expect.poll(() => tier.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
    await side.scheduler.idle();
    expect(tier.completed.map((f) => f.path)).toEqual([A]);
    expect([A, B].every((path) => side.current(path))).toBe(true);
  });

  it("a remainder over 30 s: one yield; what ended keeps its result, the rest runs at its new key", async () => {
    const { side, base, tier } = await oneEnded(100_000);
    const editAt = side.runner.runs.length;

    await side.edit("watch", B);
    await expect.poll(() => tier.cancelled, { timeout: SETTLE_MS }).toBe(true);
    await side.scheduler.idle();

    expect(tier.completed.map((f) => f.path)).toEqual([A]);
    expect(order(side, editAt)).toEqual([[B]]);
    expect(completions(side, A, base)).toBe(1);
    expect(completions(side, B, base)).toBe(1);
    expect([A, B].every((path) => side.current(path))).toBe(true);
  });
});
