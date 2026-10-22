import { describe, expect, it } from "vitest";
import { unmergedPaths } from "../../src/core/daemon-loop/head.js";
import {
  commandHoldMetaKey,
  MERGE_HOLD_PATHS,
  mergeHoldMetaKey,
  readCommandHolds,
  readMergeHold,
  unmergedIndexPaths,
} from "../../src/core/scheduler/hold.js";
import { fakeCommonDir, open } from "../store/helpers.js";

/*
 * Row 011-72 (011 C2 and C9 as amended 2026-10-21): the unmerged paths of
 * `git status --porcelain=v1 -z` and `git ls-files -u -z`, and the readers of
 * the two hold rows R2 and R3 build on.
 */

describe("the merge hold's parsers and rows (row 011-72)", () => {
  it("takes each of git-status(1)'s seven unmerged codes, and skips a rename's source", () => {
    const codes = ["DD", "AU", "UD", "UA", "DU", "AA", "UU"];
    const entries = [
      ...codes.map((code, i) => `${code} u${i}.ts`),
      "R  to.ts",
      "UU from-like.ts",
      " M dirty.ts",
      "?? new.ts",
      "A  added.ts",
    ];
    expect(unmergedPaths(entries)).toEqual(codes.map((_, i) => `u${i}.ts`));
    expect(unmergedPaths([" M a.ts", "?? b.ts"])).toEqual([]);
  });

  it("lists each path of `ls-files -u` once, in git's order, spaces and tabs in names kept", () => {
    const blob = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";
    const out = [
      `100644 ${blob} 1\tsrc/a b.ts`,
      `100644 ${blob} 2\tsrc/a b.ts`,
      `100644 ${blob} 3\tsrc/a b.ts`,
      `100644 ${blob} 2\tsrc/z\tq.ts`,
    ].join("\0");
    expect(unmergedIndexPaths(`${out}\0`)).toEqual(["src/a b.ts", "src/z\tq.ts"]);
    expect(unmergedIndexPaths("")).toEqual([]);
  });

  it("reads the live daemon's merge hold, and no row a predecessor wrote or that does not parse", () => {
    const store = open(fakeCommonDir());
    const row = { v: 1, since: 2_000, revision: 7, paths: ["src/helper.ts"], count: 1 };
    expect(readMergeHold(store, "w", 0)).toBeNull();
    store.meta.set(mergeHoldMetaKey("w"), JSON.stringify(row));
    expect(readMergeHold(store, "w", 1_000)).toEqual(row);
    expect(readMergeHold(store, "w", 3_000)).toBeNull();
    for (const bad of [
      "{",
      JSON.stringify({ ...row, v: 2 }),
      JSON.stringify({ ...row, paths: 1 }),
    ]) {
      store.meta.set(mergeHoldMetaKey("w"), bad);
      expect(readMergeHold(store, "w", 0)).toBeNull();
    }
    expect(MERGE_HOLD_PATHS).toBe(50);
  });

  it("reads the command holds as written, and drops an entry that does not parse", () => {
    const store = open(fakeCommonDir());
    const process = { pid: 12, startTime: 34, pidNamespace: "pid:[1]" };
    const entry = {
      token: "t",
      since: 1,
      until: 2,
      command: "npm run gate",
      wrapper: process,
      child: null,
    };
    expect(readCommandHolds(store, "w")).toEqual([]);
    store.meta.set(
      commandHoldMetaKey("w"),
      JSON.stringify({ v: 1, entries: [entry, { ...entry, wrapper: { pid: "x" } }] }),
    );
    expect(readCommandHolds(store, "w")).toEqual([entry]);
  });
});
