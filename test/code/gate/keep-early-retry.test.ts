import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { Keeper } from "../../../src/core/code/gate/keep.js";
import { acquireDaemonLock } from "../../../src/core/daemon/lock.js";
import { worktreeIdFor } from "../../../src/core/fs/git-layout.js";
import type { Hasher } from "../../../src/core/hash/hasher.js";
import { testFileId } from "../../../src/core/keys/reverse-index.js";
import { lockFileFor } from "../../../src/core/store/paths.js";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";
import {
  A,
  freeStore,
  inputs,
  KEY_A,
  RECORD,
  removeStores,
  report,
  resultsAt,
} from "./keep-busy-kit.js";

/*
 * Review 0.1.495 B1 and B3 (repair R1 of row 020-59): an early pass that
 * cannot write, because the worktree's lock is held with no daemon to send
 * to (B1) or because reading an input fails (B3), hands its whole run back
 * to the queue, tells nothing, and tries again, checking the inputs and
 * the merge hold anew. A failure that lasts past the report gives the
 * bounded not-kept note once; `ran` and `flush` never reject.
 */

afterEach(removeStores);

/** A keeper of `at` over `hasher`, with `A` expected at `KEY_A`. */
function keeperOf(at: { root: string; commonDir: string }, notes: string[], hasher?: Hasher) {
  const moving = inputs();
  const keep = new Keeper({
    root: at.root,
    commonDir: at.commonDir,
    policy: { ...DEFAULT_POLICY, complexity: { ...DEFAULT_POLICY.complexity, enabled: true } },
    head: async () => ({ head: "a".repeat(40), dirty: false }),
    note: (text) => notes.push(text),
    busyBoundMs: 600,
  });
  keep.expect("vitest", moving.keys, hasher ?? moving.hasher, new Map([[A, KEY_A]]));
  return { keep, moving };
}

const ranA = {
  runner: "vitest" as const,
  files: [A],
  report: report([A]),
  records: new Map([[testFileId(A), { record: RECORD }]]),
};

/** The worktree's singleton lock, held as another gate's pass holds it, with no daemon record. */
function holdWorktreeLock(at: { root: string; commonDir: string }) {
  const lock = acquireDaemonLock(
    lockFileFor(at.commonDir as AbsolutePath, worktreeIdFor(at.root as AbsolutePath)),
  );
  if (lock === null) throw new Error("the worktree's lock was not free");
  return lock;
}

/** `hasher` whose `stat` rejects at the calls `fails` names (1 first). */
function failing(hasher: Hasher, fails: (n: number) => boolean): Hasher {
  let n = 0;
  return {
    ...hasher,
    stat: async (path) => {
      n += 1;
      if (fails(n)) throw new Error("EACCES: cannot stat src/a.mjs after the chunk");
      return hasher.stat(path);
    },
  };
}

describe("an early pass that cannot write keeps its run for a later try (review 0.1.495 B1)", () => {
  it("keeps the file once the worktree's lock frees before the flush, with no note", async () => {
    const at = freeStore();
    const notes: string[] = [];
    const { keep } = keeperOf(at, notes);
    const lock = holdWorktreeLock(at);
    await keep.ran(ranA);
    await sleep(150);
    expect(resultsAt(at.commonDir, KEY_A)).toBe(0);
    lock.release();

    await keep.flush();
    expect(resultsAt(at.commonDir, KEY_A)).toBe(1);
    expect(notes).toEqual([]);
  });

  it("checks the inputs again on the later try: a file that moved meanwhile is not kept", async () => {
    const at = freeStore();
    const notes: string[] = [];
    const { keep, moving } = keeperOf(at, notes);
    const lock = holdWorktreeLock(at);
    await keep.ran(ranA);
    await sleep(150);
    moving.move(A);
    lock.release();

    await keep.flush();
    expect(resultsAt(at.commonDir, KEY_A)).toBe(0);
    expect(notes).toEqual([]);
  });

  it("gives the last pass's note, once, when the lock is still held after the report", async () => {
    const at = freeStore();
    const notes: string[] = [];
    const { keep } = keeperOf(at, notes);
    const lock = holdWorktreeLock(at);
    try {
      await keep.ran(ranA);
      await sleep(150);
      await expect(keep.flush()).resolves.toBeUndefined();
    } finally {
      lock.release();
    }
    expect(resultsAt(at.commonDir, KEY_A)).toBe(0);
    expect(notes).toEqual([
      "1 completed test file was not kept in the stores: a daemon runs in this worktree, and it keeps its own",
    ]);
  });
});

describe("an input read that fails in an early pass stays in the keeper (review 0.1.495 B3)", () => {
  it("recovers on a later try, and `flush` resolves", async () => {
    const at = freeStore();
    const notes: string[] = [];
    // The chunk's keep decision reads first; the early pass's opening check, second, fails once.
    const { keep } = keeperOf(
      at,
      notes,
      failing(inputs().hasher, (n) => n === 2),
    );
    await keep.ran(ranA);
    await expect(keep.flush()).resolves.toBeUndefined();
    expect(resultsAt(at.commonDir, KEY_A)).toBe(1);
    expect(notes).toEqual([]);
  });

  it("gives the bounded not-kept note when the read still fails after the report", async () => {
    const at = freeStore();
    const notes: string[] = [];
    const { keep } = keeperOf(
      at,
      notes,
      failing(inputs().hasher, (n) => n >= 2),
    );
    await expect(keep.ran(ranA)).resolves.toBeUndefined();
    await sleep(100);
    await expect(keep.flush()).resolves.toBeUndefined();
    expect(resultsAt(at.commonDir, KEY_A)).toBe(0);
    expect(notes).toEqual([
      "1 completed test file was not kept in the stores: EACCES: cannot stat src/a.mjs after the chunk",
    ]);
  });
});
