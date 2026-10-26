import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RECORD_WAIT_MS, readSummary } from "../../../src/core/code/crap/index.js";
import { WT } from "../../state/helpers.js";
import { daemonPass } from "../pass/helpers.js";
import { COVERED, coverageRig } from "./rig.js";

/*
 * Row 015-75 part 3 (issue #106, research Q5): a source whose only loader
 * has a current result and no record turns `unknown` once D9's wait ends,
 * in a live daemon. A nudge that finds nothing to step in between, as the
 * scheduler's `afterBatch` gives, must not drop the wake.
 */

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setImmediate", "Date"], now: 1_000 });
});

afterEach(() => {
  vi.useRealTimers();
});

async function waiting() {
  const rig = coverageRig();
  rig.tree.write("src/a.ts", "cold 6 c1\n").revise();
  rig.loader("test/a.test.ts", { closure: ["src/a.ts"], recordedAt: Date.now() });
  const run = daemonPass(rig.tree, {
    policy: () => COVERED,
    now: Date.now,
    coverage: { main: rig.main, closures: () => rig.closures, writing: () => false },
  });
  run.code.nudge();
  await run.code.idle();
  const file = () => readSummary(rig.store.meta, WT)?.files["src/a.ts"];
  expect(file()).toMatchObject({ state: "pending", reason: "record" });
  return { run, file };
}

describe("the wait for a record that never comes (row 015-75 part 3)", () => {
  it("turns the source unknown within D9's wait", async () => {
    const { run, file } = await waiting();
    await vi.advanceTimersByTimeAsync(RECORD_WAIT_MS + 1);
    await run.code.idle();
    expect(file()).toMatchObject({ state: "unknown", cause: "no-record" });
    expect(run.errors).toEqual([]);
    await run.code.close();
  });

  it("keeps the wake past a nudge that finds nothing to step", async () => {
    const { run, file } = await waiting();
    await vi.advanceTimersByTimeAsync(1_000);
    run.code.nudge();
    await run.code.idle();
    await vi.advanceTimersByTimeAsync(RECORD_WAIT_MS);
    await run.code.idle();
    expect(file()).toMatchObject({ state: "unknown", cause: "no-record" });
    expect(run.errors).toEqual([]);
    await run.code.close();
  });
});
