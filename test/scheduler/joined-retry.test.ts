import { rmSync } from "node:fs";
import { describe, expect, it, onTestFinished } from "vitest";
import { readRetries } from "../../src/core/retry/index.js";
import type { Store, TestFileRef } from "../../src/core/types/index.js";
import { addWorktree, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";
import { ask, FLAKY, failing, flakyRepo, flips, loadKnob, options, pass } from "./retry-fixture.js";
import { HARNESS_DAEMON } from "./store-wait.js";

/*
 * Review 001-398, B1: a retry is one decision per test file and key. While
 * one live daemon owns the key's pending requests, a session joining it
 * belongs to that daemon's run: no other live daemon at the key queues a
 * second forced run. Each scheduler has its own connection to the store, so
 * the claim is decided across connections, in one `BEGIN IMMEDIATE`.
 */

/** `worktreeId`'s daemon heartbeating now, its row otherwise as its harness left it. */
function heartbeat(store: Store, h: Harness, commonDir: string) {
  const row = store.worktrees.get(h.worktreeId);
  store.worktrees.upsert({
    id: h.worktreeId,
    root: row?.root ?? h.root,
    commonDir: row?.commonDir ?? commonDir,
    isMain: row?.isMain ?? false,
    registeredAt: row?.registeredAt ?? Date.now(),
    daemon: {
      ...HARNESS_DAEMON,
      socketPath: `/tmp/squeal-398-${h.worktreeId}.sock`,
      heartbeatAt: Date.now(),
      heartbeatIntervalMs: 600_000,
    },
  });
}

/** Holds `h`'s next run of the flaky file until `release`; `started` settles when it begins. */
function hold(h: Harness) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let begin = () => {};
  const started = new Promise<void>((resolve) => {
    begin = resolve;
  });
  h.gate.before = async (files: readonly TestFileRef[]) => {
    if (!files.some((f) => f.path === FLAKY)) return;
    h.gate.before = null;
    begin();
    await gate;
  };
  // A failed assertion still lets the run end, so the harness can close.
  onTestFinished(() => release());
  return { started, release: () => release() };
}

async function twoDaemons() {
  const repo = flakyRepo();
  const other = addWorktree(repo.main, repo.dir, "other");
  const load = loadKnob();
  const storeA = openRepoStore(repo.commonDir);
  const storeB = openRepoStore(repo.commonDir);
  const a = await openHarness(repo.main, storeA, repo.commonDir, options(load));
  const key = await failing(a);
  const b = await openHarness(other, storeB, repo.commonDir, options(load));
  await failing(b);
  expect(b.keyOf(FLAKY)).toBe(key);
  heartbeat(storeA, a, repo.commonDir);
  heartbeat(storeB, b, repo.commonDir);
  return { repo, storeA, storeB, a, b, key };
}

describe("a session joining a claimed retry", SLOW, () => {
  it("is run by the claimant's one run while both daemons live; that result ends both requests", async () => {
    const { repo, storeA, storeB, a, b } = await twoDaemons();
    rmSync(repo.marker);
    const held = hold(a);
    expect(ask(storeA, a, "s1", "environment").kind).toBe("queued");
    await a.scheduler.requestRetries();
    await held.started;

    expect(ask(storeB, b, "s2", "environment").kind).toBe("queued");
    await b.scheduler.requestRetries();
    await b.scheduler.idle();
    await pass(b);
    expect(b.runsOf(FLAKY)).toHaveLength(1);

    held.release();
    await a.scheduler.idle();
    await pass(b);
    // One retry run between the two daemons: A's, past each one's own first run.
    expect(a.runsOf(FLAKY).length + b.runsOf(FLAKY).length).toBe(3);
    expect(a.runsOf(FLAKY)).toHaveLength(2);
    const [s1, s2] = readRetries(storeB);
    expect(s1).toMatchObject({
      session: "s1",
      end: { outcome: "passed", worktreeId: a.worktreeId },
    });
    expect(s2).toMatchObject({
      session: "s2",
      end: { outcome: "passed", worktreeId: a.worktreeId },
    });
    expect(s2?.end).toEqual(s1?.end);
    expect(storeB.knownStates.get(b.worktreeId, flips)).toMatchObject({ outcome: "pass" });
  });

  it("is taken over with the claimant's requests once the claimant's daemon is gone", async () => {
    const { repo, storeA, storeB, a, b } = await twoDaemons();
    const held = hold(a);
    ask(storeA, a, "s1", "environment");
    await a.scheduler.requestRetries();
    await held.started;
    ask(storeB, b, "s2", "environment");
    await b.scheduler.requestRetries();
    await b.scheduler.idle();
    expect(b.runsOf(FLAKY)).toHaveLength(1);

    // A's daemon dies with its run in flight: its heartbeat stops.
    const row = storeA.worktrees.get(a.worktreeId);
    storeA.worktrees.upsert({ ...(row as NonNullable<typeof row>), daemon: null });
    rmSync(repo.marker);
    await pass(b);
    expect(b.runsOf(FLAKY)).toHaveLength(2);
    expect(readRetries(storeB).map((r) => r.end?.worktreeId)).toEqual([b.worktreeId, b.worktreeId]);
    held.release();
  });
});
