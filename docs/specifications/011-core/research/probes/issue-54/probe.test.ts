// Throwaway probe for ../../issue-54.md. Not product code; nothing imports it.
// Drives the product scheduler unchanged through the 001-368 retry fixture
// (a test that fails while a marker outside the worktree exists), with the
// host load injected (SchedulerOptions.hostLoad), then reads `squeal failures`
// and `squeal why` through their product functions before and after a
// passing `--reason load` retry at the same key.
import { existsSync, rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readRetries, readRunLoads } from "../../../../../../src/core/retry/index.js";
import { formatCheck, readFlakyNotes } from "../../../../../../src/core/state/index.js";
import { checkIdentity } from "../../../../../../src/core/state/derive.js";
import { formatFailures, formatWhy, readFailures, readWhy } from "../../../../../../src/core/status/index.js";
import type { AbsolutePath, Store } from "../../../../../../src/core/types/index.js";
import { openHarness, openRepoStore, SLOW } from "../../../../../../test/scheduler/helpers.js";
import { ask, failing, FLAKY, flakyRepo, flips, loadKnob, pass } from "../../../../../../test/scheduler/retry-fixture.js";

const ABOVE = 26.64; // 3.33 per CPU on the knob's 8 CPUs
const BELOW = 4;

function failingRows(store: Store) {
  return store.results.listForCheck(flips, 100).map((r) => ({
    outcome: r.outcome,
    key: r.key.slice(0, 12),
    runId: r.provenance.runId,
    revision: r.provenance.revision,
    recordedAt: r.provenance.recordedAt,
  }));
}

describe("issue 54: a passing same-key load retry replaces the failure", SLOW, () => {
  it("drops the failing run from failures and why", async () => {
    const repo = flakyRepo();
    const load = loadKnob();
    load.set(ABOVE);
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { hostLoad: load.read, rerunCap: 0 });
    const key = await failing(h);
    const cwd = repo.main as AbsolutePath;
    const check = formatCheck(flips);

    const before = store.results.listForCheck(flips, 100);
    expect(before).toHaveLength(1);
    const failRun = before[0]!.provenance.runId;
    const failLog = store.runs.get(failRun)?.logDir ?? null;
    console.log("==== BEFORE retry: result rows", JSON.stringify(failingRows(store)));
    console.log(`failing run ${failRun}, log dir ${failLog}, load per CPU kept: ${readRunLoads(store).get(failRun)}`);
    console.log("---- squeal failures (before)\n" + formatFailures(readFailures(cwd)));
    console.log("---- squeal why (before)\n" + formatWhy(readWhy(cwd, check)));

    ask(store, h, "s1", "load");
    await h.scheduler.requestRetries();
    rmSync(repo.marker); // the outside cause goes away
    load.set(BELOW);
    await pass(h);
    expect(readRetries(store)[0]?.end?.outcome).toBe("passed");
    expect(h.keyOf(FLAKY)).toBe(key); // same key

    const after = store.results.listForCheck(flips, 100);
    console.log("==== AFTER passing load retry: result rows", JSON.stringify(failingRows(store)));
    const failures = readFailures(cwd);
    console.log("---- squeal failures (after)\n" + formatFailures(failures));
    const why = readWhy(cwd, check);
    const whyText = formatWhy(why);
    console.log("---- squeal why (after)\n" + whyText);
    const note = readFlakyNotes(store).get(checkIdentity(flips));
    console.log("---- flaky note (meta flaky-checks)", JSON.stringify(note));
    console.log("---- retries (meta retries)", JSON.stringify(readRetries(store)));
    console.log(`---- failing run still in runs table: ${store.runs.get(failRun) !== null && store.runs.get(failRun) !== undefined}; log dir on disk: ${failLog !== null && existsSync(failLog)}; load kept in failed-run-loads: ${readRunLoads(store).get(failRun)}`);
    const transitions = store.transitions.history(h.worktreeId, flips);
    console.log("---- transitions", JSON.stringify(transitions));

    // The facts the issue says are lost: assert the current behaviour.
    expect(after).toHaveLength(1);
    expect(after[0]!.outcome).toBe("pass");
    expect(after[0]!.provenance.runId).not.toBe(failRun);
    expect(failures.available && failures.total).toBe(0);
    expect(whyText).toContain("the FAIL it replaced");
    expect(whyText).not.toContain(failRun);
    expect(JSON.stringify(note)).not.toContain(failRun);
    expect(JSON.stringify(transitions)).not.toContain(failRun);
  });
});
