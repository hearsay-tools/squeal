import { beforeEach, describe, expect, it } from "vitest";
import { readPulled } from "../../../src/core/code/pass/pulled.js";
import { WT } from "../../state/helpers.js";
import { fakeCounter } from "./helpers.js";
import { type Rig, rig } from "./rig.js";

/*
 * Spec 015 D6 as amended by 015-38: the pass records each judged file
 * whose last change git brought, with the revision, for the delivery.
 */

let r: Rig;
const pulled = () => [...readPulled(r.store.meta, WT)].map(([path, rev]) => `${path} ${rev}`);

beforeEach(async () => {
  r = rig();
  await r.pull({ "src/a.ts": "settle 23 B1\n", "src/b.ts": "close 3 B2\n" });
});

describe("the files git changed last (015-38)", () => {
  it("records a pull's files at its revision, and an own edit drops one", async () => {
    // The worktree's first pass is a first count, which records none.
    expect(pulled()).toEqual([]);
    await r.pull({ "src/a.ts": "settle 19 B3\n", "src/b.ts": "close 4 B4\n" });
    expect(pulled()).toEqual(["src/a.ts 2", "src/b.ts 2"]);
    await r.edit({ "src/a.ts": "settle 18 B5\n" });
    expect(pulled()).toEqual(["src/b.ts 2"]);
    await r.pull({ "src/b.ts": "close 5 B6\n" });
    expect(pulled()).toEqual(["src/b.ts 4"]);
  });

  it("records a file a pull deleted, and none an own deletion", async () => {
    r.tree.remove("src/b.ts").commit("src/b.ts");
    r.tree.revise();
    await r.pass();
    expect(pulled()).toEqual(["src/b.ts 2"]);
    r.tree.remove("src/a.ts").revise();
    await r.pass();
    expect(pulled()).toEqual(["src/b.ts 2"]);
  });

  it("starts again at a recount", async () => {
    await r.pull({ "src/a.ts": "settle 19 B3\n" });
    expect(pulled()).toEqual(["src/a.ts 2"]);
    r.tree.revise();
    await r.pass({ ...fakeCounter(), version: 99 });
    expect(pulled()).toEqual([]);
  });
});
