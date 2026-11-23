import { describe, expect, it } from "vitest";
import { MEASURED_LEAST, tooFew } from "../../src/cli/status-at-estimate.js";
import { tooFewStored, UNKNOWN_CUT_FILES } from "../../src/core/scheduler/lead-cut.js";
import { Gate } from "../scheduler/batch-fixture.js";
import {
  ask,
  asksOf,
  files,
  path,
  paths,
  TIMEOUT,
  unseeded,
  wideTier,
} from "./at-asks-running-fixture.js";

/*
 * Row 023-65 (dogfood round 8, W3's rest): in 3 of 10 s2 sessions the named
 * file sat in the commit daemon's batch of 200 files, of which 21 had a
 * stored duration. Squeal said "its result waits for the batch that holds
 * it … (time unknown: too few runs stored …)", and one session ended
 * without the result. With no stored duration the tier's work left counted
 * 0, so the time rule never cut. Now a tier whose time is unknown is cut
 * when more than `UNKNOWN_CUT_FILES` of its unfinished files are outside
 * the leading batch.
 */

describe("a named file inside a batch tier of unknown time (row 023-65, W3's rest)", {
  timeout: 90_000,
}, () => {
  it("cuts the tier on an empty store: the named file runs next, alone", async () => {
    const of = files(10_000, () => 500);
    const side = await unseeded(of);
    const gate = new Gate();
    side.runner.holdOf = (run) => (run.files.length > 1 ? gate.wait() : undefined);
    const asks = asksOf(side, of);
    const tier = await wideTier(side, asks);
    const named = path(39);

    await ask(asks, "narrow", [named]);
    await expect.poll(() => side.current(named), { timeout: TIMEOUT, interval: 20 }).toBe(true);
    expect(tier.cancelled).toBe(true);
    expect(paths(side.runner.runs[1])).toEqual([named]);
    gate.stop();
    await expect.poll(() => of.every((f) => side.current(f.path)), { timeout: TIMEOUT }).toBe(true);
  });

  it(`does not cut when at most ${UNKNOWN_CUT_FILES} unfinished files are outside the leading batch`, async () => {
    const of = files(10_000, () => 500);
    const side = await unseeded(of);
    const gate = new Gate();
    side.runner.holdOf = (run) => (run.files.length > 1 ? gate.wait() : undefined);
    const asks = asksOf(side, of);
    const tier = await wideTier(side, asks);
    // 20 of the 40 named: 20 outside.
    await ask(
      asks,
      "group",
      Array.from({ length: 40 - UNKNOWN_CUT_FILES }, (_, i) => path(i)),
    );
    await side.rest();
    expect(tier.cancelled).toBe(false);
    expect(side.runner.runs).toHaveLength(1);
    gate.stop();
    await expect.poll(() => of.every((f) => side.current(f.path)), { timeout: TIMEOUT }).toBe(true);
  });

  it("cuts once: a second leading call inside the cut batch's next tier waits for it", async () => {
    const of = files(10_000, () => 500);
    const side = await unseeded(of);
    const gate = new Gate();
    side.runner.holdOf = (run) => (run.files.length > 1 ? gate.wait() : undefined);
    const asks = asksOf(side, of);
    const tier = await wideTier(side, asks);
    await ask(asks, "first", [path(39)]);
    await expect.poll(() => side.current(path(39)), { timeout: TIMEOUT }).toBe(true);
    expect(tier.cancelled).toBe(true);
    await expect.poll(() => side.runner.runs.length, { timeout: TIMEOUT }).toBe(3);
    const next = side.runner.runs[2];
    expect(paths(next)).toContain(path(38));

    await ask(asks, "second", [path(38)]);
    await side.rest();
    expect(next?.cancelled).toBe(false);
    expect(side.runner.runs).toHaveLength(3);
    gate.stop();
    await expect.poll(() => side.current(path(38)), { timeout: TIMEOUT }).toBe(true);
  });

  it("reads 'too few stored' as the call's estimate does", () => {
    expect(MEASURED_LEAST).toBe(10);
    for (let files = 0; files <= 220; files += 1) {
      for (let known = 0; known <= files; known += 1) {
        if (tooFewStored(known, files) !== tooFew(known, files))
          throw new Error(`${known} of ${files}: the floors differ`);
      }
    }
  });
});
