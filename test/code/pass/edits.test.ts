import { describe, expect, it } from "vitest";
import type { CodeStore } from "../../../src/core/code/store/index.js";
import { open } from "../helpers.js";
import { type FakeWorktree, fakeCounter, pass, policyOn, worktree } from "./helpers.js";

/** Each stored edit as `name@revision`. */
function edits(store: CodeStore, tree: FakeWorktree): string[] {
  return store.states
    .edits(tree.id, "complexity")
    .map((e) => `${e.check.qualifiedName}@${e.revision}`);
}

/** A worktree after its first count of `src/a.ts`, at time 1 000. */
async function counted(text: string) {
  const tree = worktree();
  const store = open(tree.commonDir);
  tree.write("src/a.ts", text).revise();
  await pass(tree, store, fakeCounter());
  return { tree, store };
}

describe("the code pass's edits (015 D6, its last rule)", () => {
  it("stores the revision and time a body changed with its identity kept", async () => {
    const { tree, store } = await counted("settle 23 B1\npay 3 B2\n");
    expect(edits(store, tree)).toEqual([]);
    tree.write("src/a.ts", "settle 25 B9\npay 3 B2\n").revise();
    await pass(tree, store, fakeCounter(), { now: () => 2_000 });
    expect(store.states.edits(tree.id, "complexity")).toEqual([
      {
        check: { kind: "code", path: "src/a.ts", qualifiedName: "settle", occurrence: 0 },
        measure: "complexity",
        revision: 2,
        at: 2_000,
      },
    ]);
  });

  it("keeps the last edit while later passes count the file with that body", async () => {
    const { tree, store } = await counted("settle 23 B1\npay 3 B2\n");
    tree.write("src/a.ts", "settle 25 B9\npay 3 B2\n").revise();
    await pass(tree, store, fakeCounter());
    tree.write("src/a.ts", "settle 25 B9\npay 4 B7\n").revise();
    await pass(tree, store, fakeCounter());
    expect(edits(store, tree)).toEqual(["pay@3", "settle@2"]);
  });

  it("stores no edit for a move or a rename with the same body (D2)", async () => {
    const { tree, store } = await counted("settle 23 B1\npay 3 B2\n");
    tree.write("src/a.ts", "close 23 B1\n").write("src/b.ts", "pay 3 B2\n").revise();
    const report = await pass(tree, store, fakeCounter());
    expect(report?.moved).toBe(2);
    expect(edits(store, tree)).toEqual([]);
  });

  it("stores no edit at a recount (D6's summary)", async () => {
    const { tree, store } = await counted("settle 23 B1\n");
    tree.write("src/a.ts", "settle 25 B9\n").revise();
    const report = await pass(tree, store, fakeCounter(), {
      policy: policyOn({ threshold: 10 }),
    });
    expect(report?.mode).toBe("threshold");
    expect(edits(store, tree)).toEqual([]);
  });

  it("forgets a removed function's edit, so one of the same name later starts with none", async () => {
    const { tree, store } = await counted("settle 23 B1\n");
    tree.write("src/a.ts", "settle 25 B9\n").revise();
    await pass(tree, store, fakeCounter());
    tree.write("src/a.ts", "").revise();
    await pass(tree, store, fakeCounter());
    tree.write("src/a.ts", "settle 24 B5\n").revise();
    await pass(tree, store, fakeCounter());
    expect(edits(store, tree)).toEqual([]);
  });
});
