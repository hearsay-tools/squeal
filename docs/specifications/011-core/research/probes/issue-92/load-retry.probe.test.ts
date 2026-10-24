import { rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { HostLoad } from "../../../../../../src/core/retry/index.js";
import { readRetries, waitsText } from "../../../../../../src/core/retry/index.js";
import { openHarness, openRepoStore, SLOW } from "../../../../../../test/scheduler/helpers.js";
import {
  ask,
  FLAKY,
  failing,
  flakyRepo,
  flips,
  options,
  pass,
} from "../../../../../../test/scheduler/retry-fixture.js";

/*
 * Throwaway probe for gh-92. Mocked host load on 24 CPUs: the host is never
 * loaded. A reconciliation pass stands for the change feed's 30 s interval.
 */

function knob24(start: number) {
  let load: HostLoad = { oneMinute: start, cpus: 24 };
  return {
    read: () => load,
    set: (oneMinute: number) => {
      load = { oneMinute, cpus: 24 };
    },
  };
}

const log = (line: string) => console.log(`[gh-92] ${line}`);

describe("gh-92 load retry gate", SLOW, () => {
  it("stays queued at the incident's loads, opens below 24, keeps the FAIL until a pass", async () => {
    const repo = flakyRepo();
    const load = knob24(104.73);
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, options(load));
    await failing(h);
    // The cause is gone: a run now would pass.
    rmSync(repo.marker);

    load.set(83.92);
    expect(ask(store, h, "s1", "load").kind).toBe("queued");
    await h.scheduler.requestRetries();
    await h.scheduler.idle();
    log(`waits: ${waitsText("load", load.read())}`);

    // The incident's range 66 to 105, then the edge: 60 passes = 30 min of 30 s passes.
    const loads = [105, 66, 83.92, 70, 50, 30, 24, 24.0];
    for (let i = 0; i < 60; i++) {
      load.set(loads[i % loads.length] as number);
      await pass(h);
    }
    const runsHigh = h.runsOf(FLAKY).length;
    const stateHigh = h.sink.stateOf(flips);
    const reqHigh = readRetries(store)[0];
    log(`after 60 passes at load 24..105 on 24 CPUs: runs=${runsHigh} state=${stateHigh?.outcome}/${stateHigh?.validity} claim=${JSON.stringify(reqHigh?.claim)} end=${JSON.stringify(reqHigh?.end)}`);
    expect(runsHigh).toBe(1);
    expect(stateHigh).toMatchObject({ outcome: "fail", validity: "current" });
    expect(reqHigh).toMatchObject({ claim: null, end: null });

    load.set(23.99);
    await pass(h);
    const runsLow = h.runsOf(FLAKY).length;
    const stateLow = h.sink.stateOf(flips);
    const reqLow = readRetries(store)[0];
    log(`after 1 pass at load 23.99: runs=${runsLow} state=${stateLow?.outcome}/${stateLow?.validity} end=${reqLow?.end?.outcome}`);
    expect(runsLow).toBe(2);
    expect(stateLow).toMatchObject({ outcome: "pass", validity: "current" });
    expect(reqLow?.end?.outcome).toBe("passed");
  });

  it("a load retry whose rerun fails again ends failed and the FAIL stays", async () => {
    const repo = flakyRepo();
    const load = knob24(5.46);
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, options(load));
    await failing(h);
    // Marker kept: the cause is still there.
    ask(store, h, "s1", "load");
    await h.scheduler.requestRetries();
    await h.scheduler.idle();
    await pass(h);
    const state = h.sink.stateOf(flips);
    const req = readRetries(store)[0];
    log(`load 5.46, cause kept: runs=${h.runsOf(FLAKY).length} state=${state?.outcome}/${state?.validity} end=${req?.end?.outcome}`);
    expect(h.runsOf(FLAKY)).toHaveLength(2);
    expect(state).toMatchObject({ outcome: "fail", validity: "current" });
    expect(req?.end?.outcome).toBe("failed");
  });
});
