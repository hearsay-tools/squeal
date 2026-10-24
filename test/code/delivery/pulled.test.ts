import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { consumer, type Rig, rig } from "../pass/rig.js";

/*
 * Spec 015 D6 as amended by 015-38 (lessons.md "Round 1 (015-10)" B5, the
 * human's option (a)): a `PASS` or `RESOLVED` that a pull, merge, rebase,
 * cherry-pick or revert brought, for a function the session holds by
 * count only, is taken into its view and not told. A `FAIL` from git is
 * told, and so is a `PASS` or `RESOLVED` for a function the session was
 * told about in full.
 */

const C1 = consumer("s1");
const pass = (name: string, line: number) =>
  `PASS complexity: ${name} (src/a.ts:${line}) is 19, at or under 20`;
const fail = (name: string, line: number, cc: number) =>
  `FAIL complexity: ${name} (src/a.ts:${line}) is ${cc}, over 20 (ESLint rule)`;

let r: Rig;

/** The functions `C1`'s view holds, with how it was told of each. */
const view = () =>
  r.store.views
    .list(C1)
    .map((v) => `${v.check.qualifiedName} ${v.told}`)
    .sort();

beforeEach(async () => {
  r = rig();
  await r.pull({ "src/a.ts": "settle 23 B1\npay 20 B2\n", "src/b.ts": "close 22 B3\n" });
});

describe("a PASS or RESOLVED git brought (015-38)", () => {
  it("tells nothing of a pull over a function told by count that now passes, and leaves it out of the view", async () => {
    await r.register(C1);
    expect(view()).toEqual(["close count", "settle count"]);
    await r.pull({ "src/a.ts": "settle 19 B4\npay 20 B2\n" });
    expect(await r.told(C1)).toEqual([]);
    expect(view()).toEqual(["close count"]);
    // Taken in: the function's next state change is told as before.
    await r.edit({ "src/a.ts": "settle 21 B5\npay 20 B2\n" });
    expect(await r.told(C1)).toEqual([fail("settle", 1, 21)]);
  });

  it("tells the PASS of a function the session was told in full, as FAIL or STILL FAIL", async () => {
    await r.register(C1);
    await r.edit({ "src/a.ts": "settle 24 B4\npay 21 B5\n" });
    expect(await r.told(C1)).toEqual([fail("pay", 2, 21), expect.stringMatching(/^STILL FAIL /)]);
    expect(view()).toEqual(["close count", "pay full", "settle still"]);
    await r.pull({ "src/a.ts": "settle 19 B6\npay 19 B7\n" });
    expect(await r.told(C1)).toEqual([pass("pay", 2), pass("settle", 1)]);
    expect(view()).toEqual(["close count"]);
  });

  it("tells a FAIL a pull brings, of a function that went over or a new one", async () => {
    await r.register(C1);
    await r.pull({ "src/a.ts": "settle 23 B1\npay 21 B5\nfresh 25 B6\n" });
    expect(await r.told(C1)).toEqual([fail("fresh", 3, 25), fail("pay", 2, 21)]);
  });

  it("tells the PASS of an own edit to a function told by count, as before", async () => {
    await r.register(C1);
    await r.edit({ "src/a.ts": "settle 19 B4\npay 20 B2\n" });
    expect(await r.told(C1)).toEqual([pass("settle", 1)]);
    expect(view()).toEqual(["close count"]);
  });

  it("keeps a pull's PASS quiet beside an own edit to another file before the delivery", async () => {
    await r.register(C1);
    await r.pull({ "src/a.ts": "settle 19 B4\npay 20 B2\n" });
    await r.edit({ "src/b.ts": "close 23 B5\n" });
    expect(await r.told(C1)).toEqual([expect.stringMatching(/^STILL FAIL complexity: close /)]);
    expect(view()).toEqual(["close still"]);
  });

  it("tells nothing when a pull removes a function told by count, or deletes its file", async () => {
    await r.register(C1);
    await r.pull({ "src/a.ts": "pay 20 B2\n" });
    expect(await r.told(C1)).toEqual([]);
    expect(view()).toEqual(["close count"]);
    r.tree.remove("src/b.ts").commit("src/b.ts");
    r.tree.revise();
    await r.pass();
    expect(await r.told(C1)).toEqual([]);
    expect(view()).toEqual([]);
  });

  it("tells RESOLVED when a pull removes a function the session was told failing", async () => {
    await r.register(C1);
    await r.edit({ "src/a.ts": "settle 23 B1\npay 21 B5\n" });
    expect(await r.told(C1)).toEqual([fail("pay", 2, 21)]);
    await r.pull({ "src/a.ts": "settle 23 B1\n" });
    expect(await r.told(C1)).toEqual([expect.stringMatching(/^RESOLVED complexity: pay /)]);
  });

  it("tells nothing of a PASS a merge that git stopped brings (015-34)", async () => {
    r.tree.branch("topic", { "src/a.ts": "settle 19 B4\npay 20 B2\n", "notes.md": "topic\n" });
    await r.pull({ "notes.md": "main\n" });
    await r.register(C1);
    r.tree.run(["merge", "-q", "topic"], "src/a.ts", "notes.md").revise();
    expect(existsSync(join(r.tree.root, ".git", "MERGE_HEAD"))).toBe(true);
    await r.pass();
    expect(await r.told(C1)).toEqual([]);
    expect(view()).toEqual(["close count"]);
  });
});
