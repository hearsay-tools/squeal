import { describe, expect, it } from "vitest";
import {
  isEditorScratch,
  onlyEditorScratch,
  scratchMovedListings,
} from "../../src/core/scheduler/editor-scratch.js";
import type { FileChange, Revision, Store } from "../../src/core/types/index.js";

/*
 * Row 011-117 (spec 011 C4 step 5 as amended 2026-10-22): the names of the
 * files vim and emacs write beside the file they open, and the listings
 * their adds and deletes during a run leave moved at its end.
 */

const add = (path: string): FileChange => ({ path, oldHash: null, newHash: "a" });
const remove = (path: string): FileChange => ({ path, oldHash: "a", newHash: null });
const write = (path: string): FileChange => ({ path, oldHash: "a", newHash: "b" });

/** A store whose revisions after `after` are `changes`, one revision each; it counts its reads. */
function revisions(...changes: FileChange[][]) {
  const read = { count: 0 };
  const store = {
    revisions: {
      range: (worktreeId: string, after: number) => {
        read.count += 1;
        return changes.map(
          (c, i): Revision => ({
            worktreeId,
            number: after + i + 1,
            createdAt: 0,
            head: null,
            dirty: true,
            trigger: "watch",
            changes: c,
          }),
        );
      },
    },
  } as unknown as Store;
  return { store, read };
}

const LISTINGS = new Set(["lib/", "./"]);

describe("editor scratch names (row 011-117)", () => {
  it.each([
    ".a.ts.swp",
    "lib/.a.ts.swp",
    "lib/.a.ts.swo",
    "lib/.a.ts.swa",
    "lib/..bashrc.swp",
    "4913",
    "lib/4913",
    ".#a.ts",
    "lib/.#a.ts",
  ])("%s is a scratch file", (path) => {
    expect(isEditorScratch(path)).toBe(true);
  });

  it.each([
    "lib/a.ts",
    "lib/a.swp",
    "lib/.a.ts.swq",
    "lib/.swp",
    "lib/49130",
    "lib/4913.txt",
    "lib/#a.ts#",
    "lib/.#",
    "lib/.a.swp/b.ts",
  ])("%s is not", (path) => {
    expect(isEditorScratch(path)).toBe(false);
  });

  it("a revision is scratch only when every change is a scratch file's", () => {
    expect(onlyEditorScratch([add("lib/.a.ts.swp"), write("lib/.#b.ts")])).toBe(true);
    expect(onlyEditorScratch([remove("lib/.a.ts.swp"), write("lib/a.ts")])).toBe(false);
    expect(onlyEditorScratch([])).toBe(false);
  });
});

describe("the listings scratch files moved during a run (row 011-117)", () => {
  const ids = (store: Store, changed: string[]) =>
    scratchMovedListings(store, "w", 5, new Set(changed), LISTINGS).sort();

  it("a scratch file created and removed during the run moves none", () => {
    const swap = "lib/.a.ts.swp";
    const { store } = revisions([add(swap)], [write(swap)], [remove(swap)]);
    expect(ids(store, [swap])).toEqual([]);
  });

  it("one still there at the end, or one gone that was there, moves the listings that hold it", () => {
    expect(ids(revisions([add("lib/.a.ts.swp")]).store, ["lib/.a.ts.swp"])).toEqual(["./", "lib/"]);
    const gone = revisions([write("lib/.#a.ts")], [remove("lib/.#a.ts")]).store;
    expect(ids(gone, ["lib/.#a.ts"])).toEqual(["./", "lib/"]);
  });

  it("one removed and created again moves none; only the listings asked for are named", () => {
    const back = revisions([remove("lib/4913")], [add("lib/4913")]).store;
    expect(ids(back, ["lib/4913"])).toEqual([]);
    const deep = revisions([add("lib/sub/.a.ts.swp")]).store;
    expect(ids(deep, ["lib/sub/.a.ts.swp"])).toEqual(["./", "lib/"]);
  });

  it("a real add beside it is not judged here: Tier.changes holds its listings", () => {
    const swap = "lib/.a.ts.swp";
    const { store } = revisions([add("lib/b.ts"), add(swap)], [remove(swap)]);
    expect(ids(store, ["lib/b.ts", swap, "lib/"])).toEqual([]);
  });

  it("reads no revision when no scratch file changed during the run or the tier lists nothing", () => {
    const { store, read } = revisions([add("lib/b.ts")]);
    expect(ids(store, ["lib/b.ts", "lib/"])).toEqual([]);
    expect(scratchMovedListings(store, "w", 5, new Set(["lib/.a.ts.swp"]), new Set())).toEqual([]);
    expect(read.count).toBe(0);
  });
});
