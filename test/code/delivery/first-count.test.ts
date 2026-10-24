import { describe, expect, it } from "vitest";
import { readRecount } from "../../../src/core/code/pass/index.js";
import { fakeCounter, pass, worktree } from "../pass/helpers.js";
import { consumer, rig } from "../pass/rig.js";
import { fn, putFile } from "./helpers.js";

/*
 * Row 015-35 (lessons.md "Round 1 (015-10)" B2): a new worktree's code
 * store is the common dir's, so it exists before the worktree's first
 * count. Until that count ends, the registration says counting is under
 * way, never `0 functions over`.
 */

const C1 = consumer("s1");
const C2 = consumer("s2");
const C3 = consumer("s3");
const COUNTED = "Complexity counted: 1 function over 20; squeal code lists them.";
const FILES = { "src/a.ts": "settle 23 B1\n", "src/b.ts": "close 3 B2\n" };
const complexity = (text: string) => text.split("\n").filter((l) => l.startsWith("Complexity:"));

describe("a registration in a new worktree (015-35)", () => {
  it("says counting has not started before the first count, and the count after it", async () => {
    const r = rig();
    r.tree.write("src/a.ts", "settle 23 B1\n").write("src/b.ts", "close 3 B2\n").commit();
    expect(complexity(await r.register(C1))).toEqual(["Complexity: counting has not started."]);
    expect(await r.pass()).toMatchObject({ mode: "first" });
    expect(complexity(await r.register(C2))).toEqual([
      "Complexity: 1 function over 20; squeal code lists them.",
    ]);
  });

  it("says counting while every file is counted but the count has not ended", async () => {
    // Another worktree counted these blobs: the files rows are written, the states not yet.
    const r = rig();
    putFile(r.store, r.tree.id, "src/a.ts", [fn("settle", 23, 1)]);
    putFile(r.store, r.tree.id, "src/b.ts", [fn("close", 3, 1)]);
    expect(complexity(await r.register(C1))).toEqual(["Complexity: counting, 2 of 2 files."]);
  });

  it("says the count of a worktree whose first count found no file to count", async () => {
    const r = rig();
    r.tree.write("README.md", "no code\n").commit();
    await r.pass();
    expect(complexity(await r.register(C1))).toEqual([
      "Complexity: 0 functions over 20; squeal code lists them.",
    ]);
  });

  it("tells each session registered before a first count over inherited counts the count once", async () => {
    const r = rig();
    // Another worktree of the repository counted these blobs: this first count counts none.
    const other = worktree("w0", r.dir);
    for (const [path, text] of Object.entries(FILES)) other.write(path, text);
    other.revise();
    await pass(other, r.store, fakeCounter());
    for (const [path, text] of Object.entries(FILES)) r.tree.write(path, text);
    r.tree.commit();
    await r.register(C1);
    await r.register(C2);
    expect(await r.pass()).toMatchObject({ mode: "first", counted: 0 });
    expect(complexity(await r.register(C3))).toEqual([
      "Complexity: 1 function over 20; squeal code lists them.",
    ]);
    expect(await r.delivered(C1)).toContain(COUNTED);
    expect(await r.delivered(C2)).toContain(COUNTED);
    expect(await r.delivered(C3)).toEqual([]);
    expect(await r.delivered(C1)).toEqual([]);
  });

  it("writes no recount record for a first count over inherited counts that nobody waited for", async () => {
    const r = rig();
    const other = worktree("w0", r.dir);
    for (const [path, text] of Object.entries(FILES)) other.write(path, text);
    other.revise();
    await pass(other, r.store, fakeCounter());
    for (const [path, text] of Object.entries(FILES)) r.tree.write(path, text);
    r.tree.commit();
    expect(await r.pass()).toMatchObject({ mode: "first", counted: 0 });
    expect(readRecount(r.store.meta, r.tree.id)).toBeNull();
    await r.register(C1);
    expect(await r.delivered(C1)).toEqual([]);
  });
});
