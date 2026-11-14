import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { Keeper } from "../../../src/core/code/gate/keep.js";
import { testFileId } from "../../../src/core/keys/reverse-index.js";
import type { CheckKey, TestFileRef } from "../../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";
import {
  A,
  B,
  freeStore,
  holdStore,
  inputs,
  KEY_A,
  KEY_B,
  RECORD,
  removeStores,
  report,
  resultsAt,
} from "./keep-busy-kit.js";

/*
 * Spec 020 D17.5 as amended by row 020-59 (#201, #202, #216): the keeper
 * writes each run's files while the gate's other runs go on, so what a
 * run completed is in the store before the report, and a gate killed then
 * keeps it. A busy store hands the files back to a later pass and tells
 * nothing; only what is still queued once the report is out waits the
 * bound, and the wait counts the files kept before it.
 */

afterEach(removeStores);

/** How long a case waits for an early pass to land a write. */
const LANDS_MS = 5_000;

function keeperAt(at: { root: string; commonDir: string }, notes: string[], busyBoundMs = 600) {
  return new Keeper({
    root: at.root,
    commonDir: at.commonDir,
    policy: { ...DEFAULT_POLICY, complexity: { ...DEFAULT_POLICY.complexity, enabled: true } },
    head: async () => ({ head: "a".repeat(40), dirty: false }),
    note: (text) => notes.push(text),
    busyBoundMs,
  });
}

/** One run of `ref`, which completed with a record. */
const ranOf = (ref: TestFileRef) => ({
  runner: "vitest" as const,
  files: [ref],
  report: report([ref]),
  records: new Map([[testFileId(ref), { record: RECORD }]]),
});

/** Resolves once `key`'s results are in the store, or throws after `LANDS_MS`. */
async function landed(commonDir: string, key: CheckKey): Promise<void> {
  const until = Date.now() + LANDS_MS;
  while (resultsAt(commonDir, key) === 0) {
    if (Date.now() >= until) throw new Error(`no results at ${key.slice(0, 8)}`);
    await sleep(10);
  }
}

describe("the keeper writes while the runs go on (row 020-59)", () => {
  it("writes a run's file before `flush`, so a gate killed after it keeps it", async () => {
    const at = freeStore();
    const notes: string[] = [];
    const moving = inputs();
    const keep = keeperAt(at, notes);
    keep.expect("vitest", moving.keys, moving.hasher, new Map([[A, KEY_A]]));

    await keep.ran(ranOf(A));
    await landed(at.commonDir, KEY_A);
    // No `flush`, as when the gate is killed: the file stays kept.
    keep.close();

    expect(resultsAt(at.commonDir, KEY_A)).toBe(1);
    expect(notes).toEqual([]);
  });

  it("keeps the files written before a hold, and only the tail waits the bound", async () => {
    const at = freeStore();
    const notes: string[] = [];
    const moving = inputs();
    const keep = keeperAt(at, notes);
    keep.expect("vitest", moving.keys, moving.hasher, new Map([[A, KEY_A]]));
    keep.expect("vitest", moving.keys, moving.hasher, new Map([[B, KEY_B]]));

    await keep.ran(ranOf(A));
    await landed(at.commonDir, KEY_A);
    const held = await holdStore(at.commonDir);
    try {
      await keep.ran(ranOf(B));
      // Passes on the held store while the runs go on tell nothing.
      await sleep(300);
      expect(notes).toEqual([]);
      const started = Date.now();
      await keep.flush();
      expect(Date.now() - started).toBeLessThan(600 + 2_000);
    } finally {
      held.release();
    }

    expect(notes).toEqual([
      `the store is busy (${held.holder}); waiting up to 0.6 s to keep 1 completed test file (1 kept while the runs went on): test/b.test.ts`,
      `1 completed test file was not kept in the stores: the store stayed busy for 0.6 s (${held.holder}); the next run will run it again`,
    ]);
    expect([resultsAt(at.commonDir, KEY_A), resultsAt(at.commonDir, KEY_B)]).toEqual([1, 0]);
  });

  it("writes a file a busy store refused once it is free, still before `flush`", async () => {
    const at = freeStore();
    const notes: string[] = [];
    const moving = inputs();
    const keep = keeperAt(at, notes);
    keep.expect("vitest", moving.keys, moving.hasher, new Map([[A, KEY_A]]));
    const held = await holdStore(at.commonDir);
    try {
      await keep.ran(ranOf(A));
      await sleep(100);
      expect(resultsAt(at.commonDir, KEY_A)).toBe(0);
    } finally {
      held.release();
    }

    await landed(at.commonDir, KEY_A);
    await keep.flush();
    expect(notes).toEqual([]);
  });

  it("does not write a file whose input moved after a busy store refused it", async () => {
    const at = freeStore();
    const notes: string[] = [];
    const moving = inputs();
    const keep = keeperAt(at, notes);
    keep.expect("vitest", moving.keys, moving.hasher, new Map([[A, KEY_A]]));
    const held = await holdStore(at.commonDir);
    try {
      await keep.ran(ranOf(A));
      await sleep(100);
      moving.move(A);
    } finally {
      held.release();
    }

    await keep.flush();
    expect(resultsAt(at.commonDir, KEY_A)).toBe(0);
    // Dropped as the opening check drops a file that moved after its run: no daemon lost a try.
    expect(notes).toEqual([]);
  });
});
