import { rmSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createDelivery, formatDelta, formatRegistration } from "../../src/core/delivery/index.js";
import { agoText, readRetries, recordedText } from "../../src/core/retry/index.js";
import {
  type Consumer,
  MAIN_AGENT,
  type RecordedFacts,
  type RetryFact,
  type Store,
} from "../../src/core/types/index.js";
import { type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";
import { ask, FLAKY, failing, flakyRepo, flips, loadKnob, options, pass } from "./retry-fixture.js";

/*
 * Spec 001 D6 as amended (001-368): a session meeting a failure at
 * registration is told where and at what load it was recorded and whether a
 * retry was asked at its key; a retry's pass is `FAIL -> PASS` with the flaky
 * note and the agent's reason.
 */

function deliveryFor(store: Store, h: Harness, sessionId: string) {
  const delivery = createDelivery(store, {
    status: {
      build: () => ({
        schemaVersion: 1,
        available: false,
        reason: "timeout",
        message: "status is not under test here",
      }),
    },
  });
  const consumer: Consumer = { worktreeId: h.worktreeId, sessionId, agentId: MAIN_AGENT };
  return { delivery, consumer };
}

async function registered(store: Store, h: Harness, sessionId: string) {
  const { delivery, consumer } = deliveryFor(store, h, sessionId);
  const text = formatRegistration(await delivery.register(consumer));
  return { delivery, consumer, text };
}

describe("a retry as the agent reads it", SLOW, () => {
  it("states the recorded facts at registration, the pending retry, and its pass with the reason", async () => {
    const repo = flakyRepo();
    const load = loadKnob();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, options(load));
    await failing(h);
    const revision = store.knownStates.get(h.worktreeId, {
      kind: "test",
      project: "",
      testPath: "test/flaky.test.ts",
      fullName: "flips",
    })?.observedAt;

    const first = await registered(store, h, "s1");
    expect(first.text).toContain(
      `Recorded just now in this worktree at revision ${revision}, load 2.00 per CPU when it ran; no retry asked at these inputs`,
    );

    ask(store, h, "s1", "load");
    await h.scheduler.requestRetries();
    const second = await registered(store, h, "s2");
    expect(second.text).toContain("; retry asked (load) at these inputs, pending");

    rmSync(repo.marker);
    load.set(1);
    await pass(h);
    const delta = await first.delivery.onToolBoundary(first.consumer);
    const text = formatDelta(delta ?? expect.fail("no delta"));
    expect(text).toContain("PASS  test/flaky.test.ts > flips");
    expect(text).toContain("FAIL -> PASS");
    expect(text).toContain("Flaky: FAIL -> PASS under the same inputs");
    expect(text).toContain("Retry asked (load) at these inputs: it passed");
  });

  // Row 011-67 (gh-52): guidance only; the failure stays counted and nothing is queued (011 C5).
  it("names the load retry for a failure recorded under load, and asks none", async () => {
    const repo = flakyRepo();
    const load = loadKnob();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, options(load));
    await failing(h);
    const runs = h.runsOf(FLAKY).length;

    const { text } = await registered(store, h, "s1");
    expect(text).toContain("Known failures: 1 (1 test)");
    expect(text).toContain(
      "load 2.00 per CPU when it ran; no retry asked at these inputs; `squeal retry test/flaky.test.ts --reason load` runs it once more when the one-minute load average is below the CPU count",
    );

    // A load the retry would run at: had the text asked one, this pass would run it.
    load.set(1);
    await pass(h);
    expect(readRetries(store)).toEqual([]);
    expect(h.runsOf(FLAKY)).toHaveLength(runs);
    expect(h.sink.stateOf(flips)).toMatchObject({ outcome: "fail", validity: "current" });
    expect((await registered(store, h, "s2")).text).toContain("Known failures: 1 (1 test)");

    ask(store, h, "s1", "load");
    expect((await registered(store, h, "s3")).text).not.toContain("squeal retry");
  });

  it("names a retry only on the recovery its run produced (review 001-398, S2)", async () => {
    const repo = flakyRepo();
    const load = loadKnob();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, options(load));
    await failing(h);
    const { delivery, consumer } = await registered(store, h, "s0");

    // s1's retry passes; s2's, at the same key with the marker back, fails again.
    rmSync(repo.marker);
    ask(store, h, "s1", "environment");
    await h.scheduler.requestRetries();
    await h.scheduler.idle();
    const retried = formatDelta(
      (await delivery.onToolBoundary(consumer)) ?? expect.fail("no delta"),
    );
    expect(retried).toContain("Retry asked (environment) at these inputs: it passed");
    writeFileSync(repo.marker, "");
    await h.scheduler.requestFullSuite({ force: true });
    await h.scheduler.idle();
    ask(store, h, "s2", "environment");
    await h.scheduler.requestRetries();
    await h.scheduler.idle();
    expect(h.sink.stateOf(flips)).toMatchObject({ outcome: "fail" });
    await delivery.onToolBoundary(consumer);

    // An ordinary forced run recovers it: no retry produced this pass.
    rmSync(repo.marker);
    await h.scheduler.requestFullSuite({ force: true });
    await h.scheduler.idle();
    const recovered = formatDelta(
      (await delivery.onToolBoundary(consumer)) ?? expect.fail("no delta"),
    );
    expect(recovered).toContain("FAIL -> PASS");
    expect(recovered).toContain("Flaky: FAIL -> PASS under the same inputs");
    expect(recovered).not.toContain("Retry asked");
  });

  it("says a retry failed again in a later session's registration", async () => {
    const repo = flakyRepo();
    const load = loadKnob();
    load.set(1);
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, options(load));
    await failing(h);
    ask(store, h, "s1", "environment");
    await h.scheduler.requestRetries();
    await h.scheduler.idle();
    const later = await registered(store, h, "s2");
    expect(later.text).toMatch(
      /Recorded just now in this worktree at revision \d+, load 0\.13 per CPU when it ran; retry asked \(environment\) at these inputs: it failed again/,
    );
  });
});

describe("recordedText", () => {
  const words = { command: "squeal", path: "test/a.test.ts" };
  const facts = (loadPerCpu: number | null, retry?: RetryFact): RecordedFacts => ({
    worktreeId: "wt-a",
    worktreeRoot: null,
    revision: 12 as never,
    recordedAt: 1_000_000,
    loadPerCpu,
    ...(retry === undefined ? {} : { retry }),
  });

  it("names another worktree by its root, and a load it did not keep", () => {
    expect(
      recordedText(
        {
          worktreeId: "wt-b",
          worktreeRoot: "/repo/other" as never,
          revision: 7 as never,
          loadPerCpu: null,
          retry: { reason: "load", outcome: "unknown" },
        },
        "wt-a",
        0,
        words,
      ),
    ).toBe(
      "recorded in /repo/other at revision 7, load per CPU then not recorded; retry asked (load) at these inputs: its run gave no result",
    );
  });

  it("says how old the run is and the load it ran under (001-404)", () => {
    expect(recordedText(facts(0.5), "wt-a", 1_000_000 + 3 * 3_600_000 + 5 * 60_000, words)).toBe(
      "recorded 3 h ago in this worktree at revision 12, load 0.50 per CPU when it ran; no retry asked at these inputs",
    );
    expect(recordedText(facts(0.5), "wt-a", 1_000_000 + 20_000, words)).toMatch(
      /^recorded just now in /,
    );
  });

  // Row 011-67 (gh-52): the threshold is the one a `load` retry waits on, the CPU count.
  it("names the load retry for a run at or above one load per CPU with no retry asked", () => {
    const now = 1_000_000 + 20_000;
    const named =
      "no retry asked at these inputs; `squeal retry test/a.test.ts --reason load` runs it once more when the one-minute load average is below the CPU count";
    expect(recordedText(facts(1), "wt-a", now, words)).toBe(
      `recorded just now in this worktree at revision 12, load 1.00 per CPU when it ran; ${named}`,
    );
    expect(recordedText(facts(3.33), "wt-a", now, words)).toContain(
      `3.33 per CPU when it ran; ${named}`,
    );
    expect(recordedText(facts(0.99), "wt-a", now, words)).toMatch(
      /no retry asked at these inputs$/,
    );
    expect(recordedText(facts(null), "wt-a", now, words)).toMatch(
      /no retry asked at these inputs$/,
    );
  });

  it("names no retry command once a retry was asked, however it ended", () => {
    const now = 1_000_000;
    for (const outcome of ["pending", "passed", "failed", "unknown", "cancelled"] as const) {
      for (const reason of ["load", "environment"] as const) {
        const text = recordedText(facts(3.33, { reason, outcome }), "wt-a", now, words);
        expect(text).toContain(`; retry asked (${reason}) at these inputs`);
        expect(text).not.toContain("squeal retry");
      }
    }
  });

  it("names the CLI and the path as the surface gives them", () => {
    const codex = { command: "/opt/squeal/bin/squeal", path: "../a.test.ts" };
    expect(recordedText(facts(2), "wt-a", 1_000_000, codex)).toContain(
      "`/opt/squeal/bin/squeal retry ../a.test.ts --reason load`",
    );
  });
});

describe("agoText", () => {
  it.each([
    [0, "just now"],
    [59_999, "just now"],
    [60_000, "1 min ago"],
    [119 * 60_000, "119 min ago"],
    [120 * 60_000, "2 h ago"],
    [47 * 3_600_000, "47 h ago"],
    [48 * 3_600_000, "2 d ago"],
    [-5_000, "just now"],
  ])("%i ms reads %s", (ms, text) => {
    expect(agoText(ms)).toBe(text);
  });
});
