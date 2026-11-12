import { describe, expect, it } from "vitest";
import { isStoreOpenFailure, openStore } from "../../../src/core/store/open.js";
import {
  A,
  BOTH,
  countGateWrites,
  KEY_A,
  KEY_B,
  kept,
  RECORD,
  recordAt,
  resultsAt,
  served,
} from "./keep-daemon-kit.js";

/*
 * Spec 021 D15 (row 021-20, part two): while a daemon holds the worktree's
 * lock and serves it, the code gate's keeper sends each try of each write
 * to it, and the daemon writes in its retried path, so the gate makes no
 * write transaction of its own. Spec 020 D17.5 (row 020-28) holds as with
 * no daemon: the files are written by `flush` once the report is out, the
 * wait names the lock's holder first, the bound counts from the first
 * refused write, and a file whose inputs moved during the wait is not
 * kept. A daemon without this request keeps nothing of the gate's, as
 * before.
 */

describe("the keeper while a daemon serves the worktree (021 D15, row 021-20)", () => {
  it("keeps each file through the daemon, with no write transaction of the gate's own", async () => {
    const at = await served();
    const notes: string[] = [];
    const count = countGateWrites();
    await kept(at, notes, { files: BOTH });
    expect(count.stop()).toBe(0);
    expect(notes).toEqual([]);
    expect([resultsAt(at.commonDir, KEY_A), resultsAt(at.commonDir, KEY_B)]).toEqual([1, 1]);
    expect(recordAt(at.commonDir)).toEqual(RECORD);
    expect(at.keeps.map((k) => k.write.kind)).toEqual([
      "coverage",
      "results",
      "coverage",
      "results",
    ]);
  });

  it("keeps the file once the lock is freed within the bound, and names the holder first", async () => {
    const at = await served();
    const notes: string[] = [];
    const locked = at.hold();
    const freed = setTimeout(locked.release, 400);
    const count = countGateWrites();
    try {
      await kept(at, notes);
    } finally {
      clearTimeout(freed);
      locked.release();
    }
    expect(count.stop()).toBe(0);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toBe(
      `the store is busy (${locked.holder}); waiting up to 5 s to keep 1 completed test file: test/a.test.ts`,
    );
    expect(notes[1]).toMatch(/^the store was free after \d+(\.\d)? s: 1 completed test file kept$/);
    expect(resultsAt(at.commonDir)).toBe(1);
    expect(at.keeps.filter((k) => k.write.kind === "results").length).toBeGreaterThan(1);
  });

  it("keeps nothing while the lock outlasts the bound, and says who held it", async () => {
    const at = await served();
    const notes: string[] = [];
    const locked = at.hold();
    try {
      await kept(at, notes, { busyBoundMs: 600 });
    } finally {
      locked.release();
    }
    expect(notes).toEqual([
      `the store is busy (${locked.holder}); waiting up to 0.6 s to keep 1 completed test file: test/a.test.ts`,
      `1 completed test file was not kept in the stores: the store stayed busy for 0.6 s (${locked.holder}); the next run will run it again`,
    ]);
    expect(resultsAt(at.commonDir)).toBe(0);
  });

  it("does not keep a file whose input moved during the wait (review 0.1.444 B2)", async () => {
    const at = await served();
    const notes: string[] = [];
    const locked = at.hold();
    try {
      await kept(at, notes, {
        files: BOTH,
        onBusy: ({ move }) => {
          move(A);
          locked.release();
        },
      });
    } finally {
      locked.release();
    }
    expect(notes[1]).toMatch(
      /^the store was free after \d+(\.\d)? s: 1 completed test file kept; 1 changed during the wait, so the next run will run it again$/,
    );
    expect([resultsAt(at.commonDir, KEY_A), resultsAt(at.commonDir, KEY_B)]).toEqual([0, 1]);
  });

  it("keeps nothing, with the note before this row, when the daemon's heartbeat is late", async () => {
    const at = await served();
    const store = openStore(at.commonDir);
    if (isStoreOpenFailure(store)) throw new Error(store.reason);
    const { worktreeId } = at;
    const record = store.worktrees.get(worktreeId)?.daemon;
    if (record == null) throw new Error("no daemon record");
    store.worktrees.setDaemon(worktreeId, {
      ...record,
      heartbeatAt: 1,
      heartbeatIntervalMs: 5_000,
    });
    store.close();
    const notes: string[] = [];
    await kept(at, notes);
    expect(notes).toEqual([
      "1 completed test file was not kept in the stores: a daemon runs in this worktree, and it keeps its own",
    ]);
    expect(at.keeps).toEqual([]);
    expect(resultsAt(at.commonDir)).toBe(0);
  });

  it("keeps nothing, with the note before this row, when the daemon takes no kept files", async () => {
    const at = await served({ takesKeeps: false });
    const notes: string[] = [];
    await kept(at, notes);
    expect(notes).toEqual([
      "1 completed test file was not kept in the stores: a daemon runs in this worktree, and it keeps its own",
    ]);
    expect(resultsAt(at.commonDir)).toBe(0);
  });
});
