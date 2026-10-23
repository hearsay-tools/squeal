import { describe, expect, it } from "vitest";
import { readRecount } from "../../../src/core/code/pass/index.js";
import type { CodeStore } from "../../../src/core/code/store/index.js";
import { open } from "../helpers.js";
import { type FakeWorktree, fakeCounter, pass, worktree } from "./helpers.js";

/** Each state of the worktree as `path name#occurrence outcome value`. */
function states(store: CodeStore, tree: FakeWorktree): string[] {
  return store.states
    .list(tree.id)
    .map(
      (s) =>
        `${s.check.path} ${s.check.qualifiedName}#${s.check.occurrence} ${s.outcome} ${s.value}`,
    );
}

/** Each transition of a check as `kind from>to`. */
function history(store: CodeStore, tree: FakeWorktree, path: string, name: string): string[] {
  return store.transitions
    .history(tree.id, { kind: "code", path, qualifiedName: name, occurrence: 0 })
    .map((t) => `${t.kind} ${t.from}>${t.to}`);
}

/** A worktree after its first count of `src/a.ts`. */
async function counted(text: string) {
  const tree = worktree();
  const store = open(tree.commonDir);
  const counter = fakeCounter();
  tree.write("src/a.ts", text).revise();
  await pass(tree, store, counter);
  return { tree, store, counter };
}

describe("the code pass's states and transitions (015 D2, D5)", () => {
  it("seeds every state at the first count with no transition, and writes the recount key", async () => {
    const { tree, store } = await counted("settle 23 B1\npay 3 B2\n");
    expect(states(store, tree)).toEqual(["src/a.ts pay#0 pass 3", "src/a.ts settle#0 fail 23"]);
    expect(history(store, tree, "src/a.ts", "settle")).toEqual([]);
    expect(readRecount(store.meta, tree.id)).toEqual({
      revision: 1,
      at: 1_000,
      reason: "first",
      threshold: 20,
    });
    const [state] = store.states.list(tree.id, { outcome: "fail" });
    expect(state).toMatchObject({
      countedAt: 1,
      changedAt: 1,
      threshold: 20,
      measure: "complexity",
    });
    expect(state?.blob).toBe(tree.source.file("src/a.ts")?.hash);
  });

  it("delivers a new function over the threshold as a first-seen fail; one under records nothing", async () => {
    const { tree, store } = await counted("pay 3 B2\n");
    tree.write("src/a.ts", "pay 3 B2\nsettle 23 B1\nfee 4 B3\n").revise();
    const report = await pass(tree, store, fakeCounter());
    expect(history(store, tree, "src/a.ts", "settle")).toEqual(["first-seen-fail null>fail"]);
    expect(history(store, tree, "src/a.ts", "fee")).toEqual([]);
    expect(report).toMatchObject({ mode: "edit", revision: 2, transitions: 1 });
  });

  it("records PASS -> FAIL and FAIL -> PASS, and a count that stays over records nothing", async () => {
    const { tree, store } = await counted("settle 18 B1\n");
    tree.write("src/a.ts", "settle 23 B2\n").revise();
    await pass(tree, store, fakeCounter());
    tree.write("src/a.ts", "settle 25 B3\n").revise();
    const quiet = await pass(tree, store, fakeCounter());
    tree.write("src/a.ts", "settle 20 B4\n").revise();
    await pass(tree, store, fakeCounter());
    expect(history(store, tree, "src/a.ts", "settle")).toEqual([
      "pass-to-fail pass>fail",
      "fail-to-pass fail>pass",
    ]);
    // 015-08's input: the same identity with another body.
    expect(quiet?.edited.map((c) => c.qualifiedName)).toEqual(["settle"]);
    expect(quiet?.transitions).toBe(0);
    expect(store.states.list(tree.id)[0]).toMatchObject({ outcome: "pass", changedAt: 4 });
  });

  it("keeps changedAt while the outcome holds", async () => {
    const { tree, store } = await counted("settle 23 B1\n");
    tree.write("src/a.ts", "settle 30 B2\n").revise();
    await pass(tree, store, fakeCounter());
    expect(store.states.list(tree.id)[0]).toMatchObject({ value: 30, countedAt: 2, changedAt: 1 });
  });

  it("records a removed failing function once as removed, and a removed passing one not at all", async () => {
    const { tree, store } = await counted("settle 23 B1\npay 3 B2\nfee 4 B3\n");
    tree.write("src/a.ts", "fee 4 B3\n").revise();
    await pass(tree, store, fakeCounter());
    expect(history(store, tree, "src/a.ts", "settle")).toEqual(["removed fail>null"]);
    expect(history(store, tree, "src/a.ts", "pay")).toEqual([]);
    expect(states(store, tree)).toEqual(["src/a.ts fee#0 pass 4"]);
  });

  it("removes a deleted file's functions as removed", async () => {
    const { tree, store } = await counted("settle 23 B1\n");
    tree.remove("src/a.ts").revise();
    await pass(tree, store, fakeCounter());
    expect(history(store, tree, "src/a.ts", "settle")).toEqual(["removed fail>null"]);
    expect(store.states.list(tree.id)).toEqual([]);
    expect(store.files.list(tree.id)).toEqual([]);
  });

  it("keeps the state through a rename with the same body, and records nothing", async () => {
    const { tree, store } = await counted("settle 23 B1\n");
    tree.write("src/a.ts", "close 23 B1\n").revise();
    const report = await pass(tree, store, fakeCounter());
    expect(report?.moved).toBe(1);
    expect(states(store, tree)).toEqual(["src/a.ts close#0 fail 23"]);
    expect(store.states.list(tree.id)[0]).toMatchObject({ changedAt: 1, countedAt: 2 });
    expect(history(store, tree, "src/a.ts", "close")).toEqual([]);
    expect(history(store, tree, "src/a.ts", "settle")).toEqual([]);
  });

  it("keeps the state and the delivery view through a move to another file", async () => {
    const { tree, store } = await counted("settle 23 B1\npay 3 B2\n");
    const consumer = { worktreeId: tree.id, sessionId: "s1", agentId: "main" };
    const settle = {
      kind: "code",
      path: "src/a.ts",
      qualifiedName: "settle",
      occurrence: 0,
    } as const;
    store.views.writeMany(consumer, [
      {
        check: settle,
        measure: "complexity",
        outcome: "fail",
        threshold: 20,
        told: "count",
        toldAt: 1,
      },
    ]);
    tree.write("src/a.ts", "pay 3 B2\n").write("src/b.ts", "settle 23 B1\n").revise();
    await pass(tree, store, fakeCounter());
    expect(states(store, tree)).toEqual(["src/a.ts pay#0 pass 3", "src/b.ts settle#0 fail 23"]);
    expect(history(store, tree, "src/a.ts", "settle")).toEqual([]);
    expect(store.views.list(consumer).map((v) => v.check.path)).toEqual(["src/b.ts"]);
  });

  it("reads a move and an edit in one revision as a removed check and a new one", async () => {
    const { tree, store } = await counted("settle 23 B1\n");
    tree.write("src/a.ts", "").write("src/b.ts", "settle 24 B9\n").revise();
    await pass(tree, store, fakeCounter());
    expect(history(store, tree, "src/a.ts", "settle")).toEqual(["removed fail>null"]);
    expect(history(store, tree, "src/b.ts", "settle")).toEqual(["first-seen-fail null>fail"]);
  });

  it("gives duplicate names their own occurrence, each with its own state", async () => {
    const { tree, store } = await counted("handler 23 B1\nhandler 2 B2\n");
    expect(states(store, tree)).toEqual([
      "src/a.ts handler#0 fail 23",
      "src/a.ts handler#1 pass 2",
    ]);
  });

  it("marks a function in a parse error's range unknown, and records no transition in or out", async () => {
    const { tree, store } = await counted("settle 18 B1\n");
    tree.write("src/a.ts", "settle 23 B2 !\n").revise();
    await pass(tree, store, fakeCounter());
    expect(states(store, tree)).toEqual(["src/a.ts settle#0 unknown 23"]);
    tree.write("src/a.ts", "settle 23 B2\n").revise();
    await pass(tree, store, fakeCounter());
    expect(states(store, tree)).toEqual(["src/a.ts settle#0 fail 23"]);
    expect(history(store, tree, "src/a.ts", "settle")).toEqual([]);
  });

  it("follows every revision since its cursor at once when it lags", async () => {
    const { tree, store } = await counted("settle 3 B1\n");
    tree.write("src/a.ts", "settle 23 B2\n").revise();
    tree.write("src/b.ts", "pay 30 B3\n").revise();
    const report = await pass(tree, store, fakeCounter());
    expect(report).toMatchObject({ revision: 3, files: 2, transitions: 2 });
    expect(await pass(tree, store, fakeCounter())).toBeNull();
  });
});
