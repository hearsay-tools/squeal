import { afterEach, describe, expect, it } from "vitest";
import { Keeper } from "../../../src/core/code/gate/keep.js";
import { testFileId } from "../../../src/core/keys/reverse-index.js";
import type { CheckKey, TestFileRef } from "../../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";
import {
  A,
  B,
  inputs,
  KEY_A,
  KEY_B,
  lockedStore,
  RECORD,
  removeStores,
  report,
  resultsAt,
} from "./keep-busy-kit.js";

/*
 * Spec 020 D17.5 (row 020-28, #192): a store whose write lock another
 * connection holds is retried in busy slices until a bound from the first
 * busy write; the wait names the holder, and a file still not written then
 * is told as not kept. Review 0.1.444 B2: from the first busy write on,
 * each file's inputs are read again after every pause and before each of
 * its writes, and a file whose bytes moved is not kept and counted apart.
 * Row 020-30: the holder is this process, and each case waits until
 * `lockHolders` sees its lock before the gate starts; the case that frees
 * the lock frees it only after the gate named the holder.
 */

afterEach(removeStores);

/** `files` run and flushed; `onBusy` runs at the busy note. */
async function kept(
  at: { root: string; commonDir: string },
  notes: string[],
  options: {
    readonly busyBoundMs: number;
    readonly files?: readonly (readonly [TestFileRef, CheckKey])[];
    readonly onBusy?: (moved: ReturnType<typeof inputs>) => void;
  },
): Promise<void> {
  const { busyBoundMs, files = [[A, KEY_A]], onBusy = () => {} } = options;
  const moving = inputs();
  const keep = new Keeper({
    root: at.root,
    commonDir: at.commonDir,
    policy: { ...DEFAULT_POLICY, complexity: { ...DEFAULT_POLICY.complexity, enabled: true } },
    head: async () => ({ head: "a".repeat(40), dirty: false }),
    note: (text) => {
      notes.push(text);
      if (text.startsWith("the store is busy")) onBusy(moving);
    },
    busyBoundMs,
  });
  keep.expect("vitest", moving.keys, moving.hasher, new Map(files));
  const refs = files.map(([ref]) => ref);
  await keep.ran({
    runner: "vitest",
    files: refs,
    report: report(refs),
    records: new Map(refs.map((ref) => [testFileId(ref), { record: RECORD }])),
  });
  await keep.flush();
}

const BOTH = [
  [A, KEY_A],
  [B, KEY_B],
] as const;

describe("Keeper on a store another connection holds (spec 020 D17.3, D17.5)", () => {
  it("keeps the file once the lock is freed within the bound, and names the holder first", async () => {
    const locked = await lockedStore();
    const notes: string[] = [];
    // Row 020-30: freed after the busy note, which named the holder; a timer
    // started before the gate could free it before the gate read who held it.
    let freed: NodeJS.Timeout | undefined;
    try {
      await kept(locked, notes, {
        busyBoundMs: 5_000,
        onBusy: () => {
          freed = setTimeout(locked.release, 400);
        },
      });
    } finally {
      clearTimeout(freed);
      locked.release();
    }
    expect(notes).toHaveLength(2);
    expect(notes[0]).toBe(
      `the store is busy (${locked.holder}); waiting up to 5 s to keep 1 completed test file: test/a.test.ts`,
    );
    expect(notes[1]).toMatch(/^the store was free after \d+(\.\d)? s: 1 completed test file kept$/);
    expect(resultsAt(locked.commonDir)).toBe(1);
  });

  it("keeps nothing while the lock outlasts the bound, and says who held it and what runs again", async () => {
    const locked = await lockedStore();
    const notes: string[] = [];
    try {
      await kept(locked, notes, { busyBoundMs: 600 });
    } finally {
      locked.release();
    }
    expect(notes).toEqual([
      `the store is busy (${locked.holder}); waiting up to 0.6 s to keep 1 completed test file: test/a.test.ts`,
      `1 completed test file was not kept in the stores: the store stayed busy for 0.6 s (${locked.holder}); the next run will run it again`,
    ]);
    expect(resultsAt(locked.commonDir)).toBe(0);
  });

  it("does not keep a file whose input moved during the wait, and counts it apart (review 0.1.444 B2)", async () => {
    const locked = await lockedStore();
    const notes: string[] = [];
    try {
      await kept(locked, notes, {
        busyBoundMs: 5_000,
        files: BOTH,
        onBusy: ({ move }) => {
          move(A);
          locked.release();
        },
      });
    } finally {
      locked.release();
    }
    expect(notes).toHaveLength(2);
    expect(notes[1]).toMatch(
      /^the store was free after \d+(\.\d)? s: 1 completed test file kept; 1 changed during the wait, so the next run will run it again$/,
    );
    expect([resultsAt(locked.commonDir, KEY_A), resultsAt(locked.commonDir, KEY_B)]).toEqual([
      0, 1,
    ]);
  });

  it("counts a moved file with the files to run again once the bound runs out", async () => {
    const locked = await lockedStore();
    const notes: string[] = [];
    try {
      await kept(locked, notes, { busyBoundMs: 600, files: BOTH, onBusy: ({ move }) => move(A) });
    } finally {
      locked.release();
    }
    expect(notes).toEqual([
      `the store is busy (${locked.holder}); waiting up to 0.6 s to keep 2 completed test files: test/a.test.ts, test/b.test.ts`,
      `2 completed test files were not kept in the stores: the store stayed busy for 0.6 s (${locked.holder}), and 1 of them changed during the wait; the next run will run them again`,
    ]);
    expect([resultsAt(locked.commonDir, KEY_A), resultsAt(locked.commonDir, KEY_B)]).toEqual([
      0, 0,
    ]);
  });

  it("says a moved file was not kept when no write landed after the wait", async () => {
    const locked = await lockedStore();
    const notes: string[] = [];
    try {
      await kept(locked, notes, { busyBoundMs: 5_000, onBusy: ({ move }) => move(A) });
    } finally {
      locked.release();
    }
    expect(notes.slice(1)).toEqual([
      "1 completed test file was not kept in the stores: it changed during the wait; the next run will run it again",
    ]);
    expect(resultsAt(locked.commonDir)).toBe(0);
  });
});
