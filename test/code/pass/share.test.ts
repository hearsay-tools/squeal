import { describe, expect, it } from "vitest";
import { readRecount } from "../../../src/core/code/pass/index.js";
import { commonDir, open } from "../helpers.js";
import { fakeCounter, pass, worktree } from "./helpers.js";

describe("counts shared by blob between worktrees (015 D4, goal 8)", () => {
  it("counts a blob two worktrees hold once, and keeps each worktree's states its own", async () => {
    const dir = commonDir();
    const first = worktree("w1", dir);
    const second = worktree("w2", dir);
    const counter = fakeCounter();
    first.write("src/a.ts", "settle 23 B1\n").revise();
    second.write("lib/moved.ts", "settle 23 B1\n").write("src/c.ts", "pay 3 B2\n").revise();

    await pass(first, open(dir), counter);
    const report = await pass(second, open(dir), counter);

    expect(counter.calls).toEqual(["settle 23 B1\n", "pay 3 B2\n"]);
    expect(report).toMatchObject({ counted: 1 });
    const store = open(dir);
    expect(store.states.list("w1").map((s) => s.check.path)).toEqual(["src/a.ts"]);
    expect(store.states.list("w2").map((s) => s.check.path)).toEqual(["lib/moved.ts", "src/c.ts"]);
  });

  it("counts a blob at two paths of one worktree once", async () => {
    const tree = worktree();
    const counter = fakeCounter();
    tree.write("src/a.ts", "settle 23 B1\n").write("src/copy.ts", "settle 23 B1\n").revise();
    await pass(tree, open(tree.commonDir), counter);
    expect(counter.calls).toHaveLength(1);
    expect(open(tree.commonDir).states.list(tree.id)).toHaveLength(2);
  });

  it("writes no recount key for a worktree's first pass over counts it inherits", async () => {
    const dir = commonDir();
    const first = worktree("w1", dir);
    const second = worktree("w2", dir);
    first.write("src/a.ts", "settle 23 B1\n").revise();
    second.write("src/a.ts", "settle 23 B1\n").revise();
    const store = open(dir);
    await pass(first, store, fakeCounter());
    const report = await pass(second, store, fakeCounter());
    expect(report).toMatchObject({ mode: "first", counted: 0 });
    expect(readRecount(store.meta, "w1")?.reason).toBe("first");
    expect(readRecount(store.meta, "w2")).toBeNull();
    expect(store.states.list("w2")).toHaveLength(1);
  });
});
