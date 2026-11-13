import { utimesSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { isStoreOpenFailure, openStore } from "../../../src/core/store/open.js";
import { storePaths } from "../../../src/core/store/paths.js";
import { writeTree } from "../../keys/validity/harness/shared.js";
import { A, keep, keyOf, READ, resultsAt, rowsOf, worktree } from "./keep-grown-kit.js";

/*
 * Row 020-39 (spec 020 D17.3, D17.5): the keeper with a lookup's real keys
 * over a scratch store, as `gate/stored.ts` opens them, and the
 * repository's store. Where no daemon serves, a file whose run read a
 * path beyond its key is kept at the key with it, and its read and its
 * marks join the shared rows; a busy store, or a read that moved before
 * the write, keeps nothing at that key. Where a daemon serves:
 * `keep-grown-daemon.test.ts` (row 020-48).
 */

describe("squeal code keeps a file whose run read beyond its key (row 020-39)", () => {
  it("at the key with the read, which joins the shared rows with its marks", async () => {
    const at = await worktree();
    const notes: string[] = [];

    const ran = await keep(at, notes);

    const grown = keyOf(at.keys, A);
    expect(grown).not.toBe(ran);
    expect([resultsAt(at.commonDir, grown), resultsAt(at.commonDir, ran)]).toEqual([1, 0]);
    expect(rowsOf(at.commonDir)).toEqual([[READ], [READ], ["src/a.ts"]]);
    expect(notes).toEqual([]);
  });

  it("keeps nothing, and merges nothing, while the store stays busy past the bound", async () => {
    const at = await worktree();
    const notes: string[] = [];
    const store = openStore(at.commonDir);
    if (isStoreOpenFailure(store)) throw new Error(store.reason);
    store.close();
    const holder = new DatabaseSync(storePaths(at.commonDir).database);
    holder.exec("BEGIN IMMEDIATE");
    try {
      await keep(at, notes, { busyBoundMs: 600 });
    } finally {
      holder.exec("ROLLBACK");
      holder.close();
    }

    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatch(
      /^the store is busy \(.+\); waiting up to 0\.6 s to keep 1 completed test file: test\/a\.test\.ts$/,
    );
    expect(notes[1]).toMatch(
      /^1 completed test file was not kept in the stores: the store stayed busy for 0\.6 s \(.+\); the next run will run it again$/,
    );
    expect(resultsAt(at.commonDir, keyOf(at.keys, A))).toBe(0);
    expect(rowsOf(at.commonDir)).toEqual([undefined, undefined, undefined]);
  });

  it("keeps nothing at that key once its read moved before the write, and merges the read", async () => {
    const at = await worktree();
    const notes: string[] = [];

    await keep(at, notes, {
      between: () => {
        writeTree(at.root, { [READ]: "other\n" });
        const later = new Date(Date.now() + 60_000);
        utimesSync(join(at.root, READ), later, later);
      },
    });

    expect(resultsAt(at.commonDir, keyOf(at.keys, A))).toBe(0);
    expect(rowsOf(at.commonDir)[0]).toEqual([READ]);
    expect(notes).toEqual([]);
  });
});
