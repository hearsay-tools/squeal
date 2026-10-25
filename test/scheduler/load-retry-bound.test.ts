import { rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readDaemonNotes } from "../../src/core/notes.js";
import { LOAD_RETRY_WAIT_MS, readRetries } from "../../src/core/retry/index.js";
import { openHarness, openRepoStore, SLOW } from "./helpers.js";
import { ask, FLAKY, failing, flakyRepo, flips, loadKnob, options, pass } from "./retry-fixture.js";

/*
 * Spec 011 C5 as amended (row 011-213, gh-92): a `load` retry waits for the
 * load gate at most `LOAD_RETRY_WAIT_MS`, counted from the first look at
 * which a daemon at its key met the gate closed, then runs once with a load
 * note. The FAIL stays counted until a retry's run passes. The fixture's
 * load is 16 on 8 CPUs, 2.00 per CPU, until a test sets it.
 */

const NOTE =
  "load retry of test/flaky.test.ts queued under load 2.00 per CPU, at or above one per CPU, " +
  "once it had waited 10 min for the one-minute load average to fall below the CPU count (spec 011 C5)";

const notesOf = (h: Awaited<ReturnType<typeof openHarness>>) =>
  readDaemonNotes(h.store, h.worktreeId).map((note) => note.text);

describe("a load retry's bounded wait", SLOW, () => {
  it("waits under the bound, then runs once with the load note while the load stays high", async () => {
    const repo = flakyRepo();
    const load = loadKnob();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, options(load));
    await failing(h);
    rmSync(repo.marker);

    ask(store, h, "s1", "load");
    const before = h.now();
    await h.scheduler.requestRetries();
    const since = readRetries(store)[0]?.gateClosedAt as number;
    expect(since).toBeGreaterThanOrEqual(before);
    expect(since).toBeLessThanOrEqual(h.now());
    h.advance(LOAD_RETRY_WAIT_MS - 1_000);
    await pass(h);
    expect(h.runsOf(FLAKY)).toHaveLength(1);
    expect(h.sink.stateOf(flips)).toMatchObject({ outcome: "fail", validity: "current" });
    expect(readRetries(store)[0]).toMatchObject({ gateClosedAt: since, claim: null, end: null });
    expect(notesOf(h)).not.toContain(NOTE);

    h.advance(1_000);
    await pass(h);
    expect(h.runsOf(FLAKY)).toHaveLength(2);
    expect(h.sink.stateOf(flips)).toMatchObject({ outcome: "pass", validity: "current" });
    expect(readRetries(store)[0]?.end?.outcome).toBe("passed");
    expect(notesOf(h).filter((text) => text === NOTE)).toHaveLength(1);
  });

  it("counts the wait from the first look that met the gate closed, not from the request", async () => {
    const repo = flakyRepo();
    const load = loadKnob();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, options(load));
    await failing(h);
    rmSync(repo.marker);

    ask(store, h, "s1", "load");
    h.advance(LOAD_RETRY_WAIT_MS);
    const before = h.now();
    await h.scheduler.requestRetries();
    await h.scheduler.idle();
    expect(h.runsOf(FLAKY)).toHaveLength(1);
    expect(readRetries(store)[0]?.gateClosedAt).toBeGreaterThanOrEqual(before);
  });

  it("ends a retry whose bounded run fails again `failed`, and the FAIL stays counted", async () => {
    const repo = flakyRepo();
    const load = loadKnob();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, options(load));
    await failing(h);

    ask(store, h, "s1", "load");
    await h.scheduler.requestRetries();
    h.advance(LOAD_RETRY_WAIT_MS);
    await pass(h);
    expect(h.runsOf(FLAKY)).toHaveLength(2);
    expect(h.sink.stateOf(flips)).toMatchObject({ outcome: "fail", validity: "current" });
    expect(readRetries(store)[0]?.end?.outcome).toBe("failed");
    expect(store.knownStates.get(h.worktreeId, flips)).toMatchObject({ outcome: "fail" });
    await pass(h);
    expect(h.runsOf(FLAKY)).toHaveLength(2);
  });

  it("runs at once with no load note when the gate opens before the bound", async () => {
    const repo = flakyRepo();
    const load = loadKnob();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, options(load));
    await failing(h);
    rmSync(repo.marker);

    ask(store, h, "s1", "load");
    await h.scheduler.requestRetries();
    h.advance(60_000);
    load.set(7.5);
    await pass(h);
    expect(h.runsOf(FLAKY)).toHaveLength(2);
    expect(readRetries(store)[0]?.end?.outcome).toBe("passed");
    expect(notesOf(h).some((text) => text.startsWith("load retry of"))).toBe(false);
  });
});
