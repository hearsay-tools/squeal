import { describe, expect, it } from "vitest";
import { readRecount } from "../../../src/core/code/pass/index.js";
import { open } from "../helpers.js";
import { fakeCounter, pass, policyOn, worktree } from "./helpers.js";

describe("the code pass's included set (015 D1)", () => {
  it("counts only included files: no test file, node_modules, ignored file, excluded glob or other extension", async () => {
    const tree = worktree();
    const store = open(tree.commonDir);
    tree
      .write("src/a.ts", "a 2 A\n")
      .write("src/a.test.ts", "t 2 T\n")
      .write("node_modules/p/index.js", "n 2 N\n")
      .write("src/gen.ts", "g 2 G\n")
      .write("dist/out.js", "d 2 D\n")
      .write("tools/x.py", "x 2 X\n")
      .write("README.md", "r 2 R\n")
      .revise();
    tree.testFiles.push("src/a.test.ts");
    tree.ignored.push("src/gen.ts");
    const counter = fakeCounter();
    await pass(tree, store, counter);
    expect(store.files.list(tree.id).map((f) => `${f.path} ${f.language}`)).toEqual([
      "src/a.ts typescript",
      "tools/x.py python",
    ]);
    expect(counter.calls).toHaveLength(2);
  });

  it("keeps a too-big file's row with its size and no count, out of the files still to count", async () => {
    const tree = worktree();
    const store = open(tree.commonDir);
    tree
      .write("src/big.ts", `big 30 B\n${" ".repeat(100)}`)
      .write("src/a.ts", "a 2 A\n")
      .revise();
    const counter = fakeCounter();
    await pass(tree, store, counter, { policy: policyOn({ maxFileBytes: 64 }) });
    expect(store.files.list(tree.id, ["src/big.ts"])).toEqual([
      expect.objectContaining({ path: "src/big.ts", size: 109, tooBig: true }),
    ]);
    expect(store.files.list(tree.id, ["src/a.ts"])[0]).not.toHaveProperty("tooBig");
    expect(store.files.uncounted(tree.id)).toEqual([]);
    expect(counter.calls).toEqual(["a 2 A\n"]);
    expect(store.states.list(tree.id).map((s) => s.check.path)).toEqual(["src/a.ts"]);
  });

  it("removes the states of a file that grows over the limit", async () => {
    const tree = worktree();
    const store = open(tree.commonDir);
    const policy = policyOn({ maxFileBytes: 64 });
    tree.write("src/a.ts", "settle 23 B\n").revise();
    await pass(tree, store, fakeCounter(), { policy });
    tree.write("src/a.ts", `settle 23 B\n${" ".repeat(100)}`).revise();
    await pass(tree, store, fakeCounter(), { policy });
    expect(store.states.list(tree.id)).toEqual([]);
    expect(store.files.list(tree.id)[0]?.tooBig).toBe(true);
  });

  it("drops the states of a file once a runner lists it as a test file", async () => {
    const tree = worktree();
    const store = open(tree.commonDir);
    tree.write("src/new.test.ts", "t 23 T\n").revise();
    await pass(tree, store, fakeCounter());
    tree.testFiles.push("src/new.test.ts");
    tree.write("src/a.ts", "a 2 A\n").revise();
    await pass(tree, store, fakeCounter());
    expect(store.files.list(tree.id).map((f) => f.path)).toEqual(["src/a.ts"]);
    expect(store.states.list(tree.id).map((s) => s.check.path)).toEqual(["src/a.ts"]);
  });
});

describe("the code pass's recount on a policy change (015 D1, D5, D6)", () => {
  async function seeded() {
    const tree = worktree();
    const store = open(tree.commonDir);
    tree.write("src/a.ts", "settle 18 B1\npay 3 B2\n").write("lib/b.ts", "fee 25 B3\n").revise();
    await pass(tree, store, fakeCounter());
    return { tree, store };
  }
  const outcomes = (store: ReturnType<typeof open>, id: string) =>
    store.states.list(id).map((s) => `${s.check.qualifiedName} ${s.outcome} ${s.threshold}`);

  it("judges every state again at a new threshold with one recount record and no transition", async () => {
    const { tree, store } = await seeded();
    const counter = fakeCounter();
    const report = await pass(tree, store, counter, { policy: policyOn({ threshold: 15 }) });
    expect(outcomes(store, tree.id)).toEqual(["fee fail 15", "pay pass 15", "settle fail 15"]);
    expect(readRecount(store.meta, tree.id)).toMatchObject({ reason: "threshold", threshold: 15 });
    expect(report).toMatchObject({ mode: "threshold", transitions: 0, counted: 0 });
    expect(counter.calls).toEqual([]);
    const settle = {
      kind: "code",
      path: "src/a.ts",
      qualifiedName: "settle",
      occurrence: 0,
    } as const;
    expect(store.transitions.history(tree.id, settle)).toEqual([]);
    expect(store.states.list(tree.id, { outcome: "fail", paths: ["src/a.ts"] })[0]?.changedAt).toBe(
      1,
    );
  });

  it("removes the states an exclude change leaves out, quietly, as an include change", async () => {
    const { tree, store } = await seeded();
    await pass(tree, store, fakeCounter(), { policy: policyOn({ exclude: ["lib/**"] }) });
    expect(outcomes(store, tree.id)).toEqual(["pay pass 20", "settle pass 20"]);
    const fee = { kind: "code", path: "lib/b.ts", qualifiedName: "fee", occurrence: 0 } as const;
    expect(store.transitions.history(tree.id, fee)).toEqual([]);
    expect(readRecount(store.meta, tree.id)?.reason).toBe("include");
  });

  it("reads a size limit change as an include change, and a threshold change wins over both", async () => {
    const { tree, store } = await seeded();
    await pass(tree, store, fakeCounter(), { policy: policyOn({ maxFileBytes: 1_000 }) });
    expect(readRecount(store.meta, tree.id)?.reason).toBe("include");
    await pass(tree, store, fakeCounter(2), {
      policy: policyOn({ maxFileBytes: 2_000, threshold: 10 }),
    });
    expect(readRecount(store.meta, tree.id)?.reason).toBe("threshold");
  });

  it("counts every file again at a new counter version, with the reason counter", async () => {
    const { tree, store } = await seeded();
    const counter = fakeCounter(2);
    await pass(tree, store, counter);
    expect(counter.calls).toHaveLength(2);
    expect(readRecount(store.meta, tree.id)?.reason).toBe("counter");
    expect(store.files.list(tree.id).map((f) => f.counterVersion)).toEqual([2, 2]);
  });
});
