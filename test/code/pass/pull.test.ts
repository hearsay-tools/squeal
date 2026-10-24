import { beforeEach, describe, expect, it } from "vitest";
import { consumer, type Rig, rig } from "./rig.js";

/*
 * Spec 015 D6 as amended by 015-19 (lessons.md P1, sq6): a revision that
 * moves `HEAD` (a pull, merge, rebase or checkout) marks no first edit for
 * a file whose working-tree blob is its blob at the new `HEAD`. A `FAIL`
 * from that revision is still told; a `PASS` only to a session told the
 * function's `FAIL` (015-38, `test/code/delivery/pulled.test.ts`).
 */

const C1 = consumer("s1");
const still = (cc: number) =>
  `STILL FAIL complexity: settle (src/a.ts:1) is ${cc} after the edit; it was already over 20 before it (ESLint rule); Squeal stays quiet about it until it is at or under 20, and squeal code src/a.ts shows its count.`;

let r: Rig;

beforeEach(async () => {
  r = rig();
  await r.pull({ "src/a.ts": "settle 23 B1\npay 20 B2\n", "src/b.ts": "close 3 B3\n" });
  await r.register(C1);
});

describe("a revision that moves HEAD (015-19)", () => {
  it("tells no STILL FAIL for a failing function's committed body, and tells a later working-tree edit", async () => {
    const pulled = await r.pull({ "src/a.ts": "settle 25 B4\npay 20 B2\n" });
    expect(pulled).toMatchObject({ mode: "edit", transitions: 0, edited: [] });
    expect(await r.told(C1)).toEqual([]);
    const edited = await r.edit({ "src/a.ts": "settle 26 B5\npay 20 B2\n" });
    expect(edited?.edited.map((c) => c.qualifiedName)).toEqual(["settle"]);
    expect(await r.told(C1)).toEqual([still(26)]);
  });

  it("still tells a FAIL it brought, and takes in by count a PASS of a function told by count (015-38)", async () => {
    await r.pull({ "src/a.ts": "settle 19 B4\npay 21 B5\n" });
    expect(await r.told(C1)).toEqual([
      "FAIL complexity: pay (src/a.ts:2) is 21, over 20 (ESLint rule)",
    ]);
  });

  it("tells the first edit to a file whose working-tree blob is not the committed one", async () => {
    r.tree.write("src/a.ts", "settle 25 B4\npay 20 B2\n").write("src/b.ts", "close 4 B6\n");
    r.tree.commit("src/b.ts");
    r.tree.revise();
    const report = await r.pass();
    expect(report?.edited.map((c) => c.qualifiedName)).toEqual(["settle"]);
    expect(await r.told(C1)).toEqual([still(25)]);
  });

  it("follows each revision of a pass: a pull, then a working-tree edit of the same file", async () => {
    r.tree.write("src/a.ts", "settle 25 B4\npay 20 B2\n").commit();
    r.tree.revise();
    r.tree.write("src/a.ts", "settle 26 B5\npay 20 B2\n").revise();
    await r.pass();
    expect(await r.told(C1)).toEqual([still(26)]);
  });

  it("follows each revision of a pass: a pull, then a working-tree edit of another file", async () => {
    r.tree.write("src/a.ts", "settle 25 B4\npay 20 B2\n").commit();
    r.tree.revise();
    r.tree.write("src/b.ts", "close 4 B6\n").revise();
    const report = await r.pass();
    expect(report?.edited.map((c) => c.qualifiedName)).toEqual(["close"]);
    expect(await r.told(C1)).toEqual([]);
  });

  it("asks git at a worktree's first revision, whose HEAD before is not known", async () => {
    const fresh = rig();
    fresh.tree.write("src/a.ts", "settle 23 B1\n").commit();
    expect(await fresh.pass()).toMatchObject({ revision: 0, mode: "first" });
    await fresh.register(C1);
    expect(await fresh.pull({ "src/a.ts": "settle 25 B4\n" })).toMatchObject({ edited: [] });
    expect(await fresh.told(C1)).toEqual([]);
  });

  it("marks the edit when HEAD stayed, though the file is the committed one", async () => {
    await r.edit({ "src/a.ts": "settle 25 B4\npay 20 B2\n" });
    await r.register(consumer("s2"));
    // `git checkout -- src/a.ts` with `HEAD` where it was: the agent's own change.
    const restored = await r.edit({ "src/a.ts": "settle 23 B1\npay 20 B2\n" });
    expect(restored?.edited.map((c) => c.qualifiedName)).toEqual(["settle"]);
    expect(await r.told(consumer("s2"))).toEqual([still(23)]);
  });
});
