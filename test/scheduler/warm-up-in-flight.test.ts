import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readIgnoredReads } from "../../src/core/status/index.js";
import type { CheckpointRecord, RunOptions, TestFileRef } from "../../src/core/types/index.js";
import { type Harness, SLOW } from "./helpers.js";
import { BUILD, QUIET, READS, snapshot, VITEST, warmUpRepo } from "./warm-up-repo.js";

/*
 * Review wave 13ar, B1 (task 001-312): a warm-up never counts a run that did
 * not observe. Every runnable file, the slow ones too, runs flagged before
 * its checkpoint completes, whatever tier was in flight when it was asked:
 * the baseline after a fresh start, an ordinary forced checkpoint, a Vitest
 * tier, or a slow file made stale just before (005-29 on the real daemon).
 * Ordinary checkpoints still take the results that stand.
 */

interface Call {
  readonly files: readonly string[];
  readonly observeIgnored: boolean;
}

/** Records every run the scheduler starts; holds the first that runs `path` until `release`. */
function holdFirst(h: Harness, path: string) {
  const calls: Call[] = [];
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let arrived: (options: RunOptions) => void = () => {};
  const held = new Promise<RunOptions>((resolve) => {
    arrived = resolve;
  });
  let taken = false;
  h.gate.before = async (files: readonly TestFileRef[], options: RunOptions) => {
    calls.push({
      files: files.map((f) => `${f.project}:${f.path}`),
      observeIgnored: options.observeIgnored === true,
    });
    if (taken || !files.some((f) => f.path === path)) return;
    taken = true;
    arrived(options);
    await released;
  };
  return { calls, held, release };
}

const EMPTY = { paths: [], more: 0 };

/**
 * The warm-up `record` completed, with every file's reads in its own record.
 * The Vitest file's closure holds the ignored path it read (spec 016 D4, the
 * written-directory bound), so its entry is empty.
 */
function expectObserved(h: Harness, record: CheckpointRecord): void {
  expect(h.store.checkpoints.get(record.id)?.end).toBe("completed");
  const stored = readIgnoredReads(h.store, h.worktreeId);
  expect(stored?.checkpoint).toBe(record.id);
  expect(stored?.files).toMatchObject({
    [`nt\0${READS}`]: { paths: [BUILD], more: 0 },
    [`forks\0${VITEST}`]: EMPTY,
    [`threads\0${VITEST}`]: EMPTY,
    [`nt\0${QUIET}`]: EMPTY,
    "forks\0test/plain.test.ts": EMPTY,
    "threads\0test/plain.test.ts": EMPTY,
  });
}

/** Keys and closures as an ordinary forced checkpoint leaves them; an ordinary request runs nothing. */
async function expectKeysAndReuse(h: Harness, calls: readonly Call[]): Promise<void> {
  const observed = snapshot(h);
  await h.scheduler.requestFullSuite({ force: true });
  await h.scheduler.idle();
  expect(snapshot(h)).toEqual(observed);
  const runs = calls.length;
  const ordinary = await h.scheduler.requestFullSuite();
  await h.scheduler.idle();
  expect(h.store.checkpoints.get(ordinary.id)?.end).toBe("completed");
  expect(calls).toHaveLength(runs);
}

describe("a warm-up asked while unobserved work is in flight (review wave 13ar, B1)", SLOW, () => {
  it("runs the baseline's held node:test tier again, observed, after a fresh start", async () => {
    const { h } = await warmUpRepo({ started: false });
    const hold = holdFirst(h, READS);
    await h.scheduler.start();
    expect((await hold.held).observeIgnored).toBeUndefined();
    const record = await h.scheduler.requestFullSuite({ observeIgnored: true });
    hold.release();
    await h.scheduler.idle();
    expectObserved(h, record);
    // The held run is not the one that counted: a flagged run of the file followed it.
    const ofReads = hold.calls.filter((c) => c.files.includes(`nt:${READS}`));
    expect(ofReads.map((c) => c.observeIgnored)).toEqual([false, true]);
    await expectKeysAndReuse(h, hold.calls);
  });

  it("does not join an ordinary forced checkpoint in flight", async () => {
    const { h } = await warmUpRepo();
    const hold = holdFirst(h, READS);
    await h.scheduler.requestFullSuite({ force: true });
    expect((await hold.held).observeIgnored).toBeUndefined();
    const record = await h.scheduler.requestFullSuite({ force: true, observeIgnored: true });
    // It never joins (001-312), so it owns its work (review wave-3, B4).
    expect(record.owner).toBe(record.id);
    hold.release();
    await h.scheduler.idle();
    expectObserved(h, record);
    await expectKeysAndReuse(h, hold.calls);
  });

  it("runs a held Vitest tier's slow file again, observed", async () => {
    const { h } = await warmUpRepo({ started: false });
    const hold = holdFirst(h, VITEST);
    await h.scheduler.start();
    expect((await hold.held).observeIgnored).toBeUndefined();
    const record = await h.scheduler.requestFullSuite({ observeIgnored: true });
    hold.release();
    await h.scheduler.idle();
    expectObserved(h, record);
  });

  it("observes a slow Vitest file made stale just before a non-forced warm-up (005-29)", async () => {
    const { h } = await warmUpRepo();
    appendFileSync(join(h.root, VITEST), "// edited\n");
    await h.batch(VITEST);
    const record = await h.scheduler.requestFullSuite({ observeIgnored: true });
    await h.scheduler.idle();
    expectObserved(h, record);
  });
});
