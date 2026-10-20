// Throwaway probe for ../../issue-52.md. Not product code; nothing imports it.
// Drives the product scheduler and delivery unchanged, through the 001-368
// retry fixture, with the host load injected (SchedulerOptions.hostLoad).
import { rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createDelivery, formatRegistration } from "../../../../../../src/core/delivery/index.js";
import { readRetries } from "../../../../../../src/core/retry/index.js";
import { type Consumer, MAIN_AGENT, type Store } from "../../../../../../src/core/types/index.js";
import { type Harness, openHarness, openRepoStore, SLOW } from "../../../../../../test/scheduler/helpers.js";
import { ask, failing, flakyRepo, flips, loadKnob, pass } from "../../../../../../test/scheduler/retry-fixture.js";

async function registration(store: Store, h: Harness, sessionId: string) {
  const delivery = createDelivery(store, {
    status: {
      build: () => ({ schemaVersion: 1, available: false, reason: "timeout", message: "n/a" }),
    },
  });
  const consumer: Consumer = { worktreeId: h.worktreeId, sessionId, agentId: MAIN_AGENT };
  return formatRegistration(await delivery.register(consumer));
}

const show = (label: string, text: string) =>
  console.log(`---- ${label}\n${text.split("\n").filter((l) => /Known failures|Earlier failures|FAIL|Recorded|retry|Retry|Pending/.test(l)).join("\n")}`);

// 8 CPUs as the fixture's knob; 26.64 / 8 = 3.33 per CPU, the issue's figure.
const ABOVE = 26.64;
const BELOW = 4;

async function setup(oneMinute: number, rerunCap: number | undefined) {
  const repo = flakyRepo();
  const load = loadKnob();
  load.set(oneMinute);
  const store = openRepoStore(repo.commonDir);
  const h = await openHarness(repo.main, store, repo.commonDir, {
    hostLoad: load.read,
    ...(rerunCap === undefined ? {} : { rerunCap }),
  });
  await failing(h);
  return { repo, load, store, h };
}

describe("issue 52: a failure recorded above the load threshold", SLOW, () => {
  for (const rerunCap of [0, undefined]) {
    it(`queues no load retry by itself (rerunCap ${rerunCap ?? "default"})`, async () => {
      const { store, h } = await setup(ABOVE, rerunCap);
      for (let i = 0; i < 3; i++) await pass(h); // three reconciliation passes
      expect(readRetries(store)).toEqual([]);
      expect(h.sink.stateOf(flips)).toMatchObject({ outcome: "fail", validity: "current" });
      const text = await registration(store, h, "s1");
      show(`above, rerunCap ${rerunCap ?? "default"}`, text);
      expect(text).toContain("load 3.33 per CPU when it ran; no retry asked at these inputs");
      expect(text).not.toContain("Pending retries");
      expect(text).not.toContain("pending rerun");
    });
  }

  it("reads the same below the threshold, but for the number", async () => {
    const { store, h } = await setup(BELOW, 0);
    await pass(h);
    expect(readRetries(store)).toEqual([]);
    const text = await registration(store, h, "s1");
    show("below", text);
    expect(text).toContain("load 0.50 per CPU when it ran; no retry asked at these inputs");
  });

  it("a manual --reason load retry waits for load, is reported pending, keeps the failure counted, then runs", async () => {
    const { repo, load, store, h } = await setup(ABOVE, 0);
    ask(store, h, "s1", "load");
    await h.scheduler.requestRetries();
    await pass(h);
    const waiting = readRetries(store);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ reason: "load", claim: null, end: null });
    const text = await registration(store, h, "s2");
    show("manual retry, load still above", text);
    expect(text).toContain("retry asked (load) at these inputs, pending");
    expect(h.sink.stateOf(flips)).toMatchObject({ outcome: "fail", validity: "current" });

    rmSync(repo.marker); // the outside cause goes away
    load.set(BELOW);
    await pass(h);
    expect(readRetries(store)[0]?.end?.outcome).toBe("passed");
    expect(h.sink.stateOf(flips)).toMatchObject({ outcome: "pass" });
  });
});
